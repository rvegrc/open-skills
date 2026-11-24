import test from "node:test";
import assert from "node:assert/strict";

import {
  ts,
  formatSrt,
  segmentIntoSentences,
  formatMarkdown,
  formatListOutput,
  findTranscript,
  parseTranscriptXml,
  parseTranscriptPayload,
  parseBracketed,
} from "./transcript.ts";
import type { Snippet, TranscriptInfo, VideoMeta } from "./types.ts";

test("ts: formats seconds as zero-padded HH:MM:SS", () => {
  assert.equal(ts(0), "00:00:00");
  assert.equal(ts(5), "00:00:05");
  assert.equal(ts(65), "00:01:05");
  assert.equal(ts(3661), "01:01:01");
});

test("ts: floors fractional seconds", () => {
  assert.equal(ts(59.9), "00:00:59");
});

test("formatSrt: numbers blocks starting at 1 and uses comma-decimal timestamps", () => {
  const snippets: Snippet[] = [
    { text: "hello", start: 0, duration: 2 },
    { text: "world", start: 2, duration: 2 },
  ];
  const srt = formatSrt(snippets);
  assert.match(srt, /^1\n00:00:00,000 --> 00:00:02,000\nhello\n\n2\n00:00:02,000 --> 00:00:04,000\nworld\n$/);
});

test("formatSrt: clamps a snippet's end to the next snippet's start when they overlap", () => {
  const snippets: Snippet[] = [
    { text: "a", start: 0, duration: 5 }, // would naturally end at 5s, but next starts at 2s
    { text: "b", start: 2, duration: 2 },
  ];
  const srt = formatSrt(snippets);
  assert.match(srt, /00:00:00,000 --> 00:00:02,000\na/);
});

test("segmentIntoSentences: splits a snippet's text on sentence-ending punctuation", () => {
  const snippets: Snippet[] = [{ text: "Hello there. How are you?", start: 0, duration: 4 }];
  const sentences = segmentIntoSentences(snippets);
  assert.equal(sentences.length, 2);
  assert.equal(sentences[0].text, "Hello there.");
  assert.equal(sentences[1].text, "How are you?");
});

test("segmentIntoSentences: merges a sentence split across multiple snippets", () => {
  const snippets: Snippet[] = [
    { text: "Hello", start: 0, duration: 1 },
    { text: "there.", start: 1, duration: 1 },
  ];
  const sentences = segmentIntoSentences(snippets);
  assert.equal(sentences.length, 1);
  assert.equal(sentences[0].text, "Hello there.");
});

test("segmentIntoSentences: flushes trailing text with no terminal punctuation as its own sentence", () => {
  const snippets: Snippet[] = [{ text: "no ending here", start: 0, duration: 1 }];
  const sentences = segmentIntoSentences(snippets);
  assert.equal(sentences.length, 1);
  assert.equal(sentences[0].text, "no ending here");
});

test("segmentIntoSentences: returns nothing for empty input", () => {
  assert.deepEqual(segmentIntoSentences([]), []);
});

function baseMeta(overrides: Partial<VideoMeta> = {}): VideoMeta {
  return {
    videoId: "abc123",
    title: "Test Video",
    channel: "Test Channel",
    channelId: "chan1",
    description: "A short description.",
    duration: 100,
    publishDate: "2026-01-01",
    url: "https://example.com/video",
    coverImage: "",
    thumbnailUrl: "",
    language: { code: "en", name: "English", isGenerated: false },
    chapters: [],
    ...overrides,
  };
}

test("formatMarkdown: includes required frontmatter fields", () => {
  const md = formatMarkdown([], baseMeta(), { timestamps: true, chapters: false, speakers: false });
  assert.match(md, /^---\n/);
  assert.match(md, /title: Test Video/);
  assert.match(md, /channel: Test Channel/);
  assert.match(md, /url: "https:\/\/example\.com\/video"/);
  assert.match(md, /language: en/);
});

test("formatMarkdown: omits optional frontmatter fields when absent from meta", () => {
  const md = formatMarkdown([], baseMeta({ channel: "", url: "", coverImage: "" }), {
    timestamps: true,
    chapters: false,
    speakers: false,
  });
  assert.doesNotMatch(md, /\nchannel:/);
  assert.doesNotMatch(md, /\nurl:/);
  assert.doesNotMatch(md, /\ncover:/);
});

test("formatMarkdown: renders sentences with timestamp ranges when timestamps enabled", () => {
  const sentences = [{ text: "Hello world.", start: "00:00:00", end: "00:00:02" }];
  const md = formatMarkdown(sentences, baseMeta(), { timestamps: true, chapters: false, speakers: false });
  assert.match(md, /Hello world\. \[00:00:00 → 00:00:02\]/);
});

