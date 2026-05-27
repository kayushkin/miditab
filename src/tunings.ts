// Tunings are listed in tab-display order: the first entry is the *highest*
// string (top row of the tab — high E in standard guitar tuning), and the last
// entry is the *lowest* string (bottom row).
//
// Adding a new instrument is data-only: pick the open MIDI pitch of each
// string and a 1-char label for each line of tab. The fretboard assignment
// algorithm is agnostic to string count and tuning.

export interface Tuning {
  id: string;
  name: string;
  instrument: string;
  // MIDI pitch of each open string, highest first.
  openPitches: number[];
  // One-letter labels printed at the start of each tab line.
  labels: string[];
}

// Guitar
export const GUITAR_STANDARD: Tuning = {
  id: "guitar-standard",
  name: "Guitar — Standard (EADGBE)",
  instrument: "guitar",
  openPitches: [64, 59, 55, 50, 45, 40], // e B G D A E
  labels: ["e", "B", "G", "D", "A", "E"],
};

export const GUITAR_DROP_D: Tuning = {
  id: "guitar-drop-d",
  name: "Guitar — Drop D (DADGBE)",
  instrument: "guitar",
  openPitches: [64, 59, 55, 50, 45, 38], // e B G D A D
  labels: ["e", "B", "G", "D", "A", "D"],
};

export const GUITAR_DADGAD: Tuning = {
  id: "guitar-dadgad",
  name: "Guitar — DADGAD",
  instrument: "guitar",
  openPitches: [62, 57, 55, 50, 45, 38], // d A G D A D
  labels: ["d", "A", "G", "D", "A", "D"],
};

// Bass
export const BASS_4: Tuning = {
  id: "bass-4",
  name: "Bass — 4-string (EADG)",
  instrument: "bass",
  openPitches: [43, 38, 33, 28], // G D A E (one octave below guitar's E A D G)
  labels: ["G", "D", "A", "E"],
};

export const BASS_5: Tuning = {
  id: "bass-5",
  name: "Bass — 5-string (BEADG)",
  instrument: "bass",
  openPitches: [43, 38, 33, 28, 23], // G D A E B
  labels: ["G", "D", "A", "E", "B"],
};

// Ukulele (standard high-G reentrant — strings ordered top-to-bottom of tab)
export const UKULELE: Tuning = {
  id: "ukulele",
  name: "Ukulele — Standard (GCEA)",
  instrument: "ukulele",
  openPitches: [69, 64, 60, 67], // A E C G (G is highest physically but listed lowest in display by convention)
  labels: ["A", "E", "C", "G"],
};

// Mandolin (GDAE, pairs treated as single strings)
export const MANDOLIN: Tuning = {
  id: "mandolin",
  name: "Mandolin — Standard (GDAE)",
  instrument: "mandolin",
  openPitches: [76, 69, 62, 55], // E A D G (high to low)
  labels: ["E", "A", "D", "G"],
};

// Banjo (5-string open G — drone 5th treated as a normal string)
export const BANJO_5: Tuning = {
  id: "banjo-5",
  name: "Banjo — 5-string Open G (gDGBD)",
  instrument: "banjo",
  openPitches: [62, 59, 55, 50, 67], // D B G D g
  labels: ["D", "B", "G", "D", "g"],
};

export const TUNINGS: Record<string, Tuning> = {
  [GUITAR_STANDARD.id]: GUITAR_STANDARD,
  [GUITAR_DROP_D.id]: GUITAR_DROP_D,
  [GUITAR_DADGAD.id]: GUITAR_DADGAD,
  [BASS_4.id]: BASS_4,
  [BASS_5.id]: BASS_5,
  [UKULELE.id]: UKULELE,
  [MANDOLIN.id]: MANDOLIN,
  [BANJO_5.id]: BANJO_5,
};

export const TUNING_LIST: Tuning[] = [
  GUITAR_STANDARD,
  GUITAR_DROP_D,
  GUITAR_DADGAD,
  BASS_4,
  BASS_5,
  UKULELE,
  MANDOLIN,
  BANJO_5,
];

// Alias for backwards compatibility with v0.1.
export const STANDARD = GUITAR_STANDARD;
