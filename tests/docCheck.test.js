import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listScriptFiles,
  isOneShot,
  namedInReadme,
  runCheck,
} from "../scripts/doc-check.mjs";

// T-085: the marker check went through two false-positive rounds before
// landing on "line 2, exactly" — a bare substring match caught this
// file's own prose ABOUT the marker, and "any line starting with it"
// still caught a planted test file's wrapped comment. Both failures are
// pinned here so a future change to the marker rule cannot reintroduce
// either without a test noticing.
test.describe("isOneShot", () => {
  test("a script with the marker on line 2 is one-shot", () => {
    const dir = mkdtempSync(join(tmpdir(), "doc-check-test-"));
    try {
      writeFileSync(
        join(dir, "probe.mjs"),
        "#!/usr/bin/env node\n// @one-shot-probe — closed ticket\nconsole.log(1);\n",
      );
      assert.equal(isOneShot(dir, "probe.mjs"), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a script with no marker at all is a tool", () => {
    const dir = mkdtempSync(join(tmpdir(), "doc-check-test-"));
    try {
      writeFileSync(
        join(dir, "tool.mjs"),
        "#!/usr/bin/env node\nconsole.log(1);\n",
      );
      assert.equal(isOneShot(dir, "tool.mjs"), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // THE FIRST FALSE POSITIVE this ticket found in its own checker: prose
  // ABOUT the marker, anywhere in the header, must not itself count.
  test("prose mentioning the marker string (not on line 2) is still a tool, not one-shot", () => {
    const dir = mkdtempSync(join(tmpdir(), "doc-check-test-"));
    try {
      writeFileSync(
        join(dir, "self-referential.mjs"),
        "#!/usr/bin/env node\n" +
          "// This file talks about the @one-shot-probe marker in prose.\n" +
          "console.log(1);\n",
      );
      assert.equal(isOneShot(dir, "self-referential.mjs"), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // THE SECOND FALSE POSITIVE: a wrapped comment sentence can put the
  // marker string at the START of a later line by accident, even when
  // the file is genuinely describing (not declaring) the marker.
  test("a wrapped comment that happens to start a line with the marker string is still a tool", () => {
    const dir = mkdtempSync(join(tmpdir(), "doc-check-test-"));
    try {
      writeFileSync(
        join(dir, "wrapped.mjs"),
        "#!/usr/bin/env node\n" +
          "// This describes the marker (no\n" +
          "// @one-shot-probe here) purely in prose that happens to wrap.\n" +
          "console.log(1);\n",
      );
      assert.equal(isOneShot(dir, "wrapped.mjs"), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the marker appearing on line 3 or later (not line 2) does not count", () => {
    const dir = mkdtempSync(join(tmpdir(), "doc-check-test-"));
    try {
      writeFileSync(
        join(dir, "late-marker.mjs"),
        "#!/usr/bin/env node\n// some header text\n// @one-shot-probe\nconsole.log(1);\n",
      );
      assert.equal(isOneShot(dir, "late-marker.mjs"), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test.describe("namedInReadme", () => {
  test("finds every scripts/<file> reference regardless of section", () => {
    const text =
      "Some prose. `scripts/a.mjs` does X. Later, `scripts/b.js` does Y.";
    assert.deepEqual(namedInReadme(text), new Set(["a.mjs", "b.js"]));
  });

  test("empty text names nothing", () => {
    assert.deepEqual(namedInReadme(""), new Set());
  });
});

test.describe("runCheck", () => {
  test("direction A: a README reference to a nonexistent file fails", () => {
    const dir = mkdtempSync(join(tmpdir(), "doc-check-test-"));
    try {
      writeFileSync(
        join(dir, "real.mjs"),
        "#!/usr/bin/env node\nconsole.log(1);\n",
      );
      const result = runCheck(
        dir,
        "See `scripts/real.mjs` and `scripts/ghost.mjs`.",
      );
      assert.equal(result.ok, false);
      assert.deepEqual(result.staleReadmeNames, ["ghost.mjs"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("direction B: an undocumented bucket-one script fails, a one-shot probe does not need documenting", () => {
    const dir = mkdtempSync(join(tmpdir(), "doc-check-test-"));
    try {
      writeFileSync(
        join(dir, "undocumented-tool.mjs"),
        "#!/usr/bin/env node\nconsole.log(1);\n",
      );
      writeFileSync(
        join(dir, "probe.mjs"),
        "#!/usr/bin/env node\n// @one-shot-probe\nconsole.log(1);\n",
      );
      const result = runCheck(dir, "Nothing named here.");
      assert.equal(result.ok, false);
      assert.deepEqual(result.undocumentedTools, ["undocumented-tool.mjs"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("both directions clean: ok is true", () => {
    const dir = mkdtempSync(join(tmpdir(), "doc-check-test-"));
    try {
      writeFileSync(
        join(dir, "tool.mjs"),
        "#!/usr/bin/env node\nconsole.log(1);\n",
      );
      const result = runCheck(dir, "See `scripts/tool.mjs`.");
      assert.equal(result.ok, true);
      assert.deepEqual(result.staleReadmeNames, []);
      assert.deepEqual(result.undocumentedTools, []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("listScriptFiles: only .mjs and .js, sorted", () => {
  const dir = mkdtempSync(join(tmpdir(), "doc-check-test-"));
  try {
    writeFileSync(join(dir, "b.mjs"), "");
    writeFileSync(join(dir, "a.js"), "");
    writeFileSync(join(dir, "notes.md"), "");
    assert.deepEqual(listScriptFiles(dir), ["a.js", "b.mjs"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
