# miditab

Convert MIDI files into ASCII guitar tablature. Zero runtime dependencies, works
in the browser and in Node.

## Install

```bash
npm install miditab
```

## Usage

```ts
import { midiToTab } from "miditab";

const bytes = await file.arrayBuffer(); // or any Uint8Array
const result = midiToTab(bytes);
console.log(result.ascii);
```

`midiToTab` accepts an options object:

| option | default | description |
|---|---|---|
| `trackIndex` | first non-drum track with notes | which MIDI track to convert |
| `tuning` | `STANDARD` (EADGBE) | a `Tuning` object — see `src/tunings.ts` |
| `maxFret` | `22` | upper fret bound for the assignment search |
| `columns` | `80` | tab line wrap width in characters |
| `beatsPerMeasure` | `4` | beats between bar lines |
| `title` | `"<track name> — <tuning name>"` | title printed above the tab |

The returned object also exposes the parsed `midi` file and the structured
`placedChords` if you want to render your own visualization, plus an
`unplaceableCount` for notes that fall outside the fretboard.

## API surface

```ts
parseMidi(bytes)                      // bytes → MidiFile
groupChords(notes)                    // MidiNote[] → ChordIn[]
assignFretboard(chords, { tuning })   // ChordIn[] → PlacedChord[]
renderAscii(placed, { tuning, … })    // PlacedChord[] → string
midiToTab(bytes, opts?)               // one-shot: bytes → { ascii, … }
```

## Caveats (v0.1)

- Only ticks-per-quarter MIDI division is supported (SMPTE coded files yield a
  best-effort render without bar lines).
- Notes that lie outside the fretboard (too low or above `maxFret`) are
  silently omitted; the count is returned in `unplaceableCount`.
- Drum tracks (channel 10 / index 9) are skipped by the default track picker.
- No tempo / rhythm rendering — bar lines mark measures by tick count but note
  durations are not drawn as quarter / eighth glyphs.
