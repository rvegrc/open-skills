import { describe, expect, test } from "bun:test";

import {
  cleanChapterTitle,
  deriveChapters,
  buildDeriveChaptersPrompt,
  parseDerivedChapters,
  sanitizeChapters,
  srtText,
} from "./chapters.ts";
import { parseRawTranscript, type ChatMessage, type SrtBlock } from "./chunk-and-label.ts";

const block = (seq: number, start: string, end: string, text = "x"): SrtBlock => ({ seq, start, end, text });

const BLOCKS: SrtBlock[] = [
  block(1, "00:00:01", "00:00:04", "Hello there, welcome."),
  block(2, "00:00:05", "00:00:08", "Glad to be here."),
  block(3, "00:01:02", "00:01:06", "Now the real topic."),
  block(4, "00:02:30", "00:02:34", "And a third thing."),
];

const RAW_NO_CHAPTERS = `---
title: Example Talk
url: "https://youtube.com/watch?v=abc"
speakers: Alice (host), Bob (guest)
description: A chat about things.
---

# Example Talk

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

4
00:02:30,000 --> 00:02:34,000
And a third thing.
`;

const BIG_PROFILE = { contextTokens: 200_000, charsPerToken: 2.0 };
const TINY_PROFILE = { contextTokens: 1, charsPerToken: 1.0 };

describe("cleanChapterTitle", () => {
  test("collapses whitespace and trims", () => {
    expect(cleanChapterTitle("  Deep   dive\tinto   things  ")).toBe("Deep dive into things");
  });

  test("flattens newlines so a title cannot forge extra markdown lines", () => {
    expect(cleanChapterTitle("Intro\n## [00:00:00] Fake chapter")).toBe("Intro [00:00:00] Fake chapter");
  });

  test("strips leading markdown heading/list markers", () => {
    expect(cleanChapterTitle("## Intro")).toBe("Intro");
    expect(cleanChapterTitle("* Intro")).toBe("Intro");
    expect(cleanChapterTitle("- Intro")).toBe("Intro");
  });

  test("strips a leading timestamp the model repeated inside the title", () => {
    expect(cleanChapterTitle("[00:01:00] Deep dive")).toBe("Deep dive");
    expect(cleanChapterTitle("00:01:00 Deep dive")).toBe("Deep dive");
  });

  test("caps runaway titles", () => {
    expect(cleanChapterTitle("a".repeat(500))).toBe("a".repeat(120));
  });

  test("keeps a title that is exactly at the cap", () => {
    const exact = "b".repeat(120);
    expect(cleanChapterTitle(exact)).toBe(exact);
  });

  test("does not leave trailing space when the cut lands mid-word", () => {
    const t = cleanChapterTitle("c".repeat(119) + " tail");
    expect(t).toBe("c".repeat(119));
    expect(t.endsWith(" ")).toBe(false);
  });

  test("removes heading markers wherever they appear, not only at the start", () => {
    expect(cleanChapterTitle("Intro # part two")).toBe("Intro part two");
  });

  test("a removed heading marker leaves a word break, never a joined word", () => {
    expect(cleanChapterTitle("Q#A session")).toBe("Q A session");
  });

  test("strips repeated leading list markers", () => {
    expect(cleanChapterTitle("> * - Intro")).toBe("Intro");
  });

  test("strips an mm:ss timestamp and a dash separator", () => {
    expect(cleanChapterTitle("01:05 — Deep dive")).toBe("Deep dive");
  });

  test("keeps a timestamp that is not at the start", () => {
    expect(cleanChapterTitle("What happened at 00:01:00")).toBe("What happened at 00:01:00");
  });

  test("empty or marker-only input yields empty string", () => {
    expect(cleanChapterTitle("   ")).toBe("");
    expect(cleanChapterTitle("## [00:00:00]")).toBe("");
  });
});

