/**
 * Engine — The core tick loop and audio output.
 *
 * Runs at 500Hz using AudioWorklet for precise timing.
 * Falls back to setInterval at 20Hz if worklet unavailable.
 *
 * Uses OutputSink interface for dependency injection,
 * enabling testing without browser audio APIs.
 */

import type { Stream, StreamState, NoteEvent, NoteCallback, TickCallback, OutputSink, VoiceHandle } from '../core/types';
import { ENGINE_TICK_HZ, ENGINE_FALLBACK_TICK_MS, VIZ_THROTTLE_MS } from '../config';

/** Tracks currently sounding notes with their voice handles */
interface ActiveNote {
  note: number;
  handles: VoiceHandle[];  // One handle per sink that responded
  gateOpen: boolean;
}

// AudioWorklet processor code as a string (inlined for Vite compatibility)
const tickProcessorCode = `
class TickProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samplesSinceTick = 0;
    this.samplesPerTick = Math.round(sampleRate / ${ENGINE_TICK_HZ});
    this.running = false;
    this.startFrame = 0;

    this.port.onmessage = (e) => {
      if (e.data.type === 'start') {
        this.running = true;
        this.startFrame = currentFrame;
        this.samplesSinceTick = 0;
      } else if (e.data.type === 'stop') {
        this.running = false;
      }
    };
  }

  process() {
    if (!this.running) return true;

    this.samplesSinceTick += 128;

    while (this.samplesSinceTick >= this.samplesPerTick) {
      this.samplesSinceTick -= this.samplesPerTick;
      const elapsedFrames = currentFrame - this.startFrame;
      const t = elapsedFrames / sampleRate;
      this.port.postMessage({ type: 'tick', t });
    }

    return true;
  }
}

registerProcessor('tick-processor', TickProcessor);
`;

class Engine {
  private streams = new Map<string, Stream>();
  private running = false;
  private intervalId: number | null = null;
  private audioCtx: AudioContext | null = null;

  // Output sinks (dependency injection)
  private sinks: OutputSink[] = [];

  // AudioWorklet state
  private workletNode: AudioWorkletNode | null = null;
  private workletReady = false;
  private useWorklet = true;

  // Timing: use AudioContext.currentTime as source of truth
  private audioStartTime = 0;
  private timeOffset = 0;
  private lastTickTime = 0;

  // Track active notes per stream for gate handling
  private activeNotes = new Map<string, ActiveNote[]>();

  // Hot reload: track which streams were touched during current eval
  private touchedStreams = new Set<string>();

  // Callbacks
  private onNote: NoteCallback | null = null;
  private onTick: TickCallback | null = null;

  // Throttle visualization updates (60fps max)
  private lastVizUpdate = 0;

  // Accumulate triggers between viz frames
  private pendingTriggers = new Set<string>();

  // Config (exposed for testing)
  readonly tickHz = ENGINE_TICK_HZ;
  readonly fallbackTickMs = ENGINE_FALLBACK_TICK_MS;

  /** Add an output sink */
  addSink(sink: OutputSink): void {
    this.sinks.push(sink);
  }

  /** Remove an output sink */
  removeSink(sink: OutputSink): void {
    const idx = this.sinks.indexOf(sink);
    if (idx !== -1) {
      this.sinks.splice(idx, 1);
    }
  }

  /** Get all sinks */
  getSinks(): OutputSink[] {
    return this.sinks;
  }

  /** Release all handles for active notes in a stream */
  private releaseStreamNotes(name: string): void {
    const activeNotes = this.activeNotes.get(name);
    if (activeNotes) {
      for (const active of activeNotes) {
        for (const handle of active.handles) {
          handle.release();
        }
      }
    }
    this.activeNotes.delete(name);
  }

  /** Begin a hot reload cycle - call before evaluating new code */
  beginHotReload(): void {
    this.touchedStreams.clear();
  }

  /** End a hot reload cycle - removes streams that weren't re-registered */
  endHotReload(): void {
    for (const [name] of this.streams) {
      if (!this.touchedStreams.has(name)) {
        this.releaseStreamNotes(name);
        this.streams.delete(name);
      }
    }
  }

  /** Register a stream (hot reload aware) */
  register(name: string, stream: Stream): void {
    this.touchedStreams.add(name);

    const existing = this.streams.get(name);
    if (existing) {
      // Hot reload: transfer state from old stream to new
      stream.transferStateFrom(existing);
      // Release any currently sounding notes before structural change
      this.releaseStreamNotes(name);
    }

    this.streams.set(name, stream);
  }

  /** Unregister a stream */
  unregister(name: string): void {
    this.streams.delete(name);
  }

  /** Stop and remove a stream */
  stop(name: string): void {
    this.releaseStreamNotes(name);
    this.streams.delete(name);
  }

  /** Stop all streams */
  hush(): void {
    for (const [name] of this.activeNotes) {
      this.releaseStreamNotes(name);
    }
    this.activeNotes.clear();
    this.streams.clear();
  }

  /** Get all registered streams */
  getStreams(): Map<string, Stream> {
    return this.streams;
  }

  /** Set note callback */
  setNoteCallback(cb: NoteCallback): void {
    this.onNote = cb;
  }

  /** Set tick callback (for visualization) */
  setTickCallback(cb: TickCallback): void {
    this.onTick = cb;
  }

  /** Get or create audio context */
  getAudioContext(): AudioContext {
    if (!this.audioCtx) {
      this.audioCtx = new AudioContext();
    }
    return this.audioCtx;
  }

