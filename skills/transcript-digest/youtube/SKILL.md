---
name: youtube-transcript-digest
description: Downloads YouTube video transcripts/subtitles and cover images by URL or video ID, then always produces a per-chapter TLDR summary alongside the full transcript. Supports multiple languages, translation, chapters, and speaker identification. Caches raw data for fast re-formatting. Use when user asks to "get YouTube transcript", "summarize this video/podcast", "download subtitles", "get captions", "video subtitles", "chapter summary", "video thumbnail", "video cover image", or provides a YouTube URL and wants the transcript/subtitle text, a chapter summary, or cover image extracted. Prerequisite - bun; install with `curl -fsSL https://bun.sh/install | bash` or `npm i -g bun`, or run via `npx -y bun` if only npx is present.
version: 0.0.2
metadata:
  partOf: transcript-digest (sub-skill for YouTube sources; siblings are rutube and local in this same skill set)
  forkedFrom: baoyu-youtube-transcript (github.com/JimLiu/baoyu-skills)
  requires:
    anyBins:
      - bun
      - npx
---

# YouTube Transcript Digest

Downloads transcripts (subtitles/captions) from YouTube videos and, by default, produces a `chapters-summary.md` TLDR alongside the full transcript — not just the raw transcript. Works with both manually created and auto-generated transcripts. No API key or browser required — uses YouTube's InnerTube API directly and automatically falls back to `yt-dlp` when YouTube blocks the direct API path.

Fetches video metadata and cover image on first run, caches raw data for fast re-formatting.

Forked from `baoyu-youtube-transcript` — same fetch/format engine, but the output workflow always ends in a chapter-by-chapter summary, not just a formatted transcript.

## Script Directory

Scripts in `scripts/` subdirectory. `{baseDir}` = this SKILL.md's directory path. Resolve `${BUN_X}` runtime: if `bun` installed → `bun`; if `npx` available → `npx -y bun`; else suggest installing bun. Replace `{baseDir}` and `${BUN_X}` with actual values.

| Script | Purpose |
|--------|---------|
| `scripts/main.ts` | Transcript download CLI |

## Usage

```bash
# Default: markdown with timestamps (English)
${BUN_X} {baseDir}/scripts/main.ts <youtube-url-or-id>

# Specify languages (priority order)
${BUN_X} {baseDir}/scripts/main.ts <url> --languages zh,en,ja

# Without timestamps
${BUN_X} {baseDir}/scripts/main.ts <url> --no-timestamps

# With chapter segmentation
${BUN_X} {baseDir}/scripts/main.ts <url> --chapters

# With speaker identification (requires AI post-processing)
${BUN_X} {baseDir}/scripts/main.ts <url> --speakers

# SRT subtitle file
${BUN_X} {baseDir}/scripts/main.ts <url> --format srt

# Translate transcript
${BUN_X} {baseDir}/scripts/main.ts <url> --translate zh-Hans

# List available transcripts
${BUN_X} {baseDir}/scripts/main.ts <url> --list

# Force re-fetch (ignore cache)
${BUN_X} {baseDir}/scripts/main.ts <url> --refresh
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `<url-or-id>` | YouTube URL or video ID (multiple allowed) | Required |
| `--languages <codes>` | Language codes, comma-separated, in priority order | `en` |
| `--format <fmt>` | Output format: `text`, `srt` | `text` |
| `--translate <code>` | Translate to specified language code | |
| `--list` | List available transcripts instead of fetching | |
| `--timestamps` | Include `[HH:MM:SS → HH:MM:SS]` timestamps per paragraph | on |
| `--no-timestamps` | Disable timestamps | |
| `--chapters` | Chapter segmentation from video description | |
| `--speakers` | Raw transcript with metadata for speaker identification | |
| `--exclude-generated` | Skip auto-generated transcripts | |
| `--exclude-manually-created` | Skip manually created transcripts | |
| `--refresh` | Force re-fetch, ignore cached data | |
| `-o, --output <path>` | Save to specific file path | auto-generated |
| `--output-dir <dir>` | Base output directory | `tldr/youtube` |

## Optional Environment Variables

| Variable | Description |
|----------|-------------|
| `YOUTUBE_TRANSCRIPT_COOKIES_FROM_BROWSER` | Passed to `yt-dlp --cookies-from-browser` during fallback, e.g. `chrome`, `safari`, `firefox`, or `chrome:Profile 1` |

## Input Formats

Accepts any of these as video input:
- Full URL: `https://www.youtube.com/watch?v=dQw4w9WgXcQ`
- Short URL: `https://youtu.be/dQw4w9WgXcQ`
- Embed URL: `https://www.youtube.com/embed/dQw4w9WgXcQ`
- Shorts URL: `https://www.youtube.com/shorts/dQw4w9WgXcQ`
- Video ID: `dQw4w9WgXcQ`

