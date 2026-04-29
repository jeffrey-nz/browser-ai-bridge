#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

// Walk up from cwd looking for .env (supports running from a subdirectory)
let dir = process.cwd();
for (let i = 0; i < 4; i++) {
  const envPath = resolve(dir, ".env");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^\s*([^#=][^=]*?)\s*=\s*(["']?)(.*?)\2\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[3];
    }
    break;
  }
  const parent = dirname(dir);
  if (parent === dir) break;
  dir = parent;
}

const { init } = await import("../src/index.js");
init();