  /** Initialize AudioWorklet */
  private async initWorklet(): Promise<boolean> {
    try {
      const ctx = this.getAudioContext();

      // Create a blob URL from the processor code
      const blob = new Blob([tickProcessorCode], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);

      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);

      this.workletNode = new AudioWorkletNode(ctx, 'tick-processor');
      this.workletNode.connect(ctx.destination); // Must be connected to run

      // Listen for tick messages
      this.workletNode.port.onmessage = (e) => {
        if (e.data.type === 'tick') {
          this.tick(e.data.t);
        }
      };

      this.workletReady = true;
      console.log(`AudioWorklet initialized (${ENGINE_TICK_HZ}Hz tick)`);
      return true;
    } catch (err) {
      console.warn('AudioWorklet not available, falling back to setInterval:', err);
      this.useWorklet = false;
      return false;
    }
  }

  /** Start the engine */
  async start(): Promise<void> {
    if (this.running) return;

    // Ensure audio context is ready
    const ctx = this.getAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    // Initialize worklet if not ready
    if (this.useWorklet && !this.workletReady) {
      await this.initWorklet();
    }

    this.running = true;
    this.audioStartTime = ctx.currentTime;
    this.timeOffset = 0;
    this.lastTickTime = 0;

    // Reset all streams and active notes
    for (const stream of this.streams.values()) {
      stream.reset();
    }
    this.activeNotes.clear();

    // Initialize all sinks with audio context
    for (const sink of this.sinks) {
      if (sink.init) {
        sink.init(ctx);
      }
      sink.allNotesOff();
    }

    if (this.useWorklet && this.workletReady && this.workletNode) {
      // Start the worklet clock
      this.workletNode.port.postMessage({ type: 'start' });
    } else {
      // Fallback to setInterval (use audio time for consistency)
      this.intervalId = window.setInterval(() => {
        if (this.audioCtx) {
          const rawTime = this.audioCtx.currentTime - this.audioStartTime;
          this.tick(rawTime);
        }
      }, this.fallbackTickMs);
    }
  }

  /** Stop the engine */
  shutdown(): void {
    this.running = false;

    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'stop' });
    }

    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    // Send all notes off to all sinks
    for (const sink of this.sinks) {
      sink.allNotesOff();
    }
    this.activeNotes.clear();
  }

  /** Check if engine is running */
  isRunning(): boolean {
    return this.running;
  }

  /** Get current time in seconds (uses AudioContext for consistency) */
  currentTime(): number {
    if (!this.running || !this.audioCtx) return 0;
    return (this.audioCtx.currentTime - this.audioStartTime) + this.timeOffset;
  }

  /** Seek to a specific time in seconds */
  seekTo(targetTime: number): void {
    if (!this.audioCtx) return;

    const elapsed = this.audioCtx.currentTime - this.audioStartTime;
    this.timeOffset = targetTime - elapsed;

    // Immediately process this time for responsive scrubbing
    if (this.running) {
      this.tick(this.lastTickTime);
    }
  }

  /** Main tick function */
  private tick(rawTime: number): void {
    if (!this.running) return;

    this.lastTickTime = rawTime;
    const t = rawTime + this.timeOffset;

    const states = new Map<string, StreamState>();

    for (const [name, stream] of this.streams) {
      const state = stream.tick(t);
      states.set(name, state);

      // Get or create active notes list for this stream
      if (!this.activeNotes.has(name)) {
        this.activeNotes.set(name, []);
      }
      const streamNotes = this.activeNotes.get(name)!;

      if (state.trigger) {
        // Accumulate trigger for viz
        this.pendingTriggers.add(name);

        // Release any currently active notes for this stream before new trigger
        for (const activeNote of streamNotes) {
          for (const handle of activeNote.handles) {
            handle.release();
          }
        }
        streamNotes.length = 0;

        // Handle note trigger
        const notes = Array.isArray(state.note) ? state.note : [state.note];

        for (const note of notes) {
          if (note === null) continue;

          // Send note to all sinks, collect handles
          const handles: VoiceHandle[] = [];
          for (const sink of this.sinks) {
            if (sink.isReady()) {
              const handle = sink.noteOn(name, note, state.velocity, stream.instrument, t);
              if (handle) {
                handles.push(handle);
              }
            }
          }

          // Track active note with its handles
          streamNotes.push({ note, handles, gateOpen: true });

          // Fire callback
          if (this.onNote) {
            this.onNote({
              stream: name,
              note,
              velocity: state.velocity,
              time: t,
            });
          }
        }
      }

      // Handle gate changes for active notes
      for (const activeNote of streamNotes) {
        if (activeNote.gateOpen && !state.gateOpen) {
          // Gate just closed — release all handles
          for (const handle of activeNote.handles) {
            handle.release();
          }
          activeNote.gateOpen = false;
        }
      }

      // Send continuous MPE data for active notes
      if (streamNotes.length > 0) {
        const pressure = stream.getPressure(t, state.phase);
        const slide = stream.getSlide(t, state.phase);
        const bend = stream.getBend(t, state.phase);

        // Update all active voice handles
        for (const activeNote of streamNotes) {
          if (activeNote.gateOpen) {
            for (const handle of activeNote.handles) {
              if (pressure !== 0) handle.setPressure(pressure);
              if (slide !== 0) handle.setSlide(slide);
              if (bend !== 0) handle.setBend(bend);
            }
          }
        }
      }
    }

    // Throttle visualization updates to 60fps
    const now = performance.now();
    if (this.onTick && now - this.lastVizUpdate >= VIZ_THROTTLE_MS) {
      this.lastVizUpdate = now;
      this.onTick(t, states, new Set(this.pendingTriggers));
      this.pendingTriggers.clear();
    }
  }
}

/** Global engine instance */
export const engine = new Engine();

/** Stop a named stream */
export function stop(name: string): void {
  engine.stop(name);
}

/** Stop all streams */
export function hush(): void {
  engine.hush();
}
