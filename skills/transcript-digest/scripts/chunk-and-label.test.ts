import { describe, expect, test } from "bun:test";

import {
  assembleSummary,
  assembleTranscript,
  buildChapterPrompt,
  buildOverallTldrPrompt,
  buildWholeSummaryPrompt,
  parseSummarySections,
  summarizeTranscript,
  chunkAndLabel,
  groupBySrtChapter,
  makeCliChat,
  makeOpenAiChat,
  parseEnvFile,
  resolveCliConfig,
  splitArgs,
  type SpawnFn,
  parseModelSections,
  parseRawTranscript,
  resolveConfig,
  toClock,
  toSeconds,
  type ChatMessage,
} from "./chunk-and-label.ts";

const RAW = `---
title: Example Talk
channel: Some Channel
url: "https://youtube.com/watch?v=abc"
cover: imgs/cover.jpg
speakers: Alice (host), Bob (guest)
description: A chat about things.
---

# Example Talk

A chat about things.

# Chapters

* [00:00:00] — Intro
* [00:01:00] — Deep dive

# Transcript

1
00:00:01,000 --> 00:00:04,000
Hello there, welcome.

2
00:00:05,000 --> 00:00:08,000
Glad to be here.

3
00:01:02,000 --> 00:01:06,000
Now the real topic.
`;

describe("time", () => {
  test("round-trips", () => {
    expect(toSeconds("01:02:03")).toBe(3723);
    expect(toClock(3723)).toBe("01:02:03");
    expect(toClock(0)).toBe("00:00:00");
  });
});

describe("parseRawTranscript", () => {
  const raw = parseRawTranscript(RAW);
  test("keeps frontmatter verbatim (already-escaped by main.ts)", () => {
    expect(raw.frontmatter).toContain(`title: Example Talk`);
    expect(raw.frontmatter.startsWith("---\n")).toBe(true);
    expect(raw.frontmatter.trimEnd().endsWith("---")).toBe(true);
  });
  test("extracts title/description/cover", () => {
    expect(raw.title).toBe("Example Talk");
    expect(raw.description).toBe("A chat about things.");
    expect(raw.cover).toBe("imgs/cover.jpg");
  });
  test("parses chapters", () => {
    expect(raw.chapters.map((c) => c.title)).toEqual(["Intro", "Deep dive"]);
    expect(raw.chapters[1].start).toBe(60);
  });
  test("parses SRT blocks", () => {
    expect(raw.blocks).toHaveLength(3);
    expect(raw.blocks[0]).toMatchObject({ seq: 1, start: "00:00:01", end: "00:00:04", text: "Hello there, welcome." });
    expect(raw.blocks[2].text).toBe("Now the real topic.");
  });
  test("handles quoted frontmatter values", () => {
    const q = parseRawTranscript(`---\ntitle: "Weird: title"\ncover: c.jpg\n---\n# x\n`);
    expect(q.title).toBe("Weird: title");
  });
});

describe("groupBySrtChapter", () => {
  const raw = parseRawTranscript(RAW);
  test("assigns each block to the latest chapter that started", () => {
    const groups = groupBySrtChapter(raw.blocks, raw.chapters);
    expect(groups).toHaveLength(2);
    expect(groups[0].map((b) => b.seq)).toEqual([1, 2]);
    expect(groups[1].map((b) => b.seq)).toEqual([3]);
  });
  test("no chapters → single group", () => {
    expect(groupBySrtChapter(raw.blocks, [])).toHaveLength(1);
  });
});

describe("parseModelSections", () => {
  test("splits fenced markers", () => {
    const r = parseModelSections("junk\n===LABELED===\n**Alice:** Hi. [00:00:01 → 00:00:04]\n===TLDR===\nThey greet.");
    expect(r.labeled).toBe("**Alice:** Hi. [00:00:01 → 00:00:04]");
    expect(r.tldr).toBe("They greet.");
  });
  test("tolerates missing markers (27B/MTP broke format) → whole body as labeled", () => {
    const r = parseModelSections("**Alice:** Hi.");
    expect(r.labeled).toBe("**Alice:** Hi.");
    expect(r.tldr).toBe("");
  });
});

