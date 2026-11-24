#!/usr/bin/env bun
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { basename, dirname, extname, join, resolve } from "path";

import { createTranscriptRepository } from "@inbox/object-store";

import { slugify } from "./shared.ts";
import { BRACKETED_RE, formatMarkdown, parseTranscriptPayload, segmentIntoSentences } from "./transcript.ts";
import type { Options, Sentence, Snippet, VideoMeta } from "./types.ts";

function ensureDir(path: string) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function looksTimestamped(content: string): boolean {
  const normalized = content.trimStart();
  return (
    normalized.startsWith("{") ||
    normalized.startsWith("WEBVTT") ||
    /^\d+\s*\n\d{2}:\d{2}:\d{2},\d{3}\s*-->/.test(normalized) ||
    /<text\s+start="/.test(normalized) ||
    BRACKETED_RE.test(normalized.split("\n", 1)[0])
  );
}

function yamlEscape(value: string): string {
  if (/[:"'{}\[\]#&*!|>%@`\n]/.test(value) || value.trim() !== value) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

async function runDigest(opts: Options): Promise<string> {
  const raw = readFileSync(opts.inputFile, "utf-8");
  const title = opts.title || basename(opts.inputFile, extname(opts.inputFile));
  const baseDir = resolve(opts.outputDir || "tldr/local");
  const videoDir = join(baseDir, slugify(title, 5));
  // A local file has no platform id, so the content hash is its identity. The title
  // is untrusted and rides as object metadata — it never becomes part of a key.
  const contentHash = createHash("sha256").update(readFileSync(opts.inputFile)).digest("hex");

  const meta: VideoMeta = {
    videoId: contentHash,
    title,
    channel: opts.channel,
    channelId: "",
    description: "",
    duration: 0,
    publishDate: opts.date,
    url: opts.url,
    coverImage: "",
    thumbnailUrl: "",
    language: { code: "", name: "", isGenerated: false },
    chapters: [],
  };

  let outputMd: string;
  // Uploaded alongside the transcript so a re-run on another machine can reuse them.
  let snippetsJson = "[]";
  let sentencesJson = "[]";

  if (looksTimestamped(raw)) {
    const snippets: Snippet[] = parseTranscriptPayload(raw, "");
    if (!snippets.length) {
      throw new Error(
        `Input looked like a timestamped caption format but no snippets were parsed. Check the file is valid SRT/VTT/JSON3.`
      );
    }
    ensureDir(join(videoDir, "transcript-raw.json"));
    snippetsJson = JSON.stringify(snippets, null, 2);
    writeFileSync(join(videoDir, "transcript-raw.json"), snippetsJson);

    const sentences: Sentence[] = segmentIntoSentences(snippets);
    sentencesJson = JSON.stringify(sentences, null, 2);
    writeFileSync(join(videoDir, "transcript-sentences.json"), sentencesJson);

    meta.duration = snippets.length ? snippets[snippets.length - 1].start + snippets[snippets.length - 1].duration : 0;
    // Raw SRT + frontmatter, ready for AI speaker/chapter post-processing (mirrors the video-transcript skills' --speakers output).
    outputMd = formatMarkdown(sentences, meta, { timestamps: true, chapters: false, speakers: true }, snippets);
  } else {
    // Plain prose, no timestamps to key off of — hand the raw text straight to the AI post-processing step.
    let md = "---\n";
    md += `title: ${yamlEscape(meta.title)}\n`;
    if (meta.channel) md += `channel: ${yamlEscape(meta.channel)}\n`;
    if (meta.publishDate) md += `date: ${meta.publishDate}\n`;
    if (meta.url) md += `url: ${yamlEscape(meta.url)}\n`;
    md += "---\n\n";
    md += `# ${meta.title}\n\n`;
    md += `# Transcript (no timestamps in source)\n\n`;
    md += raw.trim() + "\n";
    outputMd = md;
  }

  const filePath = opts.output ? resolve(opts.output) : join(videoDir, "transcript.md");
  ensureDir(filePath);
  writeFileSync(filePath, outputMd);

  // meta.json carries the id that publish.ts keys the processed upload by.
  const metaJson = JSON.stringify(meta, null, 2);
  ensureDir(join(videoDir, "meta.json"));
  writeFileSync(join(videoDir, "meta.json"), metaJson);

  const repo = createTranscriptRepository(process.env);
  await repo.saveRaw(
    "local",
    contentHash,
    { meta: metaJson, snippets: snippetsJson, sentences: sentencesJson },
    { title: meta.title ?? "", channel: meta.channel ?? "" }
  );

  return filePath;
}

function printHelp() {
  console.log(`Usage: bun main.ts <input-file> [options]

Options:
  --title <text>        Video/episode title (default: input filename)
  --channel <text>       Channel/author name
  --url <text>           Source URL, for reference in frontmatter
  --date <YYYY-MM-DD>     Publish date
  -o, --output <path>    Save to specific file path
  --output-dir <dir>     Base output directory (default: tldr/local)
  -h, --help              Show help

Detects SRT/VTT/JSON3/YouTube-XML caption formats automatically (by content, not extension)
and produces sentence-segmented, timestamped raw output. Falls back to treating the file as
plain prose (no timestamps) if none of those formats are detected.`);
}

function parseArgs(argv: string[]): Options | null {
  const opts: Options = {
    inputFile: "",
    title: "",
    channel: "",
    url: "",
    date: "",
    output: "",
    outputDir: "",
    timestamps: true,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    } else if (arg === "--title") {
      opts.title = argv[++i] || "";
    } else if (arg === "--channel") {
      opts.channel = argv[++i] || "";
    } else if (arg === "--url") {
      opts.url = argv[++i] || "";
    } else if (arg === "--date") {
      opts.date = argv[++i] || "";
    } else if (arg === "-o" || arg === "--output") {
      opts.output = argv[++i] || "";
    } else if (arg === "--output-dir") {
      opts.outputDir = argv[++i] || "";
    } else if (!arg.startsWith("-")) {
      opts.inputFile = arg;
    }
  }

  if (!opts.inputFile) {
    console.error("Error: input transcript file path required");
    printHelp();
    return null;
  }
  if (!existsSync(opts.inputFile)) {
    console.error(`Error: file not found: ${opts.inputFile}`);
    return null;
  }

  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts) process.exit(1);

  try {
    const filePath = await runDigest(opts);
    console.log(filePath);
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    process.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
