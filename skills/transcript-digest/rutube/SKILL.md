---
name: rutube-transcript-digest
description: Downloads Rutube (rutube.ru) video transcripts/subtitles and cover images by URL or video ID, then always produces a per-chapter TLDR summary alongside the full transcript. Supports multiple languages (subtitles are usually Russian only), speaker identification, and caches raw data for fast re-formatting. Use when user asks to "get Rutube transcript", "summarize this Rutube video", "download subtitles from rutube.ru", "get captions" for a Rutube link, or provides a rutube.ru URL and wants the transcript/subtitle text, a chapter summary, or cover image extracted. Prerequisite - bun and yt-dlp; install bun with `curl -fsSL https://bun.sh/install | bash` or `npm i -g bun` (or run via `npx -y bun`), and yt-dlp with `uv tool install yt-dlp`.
version: 0.0.2
metadata:
  partOf: transcript-digest (sub-skill for Rutube sources; siblings are youtube and local in this same skill set)
  requires:
    anyBins:
      - bun
      - npx
    externalTools:
      - yt-dlp
---

# Rutube Transcript Digest

Downloads transcripts (subtitles) from Rutube videos and, by default, produces a `chapters-summary.md` TLDR alongside the full transcript — not just the raw transcript. Sibling skill to `youtube-transcript-digest`, same output shape and workflow, but sourced from Rutube.

Rutube has no public InnerTube-style API like YouTube, so unlike the YouTube skill (where `yt-dlp` is only a fallback), here `yt-dlp` is the *only* and *primary* source — every fetch shells out to it (`yt-dlp -J --skip-download`) to get video metadata and subtitle track URLs, then the subtitle file itself is fetched directly with plain HTTP. `yt-dlp` is required — there's no code path that works without it.