describe("buildChapterPrompt", () => {
  test("carries the shared prompt's security boundary and marks transcript untrusted", () => {
    const msgs = buildChapterPrompt(
      "PROMPT_TEMPLATE with Security boundary",
      { title: "T", description: "D", chapterTitle: "Intro", chapterClock: "00:00:00" },
      "1\n00:00:01,000 --> 00:00:02,000\nhi"
    );
    expect(msgs[0].content).toContain("Security boundary");
    expect(msgs[0].content).toContain("===LABELED===");
    expect(msgs[1].content).toContain("untrusted");
    expect(msgs[1].content).toContain("Intro");
  });
});

describe("assembleTranscript", () => {
  test("builds ToC, cover and chapter headings", () => {
    const raw = parseRawTranscript(RAW);
    const md = assembleTranscript(raw, [
      { chapter: raw.chapters[0], labeled: "**Alice:** Hi. [00:00:01 → 00:00:04]" },
      { chapter: raw.chapters[1], labeled: "**Bob:** Topic. [00:01:02 → 00:01:06]" },
    ]);
    expect(md).toContain("## Table of Contents");
    expect(md).toContain("* [00:00:00] Intro");
    expect(md).toContain("![cover](imgs/cover.jpg)");
    expect(md).toContain("## Intro [00:00:00]");
    expect(md).toContain("## Deep dive [00:01:00]");
    expect(md).toContain("**Alice:** Hi.");
    expect(md.startsWith("---\n")).toBe(true);
    expect(md).not.toMatch(/\n{3,}/);
  });
});

describe("assembleSummary", () => {
  test("TLDR first, one heading per chapter matching transcript timestamps", () => {
    const raw = parseRawTranscript(RAW);
    const md = assembleSummary(raw, "https://v", "Alice, Bob", "Overall summary.", [
      { chapter: raw.chapters[0], tldr: "Intro happened." },
      { chapter: raw.chapters[1], tldr: "Dive happened." },
    ]);
    expect(md.indexOf("# TLDR")).toBeLessThan(md.indexOf("# TLDR by chapter"));
    expect(md).toContain("## [00:00:00] Intro");
    expect(md).toContain("## [00:01:00] Deep dive");
    expect(md).toContain("Overall summary.");
    expect(md).toContain("title: Example Talk — chapter summary");
  });

  test("timecodes nav block between TLDR and chapters, YouTube-style clocks", () => {
    const raw = parseRawTranscript(RAW);
    const md = assembleSummary(raw, "https://v", "Alice, Bob", "Overall summary.", [
      { chapter: raw.chapters[0], tldr: "Intro happened." },
      { chapter: raw.chapters[1], tldr: "Dive happened." },
    ]);
    const tc = md.indexOf("# Timecodes");
    expect(tc).toBeGreaterThan(md.indexOf("# TLDR"));
    expect(tc).toBeLessThan(md.indexOf("# TLDR by chapter"));
    expect(md).toContain("- 0:00:00 — Intro");
    expect(md).toContain("- 0:01:00 — Deep dive");
    expect(md).not.toContain("- 00:00:00 —");
  });
});

