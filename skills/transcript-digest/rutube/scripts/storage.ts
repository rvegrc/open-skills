import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";

import type { Source, TranscriptRepository } from "@inbox/object-store";

import type { Sentence, Snippet, VideoMeta } from "./types.ts";

export function ensureDir(path: string) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function resolveBaseDir(outputDir: string): string {
  return resolve(outputDir || "tldr/rutube");
}

function loadIndex(baseDir: string): Record<string, string> {
  try {
    return JSON.parse(readFileSync(join(baseDir, ".index.json"), "utf-8"));
  } catch {
    return {};
  }
}

function saveIndex(baseDir: string, index: Record<string, string>) {
  const path = join(baseDir, ".index.json");
  ensureDir(path);
  writeFileSync(path, JSON.stringify(index, null, 2));
}

export function lookupVideoDir(videoId: string, baseDir: string): string | null {
  const rel = loadIndex(baseDir)[videoId];
  if (rel) {
    const dir = resolve(baseDir, rel);
    if (existsSync(dir)) return dir;
  }
  return null;
}

export function registerVideoDir(videoId: string, channelSlug: string, titleSlug: string, baseDir: string): string {
  const rel = join(channelSlug, titleSlug);
  const index = loadIndex(baseDir);
  index[videoId] = rel;
  saveIndex(baseDir, index);
  return resolve(baseDir, rel);
}

export function hasCachedData(videoDir: string): boolean {
  return existsSync(join(videoDir, "meta.json")) && existsSync(join(videoDir, "transcript-raw.json"));
}

export function loadMeta(videoDir: string): VideoMeta {
  return JSON.parse(readFileSync(join(videoDir, "meta.json"), "utf-8"));
}

export function loadSnippets(videoDir: string): Snippet[] {
  return JSON.parse(readFileSync(join(videoDir, "transcript-raw.json"), "utf-8"));
}

export function loadSentences(videoDir: string): Sentence[] {
  return JSON.parse(readFileSync(join(videoDir, "transcript-sentences.json"), "utf-8"));
}

/**
 * Remote cache lookup. Keys come from the video id only, so the `.index.json`
 * read-modify-write race never applies to the remote tier. Returns false on a
 * miss; the caller then runs the normal fetch pipeline.
 */
export async function pullRemoteCache(
  repo: TranscriptRepository,
  source: Source,
  id: string,
  videoDir: string
): Promise<boolean> {
  const raw = await repo.findRaw(source, id);
  if (!raw) return false;

  ensureDir(join(videoDir, "meta.json"));
  writeFileSync(join(videoDir, "meta.json"), raw.meta);
  writeFileSync(join(videoDir, "transcript-raw.json"), raw.snippets);
  writeFileSync(join(videoDir, "transcript-sentences.json"), raw.sentences);
  return true;
}

/** Uploads whatever the local pipeline produced. Titles ride as metadata, never as key parts. */
export async function pushRemote(
  repo: TranscriptRepository,
  source: Source,
  id: string,
  videoDir: string,
  meta: { title?: string; channel?: string }
): Promise<void> {
  const read = (name: string) => readFileSync(join(videoDir, name), "utf-8");
  const metadata = { title: meta.title ?? "", channel: meta.channel ?? "" };

  await repo.saveRaw(
    source,
    id,
    {
      meta: read("meta.json"),
      snippets: read("transcript-raw.json"),
      sentences: read("transcript-sentences.json"),
    },
    metadata
  );

  if (existsSync(join(videoDir, "transcript.md")) && existsSync(join(videoDir, "chapters-summary.md"))) {
    await repo.saveProcessed(
      source,
      id,
      { transcript: read("transcript.md"), summary: read("chapters-summary.md") },
      metadata
    );
  }
}
