#!/usr/bin/env python3
"""Write scripts/sabotage-plans/per-mechanism.json, refusing any mutation whose
pattern is not unique in its file.

`sabotage.py` already refuses an absent or ambiguous pattern at apply time, and
that refusal is scored DID-NOT-APPLY -- a wasted build-and-suite run, reported
mid-sweep. Checking the same property here costs nothing and moves the refusal
to the point where the mutation is being written, which is where it can be
fixed. The check is the same question asked earlier, never a second authority:
if these two ever disagree, sabotage.py is right.
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "scripts" / "sabotage-plans" / "per-mechanism.json"

ASCII = "src/renderAscii.ts"
FRET = "src/assignFretboard.ts"
PARSE = "src/parseMidi.ts"
XML = "src/renderMusicXml.ts"


def mutation(identifier, mechanism, describes, path, old, new, expected_unnoticed=None):
    entry = {
        "id": identifier,
        "kind": "per-mechanism",
        "mechanism": mechanism,
        "describes": describes,
        "edits": [{"file": path, "old": old, "new": new}],
    }
    if expected_unnoticed:
        entry["expected_unnoticed"] = expected_unnoticed
    return entry


PLAN = [
    # The same control pair as control-positive-per-file.json. Controls are
    # judged per plan and never pooled, so a plan without its own pair vouches
    # for nothing -- sabotage.py's control_problems() says so directly.
    {
        "id": "CONTROL-POSITIVE",
        "kind": "control",
        "describes": "parseMidi reports zero tracks — the suite must go red, or it never ran",
        "edits": [{
            "file": PARSE,
            "old": "  return { format, ticksPerQuarter, tempoBPM, tracks };",
            "new": "  return { format, ticksPerQuarter, tempoBPM, tracks: [] };",
        }],
    },
    {
        "id": "CONTROL-NEGATIVE",
        "kind": "control",
        "describes": "a comment is reworded — the suite must stay green, or it is red for an unrelated reason",
        "edits": [{
            "file": "src/index.ts",
            "old": "// Public entry point: take MIDI bytes, return ASCII tab and/or MusicXML.",
            "new": "// Public entry point. (CONTROL-NEGATIVE: this edit changes no behaviour.)",
        }],
    },

    # ---------------------------------------------------------------- renderAscii
    mutation(
        "RA1-no-wrapping", "renderAscii/wrapping",
        "lines never wrap, whatever `columns` says",
        ASCII,
        "  const innerBudget = columns - labelWidth - reservedTrailingBar;",
        "  const innerBudget = Number.MAX_SAFE_INTEGER;",
    ),
    mutation(
        "RA2-no-measure-bars", "renderAscii/bar-lines",
        "no bar line is ever inserted at a measure boundary",
        ASCII,
        "  let nextBarTick = ticksPerMeasure;",
        "  let nextBarTick = Number.MAX_SAFE_INTEGER;",
    ),
    mutation(
        "RA3-no-multidigit-padding", "renderAscii/column-width",
        "every column is one char wide, so a two-digit fret pushes its row out of alignment",
        ASCII,
        "    let w = 1;\n    for (const s of cell.perString) if (s.length > w) w = s.length;\n    return w;",
        "    return 1;",
    ),
    mutation(
        "RA4-separator-ignored", "renderAscii/separator-option",
        "opts.separator is ignored and the separator is always '-'",
        ASCII,
        '  const sep = opts.separator ?? "-";',
        '  const sep = "-";',
    ),
    mutation(
        "RA5-title-dropped", "renderAscii/title-block",
        "the title line is emitted blank",
        ASCII,
        "    out.push(opts.title);",
        '    out.push("");',
    ),
    mutation(
        "RA6-beats-per-measure-ignored", "renderAscii/beatsPerMeasure-option",
        "opts.beatsPerMeasure is ignored and every measure is 4 beats",
        ASCII,
        "  const beatsPerMeasure = opts.beatsPerMeasure ?? 4;",
        "  const beatsPerMeasure = 4;",
    ),
    mutation(
        "RA7-smpte-tick-fallback-gone", "renderAscii/zero-ppq-fallback",
        "a SMPTE file (ticksPerQuarter 0) no longer falls back to 480 ticks per beat",
        ASCII,
        "  const ticksPerBeat = opts.ticksPerQuarter > 0 ? opts.ticksPerQuarter : 480;",
        "  const ticksPerBeat = opts.ticksPerQuarter;",
    ),
    mutation(
        "RA8-labels-reversed", "renderAscii/string-label-order",
        "string labels are printed bottom-up against top-down rows",
        ASCII,
        "      out.push(`${tuning.labels[s]}|${group[s]}`);",
        "      out.push(`${tuning.labels[nStrings - 1 - s]}|${group[s]}`);",
    ),

    # ------------------------------------------------------------ assignFretboard
    mutation(
        "AF1-no-span-penalty", "assignFretboard/span-penalty",
        "a chord stretched across the neck costs the same as a compact one",
        FRET,
        "  score += span * span * 1.5;",
        "  score += 0;",
    ),
    mutation(
        "AF2-no-hand-movement-penalty", "assignFretboard/hand-centre-movement",
        "moving the hand up the neck between chords is free",
        FRET,
        "    score += Math.abs(center - prevCenter) * 2;",
        "    score += 0;",
    ),
    mutation(
        "AF3-no-high-fret-tiebreak", "assignFretboard/high-fret-tiebreak",
        "a high position ties with the equivalent low one instead of losing to it",
        FRET,
        "    if (p) score += p.fret * 0.1;",
        "    if (p) score += 0;",
    ),
    mutation(
        "AF4-maxFret-option-ignored", "assignFretboard/maxFret-option",
        "opts.maxFret is ignored and the limit is always 22",
        FRET,
        "  const maxFret = opts.maxFret ?? 22;",
        "  const maxFret = 22;",
    ),
    mutation(
        "AF5-maxFret-not-enforced", "assignFretboard/maxFret-bound",
        "the fret ceiling is not enforced, so a note can be placed past the end of the neck",
        FRET,
        "      if (fret >= 0 && fret <= maxFret) {",
        "      if (fret >= 0) {",
    ),
    mutation(
        "AF6-unplaced-not-penalised", "assignFretboard/unplaced-penalty",
        "leaving a note unplaced costs nothing, so the search stops preferring to place notes",
        FRET,
        "    if (!p) score += 1000;",
        "    if (!p) score += 0;",
        expected_unnoticed=(
            "the penalty is a constant offset within a chord and cannot change the argmin. "
            "A pick is only ever left undefined by the `opts.length === 0` branch, so the set "
            "of unplaced indices is fixed by the pitches and the tuning before the search "
            "starts, and is identical in every candidate scoreChord sees. A candidate that "
            "fails on string collision never reaches scoreChord at all. This declaration "
            "becomes false the moment recurse() grows a real skip-this-pitch branch — the "
            "comment at the foot of recurse() contemplates exactly that, and the scorer will "
            "report STALE-DECLARATION on the next run if it is added. Not left as an "
            "argument: removing the term and diffing assignFretboard's output over 776 "
            "inputs (666 two-note chords spanning the guitar range, 110 two-chord sequences) "
            "changed nothing at all."
        ),
    ),
    mutation(
        "AF7-unplaced-not-reported", "assignFretboard/unplaced-reporting",
        "a pitch that cannot be played is silently dropped instead of reported in `unplaced`",
        FRET,
        "      if (p) positions.push(p); else unplaced.push(c.pitches[i]);",
        "      if (p) positions.push(p);",
    ),
    mutation(
        "AF8-positions-unsorted", "assignFretboard/position-order",
        "positions come back ordered by lowest string first, reversing the tab rows",
        FRET,
        "    positions.sort((a, b) => a.string - b.string);",
        "    positions.sort((a, b) => b.string - a.string);",
    ),
    mutation(
        "AF9-grouping-tolerance-ignored", "assignFretboard/onset-tolerance",
        "the tolerance argument is ignored and only exactly-equal onsets group",
        FRET,
        "    if (n.startTick - cur.startTick <= tolerance) {",
        "    if (n.startTick - cur.startTick <= 0) {",
    ),
    mutation(
        "AF10-chord-duration-not-longest", "assignFretboard/chord-duration",
        "a chord takes the duration of its first note rather than its longest",
        FRET,
        "      cur.durationTicks = Math.max(cur.durationTicks, n.durationTicks);",
        "      cur.durationTicks = cur.durationTicks;",
    ),

    # ----------------------------------------------------------------- parseMidi
    mutation(
        "PM1-running-status-broken", "parseMidi/running-status",
        "a running-status data byte is eaten as a status byte instead of being pushed back",
        PARSE,
        "        r.pos--;\n        status = runningStatus;",
        "        status = runningStatus;",
    ),
    mutation(
        "PM2-sysex-payload-not-skipped", "parseMidi/sysex-skipping",
        "a sysex payload is left in the stream to be misread as events",
        PARSE,
        "        const len = r.varlen();\n        r.bytes(len);",
        "        const len = r.varlen();",
    ),
    mutation(
        "PM3-tempo-ignored", "parseMidi/tempo-meta-event",
        "the 0x51 set-tempo event is read and thrown away, so tempoBPM stays 120",
        PARSE,
        "          if (us > 0) tempoBPM = 60_000_000 / us;",
        "          if (us > 0) tempoBPM = 120;",
    ),
    mutation(
        "PM4-two-byte-events-misread", "parseMidi/two-data-byte-events",
        "aftertouch / controller / pitch-bend consume one data byte instead of two",
        PARSE,
        "        r.u8(); r.u8();",
        "        r.u8();",
    ),
    mutation(
        "PM5-one-byte-events-misread", "parseMidi/one-data-byte-events",
        "program change / channel pressure consume two data bytes instead of one",
        PARSE,
        "        // Program change / Channel pressure — 1 data byte\n        r.u8();",
        "        // Program change / Channel pressure — 1 data byte\n        r.u8(); r.u8();",
    ),
    mutation(
        "PM6-smpte-treated-as-ppq", "parseMidi/smpte-division",
        "an SMPTE division is reported as a tick count instead of 0",
        PARSE,
        "    // SMPTE division: not supported for tempo math; leave 0.\n    ticksPerQuarter = 0;",
        "    // SMPTE division: not supported for tempo math; leave 0.\n    ticksPerQuarter = division & 0x7fff;",
    ),
    mutation(
        "PM7-hanging-notes-dropped", "parseMidi/notes-active-at-end-of-track",
        "a note with no note-off is dropped instead of closed at the end of the track",
        PARSE,
        "    // Close any still-active notes at end of track.\n    for (const [key, n] of active) {",
        "    // Close any still-active notes at end of track.\n    active.clear();\n    for (const [key, n] of active) {",
    ),
    mutation(
        "PM8-retrigger-loses-first-note", "parseMidi/retriggered-pitch",
        "re-sounding a pitch that is already ringing discards the first note",
        PARSE,
        "          const prev = active.get(key);\n          if (prev) {\n            track.notes.push({\n              pitch,\n              startTick: prev.startTick,\n              durationTicks: Math.max(0, absTick - prev.startTick),\n              velocity: prev.velocity,\n              channel,\n            });\n          }\n          active.set(key, { startTick: absTick, velocity, channel });",
        "          active.set(key, { startTick: absTick, velocity, channel });",
    ),
    mutation(
        "PM9-note-order-by-pitch-reversed", "parseMidi/note-ordering",
        "simultaneous notes come back highest pitch first instead of lowest",
        PARSE,
        "    track.notes.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);",
        "    track.notes.sort((a, b) => a.startTick - b.startTick || b.pitch - a.pitch);",
    ),
    mutation(
        "PM10-track-channel-is-last-not-first", "parseMidi/track-channel",
        "track.channel reports the last channel seen rather than the first",
        PARSE,
        "        if (track.channel === null) track.channel = channel;",
        "        track.channel = channel;",
    ),
    mutation(
        "PM11-zero-velocity-note-on-starts-a-note", "parseMidi/zero-velocity-note-on",
        "a note-on with velocity 0 starts a note instead of ending one",
        PARSE,
        "        const isNoteOn = high === 0x90 && velocity > 0;",
        "        const isNoteOn = high === 0x90;",
    ),

    # ------------------------------------------------------------- renderMusicXml
    mutation(
        "MX1-no-dotted-notes", "renderMusicXml/dotted-decomposition",
        "a dotted duration is emitted as two glyphs instead of one dotted glyph",
        XML,
        "      if (g.q % 2 === 0 && remaining >= (g.q * 3) / 2) {",
        "      if (g.q % 2 === 1 && remaining >= (g.q * 3) / 2) {",
    ),
    mutation(
        "MX2-remainder-not-dropped", "renderMusicXml/drop-the-remainder",
        "a sub-sixteenth remainder is emitted as a spurious 16th instead of dropped",
        XML,
        "      // Less than a sixteenth left — drop it (already quantized).\n      break;",
        '      out.push({ type: "16th", dots: 0, divisions: gridUnit });\n      break;',
        expected_unnoticed=(
            "the `!placed` branch is unreachable for every input the renderer can produce. "
            "`units` reaches glyphsForUnits as an integer — quantize() is Math.round, gap and "
            "measure-remainder arithmetic is integer, and chord length is Math.max(1, ...) — "
            "and the glyph table bottoms out at q=1 with every dotted subtraction (24, 12, 6, "
            "3) also an integer, so a non-zero remainder always places a 16th. Reachable only "
            "via a fractional `units`, which needs a caller outside this module. Not left as "
            "an argument: replacing the branch with a throw leaves all 79 tests green, so "
            "nothing the suite renders reaches it."
        ),
    ),
    mutation(
        "MX3-accidentals-dropped", "renderMusicXml/midiToPitch-alter",
        "a sharp is emitted with no <alter>, so F# reads as F",
        XML,
        "            if (info.alter) lines.push(`          <alter>${info.alter}</alter>`);",
        "            if (false) lines.push(`          <alter>${info.alter}</alter>`);",
    ),
    mutation(
        "MX4-octave-off-by-one", "renderMusicXml/midiToPitch-octave",
        "every note is written an octave high",
        XML,
        "  const octave = Math.floor(p / 12) - 1;",
        "  const octave = Math.floor(p / 12);",
    ),
    mutation(
        "MX5-pitch-name-table-corrupt", "renderMusicXml/pitch-name-table",
        "the pitch-class name table names B as H",
        XML,
        'const PITCH_NAMES = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"];',
        'const PITCH_NAMES = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "H"];',
    ),
    mutation(
        "MX6-xml-not-escaped", "renderMusicXml/escXml",
        "a title containing & or < is written into the document unescaped",
        XML,
        '    "&": "&amp;", "<": "&lt;", ">": "&gt;", \'"\': "&quot;", "\'": "&apos;",',
        '    "&": "&", "<": "<", ">": ">", \'"\': \'"\', "\'": "\'",',
    ),
    mutation(
        "MX7-gaps-not-filled-with-rests", "renderMusicXml/rest-filling",
        "a silent gap emits no rest, so later notes slide earlier in the bar",
        XML,
        "    if (s > cursor) {",
        "    if (false && s > cursor) {",
    ),
    mutation(
        "MX8-no-measure-splitting", "renderMusicXml/measure-splitting",
        "a measure holds four bars' worth of music, so nothing is ever split at a bar line",
        XML,
        # NOT `if (remaining <= space || true)`: that compiles the else branch into
        # unreachable code, TypeScript stops narrowing the TimelineEvent union inside
        # it, and the mutation dies as BUILD-FAILED without ever reaching the suite.
        # Widening the measure exercises the same mechanism and compiles.
        "  const measureCapacity = divsPerMeasure / gridUnit; // grid units per measure",
        "  const measureCapacity = (divsPerMeasure * 4) / gridUnit; // grid units per measure",
    ),
    mutation(
        "MX9-clef-always-treble", "renderMusicXml/auto-clef",
        "the automatic clef choice always answers treble",
        XML,
        '  const clef = opts.clef ?? (meanPitch < 57 ? "bass" : "treble");',
        '  const clef = opts.clef ?? "treble";',
    ),
    mutation(
        "MX10-divisions-wrong", "renderMusicXml/divisions-attribute",
        "the <divisions> attribute says 1 while durations are counted in sixteenths",
        XML,
        "      lines.push(`        <divisions>${divsPerQuarter}</divisions>`);",
        "      lines.push(`        <divisions>1</divisions>`);",
    ),
    mutation(
        "MX11-chord-marker-missing", "renderMusicXml/chord-marker",
        "the second note of a chord loses its <chord/>, so it reads as a separate beat",
        XML,
        "            if (pi > 0) lines.push('        <chord/>');",
        "            if (pi > 1) lines.push('        <chord/>');",
    ),
    mutation(
        "MX12-final-measure-not-padded", "renderMusicXml/final-measure-padding",
        "a short final measure is left short instead of padded with a rest",
        XML,
        "  if (measureUnits > 0 && measureUnits < measureCapacity) {",
        "  if (false && measureUnits > 0 && measureUnits < measureCapacity) {",
    ),
    mutation(
        "MX13-zero-length-notes-kept", "renderMusicXml/zero-duration-notes",
        "a zero-length note is laid out instead of skipped",
        XML,
        "    if (n.durationTicks <= 0) continue;",
        "    if (n.durationTicks < 0) continue;",
    ),
    mutation(
        "MX14-time-signature-hardcoded", "renderMusicXml/time-signature",
        "the time signature is always 4/4 whatever the caller asked for",
        XML,
        "      lines.push(`        <time><beats>${beatsPerMeasure}</beats><beat-type>${beatUnit}</beat-type></time>`);",
        "      lines.push(`        <time><beats>4</beats><beat-type>4</beat-type></time>`);",
    ),
]


def main():
    sources = {}
    problems = []
    for entry in PLAN:
        for edit in entry["edits"]:
            text = sources.setdefault(edit["file"], (ROOT / edit["file"]).read_text())
            occurrences = text.count(edit["old"])
            if occurrences != 1:
                problems.append(
                    f"{entry['id']}: pattern occurs {occurrences} times in "
                    f"{edit['file']}, need exactly 1: {edit['old'][:80]!r}"
                )
    identifiers = [entry["id"] for entry in PLAN]
    for identifier in sorted(set(identifiers)):
        if identifiers.count(identifier) != 1:
            problems.append(f"{identifier}: id used {identifiers.count(identifier)} times")

    for line in problems:
        print(f"REFUSED: {line}")
    if problems:
        return 1

    OUT.write_text(json.dumps(PLAN, indent=2) + "\n")
    real = [e for e in PLAN if e["kind"] != "control"]
    mechanisms = sorted({e["mechanism"] for e in real})
    print(f"wrote {OUT.relative_to(ROOT)}: {len(real)} mutations over "
          f"{len(mechanisms)} mechanisms in {len(sources)} files, every pattern unique")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