describe("derived chapters (source had none)", () => {
  const RAW_NO_CHAPTERS = RAW.replace(/\n# Chapters\n[\s\S]*?(?=\n# Transcript)/, "\n");
  const derived = [
    { clock: "00:00:01", start: 1, title: "Greetings" },
    { clock: "00:01:02", start: 62, title: "The real topic" },
  ];

  test("the raw fixture really has no chapters of its own", () => {
    expect(parseRawTranscript(RAW_NO_CHAPTERS).chapters).toEqual([]);
  });

  test("summarizeTranscript summarizes per derived chapter, with real timestamps", async () => {
    const md = await summarizeTranscript(RAW_NO_CHAPTERS, {
      chat: async () =>
        "===OVERALL===\nAll of it.\n===CHAPTERS===\n## [00:00:01] Greetings\nThey said hello.\n## [00:01:02] The real topic\nThey got into it.",
      profile: { contextTokens: 200_000, charsPerToken: 2.0 },
      deriveChapters: async () => derived,
    });
    expect(md).toContain("## [00:00:01] Greetings");
    expect(md).toContain("## [00:01:02] The real topic");
    expect(md).toContain("They got into it.");
    expect(md).toContain("chapters: derived");
  });

  test("summarizeTranscript does not derive when the source already has chapters", async () => {
    let derives = 0;
    const md = await summarizeTranscript(RAW, {
      chat: async () => "===OVERALL===\nx\n===CHAPTERS===\n## [00:00:00] Intro\ny\n## [00:01:00] Deep dive\nz",
      profile: { contextTokens: 200_000, charsPerToken: 2.0 },
      deriveChapters: async () => {
        derives++;
        return derived;
      },
    });
    expect(derives).toBe(0);
    expect(md).toContain("## [00:00:00] Intro");
    expect(md).not.toContain("chapters: derived");
  });

  test("summarizeTranscript falls back to one whole-transcript section with no deriver", async () => {
    const md = await summarizeTranscript(RAW_NO_CHAPTERS, {
      chat: async () => "===OVERALL===\nAll of it.\n===CHAPTERS===\n## [00:00:00] Example Talk\nEverything.",
      profile: { contextTokens: 200_000, charsPerToken: 2.0 },
    });
    expect(md).toContain("## [00:00:00] Example Talk");
    expect(md).not.toContain("chapters: derived");
  });

  test("chunkAndLabel labels and summarizes per derived chapter", async () => {
    const calls: ChatMessage[][] = [];
    const { transcript, summary } = await chunkAndLabel(RAW_NO_CHAPTERS, {
      chat: async (messages) => {
        calls.push(messages);
        if (messages[0].content.includes("top-level TLDR")) return "The overall gist.";
        return `===LABELED===\n**Alice:** hi. [00:00:01 → 00:00:04]\n===TLDR===\nChapter ${calls.length} summary.`;
      },
      promptTemplate: "TPL Security boundary",
      deriveChapters: async () => derived,
    });
    // 2 derived chapters + 1 overall TLDR call (derivation itself is the injected dep)
    expect(calls).toHaveLength(3);
    expect(transcript).toContain("## Greetings [00:00:01]");
    expect(transcript).toContain("## The real topic [00:01:02]");
    expect(transcript).toContain("* [00:00:01] Greetings");
    expect(summary).toContain("## [00:01:02] The real topic");
    expect(summary).toContain("chapters: derived");
  });

  test("derived chapters group the SRT blocks by their own boundaries", async () => {
    const seen: string[] = [];
    await chunkAndLabel(RAW_NO_CHAPTERS, {
      chat: async (messages) => {
        seen.push(messages[1]?.content ?? "");
        return "===LABELED===\nx\n===TLDR===\ny";
      },
      promptTemplate: "TPL",
      deriveChapters: async () => derived,
    });
    expect(seen[0]).toContain("Hello there, welcome.");
    expect(seen[0]).not.toContain("Now the real topic.");
    expect(seen[1]).toContain("Now the real topic.");
  });
});

describe("chunkAndLabel orchestration", () => {
  test("one chat call per chapter + one overall TLDR call, assembles both files", async () => {
    const calls: ChatMessage[][] = [];
    const chat = async (messages: ChatMessage[]) => {
      calls.push(messages);
      const n = calls.length;
      if (messages[0].content.includes("top-level TLDR")) return "The overall gist.";
      return `===LABELED===\n**Speaker:** line ${n}. [00:00:01 → 00:00:02]\n===TLDR===\nChapter ${n} summary.`;
    };
    const { transcript, summary } = await chunkAndLabel(RAW, { chat, promptTemplate: "TPL Security boundary" });
    // 2 chapters + 1 overall
    expect(calls).toHaveLength(3);
    expect(calls[2][0].content).toContain("top-level TLDR");
    expect(transcript).toContain("**Speaker:** line 1.");
    expect(summary).toContain("The overall gist.");
    expect(summary).toContain("Chapter 1 summary.");
  });
});

describe("makeOpenAiChat", () => {
  test("POSTs OpenAI-compatible payload and returns message content", async () => {
    let captured: any = null;
    const fakeFetch = (async (url: string, init: any) => {
      captured = { url, body: JSON.parse(init.body), headers: init.headers };
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: "hello" } }] }),
      };
    }) as unknown as typeof fetch;
    const chat = makeOpenAiChat({ baseUrl: "http://localhost:8085", model: "qwen", apiKey: "k", fetchImpl: fakeFetch });
    const out = await chat([{ role: "user", content: "hi" }]);
    expect(out).toBe("hello");
    expect(captured.url).toBe("http://localhost:8085/v1/chat/completions");
    expect(captured.body.model).toBe("qwen");
    expect(captured.headers.authorization).toBe("Bearer k");
  });
  test("normalizes a baseUrl that already ends in /v1", () => {
    let capturedUrl = "";
    const fakeFetch = (async (url: string) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ choices: [{ message: { content: "x" } }] }) };
    }) as unknown as typeof fetch;
    const chat = makeOpenAiChat({ baseUrl: "http://h:8085/v1", model: "m", fetchImpl: fakeFetch });
    return chat([{ role: "user", content: "y" }]).then(() => {
      expect(capturedUrl).toBe("http://h:8085/v1/chat/completions");
    });
  });
  test("throws on non-ok response", async () => {
    const fakeFetch = (async () => ({ ok: false, status: 502, text: async () => "bad gateway" })) as unknown as typeof fetch;
    const chat = makeOpenAiChat({ baseUrl: "http://h", model: "m", fetchImpl: fakeFetch });
    await expect(chat([{ role: "user", content: "z" }])).rejects.toThrow("502");
  });
});

