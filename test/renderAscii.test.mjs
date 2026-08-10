// The ASCII tab layout, one mechanism at a time.
//
// `M1-renderAscii-gutted` already proved the suite notices when the whole
// renderer returns "". It noticed because the round-trip tests compare a whole
// tab against a literal, and a whole-file gut changes every one of them. That
// same shape is why the per-mechanism plan found six of eight behaviours here
// UNNOTICED: the round-trip fixtures are all one measure of single-digit frets
// in a default-width, untitled, default-separator render, so wrapping, bar
// placement, and all three options are never varied and cannot be observed.
//
// These call `renderAscii` directly with placed chords written out as data, so
// each mechanism gets an input where it is the only thing that moved.
//
// Closes RA1, RA2, RA4, RA5, RA6, RA7 in scripts/sabotage-plans/per-mechanism.json.

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderAscii, GUITAR_STANDARD } from "../dist/index.js";

const TICKS_PER_QUARTER = 480;

/** One chord: the given (string, fret) pairs sounding at `startTick`. */
function chord(startTick, positions) {
  return {
    startTick,
    durationTicks: 480,
    positions: positions.map(([string, fret]) => ({
      string,
      fret,
      pitch: GUITAR_STANDARD.openPitches[string] + fret,
    })),
    unplaced: [],
  };
}

/** The six tab rows, with the title block and blank separators removed. */
function tabRows(rendered) {
  return rendered.split("\n").filter(line => line.includes("|"));
}

// Two notes on the low E string, one at the start of the first measure and one
// at the start of the second. 480 ticks per quarter and 4 beats per measure put
// the bar line at tick 1920.
const TWO_MEASURES = [chord(0, [[5, 0]]), chord(1920, [[5, 3]])];

test("a bar line is placed where a measure ends", () => {
  const rendered = renderAscii(TWO_MEASURES, {
    tuning: GUITAR_STANDARD,
    ticksPerQuarter: TICKS_PER_QUARTER,
  });
  assert.deepEqual(tabRows(rendered), [
    "e|-|-|",
    "B|-|-|",
    "G|-|-|",
    "D|-|-|",
    "A|-|-|",
    "E|0|3|",
  ]);
});

test("beatsPerMeasure moves the bar lines", () => {
  // Two beats to the measure puts bars at 960 and 1920, so the second note
  // arrives two bar lines later rather than one.
  const rendered = renderAscii(TWO_MEASURES, {
    tuning: GUITAR_STANDARD,
    ticksPerQuarter: TICKS_PER_QUARTER,
    beatsPerMeasure: 2,
  });
  assert.equal(tabRows(rendered)[5], "E|0||3|");
});

test("a SMPTE file, which has no ticks-per-quarter, still gets bar lines", () => {
  // parseMidi reports ticksPerQuarter 0 for an SMPTE division. Without the
  // fallback to 480 the measure length is 0 ticks, the bar-line loop is skipped
  // entirely, and the tab comes out as one unbroken run.
  const rendered = renderAscii(TWO_MEASURES, {
    tuning: GUITAR_STANDARD,
    ticksPerQuarter: 0,
  });
  assert.equal(tabRows(rendered)[5], "E|0|3|");
});

test("the separator option replaces the dashes", () => {
  const rendered = renderAscii(TWO_MEASURES, {
    tuning: GUITAR_STANDARD,
    ticksPerQuarter: TICKS_PER_QUARTER,
    separator: "=",
  });
  assert.deepEqual(tabRows(rendered), [
    "e|=|=|",
    "B|=|=|",
    "G|=|=|",
    "D|=|=|",
    "A|=|=|",
    "E|0|3|",
  ]);
});

test("the title is printed above the tab, followed by a blank line", () => {
  const rendered = renderAscii(TWO_MEASURES, {
    tuning: GUITAR_STANDARD,
    ticksPerQuarter: TICKS_PER_QUARTER,
    title: "Study in E",
  });
  const lines = rendered.split("\n");
  assert.equal(lines[0], "Study in E");
  assert.equal(lines[1], "");
  assert.equal(lines[2], "e|-|-|");
});

test("with no title, the tab starts on the first line", () => {
  const rendered = renderAscii(TWO_MEASURES, {
    tuning: GUITAR_STANDARD,
    ticksPerQuarter: TICKS_PER_QUARTER,
  });
  assert.equal(rendered.split("\n")[0], "e|-|-|");
});

test("lines wrap at the column limit, into more than one block", () => {
  // Sixty chords inside one measure, so wrapping is the only thing that can
  // break the line. `columns` is clamped to a floor of 40.
  const many = Array.from({ length: 60 }, (_, i) => chord(i, [[5, 0]]));
  const rendered = renderAscii(many, {
    tuning: GUITAR_STANDARD,
    ticksPerQuarter: TICKS_PER_QUARTER,
    columns: 40,
  });
  const rows = tabRows(rendered);
  assert.ok(rows.length > 6, `expected more than one block of 6 rows, got ${rows.length}`);
  assert.equal(rows.length % 6, 0, "every block should carry one row per string");
  const overlong = rows.filter(row => row.length > 40);
  assert.deepEqual(overlong, [], "no row may exceed the column limit");
});

test("a wide column limit leaves the same music on one block", () => {
  // The negative half of the wrapping test: same input, room for all of it.
  // Without this, "wraps into several blocks" is also satisfied by a renderer
  // that wraps unconditionally.
  const many = Array.from({ length: 60 }, (_, i) => chord(i, [[5, 0]]));
  const rendered = renderAscii(many, {
    tuning: GUITAR_STANDARD,
    ticksPerQuarter: TICKS_PER_QUARTER,
    columns: 200,
  });
  assert.equal(tabRows(rendered).length, 6);
});

test("a two-digit fret widens its column and the other strings pad to match", () => {
  const rendered = renderAscii([chord(0, [[5, 0], [0, 12]])], {
    tuning: GUITAR_STANDARD,
    ticksPerQuarter: TICKS_PER_QUARTER,
  });
  assert.deepEqual(tabRows(rendered), [
    "e|12|",
    "B|--|",
    "G|--|",
    "D|--|",
    "A|--|",
    "E|0-|",
  ]);
});
