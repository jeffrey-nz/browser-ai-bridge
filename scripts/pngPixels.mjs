// pngPixels.mjs — T-026. Decodes a PNG written by vision-probe.mjs's own
// renderPng() (filter-type 0 / colour-type 2 / bit-depth 8 only — the exact
// shape renderPng writes, nothing more general) and finds solid-colour
// connected components in it. Shared by scripts/fixture-audit.mjs (checks
// every recorded fixture on disk) and tests/renderPng.test.js (checks a
// freshly-rendered image round-trips), so there is one place that reads
// these pixels, not one written into each caller by hand.
import zlib from "node:zlib";

/** Decode a renderPng-shaped PNG buffer into {width, height, pixelAt(x,y)}. */
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) {
    throw new Error("decodePng: not a PNG (bad signature)");
  }
  let offset = 8;
  let width, height, colorType, bitDepth;
  const idatChunks = [];
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 8 + len + 4; // length + type + data + crc
  }
  if (bitDepth !== 8 || colorType !== 2) {
    throw new Error(
      `decodePng: only handles bit depth 8 / colour type 2 (truecolor RGB) — got depth=${bitDepth} colorType=${colorType}`,
    );
  }
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const stride = width * 3 + 1; // +1 filter-type byte per scanline
  for (let y = 0; y < height; y++) {
    const filterType = raw[y * stride];
    if (filterType !== 0) {
      throw new Error(
        `decodePng: scanline ${y} uses filter type ${filterType}, only type 0 (None) is supported — this file was not written by renderPng`,
      );
    }
  }
  return {
    width,
    height,
    pixelAt(x, y) {
      const o = y * stride + 1 + x * 3;
      return [raw[o], raw[o + 1], raw[o + 2]];
    },
  };
}

/**
 * 4-connected components of pixels matching `rgb` exactly. Returns one entry
 * per component: its pixel count and bounding box. renderPng draws solid,
 * axis-aligned, non-antialiased squares, so an exact RGB match with no
 * tolerance is the correct (and simplest) test — any softening here would
 * hide the exact defect this ticket is about (a clipped square becoming a
 * differently-shaped, still solidly-coloured, region).
 */
export function findComponents(decoded, rgb) {
  const { width, height, pixelAt } = decoded;
  const matches = (x, y) => {
    const [r, g, b] = pixelAt(x, y);
    return r === rgb[0] && g === rgb[1] && b === rgb[2];
  };
  const seen = new Uint8Array(width * height);
  const components = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (seen[i] || !matches(x, y)) continue;
      // Flood fill (BFS) this component.
      let minX = x,
        maxX = x,
        minY = y,
        maxY = y,
        count = 0;
      const stack = [[x, y]];
      seen[i] = 1;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        count++;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        const neighbors = [
          [cx + 1, cy],
          [cx - 1, cy],
          [cx, cy + 1],
          [cx, cy - 1],
        ];
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const ni = ny * width + nx;
          if (seen[ni] || !matches(nx, ny)) continue;
          seen[ni] = 1;
          stack.push([nx, ny]);
        }
      }
      components.push({ minX, maxX, minY, maxY, count });
    }
  }
  return components;
}

/**
 * Is this component exactly a solid `size`x`size` square (no clipping, no
 * holes)? Bounding box dimensions AND pixel count both have to match — a
 * clipped 50x80 bar has the wrong bounding-box width; a square with a bite
 * out of it (unrelated to anything renderPng draws, but cheap to also catch)
 * would have the right bounding box and the wrong count.
 */
export function isSolidSquare(component, size) {
  const w = component.maxX - component.minX + 1;
  const h = component.maxY - component.minY + 1;
  return w === size && h === size && component.count === size * size;
}