describe("parseEnvFile", () => {
  test("parses KEY=value, comments, quotes, export", () => {
    const env = parseEnvFile(
      [
        "# a comment",
        "",
        "TRANSCRIBE_ENDPOINT=http://localhost:8085",
        'TRANSCRIBE_MODEL="qwen3-27b"',
        "export TRANSCRIBE_API_KEY='sk-secret'",
        "IGNORED line without equals",
      ].join("\n")
    );
    expect(env.TRANSCRIBE_ENDPOINT).toBe("http://localhost:8085");
    expect(env.TRANSCRIBE_MODEL).toBe("qwen3-27b");
    expect(env.TRANSCRIBE_API_KEY).toBe("sk-secret");
    expect(env.IGNORED).toBeUndefined();
  });
});

describe("resolveConfig", () => {
  test("flags win over env; env keys are model-agnostic with fallbacks", () => {
    const env = { TRANSCRIBE_ENDPOINT: "http://vllm", OPENAI_MODEL: "m-fallback", OPENAI_API_KEY: "k" };
    const cfg = resolveConfig(env, { model: "explicit-model" });
    expect(cfg.endpoint).toBe("http://vllm");
    expect(cfg.model).toBe("explicit-model"); // flag beats OPENAI_MODEL
    expect(cfg.apiKey).toBe("k");
  });
  test("empty when nothing set — nothing hardcoded", () => {
    const cfg = resolveConfig({}, {});
    expect(cfg).toEqual({ endpoint: "", model: "", apiKey: "" });
  });
  test("hosted backend via OpenAI-compat base URL (Claude/Kimi) works the same", () => {
    const cfg = resolveConfig(
      { TRANSCRIBE_ENDPOINT: "https://api.anthropic.com/v1", TRANSCRIBE_MODEL: "claude-sonnet-4-5", TRANSCRIBE_API_KEY: "sk-ant" },
      {}
    );
    expect(cfg).toEqual({ endpoint: "https://api.anthropic.com/v1", model: "claude-sonnet-4-5", apiKey: "sk-ant" });
  });
});

describe("splitArgs", () => {
  test("respects single/double quotes", () => {
    expect(splitArgs("-p --output-format text")).toEqual(["-p", "--output-format", "text"]);
    expect(splitArgs(`--sys "hello world" -m 'a b'`)).toEqual(["--sys", "hello world", "-m", "a b"]);
    expect(splitArgs("")).toEqual([]);
  });
});

describe("resolveCliConfig", () => {
  test("null without TRANSCRIBE_CLI", () => {
    expect(resolveCliConfig({}, "")).toBeNull();
  });
  test("builds config from env (codex-style, prompt-as-arg)", () => {
    const cfg = resolveCliConfig(
      { TRANSCRIBE_CLI: "codex", TRANSCRIBE_CLI_ARGS: "exec", TRANSCRIBE_CLI_MODEL_FLAG: "-m", TRANSCRIBE_CLI_PROMPT: "arg" },
      "gpt-5"
    );
    expect(cfg).toMatchObject({ command: "codex", baseArgs: ["exec"], modelFlag: "-m", model: "gpt-5", promptVia: "arg" });
  });
});

