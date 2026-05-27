// Minimal Standard MIDI File (SMF) parser. Supports format 0 and 1, ticks-per-quarter
// division. SMPTE division and most meta/sysex events are read past but ignored.

export interface MidiNote {
  pitch: number;       // 0..127, middle C = 60
  startTick: number;
  durationTicks: number;
  velocity: number;    // 1..127
  channel: number;     // 0..15
}

export interface MidiTrack {
  name: string;
  channel: number | null;  // first channel observed in the track, or null
  notes: MidiNote[];
}

export interface MidiFile {
  format: number;          // 0, 1, or 2
  ticksPerQuarter: number; // PPQ; 0 if SMPTE-coded (not supported)
  tempoBPM: number;        // first tempo encountered (default 120)
  tracks: MidiTrack[];
}

class Reader {
  pos = 0;
  constructor(public buf: Uint8Array) {}

  u8(): number {
    if (this.pos >= this.buf.length) throw new Error("midi: read past end");
    return this.buf[this.pos++];
  }
  u16(): number {
    return (this.u8() << 8) | this.u8();
  }
  u32(): number {
    // Avoid sign issues by using unsigned right shift.
    return ((this.u8() << 24) | (this.u8() << 16) | (this.u8() << 8) | this.u8()) >>> 0;
  }
  bytes(n: number): Uint8Array {
    if (this.pos + n > this.buf.length) throw new Error("midi: read past end");
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  ascii(n: number): string {
    const b = this.bytes(n);
    let s = "";
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return s;
  }
  varlen(): number {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const b = this.u8();
      v = (v << 7) | (b & 0x7f);
      if ((b & 0x80) === 0) return v;
    }
    throw new Error("midi: variable-length quantity too long");
  }
}

export function parseMidi(input: Uint8Array | ArrayBuffer): MidiFile {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (buf.length < 14) throw new Error("midi: file too short, missing MThd header");
  const r = new Reader(buf);

  if (r.ascii(4) !== "MThd") throw new Error("midi: missing MThd header");
  const headerLen = r.u32();
  if (headerLen < 6) throw new Error("midi: header too short");
  const format = r.u16();
  const nTracks = r.u16();
  const division = r.u16();
  // Skip any extra header bytes.
  r.pos += headerLen - 6;

  let ticksPerQuarter = 0;
  if ((division & 0x8000) === 0) {
    ticksPerQuarter = division & 0x7fff;
  } else {
    // SMPTE division: not supported for tempo math; leave 0.
    ticksPerQuarter = 0;
  }

  let tempoBPM = 120;
  const tracks: MidiTrack[] = [];

  for (let t = 0; t < nTracks; t++) {
    if (r.ascii(4) !== "MTrk") throw new Error(`midi: missing MTrk for track ${t}`);
    const trackLen = r.u32();
    const trackEnd = r.pos + trackLen;

    const track: MidiTrack = { name: "", channel: null, notes: [] };
    // Active notes keyed by (channel << 8) | pitch
    const active = new Map<number, { startTick: number; velocity: number; channel: number }>();
    let absTick = 0;
    let runningStatus = 0;

    while (r.pos < trackEnd) {
      const delta = r.varlen();
      absTick += delta;

      let status = r.u8();
      if (status < 0x80) {
        // Running status — reuse previous status byte, this byte is data.
        if (runningStatus === 0) throw new Error("midi: running status with no prior status");
        r.pos--;
        status = runningStatus;
      } else if (status < 0xf0) {
        runningStatus = status;
      } // 0xF0..0xFF do not affect running status

      const high = status & 0xf0;
      const channel = status & 0x0f;

      if (status === 0xff) {
        // Meta event
        const type = r.u8();
        const len = r.varlen();
        const data = r.bytes(len);
        if (type === 0x03 && !track.name) {
          // Track name
          track.name = new TextDecoder("utf-8", { fatal: false }).decode(data).trim();
        } else if (type === 0x51 && len === 3 && t === 0 && tempoBPM === 120) {
          // Set tempo: 24-bit microseconds per quarter note.
          const us = (data[0] << 16) | (data[1] << 8) | data[2];
          if (us > 0) tempoBPM = 60_000_000 / us;
        }
        // type 0x2F = end of track; trackEnd will catch it.
      } else if (status === 0xf0 || status === 0xf7) {
        // Sysex
        const len = r.varlen();
        r.bytes(len);
      } else if (high === 0x80 || high === 0x90) {
        // Note off / Note on
        const pitch = r.u8() & 0x7f;
        const velocity = r.u8() & 0x7f;
        if (track.channel === null) track.channel = channel;
        const key = (channel << 8) | pitch;
        const isNoteOn = high === 0x90 && velocity > 0;
        if (isNoteOn) {
          // If the same pitch is already active, close it first.
          const prev = active.get(key);
          if (prev) {
            track.notes.push({
              pitch,
              startTick: prev.startTick,
              durationTicks: Math.max(0, absTick - prev.startTick),
              velocity: prev.velocity,
              channel,
            });
          }
          active.set(key, { startTick: absTick, velocity, channel });
        } else {
          const prev = active.get(key);
          if (prev) {
            track.notes.push({
              pitch,
              startTick: prev.startTick,
              durationTicks: Math.max(0, absTick - prev.startTick),
              velocity: prev.velocity,
              channel,
            });
            active.delete(key);
          }
        }
      } else if (high === 0xa0 || high === 0xb0 || high === 0xe0) {
        // Aftertouch / Controller / Pitch bend — 2 data bytes
        r.u8(); r.u8();
      } else if (high === 0xc0 || high === 0xd0) {
        // Program change / Channel pressure — 1 data byte
        r.u8();
      } else {
        throw new Error(`midi: unknown status byte 0x${status.toString(16)}`);
      }
    }

    // Close any still-active notes at end of track.
    for (const [key, n] of active) {
      track.notes.push({
        pitch: key & 0xff,
        startTick: n.startTick,
        durationTicks: Math.max(0, absTick - n.startTick),
        velocity: n.velocity,
        channel: n.channel,
      });
    }

    track.notes.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
    if (!track.name) track.name = `Track ${t + 1}`;
    tracks.push(track);

    // Defensive: skip to end of declared track length even if events terminated early.
    r.pos = trackEnd;
  }

  return { format, ticksPerQuarter, tempoBPM, tracks };
}
