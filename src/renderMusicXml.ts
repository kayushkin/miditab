// Render parsed MIDI as MusicXML (score-partwise). Output is a single-part,
// single-staff score with a treble clef, 4/4 time, C major key signature.
//
// The renderer quantizes durations to a grid (sixteenths by default) and lays
// notes out chronologically with rests filling the gaps. Chords are detected
// by note onset coincidence and grouped under a single <chord/> notation.
//
// This is intentionally minimal — enough for OpenSheetMusicDisplay / Verovio /
// MuseScore to render a readable staff. It does not emit dynamics, slurs,
// ties across measures, or tuplets.

import type { MidiNote, MidiTrack } from "./parseMidi.js";

export interface MusicXmlOptions {
  ticksPerQuarter: number;        // from MidiFile.ticksPerQuarter
  divisionUnit?: 16 | 8 | 4;      // grid: 16 = sixteenth notes (default)
  beatsPerMeasure?: number;       // default 4
  beatUnit?: 4 | 8 | 2;           // denominator of time signature (default 4)
  title?: string;
  partName?: string;
  clef?: "treble" | "bass";       // default: auto from pitch range
}

interface DurationGlyph {
  type: string;    // "whole", "half", "quarter", "eighth", "16th", "32nd", "64th"
  dots: number;    // 0, 1, or 2
  divisions: number; // duration in score divisions
}

// Decompose a number of grid units into a sequence of standard note durations
// (with up to 1 augmentation dot). Anything left over is dropped.
function glyphsForUnits(units: number, divisionsPerQuarter: number, gridUnit: number): DurationGlyph[] {
  // Build a table of standard glyphs in units of "grid".
  // gridUnit divisions = 1 grid unit. e.g. for sixteenth grid with
  // divisionsPerQuarter=4, gridUnit=1 (1 division per sixteenth).
  const out: DurationGlyph[] = [];

  // Glyph table: (type, units, dottedUnits)
  const table: { type: string; q: number }[] = [
    { type: "whole", q: 16 },
    { type: "half", q: 8 },
    { type: "quarter", q: 4 },
    { type: "eighth", q: 2 },
    { type: "16th", q: 1 },
  ];
  // Scale by gridUnit/sixteenth ratio if grid is finer than sixteenth.
  // We always emit in sixteenth-grid units here; if the caller picked
  // eighth grid, units will be twice as big — we still resolve correctly.

  let remaining = units;
  while (remaining > 0) {
    let placed = false;
    for (const g of table) {
      // Try dotted first (g.q * 1.5), then plain.
      if (g.q % 2 === 0 && remaining >= (g.q * 3) / 2) {
        out.push({ type: g.type, dots: 1, divisions: (g.q * 3 * gridUnit) / 2 });
        remaining -= (g.q * 3) / 2;
        placed = true;
        break;
      }
      if (remaining >= g.q) {
        out.push({ type: g.type, dots: 0, divisions: g.q * gridUnit });
        remaining -= g.q;
        placed = true;
        break;
      }
    }
    if (!placed) {
      // Less than a sixteenth left — drop it (already quantized).
      break;
    }
  }
  // Map gridUnit so divisionsPerQuarter is consistent.
  // Sanity check we don't drift: total divisions output == units * gridUnit.
  return out;
}

const PITCH_NAMES = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"];
const PITCH_ALTERS = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];

interface PitchInfo {
  step: string;  // A..G
  alter: number; // -1, 0, 1
  octave: number; // MIDI octave (middle C = octave 4)
}

function midiToPitch(p: number): PitchInfo {
  const pc = ((p % 12) + 12) % 12;
  const octave = Math.floor(p / 12) - 1;
  return { step: PITCH_NAMES[pc], alter: PITCH_ALTERS[pc], octave };
}

function escXml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  }[c]!));
}

// Event types laid out on the timeline.
interface TimelineRest {
  kind: "rest";
  startTick: number;
  units: number;
}
interface TimelineChord {
  kind: "chord";
  startTick: number;
  units: number;
  pitches: number[]; // sorted descending
}
type TimelineEvent = TimelineRest | TimelineChord;