describe("makeCliChat (subscription backends — no API key)", () => {
  const messages: ChatMessage[] = [
    { role: "system", content: "SYS" },
    { role: "user", content: "USER" },
  ];

  test("claude-style: system via flag, prompt over stdin, model flag", async () => {
    let seen: any = null;
    const spawn: SpawnFn = (cmd, args, opts) => {
      seen = { cmd, args, input: opts.input };
      return { status: 0, stdout: "  labeled output  ", stderr: "" };
    };
    const chat = makeCliChat({
      command: "claude",
      baseArgs: ["-p", "--output-format", "text"],
      systemFlag: "--append-system-prompt",
      modelFlag: "--model",
      model: "claude-sonnet-4-5",
      spawnImpl: spawn,
    });
    const out = await chat(messages);
    expect(out).toBe("labeled output");
    expect(seen.cmd).toBe("claude");
    expect(seen.args).toEqual(["-p", "--output-format", "text", "--append-system-prompt", "SYS", "--model", "claude-sonnet-4-5"]);
    expect(seen.input).toBe("USER"); // system NOT folded in when systemFlag present
  });

  test("codex-style: no system flag → system folded into prompt, passed as arg", async () => {
    let seen: any = null;
    const spawn: SpawnFn = (cmd, args, opts) => {
      seen = { cmd, args, input: opts.input };
      return { status: 0, stdout: "ok", stderr: "" };
    };
    const chat = makeCliChat({ command: "codex", baseArgs: ["exec"], promptVia: "arg", spawnImpl: spawn });
    await chat(messages);
    expect(seen.cmd).toBe("codex");
    expect(seen.args).toEqual(["exec", "SYS\n\nUSER"]); // folded, appended as last arg
    expect(seen.input).toBeUndefined();
  });

  test("non-zero exit throws with stderr", async () => {
    const spawn: SpawnFn = () => ({ status: 1, stdout: "", stderr: "not logged in" });
    const chat = makeCliChat({ command: "claude", spawnImpl: spawn });
    await expect(chat(messages)).rejects.toThrow("not logged in");
  });
});

describe("buildOverallTldrPrompt", () => {
  test("includes numbered per-chapter summaries", () => {
    const msgs = buildOverallTldrPrompt("T", ["a", "b"]);
    expect(msgs[1].content).toContain("1. a");
    expect(msgs[1].content).toContain("2. b");
  });
});

describe("buildWholeSummaryPrompt", () => {
  const raw = parseRawTranscript(RAW);

  test("carries every chapter in the subset and marks the transcript untrusted", () => {
    const [system, user] = buildWholeSummaryPrompt(raw, raw.chapters, "1\n00:00:01,000 --> 00:00:04,000\nHello.", {
      overallToo: true,
    });
    expect(system.role).toBe("system");
    expect(system.content).toContain("===OVERALL===");
    expect(system.content).toContain("===CHAPTERS===");
    expect(user.content).toContain("untrusted");
    expect(user.content).toContain("[00:00:00] Intro");
    expect(user.content).toContain("[00:01:00] Deep dive");
  });

  test("omits the overall-TLDR instruction when the caller will reduce separately", () => {
    const [system] = buildWholeSummaryPrompt(raw, raw.chapters, "srt", { overallToo: false });
    expect(system.content).not.toContain("===OVERALL===");
    expect(system.content).toContain("===CHAPTERS===");
  });

  test("only the requested chapter subset reaches the prompt", () => {
    const [, user] = buildWholeSummaryPrompt(raw, [raw.chapters[1]], "srt", { overallToo: false });
    expect(user.content).toContain("[00:01:00] Deep dive");
    expect(user.content).not.toContain("[00:00:00] Intro");
  });
});

