import { describe, expect, test } from "bun:test";

import {
  chapterCues,
  escapeCueText,
  parseChapterHeadings,
  parseSummary,
  parseTime,
  sentenceCues,
  srtTime,
  summaryCues,
  summaryJson,
  summaryTsv,
  toSrt,
  toVtt,
  transcriptJson,
  transcriptTsv,
  tsvCell,
  vttTime,
} from "./formats.ts";

const SENTENCES = [
  { text: "Всем привет.", start: "00:00:00", end: "00:00:02" },
  { text: "  ", start: "00:00:02", end: "00:00:03" },
  { text: "bad", start: "??", end: "00:00:04" },
  { text: "Same.", start: "00:00:05", end: "00:00:05" },
];

const SUMMARY_MD = `---
title: "Урок 1 — chapter summary"
source: transcript.md
---

# TLDR
- Первый пункт.
- Второй пункт.

# Timecodes
- 0:00:00 — Вступление

# TLDR by chapter

## Вступление [00:00:00]
Лектор приветствует
участников.
- Пункт А

## [00:01:00] — Основная часть
Суть <b>занятия</b>.
`;

describe("time", () => {
  test("parseTime accepts HH:MM:SS, H:MM:SS and milliseconds; rejects junk", () => {
    expect(parseTime("01:02:03")).toBe(3723);
    expect(parseTime("1:02:03")).toBe(3723);
    expect(parseTime("00:00:01.5")).toBe(1.5);
    expect(parseTime("00:00:01,250")).toBe(1.25);
    expect(parseTime("1:2:3")).toBeNaN();
  });

  test("parseTime trims but is anchored", () => {
    expect(parseTime(" 00:00:07 ")).toBe(7);
    expect(parseTime("x00:00:07")).toBeNaN();
    expect(parseTime("00:00:07x")).toBeNaN();
    expect(parseTime("000:00:07")).toBeNaN();
    expect(parseTime("00:0:07")).toBeNaN();
    expect(parseTime("00:00:07.1234")).toBeNaN();
  });

  test("vttTime and srtTime differ only in the millisecond separator", () => {
    expect(vttTime(3723.5)).toBe("01:02:03.500");
    expect(srtTime(3723.5)).toBe("01:02:03,500");
    expect(vttTime(0)).toBe("00:00:00.000");
  });
});

describe("escaping", () => {
  test("escapeCueText neutralizes tags, entities, cue separators and line breaks", () => {
    expect(escapeCueText("a <b>x</b> & y")).toBe("a &lt;b&gt;x&lt;/b&gt; &amp; y");
    expect(escapeCueText("line1\n\n00:00:01.000 --> 00:00:02.000\nevil")).toBe(
      "line1 00:00:01.000 --&gt; 00:00:02.000 evil"
    );
  });

  test("tsvCell flattens tabs/newlines and defuses spreadsheet formulas", () => {
    expect(tsvCell("a\tb\nc")).toBe("a b c");
    for (const f of ["=1+1", "+1", "-1", "@SUM(A1)"]) expect(tsvCell(f)).toBe(`'${f}`);
    expect(tsvCell("— тире")).toBe("— тире");
  });
});

describe("transcript formats", () => {
  const cues = sentenceCues(SENTENCES);

  test("sentenceCues skips empty or untimed sentences", () => {
    expect(cues).toEqual([
      { start: 0, end: 2, text: "Всем привет." },
      { start: 5, end: 5, text: "Same." },
    ]);
  });

  test("VTT: header, one cue per sentence, never zero-length", () => {
    expect(toVtt(cues)).toBe("WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nВсем привет.\n\n00:00:05.000 --> 00:00:06.000\nSame.\n");
  });

  test("SRT: numbered cues with comma milliseconds", () => {
    expect(toSrt(cues)).toBe("1\n00:00:00,000 --> 00:00:02,000\nВсем привет.\n\n2\n00:00:05,000 --> 00:00:06,000\nSame.\n");
  });

  test("SRT flattens a forged cue inside the text", () => {
    expect(toSrt([{ start: 0, end: 1, text: "a\n\n2\n00:00:09,000 --> 00:00:10,000\nevil" }])).toBe(
      "1\n00:00:00,000 --> 00:00:01,000\na\n2\n00:00:09,000 --> 00:00:10,000\nevil\n"
    );
  });

  test("JSON: seconds and text per segment", () => {
    expect(JSON.parse(transcriptJson("T", cues))).toEqual({
      title: "T",
      segments: [
        { start: 0, end: 2, text: "Всем привет." },
        { start: 5, end: 6, text: "Same." },
      ],
    });
  });

  test("TSV: header + one row per sentence", () => {
    expect(transcriptTsv(cues)).toBe("start\tend\ttext\n00:00:00.000\t00:00:02.000\tВсем привет.\n00:00:05.000\t00:00:06.000\tSame.\n");
  });
});

