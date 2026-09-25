import express from "express";
import { sessionManager } from "../session/index.js";
import { sessionPool } from "../session/Pool.js";
import { getBrowserContext } from "../browser.js";
import { census, planCleanup, sweep, LIMITS } from "../session/TabJanitor.js";

// GET  /api/tabs          what is open, per provider, and what the janitor would close
// POST /api/tabs/sweep    tidy now instead of waiting for the next interval
const router = express.Router();

async function gather() {
  const { context } = await getBrowserContext();
  const livePages = context.pages();
  const keyOf = new Map(livePages.map((pg, i) => [pg, `p${i}`]));
  const pages = livePages.map((pg) => {
    let url = "";
    try {
      url = pg.url();
    } catch {
      /* detached */
    }
    return { key: keyOf.get(pg), url };
  });
  const registry = sessionManager.registry.list();
  const ownedPageKeys = new Set();
  for (const s of registry)
    if (s.page && keyOf.has(s.page)) ownedPageKeys.add(keyOf.get(s.page));
  const poolCounts = {};
  for (const [providerId, list] of sessionPool.warmSessions.entries()) {
    poolCounts[providerId] = list.length;
    for (const s of list)
      if (s.page && keyOf.has(s.page)) ownedPageKeys.add(keyOf.get(s.page));
  }
  const sessions = registry.map((s) => ({
    id: s.id,
    providerId: s.providerId,
    locked: !!s.locked,
    clientGone: !!s.clientGone,
    lockedAt: s.lockedAt || null,
    lastUsedAt: s.lastUsedAt || null,
    createdAt: s.createdAt,
  }));
  const poolEntries = [];
  for (const [providerId, list] of sessionPool.warmSessions.entries()) {
    for (const e of list)
      poolEntries.push({ providerId, id: e.id, pooledAt: e.pooledAt || null });
  }
  return { sessions, pages, ownedPageKeys, poolCounts, poolEntries };
}

router.get("/", async (req, res) => {
  try {
    const state = await gather();
    const plan = planCleanup({ ...state, now: Date.now() });
    res.json({
      success: true,
      limits: LIMITS,
      ...census(state),
      wouldClose: [
        ...plan.closeSessions,
        ...plan.closePages,
        ...plan.closePool,
      ].map((c) => c.reason),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/sweep", async (req, res) => {
  const plan = await sweep({
    manager: sessionManager,
    pool: sessionPool,
    getContext: getBrowserContext,
  });
  res.json({
    success: !!plan,
    closed: plan
      ? [...plan.closeSessions, ...plan.closePages, ...plan.closePool].map(
          (c) => c.reason,
        )
      : [],
  });
});

export default router;
