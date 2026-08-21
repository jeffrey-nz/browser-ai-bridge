/**
 * uploadOutcome.js — the one place the "why is imageAttached false"
 * vocabulary lives (T-038).
 *
 * Before this file, uploadFileToPage computed which of several distinct
 * outcomes happened (file never existed, nothing on the page accepted it,
 * something accepted it but no evidence confirmed it) and then destroyed
 * that distinction at the first catch: every one of six provider wrappers
 * wrote `let imageAttached = false; try { ... } catch (err) { logger.warn
 * (err.message) }`, so the only thing that ever separated "nothing was
 * offered to a composer" from "a file was offered and might have landed"
 * was a string sent to a logger with no destination configured
 * (src/shims/utils/logger.js — pino-pretty, no file sink).
 *
 * Every site that can put a false onto a recorded answer reads this file's
 * UPLOAD_CAUSES rather than typing its own string, and every throw from
 * uploadFileToPage (and its provider-specific siblings) carries one of
 * these via UploadOutcomeError.
 */

export const UPLOAD_CAUSES = Object.freeze({
  // Nothing on the page ever accepted the file: no matching input, no
  // attachment button. The image was never offered to the provider by any
  // means this call tried.
  NOT_OFFERED: "not_offered",
  // A file WAS handed to the composer (an input's setInputFiles resolved,
  // or a real OS file-chooser accepted it) but no visible evidence
  // confirmed it landed within the verification window. This is the value
  // this ticket exists for: it is the only one consistent with the single
  // recorded refutation of this flag on the board's own corpus
  // (t006-zai-r2-run1.json — imageAttached:false, correct COUNT/COLOR).
  UNCONFIRMED: "unconfirmed",
  // The upload path threw something that isn't one of the above — an
  // unexpected Playwright/page failure, not a classified upload outcome.
  UPLOAD_ERROR: "upload_error",
  // This engine has no sendPromptWithFile at all. Computed above
  // uploadFileToPage, not inside it — the image was never even attempted.
  NO_UPLOAD_PATH: "no_upload_path",
  // A retry inside the turn (a stall retry, a rate-limit retry, a chat
  // rotation, a post-cooldown retry, an operator-typed manual answer)
  // re-sent the prompt as TEXT ONLY. Any image from the original turn does
  // not survive that resend.
  TEXT_ONLY_RETRY: "text_only_retry",
});

/**
 * Thrown by uploadFileToPage (and the provider-specific upload helpers that
 * mirror its contract) instead of a bare Error, so the cause travels with
 * the exception instead of being reconstructed — or lost — at the catch.
 */
export class UploadOutcomeError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "UploadOutcomeError";
    this.code = code;
  }
}

/**
 * What a provider wrapper's catch block calls on whatever it caught, to get
 * one of UPLOAD_CAUSES back without typing its own classification logic.
 * Anything that isn't an UploadOutcomeError (a raw Playwright error, a bug)
 * is UPLOAD_ERROR — the honest "something threw that this vocabulary does
 * not have a more specific bucket for" catch-all.
 */
export function classifyUploadError(err) {
  return err instanceof UploadOutcomeError
    ? err.code
    : UPLOAD_CAUSES.UPLOAD_ERROR;
}

/**
 * The sentence a caller sees when imageAttached is false. T-038 found the
 * single prior sentence ("could not be confirmed as attached to the
 * provider's composer") asserted a cause it did not know — true for
 * UNCONFIRMED, false for NO_UPLOAD_PATH and TEXT_ONLY_RETRY, where nothing
 * was ever offered to a composer to be confirmed. Each cause below asserts
 * only what that branch actually knows.
 */
function indefiniteArticleFor(label) {
  return /^[aeiou]/i.test(label) ? "an" : "a";
}

export function describeUploadFailure(cause, mediaLabel = "image") {
  switch (cause) {
    case UPLOAD_CAUSES.NO_UPLOAD_PATH:
      return `This provider has no way to attach ${indefiniteArticleFor(mediaLabel)} ${mediaLabel} at all — the ${mediaLabel} was never sent, and this response is text-only.`;
    case UPLOAD_CAUSES.TEXT_ONLY_RETRY:
      return `This turn was retried as text-only inside the bridge (a stall, rate-limit, rotation, or cooldown retry) — the original ${mediaLabel} did not survive the resend, and this response is text-only.`;
    case UPLOAD_CAUSES.NOT_OFFERED:
      return `Nothing on the provider's page accepted the ${mediaLabel} — no file input or attachment button was found, so it was never offered to the provider, and this response is text-only.`;
    case UPLOAD_CAUSES.UNCONFIRMED:
      return `The ${mediaLabel} was handed to the provider's composer but no evidence confirmed it landed before the bridge gave up waiting — this response may or may not reflect the ${mediaLabel}, and should not be trusted as a visual answer.`;
    case UPLOAD_CAUSES.UPLOAD_ERROR:
    default:
      return `The ${mediaLabel} could not be confirmed as attached to the provider's composer — this response may be text-only and should not be trusted as a visual answer.`;
  }
}
