---
name: local-transcript-digest
description: Turns a transcript the user already has as a local file (not fetched by another skill) into a speaker-diarized, chaptered summary — same output shape as the youtube and rutube sub-skills, but for transcripts obtained by any other means (manual transcription, another tool's export, a pasted document, an SRT/VTT file downloaded separately). Use this whenever the user says things like "I have a transcript file, analyze/summarize/diarize it", "here's a transcript, split it into chapters and identify speakers", or pastes/points to transcript text without a YouTube or Rutube URL to fetch from. Do NOT use this if the user gives a YouTube or Rutube URL — use the youtube or rutube sub-skill instead, which fetch the transcript themselves.
version: 0.0.2
metadata:
  partOf: transcript-digest (sub-skill for local-file sources; siblings are youtube and rutube in this same skill set)
  requires:
    anyBins:
      - bun
      - npx
---

# Transcript Digest

Takes a transcript the user already has — as a file, or pasted text you save to a file — and runs it through the same speaker-diarization + chapter-segmentation + chapter-summary pipeline as `youtube-transcript-digest` and `rutube-transcript-digest`. No fetching, no video platform involved; this is the "I already have the text" entry point into that shared workflow.

## When the user has a transcript but no file yet

If the user pastes transcript text directly into the conversation instead of giving a file path, save it to a file first (e.g. under the scratchpad directory, or `transcript-digest/` in the project if it should persist) before running the script — the script only reads local files.

## Script Directory

Scripts in `scripts/` subdirectory. `{baseDir}` = this SKILL.md's directory path. Resolve `${BUN_X}` runtime: if `bun` installed → `bun`; if `npx` available → `npx -y bun`; else suggest installing bun. Replace `{baseDir}` and `${BUN_X}` with actual values.

| Script | Purpose |
|--------|---------|
| `scripts/main.ts` | Transcript ingestion CLI — parses the file, writes a raw markdown file ready for AI post-processing |

## Usage

```bash
${BUN_X} {baseDir}/scripts/main.ts <transcript-file> [--title "..."] [--channel "..."] [--url "..."] [--date YYYY-MM-DD]
```

| Option | Description |
|--------|-------------|
| `<transcript-file>` | Path to the local transcript file. Required. |
| `--title <text>` | Video/episode title, used for the output filename and frontmatter. Defaults to the input filename. |
| `--channel <text>` | Channel/author/podcast name, if known — helps speaker identification. |
| `--url <text>` | Source URL, for reference only (not fetched). |
| `--date <YYYY-MM-DD>` | Publish date, if known. |
| `-o, --output <path>` | Save to a specific file path instead of the auto-generated one. |
| `--output-dir <dir>` | Base output directory (default: `tldr/local`). |

Ask the user for title/channel/date if they're known and easy to get (e.g. from a Rutube/YouTube URL they mention alongside the file) — it meaningfully helps the speaker-identification step below. Don't block on it though; all fields are optional.

## Format detection

The script sniffs the file's *content*, not its extension. If it looks like SRT, WebVTT, YouTube's `json3`, YouTube's caption XML, or an ASR diarization export with one `[HH:MM:SS → HH:MM:SS] [speaker_N] text` block per line, it's parsed into timestamped snippets, sentence-segmented, and written as a frontmatter + raw-SRT markdown file — exactly the same intermediate shape the video-transcript skills produce with `--speakers`. If none of those formats match, the script falls back to treating the whole file as plain prose: no timestamps, just the raw text wrapped in frontmatter, ready for the AI to work on directly.

Either way, the script's job stops at "clean input file for the AI to process" — it does not do the diarization or chaptering itself.

## Workflow

1. Run the script on the input file. It prints the path to the saved raw `transcript.md`.
2. Read that file's prompt template at `{baseDir}/../prompts/speaker-transcript.md` (one directory above this skill, shared with the `youtube` and `rutube` sub-skills) and follow it to post-process the raw transcript into a speaker-labeled, chaptered version:
   - If the raw file has timestamps (SRT block), identify speakers from context (title, channel, description if given, conversational cues) and segment into chapters by topic shift.
   - If the raw file is plain prose (no timestamps), do the same speaker identification and chapter segmentation, just omit the `[HH:MM:SS → HH:MM:SS]` markers since there's no timing data to anchor them to.
   - **Normalization is the default — do not wait for the user to ask for it.** Assume a local transcript file is raw ASR output (mid-sentence block cuts, broken words, garbled terms, heavy fillers) and post-process it as a **normalization pass**, not verbatim re-emission — see "Transcription Fidelity" in the prompt template. Verbatim re-emission of a garbled source just copies the input with chapter headings, which adds no value; produce verbatim only when the user explicitly asks for it.
   - For a transcript with no external metadata at all (no title/channel/url given), lean entirely on the conversation's internal cues — who's asking questions vs answering, name mentions, topic shifts — same as the video skills do when the description is thin.
   - For genuinely long transcripts, a sub-agent per chunk is fine, same as the video skills.
3. Overwrite the `.md` file with the processed transcript (keep the frontmatter).
4. **Always** follow the Chapter Summary workflow below to write `chapters-summary.md` next to `transcript.md`, unless the user explicitly says they just want the raw transcript. This is the default final output, not an optional extra.
5. **Always** finish with `${BUN_X} {baseDir}/../scripts/publish.ts <video-dir>` once `transcript.md` and `chapters-summary.md` are final. It writes `transcript.*` and `chapters-summary.*` in JSON, SRT, VTT, TSV, DOCX and PDF (plus a title-only `chapters.vtt` for a `<video>` chapter track) and uploads raw JSON, both `.md` files and every export to the object store (S3 when `S3_BUCKET` is set). DOCX/PDF need the repo's Python env (`uv sync`); without it they are skipped with a warning and the rest still uploads.

### Term normalization (Russian-language transcripts)

See `{baseDir}/../docs/speaker-identification.md` for the shared term-normalization rule (swap phonetic transliterations of English tech terms back to English, keep the rest of the sentence in the source language) — same rule applies here regardless of source language.

## Chapter Summary (default output)

**Always** produce `chapters-summary.md` next to `transcript.md`. Only skip it if the user explicitly says they just want the raw transcript.

**Prefer the script** — it writes the format for you, and derives chapters when the source has none:

```bash
${BUN_X} {baseDir}/../scripts/chunk-and-label.ts <transcript.md> --mode summary
```

**If you write the file yourself, read the format spec FIRST** — before writing a single line of summary, open `{baseDir}/../docs/chapter-summary-format.md` (one file read; it is one directory *above* this skill, shared with the `youtube` and `rutube` sub-skills) and follow it exactly. A summary without a `# TLDR` block and a chapter-per-theme breakdown is not this file, no matter how good the prose is.

Reminders specific to this skill: headings are `## <Chapter Title> [HH:MM:SS]`, omitting the bracket entirely when the source had no timing data. A local transcript almost never carries chapters of its own, so derive them — the model reads the whole transcript and splits it by theme, with every timestamp snapped to a real subtitle block (needs `TRANSCRIBE_PROFILE`; the file is then marked `chapters: derived`). An untimed source gets themed chapters with no timestamps at all rather than one undifferentiated blob.

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
