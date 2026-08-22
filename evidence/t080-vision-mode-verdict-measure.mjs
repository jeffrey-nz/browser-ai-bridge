// T-080: drive selectDeepSeekVisionMode against the live deepseek page N
// times, from a state where Vision is NOT already selected each time (so
// the click path actually runs, not "already-on"), and record the verdict
// each run. Connects to the SAME tab the spare bridge (port 3351) already
// created — a plain click()/getAttribute() read, not the file-chooser
// interception T-018 found interferes across CDP clients, so a second
// client on the same target is fine here (confirmed live in T-018's own
// investigation: aria-expanded reads/writes via a separate connectOverCDP
// client tracked the real DOM state correctly every time).
import { chromium } from "playwright-core";
import { writeFile } from "node:fs/promises";
import { selectDeepSeekVisionMode } from "../src/ai/deepseek/interaction/mode.js";
import { fetchServerProvenance } from "../scripts/serverProvenance.mjs";

const CDP_URL = process.env.CDP_URL || "http://127.0.0.1:9222";
const BASE_URL = process.env.BRIDGE_URL || "http://localhost:3351";
const N = Number(process.argv[2] || 12);
const OUT_PATH = new URL(
  "./t080-vision-mode-verdict-runs.json",
  import.meta.url,
);

async function switchOffVision(page) {
  // Click "Instant" (or any non-Vision radio) so the NEXT
  // selectDeepSeekVisionMode call has to actually click, not short-circuit
  // on "already-on".
  const instant = page.locator('[role="radio"]:has-text("Instant")').first();
  await instant.waitFor({ state: "visible", timeout: 10000 });
  const alreadyOn = (await instant.getAttribute("aria-checked")) === "true";
  if (!alreadyOn) {
    await instant.click();
    await page.waitForTimeout(300);
  }
}

async function main() {
  // T-083 CLAUSE 0: the bridge these runs go through must have loaded the
  // commit under test, from a clean tree — quoted in the committed output.
  const provenance = await fetchServerProvenance(BASE_URL);
  console.log(
    `[provenance] reachable=${provenance.reachable} loadedCommit=${provenance.loadedCommit} loadedTreeDirty=${provenance.loadedTreeDirty}`,
  );

  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  const pages = context.pages();
  const page = pages.find((p) => p.url().includes("chat.deepseek.com"));
  if (!page) {
    console.error(
      `no open deepseek tab — tabs: ${pages.map((p) => p.url()).join(", ")}`,
    );
    process.exit(1);
  }
  console.log(`tab: ${page.url()}`);

  const results = [];
  for (let i = 0; i < N; i++) {
    await switchOffVision(page);
    const preCheck = await page
      .locator('[role="radio"]:has-text("Vision")')
      .first()
      .getAttribute("aria-checked");
    const verdict = await selectDeepSeekVisionMode(page);
    // Ground truth, read again right after, with a short settle wait — an
    // independent confirmation of whether Vision really is on now,
    // separate from the function's own single-shot read, so a
    // "not-confirmed" verdict can be told apart from a genuinely-off
    // radio versus one that just hadn't re-rendered yet.
    await page.waitForTimeout(500);
    const groundTruthOn =
      (await page
        .locator('[role="radio"]:has-text("Vision")')
        .first()
        .getAttribute("aria-checked")) === "true";
    results.push({
      run: i + 1,
      preCheckAriaChecked: preCheck,
      verdict: verdict.verdict,
      groundTruthOnAfterSettle: groundTruthOn,
    });
    console.log(
      `run ${i + 1}/${N}: verdict=${verdict.verdict}  groundTruthOnAfterSettle=${groundTruthOn}`,
    );
  }

  const confirmed = results.filter(
    (r) => r.verdict === "clicked-and-confirmed-on",
  ).length;
  const notConfirmed = results.filter(
    (r) => r.verdict === "not-confirmed",
  ).length;
  console.log(
    `\nSUMMARY: ${confirmed}/${N} clicked-and-confirmed-on, ${notConfirmed}/${N} not-confirmed`,
  );
  // A false alarm: verdict said not-confirmed, but the ground-truth read
  // (a settled re-read, independent of the function's own single-shot
  // one) says Vision genuinely is on.
  const falseAlarms = results.filter(
    (r) => r.verdict === "not-confirmed" && r.groundTruthOnAfterSettle,
  ).length;
  console.log(
    `FALSE ALARMS (verdict said not-confirmed, but settled read says on): ${falseAlarms}/${N}`,
  );

  const record = {
    ticket: "T-080",
    measured:
      "selectDeepSeekVisionMode's aria-checked re-read false-alarm rate",
    n: N,
    serverProvenance: provenance,
    confirmed,
    notConfirmed,
    falseAlarms,
    results,
  };
  await writeFile(OUT_PATH, JSON.stringify(record, null, 2));
  console.log(`\n[written] ${OUT_PATH.pathname}`);

  await browser.close();
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