## Output Formats

| Format | Extension | Description |
|--------|-----------|-------------|
| `text` | `.md` | Markdown with frontmatter (incl. `description`), title heading, summary, optional TOC/cover/timestamps/chapters/speakers |
| `srt` | `.srt` | SubRip subtitle format for video players |

## Output Directory

```
tldr/youtube/
├── .index.json                          # Video ID → directory path mapping (for cache lookup)
└── {channel-slug}/{title-full-slug}/
    ├── meta.json                        # Video metadata (title, channel, description, duration, chapters, etc.)
    ├── transcript-raw.json              # Raw transcript snippets from YouTube API (cached)
    ├── transcript-sentences.json        # Sentence-segmented transcript (split by punctuation, merged across snippets)
    ├── imgs/
    │   └── cover.jpg                    # Video thumbnail
    ├── transcript.md                    # Markdown transcript (generated from sentences)
    ├── transcript.srt                   # SRT subtitle (generated from raw snippets, if --format srt)
    └── chapters-summary.md              # Per-chapter TLDR (always produced — see Chapter Summary section)
```

- `{channel-slug}`: Channel name in kebab-case
- `{title-full-slug}`: Full video title in kebab-case

The `--list` mode outputs to stdout only (no file saved).

## Caching

On first fetch, the script saves:
- `meta.json` — video metadata, chapters, cover image path, language info
- `transcript-raw.json` — raw transcript snippets from YouTube API (`{ text, start, duration }[]`)
- `transcript-sentences.json` — sentence-segmented transcript (`{ text, start: "HH:mm:ss", end: "HH:mm:ss" }[]`), split by sentence-ending punctuation (`.?!…。？！` etc.), timestamps proportionally allocated by character length, CJK-aware text merging
- `imgs/cover.jpg` — video thumbnail

Subsequent runs for the same video use cached data (no network calls). Use `--refresh` to force re-fetch. If a different language is requested, the cache is automatically refreshed.

When YouTube returns anti-bot / blocked responses on the direct InnerTube path, the script retries with alternate client identities and then falls back to `yt-dlp` if available. If fallback is needed but `yt-dlp` is unavailable, **ask the user before installing it** (e.g. `uv tool install yt-dlp`) — do not install software autonomously.

SRT output (`--format srt`) is generated from `transcript-raw.json`. Text/markdown output uses `transcript-sentences.json` for natural sentence boundaries.

## Workflow

When user provides a YouTube URL and wants the transcript:

1. Run with `--list` first if the user hasn't specified a language, to show available options
2. **Always single-quote the URL** when running the script — zsh treats `?` as a glob wildcard, so an unquoted YouTube URL causes "no matches found": use `'https://www.youtube.com/watch?v=ID'`
3. Default: run with `--chapters --speakers` for the richest output (chapters + speaker identification)
4. The script auto-saves cached data + output file and prints the file path
5. Follow the speaker identification workflow below to post-process the raw file with speaker labels and chapter segmentation
6. **Always** follow the Chapter Summary workflow below to write `chapters-summary.md` next to `transcript.md` — this is the default final output of this skill, not an optional extra. Only skip it if the user explicitly says they just want the raw transcript.
7. **Always** finish with `${BUN_X} {baseDir}/../scripts/publish.ts <video-dir>` once `transcript.md` and `chapters-summary.md` are final. It writes `transcript.*` and `chapters-summary.*` in JSON, SRT, VTT, TSV, DOCX and PDF (plus a title-only `chapters.vtt` for a `<video>` chapter track) and uploads raw JSON, both `.md` files and every export to the object store (S3 when `S3_BUCKET` is set). DOCX/PDF need the repo's Python env (`uv sync`); without it they are skipped with a warning and the rest still uploads.

