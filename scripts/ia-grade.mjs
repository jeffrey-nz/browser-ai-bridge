#!/usr/bin/env node
// ia-grade.mjs — the permanent home for imageAttached's REFUTABLE denominator
// (T-017). Run from the browser-ai-bridge checkout: node scripts/ia-grade.mjs
//
// "N agreements, 0 disagreements" is not a meaningful tally on its own — most
// of this flag's recorded corpus (reports/vision-probe/*.json) can only ever
// AGREE with it, never refute it, because the only independent reference this
// probe has for "did the image arrive" is COUNT (T-012's arrival test, never
// stated in the prompt), and most turns' replies never state a count at all
// (a "SEES=no", a prompt echo, a timeout). This script partitions every
// recorded row into three buckets instead of one pass rate:
//   - CONFIRMED   imageAttached=true and the reply's stated COUNT is right —
//                 an agreement resting on an arithmetic reference, not a
//                 coin flip the model could pass by chance alone
//   - REFUTABLE   imageAttached=false but the reply states a COUNT anyway —
//                 the only shape that could ever disagree with the flag
//   - NEITHER     the reply states no COUNT (SEES=no, an echo, a timeout,
//                 garbage) — consistent with both a true and a false flag,
//                 so it is not evidence in either direction and must not be
//                 folded into an "agreement rate"
//
// Whenever this board or a hand-back wants to cite how well imageAttached
// has held up, run this and quote its three numbers — not a single pass
// rate computed over a denominator most of which could never have failed.
//
// SELF-CHECK: "did the reply state a COUNT" must NOT be answered by grepping the
// raw text, because an ECHO reply contains the prompt and the prompt contains the
// literal "COUNT=" and "SEES=no". 4 of 52 rows were echoes on the corpus this
// was written against, and a naive grep scored all four wrongly (T-025: and
// missed 2 more of a different shape already sitting in the same corpus — a
// hand-typed pattern fitted to the rows read, not the rows present). Echo
// detection is decided by classify() (vision-probe.mjs), imported below — the
// SAME code this repo's probe grades replies with, not a second copy of it.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { classify, COUNT_RANGE, COLORS } from "./vision-probe.mjs";

// T-025: the one place a recorded reply is decided to be a prompt echo (or
// not), pulled out of the report-scanning loop below so it can be unit
// tested (tests/ia-grade.test.js) without that loop's filesystem/git/console
// side effects. Delegates the echo call itself to classify() — see the
// SELF-CHECK note above for why this can't be a second hand-typed pattern.
export function gradeReply(raw, truth) {
  const cleaned = (raw || "").replace(/\s+/g, " ").trim();
  const echo =
    classify(cleaned, truth || { count: null, color: null }).shape === "ECHO";
  const m = echo ? null : cleaned.match(/COUNT\s*=\s*(\d+)/i);
  return {
    raw: cleaned,
    echo,
    said: m ? Number(m[1]) : null,
    seesNo: !echo && !m && /SEES\s*=\s*n/i.test(cleaned),
  };
}

// T-072: gradeReply's truth-less counterpart — a blind run (vision-probe.mjs
// --blind) has no picture, so there is nothing real to grade COUNT/COLOR
// against, only whether a count was STATED at all. Mirrors gradeReply's
// shape (recompute fresh from `raw` via classify(), never trust a stored
// verdict — T-027's policy) with the same sentinel-truth trick vision-probe's
// own classifyBlind() uses, so an echoed prompt (which contains the literal
// "COUNT=<how many..." text) is never misread as a stated count.
export function gradeBlindReply(raw) {
  const cleaned = (raw || "").replace(/\s+/g, " ").trim();
  const shape = classify(cleaned, { count: null, color: "" }).shape;
  const m = shape === "ECHO" ? null : cleaned.match(/COUNT\s*=\s*(\d+)/i);
  return { raw: cleaned, shape, stated: m ? Number(m[1]) : null };
}

