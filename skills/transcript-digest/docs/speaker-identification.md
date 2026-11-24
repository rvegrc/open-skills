# Speaker Identification Workflow (shared)

Used by `youtube-transcript-digest` and `rutube-transcript-digest` when run with `--speakers` (the `main.ts` in each produces this same raw shape). `transcript-digest` follows an equivalent process tailored to files that may lack timestamps — see its own `SKILL.md` for that variant.

Speaker identification requires AI processing. The script outputs a raw `.md` file containing:
- YAML frontmatter with video metadata (title, channel, date, cover, description, language)
- Video description (for speaker name extraction)
- Chapter list from description (if available)
- Raw transcript in SRT format (pre-computed start/end timestamps, token-efficient)

After the script saves the raw file, spawn a sub-agent (use a cheaper model like Sonnet for cost efficiency) to process speaker identification:

1. Read the saved `.md` file
2. Read the prompt template at `{sharedDir}/prompts/speaker-transcript.md` (see each skill's `SKILL.md` for the resolved `{sharedDir}` path)
3. Process the raw transcript following the prompt:
   - Identify speakers using video metadata (title → guest, channel → host, description → names)
   - Detect speaker turns from conversation flow, question-answer patterns, and contextual cues
   - Segment into chapters (use description chapters if available, else create from topic shifts)
   - Format with `**Speaker Name:**` labels, paragraph grouping (2-4 sentences), and `[HH:MM:SS → HH:MM:SS]` timestamps
4. Overwrite the `.md` file with the processed transcript (keep the YAML frontmatter)

When `--speakers` is used, `--chapters` is implied — the processed output always includes chapter segmentation.

## Scripted alternative — drive any model (`../scripts/chunk-and-label.ts`)

Steps 1–4 can be done by the agent itself (the default), **or** offloaded to the shared orchestrator `transcript-digest/scripts/chunk-and-label.ts`, which drives **any OpenAI-compatible `/v1/chat/completions` endpoint** over the raw `transcript.md`, **one chapter per request**, and writes both the speaker-labeled `transcript.md` and the `chapters-summary.md`. It's shared across all three sub-skills because it reads only their common cached output (frontmatter + `# Chapters` + SRT `# Transcript`), never source-specific fetch code.

Model-agnostic and nothing hardcoded. Three ways to reach a model, all configured from a **`.env` file** (copy `../scripts/.env.example`) so endpoints/keys/commands live in config, not in code or command history:

1. **On-prem** — vLLM, Ollama, LM Studio via their OpenAI-compatible base URL. Usually keyless, but set `TRANSCRIBE_API_KEY` if the server was started with one (e.g. `vllm serve --api-key …`, or Ollama behind an auth proxy).
2. **Hosted, API key** — Claude (Sonnet/Opus via Anthropic's OpenAI-compatible base URL), Kimi (Moonshot), OpenAI.
3. **Subscription, no key** (`--backend cli`) — drives an already-logged-in agent CLI in headless mode on a **Claude Pro/Max**, **ChatGPT Plus/Pro** (`codex`), or **Kimi** subscription. The CLI command and flags come from `TRANSCRIBE_CLI*` env keys (recipes for claude/codex/kimi are in `.env.example`); the prompt is piped over stdin (or passed as an arg), never a shell string.

```bash
# 1. main.ts <url> --speakers   → writes the RAW transcript.md (with the SRT # Transcript section)
# 2. copy .env.example → .env and set TRANSCRIBE_ENDPOINT / TRANSCRIBE_MODEL / TRANSCRIBE_API_KEY
${BUN_X} {baseDir}/../scripts/chunk-and-label.ts <videoDir>            # reads .env
# or point at a specific env file / override per-run:
${BUN_X} {baseDir}/../scripts/chunk-and-label.ts <videoDir> --env-file /path/to/.env
${BUN_X} {baseDir}/../scripts/chunk-and-label.ts <videoDir> --endpoint URL --model NAME [--api-key KEY]
# subscription (no API key) — uses your logged-in claude/codex/kimi CLI (recipe in .env):
${BUN_X} {baseDir}/../scripts/chunk-and-label.ts <videoDir> --backend cli
```

Precedence: CLI flags > process env > `.env` file. Bun auto-loads a `.env` from the working directory; the script also looks for one next to the video output and in the scripts dir. Real `.env` files are git-ignored.

Why per-chapter for labeling, and why not for summaries: a small local model (e.g. Qwen 27B) degrades on a whole-podcast context, so labeling sends each chapter on its own. Summaries have no such constraint — the reply is a few thousand tokens on any model — so `--mode summary` packs as many chapters into each request as `TRANSCRIBE_PROFILE` allows. On `sonnet`/`opus`/`gpt`/`deepseek` a 2-hour episode is a single call whose TLDR is written from the transcript itself; on `qwen-27b`/`gemma-30b` it becomes a few context-sized groups plus one reduce call that writes the overall TLDR from the per-chapter TLDRs. Per-chapter TLDRs always come from real transcript text, never from other summaries. `--mode label` writes only `transcript.md`, `--mode summary` only `chapters-summary.md`, `--mode both` (default) does each. The model is asked for two fenced sections (`===LABELED===` / `===TLDR===`) rather than JSON, because small models under speculative decoding (MTP) frequently emit broken JSON — the parser tolerates a missing marker by treating the whole reply as the labeled body. Run `main.ts --speakers` **first** so the raw SRT file exists; the script refuses to run against an already-labeled file. The prompt sent per chapter embeds this doc's sibling `../prompts/speaker-transcript.md` (its "Security boundary" section keeps untrusted transcript/metadata inert — security-contract guarantee #4).

## Model size floor — do not use models below ~27B

**Do not drive this workflow with a model smaller than roughly 27B** (Qwen 27B / Gemma 30B are the tested floor). Not a licensing or policy limit — smaller models fail this specific task in ways that are silent, so you get a plausible-looking file that is wrong rather than an error.

Three concrete failure modes, all observed to worsen sharply below ~27B:

1. **Verbatim re-emission collapses.** Speaker labeling asks the model to reproduce the chapter's transcript *exactly*, adding only `**Speaker:**` prefixes and timestamps — several thousand tokens of copying with zero license to rewrite. Small models paraphrase instead, drop filler words the prompt explicitly requires (`um`, `uh`, stutters), merge adjacent turns, and truncate long chapters. The output still looks like a transcript, so nothing flags it.

2. **Silent translation on non-English transcripts.** `prompts/speaker-transcript.md` forbids translation ("NEVER translate"), because a Russian transcript must stay Russian. Small models drift to English mid-chapter — most often right after a passage containing English technical terms, which is exactly where Russian tech talk lives. A 27B holds the instruction; a 9B typically does not.

3. **Structural markers get mangled.** Responses are parsed by fenced markers (`===LABELED===` / `===TLDR===`) rather than JSON precisely because small models under speculative decoding break strict JSON — but below ~27B even the markers get dropped, renamed, or wrapped in commentary. The parser's fallback treats a marker-less reply as the labeled body, which means the chapter's TLDR silently becomes empty.

There is also an effective-context problem: a small model advertising 32k degrades well before it, so a context budget set from the advertised number produces quiet quality loss rather than a clean overflow error.

**If a small model is all that's available:** use it for the chapter TLDRs only (summarization tolerates paraphrase — that is what a summary is) and leave `transcript.md` as the raw SRT rather than accepting a degraded labeled transcript. Never use one for speaker labeling.

## Term normalization (non-English transcripts)

Non-English videos (Russian in particular) constantly transliterate English technical terms phonetically (e.g. "гол режим" for "goal mode", "харнесс" for "harness", "гардрейлы" for "guardrails", "хуки" for "hooks", "промпт" for "prompt", "агент" for "agent"). When writing the speaker-labeled transcript and chapter summary, use the original English term instead of the transliteration wherever the term refers to a technical concept, tool, or product name — the transliteration is a speech-to-text artifact, not the actual word the speaker meant. Keep the rest of the sentence in the source language; don't translate the whole transcript, just swap the term back to English.
