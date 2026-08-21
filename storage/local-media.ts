import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

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

export async function readMediaFile(storageKey: string) {
  try {
    return await readFile(mediaPath(storageKey));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function deleteMediaFile(storageKey: string) {
  await rm(mediaPath(storageKey), { force: true });
}
