import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveAnsweredBy,
  summarizeAnsweredBy,
  formatAnsweredBySummarySuffix,
  formatMismatchBlock,
  formatUnattestedBlock,
} from "../scripts/vision-probe.mjs";

// T-138: resolveAnsweredBy alone cannot show the bug — answeredByMismatch is
// false for both an agreeing row and an unattested one, so the shape a
// reader would misread is only visible once a whole run's rows are tallied.
// This proves the case named in the ticket title: "a run with no provider
// field at all" must NOT tally the same as "everyone answered as asked".
test.describe("summarizeAnsweredBy", () => {
  test("a run where every row is unattested (no `provider` field at all) reports 0 mismatch AND N unattested, not 0/0", () => {
    // Same three shapes real callers actually pass to resolveAnsweredBy:
    // a body that parsed but carried no `provider` key (the `!res.ok`
    // branch's json, or a stripped-down success body), and json===null
    // (the catch branch, constructed by, e.g., a timeout).
    const rows = [
      resolveAnsweredBy("grok", {}),
      resolveAnsweredBy("grok", { error: "rate limited" }),
      resolveAnsweredBy("grok", null),
    ];

    const { agreed, mismatched, unattested } = summarizeAnsweredBy(rows);

    assert.equal(mismatched.length, 0);
    assert.equal(agreed.length, 0);
    assert.equal(unattested.length, 3);
    // The exact failure this ticket names: a reader who only sees the
    // mismatch count reads "0" as "clean run, everyone attested" — the
    // derivation must make that unrecoverable-without-more-fields case
    // structurally distinct from a genuinely clean run (below).
  });

  test("a genuinely clean run (every row agreed) also reports 0 mismatch, but 0 unattested too — distinguishable from the case above", () => {
    const rows = [
      resolveAnsweredBy("grok", { provider: "grok" }),
      resolveAnsweredBy("grok", { provider: "grok" }),
    ];

    const { agreed, mismatched, unattested } = summarizeAnsweredBy(rows);

    assert.equal(mismatched.length, 0);
    assert.equal(unattested.length, 0);
    assert.equal(agreed.length, 2);
  });

  test("agree, mismatch, and unattested rows in the same run are bucketed correctly and by identity, not just by count", () => {
    const agreeRow = resolveAnsweredBy("grok", { provider: "grok" });
    const mismatchRow = resolveAnsweredBy("grok", { provider: "deepseek" });
    const unattestedRow = resolveAnsweredBy("grok", {});

    const { agreed, mismatched, unattested } = summarizeAnsweredBy([
      agreeRow,
      mismatchRow,
      unattestedRow,
    ]);

    assert.deepEqual(agreed, [agreeRow]);
    assert.deepEqual(mismatched, [mismatchRow]);
    assert.deepEqual(unattested, [unattestedRow]);
  });

  test("row shape is unchanged by this ticket: answeredBy stays null and answeredByMismatch stays false for an unattested row", () => {
    const row = resolveAnsweredBy("grok", {});
    assert.equal(row.answeredBy, null);
    assert.equal(row.answeredByMismatch, false);
    // summarizeAnsweredBy derives the third state at the summary layer —
    // it does not add or rewrite a field on the row itself.
    assert.equal("answeredByUnattested" in row, false);
  });
});

// T-138 review, second round: the bucket-count tests above proved
// summarizeAnsweredBy's DERIVATION distinguishes the three states, but not
// that either printed summary a reader actually sees does. The rendered
// text is what runBlind() and main() build their console.log lines from —
// these drive it directly, the way tests/formatTwoNullsLine.test.js drives
// formatTwoNullsLine rather than only computeCorpusPrior's return.
test.describe("formatAnsweredBySummarySuffix / formatMismatchBlock / formatUnattestedBlock", () => {
  test("the summary suffix for an all-unattested run is not the same string as for a genuinely clean run", () => {
    const cleanRows = [
      resolveAnsweredBy("grok", { provider: "grok" }),
      resolveAnsweredBy("grok", { provider: "grok" }),
      resolveAnsweredBy("grok", { provider: "grok" }),
    ];
    const unattestedRows = [
      resolveAnsweredBy("grok", {}),
      resolveAnsweredBy("grok", { error: "rate limited" }),
      resolveAnsweredBy("grok", null),
    ];

    const clean = summarizeAnsweredBy(cleanRows);
    const unattested = summarizeAnsweredBy(unattestedRows);

    const cleanLine = formatAnsweredBySummarySuffix(
      clean.mismatched,
      clean.unattested,
    );
    const unattestedLine = formatAnsweredBySummarySuffix(
      unattested.mismatched,
      unattested.unattested,
    );

    // This is the exact failure T-138 names: both runs print "answered by
    // someone other than asked 0" (mismatch count alone), so the lines
    // must differ elsewhere in the string, not just be assumed to.
    assert.notEqual(cleanLine, unattestedLine);
    assert.equal(
      cleanLine,
      "answered by someone other than asked 0   UNATTESTED (no provider field) 0",
    );
    assert.equal(
      unattestedLine,
      "answered by someone other than asked 0   UNATTESTED (no provider field) 3",
    );
    // Both agree on the mismatch half — the only thing distinguishing them
    // is the UNATTESTED count, which is the whole point of the ticket.
    assert.ok(cleanLine.includes("answered by someone other than asked 0"));
    assert.ok(
      unattestedLine.includes("answered by someone other than asked 0"),
    );
  });

  test("formatUnattestedBlock is silent (no lines) on a clean run and loud (header + one row per turn) when rows are unattested", () => {
    const cleanRows = [resolveAnsweredBy("grok", { provider: "grok" })];
    const unattestedRows = [
      {
        ...resolveAnsweredBy("grok", {}),
        providerId: "grok",
        shape: "ERROR",
        detail: "HTTP 500",
      },
      {
        ...resolveAnsweredBy("grok", null),
        providerId: "grok",
        shape: "ERROR",
        detail: "timeout",
      },
    ];

    const cleanBlock = formatUnattestedBlock(
      summarizeAnsweredBy(cleanRows).unattested,
    );
    const unattestedBlock = formatUnattestedBlock(
      summarizeAnsweredBy(unattestedRows).unattested,
    );

    assert.deepEqual(cleanBlock, []);
    assert.equal(unattestedBlock.length, 3); // header + 2 rows
    assert.match(unattestedBlock[0], /UNATTESTED/);
    assert.equal(unattestedBlock[1], "    asked=grok  shape=ERROR  HTTP 500");
    assert.equal(unattestedBlock[2], "    asked=grok  shape=ERROR  timeout");
  });

  test("formatMismatchBlock is silent on a clean run and loud with asked/answeredBy rows on a mismatched run", () => {
    const cleanRows = [resolveAnsweredBy("grok", { provider: "grok" })];
    const mismatchedRows = [
      {
        ...resolveAnsweredBy("grok", { provider: "deepseek" }),
        providerId: "grok",
      },
    ];

    const cleanBlock = formatMismatchBlock(
      summarizeAnsweredBy(cleanRows).mismatched,
    );
    const mismatchedBlock = formatMismatchBlock(
      summarizeAnsweredBy(mismatchedRows).mismatched,
    );

    assert.deepEqual(cleanBlock, []);
    assert.equal(mismatchedBlock.length, 2); // header + 1 row
    assert.match(mismatchedBlock[0], /MISMATCH/);
    assert.equal(mismatchedBlock[1], "    asked=grok  answeredBy=deepseek");
  });
});
