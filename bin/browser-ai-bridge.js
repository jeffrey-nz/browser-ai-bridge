#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([^#=][^=]*?)\s*=\s*(["']?)(.*?)\2\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[3];
  }
}

const { init } = await import("../src/index.js");
init();
