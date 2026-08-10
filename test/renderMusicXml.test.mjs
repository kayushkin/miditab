// The MusicXML renderer, one mechanism at a time.
//
// This is the widest gap the per-mechanism plan found: `M2-renderMusicXml-gutted`
// is CAUGHT, and thirteen of the fourteen named behaviours in the file were
// unpinned — twelve scored UNNOTICED, and the thirteenth (MX8) only escaped that
// verdict because its first spelling did not compile; rewritten so it does, the
// pre-existing 29-test suite passes it too.
// The two existing MusicXML tests check that the document contains a few
// substrings and that a low-pitched track selects a bass clef, which is enough
// to notice the renderer returning "" and not enough to notice it writing the
// wrong pitch, the wrong octave, the wrong bar count or unescaped XML.
//
// Every test below calls `renderMusicXml` with a MidiTrack written out as data.
// A note list is the renderer's actual input type, so unlike the parser tests
// there is nothing to encode: 96 ticks per quarter throughout, which makes a
// sixteenth 24 ticks.
//
// Closes MX1, MX3..MX8, MX10..MX14 in scripts/sabotage-plans/per-mechanism.json.
// MX2 is declared expected_unnoticed there, with the argument for why no input
// reaches the branch.

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMusicXml } from "../dist/index.js";

const TICKS_PER_QUARTER = 96;
const QUARTER = TICKS_PER_QUARTER;

function track(notes, name = "Part") {
  return {
    name,
    channel: 0,
    notes: notes.map(([pitch, startTick, durationTicks]) => ({
      pitch, startTick, durationTicks, velocity: 80, channel: 0,
    })),
  };
}

function render(notes, options = {}) {
  return renderMusicXml(track(notes), { ticksPerQuarter: TICKS_PER_QUARTER, ...options });
}

/** How many times a fragment appears — the difference between "emitted" and "emitted once". */
function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

/**
 * The document's <note> elements, in order, as plain objects.
 *
 * Substring counts over the whole document are the wrong instrument here and
 * cost this file four wrong expectations before it was written: every measure
 * is padded out to its full length with rests, so `<dot/>` appears once for a
 * dotted quarter note AND once for the dotted half rest that pads the bar after
 * it. Counting `<dot/>` over the document therefore answers a question about the
 * padding, confidently, while reading like a question about the note.
 */
function notesOf(xml) {
  return [...xml.matchAll(/ {6}<note>\n([\s\S]*?) {6}<\/note>/g)].map(([, body]) => {
    const value = (tag) => {
      const found = body.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
      return found ? found[1] : null;
    };
    return {
      isRest: body.includes("<rest/>"),
      isChord: body.includes("<chord/>"),
      step: value("step"),
      alter: value("alter"),
      octave: value("octave"),
      duration: Number(value("duration")),
      type: value("type"),
      dots: count(body, "<dot/>"),
    };
  });
}

/** The sounding notes, with the bar-filling rests dropped. */
function soundingNotes(xml) {
  return notesOf(xml).filter(note => !note.isRest);
}

test("a dotted duration is one dotted glyph, not two tied ones", () => {
  // Six sixteenths is a dotted quarter. Decomposing it into a quarter plus an
  // eighth is not wrong arithmetic, it is wrong notation.
  const sounding = soundingNotes(render([[60, 0, QUARTER + QUARTER / 2]]));
  assert.equal(sounding.length, 1, "one note in, one note out");
  assert.deepEqual(
    { type: sounding[0].type, dots: sounding[0].dots, duration: sounding[0].duration },
    { type: "quarter", dots: 1, duration: 6 },
  );
});

test("an undotted duration gets no dot", () => {
  const sounding = soundingNotes(render([[60, 0, QUARTER]]));
  assert.deepEqual(
    { type: sounding[0].type, dots: sounding[0].dots },
    { type: "quarter", dots: 0 },
  );
});

test("a sharp is written with its alter", () => {
  const xml = render([[61, 0, QUARTER]]);       // C#4
  assert.ok(xml.includes("<step>C</step>"), xml);
  assert.ok(xml.includes("<alter>1</alter>"), xml);
});

test("a natural is written without an alter", () => {
  const xml = render([[60, 0, QUARTER]]);       // C4
  assert.ok(xml.includes("<step>C</step>"), xml);
  assert.equal(count(xml, "<alter>"), 0);
});

test("middle C is octave 4", () => {
  // MIDI 60 is C4 by the convention this library documents (parseMidi.ts says
  // "middle C = 60"). Off by one here transposes the whole score.
  const xml = render([[60, 0, QUARTER]]);
  assert.ok(xml.includes("<octave>4</octave>"), xml);
});

