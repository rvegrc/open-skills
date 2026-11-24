/**
 * Frontmatter safety for the shared orchestrator — the ONE security surface it adds.
 *
 * The speaker-labeled transcript.md reuses main.ts's already-escaped frontmatter verbatim,
 * so the only place chunk-and-label re-emits an untrusted value is the summary file's
 * `title:`/`video:`/`speakers:`. That escaping lives here, isolated, so `stryker.shared.conf.json`
 * can mutate exactly this surface (mirroring how each sub-skill mutates its shared.ts/transcript.ts)
 * — a surviving mutant here means the YAML-injection guarantee (security-contract #1) is no longer
 * actually enforced by a test.
 */

/** Quote+escape any value with YAML-significant chars or edge whitespace (matches transcript.ts). */
export function yamlEscape(value: string): string {
  if (/[:"'{}\[\]#&*!|>%@`\n]/.test(value) || value.trim() !== value) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

/**
 * Build the `chapters-summary.md` frontmatter block, escaping every untrusted value.
 *
 * `chaptersDerived` marks a file whose chapters were segmented by the model because the source
 * had none of its own — the timestamps are real subtitle starts, but the boundaries and titles
 * are inferred, and a reader deserves to know that.
 */
export function buildSummaryFrontmatter(
  title: string,
  video: string,
  speakers: string,
  opts: { chaptersDerived?: boolean } = {}
): string {
  const fm = ["---", `title: ${yamlEscape(title + " — chapter summary")}`, "source: transcript.md"];
  if (video) fm.push(`video: ${yamlEscape(video)}`);
  fm.push(`speakers: ${yamlEscape(speakers || "(solo)")}`);
  if (opts.chaptersDerived) fm.push("chapters: derived");
  fm.push("---");
  return fm.join("\n");
}
