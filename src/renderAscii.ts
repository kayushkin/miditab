// Render placed chords into an ASCII guitar tab string.
//
// Layout per line block (one system):
//   e|--0--2--3-----|
//   B|------------3-|
//   G|--------------|
//   D|--------------|
//   A|--------------|
//   E|--------------|
//
// Each chord becomes one column. Multi-digit fret numbers (e.g. "12") use two
// chars; other strings in the same column pad to match. A bar line "|" separates
// measures (one measure = 4 quarter notes by default). Lines wrap when wider
// than `columns` characters.

import type { PlacedChord } from "./assignFretboard.js";
import type { Tuning } from "./tunings.js";

export interface RenderOptions {
  tuning: Tuning;
  ticksPerQuarter: number;
  beatsPerMeasure?: number; // default 4
  columns?: number;         // wrap width including string label + "|", default 80
  separator?: string;       // between chord columns, default "-"
  title?: string;           // optional title line
}

interface Cell {
  // Per-string text, "" if not played this column. The cell rendered width is
  // max(2, longest entry).
  perString: string[];
  isBar: boolean;
}

export function renderAscii(chords: PlacedChord[], opts: RenderOptions): string {
  const tuning = opts.tuning;
  const nStrings = tuning.openPitches.length;
  const beatsPerMeasure = opts.beatsPerMeasure ?? 4;
  const columns = Math.max(40, opts.columns ?? 80);
  const sep = opts.separator ?? "-";
  const ticksPerBeat = opts.ticksPerQuarter > 0 ? opts.ticksPerQuarter : 480;
  const ticksPerMeasure = ticksPerBeat * beatsPerMeasure;

  // Build a flat list of cells, inserting bar lines at measure boundaries.
  const cells: Cell[] = [];
  let nextBarTick = ticksPerMeasure;

  for (const c of chords) {
    while (c.startTick >= nextBarTick && nextBarTick > 0) {
      cells.push({ perString: new Array(nStrings).fill(""), isBar: true });
      nextBarTick += ticksPerMeasure;
    }
    const cell: Cell = { perString: new Array(nStrings).fill(""), isBar: false };
    for (const pos of c.positions) {
      cell.perString[pos.string] = String(pos.fret);
    }
    cells.push(cell);
  }
  // Trailing bar line.
  cells.push({ perString: new Array(nStrings).fill(""), isBar: true });

  // Determine width of each cell.
  const cellWidth = (cell: Cell): number => {
    if (cell.isBar) return 1;
    let w = 1;
    for (const s of cell.perString) if (s.length > w) w = s.length;
    return w;
  };

  // Render a slice of cells into nStrings text lines (no labels yet).
  const renderSlice = (slice: Cell[]): string[] => {
    const lines: string[] = new Array(nStrings).fill("");
    for (const cell of slice) {
      const w = cellWidth(cell);
      for (let s = 0; s < nStrings; s++) {
        if (cell.isBar) {
          lines[s] += "|";
        } else {
          const v = cell.perString[s];
          if (v === "") {
            lines[s] += sep.repeat(w);
          } else {
            lines[s] += v + sep.repeat(w - v.length);
          }
        }
      }
    }
    return lines;
  };

  // Greedy wrap: accumulate cells while the rendered width + label/border fits.
  // Label is e.g. "e|" — 2 chars; we also leave 1 char for trailing "|".
  const labelWidth = 2;
  const reservedTrailingBar = 1;
  const innerBudget = columns - labelWidth - reservedTrailingBar;

  const lineGroups: string[][] = [];
  let curSlice: Cell[] = [];
  let curWidth = 0;
  let lastBarBoundary = -1;

  const flush = () => {
    if (curSlice.length === 0) return;
    // Ensure each block ends on a bar line so wrapping looks musical.
    let end = curSlice.length;
    if (!curSlice[end - 1].isBar && lastBarBoundary >= 0) {
      end = lastBarBoundary + 1;
    }
    const slice = curSlice.slice(0, end);
    lineGroups.push(renderSlice(slice));
    curSlice = curSlice.slice(end);
    curWidth = curSlice.reduce((sum, c) => sum + cellWidth(c), 0);
    lastBarBoundary = -1;
    for (let i = 0; i < curSlice.length; i++) {
      if (curSlice[i].isBar) lastBarBoundary = i;
    }
  };

  for (const cell of cells) {
    const w = cellWidth(cell);
    if (curWidth + w > innerBudget && curSlice.length > 0) {
      flush();
    }
    curSlice.push(cell);
    curWidth += w;
    if (cell.isBar) lastBarBoundary = curSlice.length - 1;
  }
  if (curSlice.length > 0) flush();

  // Stitch line groups together with labels.
  const out: string[] = [];
  if (opts.title) {
    out.push(opts.title);
    out.push("");
  }
  for (let g = 0; g < lineGroups.length; g++) {
    const group = lineGroups[g];
    for (let s = 0; s < nStrings; s++) {
      out.push(`${tuning.labels[s]}|${group[s]}`);
    }
    if (g < lineGroups.length - 1) out.push("");
  }

  return out.join("\n") + "\n";
}
