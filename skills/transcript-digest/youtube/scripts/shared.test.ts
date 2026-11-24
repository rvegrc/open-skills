import test from "node:test";
import assert from "node:assert/strict";

import {
  extractVideoId,
  normalizeError,
  shouldTryAlternateClient,
  shouldTryYtDlpFallback,
  normalizePublishDate,
} from "./shared.ts";

test("extractVideoId: extracts id from watch URL", () => {
  assert.equal(extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
});

test("extractVideoId: extracts id from watch URL with extra query params before v=", () => {
  assert.equal(extractVideoId("https://www.youtube.com/watch?list=abc&v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
});

test("extractVideoId: extracts id from short youtu.be URL", () => {
  assert.equal(extractVideoId("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
});

test("extractVideoId: extracts id from embed URL", () => {
  assert.equal(extractVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
});

test("extractVideoId: extracts id from /v/ URL", () => {
  assert.equal(extractVideoId("https://www.youtube.com/v/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
});

test("extractVideoId: extracts id from shorts URL", () => {
  assert.equal(extractVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
});

test("extractVideoId: accepts a bare 11-char id", () => {
  assert.equal(extractVideoId("dQw4w9WgXcQ"), "dQw4w9WgXcQ");
});

test("extractVideoId: strips backslashes and trims whitespace", () => {
  assert.equal(extractVideoId("  dQw4w9WgXcQ\\  "), "dQw4w9WgXcQ");
});

test("extractVideoId: returns the raw input unchanged when nothing matches", () => {
  assert.equal(extractVideoId("not a video id at all"), "not a video id at all");
});

test("normalizeError: leaves an already-coded error untouched", () => {
  const err = Object.assign(new Error("whatever"), { code: "ALREADY_SET" });
  const result = normalizeError(err);
  assert.equal(result.code, "ALREADY_SET");
});

test("normalizeError: maps known message substrings to codes", () => {
  const cases: [string, string][] = [
    ["bot detected on this request", "BOT_DETECTED"],
    ["age restricted content", "AGE_RESTRICTED"],
    ["Video unavailable", "VIDEO_UNAVAILABLE"],
    ["transcripts disabled for this video", "TRANSCRIPTS_DISABLED"],
    ["no transcript found for ru", "NO_TRANSCRIPT"],
    ["invalid video id supplied", "INVALID_VIDEO_ID"],
    ["ip blocked by server", "IP_BLOCKED"],
    ["recaptcha challenge", "IP_BLOCKED"],
    ["http 429 too many requests", "IP_BLOCKED"],
    ["cannot extract api key", "PAGE_FETCH_FAILED"],
    ["innertube api error", "INNERTUBE_REJECTED"],
    ["http 403 forbidden", "INNERTUBE_REJECTED"],
    ["yt-dlp fallback failed", "YT_DLP_FAILED"],
  ];
  for (const [message, expectedCode] of cases) {
    const result = normalizeError(new Error(message));
    assert.equal(result.code, expectedCode, `expected code ${expectedCode} for message "${message}"`);
  }
});

test("normalizeError: unrecognized message gets no code", () => {
  const result = normalizeError(new Error("some totally unrelated failure"));
  assert.equal(result.code, undefined);
});

test("normalizeError: non-Error values become an UNKNOWN-coded error", () => {
  const result = normalizeError("just a string");
  assert.equal(result.code, "UNKNOWN");
  assert.equal(result.message, "just a string");
});

test("shouldTryAlternateClient: true for retryable codes", () => {
  for (const message of ["bot detected", "ip blocked", "innertube api", "age restricted", "video unavailable"]) {
    assert.equal(shouldTryAlternateClient(new Error(message)), true, message);
  }
});

test("shouldTryAlternateClient: false for a non-retryable code", () => {
  assert.equal(shouldTryAlternateClient(new Error("transcripts disabled")), false);
});

test("shouldTryYtDlpFallback: true for fallback-eligible codes including PAGE_FETCH_FAILED", () => {
  assert.equal(shouldTryYtDlpFallback(new Error("cannot extract api key")), true);
});

test("shouldTryYtDlpFallback: false for a non-fallback code", () => {
  assert.equal(shouldTryYtDlpFallback(new Error("transcripts disabled")), false);
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

test("extractVideoId: extracts id from live URL", () => {
  assert.equal(extractVideoId("https://www.youtube.com/live/rQWGshpC1rc"), "rQWGshpC1rc");
});
