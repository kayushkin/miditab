// The tuning table is data, and data needs pinning against something other
// than itself.
//
// Closes the UNNOTICED verdict on `M8-drop-d-corrupted`
// (scripts/sabotage-plans/control-positive-per-file.json): changing Drop D's
// low string from 38 to 40 passed the suite 7/7. Five of the eight tunings are
// named by no existing test at all.
//
// ⚠️ The obvious test does not work. "Feed a tuning its own open pitches and
// assert every note lands on fret 0" reads like it pins the pitch values, and
// it cannot: corrupt an open pitch and the test feeds the corrupted pitch,
// which still lands on fret 0 of its own string. A test that derives its input
// from the data under test pins the code around the data, never the data. So
// the values below are written out as literals, checked against a source the
// test does not import.

import { test } from "node:test";
import assert from "node:assert/strict";
import { midiToTab, TUNINGS, TUNING_LIST, GUITAR_STANDARD, STANDARD } from "../dist/index.js";
import { buildMidi, melodyTrack } from "./buildMidi.mjs";

// MIDI pitch of each open string, highest string first (tab display order).
// Derived from the instruments, not copied from src/tunings.ts: middle C = 60,
// so guitar low E = E2 = 40, bass low E = E1 = 28, ukulele high A = A4 = 69.
const EXPECTED = {
  "guitar-standard": { pitches: [64, 59, 55, 50, 45, 40], labels: ["e", "B", "G", "D", "A", "E"] },
  "guitar-drop-d":   { pitches: [64, 59, 55, 50, 45, 38], labels: ["e", "B", "G", "D", "A", "D"] },
  "guitar-dadgad":   { pitches: [62, 57, 55, 50, 45, 38], labels: ["d", "A", "G", "D", "A", "D"] },
  "bass-4":          { pitches: [43, 38, 33, 28],         labels: ["G", "D", "A", "E"] },
  "bass-5":          { pitches: [43, 38, 33, 28, 23],     labels: ["G", "D", "A", "E", "B"] },
  "ukulele":         { pitches: [69, 64, 60, 67],         labels: ["A", "E", "C", "G"] },
  "mandolin":        { pitches: [76, 69, 62, 55],         labels: ["E", "A", "D", "G"] },
  "banjo-5":         { pitches: [62, 59, 55, 50, 67],     labels: ["D", "B", "G", "D", "g"] },
};

test("every shipped tuning is pinned, and no tuning is shipped unpinned", () => {
  const shipped = TUNING_LIST.map(t => t.id).sort();
  assert.deepEqual(shipped, Object.keys(EXPECTED).sort());
  assert.equal(TUNING_LIST.length, 8);
});

for (const [id, expected] of Object.entries(EXPECTED)) {
  test(`${id}: open pitches and labels`, () => {
    const tuning = TUNINGS[id];
    assert.ok(tuning, `TUNINGS is missing ${id}`);
    assert.deepEqual(tuning.openPitches, expected.pitches);
    assert.deepEqual(tuning.labels, expected.labels);
    assert.equal(tuning.id, id, "the map key must match the tuning's own id");
  });
}

test("TUNINGS and TUNING_LIST hold the same tunings", () => {
  assert.deepEqual(
    Object.keys(TUNINGS).sort(),
    TUNING_LIST.map(t => t.id).sort(),
  );
  for (const tuning of TUNING_LIST) {
    assert.equal(TUNINGS[tuning.id], tuning, `${tuning.id} differs between the map and the list`);
  }
});

test("every tuning has one label per string", () => {
  assert.ok(TUNING_LIST.length > 0, "nothing to check — TUNING_LIST is empty");
  for (const tuning of TUNING_LIST) {
    assert.equal(
      tuning.labels.length,
      tuning.openPitches.length,
      `${tuning.id} has ${tuning.labels.length} labels for ${tuning.openPitches.length} strings`,
    );
    assert.equal(tuning.labels.every(l => l.length === 1), true, `${tuning.id} has a multi-character label`);
  }
});

test("STANDARD is still an alias for GUITAR_STANDARD", () => {
  assert.equal(STANDARD, GUITAR_STANDARD);
});

// This one pins the ASSIGNER against each tuning, not the pitch values — see
// the warning at the top of this file. It is worth having anyway: it is the
// check that every shipped tuning can actually be rendered.
test("every tuning renders one tab line per string, labelled in order", () => {
  let checked = 0;
  for (const tuning of TUNING_LIST) {
    const file = buildMidi([melodyTrack(tuning.openPitches, { name: tuning.id })]);
    const { ascii, unplaceableCount, placedChords } = midiToTab(file, { tuning });

    assert.equal(unplaceableCount, 0, `${tuning.id}: could not place its own open strings`);

    const tabLines = ascii.split("\n").filter(l => /^.\|/.test(l));
    assert.equal(
      tabLines.length,
      tuning.openPitches.length,
      `${tuning.id}: expected ${tuning.openPitches.length} tab lines, got ${tabLines.length}`,
    );
    assert.deepEqual(
      tabLines.map(l => l[0]),
      tuning.labels,
      `${tuning.id}: tab line labels are out of order`,
    );

    // An open string played alone is fret 0 — the assigner prefers the lowest
    // fret when nothing else discriminates.
    for (const chord of placedChords) {
      for (const position of chord.positions) {
        assert.equal(position.fret, 0, `${tuning.id}: open pitch placed at fret ${position.fret}`);
      }
    }
    checked++;
  }
  assert.equal(checked, TUNING_LIST.length, "the loop skipped a tuning");
});
