---
title: "Formatting reference"
description: "A quick reference post showing how Markdown and code render in this theme."
pubDate: 2026-06-19
tags: ["meta"]
draft: false
---

This post exists to show how the common Markdown elements look in this theme. Use it as a reference when writing — or delete it once you've seen everything render.

## Headings

The heading above is an `h2`. Below is an `h3`.

### A third-level heading

Body text sits at a comfortable reading size with a measure capped around 42rem so lines don't get too long.

## Text styles

You can write **bold**, *italic*, ~~strikethrough~~, and `inline code`. Links look [like this](/blog) and underline on hover.

## Lists

Unordered:

- First item
- Second item
  - A nested item
- Third item

Ordered:

1. Do the thing
2. Verify the thing
3. Ship the thing

## Blockquote

> The best way to predict the future is to invent it.

## Code

Inline code such as `npm run dev` is monospaced. Fenced blocks get syntax highlighting that follows the light/dark theme:

```ts
// A tiny rate limiter
function rateLimit(maxPerSec: number) {
  let tokens = maxPerSec;
  setInterval(() => (tokens = maxPerSec), 1000);
  return () => (tokens > 0 ? (tokens--, true) : false);
}
```

```bash
# Common commands
npm run dev      # local dev server
npm run build    # production build
npm run preview  # build + run on the Cloudflare runtime
```

## Table

| Topic        | Status      | Notes                    |
| ------------ | ----------- | ------------------------ |
| AI           | Writing     | Model behavior + tooling |
| Security     | Planned     | Applied appsec           |
| Web perf     | Planned     | Core Web Vitals          |

## Horizontal rule

---

That's the full set. Toggle the theme in the top-right to see how everything adapts.
