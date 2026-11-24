import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { InMemoryObjectStore, TranscriptKeys, TranscriptRepository } from "@inbox/object-store";
import { pullRemoteCache, pushRemote } from "./storage.ts";

const YT = "dQw4w9WgXcQ";

function makeRepo() {
  const store = new InMemoryObjectStore();
  return { store, repo: new TranscriptRepository(store, new TranscriptKeys(""), "b") };
}

function seedLocalDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "yt-"));
  writeFileSync(join(dir, "meta.json"), '{"videoId":"x"}');
  writeFileSync(join(dir, "transcript-raw.json"), "[]");
  writeFileSync(join(dir, "transcript-sentences.json"), "[]");
  return dir;
}

describe("remote cache", () => {
  test("pullRemoteCache reports a miss", async () => {
    const { repo } = makeRepo();
    expect(await pullRemoteCache(repo, "youtube", YT, mkdtempSync(join(tmpdir(), "yt-")))).toBe(false);
  });

  test("pushRemote then pullRemoteCache restores the raw files", async () => {
    const { repo } = makeRepo();
    await pushRemote(repo, "youtube", YT, seedLocalDir(), { title: "T", channel: "C" });

    const dest = mkdtempSync(join(tmpdir(), "yt-"));
    expect(await pullRemoteCache(repo, "youtube", YT, dest)).toBe(true);
    expect(readFileSync(join(dest, "meta.json"), "utf-8")).toBe('{"videoId":"x"}');
    expect(readFileSync(join(dest, "transcript-raw.json"), "utf-8")).toBe("[]");
    expect(readFileSync(join(dest, "transcript-sentences.json"), "utf-8")).toBe("[]");
  });

  test("pushRemote uploads processed files when they exist", async () => {
    const { store, repo } = makeRepo();
    const dir = seedLocalDir();
    writeFileSync(join(dir, "transcript.md"), "# transcript");
    writeFileSync(join(dir, "chapters-summary.md"), "# summary");
    await pushRemote(repo, "youtube", YT, dir, { title: "T", channel: "C" });

    expect((await store.get(`youtube/${YT}/processed/transcript.md`)).toString()).toBe("# transcript");
    expect((await store.get(`youtube/${YT}/processed/chapters-summary.md`)).toString()).toBe("# summary");
  });

  test("pushRemote skips the processed tier when only raw files exist", async () => {
    const { store, repo } = makeRepo();
    await pushRemote(repo, "youtube", YT, seedLocalDir(), {});

    const keys: string[] = [];
    for await (const info of store.list("")) keys.push(info.key);
    expect(keys.some((k) => k.includes("/processed/"))).toBe(false);
  });

  test("an untrusted title never reaches the key", async () => {
    const { store, repo } = makeRepo();
    await pushRemote(repo, "youtube", YT, seedLocalDir(), { title: "../../etc/passwd", channel: "C" });

    const keys: string[] = [];
    for await (const info of store.list("")) keys.push(info.key);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => k.startsWith(`youtube/${YT}/`))).toBe(true);
  });

  test("a malformed video id throws instead of writing a shortened key", async () => {
    const { repo } = makeRepo();
    const dir = mkdtempSync(join(tmpdir(), "yt-"));
    expect(pullRemoteCache(repo, "youtube", "../../evil", dir)).rejects.toThrow(/invalid youtube id/);
  });
});
