import { createHash } from "node:crypto";
import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Track } from "@baize/types";
import { parseFile } from "music-metadata";

const SUPPORTED_AUDIO_EXTENSIONS = new Set([".mp3", ".flac", ".wav", ".m4a", ".ogg"]);
const SUPPORTED_COVER_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

const thisFile = fileURLToPath(import.meta.url);
const thisDir = path.dirname(thisFile);
const defaultMusicDir = path.resolve(thisDir, "../../../../../music");

export interface TrackAssetRecord {
  track: Track;
  audioFilePath: string;
  lyricFilePath?: string;
  coverFilePath?: string;
  embeddedCover?: {
    data: Uint8Array;
    mimeType: string;
  };
}

function createTrackId(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 16);
}

function parseArtistAndTitle(baseName: string): { artist: string; title: string } {
  const separator = " - ";
  if (!baseName.includes(separator)) {
    return {
      artist: "Unknown Artist",
      title: baseName
    };
  }

  const [artist, ...titleParts] = baseName.split(separator);
  const title = titleParts.join(separator).trim();
  return {
    artist: artist.trim() || "Unknown Artist",
    title: title || baseName
  };
}

async function walkMusicDir(dirPath: string): Promise<string[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const filePaths: string[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const childFiles = await walkMusicDir(absolutePath);
      filePaths.push(...childFiles);
      continue;
    }

    if (entry.isFile()) {
      filePaths.push(absolutePath);
    }
  }

  return filePaths;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findSiblingFileCaseInsensitive(
  dirPath: string,
  preferredNames: string[]
): Promise<string | undefined> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const lowerMap = new Map(files.map((name) => [name.toLowerCase(), name]));

  for (const preferredName of preferredNames) {
    const matched = lowerMap.get(preferredName.toLowerCase());
    if (matched) {
      return path.join(dirPath, matched);
    }
  }

  return undefined;
}

async function resolveCoverPath(dirPath: string, baseName: string): Promise<string | undefined> {
  const candidates: string[] = [];
  const coverBaseNames = [baseName, "cover", "folder", "front", "album"];
  for (const coverBaseName of coverBaseNames) {
    for (const ext of SUPPORTED_COVER_EXTENSIONS) {
      candidates.push(`${coverBaseName}${ext}`);
    }
  }
  return findSiblingFileCaseInsensitive(dirPath, candidates);
}

async function parseEmbeddedCover(
  audioFilePath: string
): Promise<{ data: Uint8Array; mimeType: string } | undefined> {
  try {
    const metadata = await parseFile(audioFilePath, { duration: false, skipCovers: false });
    const firstPicture = metadata.common.picture?.[0];
    if (!firstPicture) {
      return undefined;
    }
    return {
      data: firstPicture.data,
      mimeType: firstPicture.format || "image/jpeg"
    };
  } catch {
    return undefined;
  }
}

async function scanTrackAssetsCore(
  musicDir = process.env.MUSIC_DIR ?? defaultMusicDir
): Promise<TrackAssetRecord[]> {
  let files: string[] = [];
  try {
    files = await walkMusicDir(musicDir);
  } catch {
    return [];
  }

  const audioFiles = files.filter((filePath) =>
    SUPPORTED_AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase())
  );

  const records = await Promise.all(
    audioFiles.map(async (audioFilePath): Promise<TrackAssetRecord> => {
      const dirPath = path.dirname(audioFilePath);
      const extension = path.extname(audioFilePath);
      const baseName = path.basename(audioFilePath, extension);
      const relativePath = path.relative(musicDir, audioFilePath).replaceAll("\\", "/");
      const id = createTrackId(relativePath);
      const parsed = parseArtistAndTitle(baseName);
      const lyricFilePath = await findSiblingFileCaseInsensitive(dirPath, [`${baseName}.lrc`]);
      const coverFilePath = await resolveCoverPath(dirPath, baseName);
      const embeddedCover = coverFilePath ? undefined : await parseEmbeddedCover(audioFilePath);
      const hasLyric = lyricFilePath ? await fileExists(lyricFilePath) : false;

      const track: Track = {
        id,
        title: parsed.title,
        artist: parsed.artist,
        album: "Unknown Album",
        duration: 0,
        streamUrl: `/api/tracks/${id}/stream`,
        lyricUrl: hasLyric ? `/api/tracks/${id}/lyric` : undefined,
        coverUrl: coverFilePath || embeddedCover ? `/api/tracks/${id}/cover` : undefined
      };

      return {
        track,
        audioFilePath,
        lyricFilePath: hasLyric ? lyricFilePath : undefined,
        coverFilePath,
        embeddedCover
      };
    })
  );

  records.sort((a, b) => a.track.title.localeCompare(b.track.title, "zh-Hans-CN"));
  return records;
}

const CACHE_TTL_MS = 3000;
let cachedMusicDir: string | null = null;
let cachedAt = 0;
let cachedRecords: TrackAssetRecord[] = [];

async function scanTrackAssets(
  musicDir = process.env.MUSIC_DIR ?? defaultMusicDir
): Promise<TrackAssetRecord[]> {
  const now = Date.now();
  if (cachedMusicDir === musicDir && now - cachedAt < CACHE_TTL_MS) {
    return cachedRecords;
  }

  const records = await scanTrackAssetsCore(musicDir);
  cachedMusicDir = musicDir;
  cachedAt = now;
  cachedRecords = records;
  return records;
}

export async function scanTracks(musicDir = process.env.MUSIC_DIR ?? defaultMusicDir): Promise<Track[]> {
  const records = await scanTrackAssets(musicDir);
  return records.map((record) => record.track);
}

export async function findTrackAssetById(
  trackId: string,
  musicDir = process.env.MUSIC_DIR ?? defaultMusicDir
): Promise<TrackAssetRecord | undefined> {
  const records = await scanTrackAssets(musicDir);
  return records.find((record) => record.track.id === trackId);
}
