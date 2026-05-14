import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { logger } from "#utils/logger.js";

const MIME_TO_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

function decodeImage(image) {
  if (!image) return null;
  // Accept either { data: "data:image/png;base64,...", mimeType } or a raw data URL string
  const raw = typeof image === "string" ? image : image.data;
  if (typeof raw !== "string") return null;

  let mimeType = typeof image === "object" ? image.mimeType : null;
  let base64 = raw;
  const m = raw.match(/^data:([^;]+);base64,(.+)$/);
  if (m) {
    mimeType = mimeType || m[1];
    base64 = m[2];
  }
  if (!mimeType) mimeType = "image/png";
  const ext = MIME_TO_EXT[mimeType.toLowerCase()] || "bin";
  try {
    return { buf: Buffer.from(base64, "base64"), ext };
  } catch {
    return null;
  }
}

export async function saveImagesToTempFiles(images) {
  const out = [];
  for (const img of images) {
    const decoded = decodeImage(img);
    if (!decoded) {
      logger.warn("[Ask] Skipping malformed image attachment.");
      continue;
    }
    const name = `ask-img-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.${decoded.ext}`;
    const p = path.join(os.tmpdir(), name);
    await fs.writeFile(p, decoded.buf);
    out.push(p);
  }
  return out;
}

export async function cleanupTempFiles(paths) {
  await Promise.all(
    paths.map((p) =>
      fs.unlink(p).catch((err) => {
        logger.debug(`[Ask] Failed to clean up temp file ${p}: ${err.message}`);
      }),
    ),
  );
}
