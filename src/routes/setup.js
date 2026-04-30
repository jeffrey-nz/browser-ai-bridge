import { Router } from "express";
import { setupState } from "../setup/state.js";

const router = Router();

router.get("/", (_req, res) => {
  res.json(setupState.toJSON());
});

router.post("/confirm", (req, res) => {
  if (setupState.phase !== "waiting_confirm") {
    return res.status(409).json({ error: "No confirmation pending" });
  }
  setupState.confirm();
  res.json({ ok: true });
});

router.post("/skip", (req, res) => {
  if (setupState.phase !== "waiting_confirm") {
    return res.status(409).json({ error: "No confirmation pending" });
  }
  setupState.skip();
  res.json({ ok: true });
});

export default router;
