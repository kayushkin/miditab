// What the SMF parser does with the wire format, one mechanism at a time.
//
// `M1..M8` in scripts/sabotage-plans/control-positive-per-file.json asked the
// per-FILE question — replace a whole mechanism with its failure value and see
// whether the suite notices. src/parseMidi.ts passed that: gutting it reddens
// the suite, so the file is reachable. Reachable is not pinned. The per-mechanism
// plan then aimed one mutation at each named behaviour in the file and **eleven
// of eleven went UNNOTICED**, because every test fed it a byte stream built from
// a note list, and a note list can only express the parser's happy path.
//
// The mechanisms below are the ones a real MIDI file exercises and a generated
// one does not: a status byte that is absent, a payload that must not be read as
// events, a note that never ends. They are written with `buildMidi`'s raw-event
// builder, which puts the bytes down exactly as given.
//
// Closes PM1..PM11 in scripts/sabotage-plans/per-mechanism.json.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMidi } from "../dist/index.js";
import { buildMidi, noteOn, noteOff, setTempo, sysex } from "./buildMidi.mjs";

/** The one track of a single-track file, parsed. */
function onlyTrack(events, options = {}) {
  const midi = parseMidi(buildMidi([{ name: "T", events }], options));
  assert.equal(midi.tracks.length, 1, "fixture should hold exactly one track");
  return midi.tracks[0];
}

/** Notes as [pitch, startTick, durationTicks] triples, for readable assertions. */
function triples(track) {
  return track.notes.map(n => [n.pitch, n.startTick, n.durationTicks]);
}

test("running status: a note event with no status byte reuses the previous one", () => {
  // The second note-on and both note-offs omit their status byte — legal SMF,
  // and how nearly every real file encodes a run of notes on one channel.
  const track = onlyTrack([
    { delta: 0, bytes: noteOn(60) },
    { delta: 96, bytes: [60, 0] },   // running status: note-on velocity 0 = off
    { delta: 0, bytes: [62, 80] },   // running status: next note on
    { delta: 96, bytes: [62, 0] },
  ]);
  assert.deepEqual(triples(track), [[60, 0, 96], [62, 96, 96]]);
});

test("running status with no prior status byte is refused, not guessed", () => {
  assert.throws(
    () => onlyTrack([{ delta: 0, bytes: [60, 80] }]),
    /running status with no prior status/,
  );
});

test("sysex: the payload is skipped whole, even when it looks like note events", () => {
  // The payload below is byte-for-byte a note-on for pitch 72. A parser that
  // does not skip the declared length reads it as one and invents a note.
  const track = onlyTrack([
    { delta: 0, bytes: noteOn(60) },
    { delta: 0, bytes: sysex([0x90, 72, 80]) },
    { delta: 96, bytes: noteOff(60) },
  ]);
  assert.deepEqual(triples(track), [[60, 0, 96]]);
});

test("tempo: the first set-tempo meta event sets tempoBPM", () => {
  // 400,000 µs per quarter = 150 BPM. Deliberately NOT 500,000 µs: that is
  // 120 BPM, which is also the default, so it cannot tell a parsed tempo from
  // an ignored one.
  const midi = parseMidi(buildMidi([{
    name: "T",
    events: [
      { delta: 0, bytes: setTempo(400_000) },
      { delta: 0, bytes: noteOn(60) },
      { delta: 96, bytes: noteOff(60) },
    ],
  }]));
  assert.equal(midi.tempoBPM, 150);
});

test("tempo: a file with no set-tempo event reports the 120 BPM default", () => {
  const midi = parseMidi(buildMidi([{
    name: "T",
    events: [{ delta: 0, bytes: noteOn(60) }, { delta: 96, bytes: noteOff(60) }],
  }]));
  assert.equal(midi.tempoBPM, 120);
});

