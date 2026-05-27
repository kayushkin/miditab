import { test } from "node:test";
import assert from "node:assert/strict";
import { midiToTab, parseMidi } from "../dist/index.js";

// Build a minimal SMF format-1 file with one track containing four notes:
//   E2 (40) → low E open
//   E3 (52) → D string fret 2
//   G3 (55) → G string open
//   chord [E2, G3, B3] (40, 55, 59) → low E open, G open, B open
function buildMidi() {
  const bytes = [];
  // Header
  bytes.push(...ascii("MThd"));
  bytes.push(...u32(6));
  bytes.push(...u16(1));   // format 1
  bytes.push(...u16(1));   // 1 track
  bytes.push(...u16(96));  // 96 PPQ

  // Track
  const track = [];
  // track name meta
  track.push(0);
  track.push(0xff, 0x03, 4, 0x54, 0x65, 0x73, 0x74); // "Test"
  // note on E2 at t=0, off at t=96
  track.push(0, 0x90, 40, 80);
  track.push(96, 0x80, 40, 0);
  // note on E3 at t=96, off at t=192
  track.push(0, 0x90, 52, 80);
  track.push(96, 0x80, 52, 0);
  // note on G3 at t=192, off at t=288
  track.push(0, 0x90, 55, 80);
  track.push(96, 0x80, 55, 0);
  // chord at t=288
  track.push(0, 0x90, 40, 80);
  track.push(0, 0x90, 55, 80);
  track.push(0, 0x90, 59, 80);
  track.push(96, 0x80, 40, 0);
  track.push(0, 0x80, 55, 0);
  track.push(0, 0x80, 59, 0);
  // end of track meta
  track.push(0, 0xff, 0x2f, 0);

  bytes.push(...ascii("MTrk"));
  bytes.push(...u32(track.length));
  bytes.push(...track);

  return new Uint8Array(bytes);

  function ascii(s) { return [...s].map(c => c.charCodeAt(0)); }
  function u16(v) { return [(v >> 8) & 0xff, v & 0xff]; }
  function u32(v) { return [(v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]; }
}

test("parses a tiny MIDI file", () => {
  const midi = parseMidi(buildMidi());
  assert.equal(midi.format, 1);
  assert.equal(midi.ticksPerQuarter, 96);
  assert.equal(midi.tracks.length, 1);
  assert.equal(midi.tracks[0].name, "Test");
  // 4 standalone + 3 in chord = 6 distinct note-on events but we collapse
  // simultaneous starts in renderer, not parser. Parser should yield 6 notes.
  assert.equal(midi.tracks[0].notes.length, 6);
});

test("renders ASCII tab with expected open-string frets", () => {
  const { ascii, unplaceableCount } = midiToTab(buildMidi());
  assert.equal(unplaceableCount, 0);
  // Standard tuning has open E (low E string) for pitch 40 — fret 0 should
  // appear on the bottom line (the "E|" labeled line).
  const lines = ascii.split("\n");
  const eLine = lines.find(l => l.startsWith("E|"));
  assert.ok(eLine, "expected an E| line");
  assert.ok(eLine.includes("0"), `expected fret 0 on low E line, got: ${eLine}`);
  // High e string (top) gets the "e|" label.
  const highELine = lines.find(l => l.startsWith("e|"));
  assert.ok(highELine, "expected an e| line");
});

test("rejects empty input gracefully", () => {
  assert.throws(() => parseMidi(new Uint8Array([])), /missing MThd/);
});
