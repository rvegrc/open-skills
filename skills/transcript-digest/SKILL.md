---
name: transcript-digest
description: Entry point for turning any video, podcast or transcript file into a speaker-labeled transcript plus a per-chapter TLDR summary. Routes to the right sub-skill by source - youtube-transcript-digest for YouTube URLs, rutube-transcript-digest for rutube.ru URLs, local-transcript-digest for a transcript file the user already has. Use when the user asks to "get a transcript", "summarize this video/podcast", "download subtitles or captions", "identify speakers", "split a transcript into chapters", or provides a video URL or transcript file and wants the text, a chapter summary, or the cover image. Prerequisite - bun; install with `curl -fsSL https://bun.sh/install | bash` or `npm i -g bun`.
version: 0.0.2
metadata:
  partOf: transcript-digest (this is the parent index; the three sub-skills below do the work)
---

# Transcript Digest

One skill set, three independently-triggered sub-skills, one output shape: a speaker-labeled
`transcript.md` and a `chapters-summary.md` TLDR beside it.

## Pick the sub-skill by source

| Source the user gives | Sub-skill | Path |
|---|---|---|
| YouTube URL or video id | `youtube-transcript-digest` | [`youtube/SKILL.md`](youtube/SKILL.md) |
| rutube.ru URL or video id | `rutube-transcript-digest` | [`rutube/SKILL.md`](rutube/SKILL.md) |
| A transcript file the user already has (SRT/VTT/txt/md, or pasted text you save to a file) | `local-transcript-digest` | [`local/SKILL.md`](local/SKILL.md) |

Read the chosen sub-skill's `SKILL.md` and follow it. Do not mix them: each is self-contained,
with its own `scripts/` and its own tests, so any one can be lifted out standalone.

## What every sub-skill shares

Convention lives at this level; code does not (except the orchestrator below).

| Shared file | What it defines |
|---|---|
| [`docs/chapter-summary-format.md`](docs/chapter-summary-format.md) | The exact `chapters-summary.md` format all three produce |
| [`docs/speaker-identification.md`](docs/speaker-identification.md) | The `--speakers` workflow, the model size floor, term normalization |
| [`docs/security-contract.md`](docs/security-contract.md) | What the code guarantees about untrusted metadata and transcript text — and what it does not |
| [`prompts/speaker-transcript.md`](prompts/speaker-transcript.md) | The prompt template used for speaker labeling |
| [`scripts/chunk-and-label.ts`](scripts/chunk-and-label.ts) | Source-agnostic orchestrator: drives any model over the cached transcript |
| [`scripts/profiles.ts`](scripts/profiles.ts) | Model capability profiles — how many chapters fit one request |
| [`scripts/publish.ts`](scripts/publish.ts) | Final step: exports `transcript` and `chapters-summary` to JSON, SRT, VTT, TSV, DOCX and PDF (plus a title-only `chapters.vtt`) and uploads everything to the object store |
| [`scripts/formats.ts`](scripts/formats.ts) | Pure JSON/SRT/VTT/TSV builders with cue- and cell-text escaping |
| [`scripts/documents.py`](scripts/documents.py) | DOCX + PDF from the `.md` files; Python deps come from the repo `pyproject.toml` (`uv sync`) |

## The two ways to produce the output

1. **Agent-driven (default, fastest).** After the sub-skill's `main.ts` caches the raw transcript,
   do the speaker labeling and the chapter summary yourself, or with sub-agents split by chapter
   group. See `docs/speaker-identification.md`.
2. **Script-driven (portable).** `scripts/chunk-and-label.ts` drives any OpenAI-compatible endpoint,
   or an authenticated CLI, from a `.env` file — for local models, non-Claude models, or unattended
   runs. `--mode summary` writes only the summary; `--mode label` only the transcript.

## Model size floor

Do not drive any of this with a model below ~27B (Qwen 27B / Gemma 30B are the tested floor).
Smaller models paraphrase instead of transcribing verbatim, drift into English on non-English
transcripts, and mangle the response markers — all silently. See
[`docs/speaker-identification.md`](docs/speaker-identification.md) § "Model size floor".

## Source layout

This skill set is edited in `.agents/skills/transcript-digest/` (where the tests run).
Run tests from a sub-skill's `scripts/` directory with `bun test`.