// T-087 review: the independence check must be able to WITHDRAW the prior,
// not just print a number beside a hardcoded "not one fixture repeated" —
// that trailing text was a verdict sitting next to a computed figure, true
// only by accident of today's corpus, and would have kept printing itself
// (and the modal rate beside it, at full confidence) even if a future modal
// cell were 22 files over 2 distinct images. Named and exported so the
// printed threshold and the code that enforces it can never drift apart —
// the modal cell's distinct images must be AT LEAST HALF its file count, or
// a single recycled fixture (repeated more than every other image in that
// cell combined) could be inflating the file tally on its own. 0.5 is a
// judgement call (the acceptance says it may be); what it must not be is a
// bare literal buried in a condition, so it is named, exported, and printed
// with the verdict it produces.
export const INDEPENDENCE_MIN_IMAGE_SHARE = 0.5;

// T-087 review, second round: the withdrawal above stops the REALISED-prior
// line quoting a too-concentrated rate — but a SEPARATE consumer, the
// "TWO NULLS" sentence (formatTwoNullsLine below), computed its own
// multiplier as `prior.rowRate / genRate` regardless of independentEnough.
// rowRate is still a real, non-null number in the degenerate case
// (computeCorpusPrior never withdraws IT — only the printer decides
// whether to quote it), so that multiplier silently handed the reader back
// the exact rate the line above had just refused to publish: multiply the
// printed Nx by the generator's own 1-in-28 and the withdrawn number falls
// straight out. A caveat and a leak two lines apart is still a leak. Both
// consumers of `prior` are now pure, exported functions — same print
// order as before (this block, then section 3's refutable listing, then
// formatTwoNullsLine right after the "agreements" line, unchanged) — so
// the degenerate case can be driven through EACH consumer independently in
// a test, not just asserted against a flag nothing downstream was checked
// against.
export function formatCorpusPriorBlock(prior, countRange, colorChoices) {
  const totalCells = countRange * colorChoices;
  const lines = [];
  lines.push(
    `   key space (the GENERATOR): COUNT 1-in-${countRange} x COLOR 1-in-${colorChoices} = 1-in-${totalCells}`,
  );
  if (prior.modalCell && !prior.independentEnough) {
    // T-087 review: a caveat printed BELOW the number does not stop the
    // number being quoted — this is the same fault the ticket itself was
    // filed about, one consumer over, and printing "22 files, 2 distinct
    // images" with a footnote is not meaningfully different from not
    // printing the footnote at all. When the modal cell fails its own
    // independence check, the realised prior is WITHDRAWN — replaced by the
    // reason, not decorated with it.
    lines.push(
      `   realised   (this CORPUS ): WITHDRAWN — modal cell ${prior.modalCell} has only ${prior.modalImages} distinct image(s) across ${prior.modalFileCount} files (needs >= ${Math.ceil(prior.modalFileCount * prior.independenceThreshold)}, i.e. >= ${prior.independenceThreshold * 100}% distinct) — too concentrated on too few fixtures to trust as a corpus-wide prior.`,
    );
  } else if (prior.modalCell) {
    lines.push(
      `   realised   (this CORPUS ): modal cell ${prior.modalCell}, ${prior.modalRowCount} of ${prior.totalRows} rows (${prior.modalFileCount} of ${prior.totalFiles} files) = 1-in-${(prior.totalRows / prior.modalRowCount).toFixed(1)}`,
    );
    lines.push(
      `                              over ${prior.visitedCells} of ${totalCells} cells, ${prior.distinctImages} distinct images ` +
        `(independence check: ${prior.modalImages} of ${prior.modalFileCount} files at the modal cell are distinct images, >= ${prior.independenceThreshold * 100}% required — passes)`,
    );
    // T-087 clause 6: drawn-vs-pinned is T-084's field, which does not exist
    // yet — say plainly that this prior mixes both rather than let it be
    // read as a measurement of the generator's own draw.
    lines.push(
      `                              (mixture of drawn and pinned stimuli — no field distinguishes them yet, T-084)`,
    );
  } else {
    lines.push(
      `   realised   (this CORPUS ): no files carry both truth and results`,
    );
  }
  return lines;
}

