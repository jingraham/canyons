/**
 * MIDI/MPE Output — WebMIDI integration for external instruments.
 *
 * MPE voice allocation: Lower zone, channels 2-16, round-robin.
 * Oldest voice stolen when full.
 */

export interface MidiDevice {
  id: string;
  name: string;
  output: MIDIOutput;
}

export interface ActiveVoice {
  channel: number;
  note: number;
  stream: string;
  startTime: number;
}

class MidiOutput {
  private midiAccess: MIDIAccess | null = null;
  private output: MIDIOutput | null = null;
  private devices: MidiDevice[] = [];
  private enabled = false;

  // MPE voice allocation state
  private activeVoices: ActiveVoice[] = [];
  private nextChannel = 2; // MPE lower zone starts at channel 2
  private readonly minChannel = 2;
  private readonly maxChannel = 16;

  // MPE config
  bendRange = 48; // ±48 semitones (MPE default)

  // Callbacks
  private onDevicesChanged: ((devices: MidiDevice[]) => void) | null = null;

  /** Initialize WebMIDI */
  async init(): Promise<boolean> {
    if (!navigator.requestMIDIAccess) {
      console.warn('WebMIDI not supported in this browser');
      return false;
    }

    try {
      this.midiAccess = await navigator.requestMIDIAccess({ sysex: false });
      this.updateDevices();

      // Listen for device changes
      this.midiAccess.onstatechange = () => {
        this.updateDevices();
      };

      return true;
    } catch (err) {
      console.error('Failed to initialize WebMIDI:', err);
      return false;
    }
  }

  /** Update the list of available devices */
  private updateDevices(): void {
    if (!this.midiAccess) return;

    this.devices = [];
    for (const output of this.midiAccess.outputs.values()) {
      this.devices.push({
        id: output.id,
        name: output.name || 'Unknown Device',
        output,
      });
    }

    if (this.onDevicesChanged) {
      this.onDevicesChanged(this.devices);
    }
  }

  /** Get available MIDI devices */
  getDevices(): MidiDevice[] {
    return this.devices;
  }

  /** Select a MIDI output device */
  selectDevice(id: string): boolean {
    const device = this.devices.find((d) => d.id === id);
    if (device) {
      this.output = device.output;
      this.enabled = true;
      console.log(`MIDI output: ${device.name}`);
      return true;
    }
    return false;
  }

  /** Select first available device */
  selectFirstDevice(): boolean {
    if (this.devices.length > 0) {
      return this.selectDevice(this.devices[0].id);
    }
    return false;
  }

  /** Disable MIDI output */
  disable(): void {
    this.enabled = false;
    this.allNotesOff();
  }

  /** Enable MIDI output */
  enable(): void {
    this.enabled = true;
  }

  /** Check if MIDI is enabled and ready */
  isReady(): boolean {
    return this.enabled && this.output !== null;
  }

  /** Set callback for device changes */
  setDevicesChangedCallback(cb: (devices: MidiDevice[]) => void): void {
    this.onDevicesChanged = cb;
  }

  // --- Voice Allocation ---

  /** Allocate a channel for a new voice (round-robin, steal oldest) */
  private allocateChannel(stream: string, note: number, time: number): number {
    // Check if we have a free channel
    const usedChannels = new Set(this.activeVoices.map((v) => v.channel));

    for (let ch = this.minChannel; ch <= this.maxChannel; ch++) {
      if (!usedChannels.has(ch)) {
        this.activeVoices.push({ channel: ch, note, stream, startTime: time });
        return ch;
      }
    }

    // All channels used — steal the oldest voice
    this.activeVoices.sort((a, b) => a.startTime - b.startTime);
    const oldest = this.activeVoices.shift()!;

    // Send note off for the stolen voice
    this.sendNoteOff(oldest.channel, oldest.note);

    // Reuse the channel
    this.activeVoices.push({ channel: oldest.channel, note, stream, startTime: time });
    return oldest.channel;
  }

  /** Release a voice */
  private releaseVoice(stream: string, note: number): number | null {
    const idx = this.activeVoices.findIndex(
      (v) => v.stream === stream && v.note === note
    );
    if (idx !== -1) {
      const voice = this.activeVoices[idx];
      this.activeVoices.splice(idx, 1);
      return voice.channel;
    }
    return null;
  }

  /** Find active voice for a stream/note */
  findVoice(stream: string, note: number): ActiveVoice | undefined {
    return this.activeVoices.find((v) => v.stream === stream && v.note === note);
  }

  /** Get all active voices for a stream */
  getStreamVoices(stream: string): ActiveVoice[] {
    return this.activeVoices.filter((v) => v.stream === stream);
  }

  // --- MIDI Message Sending ---

  /** Send raw MIDI message */
  private send(data: number[]): void {
    if (this.output && this.enabled) {
      this.output.send(data);
    }
  }

  /** Send Note On */
  private sendNoteOn(channel: number, note: number, velocity: number): void {
    const vel = Math.max(0, Math.min(127, Math.round(velocity * 127)));
    this.send([0x90 | (channel - 1), note, vel]);
  }

  /** Send Note Off */
  private sendNoteOff(channel: number, note: number): void {
    this.send([0x80 | (channel - 1), note, 0]);
  }

  /** Send Channel Pressure (aftertouch) */
  sendPressure(channel: number, pressure: number): void {
    const val = Math.max(0, Math.min(127, Math.round(pressure * 127)));
    this.send([0xd0 | (channel - 1), val]);
  }

  /** Send CC74 (MPE slide) */
  sendSlide(channel: number, slide: number): void {
    const val = Math.max(0, Math.min(127, Math.round(slide * 127)));
    this.send([0xb0 | (channel - 1), 74, val]);
  }

  /** Send Pitch Bend (14-bit, centered at 8192) */
  sendBend(channel: number, bend: number): void {
    // bend is in semitones, convert to 14-bit centered at 8192
    // Full range is ±bendRange semitones
    const normalized = bend / this.bendRange; // -1 to 1
    const value = Math.max(0, Math.min(16383, Math.round((normalized + 1) * 8191.5)));
    const lsb = value & 0x7f;
    const msb = (value >> 7) & 0x7f;
    this.send([0xe0 | (channel - 1), lsb, msb]);
  }

  // --- High-Level API ---

  /** Note on with voice allocation */
  noteOn(stream: string, note: number, velocity: number, time: number): number {
    const channel = this.allocateChannel(stream, note, time);
    this.sendNoteOn(channel, note, velocity);
    return channel;
  }

  /** Note off with voice release */
  noteOff(stream: string, note: number): void {
    const channel = this.releaseVoice(stream, note);
    if (channel !== null) {
      this.sendNoteOff(channel, note);
    }
  }

  /** Turn off all notes on all channels */
  allNotesOff(): void {
    for (let ch = this.minChannel; ch <= this.maxChannel; ch++) {
      // All Notes Off (CC 123)
      this.send([0xb0 | (ch - 1), 123, 0]);
    }
    this.activeVoices = [];
  }

  /** Send MPE zone configuration (optional, for MPE-aware synths) */
  sendMPEConfig(): void {
    // MCM (MPE Configuration Message) for lower zone
    // Channel 1, CC 79 (MCM), value = number of member channels (15)
    this.send([0xb0, 79, 15]);
  }
}

/** Global MIDI output instance */
export const midi = new MidiOutput();