test("two-data-byte events are consumed whole: aftertouch, controller, pitch bend", () => {
  // Each of these carries exactly two data bytes. Consuming one leaves the other
  // to be read as the next event's status byte and the rest of the track
  // decodes into nonsense.
  const track = onlyTrack([
    { delta: 0, bytes: [0xa0, 60, 64] },   // polyphonic aftertouch
    { delta: 0, bytes: [0xb0, 7, 100] },   // controller: channel volume
    { delta: 0, bytes: [0xe0, 0, 64] },    // pitch bend: centre
    { delta: 0, bytes: noteOn(60) },
    { delta: 96, bytes: noteOff(60) },
  ]);
  assert.deepEqual(triples(track), [[60, 0, 96]]);
});

test("one-data-byte events are consumed whole: program change, channel pressure", () => {
  const track = onlyTrack([
    { delta: 0, bytes: [0xc0, 25] },       // program change: steel guitar
    { delta: 0, bytes: [0xd0, 64] },       // channel pressure
    { delta: 0, bytes: noteOn(60) },
    { delta: 96, bytes: noteOff(60) },
  ]);
  assert.deepEqual(triples(track), [[60, 0, 96]]);
});

test("an SMPTE division reports ticksPerQuarter 0 rather than a bogus tick count", () => {
  // 0xE728: high bit set, -25 frames per second, 40 ticks per frame. There is no
  // ticks-per-quarter in this file at all, and answering `division & 0x7fff`
  // (26,408) would be a number with no meaning that every later tick
  // calculation would silently divide by.
  const midi = parseMidi(buildMidi(
    [{ name: "T", events: [{ delta: 0, bytes: noteOn(60) }, { delta: 96, bytes: noteOff(60) }] }],
    { division: 0xe728 },
  ));
  assert.equal(midi.ticksPerQuarter, 0);
});

test("a plain PPQ division is reported as its tick count", () => {
  const midi = parseMidi(buildMidi(
    [{ name: "T", events: [{ delta: 0, bytes: noteOn(60) }, { delta: 96, bytes: noteOff(60) }] }],
    { ticksPerQuarter: 384 },
  ));
  assert.equal(midi.ticksPerQuarter, 384);
});

test("a note still sounding at the end of the track is closed, not dropped", () => {
  // No note-off for pitch 60. Truncated exports do this constantly; dropping the
  // note loses the music rather than mis-timing it.
  const track = onlyTrack([
    { delta: 0, bytes: noteOn(60) },
    { delta: 192, bytes: [0xb0, 7, 100] }, // something later, to advance the clock
  ]);
  assert.deepEqual(triples(track), [[60, 0, 192]]);
});

test("re-sounding a ringing pitch closes the first note instead of losing it", () => {
  // Two note-ons for the same pitch with no note-off between them. The first
  // note ended when the second began — that is the only reading available — and
  // it must survive.
  const track = onlyTrack([
    { delta: 0, bytes: noteOn(60) },
    { delta: 96, bytes: noteOn(60) },
    { delta: 96, bytes: noteOff(60) },
  ]);
  assert.deepEqual(triples(track), [[60, 0, 96], [60, 96, 96]]);
});

test("a note-on with velocity 0 ends the note, it does not start a second one", () => {
  const track = onlyTrack([
    { delta: 0, bytes: noteOn(60, 80) },
    { delta: 96, bytes: noteOn(60, 0) },
  ]);
  assert.deepEqual(triples(track), [[60, 0, 96]]);
});

test("simultaneous notes come back lowest pitch first", () => {
  // Written high-to-low in the byte stream, so passing this needs the sort and
  // not the input order.
  const track = onlyTrack([
    { delta: 0, bytes: noteOn(67) },
    { delta: 0, bytes: noteOn(60) },
    { delta: 96, bytes: noteOff(67) },
    { delta: 0, bytes: noteOff(60) },
  ]);
  assert.deepEqual(track.notes.map(n => n.pitch), [60, 67]);
});

test("track.channel is the first channel seen, not the last", () => {
  // This is what the drum-channel skip in pickDefaultTrack reads, so "last one
  // wins" would make track selection depend on how a track ends.
  const track = onlyTrack([
    { delta: 0, bytes: noteOn(60, 80, 0) },
    { delta: 96, bytes: noteOff(60, 0) },
    { delta: 0, bytes: noteOn(62, 80, 5) },
    { delta: 96, bytes: noteOff(62, 5) },
  ]);
  assert.equal(track.channel, 0);
});
