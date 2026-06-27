---
title: "How a document becomes searchable"
description: "How a markdown scheme document becomes searchable rows in pgvector: paragraph-aware chunking that preserves citations, a provider-agnostic embedding layer, and the fixed vector column dimension that will bite you if you ignore it."
pubDate: 2026-06-26
tags: ["ai", "rag", "build-in-public", "scheme-qa", "postgres"]
draft: false
---

Last post we covered the idea the whole thing rests on: text becomes coordinates, and the nearest coordinates are the closest in meaning. We've got the table and the index ready for those coordinates. What we don't have yet is the coordinates themselves.

Producing them is the ingest pipeline, and it's three steps: chunk, then embed, then store. Each one hides a decision that looks trivial until you get it wrong. This post walks all three with the actual code.

Keep one goal in mind throughout. Every piece of text we store has to stay traceable to a specific scheme and section, because that trace is what becomes the citation later. Lose it here and there's nothing to cite at the end.

## The document convention

Each scheme is a single markdown file with a deliberately plain shape:

```markdown
# PM-KISAN                 <- the scheme (an H1)
## Eligibility             <- a section (an H2)
Small and marginal farmer families...

## Benefits
₹6,000 per year in three equal instalments...
```

The `#` heading names the scheme. Each `##` heading opens a section. The body text underneath is what gets chunked. That structure isn't cosmetic. It becomes the `(scheme_name, section, chunk_index)` key that rides along with every chunk, all the way to the citation a reader sees in the UI.

## Chunking: split on structure, then pack

Why chop documents up at all? Because of the averaging problem from the last post. Embed a whole three-page document into one point and that point is a blurry average of everything in it: eligibility, benefits, how to apply, all smeared together. A question about benefits won't land cleanly near a smear like that. Embed one section at a time and each point has a sharp, single-topic meaning that a question can actually find.

The naive approach is to cut every N characters. That slices sentences, numbers, and citations clean in half. Instead the chunker splits on the document's own structure first, then packs whole paragraphs greedily up to a soft size cap:

```ts
const DEFAULTS = {
  // ~512 tokens at ~4 chars/token — comfortable for voyage-3.5.
  maxChars: 2000,
  // Trailing context copied from the previous chunk into the next, so an
  // answer spanning a boundary still has both sides.
  overlapChars: 200,
};
```

The packer is greedy but careful. It fills a chunk with whole paragraphs up to the cap and won't cut mid-paragraph unless forced to. It copies the tail of each chunk onto the front of the next, so a fact sitting on a boundary survives intact in at least one of them. And when a single paragraph is bigger than the cap all by itself, it breaks on sentence boundaries, falling back to a raw character cut only if one sentence is somehow still too long. That last case almost never fires, but it guarantees no chunk can ever exceed the limit no matter how strange the input is.

There's a quiet safety net too. Anything sitting before the first `## ` heading gets collected into an "Overview" section rather than dropped on the floor:

```ts
let current = { title: "Overview", body: "" };
```

It's easy to lose a document's intro paragraph to an off-by-one in a parser. Defaulting it into a real section means nothing gets silently discarded, which is a theme you'll see again and again in this project: fail loud, never lose data quietly.

Every chunk that comes out carries its identity and a little metadata:

```ts
chunks.push({
  schemeName: scheme,
  section: section.title,
  chunkIndex,
  content,
  metadata: { source: schemeName, chars: content.length,
              approxTokens: Math.ceil(content.length / 4) },
});
```

That `(schemeName, section, chunkIndex)` triple is the natural key. It maps one-to-one onto a `UNIQUE` constraint in the database, which is what lets us re-ingest safely. More on that when we get to storage.

A reasonable question here: where did 2000 and 200 come from? They're roughly 512 tokens of content with 10% overlap, which is a common starting point, not a tuned result. The real way to settle them is to measure retrieval accuracy at a few different sizes and pick the winner, and we build exactly that harness later in the series. For now they're sensible defaults, exposed as options so any document can override them.

## Embedding: one function, any provider

An embedding turns text into the vector we talked about last post.

Worth pinning down here, because it trips people up: this system uses two completely different kinds of model, doing two completely different jobs. The embedding model (Voyage) only ever turns text into coordinates. It never writes a sentence. The generation model (Claude), which shows up later when we actually answer a question, never produces a vector. One measures meaning so we can search; the other reads what we found and phrases a reply. They don't compete and they aren't interchangeable. Right now, in the ingest pipeline, we only need the embedder.

The rest of the system shouldn't have to care which embedding provider produced those numbers, so the whole provider choice hides behind a single `embed()` and a small config:

```ts
const DEFAULTS = {
  voyage: { model: "voyage-3.5", dimensions: 1024 },
  openai: { model: "text-embedding-3-small", dimensions: 1536 },
};
```

Voyage lets you say whether a text is a stored document or a search query, and it tunes the vector differently for each. So `embed()` takes that as an argument:

```ts
embed(texts: string[], inputType: "query" | "document"): Promise<number[][]>
```

Documents get embedded as `"document"` when we ingest them; the user's question gets embedded as `"query"` at search time. OpenAI ignores the distinction, and the interface stays the same either way, so nothing downstream has to know.

