import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { Readable } from "node:stream";

function mediaRoot() {
  return resolve(process.env.MEDIA_ROOT || "./data/media");
}

function mediaPath(storageKey: string) {
  const root = mediaRoot();
  const safeKey = storageKey
    .split(/[\\/]+/)
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join(sep);
  const target = resolve(root, safeKey);
  if (target !== root && !target.startsWith(`${root}${sep}`)) throw new Error("Некорректный путь медиа");
  return target;
}

export async function writeMediaFile(storageKey: string, data: ArrayBuffer | Uint8Array) {
  const target = mediaPath(storageKey);
  await mkdir(dirname(target), { recursive: true });
  const bytes = data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  await writeFile(target, bytes);
}

export async function mediaFileSize(storageKey: string) {
  try {
    const info = await stat(mediaPath(storageKey));
    return info.isFile() ? info.size : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function mediaFileStream(storageKey: string, range?: { start: number; end: number }) {
  const stream = createReadStream(mediaPath(storageKey), range);
  return Readable.toWeb(stream) as ReadableStream<Uint8Array>;
}

export async function deleteMediaFile(storageKey: string) {
  await rm(mediaPath(storageKey), { force: true });
}
