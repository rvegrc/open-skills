/**
 * Timed text formats for the transcript and the chapter summary: JSON, SRT, VTT, TSV.
 * Everything funnels through one `Cue[]` list, so the four writers share timing and cleanup.
 * Pure functions, source-agnostic — publish.ts does the file I/O (DOCX/PDF: documents.py).
 *
 * Cue text is untrusted transcript/title text (security-contract: injection):
 *  - SRT/VTT: every line is flattened, so a blank line or `-->` can never start a forged cue;
 *    VTT additionally entity-escapes `& < >` because its payload understands tags and entities.
 *  - TSV: tabs/newlines are flattened, and a cell starting with `= + - @` gets a leading `'`
 *    so a spreadsheet opening the file never evaluates it as a formula.
 */

export interface TimedText {
  text: string;
  start: string;
  end: string;
}

export interface Chapter {
  title: string;
  start: number;
}

export interface SummaryChapter extends Chapter {
  summary: string;
  bullets: string[];
}

export interface Summary {
  title: string;
  tldr: string;
  chapters: SummaryChapter[];
}

/** One timed entry; `text` may hold several lines separated by "\n". */
export interface Cue {
  start: number;
  end: number;
  text: string;
}

/** "HH:MM:SS", "H:MM:SS" or "HH:MM:SS.mmm" → seconds; NaN when malformed. */
export function parseTime(time: string): number {
  const m = time.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})(?:[.,](\d{1,3}))?$/);
  if (!m) return NaN;
  return +m[1] * 3600 + +m[2] * 60 + +m[3] + (m[4] ? +m[4].padEnd(3, "0") / 1000 : 0);
}

function clock(seconds: number, msSep: string): string {
  const ms = Math.round(seconds * 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}${msSep}${pad(ms % 1000, 3)}`;
}

export const vttTime = (seconds: number) => clock(seconds, ".");
export const srtTime = (seconds: number) => clock(seconds, ",");

export function flatten(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function escapeCueText(text: string): string {
  return flatten(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Never zero-length: a cue whose end is not after its start lasts one second. */
function cueEnd(cue: Cue): number {
  return cue.end > cue.start ? cue.end : cue.start + 1;
}

function cueLines(text: string, clean: (line: string) => string): string {
  return text.split("\n").map(clean).filter(Boolean).join("\n");
}

export function sentenceCues(sentences: TimedText[]): Cue[] {
  const cues: Cue[] = [];
  for (const s of sentences) {
    const text = flatten(s.text);
    const start = parseTime(s.start);
    if (!text || Number.isNaN(start)) continue;
    cues.push({ start, end: parseTime(s.end), text });
  }
  return cues;
}

/** Each chapter runs until the next one starts; the last one until `endSeconds`. */
export function chapterCues<T extends Chapter>(chapters: T[], endSeconds: number, text: (c: T) => string): Cue[] {
  return chapters.map((c, i) => ({
    start: c.start,
    end: i + 1 < chapters.length ? chapters[i + 1].start : endSeconds,
    text: text(c),
  }));
}

export function toVtt(cues: Cue[]): string {
  const blocks = cues.map((c) => `${vttTime(c.start)} --> ${vttTime(cueEnd(c))}\n${cueLines(c.text, escapeCueText)}`);
  return ["WEBVTT", ...blocks].join("\n\n") + "\n";
}

export function toSrt(cues: Cue[]): string {
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(cueEnd(c))}\n${cueLines(c.text, flatten)}`).join("\n\n") + "\n";
}

export function tsvCell(value: string): string {
  const cell = flatten(value);
  return /^[=+\-@]/.test(cell) ? `'${cell}` : cell;
}

export function toTsv(header: string[], rows: string[][]): string {
  return [header, ...rows].map((row) => row.map(tsvCell).join("\t")).join("\n") + "\n";
}

// ---- transcript -------------------------------------------------------------------------

