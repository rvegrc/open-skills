/**
 * publish — final step for every sub-skill (youtube / rutube / local). Writes the exports of
 * transcript.md and chapters-summary.md into the video dir, then uploads everything to the object
 * store (S3 when S3_BUCKET is set, else the local FsObjectStore): raw JSON under
 * `<source>/<id>/raw/`, the two .md files and every export under `<source>/<id>/processed/`.
 *
 *   transcript.{json,srt,vtt,tsv}        one entry per timed sentence (transcript-sentences.json)
 *   chapters-summary.{json,srt,vtt,tsv}  one entry per chapter: title + its TLDR paragraph
 *   chapters.vtt                         title-only cues for a <track kind="chapters">
 *   {transcript,chapters-summary}.{docx,pdf}  the documents, via documents.py (uv env)
 *
 *   bun publish.ts <video-dir> [more dirs...]
 *
 * The id comes from the dir's meta.json (`videoId`); the source is the one whose id pattern it
 * matches — youtube (11 chars), rutube (32 hex) and local (64-hex content hash) never overlap.
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

import { assertSourceId, createTranscriptRepository, type ExportFilename, type Source } from "@inbox/object-store";

import {
  chapterCues,
  parseChapterHeadings,
  parseSummary,
  sentenceCues,
  summaryCues,
  summaryJson,
  summaryTsv,
  toSrt,
  toVtt,
  transcriptJson,
  transcriptTsv,
  type TimedText,
} from "./formats.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCUMENTS: ExportFilename[] = ["transcript.docx", "transcript.pdf", "chapters-summary.docx", "chapters-summary.pdf"];

const SOURCES: Source[] = ["youtube", "rutube", "local"];

function sourceOf(id: string): Source {
  const matches = SOURCES.filter((s) => {
    try {
      assertSourceId(s, id);
      return true;
    } catch {
      return false;
    }
  });
  if (matches.length !== 1) throw new Error(`meta.json videoId ${JSON.stringify(id)} matches no known source`);
  return matches[0];
}

function readOptional(path: string, fallback: string): string {
  return existsSync(path) ? readFileSync(path, "utf-8") : fallback;
}

/** DOCX + PDF through documents.py in the repo's uv env. A missing uv/Python must not block the upload of everything else. */
function renderDocuments(dir: string): ExportFilename[] {
  const cmd = ["uv", "run", "python", join(HERE, "documents.py"), join(dir, "transcript.md"), join(dir, "chapters-summary.md")];
  try {
    const run = Bun.spawnSync(cmd, { cwd: HERE, stdout: "pipe", stderr: "pipe" });
    if (run.exitCode === 0) return DOCUMENTS;
    console.warn(`documents.py failed, skipping DOCX/PDF:\n${run.stderr.toString().trim()}`);
  } catch (err) {
    console.warn(`cannot run uv, skipping DOCX/PDF: ${(err as Error).message}`);
  }
  return [];
}

async function publish(dir: string): Promise<void> {
  const metaPath = join(dir, "meta.json");
  if (!existsSync(metaPath)) throw new Error(`${dir}: no meta.json — re-run the sub-skill's main.ts first`);
  const metaJson = readFileSync(metaPath, "utf-8");
  const meta = JSON.parse(metaJson) as { videoId: string; title?: string; channel?: string; duration?: number };
  const source = sourceOf(meta.videoId);

  const transcript = readFileSync(join(dir, "transcript.md"), "utf-8");
  const summary = readFileSync(join(dir, "chapters-summary.md"), "utf-8");
  const snippetsJson = readOptional(join(dir, "transcript-raw.json"), "[]");
  const sentencesJson = readOptional(join(dir, "transcript-sentences.json"), "[]");

  const cues = sentenceCues(JSON.parse(sentencesJson) as TimedText[]);
  const parsed = parseSummary(summary);
  // A raw (not yet chaptered) transcript.md has no `##` chapters; the summary always does.
  const headings = parseChapterHeadings(transcript);
  const navChapters = headings.length ? headings : parsed.chapters;
  const lastEnd = cues.at(-1)?.end ?? 0;
  const lastStart = Math.max(0, ...navChapters.map((c) => c.start), ...parsed.chapters.map((c) => c.start));
  const end = Math.max(meta.duration ?? 0, Number.isFinite(lastEnd) ? lastEnd : 0, lastStart + 1);

  const texts: Partial<Record<ExportFilename, string>> = {};
  if (cues.length) {
    texts["transcript.json"] = transcriptJson(meta.title ?? "", cues);
    texts["transcript.srt"] = toSrt(cues);
    texts["transcript.vtt"] = toVtt(cues);
    texts["transcript.tsv"] = transcriptTsv(cues);
  }
  if (navChapters.length) texts["chapters.vtt"] = toVtt(chapterCues(navChapters, end, (c) => c.title));
  if (parsed.chapters.length) {
    texts["chapters-summary.json"] = summaryJson(parsed, end);
    texts["chapters-summary.srt"] = toSrt(summaryCues(parsed, end));
    texts["chapters-summary.vtt"] = toVtt(summaryCues(parsed, end));
    texts["chapters-summary.tsv"] = summaryTsv(parsed, end);
  }
  for (const [name, body] of Object.entries(texts)) writeFileSync(join(dir, name), body);
  const documents = renderDocuments(dir);

  const repo = createTranscriptRepository(process.env);
  const metadata = { title: meta.title ?? "", channel: meta.channel ?? "" };
  await repo.saveRaw(source, meta.videoId, { meta: metaJson, snippets: snippetsJson, sentences: sentencesJson }, metadata);
  const keys = await repo.saveProcessed(source, meta.videoId, { transcript, summary }, metadata);
  const exports: [ExportFilename, string | Buffer][] = [
    ...(Object.entries(texts) as [ExportFilename, string][]),
    ...documents.map((name) => [name, readFileSync(join(dir, name))] as [ExportFilename, Buffer]),
  ];
  await Promise.all(exports.map(([name, body]) => repo.saveExport(source, meta.videoId, name, body, metadata)));

  const names = exports.map(([name]) => name.split(".").pop());
  console.log(`published ${dir} -> ${keys.bucket}: ${source}/${meta.videoId}/processed/ md + ${exports.length} exports (${[...new Set(names)].join(", ")})`);
}

if (import.meta.main) {
  const dirs = process.argv.slice(2);
  if (!dirs.length) {
    console.error("Usage: bun publish.ts <video-dir> [more dirs...]");
    process.exit(1);
  }
  for (const dir of dirs) await publish(resolve(dir));
}