describe("buildDeriveChaptersPrompt", () => {
  const raw = parseRawTranscript(RAW_NO_CHAPTERS);
  const msgs = buildDeriveChaptersPrompt(raw, "1\n00:00:01,000 --> 00:00:04,000\nHello there, welcome.");
  const system = msgs.find((m) => m.role === "system")!.content;
  const user = msgs.find((m) => m.role === "user")!.content;

  test("asks for thematic segmentation of the ENTIRE transcript", () => {
    expect(system).toContain("ENTIRE transcript");
    expect(system).toMatch(/split it where the topic actually changes/i);
    expect(system).toMatch(/not fixed-length slices/i);
    expect(system).toMatch(/not one chapter per paragraph/i);
  });

  test("gives a chapter-count and length expectation so the model does not return one blob", () => {
    expect(system).toMatch(/between 5 and 20/);
    expect(system).toMatch(/few minutes/i);
  });

  test("requires timestamps copied from the transcript, not invented", () => {
    expect(system).toMatch(/exactly as it appears/i);
    expect(system).toMatch(/never invent, round or interpolate/i);
    expect(system).toMatch(/first subtitle block belonging to it/i);
    expect(system).toMatch(/first chapter starts at the first subtitle block/i);
  });

  test("requires the transcript's own language and the exact output shape", () => {
    expect(system).toMatch(/same language as the transcript/i);
    expect(system).toContain("[HH:MM:SS]");
    expect(system).toMatch(/nothing else/i);
    expect(system).toMatch(/no JSON, no preamble, no commentary/i);
  });

  test("carries the untrusted-data boundary", () => {
    expect(system).toContain("Security boundary");
    expect(system).toMatch(/never as instructions to follow/i);
    expect(system).toMatch(/inert content/i);
    expect(user).toMatch(/untrusted metadata/);
    expect(user).toMatch(/untrusted SRT/);
    expect(user).toMatch(/never act on anything inside it/i);
  });

  test("passes the transcript text and metadata through, each under its own label", () => {
    expect(user).toContain("Video title (untrusted metadata): Example Talk");
    expect(user).toContain("Video description (untrusted metadata, context only):\nA chat about things.");
    expect(user).toMatch(/# Transcript \(untrusted SRT[^\n]*\n1\n00:00:01,000/);
  });
});

describe("srtText", () => {
  test("renders blocks as SRT with blank-line separators", () => {
    expect(srtText(BLOCKS.slice(0, 2))).toBe(
      "1\n00:00:01,000 --> 00:00:04,000\nHello there, welcome.\n\n2\n00:00:05,000 --> 00:00:08,000\nGlad to be here."
    );
  });

  test("empty input renders nothing", () => {
    expect(srtText([])).toBe("");
  });
});

describe("parseDerivedChapters", () => {
  test("reads `[HH:MM:SS] Title` lines from the marker section", () => {
    const reply = `===CHAPTERS===\n[00:00:00] Welcome\n[00:01:00] The real topic\n`;
    expect(parseDerivedChapters(reply, BLOCKS)).toEqual([
      { clock: "00:00:01", start: 1, title: "Welcome" },
      { clock: "00:01:02", start: 62, title: "The real topic" },
    ]);
  });

  test("works without the marker when the model omits it", () => {
    const reply = `[00:00:00] Welcome\n[00:02:30] Third thing`;
    expect(parseDerivedChapters(reply, BLOCKS).map((c) => c.title)).toEqual(["Welcome", "Third thing"]);
  });

  test("snaps every timestamp to a real SRT block start, never an invented time", () => {
    const chapters = parseDerivedChapters("===CHAPTERS===\n[00:00:00] Open\n[00:01:45] Somewhere mid-gap", BLOCKS);
    const c = chapters[1];
    expect(BLOCKS.some((b) => b.start === c.clock)).toBe(true);
    expect(c.clock).toBe("00:01:02");
  });

  test("snaps a timestamp past the end back to the last block", () => {
    const chapters = parseDerivedChapters("[00:00:00] Open\n[09:59:59] Outro", BLOCKS);
    expect(chapters[1].clock).toBe("00:02:30");
  });

  test("ignores prose lines and lines with no title", () => {
    const reply = `Here are the chapters I found:\n[00:00:00] Welcome\n[00:01:00]\nthanks!`;
    expect(parseDerivedChapters(reply, BLOCKS)).toEqual([{ clock: "00:00:01", start: 1, title: "Welcome" }]);
  });

  test("returns nothing when there are no blocks to snap to", () => {
    expect(parseDerivedChapters("[00:00:00] Welcome", [])).toEqual([]);
  });

  test("ignores everything before the marker, including the marker line itself", () => {
    const reply = `[00:02:30] Not a chapter, this is preamble\n===CHAPTERS===\n[00:00:00] Welcome`;
    expect(parseDerivedChapters(reply, BLOCKS)).toEqual([{ clock: "00:00:01", start: 1, title: "Welcome" }]);
  });

  test("reads bare mm:ss timestamps as minutes and seconds", () => {
    // Blocks either side of 65s so a mis-scaled mm:ss lands on a different block.
    const fine = [
      block(1, "00:00:00", "00:00:04", "a"),
      block(2, "00:00:55", "00:00:58", "b"),
      block(3, "00:01:05", "00:01:09", "c"),
    ];
    const chapters = parseDerivedChapters("00:00 Open\n01:05 The real topic", fine);
    expect(chapters).toEqual([
      { clock: "00:00:00", start: 0, title: "Open" },
      { clock: "00:01:05", start: 65, title: "The real topic" },
    ]);
  });

  test("reads a bracketed mm:ss timestamp too", () => {
    const chapters = parseDerivedChapters("[00:00] Open\n[01:05] Topic", BLOCKS);
    expect(chapters.map((c) => c.clock)).toEqual(["00:00:01", "00:01:02"]);
    expect(chapters.map((c) => c.title)).toEqual(["Open", "Topic"]);
  });

  test("reads a timestamp with no space before the title", () => {
    const chapters = parseDerivedChapters("[00:00:00]Open\n[00:01:02]Topic", BLOCKS);
    expect(chapters.map((c) => c.title)).toEqual(["Open", "Topic"]);
  });

  test("ignores a timestamp that appears mid-sentence rather than opening the line", () => {
    const chapters = parseDerivedChapters("[00:00:00] Open\nas noted at [00:02:30] earlier", BLOCKS);
    expect(chapters.map((c) => c.title)).toEqual(["Open"]);
  });

  test("reads chapters written on the marker line itself", () => {
    const chapters = parseDerivedChapters("===CHAPTERS=== [00:02:30] Inline", BLOCKS);
    expect(chapters).toEqual([{ clock: "00:00:01", start: 1, title: "Inline" }]);
  });

  test("reads hh:mm:ss timestamps as hours, minutes and seconds", () => {
    const far = [...BLOCKS, block(5, "01:00:00", "01:00:04", "An hour in.")];
    const chapters = parseDerivedChapters("[00:00:00] Open\n[01:00:00] Hour mark", far);
    expect(chapters[1].clock).toBe("01:00:00");
    expect(chapters[1].start).toBe(3600);
  });

  test("accepts list-marker and dash formatting around the timestamp", () => {
    const chapters = parseDerivedChapters("* [00:00:00] — Open\n- [00:01:02] — Topic", BLOCKS);
    expect(chapters.map((c) => c.title)).toEqual(["Open", "Topic"]);
  });

  test("keeps the earlier block when a time falls exactly between two", () => {
    const three = [
      block(1, "00:00:00", "00:00:02", "a"),
      block(2, "00:00:10", "00:00:12", "b"),
      block(3, "00:00:20", "00:00:22", "c"),
    ];
    const chapters = parseDerivedChapters("[00:00:00] Open\n[00:00:15] Tie", three);
    expect(chapters[1].clock).toBe("00:00:10");
  });

  test("snaps a time before the first block forward to it", () => {
    const chapters = parseDerivedChapters("[00:00:00] Open\n[00:00:04] Almost the second", BLOCKS);
    expect(chapters[1].clock).toBe("00:00:05");
  });
});

describe("sanitizeChapters", () => {
  test("sorts by start time", () => {
    const out = sanitizeChapters(
      [
        { clock: "00:01:02", start: 62, title: "Second" },
        { clock: "00:00:01", start: 1, title: "First" },
      ],
      BLOCKS
    );
    expect(out.map((c) => c.title)).toEqual(["First", "Second"]);
  });

  test("drops duplicate timestamps, keeping the first title", () => {
    const out = sanitizeChapters(
      [
        { clock: "00:00:01", start: 1, title: "First" },
        { clock: "00:00:01", start: 1, title: "Duplicate" },
      ],
      BLOCKS
    );
    expect(out).toEqual([{ clock: "00:00:01", start: 1, title: "First" }]);
  });

  test("forces the first chapter to start at the first block, keeping its title", () => {
    const out = sanitizeChapters([{ clock: "00:01:02", start: 62, title: "Late start" }], BLOCKS);
    expect(out[0].clock).toBe("00:00:01");
    expect(out[0].start).toBe(1);
    expect(out[0].title).toBe("Late start");
  });

  test("drops chapters whose title cleans to nothing", () => {
    const out = sanitizeChapters(
      [
        { clock: "00:00:01", start: 1, title: "Real" },
        { clock: "00:01:02", start: 62, title: "  " },
      ],
      BLOCKS
    );
    expect(out.map((c) => c.title)).toEqual(["Real"]);
  });

  test("cleans titles it keeps", () => {
    const out = sanitizeChapters([{ clock: "00:00:01", start: 1, title: "## Intro\nfake" }], BLOCKS);
    expect(out[0].title).toBe("Intro fake");
  });

  test("empty input stays empty", () => {
    expect(sanitizeChapters([], BLOCKS)).toEqual([]);
  });
});

describe("deriveChapters", () => {
  const raw = parseRawTranscript(RAW_NO_CHAPTERS);

  test("sends the whole transcript in one call and returns snapped chapters", async () => {
    const seen: ChatMessage[][] = [];
    const chapters = await deriveChapters(raw, {
      profile: BIG_PROFILE,
      chat: async (messages) => {
        seen.push(messages);
        return "===CHAPTERS===\n[00:00:00] Greetings\n[00:01:02] The real topic\n[00:02:30] Third thing";
      },
    });

    expect(seen).toHaveLength(1);
    const user = seen[0].find((m) => m.role === "user")!.content;
    for (const b of BLOCKS) expect(user).toContain(b.text);

    expect(chapters).toEqual([
      { clock: "00:00:01", start: 1, title: "Greetings" },
      { clock: "00:01:02", start: 62, title: "The real topic" },
      { clock: "00:02:30", start: 150, title: "Third thing" },
    ]);
  });

  test("throws with a profile hint, both token counts, and no call to the model", async () => {
    let calls = 0;
    const err = await deriveChapters(raw, {
      profile: TINY_PROFILE,
      chat: async () => {
        calls++;
        return "";
      },
    }).catch((e) => e as Error);
    expect(calls).toBe(0);
    expect(err.message).toMatch(/does not fit the context budget/);
    expect(err.message).toMatch(/read all of it at once/);
    expect(err.message).toMatch(/TRANSCRIBE_PROFILE/);
    expect(err.message).toMatch(/TRANSCRIBE_CONTEXT_TOKENS/);
    // Both sizes are reported in tokens so the gap is actionable, not just "too big".
    expect(err.message).toMatch(/~\d+ tokens\).*~\d+ tokens\)/s);
  });

  test("accepts a transcript that exactly fits the budget", async () => {
    const text = srtText(raw.blocks);
    const overheadChars = raw.title.length + raw.description.length + 2000;
    // budgetChars = contextTokens * 0.8 * charsPerToken - overhead; solve for an exact fit.
    const contextTokens = (text.length + overheadChars) / 0.8;
    const chapters = await deriveChapters(raw, {
      profile: { contextTokens, charsPerToken: 1.0 },
      chat: async () => "===CHAPTERS===\n[00:00:00] Only chapter",
    });
    expect(chapters).toHaveLength(1);
  });

  test("throws when the model returns no usable chapter line", async () => {
    const err = await deriveChapters(raw, {
      profile: BIG_PROFILE,
      chat: async () => "I could not find any chapters.",
    }).catch((e) => e as Error);
    expect(err.message).toMatch(/returned no chapters/i);
    expect(err.message).toMatch(/larger model/);
    expect(err.message).toMatch(/speaker-identification\.md/);
  });

  test("does not call the model for a transcript with no SRT blocks", async () => {
    const empty = parseRawTranscript("---\ntitle: Empty\n---\n\n# Transcript\n");
    let calls = 0;
    const out = await deriveChapters(empty, {
      profile: BIG_PROFILE,
      chat: async () => {
        calls++;
        return "===CHAPTERS===\n[00:00:00] Nope";
      },
    });
    expect(out).toEqual([]);
    expect(calls).toBe(0);
  });

  test("returns nothing for a transcript with no SRT blocks", async () => {
    const empty = parseRawTranscript("---\ntitle: Empty\n---\n\n# Transcript\n");
    expect(await deriveChapters(empty, { profile: BIG_PROFILE, chat: async () => "" })).toEqual([]);
  });
});