When user only wants a cover image or metadata, running the script with any option will also cache `meta.json` and `imgs/cover.jpg` — skip the summary step in that case, there's no transcript to summarize.

When re-formatting the same video (e.g., first text then SRT), the cached data is reused — no re-fetch needed. If `transcript.md` is already speaker-labeled and `chapters-summary.md` already exists, skip straight to reusing both.

## Chapter & Speaker Workflow

### Chapters (`--chapters`)

The script parses chapter timestamps from the video description (e.g., `0:00 Introduction`), segments the transcript by chapter boundaries, groups snippets into readable paragraphs, and saves as `.md` with a Table of Contents. No further processing needed.

If no chapter timestamps exist in the description (the uploader wrote no `0:00 Title` list), the raw output has no chapter headings — but the digest still gets chapters: `chunk-and-label.ts` sends the **whole** transcript to the model in one call, which splits it by theme and returns a chapter list. Every returned timestamp is snapped to a real subtitle-block start, so a derived chapter can never carry an invented time. The resulting `chapters-summary.md` is marked `chapters: derived` in its frontmatter.

Derivation needs a context budget, so `TRANSCRIBE_PROFILE` (or `TRANSCRIBE_CONTEXT_TOKENS`) must be set — see "Choosing a profile" below. `--no-derive-chapters` opts out and falls back to one whole-transcript section. If the transcript is too large for the profile's context the run fails with a clear message rather than deriving chapters from a truncated read: raise the profile.

### Speaker Identification (`--speakers`)

Follow `{baseDir}/../docs/speaker-identification.md` for the full process — it's shared with the `rutube` and `local` sub-skills in this same `transcript-digest/` skill set. In step 2 of that doc, the prompt template lives at `{baseDir}/../prompts/speaker-transcript.md`.

When `--speakers` is used, `--chapters` is implied — the processed output always includes chapter segmentation.

## Chapter Summary (default output)

**Always** produce `chapters-summary.md` next to `transcript.md`. Only skip it if the user explicitly says they just want the raw transcript.

**Prefer the script** — it writes the format for you, and derives chapters when the source has none:

```bash
${BUN_X} {baseDir}/../scripts/chunk-and-label.ts <videoDir> --mode summary
```

**If you write the file yourself, read the format spec FIRST** — before writing a single line of summary, open `{baseDir}/../docs/chapter-summary-format.md` (one file read; it is one directory *above* this skill, shared with the `rutube` and `local` sub-skills) and follow it exactly. A summary without a `# TLDR` block and a `[HH:MM:SS]` timestamp on every chapter heading is not this file, no matter how good the prose is.

**Model size floor:** do not drive this workflow with a model below ~27B (Qwen 27B / Gemma 30B are the tested floor). Smaller models paraphrase instead of transcribing verbatim, drift into English on non-English transcripts, and mangle the response markers — all silently. See `{baseDir}/../docs/speaker-identification.md` § "Model size floor".

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
| Transcripts disabled | Video has no captions at all |
| No transcript found | Requested language not available |
| Video unavailable | Video deleted, private, or region-locked |
| IP blocked | Too many requests, try again later |
| Age restricted | Video requires login for age verification |
| bot detected | The script retries alternate clients and then `yt-dlp`; if fallback tooling is missing, the agent should resolve that itself, otherwise if it still fails try `YOUTUBE_TRANSCRIPT_COOKIES_FROM_BROWSER=safari` (or your browser) |
