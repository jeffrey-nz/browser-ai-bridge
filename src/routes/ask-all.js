import express from "express";
import crypto from "node:crypto";
import { PROVIDER_CONFIG } from "../config/providers.js";
import { askOne } from "./ask/askOne.js";
import { sendSuccess, sendError } from "../middleware/respond.js";

const router = express.Router();

/**
 * POST /api/ask-all — the same prompt, N independent providers, N answers.
 *
 * Built for the mmg per-bar redesign's requirement of second and third
 * opinions to catch hallucination (crew board T-002): consensus needs
 * independent readers, and a single reader is one opinion wearing a
 * confident face, not a vote.
 *
 * WHAT THIS DOES NOT DO, on purpose: merge, vote, or pick a winner. Two
 * models agreeing is weak evidence on its own — they can share a training
 * bias — and the moment this endpoint collapsed N answers into one, a
 * caller would stop being able to see the disagreement, which on the mmg
 * board is precisely the signal a human should look at. The bridge reports;
 * the caller adjudicates.
 */
router.post("/", async (req, res) => {
  const { providers, prompt, label, skipConstraint, mode, images, projectDir } =
    req.body;
  const requestId = crypto.randomUUID();

  if (!prompt) {
    return sendError(res, 400, "Missing prompt", {}, requestId);
  }
  if (!Array.isArray(providers) || providers.length === 0) {
    return sendError(
      res,
      400,
      "providers must be a non-empty array of provider ids",
      {},
      requestId,
    );
  }

  // De-duplicate rather than reject: asking the same provider twice would not
  // be a second opinion, it would be the same opinion counted twice.
  const wanted = [...new Set(providers)];
  const unknown = wanted.filter((id) => !PROVIDER_CONFIG[id]);
  if (unknown.length) {
    return sendError(
      res,
      400,
      `Unknown provider(s): ${unknown.join(", ")}`,
      {},
      requestId,
    );
  }

  const isReviewerTurn = /reviewer/i.test(label ?? "");
  const pollTimeoutMs = isReviewerTurn ? 3 * 60 * 1000 : 7 * 60 * 1000;

  const startedAt = Date.now();
  const answers = await Promise.all(
    wanted.map((providerId) =>
      askOne(providerId, prompt, requestId, {
        label,
        skipConstraint,
        mode,
        images: Array.isArray(images) ? images : [],
        projectDir: projectDir || "",
        pollTimeoutMs,
      }),
    ),
  );
  const elapsedMs = Date.now() - startedAt;

  return sendSuccess(res, { answers, elapsedMs }, requestId);
});

export default router;
