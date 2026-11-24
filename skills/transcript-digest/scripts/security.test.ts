import { describe, expect, test } from "bun:test";

import { assembleSummary, parseRawTranscript, yamlEscape } from "./chunk-and-label.ts";

/**
 * Security guarantees for the shared chunk-and-label orchestrator.
 *
 * This orchestrator deliberately reuses the raw transcript.md frontmatter VERBATIM
 * (already escaped by each sub-skill's main.ts, security-contract guarantee #1), so the
 * transcript file adds no new YAML-injection surface. The ONE place it re-emits an
 * untrusted value is the summary file's `title:` — covered here.
 */

describe("security/yaml: summary title escaping", () => {
  test("a title with YAML-significant chars cannot inject a second key", () => {
    const raw = parseRawTranscript(
      `---\ntitle: "evil: injected"\ncover: c.jpg\nurl: u\nspeakers: s\n---\n# x\n`
    );
    const md = assembleSummary(raw, "", "s", "tldr", []);
    const fm = md.split("---")[1];
    // exactly one `title:` line, and it must be a quoted scalar (not two keys)
    const titleLines = fm.split("\n").filter((l) => l.startsWith("title:"));
    expect(titleLines).toHaveLength(1);
    expect(titleLines[0]).toBe(`title: "evil: injected — chapter summary"`);
  });

  test("newline / quote in title cannot break out of the scalar", () => {
    const escaped = yamlEscape(`a"\nmalicious: true`);
    // Wrapped in a double-quoted scalar (multi-line quoted scalars are valid YAML
    // line-folding, so the embedded newline stays INSIDE the value, not a new key)...
    expect(escaped.startsWith('"')).toBe(true);
    expect(escaped.endsWith('"')).toBe(true);
    // ...and the attacker's own `"` is escaped so it cannot close the scalar early.
    expect(escaped).toContain('\\"');
    // The first physical line is an open, unterminated quoted scalar — a YAML parser
    // keeps consuming until the closing quote, so `malicious:` is never a top-level key.
    const firstLine = escaped.split("\n")[0];
    expect(firstLine).toBe('"a\\"');
  });

  test("plain titles are not gratuitously quoted", () => {
    expect(yamlEscape("Just A Normal Title")).toBe("Just A Normal Title");
  });

  test("leading/trailing whitespace forces quoting (even with no special chars)", () => {
    // kills the `value.trim() !== value` branch mutant
    expect(yamlEscape("  spaced  ")).toBe('"  spaced  "');
    expect(yamlEscape("trailing ")).toBe('"trailing "');
  });

  test("backslashes are doubled before the value is quoted", () => {
    // kills the `.replace(/\\/g, "\\\\")` mutant — trigger quoting with a newline
    expect(yamlEscape("a\\b\nc")).toBe('"a\\\\b\nc"');
  });

  test("empty speakers become the (solo) default in the summary frontmatter", () => {
    const raw = parseRawTranscript(`---\ntitle: T\ncover: c\n---\n# x\n`);
    const md = assembleSummary(raw, "", "", "tldr", []);
    expect(md.split("\n").filter((l) => l.startsWith("speakers:"))).toEqual(["speakers: (solo)"]);
  });

  test("frontmatter is a well-formed block: source label, closing ---, no empty video line", () => {
    const raw = parseRawTranscript(`---\ntitle: T\ncover: c\n---\n# x\n`);
    const md = assembleSummary(raw, "", "s", "tldr", []); // empty video → line must be omitted
    const fmLines = md.slice(0, md.indexOf("\n\n")).split("\n");
    expect(fmLines[0]).toBe("---"); // opening delimiter
    expect(fmLines).toContain("source: transcript.md");
    expect(fmLines[fmLines.length - 1]).toBe("---"); // closing delimiter present
    expect(fmLines.some((l) => l.startsWith("video:"))).toBe(false); // no `video:` when empty
  });

  test("video url with special chars is escaped in the summary frontmatter", () => {
    const raw = parseRawTranscript(`---\ntitle: T\ncover: c\n---\n# x\n`);
    const md = assembleSummary(raw, `u"\ninjected: 1`, "s", "t", []);
    const videoLines = md.split("\n").filter((l) => l.startsWith("video:"));
    expect(videoLines).toHaveLength(1);
    expect(videoLines[0].startsWith('video: "')).toBe(true);
  });
});
