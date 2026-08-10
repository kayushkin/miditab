// Which track does miditab convert when the caller does not say?
//
// Closes the UNNOTICED verdict on `M5-pickDefaultTrack-gutted`
// (scripts/sabotage-plans/control-positive-per-file.json): replacing the whole
// body of `pickDefaultTrack` with `return 0` passed the suite 7/7, because
// every existing test feeds a one-track file and a one-track file makes the
// function's two skip rules unreachable.

import { test } from "node:test";
import assert from "node:assert/strict";
import { midiToTab, midiToSheet } from "../dist/index.js";
import { buildMidi, melodyTrack } from "./buildMidi.mjs";

const EMPTY = { name: "Markers", channel: 0, notes: [] };
const DRUMS = melodyTrack([36, 38, 42], { name: "Drums", channel: 9 });
const GUITAR = melodyTrack([40, 52, 55], { name: "Guitar", channel: 0 });

test("skips tracks that have no notes", () => {
  const { trackIndex, midi } = midiToTab(buildMidi([EMPTY, GUITAR]));
  assert.equal(midi.tracks.length, 2);
  assert.equal(midi.tracks[0].notes.length, 0);
  assert.equal(trackIndex, 1);
});

test("skips the drum channel even though it has notes", () => {
  const { trackIndex, midi } = midiToTab(buildMidi([DRUMS, GUITAR]));
  assert.equal(midi.tracks[0].channel, 9, "expected the first track on the drum channel");
  assert.equal(midi.tracks[0].notes.length, 3, "the drum track must have notes, or it is skipped for the wrong reason");
  assert.equal(trackIndex, 1);
});

test("skips an empty track AND the drum channel to reach the third track", () => {
  const { trackIndex } = midiToTab(buildMidi([EMPTY, DRUMS, GUITAR]));
  assert.equal(trackIndex, 2);
});

test("falls back to the drum track when it is the only one with notes", () => {
  // The second loop in pickDefaultTrack: better to tab the drums than to
  // refuse the file.
  const { trackIndex } = midiToTab(buildMidi([EMPTY, DRUMS]));
  assert.equal(trackIndex, 1);
});

test("an explicit trackIndex overrides the default choice", () => {
  const { trackIndex, midi } = midiToTab(buildMidi([EMPTY, DRUMS, GUITAR]), { trackIndex: 1 });
  assert.equal(trackIndex, 1);
  assert.equal(midi.tracks[1].name, "Drums");
});

test("midiToSheet picks the same track as midiToTab", () => {
  const file = buildMidi([EMPTY, DRUMS, GUITAR]);
  assert.equal(midiToSheet(file).trackIndex, midiToTab(file).trackIndex);
});

test("an out-of-range trackIndex is refused, naming the range", () => {
  const file = buildMidi([EMPTY, GUITAR]);
  assert.throws(() => midiToTab(file, { trackIndex: 5 }), /out of range \(0\.\.1\)/);
  assert.throws(() => midiToTab(file, { trackIndex: -1 }), /out of range/);
});

test("selecting a track with no notes is refused, naming the track", () => {
  assert.throws(
    () => midiToTab(buildMidi([EMPTY, GUITAR]), { trackIndex: 0 }),
    /track 0 \("Markers"\) has no notes/,
  );
});

test("a track with no name is numbered from 1, not from 0", () => {
  const unnamed = { channel: 0, notes: melodyTrack([40, 52]).notes };
  const { midi } = midiToTab(buildMidi([unnamed]));
  assert.equal(midi.tracks[0].name, "Track 1");
});