// T-087 clause 3: TWO separate nulls back the "agreements" line, priced
// differently. Neither replaces T-072's measured 0 of 19 — that stands and
// applies to the NO-PICTURE case. This corpus prior is for the OTHER null
// (T-068/T-073: imageAttached=true but the model's actual input state is
// unconfirmed), where a reply is not blind, it is INVENTING. When the
// corpus prior above was WITHDRAWN, this must not reconstruct it — no
// rowRate, no multiplier, nothing a reader could multiply by 1-in-28 to
// get the withdrawn number back (T-087 review, second round).
export function formatTwoNullsLine(
  prior,
  blindRefusedCount,
  blindInformativeCount,
  countRange,
  colorChoices,
) {
  const totalCells = countRange * colorChoices;
  const invertingClause =
    prior.modalCell && prior.independentEnough
      ? (() => {
          const genRate = 1 / totalCells;
          const priorMultiplier = (prior.rowRate / genRate).toFixed(1);
          return (
            `is priced at the corpus's realised prior above, not the ` +
            `generator's 1-in-${totalCells} — that prior is ${priorMultiplier}x ` +
            `higher, because an invented answer is that many times more ` +
            `likely to land on the modal cell than a uniform draw over the ` +
            `key space would suggest.`
          );
        })()
      : `cannot be priced from this corpus right now: the realised prior ` +
        `above was withdrawn for failing its own independence check, and ` +
        `pricing the INVENTING null from a rate this corpus refuses to ` +
        `quote would repeat the exact leak the withdrawal exists to stop.`;
  return (
    `      TWO NULLS BACK THAT LINE, PRICED DIFFERENTLY: a reply with NO ` +
    `PICTURE was measured refusing ${blindRefusedCount} of ${blindInformativeCount || "?"} ` +
    `times (T-072, section 5) — the generator's key space never even ` +
    `applies, because a blind model does not guess. A reply that INVENTS ` +
    `instead of refusing (T-068/T-073's Instant-mode case, imageAttached=true ` +
    `but the model's real input state unconfirmed) ${invertingClause}`
  );
}

// T-087: KEY_SPACE (vision-probe.mjs) is a true fact about the GENERATOR —
// COUNT drawn uniformly 1-in-COUNT_RANGE, COLOR uniformly 1-in-|COLORS| — and
// section 3 has always quoted it as a prior over the CORPUS, a different
// population. This computes the prior the corpus actually realised: given one
// entry per NON-BLIND report file that carries a `truth` and a non-empty
// `results` array (a blind file never carries a shown image beside its drawn
// truth, so it is excluded rather than tallied against an image nobody was
// sent — the ticket's own reproduce rule says "every *.json with truth and
// results", which is the broader claim; this implements the narrower one,
// and today the two agree exactly, because 0 blind files carry both fields),
// tally `${count}/${color}` once per FILE and once per REPLY ROW (a file
// with 8 provider results contributes 8 row-tallies at the same cell), find
// the modal cell, and report it alongside its own independence check — how
// many DISTINCT images were cited at that cell, so a concentrated prior
// backed by one recycled fixture cannot be mistaken for a concentrated draw
// (T-072 already ruled this out for the COUNT margin; this checks the joint
// cell fresh, because "not concentrated on one axis" does not imply "not
// concentrated on the pair").
export function computeCorpusPrior(entries) {
  const byFileCell = new Map();
  const byRowCell = new Map();
  const imagesByCell = new Map();
  const allImages = new Set();
  let totalFiles = 0;
  let totalRows = 0;
  for (const e of entries) {
    const cell = `${e.count}/${e.color}`;
    totalFiles++;
    totalRows += e.rowCount;
    byFileCell.set(cell, (byFileCell.get(cell) || 0) + 1);
    byRowCell.set(cell, (byRowCell.get(cell) || 0) + e.rowCount);
    if (e.imagePath) {
      allImages.add(e.imagePath);
      if (!imagesByCell.has(cell)) imagesByCell.set(cell, new Set());
      imagesByCell.get(cell).add(e.imagePath);
    }
  }
  let modalCell = null;
  let modalFileCount = 0;
  for (const [cell, n] of byFileCell) {
    if (n > modalFileCount) {
      modalFileCount = n;
      modalCell = cell;
    }
  }
  const modalRowCount = modalCell ? byRowCell.get(modalCell) || 0 : 0;
  const modalImages = modalCell ? (imagesByCell.get(modalCell)?.size ?? 0) : 0;
  // DERIVED from modalImages/modalFileCount, never asserted — this is the
  // field a caller must check before quoting the realised prior at all.
  const independentEnough = modalCell
    ? modalImages >= modalFileCount * INDEPENDENCE_MIN_IMAGE_SHARE
    : false;
  return {
    totalFiles,
    totalRows,
    visitedCells: byFileCell.size,
    distinctImages: allImages.size,
    modalCell,
    modalFileCount,
    modalRowCount,
    modalImages,
    independentEnough,
    independenceThreshold: INDEPENDENCE_MIN_IMAGE_SHARE,
    fileRate: totalFiles ? modalFileCount / totalFiles : null,
    rowRate: totalRows ? modalRowCount / totalRows : null,
  };
}

