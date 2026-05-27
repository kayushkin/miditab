import { test } from "node:test";
import assert from "node:assert/strict";
import {
  midiToTab,
  midiToSheet,
  parseMidi,
  TUNINGS,
} from "../dist/index.js";

// Build a minimal SMF format-1 file with one track containing four notes:
//   E2 (40) → low E open
//   E3 (52) → D string fret 2
//   G3 (55) → G string open
//   chord [E2, G3, B3] (40, 55, 59) → low E open, G open, B open
function buildMidi() {
  const bytes = [];
  bytes.push(...ascii("MThd"));
  bytes.push(...u32(6));
  bytes.push(...u16(1));   // format 1
  bytes.push(...u16(1));   // 1 track
  bytes.push(...u16(96));  // 96 PPQ

  const track = [];
  track.push(0, 0xff, 0x03, 4, 0x54, 0x65, 0x73, 0x74); // "Test"
  track.push(0, 0x90, 40, 80);  track.push(96, 0x80, 40, 0);
  track.push(0, 0x90, 52, 80);  track.push(96, 0x80, 52, 0);
  track.push(0, 0x90, 55, 80);  track.push(96, 0x80, 55, 0);
  track.push(0, 0x90, 40, 80);
  track.push(0, 0x90, 55, 80);
  track.push(0, 0x90, 59, 80);
  track.push(96, 0x80, 40, 0);
  track.push(0, 0x80, 55, 0);
  track.push(0, 0x80, 59, 0);
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
  assert.equal(midi.tracks[0].notes.length, 6);
});

test("renders ASCII tab in guitar standard tuning", () => {
  const { ascii, unplaceableCount } = midiToTab(buildMidi());
  assert.equal(unplaceableCount, 0);
  const lines = ascii.split("\n");
  const eLine = lines.find(l => l.startsWith("E|"));
  assert.ok(eLine, "expected E| line");
  assert.ok(eLine.includes("0"), `expected fret 0 on low E line: ${eLine}`);
  assert.ok(lines.find(l => l.startsWith("e|")), "expected e| line");
});

test("renders bass tab with the same notes on different strings", () => {
  const { ascii, unplaceableCount } = midiToTab(buildMidi(), { tuning: TUNINGS["bass-4"] });
  assert.equal(unplaceableCount, 0);
  // Bass tab has 4 lines, no high-e or B labels.
  const lines = ascii.split("\n").filter(l => /^[A-Ga-g]\|/.test(l));
  assert.equal(lines.length, 4, `expected 4 tab lines for 4-string bass, got: ${lines.length}`);
  for (const l of lines) {
    assert.match(l[0], /^[GDAE]$/, `unexpected bass label in line: ${l}`);
  }
});

test("renders ukulele tab", () => {
  const { ascii } = midiToTab(buildMidi(), { tuning: TUNINGS["ukulele"] });
  const lines = ascii.split("\n").filter(l => /^[A-Ga-g]\|/.test(l));
  assert.equal(lines.length, 4);
});

test("renders MusicXML", () => {
  const { musicXml } = midiToSheet(buildMidi());
  assert.match(musicXml, /<score-partwise/);
  assert.match(musicXml, /<part id="P1">/);
  assert.match(musicXml, /<step>E<\/step>/);   // E2 note
  assert.match(musicXml, /<step>G<\/step>/);   // G3 note
  assert.match(musicXml, /<measure number="1">/);
  // Each chord/note must have a duration > 0.
  const durs = [...musicXml.matchAll(/<duration>(\d+)<\/duration>/g)].map(m => parseInt(m[1], 10));
  assert.ok(durs.length > 0, "expected duration elements");
  for (const d of durs) assert.ok(d > 0, `expected positive duration, got ${d}`);
});

test("MusicXML uses bass clef for low-range tracks", () => {
  // Override pitches in our tiny MIDI: make everything below middle C.
  // We just feed the existing bass-range notes (40, 52, 55) — mean ≈ 49 < 57 → bass clef.
  const { musicXml } = midiToSheet(buildMidi());
  assert.match(musicXml, /<sign>F<\/sign>/);
});

test("rejects empty input gracefully", () => {
  assert.throws(() => parseMidi(new Uint8Array([])), /missing MThd/);
});
