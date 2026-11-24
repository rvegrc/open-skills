import { describe, expect, test } from "bun:test";

import { PROFILES, PROFILE_NAMES, budgetChars, packChapters, resolveProfile } from "./profiles.ts";

describe("resolveProfile", () => {
  test("every named profile has a positive context budget", () => {
    for (const name of ["sonnet", "opus", "gpt", "deepseek", "qwen-27b", "gemma-30b"]) {
      expect(PROFILES[name].contextTokens).toBeGreaterThan(0);
      expect(PROFILES[name].charsPerToken).toBeGreaterThan(0);
    }
  });

  test("returns null when nothing is set, so callers keep the per-chapter default", () => {
    expect(resolveProfile({})).toBeNull();
  });

  test("looks a named profile up case-insensitively", () => {
    expect(resolveProfile({ TRANSCRIBE_PROFILE: "Sonnet" })).toEqual(PROFILES.sonnet);
  });

  test("an explicit context budget overrides the named profile", () => {
    const p = resolveProfile({ TRANSCRIBE_PROFILE: "qwen-27b", TRANSCRIBE_CONTEXT_TOKENS: "200000" });
    expect(p!.contextTokens).toBe(200_000);
  });

  test("an explicit context budget alone defines a profile", () => {
    expect(resolveProfile({ TRANSCRIBE_CONTEXT_TOKENS: "128000" })!.contextTokens).toBe(128_000);
  });

  test("an explicit chars-per-token ratio overrides the profile's", () => {
    expect(resolveProfile({ TRANSCRIBE_PROFILE: "opus", TRANSCRIBE_CHARS_PER_TOKEN: "4" })!.charsPerToken).toBe(4);
  });

  test("an unknown profile name throws, listing the valid names", () => {
    expect(() => resolveProfile({ TRANSCRIBE_PROFILE: "llama-9b" })).toThrow(/qwen-27b/);
    expect(PROFILE_NAMES).toContain("gemma-30b");
  });
});

describe("packChapters", () => {
  const p = { contextTokens: 1000, charsPerToken: 2 }; // budget = 1000*0.8*2 = 1600 chars, minus overhead

  test("packs consecutive chapters up to the budget, then starts a new group", () => {
    // budget with 600 chars overhead = 1000 chars
    expect(packChapters([400, 400, 400], p, 600)).toEqual([[0, 1], [2]]);
  });

  test("keeps everything in one group when it all fits", () => {
    expect(packChapters([100, 100, 100], p, 600)).toEqual([[0, 1, 2]]);
  });

  test("gives each chapter its own group when the budget is tiny", () => {
    expect(packChapters([90, 90, 90], p, 1500)).toEqual([[0], [1], [2]]);
  });

  test("never splits a chapter: one larger than the whole budget throws, naming it", () => {
    expect(() => packChapters([100, 5000], p, 600)).toThrow(/Chapter 2/);
  });

  test("returns no groups for no chapters", () => {
    expect(packChapters([], p, 600)).toEqual([]);
  });

  test("budgetChars never goes negative when overhead exceeds the window", () => {
    expect(budgetChars(p, 999_999)).toBe(0);
  });
});

describe("profile edge cases (mutation gate)", () => {
  test("PROFILE_NAMES is a readable comma-separated list, not a run-on string", () => {
    expect(PROFILE_NAMES).toContain(", ");
    expect(PROFILE_NAMES.split(", ").length).toBe(Object.keys(PROFILES).length);
  });

  test("surrounding whitespace in the profile name is trimmed", () => {
    expect(resolveProfile({ TRANSCRIBE_PROFILE: "  sonnet \n" })).toEqual(PROFILES.sonnet);
  });

  test("an explicit context budget without a named profile still gets a default ratio", () => {
    const p = resolveProfile({ TRANSCRIBE_CONTEXT_TOKENS: "128000" })!;
    expect(p.charsPerToken).toBe(2.0);
  });

  test("the unknown-profile error points at the escape hatch", () => {
    expect(() => resolveProfile({ TRANSCRIBE_PROFILE: "llama-9b" })).toThrow(/TRANSCRIBE_CONTEXT_TOKENS/);
  });
});

describe("packChapters boundaries (mutation gate)", () => {
  const p = { contextTokens: 1000, charsPerToken: 2 }; // 1.6 * 1000 = 1600 chars before overhead

  test("a chapter exactly the size of the budget is packed, not rejected", () => {
    // budget = 1600 - 600 = 1000
    expect(budgetChars(p, 600)).toBe(1000);
    expect(packChapters([1000], p, 600)).toEqual([[0]]);
  });

  test("chapters that exactly fill the budget stay in one group", () => {
    expect(packChapters([600, 400], p, 600)).toEqual([[0, 1]]);
  });

  test("one char over the budget starts a new group", () => {
    expect(packChapters([600, 401], p, 600)).toEqual([[0], [1]]);
  });

  test("the oversize error reports sizes in tokens, not characters", () => {
    // chapter 2000 chars / 2 = 1000 tokens; budget 1000 chars / 2 = 500 tokens
    expect(() => packChapters([2000], p, 600)).toThrow(/1000 tokens/);
    expect(() => packChapters([2000], p, 600)).toThrow(/500 tokens/);
    expect(() => packChapters([2000], p, 600)).toThrow(/larger TRANSCRIBE_PROFILE/);
  });
});
