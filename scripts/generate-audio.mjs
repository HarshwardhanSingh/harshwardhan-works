// Generate podcast-quality narration MP3s for published blog posts.
//
//   OPENAI_API_KEY=sk-... node scripts/generate-audio.mjs        # changed posts only
//   OPENAI_API_KEY=sk-... node scripts/generate-audio.mjs --force # regenerate all
//
// For each non-draft post under src/content/blog, this:
//   1. strips the markdown to clean, speakable narration text,
//   2. splits it under the TTS input limit (paragraph-aware),
//   3. calls OpenAI gpt-4o-mini-tts per chunk and concatenates the audio,
//   4. writes public/audio/<slug>.mp3.
//
// A content hash is cached in scripts/.audio-cache.json so a rerun only
// regenerates posts whose narration (or voice settings) actually changed.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const POSTS_DIR = join(ROOT, "src/content/blog");
const OUT_DIR = join(ROOT, "public/audio");
const CACHE_FILE = join(__dirname, ".audio-cache.json");

// Voice settings. Override via env; changing any of these invalidates the cache.
const MODEL = process.env.AUDIO_MODEL || "gpt-4o-mini-tts";
const VOICE = process.env.AUDIO_VOICE || "alloy";
const INSTRUCTIONS =
	process.env.AUDIO_INSTRUCTIONS ||
	"Speak as a calm, clear, friendly technical narrator reading a blog post aloud. " +
		"Natural pacing with light warmth; explain, don't perform. Avoid sounding robotic.";

// OpenAI caps TTS input length; stay comfortably under it and split on paragraphs.
const MAX_CHARS = 3500;

const FORCE = process.argv.includes("--force");
// Preview the narration text + cost without calling the API (no key needed).
const DRY = process.argv.includes("--dry");

// ---- Markdown -> speakable text ------------------------------------------------

function parseFrontmatter(raw) {
	const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
	if (!m) return { data: {}, body: raw };
	const data = {};
	for (const line of m[1].split(/\r?\n/)) {
		const kv = line.match(/^(\w+):\s*(.*)$/);
		if (kv) data[kv[1]] = kv[2].trim();
	}
	return { data, body: raw.slice(m[0].length) };
}

function mdToSpeech(md, title) {
	md = md
		.replace(/```[\s\S]*?```/g, "") // fenced code blocks
		.replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links -> text
		.replace(/`([^`]+)`/g, "$1") // inline code -> text
		.replace(/(\*\*|__|\*|_|~~)/g, ""); // bold/italic/strike markers

	const lines = md.split(/\r?\n/);
	const out = [];
	for (let i = 0; i < lines.length; ) {
		let line = lines[i];

		// Blockquote block — drop the series-nav and checkpoint callouts, keep
		// genuine pull-quotes (with their `>` markers stripped).
		if (/^\s*>/.test(line)) {
			const block = [];
			while (i < lines.length && /^\s*>/.test(lines[i])) {
				block.push(lines[i].replace(/^\s*>\s?/, ""));
				i++;
			}
			const text = block.join(" ").trim();
			if (text && !/build-in-public series|you are here|checkpoint/i.test(text)) {
				out.push(text);
			}
			continue;
		}

		// Table rows and separators read terribly — skip.
		if (/^\s*\|.*\|\s*$/.test(line) || /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line)) {
			i++;
			continue;
		}

		// Headings -> a spoken sentence.
		const h = line.match(/^\s{0,3}#{1,6}\s+(.*)$/);
		if (h) {
			const t = h[1].replace(/[#*`]/g, "").trim();
			if (t) out.push(t.replace(/[.!?:]+$/, "") + ".");
			i++;
			continue;
		}

		// Horizontal rules.
		if (/^\s*(-{3,}|_{3,}|\*{3,})\s*$/.test(line)) {
			i++;
			continue;
		}

		// List markers -> plain lines.
		line = line.replace(/^\s*[-*+]\s+/, "").replace(/^\s*\d+\.\s+/, "");
		out.push(line);
		i++;
	}

	let text = (title ? title.replace(/[.!?:]+$/, "") + ". \n\n" : "") + out.join("\n");

	// Read symbols and abbreviations the way a person would.
	text = text
		.replace(/₹\s?([\d,]+(?:\.\d+)?)/g, "$1 rupees")
		.replace(/%/g, " percent")
		.replace(/→/g, " to ")
		.replace(/≠/g, " is not ")
		.replace(/&/g, " and ")
		.replace(/\be\.g\.\s*/gi, "for example, ")
		.replace(/\bi\.e\.\s*/gi, "that is, ")
		.replace(/\betc\.\s*/gi, "and so on. ")
		.replace(/\bvs\.\s*/gi, "versus ");

	// Normalize blank lines into clean paragraphs.
	return text
		.split(/\n{2,}/)
		.map((p) => p.replace(/\s+/g, " ").trim())
		.filter(Boolean)
		.join("\n\n");
}

