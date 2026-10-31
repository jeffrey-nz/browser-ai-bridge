import express from "express";
import { getBrowserContext } from "../browser.js";
import { diagnoseBlockedPage } from "#ai/shared/blockedPage.js";
import { PROVIDERS_TO_LOGIN } from "../startup/providers.js";

//[[ IS EACH PROVIDER SIGNED IN? Asked of a fresh tab of its own, for each one, because a
//   tab a session holds may be mid-answer and must not be navigated. The fresh tab shares
//   the profile's cookies, so it sees exactly what a new session would, carries no
//   bridge mark, and closes when it has answered. No prompt is sent, so this is cheap
//   enough to run every hour, where a real turn (bridge:health) costs minutes. ]]

const router = express.Router();
const SETTLE_MS = 5000;

async function stateOf(context, provider) {
  const page = await context.newPage();
  try {
    await page.goto(provider.url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(SETTLE_MS);
    const url = page.url();
    const diagnosis = await diagnoseBlockedPage(page);
    if (diagnosis?.kind === "suspended") return { state: "suspended", url, detail: diagnosis.notice };
    if (diagnosis?.kind === "signedOut") return { state: "signedOut", url, detail: diagnosis.guest ? "guest page" : "sign-in wall" };
    const composer = await page
      .locator('textarea, [contenteditable="true"], input[type="text"][placeholder]')
      .first()
      .isVisible({ timeout: 1500 })
      .catch(() => false);
    return composer ? { state: "signedIn", url } : { state: "unknown", url, detail: "no composer and no sign-in control" };
  } catch (err) {
    return { state: "unknown", url: provider.url, detail: String(err.message).split("\n")[0] };
  } finally {
    await page.close().catch(() => {});
  }
}

// GET /api/auth[?providers=chatgpt,grok]   one state per provider
router.get("/", async (req, res) => {
  try {
    const wanted = String(req.query.providers || "").split(",").map((s) => s.trim()).filter(Boolean);
    const providers = PROVIDERS_TO_LOGIN.filter((p) => !wanted.length || wanted.includes(p.id));
    const { context } = await getBrowserContext();
    //[[ One at a time. Ten tabs opened together are ten blank tabs for a moment, and the janitor
    //   keeps one, so most checks were closed mid-load and came back "could not tell". ]]
    const states = {};
    for (const p of providers) states[p.id] = await stateOf(context, p);
    res.json({ success: true, providers: states });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
