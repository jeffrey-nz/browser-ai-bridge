#!/usr/bin/env node
// T-121: src/heal/patcher.js holds locator file paths as strings in
// PROVIDER_LOCATOR_PATHS and fs-writes to them at runtime — invisible to
// check:reachable's static import walk, which only sees `import` edges.
// A rename or delete of any of these five files would surface only inside
// self-heal itself, the subsystem that runs when something else has
// already broken. This resolves each path exactly the way
// patchLocatorsFile() does (via resolveLocatorsPath, the same function)
// and fails loudly, naming the bad path, if any target is missing.
import {
  PROVIDER_LOCATOR_PATHS,
  resolveLocatorsPath,
} from "../src/heal/patcher.js";
import fs from "node:fs";

const providerIds = Object.keys(PROVIDER_LOCATOR_PATHS);
const missing = [];

for (const providerId of providerIds) {
  const fullPath = resolveLocatorsPath(providerId);
  const ok = fs.existsSync(fullPath);
  console.log(
    `${ok ? "OK  " : "MISS"}  ${providerId.padEnd(10)} ${PROVIDER_LOCATOR_PATHS[providerId]}`,
  );
  if (!ok) missing.push(`${providerId} -> ${fullPath}`);
}

if (missing.length > 0) {
  console.error(
    `\nheal-paths: ${missing.length} of ${providerIds.length} stale:`,
  );
  for (const m of missing) console.error(`  ${m}`);
  process.exit(1);
}

console.log(
  `\nheal-paths: ${providerIds.length} of ${providerIds.length} resolve.`,
);
