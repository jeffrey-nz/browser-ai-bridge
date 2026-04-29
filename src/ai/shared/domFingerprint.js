import { logger } from "#utils/logger.js";
import crypto from "node:crypto";

export async function calculateDomFingerprint(page) {
  try {
    const structuralSkeleton = await page.evaluate(() => {
      function walk(node, depth = 0) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return "";

        if (
          [
            "SCRIPT",
            "STYLE",
            "SVG",
            "PATH",
            "META",
            "LINK",
            "IFRAME",
            "NOSCRIPT",
          ].includes(node.tagName)
        ) {
          return "";
        }

        let result = `${depth}:${node.tagName}|`;
        for (const child of node.childNodes) {
          result += walk(child, depth + 1);
        }
        return result;
      }

      const root = document.querySelector("main") || document.body;
      return walk(root);
    });

    return crypto
      .createHash("sha256")
      .update(structuralSkeleton)
      .digest("hex")
      .substring(0, 16);
  } catch (err) {
    logger.warn(`[DOM Fingerprint] Calculation failed: ${err.message}`);
    return null;
  }
}
