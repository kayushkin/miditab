// The fretboard assigner's grouping, its fret ceiling, and the individual terms
// of its scorer.
//
// `M3-assignFretboard-gutted` and `M4-groupChords-gutted` both reddened the
// suite, so the file is reachable. The per-mechanism plan then found nine of
// ten behaviours here UNNOTICED. The reason is visible in the round-trip
// fixtures: every one of them is notes that fall on open strings or the first
// few frets, where every candidate placement scores the same and the scorer is
// never asked a question it could answer differently.
//
// The two scorer tests below were not reasoned out — the alternative placement
// in each was found by removing the term, rebuilding, and diffing the assigner's
// output over a few thousand inputs. What each test asserts is the placement a
// guitarist would pick; the mutation is what proves the assertion is load-bearing.
//
// Closes AF1, AF2, AF4, AF5, AF7, AF8, AF9, AF10 in
// scripts/sabotage-plans/per-mechanism.json. AF6 is declared expected_unnoticed
// there, with the argument for why no test can catch it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { assignFretboard, groupChords, GUITAR_STANDARD } from "../dist/index.js";

/** Placements as "string:fret" strings, in the order the assigner returns them. */
function shape(placedChord) {
  return placedChord.positions.map(p => `${p.string}:${p.fret}`);
}

function chordAt(startTick, pitches, durationTicks = 96) {
  return { startTick, durationTicks, pitches: [...pitches].sort((a, b) => b - a) };
}

test("a chord is placed in the compact shape, not the lowest one", () => {
  // G#2 (44) and D#3 (51). Two playable answers:
  //   A string fret 6 + low E fret 4 — two frets apart, one hand position
  //   D string fret 1 + low E fret 4 — lower on the neck, three frets apart
  // The compact one is the fingering, and only the span penalty prefers it:
  // without that term the sum-of-frets preference picks the stretch.
  const [placed] = assignFretboard([chordAt(0, [44, 51])], { tuning: GUITAR_STANDARD });
  assert.deepEqual(shape(placed), ["4:6", "5:4"]);
});

test("a following note is placed near the hand, not at the lowest fret", () => {
  // D4+A4 sits the hand around fret 4. The G#3 that follows can be taken at
  // G string fret 1 — lower — or D string fret 6, which is where the hand
  // already is. Staying put is the playable answer, and it is the movement
  // penalty that says so.
  const placed = assignFretboard(
    [chordAt(0, [62, 69]), chordAt(96, [56])],
    { tuning: GUITAR_STANDARD },
  );
  assert.deepEqual(shape(placed[0]), ["0:5", "1:3"]);
  assert.deepEqual(shape(placed[1]), ["3:6"]);
});

test("a note above maxFret is reported unplaced rather than placed off the neck", () => {
  // G#5 (80) is fret 16 on the top string of a guitar. A cigar-box neck that
  // stops at fret 5 cannot play it at all.
  const [placed] = assignFretboard(
    [chordAt(0, [80])],
    { tuning: GUITAR_STANDARD, maxFret: 5 },
  );
  assert.deepEqual(shape(placed), []);
  assert.deepEqual(placed.unplaced, [80]);
});

test("the same note is placed when the neck is long enough", () => {
  // The negative half: without it, "reports unplaced" is also satisfied by an
  // assigner that places nothing at all.
  const [placed] = assignFretboard(
    [chordAt(0, [80])],
    { tuning: GUITAR_STANDARD, maxFret: 22 },
  );
  assert.deepEqual(shape(placed), ["0:16"]);
  assert.deepEqual(placed.unplaced, []);
});

test("maxFret defaults to 22 when the caller does not say", () => {
  const [placed] = assignFretboard([chordAt(0, [80])], { tuning: GUITAR_STANDARD });
  assert.deepEqual(shape(placed), ["0:16"]);
});

test("positions come back highest string first, matching the tab rows", () => {
  // String 0 is the top row of the tab. A chord whose positions arrive in the
  // other order renders upside down.
  const [placed] = assignFretboard([chordAt(0, [40, 55])], { tuning: GUITAR_STANDARD });
  assert.deepEqual(placed.positions.map(p => p.string), [2, 5]);
});

test("notes a few ticks apart are one chord, not two", () => {
  // Human playing and quantizer output both scatter a chord's notes across a
  // few ticks. The tolerance is what makes them a chord.
  const grouped = groupChords([
    { pitch: 60, startTick: 0, durationTicks: 96 },
    { pitch: 64, startTick: 5, durationTicks: 96 },
  ]);
  assert.equal(grouped.length, 1);
  assert.deepEqual(grouped[0].pitches, [64, 60]);
});

test("notes further apart than the tolerance stay separate", () => {
  const grouped = groupChords([
    { pitch: 60, startTick: 0, durationTicks: 96 },
    { pitch: 64, startTick: 50, durationTicks: 96 },
  ]);
  assert.equal(grouped.length, 2);
});

test("the tolerance argument is honoured when the caller widens it", () => {
  const grouped = groupChords([
    { pitch: 60, startTick: 0, durationTicks: 96 },
    { pitch: 64, startTick: 50, durationTicks: 96 },
  ], 100);
  assert.equal(grouped.length, 1);
});

test("a chord lasts as long as its longest note", () => {
  // Written short-note-first, so passing this needs the max and not the
  // first note's duration.
  const grouped = groupChords([
    { pitch: 60, startTick: 0, durationTicks: 96 },
    { pitch: 64, startTick: 0, durationTicks: 192 },
  ]);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].durationTicks, 192);
});
