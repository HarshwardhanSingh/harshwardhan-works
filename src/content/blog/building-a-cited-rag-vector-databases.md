---
title: "What is a vector database?"
description: "The one idea the whole series rests on, from scratch: how text turns into coordinates, why the nearest point is the most similar in meaning, and what the index is really doing. No prior vector knowledge assumed."
pubDate: 2026-06-25
tags: ["ai", "rag", "build-in-public", "scheme-qa", "postgres"]
draft: false
---

Before we write a line of ingestion code, there's one idea the whole series leans on, and it's worth getting properly. If you already think in embeddings and cosine distance, skip ahead to the next post. If "vector database" is a phrase you nod along to without quite picturing, this is the post that makes the rest click.

Start with the problem it solves.

## Keyword search can't find meaning

Someone asks scheme-qa, "How much money do farmers get?" The document that answers it says *"beneficiaries receive ₹6,000 per annum."* A plain keyword search finds nothing. None of the words "money", "farmers", or "how much" appear in that sentence. The meaning lines up exactly; the letters don't overlap at all.

We want to search by meaning, not spelling. That's the entire job of a vector database, and it rests on one trick.

## Turn text into coordinates

An embedding model takes a piece of text and hands back a list of numbers: the coordinates of a point in space. The useful property is that text meaning similar things lands at nearby points, and text meaning different things lands far apart.

Picture a tiny version where every piece of text becomes just two numbers, an (x, y) you could plot on graph paper:

```
"cat"     → [0.99, 0.10]
"kitten"  → [0.97, 0.24]
"car"     → [0.10, 0.99]
```

(Those numbers are made up to illustrate the shape, not real embeddings.) Draw them as arrows from the origin. The cat and kitten arrows point almost the same way; the car arrow heads off in a different direction. Closeness in meaning has become closeness in space, which is something a computer can actually do arithmetic on.

Real embeddings don't use two numbers. The model this project uses returns 1024 of them for each piece of text. You can't draw 1024 dimensions, and you don't need to. The math is identical to the two-number version, just with far more room to capture nuance: topic, tone, the entities involved, and so on. More directions, more shades of meaning.

## "Nearest" means "most similar"

To find the text closest in meaning to a question, we measure the angle between the two arrows. A small angle means they point the same way, which means they mean nearly the same thing. That measurement is cosine similarity.

- "cat" vs "kitten": tiny angle, similarity around 0.99.
- "cat" vs "car": wide angle, similarity much lower.

Most vector tools work with cosine *distance*, which is just `1 − similarity`, so 0 means identical and bigger means more different. Either way the recipe is the same: turn the question into its own point, then find the stored points with the smallest distance to it. Those are the passages that mean the most similar thing to what was asked. No keyword ever has to match.

## Why it needs an index

You could keep these points in a plain list and, for every question, compare against every single one. That works for a few hundred. It falls apart as the collection grows, because each search has to read the whole thing.

So a vector database is really two jobs: somewhere to keep the points, and a way to find the nearest ones *without* checking all of them. That second job is an index. The one this project uses is called HNSW, and the picture to hold is a network of shortcuts between nearby points. Instead of asking every point how close it is, a search hops along the shortcuts, lands in the right neighbourhood, and homes in. It touches a few hundred points instead of a million.

There's a catch buried in the name: HNSW is an *approximate* nearest-neighbour index. Now and then it misses the true closest point, in exchange for being orders of magnitude faster. For question answering that's a fine trade. You're handing several passages to a model anyway, not staking everything on rank one.

## You already have one

Here's the part that surprises people. The vector database in this project is just Postgres with an extension called pgvector. The points live in an ordinary table column, and the index is one line of SQL. From the schema we scaffolded in part 1:

```sql
embedding vector(1024) NOT NULL,        -- the 1024 coordinates, one row of them per chunk
-- ...
CREATE INDEX chunks_embedding_hnsw
    ON chunks USING hnsw (embedding vector_cosine_ops);   -- the shortcut network, by cosine
```

The `vector(1024)` column holds the meaning-coordinates for one piece of text. The HNSW index makes "find the nearest meanings" fast. And `vector_cosine_ops` tells it that "near" means cosine, the angle measure from earlier. That's the whole vector database: no new infrastructure, just two lines in a table you already know how to run.

(That fixed `1024` is going to bite us in the next post. Hold the thought.)

## What's missing

We've got somewhere to store meaning-coordinates and a fast way to search them. What we don't have yet is the coordinates themselves. Producing them means taking a scheme document, cutting it into the right-sized pieces, and running each piece through the embedding model. There's more judgment in that than "just split the text" lets on.

> 📍 **Checkpoint** — no new code this post. The `vector(1024)` column and HNSW index it describes are already in the schema from part 1 (`be81193`, `docker/initdb/01_schema.sql`).

Next: [How a document becomes searchable](/blog/building-a-cited-rag-how-a-document-becomes-searchable).