describe("parseSummarySections", () => {
  test("splits the overall block from per-chapter blocks keyed by clock", () => {
    const r = parseSummarySections(
      "===OVERALL===\n- point one\n- point two\n===CHAPTERS===\n" +
        "## [00:00:00] Intro\nThey said hello.\n\n## [00:01:00] Deep dive\nThen the real talk.\n"
    );
    expect(r.overall).toBe("- point one\n- point two");
    expect(r.perChapter.get("00:00:00")).toBe("They said hello.");
    expect(r.perChapter.get("00:01:00")).toBe("Then the real talk.");
  });

  test("keeps a chapter's bullets with its paragraph", () => {
    const r = parseSummarySections(
      "===CHAPTERS===\n## [00:00:00] Intro\nParagraph.\n- bullet one\n- bullet two\n"
    );
    expect(r.perChapter.get("00:00:00")).toBe("Paragraph.\n- bullet one\n- bullet two");
  });

  test("tolerates a missing CHAPTERS marker", () => {
    const r = parseSummarySections("===OVERALL===\njust a paragraph");
    expect(r.overall).toBe("just a paragraph");
    expect(r.perChapter.size).toBe(0);
  });

  test("tolerates a missing OVERALL marker", () => {
    const r = parseSummarySections("===CHAPTERS===\n## [00:00:00] Intro\nOnly chapters here.\n");
    expect(r.overall).toBe("");
    expect(r.perChapter.get("00:00:00")).toBe("Only chapters here.");
  });
});

describe("summarizeTranscript", () => {
  const bigProfile = { contextTokens: 200_000, charsPerToken: 2 };
  // Small enough that the two fixture chapters cannot share one request.
  const smallProfile = { contextTokens: 1_345, charsPerToken: 2 };

  const groupReply =
    "===OVERALL===\nThe whole thing.\n===CHAPTERS===\n" +
    "## [00:00:00] Intro\nThey greeted each other.\n\n## [00:01:00] Deep dive\nThen the real topic.\n";

  test("one call and no reduce step when the transcript fits", async () => {
    const calls: ChatMessage[][] = [];
    const chat = async (m: ChatMessage[]) => {
      calls.push(m);
      return groupReply;
    };
    const out = await summarizeTranscript(RAW, { chat, profile: bigProfile });

    expect(calls).toHaveLength(1);
    expect(calls[0][0].content).toContain("===OVERALL===");
    expect(out).toContain("# TLDR");
    expect(out).toContain("The whole thing.");
    expect(out).toContain("## [00:00:00] Intro");
    expect(out).toContain("They greeted each other.");
    expect(out).toContain("## [00:01:00] Deep dive");
  });

  test("splits into groups and reduces the overall TLDR exactly once when it does not fit", async () => {
    const calls: ChatMessage[][] = [];
    const chat = async (m: ChatMessage[]) => {
      calls.push(m);
      const isReduce = m[1].content.includes("Per-chapter summaries:");
      return isReduce ? "Reduced overall." : groupReply;
    };
    const out = await summarizeTranscript(RAW, { chat, profile: smallProfile });

    expect(calls.length).toBeGreaterThan(2); // 2+ group calls plus one reduce
    const reduceCalls = calls.filter((m) => m[1].content.includes("Per-chapter summaries:"));
    expect(reduceCalls).toHaveLength(1);
    // Group calls must not ask for an overall TLDR — the reduce step owns it.
    for (const m of calls) {
      if (!m[1].content.includes("Per-chapter summaries:")) expect(m[0].content).not.toContain("===OVERALL===");
    }
    expect(out).toContain("Reduced overall.");
    expect(out).toContain("They greeted each other.");
  });

  test("marks a chapter the model omitted instead of dropping it", async () => {
    const chat = async () => "===OVERALL===\nAll of it.\n===CHAPTERS===\n## [00:00:00] Intro\nOnly this one.\n";
    const out = await summarizeTranscript(RAW, { chat, profile: bigProfile });

    expect(out).toContain("## [00:01:00] Deep dive");
    expect(out).toContain("(no summary returned for this chapter)");
  });

  test("reports group progress to the caller", async () => {
    const seen: string[] = [];
    const chat = async () => groupReply;
    await summarizeTranscript(RAW, {
      chat,
      profile: bigProfile,
      onGroup: (i, total) => seen.push(`${i}/${total}`),
    });
    expect(seen).toEqual(["1/1"]);
  });
});
