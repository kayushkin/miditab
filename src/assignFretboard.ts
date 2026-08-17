// Assign MIDI notes to (string, fret) positions on the fretboard.
//
// Strategy: greedy left-to-right over time-grouped chords. For each chord, we
// enumerate all valid string assignments (no two notes on the same string,
// every note assigned), score them against the previous chord's "hand center"
// (mean fret of fretted notes), and keep the best. This handles single-note
// melodies, chords, and chord+melody mixes uniformly.

import type { Tuning } from "./tunings.js";

export interface FretPosition {
  string: number; // 0 = highest string (top of tab)
  fret: number;   // 0..maxFret
  pitch: number;
}

export interface PlacedChord {
  startTick: number;
  durationTicks: number;
  positions: FretPosition[]; // sorted by string asc
  unplaced: number[];        // pitches that could not be placed
}

export interface AssignOptions {
  tuning: Tuning;
  maxFret?: number; // default 22
}

interface ChordIn {
  startTick: number;
  durationTicks: number;
  pitches: number[];
}

// Group notes into "chords" — notes sharing a start tick (within a small
// tolerance) get played simultaneously.
export function groupChords(
  notes: { pitch: number; startTick: number; durationTicks: number }[],
  tolerance = 10,
): ChordIn[] {
  if (notes.length === 0) return [];
  const sorted = [...notes].sort((a, b) => a.startTick - b.startTick);
  const out: ChordIn[] = [];
  let cur: ChordIn = {
    startTick: sorted[0].startTick,
    durationTicks: sorted[0].durationTicks,
    pitches: [sorted[0].pitch],
  };
  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i];
    if (n.startTick - cur.startTick <= tolerance) {
      cur.pitches.push(n.pitch);
      cur.durationTicks = Math.max(cur.durationTicks, n.durationTicks);
    } else {
      cur.pitches.sort((a, b) => b - a); // high to low (matches tab top-down)
      out.push(cur);
      cur = { startTick: n.startTick, durationTicks: n.durationTicks, pitches: [n.pitch] };
    }
  }
  cur.pitches.sort((a, b) => b - a);
  out.push(cur);
  return out;
}

interface Candidate {
  // index into chord.pitches → FretPosition, or undefined if not placed
  picks: (FretPosition | undefined)[];
  score: number;
}

function chordHandCenter(picks: (FretPosition | undefined)[]): number | null {
  let sum = 0;
  let n = 0;
  for (const p of picks) {
    if (p && p.fret > 0) {
      sum += p.fret;
      n++;
    }
  }
  return n > 0 ? sum / n : null;
}

function chordSpan(picks: (FretPosition | undefined)[]): number {
  let min = Infinity, max = -Infinity;
  for (const p of picks) {
    if (p && p.fret > 0) {
      if (p.fret < min) min = p.fret;
      if (p.fret > max) max = p.fret;
    }
  }
  return max < 0 ? 0 : max - min;
}

function placeChord(
  pitches: number[],
  tuning: Tuning,
  maxFret: number,
  prevCenter: number | null,
): Candidate {
  // For each pitch, the list of (string, fret) options.
  const optionsPerPitch: FretPosition[][] = pitches.map(pitch => {
    const opts: FretPosition[] = [];
    for (let s = 0; s < tuning.openPitches.length; s++) {
      const fret = pitch - tuning.openPitches[s];
      if (fret >= 0 && fret <= maxFret) {
        opts.push({ string: s, fret, pitch });
      }
    }
    return opts;
  });

  const used = new Set<number>();
  const picks: (FretPosition | undefined)[] = new Array(pitches.length).fill(undefined);
  let best: Candidate | null = null;

  const recurse = (i: number) => {
    if (i === pitches.length) {
      const score = scoreChord(picks, prevCenter);
      if (best === null || score < best.score) {
        best = { picks: picks.slice(), score };
      }
      return;
    }
    const opts = optionsPerPitch[i];
    if (opts.length === 0) {
      // Pitch can't be played on this tuning at all — skip it (will be unplaced).
      picks[i] = undefined;
      recurse(i + 1);
      return;
    }
    for (const opt of opts) {
      if (used.has(opt.string)) continue;
      used.add(opt.string);
      picks[i] = opt;
      recurse(i + 1);
      picks[i] = undefined;
      used.delete(opt.string);
    }
    // Also explore the "skip this pitch" branch only if no placement is possible
    // without exceeding string capacity. With up to 6 pitches and 6 strings the
    // direct search above already covers the placeable cases.
  };
  recurse(0);

  if (best === null) return { picks, score: Infinity };
  return best;
}

// Lower is better.
function scoreChord(picks: (FretPosition | undefined)[], prevCenter: number | null): number {
  let score = 0;

  // Penalize unplaced notes heavily.
  //
  // Over the reals this term cannot pick a different candidate. A pick is only
  // ever left undefined by the `opts.length === 0` branch in recurse(), so the
  // set of unplaced pitches is fixed by the pitches and the tuning before the
  // search starts and is the same in every candidate scoreChord sees; a
  // candidate that fails on string collision never reaches the scorer at all.
  // The term is therefore a constant offset per chord.
  //
  // It still changes the output, because the scores are doubles. Adding 1000
  // rounds away the last bits that break an exact tie. Measured: ukulele,
  // maxFret 12, chord [73,74,83] following [68,69,78] — candidates s1f9+s3f7
  // and s3f6+s0f5 both score exactly 53/5, but as doubles they are
  // 10.600000000000001 and 10.6, so the second wins on `score < best.score`.
  // At +1000 both round to 1010.6, the comparison is no longer strict, and the
  // first-enumerated candidate wins instead. 1 of 5,456 inputs across all 8
  // tunings changes its voicing this way.
  //
  // So do not read this as dead weight and do not delete it: it is also the
  // branch a real skip-this-pitch search would need — see the note at the foot
  // of recurse(), which contemplates adding one.
  for (const p of picks) {
    if (!p) score += 1000;
  }

  // Penalize chord stretch (frets spread far apart at the same time).
  const span = chordSpan(picks);
  score += span * span * 1.5;

  // Penalize high frets a little — prefer low positions all else equal.
  for (const p of picks) {
    if (p) score += p.fret * 0.1;
  }

  // Movement from previous hand center.
  const center = chordHandCenter(picks);
  if (center !== null && prevCenter !== null) {
    score += Math.abs(center - prevCenter) * 2;
  }

  return score;
}

export function assignFretboard(
  chordsIn: ChordIn[],
  opts: AssignOptions,
): PlacedChord[] {
  const maxFret = opts.maxFret ?? 22;
  const out: PlacedChord[] = [];
  let prevCenter: number | null = null;

  for (const c of chordsIn) {
    const cand = placeChord(c.pitches, opts.tuning, maxFret, prevCenter);
    const positions: FretPosition[] = [];
    const unplaced: number[] = [];
    for (let i = 0; i < c.pitches.length; i++) {
      const p = cand.picks[i];
      if (p) positions.push(p); else unplaced.push(c.pitches[i]);
    }
    positions.sort((a, b) => a.string - b.string);
    out.push({
      startTick: c.startTick,
      durationTicks: c.durationTicks,
      positions,
      unplaced,
    });
    const c2 = chordHandCenter(cand.picks);
    if (c2 !== null) prevCenter = c2;
  }

  return out;
}
