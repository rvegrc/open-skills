/**
 * profiles — named model capability profiles for the shared transcript-digest orchestrator.
 *
 * Only context size matters for summary mode: the reply is a few thousand tokens on any model,
 * so there is no output budget here. `charsPerToken` is a coarse ratio — ~2.0 for Cyrillic,
 * ~4.0 for Latin scripts — good enough to decide how many chapters fit in one request.
 *
 * With nothing configured `resolveProfile` returns null and the caller keeps the existing
 * one-chapter-per-call path, so an unset environment behaves exactly as it did before.
 *
 * Note the documented model floor (see ../docs/speaker-identification.md): models below ~27B
 * fail this workload silently, so no profile smaller than qwen-27b/gemma-30b is offered here.
 */

export interface Profile {
  contextTokens: number;
  charsPerToken: number;
}

export const PROFILES: Record<string, Profile> = {
  sonnet: { contextTokens: 200_000, charsPerToken: 2.0 },
  opus: { contextTokens: 200_000, charsPerToken: 2.0 },
  gpt: { contextTokens: 128_000, charsPerToken: 2.0 },
  deepseek: { contextTokens: 128_000, charsPerToken: 2.0 },
  "qwen-27b": { contextTokens: 32_000, charsPerToken: 2.0 },
  "gemma-30b": { contextTokens: 32_000, charsPerToken: 2.0 },
};

export const PROFILE_NAMES = Object.keys(PROFILES).join(", ");

/** Fraction of the context window we are willing to fill with the prompt. */
const FILL = 0.8;

export function resolveProfile(env: Record<string, string | undefined>): Profile | null {
  const name = (env.TRANSCRIBE_PROFILE || "").trim().toLowerCase();
  const explicit = parseInt(env.TRANSCRIBE_CONTEXT_TOKENS || "", 10);
  const ratio = parseFloat(env.TRANSCRIBE_CHARS_PER_TOKEN || "");

  let base: Profile | null = null;
  if (name) {
    base = PROFILES[name] ?? null;
    if (!base) {
      throw new Error(
        `Unknown TRANSCRIBE_PROFILE "${name}". Valid: ${PROFILE_NAMES}. ` +
          `Or set TRANSCRIBE_CONTEXT_TOKENS directly for a model not listed.`
      );
    }
  }
  if (!base && !Number.isFinite(explicit)) return null;

  return {
    contextTokens: Number.isFinite(explicit) ? explicit : base!.contextTokens,
    charsPerToken: Number.isFinite(ratio) ? ratio : base?.charsPerToken ?? 2.0,
  };
}

/** Characters of transcript that fit one request, after the fixed prompt overhead. */
export function budgetChars(p: Profile, overheadChars: number): number {
  return Math.max(0, p.contextTokens * FILL * p.charsPerToken - overheadChars);
}

/**
 * Pack consecutive chapters into groups that each fit the context budget.
 *
 * Boundaries always fall on chapter boundaries, so every group is a valid prompt unit and its
 * output slots into the assembled file unchanged. A chapter larger than the whole budget throws
 * rather than being split mid-chapter, which would produce a garbled boundary.
 *
 * Returns arrays of chapter indices.
 */
export function packChapters(chapterChars: number[], p: Profile, overheadChars: number): number[][] {
  const budget = budgetChars(p, overheadChars);
  const groups: number[][] = [];
  let current: number[] = [];
  let used = 0;

  for (let i = 0; i < chapterChars.length; i++) {
    const size = chapterChars[i];
    if (size > budget) {
      throw new Error(
        `Chapter ${i + 1} alone (~${Math.round(size / p.charsPerToken)} tokens) exceeds the context ` +
          `budget (~${Math.round(budget / p.charsPerToken)} tokens). Use a larger TRANSCRIBE_PROFILE.`
      );
    }
    if (current.length && used + size > budget) {
      groups.push(current);
      current = [];
      used = 0;
    }
    current.push(i);
    used += size;
  }
  if (current.length) groups.push(current);
  return groups;
}