test("formatMarkdown: omits timestamp ranges when timestamps disabled", () => {
  const sentences = [{ text: "Hello world.", start: "00:00:00", end: "00:00:02" }];
  const md = formatMarkdown(sentences, baseMeta(), { timestamps: false, chapters: false, speakers: false });
  assert.doesNotMatch(md, /\[00:00:00/);
  assert.match(md, /Hello world\./);
});

test("formatMarkdown: speakers mode emits raw SRT transcript section instead of paragraphs", () => {
  const snippets: Snippet[] = [{ text: "Hello world.", start: 0, duration: 2 }];
  const md = formatMarkdown([], baseMeta(), { timestamps: true, chapters: false, speakers: true }, snippets);
  assert.match(md, /# Transcript\n\n1\n00:00:00,000 --> 00:00:02,000\nHello world\./);
});

test("formatListOutput: separates manual and generated transcripts", () => {
  const transcripts: TranscriptInfo[] = [
    { language: "English", languageCode: "en", isGenerated: false, isTranslatable: false, baseUrl: "", translationLanguages: [] },
    { language: "Russian", languageCode: "ru", isGenerated: true, isTranslatable: true, baseUrl: "", translationLanguages: [] },
  ];
  const out = formatListOutput("vid1", "My Video", transcripts);
  assert.match(out, /\(MANUALLY CREATED\)\n - en \("English"\)/);
  assert.match(out, /\(GENERATED\)\n - ru \("Russian"\) \[TRANSLATABLE\]/);
});

test("formatListOutput: reports 'None' when a bucket is empty", () => {
  const transcripts: TranscriptInfo[] = [
    { language: "English", languageCode: "en", isGenerated: false, isTranslatable: false, baseUrl: "", translationLanguages: [] },
  ];
  const out = formatListOutput("vid1", "", transcripts);
  assert.match(out, /\(GENERATED\)\nNone/);
});

test("findTranscript: returns the first language match in priority order", () => {
  const transcripts: TranscriptInfo[] = [
    { language: "Russian", languageCode: "ru", isGenerated: false, isTranslatable: false, baseUrl: "", translationLanguages: [] },
    { language: "English", languageCode: "en", isGenerated: false, isTranslatable: false, baseUrl: "", translationLanguages: [] },
  ];
  const found = findTranscript(transcripts, ["en", "ru"], false, false);
  assert.equal(found.languageCode, "en");
});

test("findTranscript: throws with available languages listed when nothing matches", () => {
  const transcripts: TranscriptInfo[] = [
    { language: "Russian", languageCode: "ru", isGenerated: false, isTranslatable: false, baseUrl: "", translationLanguages: [] },
  ];
  assert.throws(() => findTranscript(transcripts, ["en"], false, false), /No transcript found/);
});

test("findTranscript: excludeGenerated filters out auto-generated tracks", () => {
  const transcripts: TranscriptInfo[] = [
    { language: "English", languageCode: "en", isGenerated: true, isTranslatable: false, baseUrl: "", translationLanguages: [] },
  ];
  assert.throws(() => findTranscript(transcripts, ["en"], true, false), /No transcript found/);
});

test("parseTranscriptXml: extracts text, start, and duration from <text> elements", () => {
  const xml = `<transcript><text start="1.5" dur="2.5">Hello &amp; welcome</text></transcript>`;
  const snippets = parseTranscriptXml(xml);
  assert.equal(snippets.length, 1);
  assert.equal(snippets[0].text, "Hello & welcome");
  assert.equal(snippets[0].start, 1.5);
  assert.equal(snippets[0].duration, 2.5);
});

test("parseTranscriptPayload: dispatches to JSON parser for json3 payloads", () => {
  const payload = JSON.stringify({ events: [{ tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: "hi" }] }] });
  const snippets = parseTranscriptPayload(payload, "https://example.com/api?fmt=json3");
  assert.equal(snippets.length, 1);
  assert.equal(snippets[0].text, "hi");
});

test("parseTranscriptPayload: dispatches to XML parser by default", () => {
  const xml = `<transcript><text start="0" dur="1">hi</text></transcript>`;
  const snippets = parseTranscriptPayload(xml, "https://example.com/api");
  assert.equal(snippets.length, 1);
  assert.equal(snippets[0].text, "hi");
});

test("parseBracketed reads [start → end] [speaker] lines, dropping speaker tags and empty blocks", () => {
  const input = [
    "[00:00:00 → 00:00:29] [speaker_0] Всем здравствуйте.",
    "[00:02:25 → 00:02:54] ",
    "[01:00:05 -> 01:00:10] no speaker tag",
    "not a block",
  ].join("\n");
  assert.deepEqual(parseBracketed(input), [
    { text: "Всем здравствуйте.", start: 0, duration: 29 },
    { text: "no speaker tag", start: 3605, duration: 5 },
  ]);
});

test("parseTranscriptPayload routes the bracketed format to parseBracketed", () => {
  const snippets = parseTranscriptPayload("[00:00:01 → 00:00:03] [speaker_1] Привет.\n", "");
  assert.deepEqual(snippets, [{ text: "Привет.", start: 1, duration: 2 }]);
});
