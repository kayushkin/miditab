// A Standard MIDI File builder for tests.
//
// `test/roundtrip.test.mjs` carries its own hand-rolled builder that emits one
// fixed track. That was enough for a round-trip smoke test and is not enough to
// ask which track `pickDefaultTrack` chooses, which needs several tracks with
// different contents. This builder takes the tracks as data.
//
// Deliberately NOT named `*.test.mjs`: `npm test` globs `test/*.test.mjs`, and a
// helper picked up as a test file is a suite with zero assertions reporting
// green.

function ascii(s) {
  return [...s].map(c => c.charCodeAt(0));
}

function u16(v) {
  return [(v >> 8) & 0xff, v & 0xff];
}

function u32(v) {
  return [(v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

// SMF variable-length quantity: 7 bits per byte, high bit set on every byte
// but the last.
function varlen(value) {
  if (value < 0) throw new Error(`varlen: negative delta ${value}`);
  const bytes = [value & 0x7f];
  let rest = value >>> 7;
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80);
    rest >>>= 7;
  }
  return bytes;
}

/**
 * Build one MTrk chunk body from a track description.
 *
 * @param {{name?: string, channel?: number, notes?: {pitch: number, startTick: number, durationTicks: number, velocity?: number}[]}} track
 */
function buildTrackEvents(track) {
  const channel = track.channel ?? 0;
  const events = [];

  for (const note of track.notes ?? []) {
    const velocity = note.velocity ?? 80;
    events.push({
      tick: note.startTick,
      // Note-on sorts AFTER note-off at the same tick, so a note that ends
      // exactly where the next begins does not close the new one.
      order: 1,
      bytes: [0x90 | channel, note.pitch & 0x7f, velocity & 0x7f],
    });
    events.push({
      tick: note.startTick + note.durationTicks,
      order: 0,
      bytes: [0x80 | channel, note.pitch & 0x7f, 0],
    });
  }

  events.sort((a, b) => a.tick - b.tick || a.order - b.order);

  const out = [];
  if (track.name !== undefined) {
    const nameBytes = ascii(track.name);
    out.push(0, 0xff, 0x03, nameBytes.length, ...nameBytes);
  }

  let previousTick = 0;
  for (const event of events) {
    out.push(...varlen(event.tick - previousTick), ...event.bytes);
    previousTick = event.tick;
  }
  out.push(0, 0xff, 0x2f, 0); // end of track
  return out;
}

/**
 * Build a complete format-1 SMF.
 *
 * `options.division` writes the header's division word literally, for the SMPTE
 * case. It is a separate option rather than a magic `ticksPerQuarter` value
 * because SMPTE is a different encoding of that field, not a tick count: the
 * high bit means the remaining 15 bits are frames-per-second and ticks-per-frame,
 * and reading them as a PPQ is the defect `PM6-smpte-treated-as-ppq` describes.
 *
 * @param {{name?: string, channel?: number, notes?: object[], events?: object[]}[]} tracks
 * @param {{ticksPerQuarter?: number, format?: number, division?: number}} options
 * @returns {Uint8Array}
 */
export function buildMidi(tracks, options = {}) {
  const ticksPerQuarter = options.ticksPerQuarter ?? 96;
  const format = options.format ?? 1;
  const division = options.division ?? ticksPerQuarter;

  const bytes = [];
  bytes.push(...ascii("MThd"), ...u32(6), ...u16(format), ...u16(tracks.length), ...u16(division));

  for (const track of tracks) {
    const body = track.events ? buildRawTrackEvents(track) : buildTrackEvents(track);
    bytes.push(...ascii("MTrk"), ...u32(body.length), ...body);
  }
  return new Uint8Array(bytes);
}

/**
 * Build one MTrk body from events written out byte by byte, in the order given.
 *
 * `buildTrackEvents` above takes notes and derives the byte stream, which is the
 * right shape for "what does this music render as" and the wrong one for asking
 * the parser about its own wire format. Running status is a status byte that is
 * ABSENT, sysex is a payload the parser must not look inside, and a hanging note
 * is a note-off that never arrives — none of those are expressible as a note
 * list, because a note list is the thing they are the encoding of.
 *
 * No sorting and no note pairing: each entry is `{delta, bytes}` and lands in the
 * stream exactly as written. An end-of-track meta event is appended.
 *
 * @param {{name?: string, events: {delta: number, bytes: number[]}[]}} track
 */
function buildRawTrackEvents(track) {
  const out = [];
  if (track.name !== undefined) {
    const nameBytes = ascii(track.name);
    out.push(0, 0xff, 0x03, nameBytes.length, ...nameBytes);
  }
  for (const event of track.events) {
    out.push(...varlen(event.delta), ...event.bytes);
  }
  out.push(0, 0xff, 0x2f, 0); // end of track
  return out;
}

/** Note-on. Velocity 0 is the standard "note off" idiom and is left to the caller. */
export function noteOn(pitch, velocity = 80, channel = 0) {
  return [0x90 | channel, pitch & 0x7f, velocity & 0x7f];
}

/** Note-off proper (0x80), as distinct from a zero-velocity note-on. */
export function noteOff(pitch, channel = 0) {
  return [0x80 | channel, pitch & 0x7f, 0];
}

/** A set-tempo meta event, in microseconds per quarter note. */
export function setTempo(microsecondsPerQuarter) {
  return [
    0xff, 0x51, 0x03,
    (microsecondsPerQuarter >> 16) & 0xff,
    (microsecondsPerQuarter >> 8) & 0xff,
    microsecondsPerQuarter & 0xff,
  ];
}

/** A sysex event: F0, a variable-length payload length, then the payload. */
export function sysex(payload) {
  return [0xf0, ...varlen(payload.length), ...payload];
}

/**
 * One track holding the given pitches as a sequence of separate quarter notes,
 * each far enough apart that `groupChords` keeps them separate.
 */
export function melodyTrack(pitches, { name = "Melody", channel = 0, step = 96 } = {}) {
  return {
    name,
    channel,
    notes: pitches.map((pitch, index) => ({
      pitch,
      startTick: index * step,
      durationTicks: step,
    })),
  };
}
