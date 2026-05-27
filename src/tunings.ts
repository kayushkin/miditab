// Tunings are listed in tab-display order: the first entry is the *highest*
// string (top row of the tab — high E in standard tuning), and the last entry
// is the *lowest* string (bottom row — low E).

export interface Tuning {
  name: string;
  // MIDI pitch of each open string, highest first.
  openPitches: number[];
  // One-letter labels printed at the start of each tab line.
  labels: string[];
}

export const STANDARD: Tuning = {
  name: "Standard (EADGBE)",
  openPitches: [64, 59, 55, 50, 45, 40], // high E, B, G, D, A, low E
  labels: ["e", "B", "G", "D", "A", "E"],
};

export const TUNINGS: Record<string, Tuning> = {
  standard: STANDARD,
};
