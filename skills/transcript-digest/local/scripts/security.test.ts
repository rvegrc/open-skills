import test from "node:test";
import assert from "node:assert/strict";

import { formatMarkdown } from "./transcript.ts";
import { slugify } from "./shared.ts";
import type { VideoMeta } from "./types.ts";

// Security contract: video titles/descriptions/channel names are untrusted,
// attacker-controlled strings (anyone can set a YouTube/Rutube video title).
// These tests pin down the properties that keep that untrusted data from
// corrupting the generated frontmatter or escaping the output directory.

function baseMeta(overrides: Partial<VideoMeta> = {}): VideoMeta {
  return {
    videoId: "abc123",
    title: "Test Video",
    channel: "Test Channel",
    channelId: "chan1",
    description: "",
    duration: 100,
    publishDate: "",
    url: "",
    coverImage: "",
    thumbnailUrl: "",
    language: { code: "en", name: "English", isGenerated: false },
    chapters: [],
    ...overrides,
  };
}

test("security/yaml: a title containing a colon cannot inject a second frontmatter key", () => {
  const md = formatMarkdown([], baseMeta({ title: 'evil title: injected_key: true' }), {
    timestamps: true,
    chapters: false,
    speakers: false,
  });
  const frontmatter = md.slice(0, md.indexOf("\n---\n", 4));
  // the whole hostile string must be captured inside ONE quoted `title:` value,
  // not parsed as a second top-level YAML key
  assert.match(frontmatter, /^title: "evil title: injected_key: true"$/m);
  assert.doesNotMatch(frontmatter, /^injected_key:/m);
});

test("security/yaml: an embedded double quote cannot break out of the quoted scalar", () => {
  const md = formatMarkdown([], baseMeta({ title: 'x" \ninjected: true\ntitle: "y' }), {
    timestamps: true,
    chapters: false,
    speakers: false,
  });
  const frontmatter = md.slice(0, md.indexOf("\n---\n", 4));
  // every embedded double quote must be backslash-escaped
  const titleLine = frontmatter.split("\n").find((l) => l.startsWith("title:"))!;
  assert.doesNotMatch(titleLine, /[^\\]"[^,\n]*"[^"]*"/); // no unescaped quote pair mid-value beyond the wrapping quotes
  assert.match(titleLine, /\\"/);
});

test("security/yaml: a title that is otherwise plain is left unquoted (no gratuitous escaping)", () => {
  const md = formatMarkdown([], baseMeta({ title: "Perfectly Normal Title" }), {
    timestamps: true,
    chapters: false,
    speakers: false,
  });
  assert.match(md, /^title: Perfectly Normal Title$/m);
});

test("security/path: slugify never emits a path separator regardless of input", () => {
  const hostiles = [
    "../../etc/passwd",
    "..\\..\\windows\\system32",
    "a/b/c",
    "a\\b\\c",
    "....//....//etc/passwd",
    "video: ../../../secrets",
  ];
  for (const hostile of hostiles) {
    const slug = slugify(hostile);
    assert.doesNotMatch(slug, /[\/\\]/, `slugify(${JSON.stringify(hostile)}) produced a path separator: ${slug}`);
  }
});

test("security/path: slugify never emits a bare '..' path segment", () => {
  const slug = slugify("..");
  assert.notEqual(slug, "..");
});

test("security/path: slugify output used as a directory name stays a single path segment", () => {
  // simulates the real call site: join(channelSlug, titleSlug) inside registerVideoDir
  const channelSlug = slugify("../../../tmp");
  const titleSlug = slugify("evil/../../title", 5);
  const combined = `${channelSlug}/${titleSlug}`;
  // exactly one separator: attacker input could not introduce extra traversal segments
  assert.equal(combined.split("/").length, 2);
  assert.ok(!combined.includes(".."));
});

test("security/dos: extractVideoId-style alternation regex resolves quickly on long adversarial input", () => {
  // regression guard: a pathological input should not cause catastrophic backtracking
  const pattern = /(?:youtube\.com\/watch\?.*v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/;
  const adversarial = "youtube.com/watch?" + "v=".repeat(20000) + "!";
  const start = performance.now();
  pattern.test(adversarial);
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 1000, `regex took ${elapsed}ms on adversarial input, expected < 1000ms`);
});
