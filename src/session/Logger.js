import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const LOGS_DIR = path.join(process.cwd(), "logs");
const MAX_LOGS = 5;

function trimOldLogs() {
  try {
    const files = fs
      .readdirSync(LOGS_DIR)
      .filter((f) => f.endsWith(".log"))
      .map((f) => ({ name: f, mtime: fs.statSync(path.join(LOGS_DIR, f)).mtimeMs }))
      .sort((a, b) => a.mtime - b.mtime);

    const excess = files.length - MAX_LOGS;
    for (let i = 0; i < excess; i++) {
      fs.unlinkSync(path.join(LOGS_DIR, files[i].name));
    }
  } catch {}
}

export class SessionLogger {
  initLog(sessionId, providerId) {
    if (!fs.existsSync(LOGS_DIR)) {
      fs.mkdirSync(LOGS_DIR, { recursive: true });
    }

    // Date-prefixed name so files sort chronologically: YYYY-MM-DD_HH-MM-SS_<short-id>.log
    const now = new Date();
    const datePart = now.toISOString().slice(0, 10);                 // 2026-04-13
    const timePart = now.toISOString().slice(11, 19).replace(/:/g, "-"); // 08-15-24
    const shortId = sessionId.slice(0, 8);
    const fileName = `${datePart}_${timePart}_${shortId}.log`;

    const filePath = path.join(LOGS_DIR, fileName);
    const header = `=== SESSION START ===\nSession ID: ${sessionId}\nProvider: ${providerId}\nStarted At: ${now.toISOString()}\n=====================\n\n`;

    fs.writeFileSync(filePath, header, "utf8");
    trimOldLogs();
    return filePath;
  }

  logTranscript(filePath, role, content, metadata = {}) {
    if (!filePath) return;
    const timestamp = new Date().toISOString();
    let block = `[${timestamp}] ${role.toUpperCase()}\n`;

    if (Object.keys(metadata).length > 0) {
      block += `Metadata: ${JSON.stringify(metadata)}\n`;
    }

    block += `--------------------------------------------------\n${content}\n--------------------------------------------------\n\n`;

    try {
      fs.appendFileSync(filePath, block, "utf8");
    } catch (e) {
      console.error(`Failed to write to session log file: ${e.message}`);
    }
  }

  finalize(filePath) {
    if (!filePath) return;
    try {
      fs.appendFileSync(
        filePath,
        `=== SESSION CLOSED ===\nClosed At: ${new Date().toISOString()}\n`,
        "utf8",
      );
    } catch (e) {}
  }
}

export const sessionLogger = new SessionLogger();