Most Rutube videos have no subtitles at all (unlike YouTube, auto-captions aren't universal); when they exist they're almost always Russian, and are often labeled "Авто" (auto-generated) even though yt-dlp lists them under `subtitles` rather than `automatic_captions` — the script detects this from the label. Rutube also doesn't expose chapter markers as a distinct field, so chapters are parsed from timestamp lines in the description (`0:00 Intro`), same heuristic as the YouTube skill — most videos won't have any.

Fetches video metadata and cover image on first run, caches raw data for fast re-formatting.

## Script Directory

Scripts in `scripts/` subdirectory. `{baseDir}` = this SKILL.md's directory path. Resolve `${BUN_X}` runtime: if `bun` installed → `bun`; if `npx` available → `npx -y bun`; else suggest installing bun. Replace `{baseDir}` and `${BUN_X}` with actual values.

| Script | Purpose |
|--------|---------|
| `scripts/main.ts` | Transcript download CLI |

## Usage

```bash
# Default: markdown with timestamps (Russian)
${BUN_X} {baseDir}/scripts/main.ts <rutube-url-or-id>

# Without timestamps
${BUN_X} {baseDir}/scripts/main.ts <url> --no-timestamps

# With chapter segmentation (only useful if description has timestamp lines)
${BUN_X} {baseDir}/scripts/main.ts <url> --chapters

# With speaker identification (requires AI post-processing)
${BUN_X} {baseDir}/scripts/main.ts <url> --speakers

# SRT subtitle file
${BUN_X} {baseDir}/scripts/main.ts <url> --format srt

# List available transcripts (check before assuming subtitles exist)
${BUN_X} {baseDir}/scripts/main.ts <url> --list

# Force re-fetch (ignore cache)
${BUN_X} {baseDir}/scripts/main.ts <url> --refresh
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `<url-or-id>` | Rutube URL or 32-char hex video ID (multiple allowed) | Required |
| `--languages <codes>` | Language codes, comma-separated, in priority order | `ru` |
| `--format <fmt>` | Output format: `text`, `srt` | `text` |
| `--list` | List available transcripts instead of fetching | |
| `--timestamps` | Include `[HH:MM:SS → HH:MM:SS]` timestamps per paragraph | on |
| `--no-timestamps` | Disable timestamps | |
| `--chapters` | Chapter segmentation from video description | |
| `--speakers` | Raw transcript with metadata for speaker identification | |
| `--exclude-generated` | Skip auto-generated ("Авто") transcripts | |
| `--exclude-manually-created` | Skip manually created transcripts | |
| `--refresh` | Force re-fetch, ignore cached data | |
| `-o, --output <path>` | Save to specific file path | auto-generated |
| `--output-dir <dir>` | Base output directory | `tldr/rutube` |

There's no `--translate` option — Rutube subtitle tracks don't carry translation metadata the way YouTube's do.

## Input Formats

Accepts any of these as video input:
- Full URL: `https://rutube.ru/video/e90a357bf1fa4f01db64b358ee06c1d7/`
- Embed URL: `https://rutube.ru/play/embed/e90a357bf1fa4f01db64b358ee06c1d7`
- Private-link URL: `https://rutube.ru/video/private/e90a357bf1fa4f01db64b358ee06c1d7/`
- Video ID: `e90a357bf1fa4f01db64b358ee06c1d7` (32-char hex)

## Output Formats

| Format | Extension | Description |
|--------|-----------|-------------|
| `text` | `.md` | Markdown with frontmatter (incl. `description`), title heading, summary, optional TOC/cover/timestamps/chapters/speakers |
| `srt` | `.srt` | SubRip subtitle format for video players |

## Output Directory

```
tldr/rutube/
├── .index.json                          # Video ID → directory path mapping (for cache lookup)
└── {channel-slug}/{title-full-slug}/
    ├── meta.json                        # Video metadata (title, channel, description, duration, chapters, etc.)
    ├── transcript-raw.json              # Raw transcript snippets (cached)
    ├── transcript-sentences.json        # Sentence-segmented transcript (split by punctuation, merged across snippets)
    ├── imgs/
    │   └── cover.jpg                    # Video thumbnail
    ├── transcript.md                    # Markdown transcript (generated from sentences)
    ├── transcript.srt                   # SRT subtitle (generated from raw snippets, if --format srt)
    └── chapters-summary.md              # Per-chapter TLDR (always produced — see Chapter Summary section)
```

- `{channel-slug}` / `{title-full-slug}`: kebab-case, Cyrillic-aware (Russian titles are transliterated to lowercase-with-hyphens, not stripped)

The `--list` mode outputs to stdout only (no file saved).

## Caching

On first fetch, the script saves:
- `meta.json` — video metadata, chapters, cover image path, language info
- `transcript-raw.json` — raw transcript snippets (`{ text, start, duration }[]`)
- `transcript-sentences.json` — sentence-segmented transcript (`{ text, start: "HH:mm:ss", end: "HH:mm:ss" }[]`), split by sentence-ending punctuation, timestamps proportionally allocated by character length
- `imgs/cover.jpg` — video thumbnail

Subsequent runs for the same video use cached data (no network calls). Use `--refresh` to force re-fetch. If a different language is requested, the cache is automatically refreshed.

If `yt-dlp` isn't installed, the script errors immediately and tells the user to install it (e.g. `uv tool install yt-dlp`) — **ask the user before installing it yourself**, do not install software autonomously.

SRT output (`--format srt`) is generated from `transcript-raw.json`. Text/markdown output uses `transcript-sentences.json` for natural sentence boundaries.

## Workflow

When user provides a Rutube URL and wants the transcript:

1. Run with `--list` first — Rutube subtitles are far less universal than YouTube's, so confirm a transcript actually exists before promising one
2. **Always single-quote the URL** when running the script — zsh treats `?` as a glob wildcard, and Rutube URLs can carry query strings
3. Default: run with `--chapters --speakers` for the richest output; note chapters will usually come back empty since most Rutube descriptions have no timestamp lines
4. The script auto-saves cached data + output file and prints the file path
5. Follow the speaker identification workflow below to post-process the raw file with speaker labels and chapter segmentation
6. **Always** follow the Chapter Summary workflow below to write `chapters-summary.md` next to `transcript.md` — this is the default final output of this skill, not an optional extra. Only skip it if the user explicitly says they just want the raw transcript.
7. **Always** finish with `${BUN_X} {baseDir}/../scripts/publish.ts <video-dir>` once `transcript.md` and `chapters-summary.md` are final. It writes `transcript.*` and `chapters-summary.*` in JSON, SRT, VTT, TSV, DOCX and PDF (plus a title-only `chapters.vtt` for a `<video>` chapter track) and uploads raw JSON, both `.md` files and every export to the object store (S3 when `S3_BUCKET` is set). DOCX/PDF need the repo's Python env (`uv sync`); without it they are skipped with a warning and the rest still uploads.

When user only wants a cover image or metadata, running the script with any option will also cache `meta.json` and `imgs/cover.jpg` — skip the summary step in that case, there's no transcript to summarize.

When re-formatting the same video (e.g., first text then SRT), the cached data is reused — no re-fetch needed. If `transcript.md` is already speaker-labeled and `chapters-summary.md` already exists, skip straight to reusing both.

## Chapter & Speaker Workflow

### Chapters (`--chapters`)

The script parses chapter timestamps from the video description (e.g., `0:00 Введение`), segments the transcript by chapter boundaries, groups snippets into readable paragraphs, and saves as `.md` with a Table of Contents. No further processing needed. Most Rutube videos don't have this in the description, so expect ungrouped paragraphs by default — that's normal, not a bug.

### Speaker Identification (`--speakers`)

Follow `{baseDir}/../docs/speaker-identification.md` for the full process — it's shared with the `youtube` and `local` sub-skills in this same `transcript-digest/` skill set. In step 2 of that doc, the prompt template lives at `{baseDir}/../prompts/speaker-transcript.md`.

When `--speakers` is used, `--chapters` is implied — the processed output always includes chapter segmentation.

## Chapter Summary (default output)

**Always** produce `chapters-summary.md` next to `transcript.md`. Only skip it if the user explicitly says they just want the raw transcript.

**Prefer the script** — it writes the format for you, and derives chapters when the source has none:

```bash
${BUN_X} {baseDir}/../scripts/chunk-and-label.ts <videoDir> --mode summary
```

**If you write the file yourself, read the format spec FIRST** — before writing a single line of summary, open `{baseDir}/../docs/chapter-summary-format.md` (one file read; it is one directory *above* this skill, shared with the `youtube` and `local` sub-skills) and follow it exactly. A summary without a `# TLDR` block and a `[HH:MM:SS]` timestamp on every chapter heading is not this file, no matter how good the prose is.

Reminder specific to Rutube: most videos have no chapter timestamps in the description, so chapter derivation is the normal path here, not the exception — the model reads the whole transcript and splits it by theme, with every timestamp snapped to a real subtitle block. Needs `TRANSCRIBE_PROFILE`; the resulting file is marked `chapters: derived`.

**Model size floor:** do not drive this workflow with a model below ~27B (Qwen 27B / Gemma 30B are the tested floor). Smaller models paraphrase instead of transcribing verbatim, drift into English on non-English transcripts, and mangle the response markers — all silently. That last risk is sharpest here: Rutube transcripts are almost always Russian. See `{baseDir}/../docs/speaker-identification.md` § "Model size floor".

### How the overall TLDR is derived

The file opens with a `# TLDR` block, then one TLDR per chapter. Where the top block comes from depends on how much of the transcript fits one model context:

| Profile | Context | Calls | Overall TLDR written from |
|---------|---------|-------|---------------------------|
| `sonnet`, `opus` | 200k | 1 | the whole transcript, directly |
| `gpt`, `deepseek` | 128k | 1 | the whole transcript, directly |
| `qwen-27b`, `gemma-30b` | 32k | k + 1 | **the per-chapter TLDRs** (one reduce call) |
| unset | — | per chapter | the per-chapter TLDRs |

Per-chapter TLDRs are always written from actual transcript text, never from other summaries. Only the overall TLDR is reduced from chapter TLDRs, and only when the transcript did not fit a single context.

### Choosing a profile

`--mode summary` requires `TRANSCRIBE_PROFILE` (or `TRANSCRIBE_CONTEXT_TOKENS`). If it is not set, **ask the user which model they are running** and set the matching profile — do not guess. A profile larger than the real context makes the model silently truncate the transcript; a smaller one only costs extra calls, so when the user is unsure, prefer the smaller profile.

## Error Cases

| Error | Meaning |
|-------|---------|
| Transcripts disabled | Video has no subtitle tracks at all — very common on Rutube, always check with `--list` first |
| No transcript found | Requested language not available (subtitles are almost always `ru` only) |
| Video unavailable | Video deleted or the ID/URL is wrong |
| Video private | Video requires login/access the current session doesn't have |
| yt-dlp unavailable | `yt-dlp` isn't installed — ask the user before installing it, this skill has no fallback path without it |
