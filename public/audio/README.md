# Post audio (the "podcast" upgrade)

The `ListenWidget` on each blog post probes for an MP3 here at load time. Drop a
file named after the post's slug and the widget automatically swaps its
browser-read-aloud fallback for a real `<audio>` player — no code change needed.

```
public/audio/<post-slug>.mp3
```

The slug is the post's filename without extension, e.g.
`building-a-cited-rag-1-introduction.md` → `building-a-cited-rag-1-introduction.mp3`.

## Generating MP3s later

When you're ready to upgrade from browser TTS to produced narration, generate
one MP3 per post from a premium TTS API (OpenAI `tts-1` / `gpt-4o-mini-tts`,
ElevenLabs, or Cloudflare Workers AI), strip the markdown to plain text first,
and save the result here with the matching slug.
