import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countTrackedFiles } from "../scripts/ia-grade.mjs";

/**
 * T-029: ia-grade.mjs's provenance banner compared "every tracked file
 * under reports/vision-probe" (jsons AND, since T-026, 57 fixture pngs)
 * against "the json corpus" — a numerator that can never read below its
 * denominator even when a json genuinely is untracked, because a png
 * surplus masks any json shortfall. countTrackedFiles() is the fixed,
 * population-scoped replacement. Proven here against a real temp git repo
 * — never against reports/vision-probe itself, which stays untouched.
 */

function git(cwd, cmd) {
  execSync(`git ${cmd}`, { cwd, stdio: "ignore" });
}

test("countTrackedFiles reports a genuine shortfall — an untracked json is not counted", () => {
  const dir = mkdtempSync(join(tmpdir(), "ia-grade-tracked-test-"));
  try {
    git(dir, "init -q");
    git(dir, 'config user.email "test@example.com"');
    git(dir, 'config user.name "Test"');

    writeFileSync(join(dir, "a.json"), "{}");
    writeFileSync(join(dir, "b.json"), "{}"); // will stay untracked
    writeFileSync(join(dir, "a.png"), "");

    git(dir, "add a.json a.png");
    git(dir, 'commit -q -m "initial"');
    // b.json deliberately never `git add`ed — the shortfall.

    const trackedJson = countTrackedFiles("*.json", dir);
    const trackedPng = countTrackedFiles("*.png", dir);

    assert.equal(
      trackedJson,
      1,
      "only a.json was committed — b.json must not be counted",
    );
    assert.equal(trackedPng, 1);

    // The actual bug this ticket is about: an un-filtered count would have
    // been 2 tracked files (a.json + a.png) against a denominator of "2
    // json files on disk" — reading as if nothing were missing. Scoped to
    // *.json alone, the shortfall is visible: 1 of 2.
    const filesOnDisk = 2; // a.json + b.json, matching ia-grade.mjs's files.length
    assert.ok(
      trackedJson < filesOnDisk,
      `expected the numerator to read below the denominator (1 of 2); got ${trackedJson} of ${filesOnDisk}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("countTrackedFiles returns null (not a throw) outside a git checkout", () => {
  const dir = mkdtempSync(join(tmpdir(), "ia-grade-tracked-test-not-git-"));
  try {
    // No `git init` — this directory is not a git checkout at all, the
    // T-019 fallback case (a tarball of the repo, or git itself missing).
    writeFileSync(join(dir, "a.json"), "{}");

    const result = countTrackedFiles("*.json", dir);

    assert.equal(
      result,
      null,
      "outside a git checkout the count must degrade to null, not throw",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
