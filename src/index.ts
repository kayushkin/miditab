// Public entry point: take MIDI bytes, return ASCII tab and/or MusicXML.

import { parseMidi, type MidiFile, type MidiTrack, type MidiNote } from "./parseMidi.js";
import { assignFretboard, groupChords, type PlacedChord } from "./assignFretboard.js";
import { renderAscii } from "./renderAscii.js";
import { renderMusicXml, type MusicXmlOptions } from "./renderMusicXml.js";
import {
  GUITAR_STANDARD,
  STANDARD,
  TUNINGS,
  TUNING_LIST,
  type Tuning,
} from "./tunings.js";

export {
  parseMidi,
  assignFretboard,
  groupChords,
  renderAscii,
  renderMusicXml,
  GUITAR_STANDARD,
  STANDARD,
  TUNINGS,
  TUNING_LIST,
};
export type {
  MidiFile,
  MidiTrack,
  MidiNote,
  PlacedChord,
  Tuning,
  MusicXmlOptions,
};

export interface MidiToTabOptions {
  trackIndex?: number;       // which track to convert; defaults to first track with notes
  tuning?: Tuning;           // defaults to guitar standard EADGBE
  maxFret?: number;          // default 22
  columns?: number;          // tab line width, default 80
  beatsPerMeasure?: number;  // default 4
  title?: string;            // overrides default title
}

export interface MidiToTabResult {
  ascii: string;
  midi: MidiFile;
  trackIndex: number;
  placedChords: PlacedChord[];
  unplaceableCount: number;
}

export function midiToTab(
  input: Uint8Array | ArrayBuffer,
  opts: MidiToTabOptions = {},
): MidiToTabResult {
  const midi = parseMidi(input);
  const trackIndex = opts.trackIndex ?? pickDefaultTrack(midi);
  const track = pickTrack(midi, trackIndex);

  const tuning = opts.tuning ?? GUITAR_STANDARD;
  const chords = groupChords(track.notes);
  const placed = assignFretboard(chords, { tuning, maxFret: opts.maxFret });

  let unplaceable = 0;
  for (const p of placed) unplaceable += p.unplaced.length;

  const title = opts.title ?? `${track.name} — ${tuning.name}`;
  const ascii = renderAscii(placed, {
    tuning,
    ticksPerQuarter: midi.ticksPerQuarter,
    beatsPerMeasure: opts.beatsPerMeasure,
    columns: opts.columns,
    title,
  });

  return { ascii, midi, trackIndex, placedChords: placed, unplaceableCount: unplaceable };
}

export interface MidiToSheetOptions {
  trackIndex?: number;
  divisionUnit?: 16 | 8 | 4;
  beatsPerMeasure?: number;
  beatUnit?: 4 | 8 | 2;
  clef?: "treble" | "bass";
  title?: string;
  partName?: string;
}

export interface MidiToSheetResult {
  musicXml: string;
  midi: MidiFile;
  trackIndex: number;
}

// Render MIDI as MusicXML sheet music. Instrument-agnostic — emits a
// standard score-partwise document any MusicXML renderer (OSMD, Verovio,
// MuseScore, Finale, …) can display.
export function midiToSheet(
  input: Uint8Array | ArrayBuffer,
  opts: MidiToSheetOptions = {},
): MidiToSheetResult {
  const midi = parseMidi(input);
  const trackIndex = opts.trackIndex ?? pickDefaultTrack(midi);
  const track = pickTrack(midi, trackIndex);

  const musicXml = renderMusicXml(track, {
    ticksPerQuarter: midi.ticksPerQuarter,
    divisionUnit: opts.divisionUnit,
    beatsPerMeasure: opts.beatsPerMeasure,
    beatUnit: opts.beatUnit,
    clef: opts.clef,
    title: opts.title ?? track.name,
    partName: opts.partName ?? track.name,
  });

  return { musicXml, midi, trackIndex };
}

function pickTrack(midi: MidiFile, trackIndex: number): MidiTrack {
  if (midi.tracks.length === 0) {
    throw new Error("miditab: file contains no tracks");
  }
  if (trackIndex < 0 || trackIndex >= midi.tracks.length) {
    throw new Error(`miditab: trackIndex ${trackIndex} out of range (0..${midi.tracks.length - 1})`);
  }
  const track = midi.tracks[trackIndex];
  if (track.notes.length === 0) {
    throw new Error(`miditab: track ${trackIndex} ("${track.name}") has no notes`);
  }
  return track;
}

function pickDefaultTrack(midi: MidiFile): number {
  // Prefer the first track with notes that isn't on the drum channel (9).
  for (let i = 0; i < midi.tracks.length; i++) {
    const t = midi.tracks[i];
    if (t.notes.length === 0) continue;
    if (t.channel === 9) continue;
    return i;
  }
  // Fallback: first track with any notes.
  for (let i = 0; i < midi.tracks.length; i++) {
    if (midi.tracks[i].notes.length > 0) return i;
  }
  return 0;
}
