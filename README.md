# miditab

Convert MIDI files into ASCII tablature (guitar, bass, ukulele, mandolin,
banjo) or MusicXML sheet notation. Zero runtime dependencies, works in the
browser and in Node.

## Install

```bash
npm install miditab
```

## Usage

```ts
import { midiToTab, midiToSheet, TUNINGS } from "miditab";

const bytes = await file.arrayBuffer(); // or any Uint8Array

// ASCII tab (defaults to standard guitar tuning)
const tab = midiToTab(bytes);
console.log(tab.ascii);

// ASCII tab for 4-string bass
const bass = midiToTab(bytes, { tuning: TUNINGS["bass-4"] });

// MusicXML sheet music — feed the string to any MusicXML renderer
// (OpenSheetMusicDisplay, Verovio, MuseScore, …)
const sheet = midiToSheet(bytes);
console.log(sheet.musicXml);
```

## Available tunings

| id | instrument | tuning |
|---|---|---|
| `guitar-standard` | guitar | EADGBE |
| `guitar-drop-d` | guitar | DADGBE |
| `guitar-dadgad` | guitar | DADGAD |
| `bass-4` | bass | EADG |
| `bass-5` | bass | BEADG |
| `ukulele` | ukulele | GCEA |
| `mandolin` | mandolin | GDAE |
| `banjo-5` | banjo | gDGBD (open G) |

Adding more is data-only — see `src/tunings.ts`. The fretboard assignment is
agnostic to string count and tuning.

## API

```ts
parseMidi(bytes)                      // bytes → MidiFile
groupChords(notes)                    // MidiNote[] → ChordIn[]
assignFretboard(chords, { tuning })   // ChordIn[] → PlacedChord[]
renderAscii(placed, { tuning, … })    // PlacedChord[] → string
renderMusicXml(track, { … })          // MidiTrack → MusicXML string

midiToTab(bytes, opts?)               // one-shot: bytes → { ascii, … }
midiToSheet(bytes, opts?)             // one-shot: bytes → { musicXml, … }
```

`midiToTab` options:

| option | default | description |
|---|---|---|
| `trackIndex` | first non-drum track with notes | which MIDI track to convert |
| `tuning` | `GUITAR_STANDARD` | a `Tuning` from `TUNINGS` |
| `maxFret` | `22` | upper fret bound for the assignment search |
| `columns` | `80` | tab line wrap width in characters |
| `beatsPerMeasure` | `4` | beats between bar lines |
| `title` | `"<track> — <tuning>"` | title printed above the tab |

`midiToSheet` options:

| option | default | description |
|---|---|---|
| `trackIndex` | first non-drum track with notes | which MIDI track to convert |
| `divisionUnit` | `16` | quantization grid: 4=quarter, 8=eighth, 16=sixteenth |
| `beatsPerMeasure` | `4` | numerator of the time signature |
| `beatUnit` | `4` | denominator of the time signature |
| `clef` | auto from pitch range | `"treble"` or `"bass"` |
| `title` | track name | work title in the score |
| `partName` | track name | part name in the score |

## Caveats

- Only ticks-per-quarter MIDI division (SMPTE coded files yield best-effort output).
- Drum tracks (channel 10 / index 9) are skipped by the default track picker.
- MusicXML output assumes 4/4 + C major; key/time signatures aren't inferred from MIDI.
- Tab notes that lie outside the fretboard are silently omitted; count is in `unplaceableCount`.
