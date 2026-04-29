import process from "node:process";
import { spawnSync } from "node:child_process";

function isWsl() {
  return (
    process.platform === "linux" &&
    (process.env.WSL_INTEROP || process.env.WSL_DISTRO_NAME)
  );
}

export function forceCopyToClipboard(text) {
  const payload = typeof text === "string" ? text : String(text ?? "");

  const isMac = process.platform === "darwin";
  const wsl = isWsl();

  if (isMac) {
    const res = spawnSync("pbcopy", [], { input: payload, encoding: "utf8" });
    if (res.error || res.status !== 0) {
      throw new Error("Clipboard copy failed via pbcopy");
    }
    return;
  }

  if (process.platform === "win32" || wsl) {
    const res = spawnSync("clip.exe", [], {
      input: payload,
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
    });
    if (res.error || res.status !== 0) {
      throw new Error("Clipboard copy failed via clip.exe");
    }
    return;
  }

  const xclip = spawnSync("xclip", ["-selection", "clipboard"], {
    input: payload,
    encoding: "utf8",
  });
  if (xclip.error || xclip.status !== 0) {
    throw new Error(
      "Clipboard copy failed: install xclip for Linux clipboard.",
    );
  }
}
