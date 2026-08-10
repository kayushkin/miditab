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
 * @param {{name?: string, channel?: number, notes?: object[]}[]} tracks
 * @param {{ticksPerQuarter?: number, format?: number}} options
 * @returns {Uint8Array}
 */
export function buildMidi(tracks, options = {}) {
  const ticksPerQuarter = options.ticksPerQuarter ?? 96;
  const format = options.format ?? 1;

  const bytes = [];
  bytes.push(...ascii("MThd"), ...u32(6), ...u16(format), ...u16(tracks.length), ...u16(ticksPerQuarter));

  for (const track of tracks) {
    const body = buildTrackEvents(track);
    bytes.push(...ascii("MTrk"), ...u32(body.length), ...body);
  }
  return new Uint8Array(bytes);
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