test("each pitch class is named correctly across an octave", () => {
  // A literal table, not one derived from PITCH_NAMES — the point is to pin the
  // table itself. See the header of test/tunings.test.mjs for why a derived
  // fixture cannot do that.
  const expected = [
    [60, "C"], [62, "D"], [64, "E"], [65, "F"], [67, "G"], [69, "A"], [71, "B"],
  ];
  for (const [pitch, step] of expected) {
    const xml = render([[pitch, 0, QUARTER]]);
    assert.ok(xml.includes(`<step>${step}</step>`), `MIDI ${pitch} should be ${step}:\n${xml}`);
  }
});

test("XML metacharacters in a title are escaped", () => {
  const xml = render([[60, 0, QUARTER]], { title: 'Rock & Roll <"loud">' });
  assert.ok(
    xml.includes("<work-title>Rock &amp; Roll &lt;&quot;loud&quot;&gt;</work-title>"),
    xml.split("\n").slice(0, 6).join("\n"),
  );
});

test("a silent gap is filled with a rest", () => {
  // A quarter note, a quarter of silence, then another quarter note. Without the
  // rest the second note slides onto beat 2 and the bar says something else.
  const xml = render([[60, 0, QUARTER], [62, 2 * QUARTER, QUARTER]]);
  assert.ok(xml.includes("<rest/>"), xml);
  const firstRest = xml.indexOf("<rest/>");
  const secondNote = xml.indexOf("<step>D</step>");
  assert.ok(firstRest < secondNote, "the rest should be emitted before the note it delays");
});

test("a note crossing a bar line is split at the bar", () => {
  // Eight quarter notes in 4/4 is exactly two measures.
  const notes = Array.from({ length: 8 }, (_, i) => [60 + i, i * QUARTER, QUARTER]);
  const xml = render(notes);
  assert.ok(xml.includes('<measure number="1">'), xml);
  assert.ok(xml.includes('<measure number="2">'), xml);
  assert.equal(count(xml, "<measure "), 2);
});

test("the divisions attribute matches the grid the durations are counted in", () => {
  // Durations are emitted in sixteenths, so a quarter is 4 divisions and
  // <divisions> must say 4. A renderer that says 1 makes every duration in the
  // document mean four times what it should.
  const xml = render([[60, 0, QUARTER]]);
  assert.ok(xml.includes("<divisions>4</divisions>"), xml);
  assert.ok(xml.includes("<duration>4</duration>"), xml);
});

test("the second and third notes of a chord are marked as chord notes", () => {
  // Highest first, then the rest under a <chord/>. Without the marker the three
  // notes read as three successive beats rather than one struck chord.
  const sounding = soundingNotes(render([[60, 0, QUARTER], [64, 0, QUARTER], [67, 0, QUARTER]]));
  assert.deepEqual(
    sounding.map(note => [note.step, note.isChord]),
    [["G", false], ["E", true], ["C", true]],
  );
});

test("separate onsets are not marked as chord notes", () => {
  const sounding = soundingNotes(render([[60, 0, QUARTER], [64, QUARTER, QUARTER]]));
  assert.deepEqual(sounding.map(note => note.isChord), [false, false]);
});

test("a short final measure is padded out with a rest", () => {
  // One quarter note in 4/4 leaves three beats, which is one dotted half rest.
  // A measure that stops early is not a valid measure.
  const xml = render([[60, 0, QUARTER]]);
  assert.equal(count(xml, "<measure "), 1);
  const rests = notesOf(xml).filter(note => note.isRest);
  assert.deepEqual(
    rests.map(rest => ({ type: rest.type, dots: rest.dots, duration: rest.duration })),
    [{ type: "half", dots: 1, duration: 12 }],
  );
});

test("a measure that is already full is not padded", () => {
  // The negative half: four quarter notes fill 4/4 exactly, so any rest here
  // would be the padding firing when it should not.
  const notes = Array.from({ length: 4 }, (_, i) => [60 + i, i * QUARTER, QUARTER]);
  const xml = render(notes);
  assert.deepEqual(notesOf(xml).filter(note => note.isRest), []);
});

test("a zero-length note is dropped rather than laid out", () => {
  // Some exporters emit a note-on immediately followed by its note-off. It has
  // no duration to notate, and quantizing it up to a sixteenth invents music.
  const xml = render([[60, 0, 0], [62, 0, QUARTER]]);
  assert.equal(count(xml, "<step>C</step>"), 0);
  assert.equal(count(xml, "<step>D</step>"), 1);
});

test("the time signature follows the caller", () => {
  const xml = render([[60, 0, QUARTER]], { beatsPerMeasure: 3, beatUnit: 8 });
  assert.ok(xml.includes("<beats>3</beats><beat-type>8</beat-type>"), xml);
});

test("the time signature defaults to 4/4", () => {
  const xml = render([[60, 0, QUARTER]]);
  assert.ok(xml.includes("<beats>4</beats><beat-type>4</beat-type>"), xml);
});
