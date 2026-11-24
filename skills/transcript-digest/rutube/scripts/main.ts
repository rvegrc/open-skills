#!/usr/bin/env bun
import { writeFileSync } from "fs";

import { createTranscriptRepository } from "@inbox/object-store";
import { join, resolve } from "path";

import { extractVideoId, slugify } from "./shared.ts";
import {
  ensureDir,
  hasCachedData,
  loadMeta,
  loadSentences,
  loadSnippets,
  lookupVideoDir,
  registerVideoDir,
  pullRemoteCache,
  pushRemote,
  resolveBaseDir,
} from "./storage.ts";
import { formatListOutput, formatMarkdown, formatSrt, findTranscript, segmentIntoSentences } from "./transcript.ts";
import type { Options, Sentence, Snippet, VideoMeta, VideoResult } from "./types.ts";
import {
  buildVideoMeta,
  downloadCoverImage,
  fetchTranscriptSnippets,
  fetchVideoSource,
  getThumbnailUrls,
  parseChapters,
} from "./rutube.ts";

async function fetchAndCache(
  videoId: string,
  baseDir: string,
  opts: Options
): Promise<{ meta: VideoMeta; snippets: Snippet[]; sentences: Sentence[]; videoDir: string }> {
  const source = await fetchVideoSource(videoId, opts.sourceUrls[videoId]);
  const transcript = findTranscript(source.transcripts, opts.languages, opts.excludeGenerated, opts.excludeManual);
  const { snippets, language, languageCode } = await fetchTranscriptSnippets(transcript);

  const chapters = parseChapters(source.info.description || "", Number(source.info.duration || 0));
  const languageMeta = { code: languageCode, name: language, isGenerated: transcript.isGenerated };
  const meta = buildVideoMeta(source.info, videoId, languageMeta, chapters);

  const videoDir = registerVideoDir(videoId, slugify(meta.channel), slugify(meta.title, 5), baseDir);
  ensureDir(join(videoDir, "meta.json"));

  writeFileSync(join(videoDir, "transcript-raw.json"), JSON.stringify(snippets, null, 2));

  const sentences = segmentIntoSentences(snippets);
  writeFileSync(join(videoDir, "transcript-sentences.json"), JSON.stringify(sentences, null, 2));

  const imagePath = join(videoDir, "imgs", "cover.jpg");
  ensureDir(imagePath);
  const downloaded = await downloadCoverImage(getThumbnailUrls(source.info), imagePath);
  meta.coverImage = downloaded ? "imgs/cover.jpg" : "";

  writeFileSync(join(videoDir, "meta.json"), JSON.stringify(meta, null, 2));

  return { meta, snippets, sentences, videoDir };
}

async function processVideo(videoId: string, opts: Options): Promise<VideoResult> {
  const baseDir = resolveBaseDir(opts.outputDir);
  const repo = createTranscriptRepository(process.env);

  if (opts.list) {
    const source = await fetchVideoSource(videoId, opts.sourceUrls[videoId]);
    return { videoId, title: source.info.title || "", content: formatListOutput(videoId, source.info.title || "", source.transcripts) };
  }

  let videoDir = lookupVideoDir(videoId, baseDir);
  let meta: VideoMeta;
  let snippets: Snippet[];
  let sentences: Sentence[];
  // Remote tier first: a hit here means another machine already fetched this video.
  if (!opts.refresh && (!videoDir || !hasCachedData(videoDir))) {
    const dir = videoDir ?? registerVideoDir(videoId, "cached", videoId, baseDir);
    if (await pullRemoteCache(repo, "rutube", videoId, dir)) videoDir = dir;
  }
  let needsFetch = opts.refresh || !videoDir || !hasCachedData(videoDir);

  if (!needsFetch && videoDir) {
    meta = loadMeta(videoDir);
    snippets = loadSnippets(videoDir);
    sentences = loadSentences(videoDir);
    if (!opts.languages.includes(meta.language.code)) needsFetch = true;
  }

  if (needsFetch) {
    const result = await fetchAndCache(videoId, baseDir, opts);
    meta = result.meta;
    snippets = result.snippets;
    sentences = result.sentences;
    videoDir = result.videoDir;
  } else {
    meta = meta!;
    snippets = snippets!;
    sentences = sentences!;
  }

  const content = opts.format === "srt"
    ? formatSrt(snippets)
    : formatMarkdown(
      sentences,
      meta,
      {
        timestamps: opts.timestamps,
        chapters: opts.chapters,
        speakers: opts.speakers,
      },
      snippets
    );
  const ext = opts.format === "srt" ? "srt" : "md";
  const filePath = opts.output ? resolve(opts.output) : join(videoDir!, `transcript.${ext}`);
  ensureDir(filePath);
  writeFileSync(filePath, content);

  await pushRemote(repo, "rutube", videoId, videoDir!, { title: meta.title, channel: meta.channel });

  return { videoId, title: meta.title, filePath };
}

