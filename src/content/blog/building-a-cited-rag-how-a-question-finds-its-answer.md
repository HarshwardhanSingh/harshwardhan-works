---
title: "How a question finds its answer"
description: "The read side of the pipeline: turn a question into a vector, find the nearest chunks with one SQL query, optionally rerank them, wrap them in a prompt that forces the model to stay honest, and stream back an answer that cites its sources."
pubDate: 2026-06-27
tags: ["ai", "rag", "build-in-public", "scheme-qa"]
draft: false
---

Part 3 ran a document one way through the pipeline: text in, searchable rows out. This post runs the trip in reverse. A question arrives, we find the chunks that mean the same thing, hand them to the model under strict instructions, and stream back an answer that says where it came from.

It's the same machinery as ingest, pointed the other direction. The embedder that turned documents into vectors now turns the question into one. The cosine distance that we indexed for now gets used in anger. The only genuinely new idea is the prompt that keeps the model honest, and that's the part that makes this RAG instead of a chatbot.

## Finding the chunks

Retrieval starts the same way ingest did, by embedding text. The difference is one argument:

```ts
const [queryEmbedding] = await embed([query], "query");
```

Back in part 3, documents were embedded with `"document"`. A question is embedded with `"query"`, because Voyage tunes the two differently and a question is a different kind of text than the passage that answers it. Same function, same model, different hint.

With the question now a vector, the search is a single SQL statement, wrapped in a function called `searchByVector`:

```ts
const rows = await sql`
  SELECT
    id, scheme_name, section, chunk_index, content, metadata,
    1 - (embedding <=> ${vec}::vector) AS score
  FROM chunks
  ORDER BY embedding <=> ${vec}::vector
  LIMIT ${topK}
`;
```

Everything here was set up in the last two posts. The `<=>` is pgvector's cosine distance operator, the exact one the HNSW index was built for, so this search rides the index instead of scanning the table. `ORDER BY ... LIMIT topK` asks for the five nearest chunks in meaning. And `1 - (embedding <=> ...)` flips distance back into a similarity score, where higher means a better match (1 is identical, 0 is unrelated), which is what we hand back for display.

That's the whole retrieval step. Embed the question, sort by cosine distance, take the top few. The result is a handful of chunks that, if the corpus has the answer at all, almost certainly contain it.

## Reranking, when the top five aren't ordered well

Cosine search is fast because it's an approximation. Each chunk was embedded on its own, ahead of time, with no knowledge of the question. Comparing two pre-computed vectors is cheap, but it's a rough proxy for "does this passage actually answer this question." Most of the time the right chunk lands in the top five. It doesn't always land at number one.

A reranker fixes the ordering. It's a different kind of model, a cross-encoder, which reads the question and a candidate passage *together* and scores how well they actually match. That's far more accurate than comparing two vectors. The catch is that it can't be pre-computed: it has to run live, on every candidate, for every question. Too slow to point at the whole table.

So it runs as a second stage over a shortlist:

```ts
const candidates = await searchByVector(sql, queryEmbedding, { topK: fetchK });
const ranked = await rerank(query, candidates.map((c) => c.content), topK);
return ranked.map(({ index, score }) => ({ ...candidates[index]!, score }));
```

Over-fetch a wider net with the cheap cosine search, maybe fifteen candidates, then let the expensive cross-encoder reorder them and keep the best five. Fast where you can afford to be rough, accurate where it counts. It costs one extra API call per question, so it's off by default and switched on with a flag. When it's on, the close calls, the questions where two schemes look similar, come out in the right order more often.

## The grounded prompt

Here's the part that earns the word "grounded." We have the right passages. Now we have to stop the model from doing the thing it's best at, which is confidently writing plausible text from memory. We want it to answer *only* from what we just retrieved, and to admit when the answer isn't there.

That's a system prompt:

```ts
export const SYSTEM_PROMPT = [
  "You are scheme-qa, an assistant answering questions about Indian government",
  "welfare schemes. Answer ONLY using the numbered context passages provided.",
  "Cite the passages you rely on inline, using the form (Scheme → Section) —",
  "e.g. (PM-KISAN → Benefits). Do not invent schemes, figures, or eligibility",
  "rules. If the answer is not contained in the context, say you don't have",
  "that information rather than guessing. Be concise and specific.",
].join(" ");
```

Read those instructions as the product spec they are. Answer only from the passages. Cite the scheme and section. Never invent a figure. Decline rather than guess. This is where the model gets demoted from the thing that *knows* the answer to the thing that *phrases* one over text we handed it, which is the framing from the very first post.

For the model to cite a passage, it needs the passages labelled. So the retrieved chunks get rendered into a numbered block, each one tagged with the scheme and section it came from:

```ts
chunks.map((c, i) => `[${i + 1}] (${c.schemeName} → ${c.section})\n${c.content.trim()}`)
```

Which produces something like:

```
[1] (PM-KISAN → Benefits)
Beneficiaries receive ₹6,000 per year in three equal instalments...

[2] (PM-KISAN → Eligibility)
Small and marginal farmer families...
```

The label `(PM-KISAN → Benefits)` is the key detail. When the model cites that in its answer, it isn't inventing a citation, it's copying a label we attached to a real row, which traces straight back to the `scheme_name` and `section` columns from part 3. The citation is true by construction. Then the user message is just the context followed by the question:

```ts
`Context passages:\n\n${formatContext(chunks)}\n\nQuestion: ${question.trim()}`
```

## Streaming the answer

A grounded answer can take a few seconds to generate. Making someone stare at a blank screen until the whole thing is ready feels broken, so the answer streams out token by token as the model writes it. The transport is server-sent events, a one-way stream from server to browser, and the `/chat` route sends three kinds of event in order: the sources, then the answer text, then a final summary.

The sources go out first, before a single word of the answer:

```ts
const chunks = await retrieve(getDb(), question, { topK, schemeName });
await stream.writeSSE({ event: "sources", data: JSON.stringify(chunks.map(toCitation)) });
```

Sending citations up front means the UI can show "here's what I'm reading" while the model is still thinking. Then there's a fail-safe worth pausing on. If retrieval came back empty, there's nothing to ground an answer in, so the route declines immediately without ever calling the model:

```ts
if (chunks.length === 0) {
  await stream.writeSSE({ event: "token", data: JSON.stringify(
    "I don't have information on that in the available scheme documents.") });
  await stream.writeSSE({ event: "done", data: JSON.stringify({ grounded: false }) });
  return;
}
```

That's cheaper, because it skips a model call, and safer, because a model asked to answer with no context is a model invited to make something up. When there *is* context, the answer streams:

```ts
const ms = getAnthropic().messages.stream({
  model, max_tokens: MAX_TOKENS,
  system: SYSTEM_PROMPT,
  messages: [{ role: "user", content: buildUserMessage(question, chunks) }],
});

for await (const ev of ms) {
  if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
    await stream.writeSSE({ event: "token", data: JSON.stringify(ev.delta.text) });
  }
}
```

The Anthropic SDK's streaming call yields events as the model generates. We pick out the text pieces and forward each one as a `token` event. Wrapping the text in `JSON.stringify` matters more than it looks: it escapes newlines and quotes so a token never breaks the line-based framing the stream relies on. A final `done` event carries token usage and the reason generation stopped.

So a single question produces an ordered stream: the citations, then the answer typing itself out, then a small bundle of metadata. That exact protocol, `sources` then `token` then `done`, is the contract the front end is built against.

## Where we are

The backend is now a complete question-answering machine. You can point `curl` at `/chat`, ask how much a farmer gets under PM-KISAN, and watch a grounded, cited answer stream back. What it doesn't have is a face. Right now the citations are JSON and the answer is a raw event stream.

> 📍 **Checkpoint** — `b6774f4` *(grounded prompt + streaming `/chat`)*. The optional reranker lands later, in `1e85100`. Clickable repo links to follow once the source is public.

Next: the chat UI that turns this stream into a conversation *(coming soon)*.
