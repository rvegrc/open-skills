# Security Contract — transcript-digest skills

Applies to the three sub-skills — `youtube/`, `rutube/`, `local/` — of the `transcript-digest` skill set. These skills ingest **untrusted, attacker-influenced text**: a video title, channel name, description, or transcript is set by whoever uploaded the video, not by the person running the skill. This document pins down what the code guarantees about handling that text, and what it deliberately does not guarantee.

Important layout note: the fetch/format engine is **not** shared code — each sub-skill keeps its own copy of `scripts/shared.ts` (holds `slugify` + the URL/video-ID regexes) and `scripts/transcript.ts` (holds `yamlEscape` + `formatMarkdown`), deliberately, so any one sub-skill is liftable standalone (see the repo `CLAUDE.md`). Each guarantee below is therefore enforced **per copy**: each sub-skill has its own `scripts/security.test.ts` (plus `shared-utils.test.ts` / `transcript.test.ts`), and its own mutation-testing config at the repo root — `stryker.youtube.conf.json`, `stryker.rutube.conf.json`, `stryker.local.conf.json` — that mutates only that copy's `shared.ts`/`transcript.ts` and re-runs only that copy's tests. A green run on one says nothing about the others.

The one genuinely **shared** script is the source-agnostic post-processing orchestrator `transcript-digest/scripts/chunk-and-label.ts` (drives a model over already-cached output to write the speaker-labeled `transcript.md` + `chapters-summary.md`). It carries almost no security surface — see "Shared orchestrator" below — and is covered by its own `transcript-digest/scripts/security.test.ts` and `stryker.shared.conf.json`.

## Threat model

Untrusted input: video title, channel name, description, chapter list, and transcript/caption text — all attacker-controlled at the source (YouTube/Rutube), reaching this code over the network or via a user-supplied local file.

Trusted input: CLI flags, output paths, and anything the person invoking the skill types directly — the same trust level as running any other local script.

## Guarantees

1. **No frontmatter/YAML injection.** `formatMarkdown`'s YAML escaping (`yamlEscape`) quotes and escapes any title/channel/URL/description value containing YAML-significant characters (`: " ' { } [ ] # & * ! | > % @ \` newline`) or leading/trailing whitespace, so a crafted title cannot inject a second frontmatter key or break out of its own value. Plain titles are left unquoted (no gratuitous escaping).
2. **No path traversal from video metadata.** `slugify()` — the only thing that turns a video title/channel into a filesystem path segment (`registerVideoDir`) — strips everything outside `\p{L}\p{N}\s-` before joining words with single hyphens. It cannot emit `/`, `\`, or a bare `..` segment, so a hostile title can't write outside the configured output directory. The raw (un-slugified) video ID is used only as a JSON index key, never as a path segment.
3. **No shell injection in the `yt-dlp` fallback.** Both `youtube.ts` and `rutube.ts` invoke `yt-dlp` via `spawnSync(command, args)` with an argument array — never a concatenated shell string — so a malicious URL or option value can't break out into a second shell command.
4. **Transcript content is inert data, never instructions.** The AI post-processing step (`prompts/speaker-transcript.md`) explicitly declares everything under the transcript/description/metadata as untrusted text to transcribe and label, not instructions to follow — apparent injected directives ("ignore previous instructions", fake tool calls, etc.) are transcribed verbatim like any other spoken/written line, never acted on. This is a model-behavior contract (see that file's "Security boundary" section), not something a unit test can enforce directly.
5. **No autonomous tool install.** If `yt-dlp` fallback is needed but the binary isn't present, the skill asks the user before installing anything — it does not silently shell out to a package manager.
6. **Bounded regex cost.** The URL/video-ID extraction patterns are anchored alternations over a small fixed set of hosts with a bounded capture group (`{11}` / `{32}` chars) — no nested quantifiers that could catastrophically backtrack on adversarial input. Guarded by a timing regression test.

## Shared orchestrator (`scripts/chunk-and-label.ts`)

The post-processing orchestrator is shared across all three sub-skills because it reads only their **common cached output** (`transcript.md` frontmatter + `# Chapters` + SRT `# Transcript`), never any source-specific fetch code — so it needs no per-copy duplication.