// T-029: pulled out of the report-scanning block below, same reason as
// gradeReply above — a check whose numerator can never read below its
// denominator (T-026 gave reports/vision-probe a second tracked population,
// PNGs, that an un-filtered `git ls-files` folded into a json-only count)
// has to be provable against a shortfall, and that needs a temp git repo a
// unit test can build (tests/iaGradeTracked.test.js), not the real corpus.
// Returns null (not a throw) outside a git checkout / on any git failure —
// callers show the "not a git checkout" fallback in that case.
export function countTrackedFiles(pattern, cwd = process.cwd()) {
  try {
    return execSync(`git ls-files "${pattern}"`, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")
      .filter(Boolean).length;
  } catch {
    return null;
  }
}

// Guarded the same way vision-probe.mjs is (T-025): importing gradeReply for
// a test must not also scan reports/vision-probe and print a report.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const dir = "reports/vision-probe";
  const BESPOKE = new Set(["chatgpt", "gemini", "deepseek", "grok", "copilot"]);
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  // T-033: this is a RAW BYTE hash, deliberately — see the file loop below,
  // which grades on JSON.parse and does not care about line endings. The
  // digest does, on purpose, which is exactly what let it catch a checkout
  // producing different bytes than the tree it came from (root cause and fix
  // in .gitattributes at the repo root — read that file before assuming two
  // different digests mean two different corpora).
  const h = crypto.createHash("sha256");
  for (const f of files) h.update(fs.readFileSync(path.join(dir, f)));
  const rows = [];
  let skipped = 0;
  // T-072: a blind run (vision-probe.mjs --blind) is marked by `blind: true`
  // at the FILE's top level — the field the ticket asked for, not a filename
  // substring nothing greps. Collected separately from `rows`: none of the
  // sighted grading below applies (no truth, no imageAttached — the server
  // takes no upload path at all for a blind turn, confirmed live: T-072's
  // own measurement found imageAttached undefined on every one of 29 blind
  // turns). A blind file's rows would already fall through the imageAttached
  // gate below into `skipped` if this branch didn't exist first — routed
  // here instead so they are counted as what they are, not as an unexplained
  // skip.
  const blindRows = [];
  let blindErrored = 0;
  const priorEntries = [];
  for (const f of files) {
    let j;
    try {
      j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    } catch {
      continue;
    }
    if (j.blind === true) {
      for (const r of j.results || []) {
        if (r.raw == null) {
          // ERROR-shaped blind turn (timeout, HTTP failure) — no text to
          // grade. Counted, not silently dropped.
          blindErrored++;
          continue;
        }
        const g = gradeBlindReply(r.raw);
        blindRows.push({ f, p: r.providerId, ...g });
      }
      continue;
    }
    // T-087: every result row in this file counts toward the corpus prior,
    // regardless of imageAttached — that gate is about the flag's own
    // evidence, not about what stimulus was drawn. A file missing `truth` or
    // holding zero results (neither should happen, but nothing upstream
    // guarantees it) contributes nothing rather than a cell keyed on
    // "undefined/undefined".
    if (j.truth?.count != null && j.truth?.color && j.results?.length) {
      priorEntries.push({
        count: j.truth.count,
        color: j.truth.color,
        rowCount: j.results.length,
        imagePath: j.imagePath || null,
      });
    }
    for (const r of j.results || []) {
      // Skips any result with no boolean imageAttached — not only rows that
      // predate the field being added, but ERROR-shape turns from CURRENT code
      // that never got far enough to set it (measured, not assumed: T-019
      // found 11 of a prior count's 40 skips were 05e5a13-era zai timeouts,
      // recorded the same session this comment was first written).
      if (r.imageAttached !== true && r.imageAttached !== false) {
        skipped++;
        continue;
      }
      const graded = gradeReply(r.raw, j.truth);
      rows.push({
        f,
        p: r.providerId,
        cls: BESPOKE.has(r.providerId) ? "bespoke" : "generic",
        ia: r.imageAttached,
        // T-038: added after every row currently on disk was written — see
        // section 4 below for why an absent value here is not "unknown
        // cause", it's "cause was never computed for this row".
        cause: r.imageAttachedCause,
        // T-027: stored `shape` (r.shape) deliberately NOT carried here — it
        // can be stale (whatever classify() said at write time; see the
        // comment in vision-probe.mjs), and this row already computes its
        // own current echo/said/seesNo via gradeReply() below. Carrying the
        // stale field forward unread was exactly the shape of the next bug.
        raw: graded.raw,
        echo: graded.echo,
        said: graded.said,
        truth: j.truth?.count ?? null,
        right:
          graded.said !== null && j.truth
            ? graded.said === j.truth.count
            : null,
        seesNo: graded.seesNo,
        // T-053 review: a deliberate evidence-break test's own report is
        // self-identifying (vision-probe.mjs's --planted-break), which is
        // what lets section 3 below exclude it from the flag's NATURALLY-
        // OCCURRING refutable population instead of the two looking
        // identical to a reader who only sees `imageAttached`/`raw`.
        plantedBreak: j.plantedBreak || null,
      });
    }
  }

  // T-072: computed here (once, before any section prints) so section 3's
  // conditional wording and section 5's own report read the same numbers —
  // never two independently-filtered passes that could quietly disagree.
  const BLIND_EXCLUDED = new Set(["ECHO", "ERROR", "NO_ANSWER"]);
  const blindInformative = blindRows.filter(
    (r) => !BLIND_EXCLUDED.has(r.shape),
  );
  const blindGuessed = blindInformative.filter((r) => r.stated !== null);
  // T-087: same reasoning — computed once, read by section 3.
  const prior = computeCorpusPrior(priorEntries);
  const blindRefused = blindInformative.filter((r) => r.stated === null);

  console.log(
    `corpus  ${files.length} files, sha256-16 ${h.digest("hex").slice(0, 16)}   graded rows ${rows.length}  (${skipped} skipped, no imageAttached)`,
  );
  // Computed, not asserted (T-019: this line used to hardcode "reports/ is
  // gitignored ... returns 0", true when written and false since the same
  // ticket that wrote it tracked the corpus one commit later). Degrades
  // gracefully outside a git checkout — a tarball of this repo must not crash
  // the tool over a status line.
  // T-029: T-026 gave this directory a SECOND tracked population (57 fixture
  // PNGs) that this line's denominator (`files.length`, jsons only) never
  // counted. The old un-filtered "git ls-files reports/vision-probe" picked
  // up both, so the ratio compared 118 tracked files against 61 graded ones
  // — a numerator that can never read below its denominator even when a
  // json genuinely is untracked, because a PNG surplus masks any json
  // shortfall. Scope the tracked-count to the SAME population (*.json) this
  // banner is actually about, and report the png count separately rather
  // than folding it into the ratio. Degrades gracefully outside a git
  // checkout (T-019) — a tarball of this repo must not crash the tool over
  // a status line.
  const trackedJson = countTrackedFiles("reports/vision-probe/*.json");
  if (trackedJson === null) {
    console.log(`        (not a git checkout — tracking status unknown)`);
  } else {
    const trackedPng = countTrackedFiles("reports/vision-probe/*.png") ?? 0;
    console.log(
      `        (tracked in git: ${trackedJson} of ${files.length} files + ${trackedPng} fixture pngs tracked)`,
    );
  }

  console.log("\n1. PER-TURN MEASUREMENT, OR PER-PROVIDER CONSTANT?");
  const byp = {};
  // A filename containing "broken" is a deliberately sabotaged control run
  // (T-017 clause 1: a real provider's attach path disabled on purpose, on a
  // spare bridge instance, to prove the flag CAN move) — real, recorded data,
  // but not a naturally-occurring measurement of the flag's own behaviour, so
  // it is marked rather than silently pooled into "how the flag behaves".
  const isControl = (r) => /broken/i.test(r.f);
  for (const r of rows)
    ((byp[r.p] ||= { cls: r.cls, vals: new Set(), n: 0, natural: [] }),
      byp[r.p].vals.add(r.ia),
      byp[r.p].n++,
      isControl(r) || byp[r.p].natural.push(r.ia));
  for (const p of Object.keys(byp).sort()) {
    const b = byp[p];
    const controls = b.n - b.natural.length;
    console.log(
      `   ${p.padEnd(11)} ${b.cls.padEnd(8)} imageAttached=${String([...b.vals].join("/")).padEnd(6)} on all ${String(b.n).padStart(2)} of its turns${controls ? `  (${controls} of those a deliberate-breakage control)` : ""}`,
    );
  }
  const both = Object.entries(byp)
    .filter(([, b]) => b.vals.size > 1)
    .map(([p]) => p);
  console.log(
    `   providers taking BOTH values: ${both.length ? both.join(", ") : "(none) - 0 of " + Object.keys(byp).length}`,
  );
  // Computed, not asserted: majority-vote-per-provider accuracy over the
  // NATURAL rows only (deliberate-breakage controls excluded — they exist to
  // prove the flag CAN move, not to be predicted by a rule that assumes it
  // doesn't; folding them in would silently answer clause 1's own question).
  let correct = 0,
    natTotal = 0;
  for (const b of Object.values(byp)) {
    if (!b.natural.length) continue;
    const trueCount = b.natural.filter(Boolean).length;
    const majority = trueCount * 2 >= b.natural.length;
    const majorityCount = b.natural.filter((v) => v === majority).length;
    correct += majorityCount;
    natTotal += b.natural.length;
  }
  console.log(
    `   "predict the flag from the provider id alone" (majority vote per provider, natural rows only) scores ${correct}/${natTotal}`,
  );

  console.log(
    "\n2. REGRADED AGAINST COUNT (the field the prompt never states; range 3..9, COLORS 4)",
  );
  const cell = (ia, k) => rows.filter((r) => r.ia === ia && k(r)).length;
  console.log(
    '                        COUNT right  COUNT wrong  "SEES=no"  prompt echo  nothing usable',
  );
  for (const ia of [true, false])
    console.log(
      `   imageAttached=${String(ia).padEnd(5)}       ${String(cell(ia, (r) => r.right === true)).padEnd(12)} ${String(cell(ia, (r) => r.right === false)).padEnd(12)} ${String(cell(ia, (r) => r.seesNo)).padEnd(10)} ${String(cell(ia, (r) => r.echo)).padEnd(12)} ${cell(ia, (r) => !r.echo && !r.seesNo && r.said === null)}`,
    );

  // T-053 review: planted rows are counted separately, not folded into the
  // naturally-occurring refutable population — a deliberate break proves
  // the flag CAN be wrong under a broken evidence check, which is not the
  // same claim as "this many turns happened to refute it on their own",
  // and the two must not read as one number to a script or a reader who
  // only sees the tally.
  const refutableAll = rows.filter((r) => r.ia === false && r.said !== null);
  const refutable = refutableAll.filter((r) => !r.plantedBreak);
  const planted = refutableAll.filter((r) => r.plantedBreak);
  const confirming = rows.filter((r) => r.ia === true && r.right === true);
  console.log(
    `\n3. HOW MANY OF THE ${rows.length} COULD EVER HAVE CONTRADICTED THE FLAG?`,
  );
  // T-087: KEY_SPACE (the generator's true odds) and the corpus's own
  // REALISED cell frequency are different questions — see the function
  // comment above computeCorpusPrior. Printed side by side, both labelled,
  // computed fresh from the files on disk every run (never typed, same rule
  // T-012 already won for KEY_SPACE itself). formatCorpusPriorBlock is the
  // pure/exported/testable half; this call site just prints its lines.
  const colorChoices = Object.keys(COLORS).length;
  for (const line of formatCorpusPriorBlock(prior, COUNT_RANGE, colorChoices)) {
    console.log(line);
  }
  // T-094: the denominator here used to be `cell(false, () => true)` —
  // EVERY imageAttached=false row, planted ones included — while the
  // numerator (`refutable`, above) already excludes them. Section 4's own
  // "N imageAttached=false rows" reads the same unfiltered total, so the
  // two agreed with each other and neither was the naturally-occurring
  // population the line claims to report.
  //
  // T-094 REDO: a first pass excluded planted rows from the denominator on
  // the SAME predicate as `refutable` (imageAttached=false, !plantedBreak)
  // but `refutable`/`planted` are drawn from `refutableAll`, which is
  // additionally restricted to `said !== null` — a planted row that states
  // no COUNT at all (this corpus has one: chatgpt's plantedBreak row is a
  // bare "SEES=no") is subtracted out of the naturally-occurring
  // denominator but never lands in `planted` either, since it never enters
  // `refutableAll`. The printed pair silently lost a row: naturalFalseCount
  // + planted.length stopped summing to section 4's own total. Fixed by
  // printing the PLANTED denominator too — `cell(false, (r) =>
  // !!r.plantedBreak)`, every planted imageAttached=false row regardless of
  // whether it states a count — so the two denominators are a real
  // partition of section 4's total and the line reconciles with it,
  // instead of silently dropping whichever planted row never got the
  // chance to disagree.
  const naturalFalseCount = cell(false, (r) => !r.plantedBreak);
  const plantedFalseCount = cell(false, (r) => !!r.plantedBreak);
  console.log(
    `   imageAttached=false turns that state a COUNT at all: ${refutable.length} of ${naturalFalseCount} naturally-occurring (+ ${planted.length} of ${plantedFalseCount} planted, listed separately)`,
  );
  for (const r of refutable)
    console.log(
      `     ${r.f.padEnd(28)} ${r.p.padEnd(10)} said=${r.said} truth=${r.truth} right=${r.right} :: ${r.raw.slice(0, 42)}`,
    );
  if (planted.length) {
    console.log(
      `   PLANTED (deliberate evidence-break, not naturally-occurring):`,
    );
    for (const r of planted)
      console.log(
        `     ${r.f.padEnd(28)} ${r.p.padEnd(10)} said=${r.said} truth=${r.truth} right=${r.right} :: ${r.plantedBreak}`,
      );
  }
  console.log(
    `   -> disagreements: ${refutable.filter((r) => r.right).length} of ${refutable.length} naturally-occurring refutable turns` +
      (planted.length
        ? ` (+ ${planted.filter((r) => r.right).length} of ${planted.length} planted)`
        : ""),
  );
  // T-072: this prior used to be stated as purely DERIVED (L-002 rung 2) —
  // "a correct COUNT cannot be a guess because it is 1-in-7 by chance" — and
  // had never been measured, because no code in this tree could send the
  // probe's own prompt with nothing attached until vision-probe.mjs grew
  // --blind. When blind rows exist, the sentence says the MEASURED fact
  // instead of the derived one; when none exist (unchanged corpus), this
  // prints the exact original sentence — see section 5 for the numbers and
  // scope of what the blind arm does and does not cover.
  console.log(
    blindInformative.length
      ? `   -> agreements resting on a MEASURED prior (${blindRefused.length} of ${blindInformative.length} blind, informative turns stated no count at all — section 5): ${confirming.length}, every one imageAttached=true`
      : `   -> agreements resting on an arithmetic reference: ${confirming.length}, every one imageAttached=true`,
  );
  // T-087 clause 3: TWO separate nulls back that "agreements" line, and they
  // are priced differently — see formatTwoNullsLine's own comment for why
  // this is a separate pure function from formatCorpusPriorBlock rather
  // than reading prior.rowRate directly here (the review-round-2 leak).
  console.log(
    formatTwoNullsLine(
      prior,
      blindRefused.length,
      blindInformative.length,
      COUNT_RANGE,
      colorChoices,
    ),
  );
  // T-094 review of the same fault: this bucket is "everything that is
  // neither confirming nor naturally-occurring refutable" — planted rows
  // are neither (they are their own, deliberately-excluded population,
  // same as the line above), but were never subtracted out here, so this
  // count silently absorbed every plant, growing by exactly planted.length
  // each time one landed.
  //
  // T-098: that fix itself used `planted` (refutableAll's plant subset —
  // said !== null, i.e. only planted rows that STATE a count), not
  // `plantedFalseCount` (every planted imageAttached=false row, said or
  // not — the same population the denominator four lines above prints as
  // "planted"). chatgpt's own plantedBreak row states no count, so it is
  // in `plantedFalseCount` but not in `planted`: subtracting `planted`
  // here left that one row still inside "neither", double-counted against
  // the SAME row the header line had already accounted for as planted. One
  // definition of "planted" for this whole section: `plantedFalseCount`,
  // because that is the population the reader sees named "planted" four
  // lines up — not a second, narrower one reused under the same word.
  console.log(
    `   -> turns graded by the model's own testimony about its own input, or by nothing: ${rows.length - confirming.length - refutable.length - plantedFalseCount}`,
  );

  // T-038: WHICH cause a false row carries, where one was ever computed.
  // Every row on the shelf when this section was added predates the
  // classifier (uploadFile.js throwing UploadOutcomeError instead of a bare
  // false/Error) — clause 7 of T-038 forbids backfilling them with today's
  // classifier, so they print as "cause absent (pre-T-038)" rather than a
  // guess dressed as a reading. The number worth re-checking over time is
  // how many DISTINCT labels appear here on a corpus recorded AFTER T-038 —
  // 1 distinct label (all "cause absent") means nothing has moved yet.
  console.log(`\n4. WHEN imageAttached=false, WHY? (T-038's cause field)`);
  const falseRows = rows.filter((r) => r.ia === false);
  const causeCounts = new Map();
  for (const r of falseRows) {
    const label = r.cause || "cause absent (pre-T-038)";
    causeCounts.set(label, (causeCounts.get(label) || 0) + 1);
  }
  console.log(
    `   ${falseRows.length} imageAttached=false rows, ${causeCounts.size} distinct cause label(s):`,
  );
  for (const [label, n] of causeCounts) {
    console.log(`     ${String(n).padStart(3)} x  ${label}`);
  }

  // T-072: section 3's "arithmetic reference" is a DERIVED prior (L-002
  // rung 2) — a correct COUNT cannot be a guess because it is 1-in-7 by
  // chance — and until vision-probe.mjs grew --blind, no code in this tree
  // could take the one measurement that would move it from derived to
  // measured: send the probe's own prompt with nothing attached at all,
  // and see whether any provider states a count anyway.
  //
  // SCOPE, stated because the whole value of this measurement depends on
  // it: this tests "no image in the request" — the composer receives no
  // file at all. It is NOT the same arm as "an image WAS handed to the
  // composer and evidence did not confirm it" (imageAttached:false in
  // production), where the model may well have actually received the
  // file. This section licenses the CONFIRMING direction only (a correct
  // COUNT really is arrival evidence, not a guess) and says nothing about
  // the REFUTING direction (a false imageAttached that states a count
  // anyway) — that reading is section 3's own, unaffected by this one.
  console.log(
    `\n5. BLIND ARM (T-072) — does any provider state a COUNT with no image in the request at all?`,
  );
  console.log(
    `   SCOPE: tests "no image in the request", not "image handed to the composer and evidence unconfirmed" — licenses the CONFIRMING direction only (section 3's REFUTING direction is untouched by this).`,
  );
  if (blindRows.length === 0) {
    console.log(`   0 of 0 — no blind rows recorded`);
  } else {
    console.log(
      `   blind rows ${blindRows.length}  (${blindErrored} ERROR-shaped, excluded — no text to grade)   ` +
        `informative (not ECHO/ERROR/NO_ANSWER) ${blindInformative.length}   ` +
        `refused, stated no count ${blindRefused.length}   ` +
        `STATED A COUNT ${blindGuessed.length}`,
    );
    if (blindGuessed.length) {
      console.log(
        `   PROVIDER(S) THAT STATED A COUNT WHILE BLIND — THIS IS THE RESULT:`,
      );
      for (const r of blindGuessed) {
        console.log(
          `     ${r.f.padEnd(28)} ${r.p.padEnd(10)} stated=${r.stated} :: ${r.raw.slice(0, 60)}`,
        );
      }
    }
  }
}