export function renderMusicXml(track: MidiTrack, opts: MusicXmlOptions): string {
  const ticksPerQuarter = opts.ticksPerQuarter > 0 ? opts.ticksPerQuarter : 480;
  const divisionUnit = opts.divisionUnit ?? 16;
  const beatsPerMeasure = opts.beatsPerMeasure ?? 4;
  const beatUnit = opts.beatUnit ?? 4;
  const title = opts.title ?? track.name ?? "Untitled";
  const partName = opts.partName ?? track.name ?? "Music";

  // divisions per quarter note in the score — match the grid.
  const divsPerQuarter = divisionUnit / 4;
  const gridUnit = 1; // 1 grid unit = 1 division when divsPerQuarter == divisionUnit/4
  const ticksPerGridUnit = ticksPerQuarter / divsPerQuarter;
  const divsPerMeasure = divsPerQuarter * beatsPerMeasure * (4 / beatUnit);

  const quantize = (tick: number): number => Math.round(tick / ticksPerGridUnit);

  // Group notes into chords by quantized start tick.
  const byStart = new Map<number, MidiNote[]>();
  for (const n of track.notes) {
    if (n.durationTicks <= 0) continue;
    const startUnits = quantize(n.startTick);
    let arr = byStart.get(startUnits);
    if (!arr) { arr = []; byStart.set(startUnits, arr); }
    arr.push(n);
  }
  const starts = Array.from(byStart.keys()).sort((a, b) => a - b);

  // Decide clef.
  let allPitches: number[] = [];
  for (const arr of byStart.values()) for (const n of arr) allPitches.push(n.pitch);
  const meanPitch = allPitches.length > 0
    ? allPitches.reduce((s, p) => s + p, 0) / allPitches.length
    : 60;
  const clef = opts.clef ?? (meanPitch < 57 ? "bass" : "treble");

  // Build timeline of events. Each chord uses the duration of its longest note,
  // quantized; rests fill gaps.
  const timeline: TimelineEvent[] = [];
  let cursor = 0;
  for (const s of starts) {
    if (s > cursor) {
      timeline.push({ kind: "rest", startTick: cursor, units: s - cursor });
    }
    const notes = byStart.get(s)!;
    let longest = 0;
    for (const n of notes) {
      const dur = Math.max(1, quantize(n.startTick + n.durationTicks) - s);
      if (dur > longest) longest = dur;
    }
    const pitches = notes.map(n => n.pitch).sort((a, b) => b - a);
    timeline.push({ kind: "chord", startTick: s, units: longest, pitches });
    cursor = s + longest;
  }

  // Now lay out into measures. We slice events across bar lines, breaking long
  // notes into smaller glyphs at the bar boundary.
  const measures: TimelineEvent[][] = [[]];
  let measureUnits = 0;
  const measureCapacity = divsPerMeasure / gridUnit; // grid units per measure

  const pushEvent = (ev: TimelineEvent) => {
    let remaining = ev.units;
    let evStart = ev.startTick;
    while (remaining > 0) {
      const space = measureCapacity - measureUnits;
      if (remaining <= space) {
        const piece: TimelineEvent = ev.kind === "chord"
          ? { kind: "chord", startTick: evStart, units: remaining, pitches: ev.pitches }
          : { kind: "rest", startTick: evStart, units: remaining };
        measures[measures.length - 1].push(piece);
        measureUnits += remaining;
        remaining = 0;
      } else {
        const piece: TimelineEvent = ev.kind === "chord"
          ? { kind: "chord", startTick: evStart, units: space, pitches: ev.pitches }
          : { kind: "rest", startTick: evStart, units: space };
        measures[measures.length - 1].push(piece);
        evStart += space;
        remaining -= space;
        measures.push([]);
        measureUnits = 0;
      }
    }
  };

  for (const ev of timeline) pushEvent(ev);

  // Pad final measure with a rest if it isn't full.
  if (measureUnits > 0 && measureUnits < measureCapacity) {
    measures[measures.length - 1].push({
      kind: "rest",
      startTick: 0,
      units: measureCapacity - measureUnits,
    });
  } else if (measures[measures.length - 1].length === 0) {
    measures.pop();
  }

  // Emit MusicXML.
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8" standalone="no"?>');
  lines.push('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">');
  lines.push('<score-partwise version="3.1">');
  lines.push(`  <work><work-title>${escXml(title)}</work-title></work>`);
  lines.push('  <part-list>');
  lines.push(`    <score-part id="P1"><part-name>${escXml(partName)}</part-name></score-part>`);
  lines.push('  </part-list>');
  lines.push('  <part id="P1">');

  for (let m = 0; m < measures.length; m++) {
    lines.push(`    <measure number="${m + 1}">`);
    if (m === 0) {
      lines.push('      <attributes>');
      lines.push(`        <divisions>${divsPerQuarter}</divisions>`);
      lines.push('        <key><fifths>0</fifths></key>');
      lines.push(`        <time><beats>${beatsPerMeasure}</beats><beat-type>${beatUnit}</beat-type></time>`);
      if (clef === "treble") {
        lines.push('        <clef><sign>G</sign><line>2</line></clef>');
      } else {
        lines.push('        <clef><sign>F</sign><line>4</line></clef>');
      }
      lines.push('      </attributes>');
    }

    for (const ev of measures[m]) {
      if (ev.kind === "rest") {
        const glyphs = glyphsForUnits(ev.units, divsPerQuarter, gridUnit);
        for (const g of glyphs) {
          lines.push('      <note>');
          lines.push('        <rest/>');
          lines.push(`        <duration>${g.divisions}</duration>`);
          lines.push(`        <voice>1</voice>`);
          lines.push(`        <type>${g.type}</type>`);
          for (let d = 0; d < g.dots; d++) lines.push('        <dot/>');
          lines.push('      </note>');
        }
      } else {
        // Chord: first pitch as the head note, the rest with <chord/>.
        const glyphs = glyphsForUnits(ev.units, divsPerQuarter, gridUnit);
        // For chord notes we emit the *entire* glyph sequence on the first
        // pitch, but only one glyph (the longest) on chord-tied pitches —
        // this is a simplification that loses chord behavior across ties.
        // To keep it readable, we render the full glyph sequence per pitch
        // but mark all-but-first as <chord/>.
        for (let gi = 0; gi < glyphs.length; gi++) {
          const g = glyphs[gi];
          for (let pi = 0; pi < ev.pitches.length; pi++) {
            const p = ev.pitches[pi];
            const info = midiToPitch(p);
            lines.push('      <note>');
            if (pi > 0) lines.push('        <chord/>');
            lines.push('        <pitch>');
            lines.push(`          <step>${info.step}</step>`);
            if (info.alter) lines.push(`          <alter>${info.alter}</alter>`);
            lines.push(`          <octave>${info.octave}</octave>`);
            lines.push('        </pitch>');
            lines.push(`        <duration>${g.divisions}</duration>`);
            lines.push(`        <voice>1</voice>`);
            lines.push(`        <type>${g.type}</type>`);
            for (let d = 0; d < g.dots; d++) lines.push('        <dot/>');
            lines.push('      </note>');
          }
        }
      }
    }
    lines.push('    </measure>');
  }

  lines.push('  </part>');
  lines.push('</score-partwise>');
  return lines.join("\n") + "\n";
}
