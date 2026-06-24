# Post audio (the "podcast" upgrade)

The `ListenWidget` on each blog post probes for an MP3 here at load time. Drop a
file named after the post's slug and the widget automatically swaps its
browser-read-aloud fallback for a real `<audio>` player — no code change needed.

```
public/audio/<post-slug>.mp3
```

The slug is the post's filename without extension, e.g.
`building-a-cited-rag-1-introduction.md` → `building-a-cited-rag-1-introduction.mp3`.

## Generating MP3s

`scripts/generate-audio.mjs` produces one MP3 per published post using OpenAI
`gpt-4o-mini-tts`. It strips each post to clean narration text, chunks it under
the TTS input limit, and caches a content hash so reruns only regenerate posts
that actually changed.

```bash
OPENAI_API_KEY=sk-... npm run audio          # changed posts only
OPENAI_API_KEY=sk-... npm run audio -- --force   # regenerate everything
```

Tune the voice without touching code:

```bash
AUDIO_VOICE=sage \
AUDIO_INSTRUCTIONS="Warm, unhurried explainer." \
OPENAI_API_KEY=sk-... npm run audio
```

The widget picks up the resulting `<slug>.mp3` automatically — no code change.
