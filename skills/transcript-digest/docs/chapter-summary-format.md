# Chapter Summary Format (shared)

Used by `youtube-transcript-digest`, `rutube-transcript-digest`, and `transcript-digest` — this is the single source of truth for the `chapters-summary.md` format. Each of those skills' `SKILL.md` links here instead of duplicating this spec; only source-specific wrinkles stay in the individual skill.

After `transcript.md` is finalized (speaker-labeled, chaptered), write `chapters-summary.md` in the same directory — an overall summary of the whole video/transcript, followed by one TLDR per chapter. Do this yourself (read the finished `transcript.md`, no separate sub-agent needed) unless the transcript is very long, in which case a sub-agent per chunk of chapters is fine (still have one of them, or yourself, write the TLDR block after all chapters are done). **Always** produce this file — it's the default final output, not an optional extra. Only skip it if the user explicitly says they just want the raw transcript.

Format:

```markdown
---
title: <title> — chapter summary
source: transcript.md
video: <video url>              # omit this field for transcript-digest (no source URL fetched)
speakers: <speaker names, or "(solo)">
chapters: derived               # only when the source carried no chapters of its own
---

# TLDR
3-7 sentence paragraph summarizing the entire video/transcript: the main topic, the key positions/claims, and the overall takeaway. Written from the whole transcript, not stitched from the per-chapter TLDRs below. If the transcript is long (roughly 8+ chapters), replace the paragraph with a bullet list of no more than 10 key-point sentences instead.

# Timecodes
One line per chapter, YouTube-description style, for navigation: `- <H:MM:SS> — <chapter title>`, hour not zero-padded (`0:00:00`, `1:30:38`), titles copied verbatim from the chapter headings below. Mechanical restatement of the chapter list — generate it after the chapters are final so the two can't drift. Omit the block only when the source had no timing data.

# TLDR by chapter

## [HH:MM:SS] <Chapter Title>
2-5 sentence paragraph: what actually happened/was said in this chapter, attributed to speakers where it matters (who argued what). Not a rephrased chapter title — pull the actual content, specific claims, examples, numbers.
- Optional 2-4 short bullets for the chapter's key takeaways or points of disagreement, when the chapter is dense enough to warrant it

## [HH:MM:SS] <Next Chapter Title>
...
```

Notes:
- `transcript-digest` (local files without fetched timestamps) formats headings as `## <Chapter Title> [HH:MM:SS]`, omitting the bracket entirely when the source transcript had no timing data.
- **If the source has no chapters of its own** (common on Rutube and for local files, and true of any YouTube video whose uploader wrote no `0:00 Title` list), derive them — do not fall back to one untimed blob. The model reads the *whole* transcript and splits it where the topic actually changes: one chapter per theme, a few minutes each, typically 5-20 for a full interview. Every chapter timestamp must be copied from a subtitle block that actually exists in the transcript — never invented, rounded or interpolated — and the first chapter starts at the first subtitle block. Mark the file `chapters: derived` in its frontmatter so a reader knows the boundaries are inferred.
  - `scripts/chunk-and-label.ts` does this for you (needs `TRANSCRIBE_PROFILE`, since the model must fit the whole transcript in one context; `--no-derive-chapters` opts out). Doing it by hand follows the same rules.
  - Only a genuinely short single-topic transcript (a few minutes, one subject) stays as one section.

Rules:
- The TLDR block comes first, before the per-chapter TLDR section, and stands on its own — someone reading only it should understand what the video/transcript was about. Keep it to a short paragraph, or if the transcript is long, no more than 10 key-point sentences. The Timecodes nav block sits between it and the per-chapter section.
- One `##` heading per chapter, matching the transcript's own chapter headings/timestamps exactly (same title, same `[HH:MM:SS]`)
- Summarize content, don't just restate the title — name the actual claims, examples, and speaker positions
- For multi-speaker debates/disagreements, attribute distinct positions to speakers by name
- Keep quotes short (a phrase, not a paragraph) and only when a direct quote is genuinely more useful than paraphrase — never reproduce long verbatim passages from the transcript
- Skip bullets for thin/transitional chapters (intro, outro, housekeeping) — a one-line paragraph is enough
- This file is a companion to `transcript.md`, not a replacement — link back via the shared `[HH:MM:SS]` timestamps (or chapter titles, if untimed) rather than duplicating full explanations
