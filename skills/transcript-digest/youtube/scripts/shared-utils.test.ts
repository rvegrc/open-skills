import test from "node:test";
import assert from "node:assert/strict";

import { slugify, htmlUnescape, stripTags, makeError } from "./shared.ts";

test("slugify: lowercases and hyphenates plain text", () => {
  assert.equal(slugify("Hello World"), "hello-world");
});

test("slugify: strips punctuation", () => {
  assert.equal(slugify("Wait, What?! Really..."), "wait-what-really");
});

test("slugify: collapses repeated whitespace/hyphens", () => {
  assert.equal(slugify("a   b---c"), "a-b-c");
});

test("slugify: trims leading/trailing hyphens", () => {
  assert.equal(slugify("  -leading and trailing-  "), "leading-and-trailing");
});

test("slugify: transliterates Cyrillic", () => {
  assert.equal(slugify("Привет мир"), "privet-mir");
});

test("slugify: empty/only-punctuation input falls back to 'untitled'", () => {
  assert.equal(slugify("???"), "untitled");
  assert.equal(slugify(""), "untitled");
});

test("slugify: without maxWords keeps every word", () => {
  assert.equal(slugify("one two three four five six"), "one-two-three-four-five-six");
});

test("slugify: with maxWords prefers non-stopword significant words", () => {
  // "the" and "of" are stopwords; with maxWords=2 it should skip them and take the next 2 significant words
  assert.equal(slugify("the lord of the rings", 2), "lord-rings");
});

test("slugify: with maxWords falls back to raw words when too few significant words remain", () => {
  // every word is a stopword, so significant.length (0) < maxWords -> falls back to the full word list
  assert.equal(slugify("the a an of", 2), "the-a");
});

test("slugify: maxWords never returns more words than requested", () => {
  const result = slugify("alpha beta gamma delta", 2);
  assert.equal(result.split("-").length, 2);
});

test("htmlUnescape: decodes named entities", () => {
  assert.equal(htmlUnescape("Tom &amp; Jerry"), "Tom & Jerry");
  assert.equal(htmlUnescape("&lt;tag&gt;"), "<tag>");
  assert.equal(htmlUnescape("&quot;quoted&quot;"), '"quoted"');
  assert.equal(htmlUnescape("&#39;s"), "'s");
  assert.equal(htmlUnescape("&apos;s"), "'s");
});

test("htmlUnescape: decodes hex and decimal numeric entities", () => {
  assert.equal(htmlUnescape("&#65;&#66;&#67;"), "ABC");
  assert.equal(htmlUnescape("&#x41;&#x42;&#x43;"), "ABC");
});

test("htmlUnescape: decodes slash entity", () => {
  assert.equal(htmlUnescape("a&#x2F;b"), "a/b");
});

test("htmlUnescape: leaves plain text untouched", () => {
  assert.equal(htmlUnescape("no entities here"), "no entities here");
});

test("stripTags: removes simple tags", () => {
  assert.equal(stripTags("<b>bold</b> text"), "bold text");
});

test("stripTags: removes self-closing and attributed tags", () => {
  assert.equal(stripTags('<br/> <a href="x">link</a>'), " link");
});

test("stripTags: leaves text with no angle brackets untouched", () => {
  assert.equal(stripTags("plain text, nothing to strip"), "plain text, nothing to strip");
});

test("stripTags: greedily strips everything between an unmatched < and the next >", () => {
  // documents the actual (naive regex) contract: this is not a full HTML parser
  assert.equal(stripTags("plain text < 5 and > 3"), "plain text  3");
});

test("makeError: returns a real Error with the given message", () => {
  const err = makeError("boom");
  assert.ok(err instanceof Error);
  assert.equal(err.message, "boom");
});

test("makeError: attaches code when provided", () => {
  const err = makeError("boom", "SOME_CODE") as Error & { code?: string };
  assert.equal(err.code, "SOME_CODE");
});

test("makeError: leaves code undefined when omitted", () => {
  const err = makeError("boom") as Error & { code?: string };
  assert.equal(err.code, undefined);
});