// Split into chunks under MAX_CHARS, preferring paragraph then sentence breaks.
function chunkForTTS(text) {
	const paras = text.split(/\n{2,}/);
	const chunks = [];
	let buf = "";
	const flush = () => {
		if (buf.trim()) chunks.push(buf.trim());
		buf = "";
	};
	for (const para of paras) {
		if (para.length > MAX_CHARS) {
			flush();
			const sentences = para.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) || [para];
			for (const s of sentences) {
				if (buf && (buf + " " + s).length > MAX_CHARS) flush();
				buf += (buf ? " " : "") + s;
			}
			flush();
			continue;
		}
		if (buf && (buf + "\n\n" + para).length > MAX_CHARS) flush();
		buf += (buf ? "\n\n" : "") + para;
	}
	flush();
	return chunks;
}

// ---- TTS -----------------------------------------------------------------------

async function synthesize(input) {
	const res = await fetch("https://api.openai.com/v1/audio/speech", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: MODEL,
			voice: VOICE,
			input,
			instructions: INSTRUCTIONS,
			response_format: "mp3",
		}),
	});
	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(`OpenAI TTS ${res.status}: ${body.slice(0, 400)}`);
	}
	return Buffer.from(await res.arrayBuffer());
}

// ---- Main ----------------------------------------------------------------------

function loadCache() {
	try {
		return JSON.parse(readFileSync(CACHE_FILE, "utf8"));
	} catch {
		return {};
	}
}

async function main() {
	if (!DRY && !process.env.OPENAI_API_KEY) {
		console.error("Missing OPENAI_API_KEY. Run: OPENAI_API_KEY=sk-... npm run audio");
		process.exit(1);
	}
	if (!DRY && !existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

	const cache = loadCache();
	const files = readdirSync(POSTS_DIR).filter((f) => /\.mdx?$/.test(f));
	let generated = 0;
	let skipped = 0;
	let totalChars = 0;

	for (const file of files) {
		const slug = file.replace(/\.mdx?$/, "");
		const raw = readFileSync(join(POSTS_DIR, file), "utf8");
		const { data, body } = parseFrontmatter(raw);
		if (String(data.draft) === "true") {
			console.log(`· skip (draft)   ${slug}`);
			continue;
		}

		const title = (data.title || "").replace(/^["']|["']$/g, "");
		const speech = mdToSpeech(body, title);

		if (DRY) {
			const chunks = chunkForTTS(speech);
			totalChars += speech.length;
			console.log(`\n── ${slug} — ${speech.length} chars, ${chunks.length} chunk(s)`);
			console.log(`   ${speech.slice(0, 240).replace(/\n+/g, " ")}…`);
			continue;
		}

		const mp3Path = join(OUT_DIR, `${slug}.mp3`);
		const hash = createHash("sha256")
			.update(`${MODEL}|${VOICE}|${INSTRUCTIONS}|${speech}`)
			.digest("hex");

		if (!FORCE && cache[slug] === hash && existsSync(mp3Path)) {
			console.log(`· up to date     ${slug}`);
			skipped++;
			continue;
		}

		const chunks = chunkForTTS(speech);
		process.stdout.write(`▶ generating     ${slug} (${chunks.length} chunk(s))… `);
		const buffers = [];
		for (const chunk of chunks) buffers.push(await synthesize(chunk));
		writeFileSync(mp3Path, Buffer.concat(buffers));
		cache[slug] = hash;
		writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2) + "\n");
		generated++;
		console.log("done");
	}

	if (DRY) {
		// gpt-4o-mini-tts is billed per input character (~$0.60 / 1M chars).
		const est = (totalChars / 1_000_000) * 0.6;
		console.log(`\n${totalChars} narration chars total — est. ≈ $${est.toFixed(3)} to generate all.`);
		return;
	}

	console.log(`\n${generated} generated, ${skipped} unchanged. → public/audio/`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
