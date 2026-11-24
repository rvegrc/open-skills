import test from "node:test";
import assert from "node:assert/strict";

import { extractVideoId, normalizeError, normalizePublishDate } from "./shared.ts";

test("extractVideoId: extracts id from a rutube.ru/video/ URL", () => {
  const id = "a".repeat(32);
  assert.equal(extractVideoId(`https://rutube.ru/video/${id}/`), id);
});

test("extractVideoId: extracts id from a rutube.ru/play/embed/ URL", () => {
  const id = "b".repeat(32);
  assert.equal(extractVideoId(`https://rutube.ru/play/embed/${id}`), id);
});

test("extractVideoId: extracts id from a rutube.ru/video/private/ URL", () => {
  const id = "c".repeat(32);
  assert.equal(extractVideoId(`https://rutube.ru/video/private/${id}/?p=abc`), id);
});

test("extractVideoId: accepts a bare 32-char hex id", () => {
  const id = "d".repeat(32);
  assert.equal(extractVideoId(id), id);
});

test("extractVideoId: strips backslashes and trims whitespace", () => {
  const id = "e".repeat(32);
  assert.equal(extractVideoId(`  ${id}\\  `), id);
});

test("extractVideoId: returns the raw input unchanged when nothing matches", () => {
  assert.equal(extractVideoId("not a video id at all"), "not a video id at all");
});

test("normalizeError: leaves an already-coded error untouched", () => {
  const err = Object.assign(new Error("whatever"), { code: "ALREADY_SET" });
  assert.equal(normalizeError(err).code, "ALREADY_SET");
});

test("normalizeError: maps known message substrings to codes", () => {
  const cases: [string, string][] = [
    ["Video unavailable", "VIDEO_UNAVAILABLE"],
    ["transcripts disabled for this video", "TRANSCRIPTS_DISABLED"],
    ["no transcript found for ru", "NO_TRANSCRIPT"],
    ["invalid video id supplied", "INVALID_VIDEO_ID"],
    ["this video is private", "VIDEO_PRIVATE"],
    ["yt-dlp reports track unavailable", "YT_DLP_UNAVAILABLE"],
    ["yt-dlp failed to fetch", "YT_DLP_FAILED"],
  ];
  for (const [message, expectedCode] of cases) {
    assert.equal(normalizeError(new Error(message)).code, expectedCode, `expected code ${expectedCode} for message "${message}"`);
  }
});

test("normalizeError: unrecognized message gets no code", () => {
  assert.equal(normalizeError(new Error("some totally unrelated failure")).code, undefined);
});

test("normalizeError: non-Error values become an UNKNOWN-coded error", () => {
  const result = normalizeError("just a string");
  assert.equal(result.code, "UNKNOWN");
  assert.equal(result.message, "just a string");
});

test("normalizePublishDate: converts YYYYMMDD to YYYY-MM-DD", () => {
  assert.equal(normalizePublishDate("20260115"), "2026-01-15");
});

test("normalizePublishDate: passes through a non-8-digit value unchanged", () => {
  assert.equal(normalizePublishDate("2026-01-15"), "2026-01-15");
});

test("normalizePublishDate: returns empty string for undefined", () => {
  assert.equal(normalizePublishDate(undefined), "");
});
