#!/usr/bin/env node
/**
 * generateCssColorTable.mjs — T-089 clause 3. The CSS-name -> RGB table
 * nearest-palette-member adjudication needs must be GENERATED, never typed —
 * a hand-typed table of ~148 entries is the same object T-012's own comment
 * already refused ("a guess wearing a unit"), and T-086 refused smuggling it
 * back in under a new name. This repo already depends on playwright-core,
 * and a browser owns the CSS named-colour table exactly: set an element's
 * `color` style to the name, read back `getComputedStyle().color`, and the
 * browser's own CSS engine resolves it — no RGB value here is asserted by
 * this script, only read back from Chromium's own colour resolution.
 *
 * The list of NAMES below is not the thing this ticket's constraint is
 * about — it is the fixed, standard CSS Color Module Level 4 extended
 * colour keyword list (unchanged for years, the same 147 names any browser
 * ships), enumerated the way COLORS/MIN_COUNT/COUNT_RANGE are already typed
 * constants elsewhere in this file. What is generated, never typed, is the
 * VALUE beside each name — the RGB triplet, which only a real browser's CSS
 * engine determines.
 *
 * Regenerate with:  node scripts/generateCssColorTable.mjs
 * Deterministic — re-running this reproduces the output file byte for byte
 * (verified: T-089 ran it twice and diffed).
 *
 * Connects over CDP to the already-running Chrome (CDP_URL, default 9222 —
 * the same real browser every other tool in this repo drives) rather than
 * launching playwright's own bundled Chromium, which is not installed in
 * this checkout (this repo connects to an external Chrome; it never
 * launches its own). Opens one blank about:blank page, reads computed
 * colour styles off an element on it, and closes only that page — no
 * navigation, no interaction with any real provider tab.
 */
import { chromium } from "playwright-core";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// The standard CSS Color Module Level 4 extended colour keywords —
// "transparent" and "currentcolor" excluded, since neither resolves to a
// fixed RGB triplet in isolation (transparent has alpha 0; currentcolor is
// context-dependent on whatever `color` was already inherited).
const CSS_COLOR_NAMES = [
  "aliceblue",
  "antiquewhite",
  "aqua",
  "aquamarine",
  "azure",
  "beige",
  "bisque",
  "black",
  "blanchedalmond",
  "blue",
  "blueviolet",
  "brown",
  "burlywood",
  "cadetblue",
  "chartreuse",
  "chocolate",
  "coral",
  "cornflowerblue",
  "cornsilk",
  "crimson",
  "cyan",
  "darkblue",
  "darkcyan",
  "darkgoldenrod",
  "darkgray",
  "darkgreen",
  "darkgrey",
  "darkkhaki",
  "darkmagenta",
  "darkolivegreen",
  "darkorange",
  "darkorchid",
  "darkred",
  "darksalmon",
  "darkseagreen",
  "darkslateblue",
  "darkslategray",
  "darkslategrey",
  "darkturquoise",
  "darkviolet",
  "deeppink",
  "deepskyblue",
  "dimgray",
  "dimgrey",
  "dodgerblue",
  "firebrick",
  "floralwhite",
  "forestgreen",
  "fuchsia",
  "gainsboro",
  "ghostwhite",
  "gold",
  "goldenrod",
  "gray",
  "grey",
  "green",
  "greenyellow",
  "honeydew",
  "hotpink",
  "indianred",
  "indigo",
  "ivory",
  "khaki",
  "lavender",
  "lavenderblush",
  "lawngreen",
  "lemonchiffon",
  "lightblue",
  "lightcoral",
  "lightcyan",
  "lightgoldenrodyellow",
  "lightgray",
  "lightgreen",
  "lightgrey",
  "lightpink",
  "lightsalmon",
  "lightseagreen",
  "lightskyblue",
  "lightslategray",
  "lightslategrey",
  "lightsteelblue",
  "lightyellow",
  "lime",
  "limegreen",
  "linen",
  "magenta",
  "maroon",
  "mediumaquamarine",
  "mediumblue",
  "mediumorchid",
  "mediumpurple",
  "mediumseagreen",
  "mediumslateblue",
  "mediumspringgreen",
  "mediumturquoise",
  "mediumvioletred",
  "midnightblue",
  "mintcream",
  "mistyrose",
  "moccasin",
  "navajowhite",
  "navy",
  "oldlace",
  "olive",
  "olivedrab",
  "orange",
  "orangered",
  "orchid",
  "palegoldenrod",
  "palegreen",
  "paleturquoise",
  "palevioletred",
  "papayawhip",
  "peachpuff",
  "peru",
  "pink",
  "plum",
  "powderblue",
  "purple",
  "rebeccapurple",
  "red",
  "rosybrown",
  "royalblue",
  "saddlebrown",
  "salmon",
  "sandybrown",
  "seagreen",
  "seashell",
  "sienna",
  "silver",
  "skyblue",
  "slateblue",
  "slategray",
  "slategrey",
  "snow",
  "springgreen",
  "steelblue",
  "tan",
  "teal",
  "thistle",
  "tomato",
  "turquoise",
  "violet",
  "wheat",
  "white",
  "whitesmoke",
  "yellow",
  "yellowgreen",
];

const OUT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "cssColorTable.json",
);

async function main() {
  const CDP_URL = process.env.CDP_URL || "http://127.0.0.1:9222";
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  const page = await context.newPage();
  await page.goto("about:blank");
  const table = await page.evaluate((names) => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const out = {};
    for (const name of names) {
      el.style.color = "";
      el.style.color = name;
      const resolved = getComputedStyle(el).color;
      const m = resolved.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/);
      if (!m) continue; // el.style.color silently no-ops on an invalid name
      out[name] = [Number(m[1]), Number(m[2]), Number(m[3])];
    }
    return out;
  }, CSS_COLOR_NAMES);
  await page.close();
  await browser.close();

  const record = {
    generatedBy: "node scripts/generateCssColorTable.mjs",
    source:
      "playwright-core chromium: el.style.color = <name>; getComputedStyle(el).color",
    count: Object.keys(table).length,
    table,
  };
  await writeFile(OUT_PATH, JSON.stringify(record, null, 2) + "\n");
  console.log(
    `[written] ${OUT_PATH} — ${record.count} of ${CSS_COLOR_NAMES.length} names resolved`,
  );
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
