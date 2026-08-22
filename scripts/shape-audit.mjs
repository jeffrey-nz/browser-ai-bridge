#!/usr/bin/env node
/**
 * shape-audit.mjs — T-027. `shape` stored in reports/vision-probe/*.json is a
 * measurement taken once, at write time, by whatever classify() said that
 * day (see the comment beside `const cls = classify(...)` in
 * vision-probe.mjs). It is never backfilled when the classifier is later
 * corrected — same policy as gradingProvenance()'s sha/commit fields, and
 * for the same reason: stamping today's grading onto yesterday's run would
 * turn an honest "this was graded by an older classifier" into a silent,
 * confident falsehood.
 *
 * This script is the reader-side half of that policy: it recomputes `shape`
 * from each row's stored `raw` via the CURRENT classify(), and reports every
 * row where the two disagree — so "the corpus disagrees with HEAD" is
 * something anyone can see printed, not something that has to be
 * rediscovered by hand each time the classifier changes. It does not
 * change anything on disk; `raw` is evidence and `shape` is left exactly as
 * recorded.
 *
 * Prints, does not fail the suite (see tests/shapeAudit.test.js for the
 * pinned unit test of the comparison logic itself, against synthetic rows —
 * not against this real corpus, which is expected to accumulate new
 * disagreements every time classify() is corrected; that is drift, not
 * regression, and a check that fails the build on drift would either be
 * disabled at the first real classifier fix or force a backfill this
 * ticket's own policy says not to do).
 *
 * Usage: node scripts/shape-audit.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { classify, MIN_COUNT, COUNT_RANGE } from "./vision-probe.mjs";

const MAX_COUNT = MIN_COUNT + COUNT_RANGE - 1;

export function auditShapes(dir) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  let rowsWithRaw = 0;
  // T-107: providerId -> {n, bridgeAttributable, unattributed} for a row
  // with no `raw` at all — the row loop's own first drop, before
  // rowsWithRaw itself starts counting. See the comment at the drop site
  // (the `if (r.raw == null)` branch, first line of the row loop) for the
  // full account of why this is tracked separately from every other
  // exclusion in this file.
  const noReplyByProvider = {};
  // T-088: `rowsWithRaw` counts EVERY row with raw text — blind (no
  // picture at all, vision-probe.mjs --blind) and sighted alike — while
  // every truth-gated table below (countStrata, providerStrata, the
  // exclusion tables, out-of-range, and now wrongRows) runs on sighted
  // rows only, because a blind row carries no `truth` to grade a COUNT or
  // COLOR against. Blind rows correctly stay IN the shape histogram (a
  // blind SEES_NO is still a real, correctly-shaped reply — the histogram
  // is a shape tally, not a correctness rate) but the headline must say so
  // explicitly, or a reader has no way to know the histogram's denominator
  // and the tables' denominator are two different populations that happen
  // to both be printed under one number.
  let blindRowsWithRaw = 0;
  // T-091: see the isGradable/isBlindFile comment in the row loop below —
  // rows where the two predicates disagree, named so the day one exists
  // it is visible rather than silently absorbed into a headline count
  // that no longer matches the tables beneath it.
  const sightedNoTruthRows = [];
  const blindWithTruthRows = [];
  const disagreements = [];
  const storedHistogram = {};
  const recomputedHistogram = {};
  // T-050: COUNT right/wrong is a rate ON THE STIMULUS a row was measured
  // against, not a provider-general accuracy figure — a live paired test
  // (this ticket) found one provider go 0/3 at truth.count=9 and 3/3 at
  // truth.count=4 with no code change between them. A single histogram
  // collapsing every count together hides exactly that swing; bucket by
  // truth.count instead, computed fresh from the JSON on disk each run —
  // never hand-typed, so it cannot go stale the way a sentence would.
  //
  // T-063: truth.count is not the only thing that varies row to row — WHICH
  // PROVIDERS were swept on any given day varies too, and that second
  // covariate correlates with the outcome harder than count does (measured:
  // pooling the 3-5/6-9 bands over whatever provider set happened to be
  // present in each moved the gap from 100.0/60.0, over the 6 providers with
  // rows in both bands, to 91.7/68.4 pooled — 17 points, in the reassuring
  // direction, from 3 of 9 providers appearing in one band only). `providers`
  // per stratum (a Set, not a count typed by hand) and `providerBand` (every
  // provider's own easy/hard tally, so pooled and paired-only can both be
  // computed from the same source) exist so a reader — or this script's own
  // printed line — never has to pool across an unstated, uneven provider mix
  // to get a headline number.
  const countStrata = {};
  const providerBand = {};
  // T-063 clause 4: is the SEES_NO/ECHO/NO_ANSWER exclusion itself
  // count-dependent? If the drop rate rises with truth.count, the COUNT-right
  // rate above is silently measured on an easier-selected subset at the hard
  // end, on top of the provider-mix effect above. `shapeByCount` carries every
  // recomputed shape (not just the structured ones countStrata keeps), keyed
  // by truth.count, so the answer is read off the same pass, not assumed.
  const shapeByCount = {};
  const EXCLUDED_SHAPES = new Set(["SEES_NO", "ECHO", "NO_ANSWER"]);
  // T-065: shapeByCount's 46.4-point spread across counts is the SAME
  // provider-mix covariate T-063 already named, reappearing in a second
  // table — by band (easy/hard) the exclusion rate barely moves (2.6
  // points), by provider it moves the entire range (0% to 100%). Tracked
  // per (provider, band) — not just per provider — so a provider named as
  // "unpaired" in bandStats() can be told apart by WHICH KIND of absence it
  // is: zero rows in that band at all, versus rows that exist and were all
  // excluded (a measurement property of that provider, not a scheduling
  // gap more sweeping would fix). Same gate as shapeByCount (raw present,
  // truth.count present) — deliberately NOT gated on countOk, unlike
  // providerBand above, because an excluded row by definition never gets a
  // countOk verdict and would be invisible to this table if it were.
  const exclusionByProviderBand = {};
  // T-076: a WRONG count outside MIN_COUNT..MAX_COUNT names a picture the
  // generator could never have drawn — strictly stronger than "got it
  // wrong". classify() already flags this (outOfRange, derived from the
  // SAME two constants, not a second "3 to 9"); collected here so the
  // adjacent-to-boundary split (a miscount by a model that was looking)
  // can be told apart from everything else (a fabrication by one that
  // wasn't) — see the LIMIT in the comment above classify()'s own check,
  // which applies here identically: a zero count here is not evidence
  // nobody fabricated, only that nobody fabricated conspicuously.
  const outOfRangeRows = [];
  // T-084 clause 5: a per-provider rate is only comparable to another
  // provider's if they were shown comparable stimuli — gemini has seen all
  // 7 counts, perplexity exactly 1. Tracked per provider as the SET of
  // truth.count values it has ever been graded against (same structured
  // gate countStrata/providerBand use), so "gemini 100%, deepseek 79%"
  // cannot be printed as a ranking without the coverage that makes it one
  // printed right beside it.
  const providerStrata = {};
  // T-092: providerId -> Map(truth.count -> {n, ok}) — the cross-tab
  // providerStrata's own totals cannot show. See the comment where it is
  // populated below for why this exists.
  const providerCountCells = {};
  // T-096: providerStrata/providerCountCells above are the GRADED
  // population — gated on `countOk !== undefined`, which is exactly the
  // gate that drops SEES_NO/ECHO/NO_ANSWER out of a provider's own
  // denominator before it is ranked. A provider that refuses on every hard
  // turn removes those turns from its own scorecard rather than failing
  // them. providerSighted/providerSightedCells/countStrataSighted mirror
  // the graded structures exactly (same shape, same computeStandardizedRates
  // contract) but over EVERY sighted row regardless of shape — a refusal
  // counts as a row that did not state the count, i.e. wrong — so a
  // provider cannot rank itself up by being excluded more.
  const providerSighted = {};
  const providerSightedCells = {};
  const countStrataSighted = {};
  // T-106: the per-provider RANKING block (built from the four structures
  // above/below) had no concept of a deliberate evidence-break plant
  // (vision-probe.mjs --planted-break, ia-grade.mjs's own `plantedBreak` —
  // T-053) at all. Three of today's four plants are RIGHT answers, by
  // design (a plant breaks the EVIDENCE check and leaves the upload
  // working), so they inflate the provider they were performed on in a
  // ranking that is supposed to read as "how well does this provider do
  // naturally". These mirror providerStrata/providerCountCells/countStrata
  // and providerSighted/providerSightedCells/countStrataSighted exactly,
  // but exclude planted rows — used ONLY by the per-provider ranking block;
  // every other table in this file (per-truth.count, the cross-tab) keeps
  // reading the ORIGINAL, plant-including structures above, unchanged, per
  // this ticket's own clause 7 ("nothing else moves").
  const providerStrataNoPlant = {};
  const providerCountCellsNoPlant = {};
  const countStrataNoPlant = {};
  const providerSightedNoPlant = {};
  const providerSightedCellsNoPlant = {};
  const countStrataSightedNoPlant = {};
  let plantedRowCount = 0;
  // T-096 clause 4: EXCLUDED_SHAPES pools three different failure modes
  // under one argument (transport failure) that only actually applies to
  // SEES_NO. Tracked per provider so ECHO (T-136: GROK's mechanism is
  // settled as NOT this bridge's own extraction reading its own prompt
  // bubble back — see the T-106/T-136 comment further below; this is a
  // grok-specific finding, not a claim about deepseek/mistral/qwen's own
  // ECHO rows, which are untested) and NO_ANSWER (empty/unmatched reply)
  // are visible as what they are, not folded into "excluded" as if every
  // one were "the image never arrived".
  const providerExcludedByShape = {};
  // T-106 review: the ranking's own denominator (providerSightedNoPlant)
  // excludes planted rows, but this per-shape suffix did not — so a
  // provider whose plant happens to be SEES_NO-shaped (chatgpt's is: run-
  // 1787366633944.json, a plant that is NOT a right answer, unlike the
  // other three) had its excluded-shape count include a row the ranking's
  // own denominator had already removed, producing a NEGATIVE residual
  // (n - graded.n - excluded ≠ 0) — an invariant that held for every
  // provider before this file had any concept of a plant at all. Mirrors
  // providerExcludedByShape exactly, gated on the same `isPlanted` the
  // ranking's other NoPlant structures already use, populated at the same
  // site. The ranking print loop reads this one; the ORIGINAL
  // (plant-including) providerExcludedByShape is untouched and still feeds
  // the NO_ANSWER-attribution line below, which is not a ranking figure.
  const providerExcludedByShapeNoPlant = {};
  // T-084 clause 4: vision-probe.mjs's header already argues WRONG is not
  // an upload bug — "the model saw *something* and was confidently mistaken
  // about it". Collected here so that argument has numbers behind it in an
  // ARTEFACT, not only in a comment: how many WRONG rows named the colour
  // correctly anyway (positive evidence of arrival on a field the model got
  // right), printed beside T-072's blind-arm null (0 of N informative blind
  // turns ever state a count at all).
  const wrongRows = [];
  // T-078: the denominator the zero-tally line below needs — "0 of N" vs
  // "0 of 0" are different facts and only the corpus knows which. Same
  // population outOfRangeRows is drawn from (a structured reply, one that
  // carried a countOk verdict at all), counted alongside countStrata's own
  // gate rather than summed from it after the fact, so this can never drift
  // from what countStrata actually bucketed.
  let structuredCount = 0;

  for (const f of files) {
    let j;
    try {
      j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    } catch {
      continue;
    }
    const isBlindFile = j.blind === true;
    // T-106: a deliberate evidence-break test (vision-probe.mjs
    // --planted-break, the same file-level field ia-grade.mjs's own
    // `plantedBreak` reads and partitions on, T-053) proves the
    // imageAttached FLAG can be wrong under a broken evidence check — it
    // is not a naturally-occurring reading of that provider's own
    // behaviour, and three of today's four plants are RIGHT answers that
    // would otherwise inflate the provider they were performed on in a
    // per-provider RANKING (this file had no concept of the field at all
    // until now; ia-grade.mjs has separated planted from naturally-
    // occurring since T-053). Excluded from the per-provider ranking
    // populations below — NOT from every table in this file: the
    // per-truth.count table and the PROVIDER x TRUTH.COUNT cross-tab are a
    // different question (are these four counts right or wrong, full
    // stop) and are unaffected on purpose, so a diff of this file's other
    // sections stays clean, per this ticket's own clause 7.
    const isPlanted = j.plantedBreak !== undefined;
    // T-091: the one place this file decides "does this row have a
    // gradable truth" — every truth-gated table below (WRONG bucket,
    // out-of-range, shapeByCount/exclusion, countStrata/providerStrata)
    // used to repeat the same optional-chained truth-count check inline,
    // four times.
    // Computed once here so a future table can only get this right or
    // wrong once, not once per copy.
    //
    // Deliberately NOT merged with `isBlindFile` into one predicate: they
    // measure different things. `isBlindFile` is what the PROBE intended
    // (a --blind run, by design has no truth). `isGradable` is what this
    // FILE actually carries. A genuinely blind row is correctly
    // ungradable — that is not a fault, it is the point of --blind. A
    // SIGHTED row with no gradable truth (a stimulus that failed to
    // generate, an aborted --pin run) is a different, unexpected fact, and
    // collapsing the two into one boolean would erase exactly the
    // distinction clause 2 below exists to surface.
    const isGradable = j.truth?.count !== undefined;
    for (const r of j.results || []) {
      // T-107: this is the FIRST statement in the row loop — every table
      // below (rowsWithRaw itself, and everything gated on it downstream:
      // the exclusion tables, the ranking) runs on rows that SURVIVE this
      // line. A row with no `raw` at all — an HTTP 500, a locator timeout,
      // a closed page, a fetch failure — never produced a reply to grade,
      // which is categorically different from SEES_NO/ECHO/NO_ANSWER
      // (T-106): those are real replies FROM the provider, gradable and
      // graded; this is the round trip never completing at all. Measured,
      // 39 of 185 sighted gradable rows (21.1%) are dropped here, before
      // rowsWithRaw — the largest single exclusion in this file, and
      // reached before the headline that is supposed to be the
      // denominator for everything after it even starts counting.
      //
      // CLAUSE 3, OPTION (b): stays OUT of the end-to-end ranking, not
      // folded in as a provider failure. T-096's own caution — "a provider
      // cannot rank itself up by being excluded more" — does not transfer
      // here the way it does to SEES_NO/ECHO/NO_ANSWER, because those are
      // real answers a provider gave that this file chooses whether to
      // count; a no-reply row is not an answer of any shape, it is
      // evidence about whether THIS BRIDGE, on THIS turn, could complete a
      // round trip with that provider at all — a different question a
      // ranking of "how well does this provider read images" should not
      // silently answer by omission either. Counted and printed instead
      // (below), never silently dropped.
      if (r.raw == null) {
        if (isGradable && !isBlindFile) {
          const nr = (noReplyByProvider[r.providerId] ??= {
            n: 0,
            bridgeAttributable: 0,
            unattributed: 0,
          });
          nr.n++;
          // T-107 clause 6: split by what the record itself says, not
          // guessed. "input did not clear"/"locator.waitFor: Timeout"/a
          // page or session reported CLOSED are the bridge naming its OWN
          // interaction or infrastructure failure, in its own words —
          // bridge-attributable. A bare "timeout" or "fetch failed" names
          // no mechanism at all and is NOT attributable from the record —
          // it could be the provider, the network, or this bridge, and
          // saying which would be a guess this file has already refused
          // once (onList/colorUnresolved, T-089).
          const detail = r.detail || "";
          if (
            /input did not clear|locator\.waitFor: Timeout|has been closed|page was closed/i.test(
              detail,
            )
          ) {
            nr.bridgeAttributable++;
          } else {
            nr.unattributed++;
          }
        }
        continue;
      }
      rowsWithRaw++;
      if (isBlindFile) blindRowsWithRaw++;
      // T-091: the two predicates agree on every row recorded so far (0
      // sighted-without-truth, 0 blind-with-truth, measured at ce7a289) —
      // but nothing enforces that, and a future probe run could write
      // either mismatch silently. Tracked here, at row granularity (same
      // granularity `blindRowsWithRaw` already uses), so the day one
      // exists it is a printed fact instead of a rediscovered surprise.
      if (!isBlindFile && !isGradable) {
        sightedNoTruthRows.push({ file: f, providerId: r.providerId });
      }
      if (isBlindFile && isGradable) {
        blindWithTruthRows.push({ file: f, providerId: r.providerId });
      }
      storedHistogram[r.shape] = (storedHistogram[r.shape] || 0) + 1;
      // T-088 filed this ternary because classify()'s structured-reply
      // branch used to dereference `truth.count` unconditionally, throwing
      // on a blind row's absent truth. T-101 fixed classify() itself, so
      // the CRASH half of this is no longer this ternary's job — but the
      // ternary is not a crash guard that became redundant, it is a
      // SEPARATE statement that must stay: a blind row is ungradable BY
      // CONSTRUCTION, whatever `j.truth` happens to hold. `j.truth` being
      // absent on every blind row today is a fact about this corpus, not
      // an invariant anything enforces — the same gap `blindWithTruthRows`
      // above exists to catch. Passing `j.truth` straight through on a
      // blind row would grade a model's structured guess against a
      // picture it was never shown, manufacturing a PASS out of a corrupt
      // record the moment one exists. `undefined` reads better than the
      // old sentinel object now that classify() resolves it to the exact
      // same values, so kept in that shorter form — but the isBlindFile
      // branch itself stays.
      const recomputed = classify(r.raw, isBlindFile ? undefined : j.truth);
      recomputedHistogram[recomputed.shape] =
        (recomputedHistogram[recomputed.shape] || 0) + 1;
      if (recomputed.shape !== r.shape) {
        disagreements.push({
          file: f,
          providerId: r.providerId,
          storedShape: r.shape,
          recomputedShape: recomputed.shape,
        });
      }

      // T-088 clause 3: gated the SAME way every other truth-dependent
      // table in this file is (countStrata, providerStrata, exclusion,
      // out-of-range) — a blind row has no truth for colorOk to mean
      // anything against, so it does not belong in the WRONG-bucket
      // population even on the day classify() (now sentinel-truthed
      // above) stops throwing and starts returning a shape for one.
      if (recomputed.shape === "WRONG" && isGradable) {
        wrongRows.push({
          file: f,
          providerId: r.providerId,
          colorOk: recomputed.colorOk,
        });
      }

      if (recomputed.outOfRange && isGradable) {
        const m = /COUNT\s*=\s*(\d+)/i.exec(r.raw ?? "");
        const said = m ? Number(m[1]) : null;
        outOfRangeRows.push({
          file: f,
          providerId: r.providerId,
          truth: j.truth.count,
          said,
          imageAttached: r.imageAttached,
          onBoundary: said === MAX_COUNT + 1 && j.truth.count === MAX_COUNT,
        });
      }

      if (isGradable) {
        const cell = (shapeByCount[j.truth.count] ??= {
          total: 0,
          excluded: 0,
        });
        cell.total++;
        const isExcluded = EXCLUDED_SHAPES.has(recomputed.shape);
        if (isExcluded) cell.excluded++;

        const band = j.truth.count <= 5 ? "easy" : "hard";
        const pb = (exclusionByProviderBand[r.providerId] ??= {});
        const pcell = (pb[band] ??= { total: 0, excluded: 0 });
        pcell.total++;
        if (isExcluded) pcell.excluded++;

        // T-096: the SIGHTED population — every row with a truth to grade
        // against, regardless of shape. A refusal (SEES_NO/ECHO/NO_ANSWER)
        // is a real row that did not tell the count; it counts here (n++)
        // and does NOT count as right (only recomputed.countOk === true
        // does), so a provider cannot raise its own rate by having more of
        // its hard rows excluded.
        const ps = (providerSighted[r.providerId] ??= {
          countsShown: new Set(),
          n: 0,
          ok: 0,
        });
        ps.countsShown.add(j.truth.count);
        ps.n++;
        if (recomputed.countOk === true) ps.ok++;

        const pc = (providerSightedCells[r.providerId] ??= new Map());
        const sightedCell = pc.get(j.truth.count) ?? { n: 0, ok: 0 };
        sightedCell.n++;
        if (recomputed.countOk === true) sightedCell.ok++;
        pc.set(j.truth.count, sightedCell);

        const cs = (countStrataSighted[j.truth.count] ??= { n: 0 });
        cs.n++;

        if (isPlanted) {
          plantedRowCount++;
        } else {
          const psn = (providerSightedNoPlant[r.providerId] ??= {
            countsShown: new Set(),
            n: 0,
            ok: 0,
          });
          psn.countsShown.add(j.truth.count);
          psn.n++;
          if (recomputed.countOk === true) psn.ok++;

          const pcn = (providerSightedCellsNoPlant[r.providerId] ??= new Map());
          const sightedCellNoPlant = pcn.get(j.truth.count) ?? {
            n: 0,
            ok: 0,
          };
          sightedCellNoPlant.n++;
          if (recomputed.countOk === true) sightedCellNoPlant.ok++;
          pcn.set(j.truth.count, sightedCellNoPlant);

          const csn = (countStrataSightedNoPlant[j.truth.count] ??= {
            n: 0,
          });
          csn.n++;
        }

        if (isExcluded) {
          const eb = (providerExcludedByShape[r.providerId] ??= {
            SEES_NO: 0,
            ECHO: 0,
            NO_ANSWER: 0,
          });
          eb[recomputed.shape]++;

          if (!isPlanted) {
            const ebn = (providerExcludedByShapeNoPlant[r.providerId] ??= {
              SEES_NO: 0,
              ECHO: 0,
              NO_ANSWER: 0,
            });
            ebn[recomputed.shape]++;
          }
        }
      }

      // Same denominator vision-probe.mjs's own summary line uses: the
      // STRUCTURED subset (a row that carried a countOk verdict at all —
      // PASS/COUNT_ONLY/WRONG), keyed by the truth it was actually drawn
      // against.
      if (recomputed.countOk !== undefined && isGradable) {
        structuredCount++;
        const bucket = (countStrata[j.truth.count] ??= {
          n: 0,
          ok: 0,
          providers: new Set(),
        });
        bucket.n++;
        bucket.providers.add(r.providerId);
        if (recomputed.countOk) bucket.ok++;

        const ps = (providerStrata[r.providerId] ??= {
          countsShown: new Set(),
          n: 0,
          ok: 0,
        });
        ps.countsShown.add(j.truth.count);
        ps.n++;
        if (recomputed.countOk) ps.ok++;

        // T-092: the per-cell breakdown providerStrata's own SUMMED n/ok
        // cannot show — "mistral 57%" and "copilot 80%" read as two
        // providers doing differently, when six of this board's nine
        // recorded errors are copilot's and mistral's SAME failure at the
        // SAME stratum (count=9), and the gap between them is that 43% of
        // mistral's rows sit there against 20% of copilot's.
        const pc = (providerCountCells[r.providerId] ??= new Map());
        const cell2 = pc.get(j.truth.count) ?? { n: 0, ok: 0 };
        cell2.n++;
        if (recomputed.countOk) cell2.ok++;
        pc.set(j.truth.count, cell2);

        const band = j.truth.count <= 5 ? "easy" : "hard";
        const pb = (providerBand[r.providerId] ??= {});
        const cell = (pb[band] ??= { n: 0, ok: 0 });
        cell.n++;
        if (recomputed.countOk) cell.ok++;

        if (!isPlanted) {
          const bucketNoPlant = (countStrataNoPlant[j.truth.count] ??= {
            n: 0,
            ok: 0,
            providers: new Set(),
          });
          bucketNoPlant.n++;
          bucketNoPlant.providers.add(r.providerId);
          if (recomputed.countOk) bucketNoPlant.ok++;

          const psGradedNoPlant = (providerStrataNoPlant[r.providerId] ??= {
            countsShown: new Set(),
            n: 0,
            ok: 0,
          });
          psGradedNoPlant.countsShown.add(j.truth.count);
          psGradedNoPlant.n++;
          if (recomputed.countOk) psGradedNoPlant.ok++;

          const pcGradedNoPlant = (providerCountCellsNoPlant[r.providerId] ??=
            new Map());
          const gradedCellNoPlant = pcGradedNoPlant.get(j.truth.count) ?? {
            n: 0,
            ok: 0,
          };
          gradedCellNoPlant.n++;
          if (recomputed.countOk) gradedCellNoPlant.ok++;
          pcGradedNoPlant.set(j.truth.count, gradedCellNoPlant);
        }
      }
    }
  }

  return {
    rowsWithRaw,
    blindRowsWithRaw,
    disagreements,
    storedHistogram,
    recomputedHistogram,
    countStrata,
    providerBand,
    shapeByCount,
    exclusionByProviderBand,
    outOfRangeRows,
    structuredCount,
    providerStrata,
    providerCountCells,
    wrongRows,
    providerSighted,
    providerSightedCells,
    countStrataSighted,
    providerExcludedByShape,
    providerExcludedByShapeNoPlant,
    sightedNoTruthRows,
    blindWithTruthRows,
    providerStrataNoPlant,
    providerCountCellsNoPlant,
    countStrataNoPlant,
    providerSightedNoPlant,
    providerSightedCellsNoPlant,
    countStrataSightedNoPlant,
    plantedRowCount,
    noReplyByProvider,
  };
}

// T-065: exclusionByProviderBand → the same "by band" and "by provider"
// summaries clause 1 wants, plus (for a given set of provider ids — the
// ones bandStats() found unpaired) which KIND of absence each one is.
// Pulled out for the same reason bandStats() was: testable against
// synthetic data, and the classification ("no rows" vs "rows, excluded")
// is exactly the distinction the ticket's own goal draws between a
// scheduling gap and a measurement property.
export function exclusionStats(exclusionByProviderBand) {
  const byBand = {
    easy: { total: 0, excluded: 0 },
    hard: { total: 0, excluded: 0 },
  };
  const byProvider = {};
  const fullyExcluded = [];
  for (const providerId of Object.keys(exclusionByProviderBand).sort()) {
    const bands = exclusionByProviderBand[providerId];
    const totals = { total: 0, excluded: 0 };
    for (const band of ["easy", "hard"]) {
      const cell = bands[band];
      if (!cell) continue;
      byBand[band].total += cell.total;
      byBand[band].excluded += cell.excluded;
      totals.total += cell.total;
      totals.excluded += cell.excluded;
    }
    byProvider[providerId] = totals;
    if (totals.total > 0 && totals.excluded === totals.total) {
      fullyExcluded.push(providerId);
    }
  }
  return { byBand, byProvider, fullyExcluded };
}

// T-065: classifies ONE unpaired provider (bandStats()'s own output) as
// either genuinely absent from a band (0 rows) or present-but-fully-dropped
// (rows exist, all excluded) — "unpaired because nobody swept it" versus
// "unpaired because every row it produced got dropped" are different
// findings and bandStats()'s unpaired list alone cannot tell them apart.
export function classifyAbsence(exclusionByProviderBand, providerId, band) {
  const cell = exclusionByProviderBand[providerId]?.[band];
  if (!cell || cell.total === 0)
    return { kind: "absent", total: 0, excluded: 0 };
  if (cell.excluded === cell.total) {
    return { kind: "all-excluded", total: cell.total, excluded: cell.excluded };
  }
  return { kind: "mixed", total: cell.total, excluded: cell.excluded };
}

// T-063: pulled out of main() so the pooled-vs-paired distinction is
// unit-testable against synthetic providerBand data, same reasoning as
// auditShapes() itself being separate from main()'s printing. A provider
// with a stratum in only one band is named, not silently dropped from the
// pooled figure — pooled and paired answer different questions and this
// script must not choose one for the reader.
export function bandStats(providerBand) {
  const pooled = { easy: { n: 0, ok: 0 }, hard: { n: 0, ok: 0 } };
  const paired = { easy: { n: 0, ok: 0 }, hard: { n: 0, ok: 0 } };
  const unpaired = [];
  let pairedCount = 0;
  for (const providerId of Object.keys(providerBand).sort()) {
    const easy = providerBand[providerId].easy;
    const hard = providerBand[providerId].hard;
    if (easy) {
      pooled.easy.n += easy.n;
      pooled.easy.ok += easy.ok;
    }
    if (hard) {
      pooled.hard.n += hard.n;
      pooled.hard.ok += hard.ok;
    }
    if (easy && hard) {
      pairedCount++;
      paired.easy.n += easy.n;
      paired.easy.ok += easy.ok;
      paired.hard.n += hard.n;
      paired.hard.ok += hard.ok;
    } else {
      unpaired.push({ providerId, band: easy ? "easy" : "hard" });
    }
  }
  return { pooled, paired, pairedCount, unpaired };
}

// T-092: "gemini 100%, deepseek 79%" is a ranking over stimulus sets that
// are not the same size or shape — five providers were shown every count,
// deepseek was shown four, perplexity one. Direct standardisation to the
// corpus's own stratum mix answers "if this provider had been shown the
// SAME mix everyone else was, weighted by how much of the corpus sits at
// each count it actually WAS shown" — renormalised over the strata a
// provider actually holds (an unheld stratum contributes no weight, not a
// zero), with the covered weight travelling beside the number so a reader
// can see how much of that renormalisation is doing the work. A provider
// at 31% covered weight has a standardised rate that is mostly an
// assumption, and printing the number without the weight would hide that.
export function computeStandardizedRates(providerCountCells, countStrata) {
  const totalN = Object.values(countStrata).reduce((s, c) => s + c.n, 0);
  const result = {};
  for (const [providerId, cells] of Object.entries(providerCountCells)) {
    let n = 0,
      ok = 0,
      numerator = 0,
      weightCovered = 0;
    const strataHeld = [...cells.keys()].sort((a, b) => a - b);
    for (const [count, cell] of cells) {
      n += cell.n;
      ok += cell.ok;
      const weight = totalN ? countStrata[count].n / totalN : 0;
      numerator += weight * (cell.ok / cell.n);
      weightCovered += weight;
    }
    result[providerId] = {
      n,
      ok,
      crude: n ? ok / n : null,
      standardized: weightCovered ? numerator / weightCovered : null,
      weightCovered,
      strataHeld,
    };
  }
  return result;
}

// T-092: a plain hypergeometric two-sided Fisher exact test over a 2x2
// table — no library, this repo has no stats dependency and one 2x2 test
// does not justify adding one. Sums the probability of every table with
// the SAME margins whose probability is no greater than the observed
// table's (the standard two-sided definition), computed in log-space so
// n up to a few hundred does not overflow. Pinned in
// tests/shapeAudit.test.js against a table with a known published p-value
// (Fisher's own "lady tasting tea": 3,1/1,3 -> p=0.4857) before trusting
// it on anything this file actually reports.
function logFactorial(n) {
  let sum = 0;
  for (let i = 2; i <= n; i++) sum += Math.log(i);
  return sum;
}
function logChoose(n, k) {
  if (k < 0 || k > n) return -Infinity;
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k);
}
export function fisherExactTwoSided(a, b, c, d) {
  const row1 = a + b;
  const row2 = c + d;
  const col1 = a + c;
  const col2 = b + d;
  const n = row1 + row2;
  const minX = Math.max(0, row1 - col2);
  const maxX = Math.min(row1, col1);
  const logProb = (x) =>
    logChoose(col1, x) + logChoose(col2, row1 - x) - logChoose(n, row1);
  const observed = logProb(a);
  // Floating-point tolerance on the "no greater than" comparison — without
  // it, the observed table's own probability can fail to compare equal to
  // itself due to summation-order rounding in logChoose.
  const EPS = 1e-9;
  let p = 0;
  for (let x = minX; x <= maxX; x++) {
    const lp = logProb(x);
    if (lp <= observed + EPS) p += Math.exp(lp);
  }
  return p;
}

function main() {
  const dir = path.join(process.cwd(), "reports", "vision-probe");
  const {
    rowsWithRaw,
    blindRowsWithRaw,
    disagreements,
    storedHistogram,
    recomputedHistogram,
    countStrata,
    providerBand,
    shapeByCount,
    exclusionByProviderBand,
    outOfRangeRows,
    structuredCount,
    providerStrata,
    providerCountCells,
    wrongRows,
    providerSighted,
    providerSightedCells,
    countStrataSighted,
    providerExcludedByShape,
    providerExcludedByShapeNoPlant,
    sightedNoTruthRows,
    blindWithTruthRows,
    providerStrataNoPlant,
    providerCountCellsNoPlant,
    countStrataNoPlant,
    providerSightedNoPlant,
    providerSightedCellsNoPlant,
    countStrataSightedNoPlant,
    plantedRowCount,
    noReplyByProvider,
  } = auditShapes(dir);

  // T-088: the headline used to read as the denominator for every table
  // beneath it, and it is not — blind rows (no truth, nothing drawn or
  // sent) stay in the shape histogram just below (a real, correctly-
  // shaped reply, not a correctness verdict) but are excluded from every
  // truth-gated table after it. Stating both counts here means a reader
  // reaches the exclusion table's denominator by reading, not subtracting.
  const sightedRowsWithRaw = rowsWithRaw - blindRowsWithRaw;
  console.log(
    `rows with raw: ${rowsWithRaw}   (${sightedRowsWithRaw} sighted, ${blindRowsWithRaw} blind — the histogram below includes both; every table after it is sighted-only)   disagreements: ${disagreements.length}`,
  );
  // T-107 clause 2: the population dropped by the ROW LOOP'S OWN FIRST
  // LINE, before rowsWithRaw above even starts counting — an HTTP 500, a
  // locator timeout, a closed page, a fetch failure. Printed at every run,
  // zero or not (T-078's rule), per provider, split by whether the record
  // names a bridge-side mechanism in its own words or names nothing
  // attributable at all (see the drop site's own comment for the split
  // rule). NOT in the end-to-end ranking below (clause 3, option b) — this
  // is the visible accounting T-096's own caution asks for regardless.
  for (const line of formatNoReplySection(
    noReplyByProvider,
    providerSighted,
    sightedRowsWithRaw,
  )) {
    console.log(line);
  }
  // T-091: the headline's sighted/blind split above is decided by
  // `j.blind` (was this a --blind run); every truth-gated table below is
  // decided by `isGradable` (does this row have a truth to grade against).
  // They agree on every row recorded so far — that is a fact about this
  // corpus, not a guarantee the two predicates enforce on each other.
  // Printed at every run, zero or not (T-078's rule for this file: a zero
  // tally's own meaning must stay reachable, not print only when there is
  // something to report) — 0 and 0 is what makes today's sighted count and
  // every table's denominator the same number; either count moving above
  // zero is what would make them disagree, silently, without this line.
  console.log(
    `   predicate check: ${sightedNoTruthRows.length} sighted row(s) with no gradable truth, ${blindWithTruthRows.length} blind row(s) with a gradable truth (0 and 0 is what makes the headline's sighted count and every truth-gated table below agree on the same denominator):`,
  );
  for (const r of sightedNoTruthRows) {
    console.log(`     SIGHTED, NO TRUTH: ${r.file}  ${r.providerId}`);
  }
  for (const r of blindWithTruthRows) {
    console.log(`     BLIND, WITH TRUTH: ${r.file}  ${r.providerId}`);
  }
  for (const d of disagreements) {
    console.log(
      `   ${d.file}  ${d.providerId}  ${d.storedShape} -> ${d.recomputedShape}`,
    );
  }
  console.log(`stored histogram:     ${JSON.stringify(storedHistogram)}`);
  console.log(`recomputed histogram: ${JSON.stringify(recomputedHistogram)}`);

  console.log("\nCOUNT right, by truth.count (T-050 — a rate on the");
  console.log("stimulus, not on the provider — see the file header):");
  const counts = Object.keys(countStrata)
    .map(Number)
    .sort((a, b) => a - b);
  for (const c of counts) {
    const { n, ok, providers } = countStrata[c];
    const pct = ((ok / n) * 100).toFixed(1);
    console.log(
      `  truth.count=${c}   ${ok}/${n}   ${pct}%   (${providers.size} provider${providers.size === 1 ? "" : "s"})`,
    );
  }

  // T-092 clause 1: the cross-tab shape-audit has never printed. Mostly
  // empty, and that emptiness IS the message — T-084's "one stratum of
  // seven" is a statement about the pool; this is where a reader sees
  // which PROVIDERS that stratum actually belongs to.
  const providerIdsCT = Object.keys(providerCountCells).sort();
  if (providerIdsCT.length > 0) {
    console.log("\nPROVIDER x TRUTH.COUNT, ok/n (T-092 — the table the");
    console.log(
      "per-provider rate below has never shown; '.' = no rows at that stratum):",
    );
    console.log(
      "  " +
        "".padEnd(11) +
        counts.map((c) => `c=${c}`.padStart(6)).join("") +
        "  pooled",
    );
    for (const p of providerIdsCT) {
      const cells = providerCountCells[p];
      let n = 0,
        ok = 0;
      const row = counts
        .map((c) => {
          const cell = cells.get(c);
          if (!cell) return "".padStart(6, " ").slice(0, 5) + " .";
          n += cell.n;
          ok += cell.ok;
          return `${cell.ok}/${cell.n}`.padStart(6);
        })
        .join("");
      console.log(`  ${p.padEnd(11)}${row}  ${ok}/${n}`);
    }
  }

  // T-084 clause 5 / T-092 review: "gemini 100%, deepseek 79%" reads as a
  // ranking and is really a statement about which tickets happened to
  // call which provider — printed here beside the stimulus range each
  // rate actually covers. T-092: the table used to SORT by that same
  // crude rate, asserting through its own ordering exactly what this
  // caption denies. Sorted by STANDARDISED rate instead (direct
  // standardisation to the corpus's own stratum mix, renormalised over
  // the strata a provider actually holds) — crude rate is still printed,
  // unchanged, beside it; only the ORDER and the two new columns changed.
  // T-106: computeStandardizedRates() over the ORIGINAL plant-including
  // countStrata/providerCountCells is kept exactly as it was — used below
  // by the count=9 region analysis and the coverage-hole sentence, which
  // this ticket does not touch. `standardized` (graded, ranking-only) is
  // now built from the plant-EXCLUDING pair instead — see the
  // providerStrataNoPlant/providerCountCellsNoPlant/countStrataNoPlant
  // comment at their own declaration for why.
  const standardizedAllRows = computeStandardizedRates(
    providerCountCells,
    countStrata,
  );
  const standardized = computeStandardizedRates(
    providerCountCellsNoPlant,
    countStrataNoPlant,
  );
  // T-096: the block above's own predecessor ("Per-provider rate, WITH the
  // strata it was actually shown") sorted and ranked on `providerStrata` —
  // the GRADED population, gated on `countOk !== undefined`. That gate is
  // exactly where a provider's own refusals (SEES_NO/ECHO/NO_ANSWER)
  // leave the denominator, so a provider that refuses most of its hard
  // rows is scored only on the easy remainder it chose to answer: measured
  // on browser-ai-bridge 8b3182d, chatgpt read joint-first at 100.0% on 2
  // graded rows of 17 sighted, and ninth of ten end to end at 11.8%. qwen
  // (0 graded, 9 sighted, all excluded) was not in the ranking at all —
  // `providerStrata` never even holds its key, since it is populated only
  // inside the SAME countOk-gated block.
  //
  // stdSighted mirrors stdGraded (`standardized` above) exactly —
  // computeStandardizedRates() takes any providerId -> Map(count ->
  // {n, ok}) plus the matching per-count weights, so the SIGHTED
  // population standardises the same way the GRADED one already does, over
  // countStrataSighted (every sighted row at that count, all shapes) in
  // place of countStrata (graded rows only). Same convention, same
  // renormalisation, the crude/standardised gap is no longer a special
  // case of the end-to-end column alone.
  const stdSighted = computeStandardizedRates(
    providerSightedCellsNoPlant,
    countStrataSightedNoPlant,
  );
  // Master list is every provider with a SIGHTED row — a superset of
  // `providerStrata`'s keys (graded requires sighted; sighted does not
  // require graded) — so a provider excluded on every turn still appears,
  // at the bottom, instead of being invisible to the one block captioned
  // as a ranking. Sorted by standardised END-TO-END rate: that is the rate
  // a reader picking a provider can actually act on (T-096 clause 6), and
  // sorting on it — rather than the graded rate beside it — means the
  // order no longer asserts a ranking the graded column alone cannot
  // support. Ties broken by sighted n, descending (more measured rows
  // first), same tie-break the ticket's own probe used.
  const providerIdsAll = Object.keys(providerSightedNoPlant).sort((a, b) => {
    const sa = stdSighted[a]?.standardized ?? -1;
    const sb = stdSighted[b]?.standardized ?? -1;
    if (sb !== sa) return sb - sa;
    return providerSightedNoPlant[b].n - providerSightedNoPlant[a].n;
  });
  // T-099: a standardised rate is only as strong as how much of the corpus
  // weight it actually renormalises over — computeStandardizedRates()
  // returns weightCovered/strataHeld for exactly this reason (T-087), and
  // this block's first version (T-096) read only `.standardized` off it,
  // discarding the number that says whether a rate is worth trusting.
  // Measured on 9044ad7: perplexity ranked SECOND of ten at 73.8% end to
  // end, standardised over 2 of 7 strata — 28.0% of corpus weight — with
  // no coverage figure anywhere on the page beside it. 0.5 is the same
  // judgement call T-087's INDEPENDENCE_MIN_IMAGE_SHARE already made for a
  // different coverage question in this file — named and printed with the
  // verdict it produces, not a bare literal in a condition.
  const THIN_COVERAGE_THRESHOLD = 0.5;
  const thinProviders = [];
  if (providerIdsAll.length > 0) {
    // T-106 clause 3: a deliberate evidence-break plant proves the
    // imageAttached flag CAN be wrong under a broken evidence check — it is
    // not a naturally-occurring reading of the provider it was performed
    // on, and three of today's four are RIGHT answers that would otherwise
    // inflate that provider in a ranking. Printed at every run, zero or
    // not (T-078's rule for this file — a zero tally's own meaning must
    // stay reachable, not print only when there is something to exclude).
    console.log(
      `\n${plantedRowCount} planted row(s) excluded from the ranking below (deliberate evidence-break tests — vision-probe.mjs --planted-break; unaffected: the per-truth.count table and cross-tab above, a different question).`,
    );
    console.log(
      "\nPer-provider rate — GRADED (right/rows that stated a COUNT) and END",
    );
    console.log(
      "TO END (right/every SIGHTED row, a refusal scored as not right) side",
    );
    console.log(
      "by side, both crude and STANDARDISED to the corpus's own stratum mix,",
    );
    console.log(
      "each standardised figure beside its OWN corpus-weight-covered and",
    );
    console.log(
      "strata-shown (T-096 — a ranking sorted on the graded rate is a",
    );
    console.log(
      "ranking each provider's own exclusions built for itself; sorted here",
    );
    console.log(
      `by standardised END TO END instead. T-099 — *THIN* marks a row ranked`,
    );
    console.log(
      `on less than ${(THIN_COVERAGE_THRESHOLD * 100).toFixed(0)}% of corpus weight; read its standardised rate as`,
    );
    console.log("provisional, not as comparable to a fully-covered row.");
    // T-106 clause 2, option (b): the END TO END column scores
    // SEES_NO/ECHO/NO_ANSWER identically — "a row that did not tell me the
    // count" — the SAME single rule T-096's own goal criticised for the
    // GRADED column's exclusion set, applied here to a different column
    // instead of fixed. Argued rather than silently left: shape-audit.mjs's
    // own exclusion-table comment above calls ECHO a "bridge/extraction
    // failure", and that is still true of ITS cause — but a caller reading
    // this ranking to pick a provider for a REAL question got no usable
    // answer either way, whoever is at fault for the reply looking like the
    // prompt read back. This column answers "which provider gave me
    // something I could use", not "which provider is to blame when it
    // didn't" — the per-row `excluded SEES_NO=/ECHO=/NO_ANSWER=` breakdown
    // beside every rate below is exactly how a reader who wants the second
    // question can back it out for themselves, per provider.
    //
    // T-136 (REDO — the first pass here generalised a grok-only finding
    // to the whole corpus; caught in review, see the crew log): ECHO's
    // cause, updated, SCOPED TO GROK — the corpus's stored histogram has
    // 16 ECHO rows total (recomputed: 18), not 9, and this table's own
    // per-provider ECHO counts below split them grok=7, deepseek=7,
    // mistral=1, qwen=1 (sighted, no-plant — the population this table
    // ranks). Neither T-059 nor T-133 tested anything but grok. T-059
    // (closed) settled grok's MECHANISM — 68 in-window samples across 2
    // live runs, `.last()` was never our own user bubble at any sampled
    // tick, so grok's ECHO rows are not this bridge's extractor reading
    // its own prompt back. T-133 then ruled out PROMPT LENGTH as grok's
    // trigger — a live ladder of 4 rungs (93/313/2000/4500 chars,
    // bracketing the known 313-char length and grok's 4000-char chunkSize
    // boundary), 3 turns each, 0 of 12 echoed, including the 313-char
    // control that echoed in 100% of its prior recorded turns. What both
    // tickets found instead: every one of grok's ECHO rows (9 across every
    // recorded grok row including the blind arm; 7 in this table's
    // sighted/no-plant population below) falls inside one contiguous
    // ~8-hour window, 2026-08-21T18:41Z-2026-08-22T02:45Z; every OTHER
    // grok row in the corpus, before and after that window, is clean. So
    // grok's ECHO behaviour looks time/session-clustered, not a standing
    // property of that provider or of any prompt this board has sent it —
    // but WHAT inside that window triggered it is still not identified.
    // deepseek's 7 ECHO rows are a SEPARATE, untested population — all
    // seven predate grok's window entirely (earliest 2026-08-21T08:51Z,
    // latest 17:55Z, none after) — whether they cluster the same way is
    // not answered here and this caption makes no claim about them. This
    // column's rule does not depend on any of it either way, since a
    // caller got nothing usable under any reading.
    console.log(
      "T-106 — SEES_NO/ECHO/NO_ANSWER all count as 'not right' in END TO",
    );
    console.log(
      "END: this column answers 'gave me a usable answer', not 'whose fault",
    );
    console.log(
      "was it' — the excluded breakdown on each row is how to ask the",
    );
    console.log(
      "second question. GROK's ECHO mechanism is settled (T-059: not this",
    );
    console.log(
      "bridge's own prompt echoed back) and length is ruled out as its",
    );
    console.log(
      "cause (T-133: 0/12 echoed across 4 rungs bracketing the known 313-",
    );
    console.log(
      "char length). Grok's ECHO rows (7 below, sighted/no-plant; 9 across",
    );
    console.log(
      "every recorded grok row) cluster in one ~8-hour window, 2026-08-21",
    );
    console.log(
      "18:41Z-2026-08-22 02:45Z, with every other grok row clean. The",
    );
    console.log(
      "corpus's other ECHO rows are NOT grok's — deepseek has 7, all",
    );
    console.log(
      "before that window, untested by either ticket; this caption makes",
    );
    console.log("no claim about them. This column's rule does not depend");
    console.log("on any of it either way):");
    for (const p of providerIdsAll) {
      const sighted = providerSightedNoPlant[p];
      const graded = providerStrataNoPlant[p];
      const e2ePct = ((sighted.ok / sighted.n) * 100).toFixed(1);
      const e2eStd = stdSighted[p];
      const e2eStdPct =
        e2eStd?.standardized != null
          ? (e2eStd.standardized * 100).toFixed(1)
          : "?";
      const e2eWeightPct =
        e2eStd?.weightCovered != null
          ? (e2eStd.weightCovered * 100).toFixed(1)
          : "?";
      const e2eStrata = [...sighted.countsShown].sort((a, b) => a - b);
      const e2eThin =
        e2eStd?.weightCovered != null &&
        e2eStd.weightCovered < THIN_COVERAGE_THRESHOLD;
      if (e2eThin) thinProviders.push(p);
      const e2eStr =
        `end-to-end ${sighted.ok}/${sighted.n} ${e2ePct}% (std ${e2eStdPct}%, weight ${e2eWeightPct}%, strata ${e2eStrata.length}/${COUNT_RANGE} [${e2eStrata.join(",")}])` +
        (e2eThin ? " *THIN*" : "");
      const gradedStr = graded
        ? (() => {
            const gStd = standardized[p];
            const gPct = ((graded.ok / graded.n) * 100).toFixed(1);
            const gStdPct =
              gStd?.standardized != null
                ? (gStd.standardized * 100).toFixed(1)
                : "?";
            const gWeightPct =
              gStd?.weightCovered != null
                ? (gStd.weightCovered * 100).toFixed(1)
                : "?";
            const gStrata = [...graded.countsShown].sort((a, b) => a - b);
            return `${graded.ok}/${graded.n} ${gPct}% (std ${gStdPct}%, weight ${gWeightPct}%, strata ${gStrata.length}/${COUNT_RANGE} [${gStrata.join(",")}])`;
          })()
        : "never graded";
      const excl = providerExcludedByShapeNoPlant[p] || {
        SEES_NO: 0,
        ECHO: 0,
        NO_ANSWER: 0,
      };
      console.log(
        `  ${p.padEnd(11)} graded ${gradedStr.padEnd(55)} ${e2eStr}   excluded SEES_NO=${excl.SEES_NO} ECHO=${excl.ECHO} NO_ANSWER=${excl.NO_ANSWER}`,
      );
    }
    if (thinProviders.length > 0) {
      console.log(
        `  *THIN*: ${thinProviders.join(", ")} — ranked on less than ${(THIN_COVERAGE_THRESHOLD * 100).toFixed(0)}% of corpus weight (end-to-end coverage).`,
      );
    }
    // T-106 clause 5: NO_ANSWER, UNKNOWN ATTRIBUTION — unlike SEES_NO (a
    // transport argument, T-096) and grok's own ECHO rows specifically
    // (mechanism settled and length ruled out as the trigger, T-059/T-133
    // — see the T-136 comment above; those rows cluster in one ~8-hour
    // window with the trigger inside it still unidentified — this does
    // NOT extend to deepseek/mistral/qwen's own ECHO rows, untested), no
    // investigation on this board has
    // established whether a NO_ANSWER row (an empty or off-format reply,
    // matching none of classify()'s expected shapes) is evidence about the
    // PROVIDER (declined to follow the format), this bridge's own
    // extraction (truncated or mis-captured the real reply), or neither.
    // Stated as unknown rather than assumed either way — the count is real,
    // the attribution is not established.
    const noAnswerByProvider = {};
    for (const p of providerIdsAll) {
      const n = providerExcludedByShape[p]?.NO_ANSWER || 0;
      if (n > 0) noAnswerByProvider[p] = n;
    }
    const noAnswerTotal = Object.values(noAnswerByProvider).reduce(
      (a, b) => a + b,
      0,
    );
    console.log(
      `  NO_ANSWER, attribution UNKNOWN: ${noAnswerTotal} row(s) total ${JSON.stringify(noAnswerByProvider)} — neither the provider nor this bridge's own extractor is established as the cause; counted against the provider above (T-106 clause 2's single rule) without that claim being made.`,
    );
    // T-096 clause 6: this board's product for every other board is "which
    // provider do I send this to" — a named provider and its n, not a
    // table to interpret. Read off the top of the same sort the table
    // itself uses (standardised end-to-end), so the recommendation and the
    // ranking above it can never disagree about which provider is first.
    const top = providerIdsAll[0];
    const topSighted = providerSightedNoPlant[top];
    const topStd = stdSighted[top];
    const topStdPct =
      topStd?.standardized != null
        ? `, standardised ${(topStd.standardized * 100).toFixed(1)}%`
        : "";
    console.log(
      `\nRECOMMENDATION: ${top} — end to end ${topSighted.ok}/${topSighted.n} = ${((topSighted.ok / topSighted.n) * 100).toFixed(1)}% (n=${topSighted.n}${topStdPct}).`,
    );
  }

  // T-092 clause 4: the two within-region provider effects, stated as
  // findings rather than left for a reader to notice in the cells above.
  const cell9 = (p) => providerCountCells[p]?.get(MAX_COUNT);
  const hardProviders = providerIdsCT.filter((p) => cell9(p));
  const hardOk = hardProviders.reduce((s, p) => s + cell9(p).ok, 0);
  const hardN = hardProviders.reduce((s, p) => s + cell9(p).n, 0);
  const failedAtHard = hardProviders.filter((p) => cell9(p).ok === 0);
  const heldAtHard = hardProviders.filter((p) => cell9(p).ok === cell9(p).n);
  if (
    hardProviders.length > 1 &&
    failedAtHard.length > 0 &&
    heldAtHard.length > 0
  ) {
    const a = heldAtHard.reduce((s, p) => s + cell9(p).ok, 0);
    const b = heldAtHard.reduce((s, p) => s + (cell9(p).n - cell9(p).ok), 0);
    const c = failedAtHard.reduce((s, p) => s + cell9(p).ok, 0);
    const d = failedAtHard.reduce((s, p) => s + (cell9(p).n - cell9(p).ok), 0);
    const p9 = fisherExactTwoSided(a, b, c, d);
    console.log(
      `\nAt truth.count=${MAX_COUNT}: ${heldAtHard.join("/")} ${a} right, ${b} wrong` +
        `   vs   ${failedAtHard.join("/")} ${c} right, ${d} wrong` +
        `   Fisher exact two-sided p = ${p9.toExponential(2)}`,
    );
  }
  const lowRegion = counts.filter((c) => c !== MAX_COUNT);
  const lowByProvider = {};
  for (const p of providerIdsCT) {
    let n = 0,
      ok = 0;
    for (const c of lowRegion) {
      const cell = providerCountCells[p].get(c);
      if (cell) {
        n += cell.n;
        ok += cell.ok;
      }
    }
    if (n > 0) lowByProvider[p] = { n, ok };
  }
  const lowErring = Object.keys(lowByProvider).filter(
    (p) => lowByProvider[p].ok < lowByProvider[p].n,
  );
  if (lowErring.length > 0) {
    const a = lowErring.reduce((s, p) => s + lowByProvider[p].ok, 0);
    const b = lowErring.reduce(
      (s, p) => s + (lowByProvider[p].n - lowByProvider[p].ok),
      0,
    );
    const rest = Object.keys(lowByProvider).filter(
      (p) => !lowErring.includes(p),
    );
    const c = rest.reduce((s, p) => s + lowByProvider[p].ok, 0);
    const d = rest.reduce(
      (s, p) => s + (lowByProvider[p].n - lowByProvider[p].ok),
      0,
    );
    const pLow = fisherExactTwoSided(a, b, c, d);
    console.log(
      `At counts ${lowRegion[0]}-${lowRegion[lowRegion.length - 1]}: ${lowErring.join("/")} ${a} right, ${b} wrong` +
        `   vs   every other provider ${c} right, ${d} wrong` +
        `   Fisher exact two-sided p = ${pLow.toExponential(2)}`,
    );
  }

  // T-092 clause 5 (review round 2): the one coverage hole that decides
  // whether the count=9 effect belongs to two providers or three, named
  // rather than filled by a sweep. Two things this must say, both
  // computed, neither hardcoded to "=9":
  //   (a) the FULL run of ungraded top strata — deepseek's gap is
  //       [7,8,9], not just 9; printing only "=9" understates how much of
  //       the hard region is unmeasured for it.
  //   (b) whether this provider is the ONLY one with a recorded error
  //       outside the top stratum — the load-bearing half of the finding.
  //       An error anywhere else would mean the hole is one gap among
  //       several, not the single fact that decides the sentence.
  const neverShownHard = providerIdsCT.filter(
    (p) => !providerCountCells[p].has(MAX_COUNT),
  );
  const erringElsewhere = neverShownHard.filter((p) => {
    const cells = providerCountCells[p];
    for (const cell of cells.values()) if (cell.ok < cell.n) return true;
    return false;
  });
  // Every provider with a recorded error at any count OTHER than the top
  // stratum — computed once so "is p the only one" is a real comparison,
  // not an assumption baked into the sentence.
  const erringOutsideTop = providerIdsCT.filter((p) => {
    for (const [count, cell] of providerCountCells[p]) {
      if (count !== MAX_COUNT && cell.ok < cell.n) return true;
    }
    return false;
  });
  if (erringElsewhere.length > 0) {
    for (const p of erringElsewhere) {
      const std = standardizedAllRows[p];
      const weightPct =
        std?.weightCovered != null ? (std.weightCovered * 100).toFixed(1) : "?";
      const maxHeld = Math.max(...standardizedAllRows[p].strataHeld);
      const ungradedTop = counts.filter((c) => c > maxHeld);
      const ungradedList =
        ungradedTop.length > 1
          ? ungradedTop.slice(0, -1).join(", ") +
            " or " +
            ungradedTop[ungradedTop.length - 1]
          : String(ungradedTop[0]);
      const isSole = erringOutsideTop.length === 1 && erringOutsideTop[0] === p;
      const uniqueness = isSole
        ? `and is the ONLY provider with a recorded error outside truth.count=${MAX_COUNT} — `
        : `(not the only provider with an error outside truth.count=${MAX_COUNT}: also ${erringOutsideTop.filter((x) => x !== p).join(", ")}) — `;
      console.log(
        `\nCOVERAGE HOLE: ${p} has never been graded at truth.count ${ungradedList} ` +
          `(${weightPct}% of corpus weight covered) ${uniqueness}` +
          `whether it fails at the top like the providers above, or holds like the rest, ` +
          `is unmeasured, and that gap decides whether the count=${MAX_COUNT} effect ` +
          `belongs to two providers or three.`,
      );
    }
  }

  // T-063: the pooled 3-5/6-9 line alone hides that the provider SET differs
  // between the two bands — see bandStats()'s own comment. Print pooled
  // (every row, the number this script always printed) alongside paired
  // (only providers with rows in BOTH bands, the only figure a same-provider
  // comparison actually supports), and name who got left out of paired.
  let unpaired = [];
  if (counts.length > 0) {
    const stats = bandStats(providerBand);
    unpaired = stats.unpaired;
    const { pooled, paired, pairedCount } = stats;
    const fmt = (b) =>
      `${b.ok}/${b.n} ${b.n > 0 ? ((b.ok / b.n) * 100).toFixed(1) : "0.0"}%`;
    console.log(
      `  count 3-5 (pooled, all providers): ${fmt(pooled.easy)}   ` +
        `count 6-9 (pooled): ${fmt(pooled.hard)}`,
    );
    console.log(
      `  count 3-5 (paired providers only, N=${pairedCount}): ${fmt(paired.easy)}   ` +
        `count 6-9 (paired): ${fmt(paired.hard)}`,
    );
    if (unpaired.length > 0) {
      console.log(
        `  unpaired (rows in one band only, excluded from the paired line): ` +
          unpaired.map((u) => `${u.providerId} (${u.band} only)`).join(", "),
      );
    }
  }

  // T-063 clause 4: is the SEES_NO/ECHO/NO_ANSWER exclusion itself
  // count-dependent? A rising drop rate at higher counts would mean the
  // COUNT-right rate above is measured on an increasingly easier-selected
  // subset as truth.count grows, stacking on top of the provider-mix effect.
  const excludedCounts = Object.keys(shapeByCount)
    .map(Number)
    .sort((a, b) => a - b);
  if (excludedCounts.length > 0) {
    console.log(
      "\nExcluded from COUNT (SEES_NO/ECHO/NO_ANSWER), by truth.count —",
    );
    console.log("checking whether the exclusion itself tracks count:");
    let totalAll = 0,
      excludedAll = 0;
    const rates = [];
    for (const c of excludedCounts) {
      const { total, excluded } = shapeByCount[c];
      const rate = (excluded / total) * 100;
      rates.push(rate);
      totalAll += total;
      excludedAll += excluded;
      console.log(
        `  truth.count=${c}   ${excluded}/${total} excluded   ${rate.toFixed(1)}%`,
      );
    }
    const overall = (excludedAll / totalAll) * 100;
    const spread = Math.max(...rates) - Math.min(...rates);
    console.log(
      `  overall: ${excludedAll}/${totalAll} excluded   ${overall.toFixed(1)}%   ` +
        `spread across counts: ${spread.toFixed(1)} points`,
    );
  }

  // T-065: the by-count spread above is the provider-mix covariate T-063
  // named, reappearing in a second table — by BAND the rate barely moves;
  // by PROVIDER it is the whole 0-100% range. Printed side by side so a
  // reader is pointed at the covariate that's actually doing the moving.
  const { byBand, byProvider, fullyExcluded } = exclusionStats(
    exclusionByProviderBand,
  );
  const providerIds = Object.keys(byProvider).sort();
  if (providerIds.length > 0) {
    const bandRate = (b) => (b.total > 0 ? (b.excluded / b.total) * 100 : 0);
    const bandSpread = Math.abs(bandRate(byBand.hard) - bandRate(byBand.easy));
    console.log(
      "\nSame exclusion, by band vs by provider (T-065 — by-count spread",
    );
    console.log("above is the provider mix again, not a count effect):");
    console.log(
      `  by band:      easy 3-5 ${byBand.easy.excluded}/${byBand.easy.total} ` +
        `${bandRate(byBand.easy).toFixed(1)}%   hard 6-9 ${byBand.hard.excluded}/${byBand.hard.total} ` +
        `${bandRate(byBand.hard).toFixed(1)}%   spread: ${bandSpread.toFixed(1)} points`,
    );
    const providerRates = providerIds.map((p) => {
      const { total, excluded } = byProvider[p];
      return total > 0 ? (excluded / total) * 100 : 0;
    });
    const providerSpread =
      Math.max(...providerRates) - Math.min(...providerRates);
    console.log(
      `  by provider:  ` +
        providerIds
          .map((p) => {
            const { total, excluded } = byProvider[p];
            const pct =
              total > 0 ? ((excluded / total) * 100).toFixed(1) : "0.0";
            return `${p} ${excluded}/${total} ${pct}%`;
          })
          .join("   "),
    );
    console.log(`  provider spread: ${providerSpread.toFixed(1)} points`);

    // T-065 clause 3: a provider with rows in the corpus but ZERO surviving
    // (COUNT-eligible) rows is invisible to every table above it — named
    // here so it is invisible to none of them.
    if (fullyExcluded.length > 0) {
      console.log(
        `  fully excluded (0 surviving rows, contribute nothing to any COUNT rate above): ` +
          fullyExcluded.join(", "),
      );
    }

    // T-065 clause 2: for each provider bandStats() found unpaired, say
    // WHICH KIND of absence it is — "no rows in this band" (a scheduling
    // gap) versus "rows exist, all excluded" (a property of that provider,
    // not fixed by sweeping more) look identical in the unpaired list alone.
    if (unpaired.length > 0) {
      console.log(`  unpaired providers, classified:`);
      for (const u of unpaired) {
        const missingBand = u.band === "easy" ? "hard" : "easy";
        const c = classifyAbsence(
          exclusionByProviderBand,
          u.providerId,
          missingBand,
        );
        const desc =
          c.kind === "absent"
            ? "no rows — genuinely absent"
            : `${c.total} row${c.total === 1 ? "" : "s"}, all excluded`;
        console.log(`    ${u.providerId} (${missingBand}): ${desc}`);
      }
    }
  }

  for (const line of formatOutOfRangeSection(
    outOfRangeRows,
    structuredCount,
    MIN_COUNT,
    MAX_COUNT,
  )) {
    console.log(line);
  }

  for (const line of formatWrongBucketSection(wrongRows)) {
    console.log(line);
  }
}

// T-084 clause 4: vision-probe.mjs's own header already argues WRONG is not
// an upload bug — "the model saw *something* and was confidently mistaken
// about it (this is not an upload bug and no upload fix will ever catch
// it)". Puts the two numbers behind that argument where a reader of a
// REPORT (this script's output) sees them, not only where a reader of the
// source does — this board has three tickets (T-011, T-048, T-074) about a
// true sentence in one artefact being unreadable from another. Pure/
// testable for the same reason formatOutOfRangeSection is: the zero-tally
// case needs to print a real "0 of 0", not silently vanish.
// T-107 review: pulled into a pure, return-lines function (same convention
// as formatOutOfRangeSection/formatWrongBucketSection below) rather than
// console.log directly, so the zero-provider case is unit-testable without
// capturing stdout — a prior version of this block iterated only
// Object.keys(noReplyByProvider), so a provider with zero no-reply rows
// never got a line at all, making its 0 indistinguishable from "never
// swept", exactly the distinction T-078 exists to preserve.
// `providerSighted` holds every provider a corpus ever saw; the union with
// noReplyByProvider's own keys is what guarantees every sighted provider
// gets a line, zero or not.
export function formatNoReplySection(
  noReplyByProvider,
  providerSighted,
  sightedRowsWithRaw,
) {
  const lines = [];
  const noReplyProviders = Object.keys(noReplyByProvider).sort();
  const noReplyTotal = noReplyProviders.reduce(
    (s, p) => s + noReplyByProvider[p].n,
    0,
  );
  lines.push(
    `   no reply at all (dropped before rowsWithRaw, excluded from the ranking below): ${noReplyTotal} of ${sightedRowsWithRaw + noReplyTotal} sighted gradable rows${noReplyProviders.length ? "" : " — none"}`,
  );
  const allSweptProviders = Array.from(
    new Set([
      ...Object.keys(providerSighted),
      ...Object.keys(noReplyByProvider),
    ]),
  ).sort();
  for (const p of allSweptProviders) {
    const nr = noReplyByProvider[p] || {
      n: 0,
      bridgeAttributable: 0,
      unattributed: 0,
    };
    lines.push(
      `     ${p.padEnd(11)} ${nr.n}   bridge-attributable=${nr.bridgeAttributable}  unattributed=${nr.unattributed}`,
    );
  }
  return lines;
}

export function formatWrongBucketSection(wrongRows) {
  const colorRight = wrongRows.filter((r) => r.colorOk).length;
  const lines = [];
  lines.push(
    `\nWRONG bucket: upload failure, or a model that saw something and got`,
  );
  lines.push(`it wrong? (T-084)`);
  lines.push(
    `  WRONG rows: ${wrongRows.length}   colour named correctly among them: ` +
      `${colorRight}/${wrongRows.length}` +
      (wrongRows.length
        ? `  (${((colorRight / wrongRows.length) * 100).toFixed(1)}%)`
        : ""),
  );
  lines.push(
    `  Cross-reference (T-072): 0 of every informative BLIND turn recorded` +
      ` on this board has ever stated a count at all — a stated count is` +
      ` itself evidence a picture arrived. Together: the WRONG bucket is` +
      ` not an arrival signal in either direction, and most of it carries` +
      ` positive evidence of arrival — a colour named correctly — on the` +
      ` one field it got right while missing the other.`,
  );
  return lines;
}

// T-078: the section T-076 shipped for this could only ever print the NOTE
// about what a zero means from inside `if (outOfRangeRows.length > 0)` —
// exactly backwards, since the reader who most needs "0 here is not
// evidence nobody fabricated, only that nobody fabricated conspicuously"
// is the one running an audit that found zero, and an absent section reads
// as "checked, nothing found" with nothing on screen to say those are
// different claims. Pulled into a pure, return-lines function (rather than
// console.log directly) so the zero-tally case — the one thing a
// print-only version could never pin — is unit-testable without capturing
// stdout. The non-zero branch is untouched line for line from what T-076
// shipped: same strings, same order, same console.log call boundaries, so
// a real corpus's non-zero output is byte-identical to before.
export function formatOutOfRangeSection(
  outOfRangeRows,
  structuredCount,
  minCount,
  maxCount,
) {
  const lines = [];
  if (outOfRangeRows.length > 0) {
    const boundary = outOfRangeRows.filter((r) => r.onBoundary);
    const other = outOfRangeRows.filter((r) => !r.onBoundary);
    lines.push(
      `\nOut-of-range COUNT (generator draws ${minCount}..${maxCount} only) — ` +
        `${outOfRangeRows.length} row${outOfRangeRows.length === 1 ? "" : "s"}:`,
    );
    lines.push(
      `  boundary miscount (said ${maxCount + 1} at truth ${maxCount}, off by one): ${boundary.length}`,
    );
    for (const r of boundary) {
      lines.push(
        `    ${r.file}  ${r.providerId}  truth=${r.truth} said=${r.said}  imageAttached=${r.imageAttached}`,
      );
    }
    lines.push(
      `  below the floor / not adjacent — cannot be a miscount: ${other.length}`,
    );
    for (const r of other) {
      const gap = r.said - r.truth;
      lines.push(
        `    ${r.file}  ${r.providerId}  truth=${r.truth} said=${r.said}  ` +
          `gap=${gap > 0 ? "+" : ""}${gap}  imageAttached=${r.imageAttached}`,
      );
    }
  } else {
    // The line this ticket exists to add: a reader seeing NO section at all
    // (T-076's own version) cannot tell "checked, found nothing" apart from
    // "did not run" — this says which one happened, and by how much: "0 of
    // N" and "0 of 0" are different facts, and structuredCount (the same
    // structured-reply population outOfRangeRows itself is drawn from) is
    // the N that makes that difference visible instead of assumed.
    lines.push(
      `\nOut-of-range COUNT (generator draws ${minCount}..${maxCount} only) — ` +
        `0 of ${structuredCount} structured repl${structuredCount === 1 ? "y" : "ies"} examined:`,
    );
  }
  lines.push(
    `  NOTE: this check is one-directional — out of range proves the reply\n` +
      `  is not a reading of any drawable picture; IN range proves nothing.\n` +
      `  A total of 0 here is not evidence nobody fabricated, only that\n` +
      `  nobody fabricated conspicuously.`,
  );
  return lines;
}

// Guarded (same pattern as vision-probe.mjs, ia-grade.mjs): importing
// auditShapes for a test must not also scan reports/vision-probe and print.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
