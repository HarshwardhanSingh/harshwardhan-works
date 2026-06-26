---
title: "What we're building, and why"
description: "A build-along series on a retrieval-augmented Q&A system over Indian government schemes: what we're building, why grounding and citations matter more than the model, and the pipeline the rest of the series puts together piece by piece."
pubDate: 2026-06-24
tags: ["ai", "rag", "build-in-public", "scheme-qa"]
draft: false
---

We're building **scheme-qa**: ask a plain question about an Indian government welfare scheme ("How much do farmers get under PM-KISAN?", "Am I eligible for Ujjwala?") and get back an answer drawn only from the official scheme documents, with a citation to the exact **scheme → section** it came from.

That's the whole product in a sentence. You type a question, you get a grounded answer, and next to it sits the source it leaned on, so you can check the claim yourself instead of taking the model's word for it.

A general-purpose chatbot can already answer questions like these. The trouble is that it answers from a hazy memory of the internet, and it can't show you where any specific number came from. For welfare information, neither is acceptable. Fluent was never the hard part here. Being right, and being able to point at the source, is.

## Why build it

India runs dozens of central welfare schemes. The details that actually matter to a person — who qualifies, how much money, how to apply — sit scattered across government PDFs and pages that go stale the moment a budget passes. Ask a general chatbot and you'll often get an answer that's confident and wrong.

That second word is the real problem. A wrong number here isn't a bad demo; it sends someone to a bank counter for money they won't receive, or talks an eligible person out of applying at all. So the bar is higher than "sounds helpful":

- Every claim traces back to a source document.
- A question the documents can't answer gets declined, not improvised.
- A wrong figure should be hard to produce by construction, not avoided by luck.

Hold onto that last one. A lot of the later work exists only to make wrong figures structurally difficult.

## Why RAG and not a bigger model

There are two obvious alternatives, and it's worth seeing why neither holds up.

You could stuff the entire corpus into one enormous prompt. That's expensive on every single call, and the model still won't cite anything you can verify. Or you could fine-tune a model on the schemes, which bakes the facts into weights you then can't update when this year's subsidy changes — and you *still* can't get a citation out of it.

Retrieval-augmented generation fits the constraints the problem actually has:

- Facts live in documents, not weights. Update a file, re-ingest, and you're current.
- An answer can point at the exact passage it used.
- When retrieval comes back empty, you can tell the model to say so instead of guessing.

The model stops being the thing that *remembers* facts and becomes the thing that *phrases* them over text we hand it. Keep that framing in mind; it's behind nearly every choice in the posts that follow.

## The shape of the system

With the what and the why settled, here's the how, at a glance. It's two pipelines with a layer of guardrails wrapped around both.

Ingest runs offline, whenever the corpus changes:

```
markdown doc  →  chunk  →  embed  →  store in pgvector
```

Ask runs online, once per question:

```
question  →  embed  →  search  →  grounded prompt  →  stream answer + citations
```

Around those sit a hallucinated-figure check, optional abstention when retrieval is weak, an evaluation harness, and the step most projects skip entirely: verifying the source documents against official sources before trusting a word of them.

## The stack

| Layer        | Choice                                              |
| ------------ | --------------------------------------------------- |
| Language     | TypeScript, end to end                              |
| Backend      | Hono (`@hono/node-server`)                          |
| Vector store | Postgres 16 + pgvector (local, Docker)              |
| Embeddings   | Voyage AI (`voyage-3.5`), OpenAI as an alternative  |
| Generation   | Anthropic TS SDK, streamed                          |
| Frontend     | React + TanStack Router/Query                       |

Nothing exotic on purpose. Postgres with the pgvector extension instead of a dedicated vector database, because the corpus is small and one boring datastore I already trust beats a new piece of infrastructure to babysit. We'll get into why that's the right call (and when it stops being the right call) in part 2.

## Grounded is not the same as true

One distinction is worth pinning down before we write any code, because it quietly shapes the entire project:

> Grounded means faithful to the source document. It does not mean true in the world.

A RAG system can be flawlessly grounded and still wrong, if the document it's grounded in is wrong. Evaluation catches the model drifting away from its sources. It does nothing about a source that's simply out of date. The documents set the ceiling on how correct the system can ever be, which is exactly why a later post is given over entirely to verifying the corpus against official `.gov.in` sources, rather than just to wiring up retrieval.

Each post in this series ends with a checkpoint commit, so you can check out the exact code being discussed. Here's the first.

> 📍 **Checkpoint** — `be81193` *(initial commit: infra scaffold — Docker, schema, env)*. A clickable repo link goes here once the source is public.

Next: Chunking, embeddings & the vector DB *(coming soon)*.
