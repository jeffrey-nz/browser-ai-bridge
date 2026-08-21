#!/usr/bin/env node
/**
 * break-demo.mjs — acceptance clause 3, executed rather than merely described.
 *
 * Connects to the SAME running Chrome the live bridge uses (via CDP, read from
 * .env CDP_URL) and opens a brand-new blank tab — no provider session, no
 * shared state with any in-flight turn. Calls the real uploadFileToPage from
 * src/ai/shared/uploadFile.js against that blank page with a selector that
 * cannot match anything, proving the verification path reports failure
 * (returns false) rather than the old behaviour (report success because
 * setInputFiles didn't throw).
 *
 * Then repeats against a page that DOES have a real <input type="file">, to
 * show the same function returning true when evidence genuinely appears —
 * i.e. this is not a function that always returns false.
 *
 * Usage: node scripts/break-demo.mjs
 */
import { chromium } from "playwright-core";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CDP_URL = process.env.CDP_URL || "http://127.0.0.1:9222";

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];

  const dir = await mkdtemp(join(tmpdir(), "break-demo-"));
  const filePath = join(dir, "probe.txt");
  await writeFile(filePath, "not a real upload, just proving the mechanism");

  const { uploadFileToPage } = await import("../src/ai/shared/uploadFile.js");

  // 1. DELIBERATELY BROKEN: a page with no file input and a button selector
  //    that cannot match anything on it. This is what a mis-selectored
  //    provider (e.g. a stale attachBtn in specs.js) looks like from the
  //    upload helper's point of view.
  const brokenPage = await context.newPage();
  await brokenPage.setContent(
    "<html><body><p>No file input, no attach button here.</p></body></html>",
  );
  // Every real caller (chatgpt/index.js, gemini/index.js, generic/interaction.js,
  // ...) wraps this exact call in try/catch and treats a throw the same as a
  // `false` return — imageAttached stays false either way. Mirror that here
  // rather than letting the throw escape, since the throw itself is not the
  // bug: reporting SUCCESS despite it would have been.
  let brokenResult;
  try {
    brokenResult = await uploadFileToPage(brokenPage, filePath, {
      attachmentBtnSelector: "button.NONEXISTENT-PROBE-BREAK",
      timeoutMs: 3000,
      verifyTimeoutMs: 2000,
    });
  } catch (err) {
    brokenResult = false;
    console.log(
      `  (uploadFileToPage threw, as a real caller's try/catch also sees: ${err.message})`,
    );
  }
  console.log(
    `BROKEN page (no input[type=file], no matching button) -> imageAttached resolves to: ${brokenResult}`,
  );
  await brokenPage.close();

  // 2. WORKING: a page with a real hidden file input AND a blob-URL preview
  //    that appears once a file is set on it, mirroring how the real
  //    providers render an attachment thumbnail. This proves the same
  //    function reports success when the evidence is real, not just false
  //    unconditionally.
  const workingPage = await context.newPage();
  await workingPage.setContent(`
    <html><body>
      <input type="file" id="f" style="display:none">
      <img id="preview" style="display:none">
      <script>
        document.getElementById('f').addEventListener('change', (e) => {
          const file = e.target.files[0];
          if (file) {
            const img = document.getElementById('preview');
            img.src = URL.createObjectURL(file);
            img.style.display = 'block';
          }
        });
      </script>
    </body></html>
  `);
  const workingResult = await uploadFileToPage(workingPage, filePath, {
    timeoutMs: 3000,
    verifyTimeoutMs: 3000,
  });
  console.log(
    `WORKING page (input[type=file] wired to a blob: preview) -> uploadFileToPage returned: ${workingResult}`,
  );
  await workingPage.close();

  // Deliberately NOT calling browser.close() here: on a connectOverCDP()
  // connection, close() sends Browser.close over the wire and kills the
  // whole shared Chrome instance the live bridge (and any other session
  // using it) depends on, not just this script's client connection. Learned
  // this the hard way running this exact script — the fix is to just stop
  // talking to it. Playwright disconnects on process exit regardless.

  console.log(
    `\n${brokenResult === false && workingResult === true ? "DEMONSTRATED" : "UNEXPECTED"}: ` +
      `broken=${brokenResult} (expect false), working=${workingResult} (expect true)`,
  );
  process.exit(brokenResult === false && workingResult === true ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