Then there's batching. Twenty-two documents come out to hundreds of chunks. Sending them one request at a time is slow; sending them all at once runs straight into a free-tier rate limit. So texts get packed into batches bounded by both a count and an estimated token budget:

```ts
const BATCH_SIZE = Number(process.env.EMBED_BATCH_SIZE) || 96;
const MAX_BATCH_TOKENS = Number(process.env.EMBED_MAX_BATCH_TOKENS) || Infinity;
const BATCH_DELAY_MS = Number(process.env.EMBED_BATCH_DELAY_MS) || 0;
```

The defaults are fast (big batch, no delay) for a paid key. On Voyage's free tier, which allows three requests a minute and ten thousand tokens a minute, you set the env knobs and the same code paces itself. Requests retry with exponential backoff and honor a `Retry-After` header when the API sends one. That header handling is the difference between an ingest that survives the free tier and one that dies halfway through.

After every batch the code checks that each vector has exactly the dimension it expects. Which brings us to the gotcha that bites everyone exactly once.

## Storing the vectors: a dimension set in stone

The third step, store, is Postgres with pgvector, the setup from the last post. One table holds everything we search over:

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE chunks (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    scheme_name  TEXT        NOT NULL,
    section      TEXT        NOT NULL,
    chunk_index  INTEGER     NOT NULL,
    content      TEXT        NOT NULL,
    embedding    vector(1024) NOT NULL,
    metadata     JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (scheme_name, section, chunk_index)
);

CREATE INDEX chunks_embedding_hnsw
    ON chunks USING hnsw (embedding vector_cosine_ops);
```

The `vector(1024)` is the part to watch. That dimension is fixed when the table is created, and it has to match your embedding model's output exactly. Voyage's `voyage-3.5` produces 1024 numbers; OpenAI's `text-embedding-3-small` produces 1536. Switch models and you have to change this number and recreate the table, because you can't mix dimensions in one column. This is what the per-batch dimension check in `embed()` is really for: a mismatch fails loudly at ingest, the moment it happens, instead of silently writing garbage you discover weeks later when retrieval is mysteriously bad.

The HNSW index with `vector_cosine_ops` is the shortcut network from last post, set to rank by cosine. And the `UNIQUE (scheme_name, section, chunk_index)` line is the natural key from the chunker, which is what makes ingest idempotent.

That idempotency is the upsert:

```sql
INSERT INTO chunks (scheme_name, section, chunk_index, content, embedding, metadata)
VALUES (...)
ON CONFLICT (scheme_name, section, chunk_index) DO UPDATE SET
  content   = EXCLUDED.content,
  embedding = EXCLUDED.embedding,
  metadata  = EXCLUDED.metadata;
```

Re-running ingest refreshes a chunk in place instead of piling up duplicates. There's one edge case: if a document's section layout changes, old chunk indices can be left orphaned, so there's a `deleteScheme()` that wipes a scheme before a structural re-ingest.

One last detail. pgvector takes its input as a bracketed literal like `'[0.1,0.2,...]'`. The values are finite numbers so it's injection-safe, but the code still guards against a non-finite value rather than write a corrupt vector:

```ts
function toVectorLiteral(v: number[]): string {
  for (const x of v) {
    if (!Number.isFinite(x)) throw new Error("Embedding contains a non-finite value");
  }
  return `[${v.join(",")}]`;
}
```

## Tying it together

Chunk, embed, store: three functions, shown so far one at a time. The ingest routine is just the loop that runs them in order, once per document:

```ts
for (const file of files) {
  const text = await readFile(path.join(dir, file), "utf8");
  const chunks = chunkMarkdown(file.replace(DOC_RE, ""), text);          // chunk
  if (chunks.length === 0) continue;

  const scheme = chunks[0]!.schemeName;
  const vectors = await embed(chunks.map((c) => c.content), "document"); // embed
  const rows = chunks.map((c, i) => ({ ...c, embedding: vectors[i]! })); // pair chunk i with vector i

  await deleteScheme(sql, scheme);   // store: clear this scheme's old rows...
  await upsertChunks(sql, rows);     // ...then write the fresh ones
}
```

That's the whole pipeline, and it ties off two threads from earlier sections. The chunks are embedded with `"document"`, that document-versus-query input type, and because `embed()` returns its vectors in the same order it received the texts, `vectors[i]` always belongs to `chunks[i]`. That ordering guarantee is the only reason the pairing on the next line can be a plain index lookup. The delete-then-upsert is the orphan guard from the storage section: wipe the scheme's old rows, then write the current ones, so a section that was removed from the document can't leave a stale chunk lingering in the index.

## Where we are

A markdown document is now a set of rows in Postgres, each one a vector paired with the scheme and section it came from. Nothing has been retrieved yet. That's the next post: embedding the question, running the cosine search over the HNSW index, optionally reranking the results, and turning the top chunks into a streamed answer with citations.

> 📍 **Checkpoint** — `0abec3d` *(RAG core: chunk + embed + retrieve)* and `b6774f4` *(DB client, schema, and ingest wiring)*. Clickable repo links to follow once the source is public.

Next: [How a question finds its answer](/blog/building-a-cited-rag-how-a-question-finds-its-answer).
