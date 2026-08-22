type MediaType = "video" | "audio" | "image";

export type AllowedMedia = { mediaType: MediaType; extension: string; mimeType: string };

const allowed = new Map<string, AllowedMedia>([
  ["video/mp4", { mediaType: "video", extension: "mp4", mimeType: "video/mp4" }],
  ["video/webm", { mediaType: "video", extension: "webm", mimeType: "video/webm" }],
  ["video/ogg", { mediaType: "video", extension: "ogv", mimeType: "video/ogg" }],
  ["audio/mpeg", { mediaType: "audio", extension: "mp3", mimeType: "audio/mpeg" }],
  ["audio/mp3", { mediaType: "audio", extension: "mp3", mimeType: "audio/mpeg" }],
  ["audio/wav", { mediaType: "audio", extension: "wav", mimeType: "audio/wav" }],
  ["audio/ogg", { mediaType: "audio", extension: "ogg", mimeType: "audio/ogg" }],
  ["image/gif", { mediaType: "image", extension: "gif", mimeType: "image/gif" }],
  ["image/png", { mediaType: "image", extension: "png", mimeType: "image/png" }],
  ["image/jpeg", { mediaType: "image", extension: "jpg", mimeType: "image/jpeg" }],
]);

export function allowedMediaType(mimeType: string) {
  return allowed.get(mimeType.toLowerCase()) ?? null;
}

export function mediaSignatureMatches(bytes: Uint8Array, mimeType: string) {
  if (bytes.byteLength < 4) return false;
  switch (mimeType.toLowerCase()) {
    case "image/gif":
      return ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a";
    case "image/png":
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/jpeg":
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case "video/mp4":
      return bytes.byteLength >= 12 && ascii(bytes, 4, 4) === "ftyp";
    case "video/webm":
      return startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3]);
    case "video/ogg":
    case "audio/ogg":
      return ascii(bytes, 0, 4) === "OggS";
    case "audio/wav":
      return bytes.byteLength >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE";
    case "audio/mpeg":
    case "audio/mp3":
      return ascii(bytes, 0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
    default:
      return false;
  }
}

function startsWith(bytes: Uint8Array, signature: number[]) {
  return bytes.byteLength >= signature.length && signature.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  if (bytes.byteLength < offset + length) return "";
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}