export function transcriptJson(title: string, cues: Cue[]): string {
  return JSON.stringify({ title, segments: cues.map((c) => ({ start: c.start, end: cueEnd(c), text: c.text })) }, null, 2) + "\n";
}

export function transcriptTsv(cues: Cue[]): string {
  return toTsv(["start", "end", "text"], cues.map((c) => [vttTime(c.start), vttTime(cueEnd(c)), c.text]));
}

// ---- chapter headings and the summary document ------------------------------------------

const HEADING_TIME_LAST = /^##\s+(.+?)\s+\[(\d{1,2}:\d{2}:\d{2})\]\s*$/;
const HEADING_TIME_FIRST = /^##\s+\[(\d{1,2}:\d{2}:\d{2})\]\s*(?:[—–-]\s*)?(.+?)\s*$/;

/** A chapter heading in either format the skills produce: `## Title [HH:MM:SS]` or `## [HH:MM:SS] (— )Title`. */
function matchHeading(line: string): Chapter | null {
  const last = line.match(HEADING_TIME_LAST);
  if (last) return { title: last[1], start: parseTime(last[2]) };
  const first = line.match(HEADING_TIME_FIRST);
  return first ? { title: first[2], start: parseTime(first[1]) } : null;
}

export function parseChapterHeadings(markdown: string): Chapter[] {
  return markdown.split("\n").map(matchHeading).filter((c): c is Chapter => c !== null);
}

/** chapters-summary.md → title (frontmatter), the `# TLDR` block, and each chapter's paragraph + bullets. */
export function parseSummary(markdown: string): Summary {
  const fm = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  const titleLine = fm?.[1].split("\n").find((l) => l.startsWith("title:"));
  const title = titleLine ? titleLine.slice(6).trim().replace(/^"(.*)"$/, "$1") : "";

  const summary: Summary = { title, tldr: "", chapters: [] };
  const tldr: string[] = [];
  let section = "";
  let current: SummaryChapter | null = null;
  for (const raw of markdown.slice(fm ? fm[0].length : 0).split("\n")) {
    const line = raw.trim();
    const h1 = line.match(/^#\s+(.+)$/);
    if (h1) {
      section = h1[1].trim().toLowerCase();
      current = null;
      continue;
    }
    const heading = matchHeading(line);
    if (heading) {
      current = { ...heading, summary: "", bullets: [] };
      summary.chapters.push(current);
      continue;
    }
    if (!line) continue;
    if (section === "tldr") tldr.push(line);
    else if (current) {
      const bullet = line.match(/^[-*]\s+(.+)$/);
      if (bullet) current.bullets.push(bullet[1]);
      else current.summary = flatten(`${current.summary} ${line}`);
    }
  }
  summary.tldr = tldr.join("\n");
  return summary;
}

/** Summary cues carry the chapter title on the first line and its TLDR paragraph on the second. */
export function summaryCues(summary: Summary, endSeconds: number): Cue[] {
  return chapterCues(summary.chapters, endSeconds, (c) => `${c.title}\n${c.summary}`);
}

export function summaryJson(summary: Summary, endSeconds: number): string {
  const chapters = chapterCues(summary.chapters, endSeconds, () => "").map((cue, i) => ({
    title: summary.chapters[i].title,
    start: cue.start,
    end: cueEnd(cue),
    summary: summary.chapters[i].summary,
    bullets: summary.chapters[i].bullets,
  }));
  return JSON.stringify({ title: summary.title, tldr: summary.tldr, chapters }, null, 2) + "\n";
}

export function summaryTsv(summary: Summary, endSeconds: number): string {
  const rows = chapterCues(summary.chapters, endSeconds, () => "").map((cue, i) => {
    const c = summary.chapters[i];
    return [vttTime(cue.start), vttTime(cueEnd(cue)), c.title, c.summary, c.bullets.join(" • ")];
  });
  return toTsv(["start", "end", "title", "summary", "bullets"], rows);
}