describe("chapters", () => {
  test("parseChapterHeadings reads both heading formats and skips the ToC", () => {
    const md = [
      "## Table of Contents",
      "* [00:00:00] Intro",
      "## Вступление [00:00:00]",
      "## [00:09:14] — Как агенты стёрли границы",
      "## [1:00:00] Plain",
      "### [00:10:00] Not a chapter",
    ].join("\n");
    expect(parseChapterHeadings(md)).toEqual([
      { title: "Вступление", start: 0 },
      { title: "Как агенты стёрли границы", start: 554 },
      { title: "Plain", start: 3600 },
    ]);
  });

  test("heading variants: spacing, dash kinds, and non-chapters", () => {
    const md = [
      "##   Spaced title   [00:00:05]   ",
      "## [00:00:06]NoSpace",
      "## [00:00:07] - Hyphen",
      "## [00:00:08] – EnDash",
      "## Glued[00:00:09]",
      "## [00:00:10]",
      "##[00:00:11] NoSpaceAfterHashes",
      "x## [00:00:12] Prefixed",
      "## Title [00:00:13] trailing",
    ].join("\n");
    expect(parseChapterHeadings(md)).toEqual([
      { title: "Spaced title", start: 5 },
      { title: "NoSpace", start: 6 },
      { title: "Hyphen", start: 7 },
      { title: "EnDash", start: 8 },
    ]);
  });

  test("chapter-title VTT ends each chapter where the next starts and the last at endSeconds", () => {
    const cues = chapterCues([{ title: "A", start: 0 }, { title: "B <i>", start: 60 }], 90, (c) => c.title);
    expect(toVtt(cues)).toBe("WEBVTT\n\n00:00:00.000 --> 00:01:00.000\nA\n\n00:01:00.000 --> 00:01:30.000\nB &lt;i&gt;\n");
  });
});

describe("summary formats", () => {
  const summary = parseSummary(SUMMARY_MD);

  test("parseSummary reads title, TLDR block, chapter paragraphs and bullets", () => {
    expect(summary).toEqual({
      title: "Урок 1 — chapter summary",
      tldr: "- Первый пункт.\n- Второй пункт.",
      chapters: [
        { title: "Вступление", start: 0, summary: "Лектор приветствует участников.", bullets: ["Пункт А"] },
        { title: "Основная часть", start: 60, summary: "Суть <b>занятия</b>.", bullets: [] },
      ],
    });
  });

  test("summary cues put the title on line one and the TLDR on line two, escaped in VTT", () => {
    expect(toVtt(summaryCues(summary, 90))).toBe(
      "WEBVTT\n\n00:00:00.000 --> 00:01:00.000\nВступление\nЛектор приветствует участников.\n\n" +
        "00:01:00.000 --> 00:01:30.000\nОсновная часть\nСуть &lt;b&gt;занятия&lt;/b&gt;.\n"
    );
    expect(toSrt(summaryCues(summary, 90))).toContain("2\n00:01:00,000 --> 00:01:30,000\nОсновная часть\nСуть <b>занятия</b>.\n");
  });

  test("summary JSON and TSV carry timing, text and bullets", () => {
    expect(JSON.parse(summaryJson(summary, 90)).chapters[0]).toEqual({
      title: "Вступление",
      start: 0,
      end: 60,
      summary: "Лектор приветствует участников.",
      bullets: ["Пункт А"],
    });
    expect(summaryTsv(summary, 90).split("\n")[1]).toBe("00:00:00.000\t00:01:00.000\tВступление\tЛектор приветствует участников.\tПункт А");
  });
});

describe("edge cases", () => {
  test("tsvCell only defuses a formula character at the start of the cell", () => {
    expect(tsvCell("a=b+c-d@e")).toBe("a=b+c-d@e");
    expect(tsvCell("  =1")).toBe("'=1");
  });

  test("exports end with a newline", () => {
    const cues = [{ start: 0, end: 1, text: "x" }];
    for (const out of [toVtt(cues), toSrt(cues), transcriptJson("t", cues), transcriptTsv(cues)]) expect(out.endsWith("\n")).toBe(true);
  });

  test("parseSummary tolerates no frontmatter, stray spaces, `*` bullets and unquoted titles", () => {
    const md = [
      "#   TLDR   ",
      "   Итог.   ",
      "# TLDR by chapter",
      "   ## Глава [00:00:10]   ",
      "  первая строка  ",
      "* звёздочка",
      "-не пункт",
    ].join("\n");
    expect(parseSummary(md)).toEqual({
      title: "",
      tldr: "Итог.",
      chapters: [{ title: "Глава", start: 10, summary: "первая строка -не пункт", bullets: ["звёздочка"] }],
    });
    expect(parseSummary('---\ntitle: say "hi"\n---\n').title).toBe('say "hi"');
    expect(parseSummary("---\nsource: x\n---\n# TLDR\nT\n").title).toBe("");
  });
});