- **No new frontmatter/YAML surface for `transcript.md`.** It copies the raw `transcript.md` frontmatter **verbatim**, which the sub-skill's `formatMarkdown`/`yamlEscape` already escaped (guarantee #1) — it does not re-derive that frontmatter from untrusted metadata.
- **Summary frontmatter is the one re-emitted value.** `chapters-summary.md`'s `title:`/`video:`/`speakers:` are re-emitted, so this file carries its own `yamlEscape` (identical rule to `transcript.ts`) — covered by `scripts/security.test.ts` (`security/yaml: *`) and `stryker.shared.conf.json`.
- **Untrusted transcript stays inert at the model boundary.** Each per-chapter request embeds `prompts/speaker-transcript.md`, whose "Security boundary" section marks transcript/metadata as inert data, not instructions (guarantee #4).
- **No shell injection in CLI backends.** The subscription-CLI backend (`makeCliChat`) invokes the agent CLI via `spawnSync(command, args)` with an argument array and the prompt piped over stdin — never a concatenated shell string (same discipline as guarantee #3).
- **Derived chapter titles cannot forge markdown structure.** When the source carries no chapters, `scripts/chapters.ts` has the model segment the transcript — so the resulting titles are model output derived from untrusted transcript text, and they land inside `## [HH:MM:SS] <title>` headings. `cleanChapterTitle` flattens each title to a single line, drops `#` wherever it appears, strips leading list markers, and caps its length, so a title cannot open a second heading or list item. Covered by `scripts/chapters.test.ts` and mutated by `stryker.shared.conf.json`.
- **Derived timestamps are never model-authored.** Every time the model returns is snapped to the start of an actual SRT block (`parseDerivedChapters` → `snapToBlock`), so a hallucinated or interpolated timecode cannot reach `transcript.md`/`chapters-summary.md`; a chapter can be at the wrong place in the transcript, never at a time the transcript does not have.
- **Non-goal: not a sandbox for the model or its endpoint.** `--endpoint`/`--model`/`--api-key`/`.env` and the chosen CLI are trusted operator config, same trust level as any local script's arguments.

## Non-goals

- **Not an HTML sanitizer.** Output is Markdown for an AI/human to read, not HTML rendered in a browser by this pipeline. `stripTags`/`htmlUnescape` clean up caption markup for readability; they are not a defense against XSS, because nothing in these three skills renders the output as HTML. If a downstream skill (e.g. `podcast-deepdive`) renders this text as HTML, that skill is responsible for its own escaping at render time.
- **Not a sandbox for the caching layer.** `.index.json` and the cached `meta.json`/`transcript-raw.json` files are treated as trusted local state (this skill's own previous output). They are not re-validated against attacker input on every read.
- **Not protection against a malicious operator.** CLI flags like `--output`/`--output-dir` are trusted the way any local script's arguments are trusted — the security boundary is around *video content*, not around the person running the command.

## Where this is tested

Each sub-skill (`youtube/`, `rutube/`, `local/`) has its own copy of these tests under its own `scripts/`; the shared orchestrator has its own under `transcript-digest/scripts/`.

| Guarantee | Test file (per sub-skill copy) |
|---|---|
| YAML/frontmatter injection (`transcript.ts` `yamlEscape`) | `<sub>/scripts/security.test.ts` → `security/yaml: *` |
| Path traversal via slug (`shared.ts` `slugify`) | `<sub>/scripts/security.test.ts` → `security/path: *` |
| Regex DoS bound (`shared.ts` URL regex) | `<sub>/scripts/security.test.ts` → `security/dos: *` |
| Prompt-injection boundary | `prompts/speaker-transcript.md` (model-behavior contract, not unit-testable) |
| Shared orchestrator summary-title YAML | `transcript-digest/scripts/security.test.ts` → `security/yaml: *` |
| Derived chapter titles / snapped timestamps | `transcript-digest/scripts/chapters.test.ts` |

Mutation testing (`npx stryker run <config>` from the repo root) — one config **per copy**, so coverage must be checked independently:

| Config | Mutates | Runs |
|---|---|---|
| `stryker.youtube.conf.json` | `youtube/scripts/{shared,transcript}.ts` | `youtube/scripts` tests |
| `stryker.rutube.conf.json` | `rutube/scripts/{shared,transcript}.ts` | `rutube/scripts` tests |
| `stryker.local.conf.json` | `local/scripts/{shared,transcript}.ts` | `local/scripts` tests |
| `stryker.shared.conf.json` | `transcript-digest/scripts/{frontmatter,profiles,chapters}.ts` | `transcript-digest/scripts` tests |

A surviving mutant in `yamlEscape`, `slugify`, or the URL-matching regex (in any copy) means that guarantee is no longer actually enforced by a test **for that copy**, not just documented.

## Exports (`scripts/formats.ts`, `scripts/documents.py`)

Transcript and summary text is untrusted, and every export format has its own markup:

1. **No forged subtitle cues.** SRT and VTT flatten each cue line, so a blank line or a `-->` inside the text can never start a second cue. VTT also entity-escapes `& < >`, because its payload understands tags (`<b>`, `<c>`, `<v>`) and entities.
2. **No spreadsheet formula injection.** TSV flattens tabs and newlines, and a cell starting with `= + - @` gets a leading `'`, so opening the file in a spreadsheet never evaluates it.
3. **No PDF markup injection.** reportlab's `Paragraph` parses XML-like markup, so `documents.py` escapes `& < >` before it adds its own `<b>`/`<i>`. DOCX text is written as plain runs.
4. **No shell.** `publish.ts` starts `uv run python documents.py` with an argument array, never a shell string.

Guarded by `scripts/formats.test.ts` (mutation-gated by `stryker.shared.conf.json`) and `scripts/test_documents.py` (`uv run python -m unittest test_documents`).

## Object storage (`@inbox/object-store`)

All S3 access in this repo goes through one package, `packages/object-store` — the sub-skills, both services and `podcast-deepdive` consume it, and nothing else imports the AWS SDK. Key derivation lives in `src/keys.ts`, is pure, and is the single place these rules are enforced.

**What the code guarantees:**

1. **No untrusted value ever reaches an object key.** Keys are built from a validated id plus a fixed filename from an allowlist (`meta.json`, `transcript-raw.json`, `transcript-sentences.json`, `transcript.md`, `chapters-summary.md`, and the `EXPORT_FILENAMES` list: `{transcript,chapters-summary}.{json,srt,vtt,tsv,docx,pdf}` + `chapters.vtt`). Video titles and channel names — the classic injection vector — travel as object metadata only. The single user-supplied name in the layout, `jobs/<jobId>/input/<name>`, passes `sanitizeFilename`: a path separator is rejected outright rather than reduced to a basename, characters outside `[A-Za-z0-9._-]` become `_`, the stem is length-capped, and the extension must be one of `.txt`, `.md`, `.srt`, `.vtt`.
2. **Invalid ids throw; they are never silently repaired.** YouTube ids must match `^[A-Za-z0-9_-]{11}$`, Rutube `^[0-9a-f]{32}$`, local content hashes `^[0-9a-f]{64}$`, job ids a UUID, podcast slugs `^[a-z0-9][a-z0-9-]{0,99}$`. Every pattern is anchored. Silent truncation is deliberately avoided because a shortened id could collide with another video's object.
3. **Object metadata cannot inject a header.** `sanitizeMetadata` strips CR/LF, drops non-printable and non-ASCII bytes, trims, and caps each value at 256 bytes — S3 metadata is transmitted in HTTP headers.
4. **Credentials never leave the process.** They are read once, in `factory.ts`, and are never logged, never interpolated into a prompt, and never surfaced in an error message. `jobs.error_message` remains operator-only, and that rule now explicitly covers SDK errors, which can otherwise embed a signed URL and its query parameters.
5. **The bucket stays private.** No ACL is ever set. `presign` exists on `S3ObjectStore` but is opt-in and is deliberately **not** used by Telegram delivery — the bot downloads bytes and sends a document instead, so no fetchable URL enters a chat log.
6. **Downloads are bounded.** `MAX_OBJECT_BYTES` (25 MB) is enforced on write, on the server-reported `ContentLength`, *and* on the streamed bytes, because `ContentLength` is attacker-influenced if the bucket is compromised.
7. **The prompt-injection boundary is unchanged.** Object content is data. Transcript bytes fetched from the store are treated exactly as transcript bytes read from disk: never as instructions. `local_digest`'s prompt says so explicitly about the uploaded file.

**What it deliberately does not guarantee:** no encryption beyond whatever server-side setting the bucket itself has; no integrity verification beyond the ETag the SDK checks; no protection against a credential that has already been compromised; no migration of artifacts written to disk before this change.

**The gate:** `npx stryker run stryker.object-store.conf.json` mutates `keys.ts` and `repository.ts`. A surviving mutant means a rule above is documented but not actually enforced. Because this code is shared rather than copied, one green run covers every consumer — unlike the per-sub-skill configs, which must each be checked separately.