function printHelp() {
  console.log(`Usage: bun main.ts <video-url-or-id> [options]

Options:
  --languages <codes>          Language codes, comma-separated (default: ru)
  --format <fmt>                Output format: text, srt (default: text)
  --list                        List available transcripts
  --timestamps                  Include timestamps (default: on)
  --no-timestamps               Disable timestamps
  --chapters                    Chapter segmentation from description
  --speakers                    Raw transcript with metadata for speaker identification
  --exclude-generated           Skip auto-generated transcripts
  --exclude-manually-created    Skip manually created transcripts
  --refresh                     Force re-fetch (ignore cache)
  -o, --output <path>           Save to specific file path
  --output-dir <dir>            Base output directory (default: tldr/rutube)
  -h, --help                    Show help`);
}

function parseArgs(argv: string[]): Options | null {
  const opts: Options = {
    videoIds: [],
    sourceUrls: {},
    languages: ["ru"],
    format: "text",
    translate: "",
    list: false,
    excludeGenerated: false,
    excludeManual: false,
    output: "",
    outputDir: "",
    timestamps: true,
    chapters: false,
    speakers: false,
    refresh: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    } else if (arg === "--languages") {
      const value = argv[++i];
      if (value) opts.languages = value.split(",").map((entry) => entry.trim());
    } else if (arg === "--format") {
      const value = argv[++i]?.toLowerCase();
      if (value === "text" || value === "srt") opts.format = value;
      else {
        console.error(`Invalid format: ${value}. Use: text, srt`);
        return null;
      }
    } else if (arg === "--list" || arg === "--list-transcripts") {
      opts.list = true;
    } else if (arg === "--timestamps" || arg === "-t") {
      opts.timestamps = true;
    } else if (arg === "--no-timestamps") {
      opts.timestamps = false;
    } else if (arg === "--chapters") {
      opts.chapters = true;
    } else if (arg === "--speakers") {
      opts.speakers = true;
    } else if (arg === "--exclude-generated") {
      opts.excludeGenerated = true;
    } else if (arg === "--exclude-manually-created") {
      opts.excludeManual = true;
    } else if (arg === "--refresh") {
      opts.refresh = true;
    } else if (arg === "-o" || arg === "--output") {
      opts.output = argv[++i] || "";
    } else if (arg === "--output-dir") {
      opts.outputDir = argv[++i] || "";
    } else if (!arg.startsWith("-")) {
      const id = extractVideoId(arg);
      opts.videoIds.push(id);
      if (/^https?:\/\//.test(arg)) opts.sourceUrls[id] = arg;
    }
  }

  if (opts.videoIds.length === 0) {
    console.error("Error: At least one video URL or ID required");
    printHelp();
    return null;
  }

  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts) process.exit(1);

  if (opts.excludeGenerated && opts.excludeManual) {
    console.error("Error: Cannot exclude both generated and manually created transcripts");
    process.exit(1);
  }

  for (const videoId of opts.videoIds) {
    try {
      const result = await processVideo(videoId, opts);
      if (result.error) console.error(`Error (${result.videoId}): ${result.error}`);
      else if (result.filePath) console.log(result.filePath);
      else if (result.content) console.log(result.content);
    } catch (error) {
      console.error(`Error (${videoId}): ${(error as Error).message}`);
    }
  }
}

if (import.meta.main) {
  main();
}
