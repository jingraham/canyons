# canyons

**A sequencer for continuous expression and composition**

*Version 0.3 — December 2024*

---

## Executive Summary

canyons is a browser-based live coding environment for music that inverts the traditional relationship between discrete notes and continuous expression. Where existing systems treat patterns as primary and bolt continuous dynamics on afterward, canyons treats **continuous signals as the fundamental primitive**—notes, rhythms, and discrete events emerge from continuous envelopes, not the other way around.

The guiding metaphor: **music programming should feel like shaders for time.**

In a shader, you define `color = f(x, y, t)` and the runtime evaluates it for every pixel. In canyons, you define `expression = f(t)` and the runtime evaluates it continuously, with discrete note events emerging when playheads cross boundaries within that continuous space.

---

## Part 1: Vision and Philosophy

### 1.1 The Problem

The live coding landscape in 2025 is divided:

**Pattern-first systems** (TidalCycles, Strudel, Sonic Pi, FoxDot) excel at rhythmic complexity and algorithmic composition. A polyrhythmic drum pattern can be expressed in a single line. But continuous expression—the crescendo of Boléro, the rubato of Satie, the per-note pressure of an MPE cello—must be discretized and bolted on. The pattern structures time; continuous modulation is subordinate.

**Signal-first systems** (Faust, SuperCollider, Max/MSP) treat continuous signals as native. A 15-minute envelope is trivial: `Line.kr(0, 1, 900)`. But they lack the conciseness that makes pattern languages powerful. Expressing "generative Philip Glass with flowing dynamics" requires 50+ lines of boilerplate.

**The gap:** No system makes continuous expression as effortless as TidalCycles makes polyrhythms.

### 1.2 The Inversion

canyons proposes a structural inversion:

| Traditional | canyons |
|-------------|---------|
| Pattern is primary | Terrain is primary |
| Notes exist on a timeline | Notes exist *within* a terrain |
| Expression modulates the pattern | Content lives inside expression |
| Time is a clock you read | Time (`t`) is a signal you modulate |

**Concrete example — Boléro:**

In TidalCycles, a 15-minute crescendo requires `slow 900` on a pattern—the pattern still structures time, awkwardly stretched to accommodate the dynamics.

In canyons:

```javascript
// The crescendo IS the terrain—notes live within it
within(ramp(0, 1, 15 * 60), {
  rhythm: [hit, rest, rest, hit, rest, rest, hit, rest, rest, hit, hit, hit],
  tempo: 72,
  out: mpe('snare')
})
```

The crescendo is not a modifier—it is the terrain. Everything else lives within it.

### 1.3 Design Principles

1. **Continuous signals are primitive.** A signal is a function of time. Composition is function composition. No special cases.

2. **Time is a signal.** Tempo, rubato, and metric structure are continuous functions that can be composed, warped, and modulated like any other signal.

3. **Discrete events emerge from continuous crossings.** A note triggers when a playhead signal crosses an integer boundary. The continuous envelope *generates* the discrete timing.

4. **MPE is native.** Per-note expression (pitch bend, pressure, slide) is not an afterthought—it's the point. Every voice carries continuous control streams throughout its lifetime.

5. **Hot reload preserves state.** Code changes do not restart the music. The system diffs the signal graph and preserves phase, envelope position, and voice state where possible.

6. **What you see is what you hear.** Visualization and playback derive from the same declarative graph. They are deterministic and identical.

---

## Part 2: Core Concepts

### 2.1 Signals

A **Signal** is a function from time to a value:

```typescript
type Signal<T> = (t: number) => T
```

Signals are the universal primitive. Everything in canyons is either a signal or can be lifted into one:

- A constant `0.5` is a signal that always returns `0.5`
- A sine wave `sine(2)` is a signal returning `sin(2πt)`
- A pattern `[60, 64, 67]` is a step-function signal
- A note sequence is a signal of voice configurations

Signals compose through standard operations:

```typescript
// Arithmetic
const sum = add(a, b)        // (t) => a(t) + b(t)
const scaled = scale(a, 2)   // (t) => a(t) * 2

// Transformation
const shifted = shift(a, 1)  // (t) => a(t - 1)
const warped = warp(a, w)    // (t) => a(w(t))

// Combination
const mixed = mix(a, b, 0.3) // (t) => lerp(a(t), b(t), 0.3)
```

### 2.2 Time and TimeWarps

canyons distinguishes two time axes:

**Wall Time (`t_wall`)**: Real elapsed seconds since playback started. Monotonically increasing. Driven by the audio context clock.

**Musical Time (`t_music`)**: Position in the musical structure. Can speed up, slow down, or even reverse. Derived from wall time via a TimeWarp.

A **TimeWarp** is a `Signal<number>` that maps wall time to musical time:

```typescript
type TimeWarp = Signal<number>

// Constant tempo: 120 BPM = 2 beats per second
const steady: TimeWarp = (t) => t * 2

// Rubato: tempo oscillates ±10%
const rubato: TimeWarp = integrate((t) => 2 * (1 + 0.1 * Math.sin(t * 0.5)))
```

When you "slow down the music," you're modulating the slope of the TimeWarp. When you "reverse time," you invert it. The scheduler doesn't reschedule events—the time signal itself changes shape.

### 2.3 Patterns and Playheads

A **Pattern** is an indexed sequence of values:

```typescript
type Pattern<T> = {
  at: (index: number) => T
  length: number | typeof Infinity
}
```

Patterns are not inherently temporal. They become temporal when driven by a **Playhead**—a continuous signal that indexes into the pattern:

```typescript
const drive = <T>(pattern: Pattern<T>, playhead: Signal<number>): Signal<T> =>
  (t) => pattern.at(Math.floor(playhead(t)))
```

**Key insight:** The playhead is continuous; the pattern output is discrete. Discrete events emerge when the playhead crosses integer boundaries:

```
Playhead: 0.0 → 0.5 → 1.0 → 1.5 → 2.0 → ...
                      ↑           ↑
                   trigger     trigger
```

This is how rubato works naturally. A slowing tempo means the playhead advances more slowly, so triggers occur less frequently—without any rescheduling.

### 2.4 Voices and MPE

A **Voice** is a temporary signal subgraph representing a sounding note:

```typescript
type Voice = {
  id: number
  channel: number              // MPE channel (2-16)

  // Continuous control inputs (remain exposed during note lifetime)
  pitch: Signal<number>        // MIDI note + pitch bend
  pressure: Signal<number>     // Channel pressure (0-1)
  slide: Signal<number>        // CC74 / timbre (0-1)

  // Lifecycle
  gate: Signal<boolean>        // true while note is active
  onset: number                // wall time when note started
}
```

Voices are allocated when a note triggers and deallocated when the note ends. During the voice's lifetime, its control inputs can be modulated by external signals—this is how per-note expression works.

**MPE output:** Each voice maps to an MPE channel. The engine continuously evaluates the voice's control signals and emits MIDI messages:

| Voice property | MIDI output |
|----------------|-------------|
| `pitch` (integer part) | Note On (channel N) |
| `pitch` (fractional part) | Pitch Bend (channel N) |
| `pressure` | Channel Pressure (channel N) |
| `slide` | CC74 (channel N) |

### 2.5 The Signal Graph

A canyons program constructs a **Signal Graph**—a directed acyclic graph of signal nodes:

```
┌─────────────┐     ┌─────────────┐
│  sine(0.1)  │────▶│   scale     │────▶ dynamics
└─────────────┘     │   (0.3-0.9) │
                    └─────────────┘

┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  bpm(120)   │────▶│  integrate  │────▶│   drive     │────▶ melody
└─────────────┘     └─────────────┘     │  (pattern)  │
                                        └─────────────┘
```

The graph is:
- **Declarative:** User code describes the structure, not the execution order
- **Diffable:** Hot reload compares old and new graphs
- **Serializable:** Can be shipped to workers, saved, exported

---

## Part 3: Architecture

### 3.1 System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Main Thread                                │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────────┐ │
│  │    Editor    │  │ Visualizer   │  │    Graph Constructor       │ │
│  │   (Monaco)   │  │   (Canvas)   │  │  (TS API → Signal Graph)   │ │
│  └──────────────┘  └──────────────┘  └────────────────────────────┘ │
│                                              │                       │
│                                              │ Serialized IR         │
│                                              ▼                       │
│                            ┌─────────────────────────────────┐      │
│                            │      MIDI Output Queue          │      │
│                            │   (WebMIDI with timestamps)     │      │
│                            └─────────────────────────────────┘      │
└────────────────────────────────────┬────────────────────────────────┘
                                     │ SharedArrayBuffer
                                     │ (Ring Buffer)
┌────────────────────────────────────┼────────────────────────────────┐
│                           Audio Thread                               │
│                      (AudioWorklet + WASM)                          │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                    Signal Evaluator (Rust/WASM)                 ││
│  │  • Evaluates signal graph at control rate (250-1000 Hz)         ││
│  │  • Manages voice allocation and channel assignment              ││
│  │  • Detects playhead crossings (note triggers)                   ││
│  │  • Writes MIDI messages to output ring buffer                   ││
│  │  • Generates audio samples for internal synths                  ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 The Signal Evaluator (Rust/WASM)

The signal evaluator is the heart of the system. It runs in an AudioWorklet to guarantee timing stability, compiled from Rust to WASM for GC-free execution.

**Core responsibilities:**

1. **Signal evaluation:** Traverse the signal graph and compute current values at control rate
2. **Integration:** Maintain accumulators for `integrate()` operations (tempo → playhead)
3. **Trigger detection:** Identify when playheads cross integer boundaries
4. **Voice management:** Allocate/deallocate voices, assign MPE channels
5. **MIDI generation:** Convert voice state to timestamped MIDI messages
6. **Audio synthesis:** Generate samples for internal synth voices

**Memory layout:**

```rust
struct EngineState {
    // Graph representation (updated on hot reload)
    nodes: Vec<SignalNode>,
    edges: Vec<Edge>,

    // Evaluation cache (per control-rate tick)
    values: Vec<f64>,

    // Integration state (persists across ticks)
    integrators: Vec<Integrator>,

    // Voice state
    voices: [Voice; 16],  // MPE channels 2-16 + master
    voice_allocator: ChannelAllocator,

    // Output buffers
    midi_out: RingBuffer<MidiMessage>,
    audio_out: RingBuffer<f32>,
}
```

#### Integration Precision for Long Durations

For Boléro (15 minutes = 900 seconds at 500 Hz control rate), a naive accumulator performs 450,000 additions. Floating-point error accumulates and can cause audible drift.

**Solution: Kahan summation** (compensated summation) maintains precision:

```rust
struct Integrator {
    sum: f64,
    compensation: f64,  // running compensation for lost low-order bits
}

impl Integrator {
    fn add(&mut self, rate: f64, dt: f64) -> f64 {
        let y = rate * dt - self.compensation;
        let t = self.sum + y;
        self.compensation = (t - self.sum) - y;
        self.sum = t;
        self.sum
    }
}
```

**Precision guarantee:** With Kahan summation, error grows as O(1) instead of O(n), meaning a 15-minute piece has roughly the same precision as a 15-second piece.

**Testing:** The Boléro validation should verify that after 15 minutes:
- Playhead drift is <1ms from expected position
- Crescendo value is within 0.001 of target

### 3.3 The Intermediate Representation

User code (TypeScript API) compiles to a serializable IR that can be shipped to the audio thread.

#### Design Principle: Keep Rust Dumb

The IR should contain only **primitive operations**—math, memory access, and control flow. All musical concepts (patterns, scales, Euclidean rhythms, chord voicings) live in the TypeScript compiler that emits these primitives.

**Why?** If `pattern` or `euclidean` are opcodes in the Rust engine, adding new musical features requires recompiling WASM. By keeping Rust dumb:

- Musical feature iteration happens in TypeScript (fast, no compile step)
- The Rust core stays small and auditable
- TypeScript handles the "fun" part (musical DSL)
- Rust handles the "hard" part (timing, memory, threads)

#### Primitive Opcodes

```typescript
type SignalIR =
  // === Constants and Time ===
  | { op: 'const', value: number }
  | { op: 'time' }                    // current musical time
  | { op: 'wall_time' }               // current wall clock time

  // === Arithmetic ===
  | { op: 'add', a: SignalIR, b: SignalIR }
  | { op: 'sub', a: SignalIR, b: SignalIR }
  | { op: 'mul', a: SignalIR, b: SignalIR }
  | { op: 'div', a: SignalIR, b: SignalIR }
  | { op: 'mod', a: SignalIR, b: SignalIR }
  | { op: 'neg', a: SignalIR }
  | { op: 'abs', a: SignalIR }

  // === Transcendental ===
  | { op: 'sin', a: SignalIR }
  | { op: 'cos', a: SignalIR }
  | { op: 'exp', a: SignalIR }
  | { op: 'log', a: SignalIR }
  | { op: 'pow', a: SignalIR, b: SignalIR }

  // === Comparison and Control ===
  | { op: 'gt', a: SignalIR, b: SignalIR }   // returns 1.0 or 0.0
  | { op: 'lt', a: SignalIR, b: SignalIR }
  | { op: 'eq', a: SignalIR, b: SignalIR }
  | { op: 'select', cond: SignalIR, a: SignalIR, b: SignalIR }  // ternary

  // === Memory ===
  | { op: 'lookup', table_id: number, index: SignalIR }  // table[floor(index)]
  | { op: 'sample', signal: SignalIR, at: SignalIR }     // evaluate signal at different time

  // === State (requires id for persistence) ===
  | { op: 'integrate', rate: SignalIR, id: number }
  | { op: 'delay', signal: SignalIR, time: number, id: number }
  | { op: 'latch', signal: SignalIR, trigger: SignalIR, id: number }  // sample-and-hold

  // === Voice Access ===
  | { op: 'voice_property', voice_id: number, property: 'pitch' | 'pressure' | 'slide' | 'gate' }
  | { op: 'voice_progress', voice_id: number }  // 0-1 progress through note duration
```

#### How Musical Concepts Compile

The TypeScript API provides high-level musical abstractions that compile down to primitives:

```typescript
// User writes:
const melody = pattern([60, 64, 67]).at(bpm(120))

// Compiles to IR:
{
  op: 'lookup',
  table_id: 0,  // table 0 contains [60, 64, 67]
  index: {
    op: 'mod',
    a: { op: 'integrate', rate: { op: 'const', value: 2.0 }, id: 0 },  // 120 BPM = 2 beats/sec
    b: { op: 'const', value: 3 }  // pattern length
  }
}
```

This means:
- `pattern([60, 64, 67])` becomes a lookup table + `mod` for wrapping
- `bpm(120)` becomes `integrate(const(2.0))`
- Euclidean rhythms compile to precomputed tables
- Scales compile to pitch lookup tables

**Why an IR instead of shipping functions?**

1. **Serializable:** Can cross thread boundaries via `postMessage`
2. **Diffable:** Hot reload can compare old and new graphs structurally
3. **Optimizable:** Rust evaluator can JIT-compile hot paths
4. **Inspectable:** Visualization can traverse the same structure
5. **Extensible:** New musical concepts require only TypeScript changes

### 3.4 Communication: SharedArrayBuffer Ring Buffers

Main thread and audio thread communicate via lock-free ring buffers over SharedArrayBuffer:

**Control → Audio (IR updates):**
```typescript
// When user code changes
const newIR = compile(userCode)
const serialized = serialize(newIR)
controlToAudioBuffer.write(serialized)
```

**Audio → Main (MIDI output):**
```typescript
// In main thread render loop
while (audioToMainBuffer.available() > 0) {
  const msg = audioToMainBuffer.read()
  midiOutput.send(msg.bytes, msg.timestamp)
}
```

**Audio → Main (Visualization state):**
```typescript
// Periodic snapshot for UI
struct VisualizationState {
  wall_time: f64,
  musical_time: f64,
  playhead_positions: [f64; MAX_PLAYHEADS],
  voice_states: [VoiceSnapshot; 16],
  signal_samples: [f64; SAMPLE_BUFFER_SIZE],
}
```

### 3.5 MIDI Scheduling with Lookahead

WebMIDI's `send(bytes, timestamp)` accepts a DOMHighResTimeStamp. To achieve tight timing:

1. **Evaluate ahead:** Signal evaluator runs 25-50ms ahead of current time
2. **Detect triggers:** When playhead crosses an integer, record the crossing time
3. **Queue messages:** Write MIDI messages with precise timestamps to ring buffer
4. **Send in batches:** Main thread pulls from buffer and sends via WebMIDI

```rust
fn evaluate_tick(&mut self, wall_time: f64, lookahead: f64) {
    let schedule_until = wall_time + lookahead;

    while self.next_eval_time < schedule_until {
        // Evaluate all signals at this time point
        self.evaluate_graph(self.next_eval_time);

        // Check for playhead crossings
        for (i, playhead) in self.playheads.iter().enumerate() {
            let prev = self.prev_playhead_values[i];
            let curr = self.values[playhead.node_id];

            if prev.floor() != curr.floor() {
                // Trigger! Calculate exact crossing time via interpolation
                let crossing_time = interpolate_crossing(prev, curr, self.prev_eval_time, self.next_eval_time);
                self.emit_note_trigger(i, crossing_time);
            }

            self.prev_playhead_values[i] = curr;
        }

        // Advance
        self.prev_eval_time = self.next_eval_time;
        self.next_eval_time += 1.0 / CONTROL_RATE;
    }
}
```

### 3.6 Hot Reload via Graph Diffing

When user code changes, the system:

1. **Compile** new code to IR
2. **Diff** new IR against current IR
3. **Patch** the running graph:
   - **Unchanged nodes:** Keep current state (integrator values, phase)
   - **Changed parameters:** Update in place (e.g., frequency change)
   - **Structural changes:** Crossfade over ~50ms to avoid clicks
   - **New nodes:** Initialize fresh
   - **Removed nodes:** Deallocate after fade-out

**State preservation keys:**

Each stateful node (integrators, voices) has a stable identity based on its structural position in the graph. If the user changes `sine(2)` to `sine(3)`, the node identity is preserved and only the frequency updates—phase continues from its current position.

```typescript
// Identity based on path in graph, not memory address
type NodeIdentity = string  // e.g., "root.dynamics.integrator.0"

// State that persists across hot reloads
type PersistedState = Map<NodeIdentity, {
  integrator_value?: number
  phase?: number
  voice_state?: VoiceState
}>
```

### 3.7 Voice Lifecycle Policy

Playhead-driven triggering has edge cases that require explicit policy decisions.

#### The Problem: Non-Monotonic Time

When a TimeWarp includes rubato or oscillation, the playhead may cross the same boundary multiple times:

```
playhead: 3.8 → 4.2 → 3.9 → 4.1 → 4.3
                ↑         ↑     ↑
            trigger?  trigger? trigger?
```

Without explicit policy, this could trigger three note-ons for one musical event.

#### Crossing Direction Policy

| Policy | Forward crossing (N-1 → N) | Backward crossing (N → N-1) | Use case |
|--------|---------------------------|----------------------------|----------|
| **Monotonic (default)** | Note On | Ignored | Standard music playback |
| **Bidirectional** | Note On | Note Off | Tape-stop effects, scratching |
| **Schmitt trigger** | Note On (with hysteresis) | Ignored | Oscillating rubato |

**Default: Monotonic.** Backward crossings are ignored. This matches musical intuition—rubato slows down and speeds up, but time doesn't run backward.

```typescript
// Trigger detection with monotonic policy
fn detect_trigger(prev: f64, curr: f64) -> Option<Trigger> {
    let prev_index = prev.floor() as i64;
    let curr_index = curr.floor() as i64;

    if curr_index > prev_index {
        // Forward crossing: trigger
        Some(Trigger::NoteOn { index: curr_index })
    } else {
        // Backward or same: no trigger
        None
    }
}
```

**Opt-in: Schmitt trigger.** For extreme rubato where the playhead oscillates near boundaries, require crossing by a threshold before re-triggering:

```typescript
// Schmitt trigger with 0.1 beat hysteresis
const playhead = integrate(tempo).schmitt(0.1)
```

This prevents retriggering when the playhead hovers around an integer boundary.

#### Voice Allocation Policy

When a trigger occurs, a voice must be allocated:

| Policy | Behavior | When to use |
|--------|----------|-------------|
| **Round-robin (default)** | Cycle through channels 2-16 | General polyphony |
| **Oldest-steal** | Steal the oldest active voice | Dense passages, limited channels |
| **Newest-reject** | Reject if all channels busy | Preserve existing notes |
| **Same-pitch-reuse** | Reuse voice if same pitch | Legato passages |

**Default: Round-robin with oldest-steal fallback.** Channels 2-16 are assigned in order. If all 15 are busy, steal the oldest voice.

```rust
struct VoiceAllocator {
    next_channel: u8,  // 2-16, wrapping
    voices: [Option<Voice>; 15],
}

impl VoiceAllocator {
    fn allocate(&mut self, note: Note) -> u8 {
        // Try round-robin first
        for _ in 0..15 {
            let channel = self.next_channel;
            self.next_channel = if self.next_channel >= 16 { 2 } else { self.next_channel + 1 };

            if self.voices[(channel - 2) as usize].is_none() {
                self.voices[(channel - 2) as usize] = Some(Voice::new(note, channel));
                return channel;
            }
        }

        // All busy: steal oldest
        let oldest = self.find_oldest_voice();
        self.release(oldest);
        self.allocate(note)  // recurse, now there's space
    }
}
```

#### Voice Release Policy

Voices are released when:

1. **Gate signal falls:** The `gate` signal for this voice becomes false
2. **Duration expires:** If note has explicit duration, release after that time
3. **Stolen:** Another note steals this channel (triggers Note Off first)
4. **Pattern ends:** For non-looping patterns, release when pattern completes

**Note Off timing:** Note Off is sent immediately when release is triggered. For MPE instruments that expect release velocity, send velocity 64 (neutral).

#### Fast Tempo / Slow Control Rate

If tempo is fast enough that multiple integers are crossed between control ticks:

```
Control rate: 250 Hz (4ms between ticks)
Tempo: 600 BPM = 10 beats/second = 0.04 beats per tick
At extreme tempo: could skip integers
```

**Solution:** Check `floor(prev) < floor(curr)`, not equality. If multiple integers were crossed, trigger all of them with interpolated timestamps:

```rust
fn detect_triggers(prev: f64, curr: f64, prev_time: f64, curr_time: f64) -> Vec<Trigger> {
    let mut triggers = vec![];
    let prev_index = prev.floor() as i64;
    let curr_index = curr.floor() as i64;

    for index in (prev_index + 1)..=curr_index {
        // Interpolate exact crossing time
        let fraction = (index as f64 - prev) / (curr - prev);
        let trigger_time = prev_time + fraction * (curr_time - prev_time);
        triggers.push(Trigger { index, time: trigger_time });
    }

    triggers
}
```

### 3.8 Timing Targets and Control Rate

#### Default Configuration

| Parameter | Default | Range | Notes |
|-----------|---------|-------|-------|
| **Control rate** | 500 Hz | 250-1000 Hz | Signals evaluated this often |
| **Lookahead** | 50 ms | 25-100 ms | How far ahead to schedule MIDI |
| **Jitter budget** | <2 ms | — | Target for note timing accuracy |
| **Audio buffer** | 256 samples | 128-1024 | ~5.8ms at 44.1kHz |

#### Jitter Budget

**Target: <2ms end-to-end jitter under normal load.**

This means that if you schedule a note for time T, it should arrive at the MIDI output within T ± 1ms. Achieving this requires:

1. **AudioWorklet isolation:** Signal evaluation runs in the audio thread, not main thread
2. **Lookahead scheduling:** Evaluate 50ms ahead so WebMIDI has time to schedule precisely
3. **No allocations in hot path:** Rust/WASM with pre-allocated buffers
4. **Bounded work per tick:** Graph evaluation must complete in <1ms

**Stress target: <5ms jitter with 16 voices, complex graph, visualization active.**

#### Graceful Degradation

Under heavy load, the system should:

1. **Reduce control rate** (500 → 250 Hz) before dropping notes
2. **Increase lookahead** if scheduling is falling behind
3. **Log warnings** when jitter exceeds targets
4. **Never drop notes silently** — prefer late notes to missing notes

```rust
// Adaptive control rate
if tick_duration > 1.5 / control_rate {
    control_rate = (control_rate * 0.9).max(250.0);
    warn!("Reducing control rate to {} Hz", control_rate);
}
```

---

## Part 4: API Design

### 4.1 Design Philosophy: Proxy-Based IR Construction

canyons uses **proxy-based IR construction**: mathematical expressions with signals build IR nodes immediately, not deferred functions. This solves the fundamental tension between "shader-like expressions" and "serializable IR."

**The Problem:** Arrow functions are not serializable. If `sin(t * 0.1)` returns a function, it cannot cross thread boundaries.

**The Solution:** `t` is a Proxy that, when you perform arithmetic on it, constructs IR nodes:

```typescript
// t is not a number—it's a Proxy
const t = createTimeProxy()

// This expression builds IR immediately
const vibrato = sin(t * 440) * 0.1

// vibrato is now an IR node:
// { op: 'mul',
//   a: { op: 'sin', a: { op: 'mul', a: { op: 'time' }, b: { op: 'const', value: 440 } } },
//   b: { op: 'const', value: 0.1 } }
```

**Why this works:**

1. **Feels like math:** `sin(t * 0.1)` looks like a shader, reads like a formula
2. **Serializable:** The result is a plain object that can be `postMessage`d
3. **Inspectable:** You can log the IR, visualize the graph, diff it for hot reload
4. **Composable:** Expressions nest naturally: `sin(t * 0.1) + cos(t * 0.2)`

**The Proxy implementation:**

```typescript
function createTimeProxy(): SignalProxy {
  const ir: SignalIR = { op: 'time' }

  return new Proxy({} as any, {
    get(target, prop) {
      // Math operations build new IR nodes
      if (prop === Symbol.toPrimitive) {
        throw new Error('Cannot convert signal to primitive—did you mean to use it in a signal expression?')
      }
      return ir
    }
  })
}

// Overloaded math functions that work with both numbers and IR nodes
function sin(x: number | SignalIR): SignalIR {
  if (typeof x === 'number') return { op: 'sin', a: { op: 'const', value: x } }
  return { op: 'sin', a: x }
}

// Operator overloading via valueOf/Symbol.toPrimitive
// (JavaScript can't truly overload +, but we can make it work with method calls)
```

**Practical limitation:** JavaScript cannot truly overload `+` and `*`. The API provides both:

```typescript
// Method chaining (works everywhere)
t.mul(0.1).sin()

// Function composition (reads more naturally)
sin(mul(t, 0.1))

// Hybrid (preferred style)
sin(t.mul(0.1))
```

### 4.2 The Three-Tier API

canyons provides three levels of abstraction for different use cases:

#### Tier 1: Quick — Immediate Gratification

For getting sound out fast. No ceremony, minimal concepts.

```typescript
// Play a chord
play([60, 64, 67])

// Play a sequence at 120 BPM
play([60, 62, 64, 65, 67], { tempo: 120 })

// Add dynamics
play([60, 64, 67], { tempo: 120, velocity: 0.8 })

// Play to a specific output
play([60, 64, 67], { out: mpe('Linnstrument') })
```

The `play()` function is the on-ramp. It takes arrays, numbers, or simple objects and makes sound.

#### Tier 2: Idiom — The Signature Move

For expressive composition. This is where canyons differentiates from pattern-first systems.

**The core pattern: `within(terrain, content)`**

```typescript
// A 15-minute crescendo with a rhythm living inside it
within(ramp(0, 1, 15 * 60), {
  notes: [60, 64, 67],
  tempo: 72,
  out: mpe('cello')
})

// Breathing rubato: the tempo terrain shapes everything
within(sin(t / 8).range(0.9, 1.1), {
  notes: [60, 64, 67, 72, 67, 64],
  tempo: 66,
  out: mpe('piano')
})

// Nested terrains: dynamics within tempo within structure
within(ramp(0, 1, 60), {                    // 1-minute overall arc
  dynamics: within(sin(t).range(0.5, 1), {  // breathing dynamics
    notes: [48, 55, 60, 64],
    tempo: 90,
  })
})
```

**Why `within(terrain, content)` instead of `content.dynamics(terrain)`?**

The terrain comes first because it's conceptually primary. You're not "adding dynamics to a melody"—you're defining an expressive space and placing notes within it. The inversion is the point.

**Terrain functions:**

```typescript
// Envelopes
ramp(from, to, duration)        // linear ramp
exp(from, to, duration)         // exponential curve
env([0, 1, 0.5, 0], [1, 2, 3])  // multi-segment envelope

// Oscillators
sin(frequency)                  // sine wave [-1, 1]
tri(frequency)                  // triangle wave
saw(frequency)                  // sawtooth
noise()                         // white noise
perlin(frequency)               // smooth noise

// Time expressions (t is the time proxy)
t                               // linear time
t * 0.5                         // half speed
sin(t * 0.1)                    // slow oscillation
t.pow(2)                        // quadratic

// Range mapping
signal.range(min, max)          // map to [min, max]
signal.clamp(min, max)          // constrain to [min, max]
```

#### Tier 3: Shader — Full Control

For those who want to write `emit()` calls and control every aspect. This is the escape hatch to the raw signal graph.

```typescript
// Direct voice emission
emit({
  pitch: 60 + sin(t * 5) * 0.5,     // vibrato
  pressure: env([0, 1, 0.7, 0]),    // swell
  slide: perlin(t * 2).range(0.3, 0.7),
  gate: step(t, 0, 1),              // on for 1 second
  channel: 2
})

// Multiple voices with offset
for (let i = 0; i < 3; i++) {
  emit({
    pitch: 60 + i * 4,
    pressure: sin(t * 0.5 + i * 0.3).range(0.4, 0.9),
    slide: 0.5,
    gate: step(t, i * 0.5, 1),
    channel: 2 + i
  })
}

// Custom playhead logic
const playhead = integrate(bpm(120))
const noteIndex = floor(playhead.mod(4))
const notes = [60, 64, 67, 72]

on(playhead.crosses(1), () => {
  emit({
    pitch: lookup(notes, noteIndex),
    pressure: 0.8,
    gate: env([1, 1, 0], [0.4, 0.1])
  })
})
```

### 4.3 Time and Units

**`t` is musical time.** By default it advances in seconds. All durations are explicit:

```typescript
// Explicit time units—no magic
ramp(0, 1, 60)           // 60 seconds
ramp(0, 1, 15 * 60)      // 15 minutes
sin(t / 4)               // period of 4 seconds

// Helper functions for readability
const minutes = (n) => n * 60
const beats = (n, bpm) => n * 60 / bpm

ramp(0, 1, minutes(15))
ramp(0, 1, beats(32, 120))
```

**Wall time vs musical time:**

```typescript
t           // musical time (affected by tempo warping)
wallTime    // real elapsed seconds (monotonic)

// Tempo-warped time
const tempo = 120 + sin(wallTime * 0.1) * 10  // rubato
const musicalTime = integrate(tempo / 60)     // beats
```

### 4.4 Expression-First Idioms

The API makes continuous expression feel primary:

```typescript
// === Boléro: The crescendo IS the terrain ===

const bolero = within(ramp(0.1, 1.0, minutes(15)), {
  // The famous rhythm lives inside the crescendo
  notes: [hit, rest, rest, hit, rest, rest, hit, rest, rest, hit, hit, hit],
  tempo: 72,

  // Orchestration enters based on terrain level
  layers: {
    0.0: ['snare'],
    0.2: ['snare', 'flute'],
    0.4: ['snare', 'flute', 'clarinet'],
    0.6: ['snare', 'flute', 'clarinet', 'strings'],
    0.8: ['snare', 'flute', 'clarinet', 'strings', 'brass']
  }
})

// === Gymnopédie: Breathing terrain ===

const breath = sin(t / 12).range(0.9, 1.1)  // slow breath

const gymnopedie = within(breath, {
  notes: [...melodicLine],
  tempo: 66,
  dynamics: breath.range(0.3, 0.6),  // dynamics follow breath
  out: mpe('piano')
})

// === Generative Glass: Phase-shifted canons ===

const ostinato = [0, 0, 2, 0, 3, 0, 2, 0]

// Three voices with phase offset
[0, 0.5, 1].forEach((offset, i) => {
  within(perlin(t * 0.1).range(0.4, 0.8), {
    notes: ostinato,
    tempo: 120,
    phase: beats(offset, 120),
    transpose: floor(t / 30) * 12,  // transpose up every 30 seconds
    out: mpe('piano', { channel: 2 + i })
  })
})

// === MPE Cello: Per-note expression ===

within(ramp(0.3, 0.9, 20), {
  notes: [36, 43, 48, 55],
  tempo: 60,

  // Per-note expressions
  perNote: {
    vibrato: sin(t * 5) * 0.3,                  // pitch oscillation
    pressure: env([0.2, 0.8, 0.6], [0.3, 0.7]), // bow pressure swell
    slide: perlin(t * 2).range(0.3, 0.7)        // timbral variation
  },

  out: mpe('SWAM Cello', { bendRange: 48 })
})
```

### 4.5 Vocabulary

canyons deliberately uses different vocabulary from pattern-first systems:

| canyons | TidalCycles/Strudel | Why |
|---------|---------------------|-----|
| **terrain** | pattern | Emphasizes continuous shape, not discrete events |
| **within** | overlay/layer | The container comes first |
| **`t`** | `~` or implicit | Explicit, conventional, programmable |
| **signal** | control pattern | It's always continuous, not a "control" afterthought |
| **emit** | trigger | You're pushing into the output, not pulling from a pattern |

**No mini-notation.** canyons does not use Tidal-style string mini-notation like `"bd sd hh"`. All structure is expressed in JavaScript:

```typescript
// Instead of: "bd sd ~ hh"
[kick, snare, rest, hat]

// Instead of: "bd*2 sd"
[kick, kick, snare]

// Instead of: "bd [sd hh]"
[kick, [snare, hat]]
```

This keeps the language unified, makes tooling simpler, and avoids GPL-licensed parser dependencies.

---

## Part 5: Implementation Roadmap

### Phase 1: Core Signal Engine (Weeks 1-3)

**Goal:** Validate the time-as-signal architecture

**Deliverables:**
- [ ] Signal IR definition (TypeScript types)
- [ ] Basic signal operations (arithmetic, oscillators, range mapping)
- [ ] Integration with memoized accumulator
- [ ] TimeWarp and two-time-axis model
- [ ] Pattern + playhead → trigger detection
- [ ] Simple REPL for testing expressions

**Validation:**
- Boléro crescendo via `within(ramp(0, 1, 15 * 60), { ... })` in <5 lines
- Rubato emerges from `within(sin(t/8).range(0.9, 1.1), { ... })`
- Triggers occur at musically correct times with varying tempo

### Phase 2: Audio Thread Architecture (Weeks 4-6)

**Goal:** Achieve stable, low-jitter timing

**Deliverables:**
- [ ] Rust signal evaluator (core evaluation loop)
- [ ] Compile to WASM, run in AudioWorklet
- [ ] SharedArrayBuffer ring buffers for communication
- [ ] IR serialization and deserialization
- [ ] Control rate evaluation (250Hz baseline)
- [ ] Timing measurement infrastructure

**Validation:**
- <2ms jitter under normal load
- <5ms jitter under stress (complex graph, many voices)
- No audio glitches from GC

### Phase 3: MIDI/MPE Output (Weeks 7-9)

**Goal:** Drive external instruments with full MPE expression

**Deliverables:**
- [ ] Voice allocator with MPE channel rotation
- [ ] Continuous control → MIDI message conversion
- [ ] Lookahead scheduling with precise timestamps
- [ ] WebMIDI integration
- [ ] MPE configuration (zones, bend range)

**Validation:**
- 16-voice MPE polyphony
- Per-note pitch bend, pressure, slide working
- Control rate of 250Hz sustained per voice
- Test with Roli, Linnstrument, SWAM instruments

### Phase 4: Hot Reload (Weeks 10-11)

**Goal:** Change code without stopping music

**Deliverables:**
- [ ] Graph diffing algorithm
- [ ] State preservation (integrators, phase)
- [ ] Node identity system
- [ ] Crossfade for structural changes
- [ ] Error handling (syntax errors don't crash playback)

**Validation:**
- Change tempo mid-performance: no glitch
- Change pattern: notes continue from current position
- Syntax error: old code keeps running, error displayed
- Add new layer: fades in smoothly

### Phase 5: Visualization (Weeks 12-13)

**Goal:** See the continuous envelopes with playhead

**Deliverables:**
- [ ] Signal sampling for visualization
- [ ] Canvas-based waveform display
- [ ] Playhead overlay (synchronized to audio)
- [ ] Pattern/note visualization (piano roll style)
- [ ] Real-time updates as code changes

**Validation:**
- Visualization matches audio exactly
- Scrubbing playhead plays corresponding audio
- Complex graphs render at 60fps

### Phase 6: Internal Synths (Weeks 14-16)

**Goal:** Make sound without external gear

**Deliverables:**
- [ ] Basic oscillators (sine, saw, square, noise)
- [ ] ADSR envelope generator
- [ ] Simple filter (lowpass, highpass)
- [ ] Reverb and delay effects
- [ ] MPE-responsive voice architecture
- [ ] Preset library (piano, strings, pad, bass, drums)

**Validation:**
- All examples playable with internal sounds
- Latency <10ms from trigger to sound
- Polyphony: 32+ voices without dropout

### Phase 7: Polish and Documentation (Weeks 17-18)

**Goal:** Usable by others

**Deliverables:**
- [ ] Editor integration (Monaco with syntax highlighting)
- [ ] Example library (Boléro, Gymnopédie, Glass, etc.)
- [ ] Tutorial documentation
- [ ] API reference
- [ ] Error messages that help

**Validation:**
- New user can make sound in <2 minutes
- Examples are copy-paste runnable
- Error messages point to the problem

---

## Part 6: Open Questions

### 6.1 ~~API Syntax~~ (Resolved)

**Decision:** Three-tier API with proxy-based IR construction.

1. **Quick tier:** `play([60, 64, 67])` for immediate sound
2. **Idiom tier:** `within(terrain, content)` for expressive composition
3. **Shader tier:** `emit({...})` for full control

**No mini-notation.** All structure is expressed in JavaScript arrays and objects. This avoids Tidal's GPL-licensed parser and keeps tooling simple.

**Proxy-based signals:** `t` is a Proxy that builds IR nodes when used in expressions. `sin(t * 0.1)` produces a serializable IR tree, not a function.

See Part 4 for full details.

### 6.2 Determinism vs. Expressiveness

Pure functional signals are deterministic—`signal(t)` always returns the same value. This is good for reproducibility but limits some patterns:

- Random variations (humanization)
- Event-dependent behavior (louder after a rest)
- External input (MIDI controllers, sensors)

Options:
1. **Seeded randomness:** `noise(seed)` is deterministic given the seed
2. **Context parameter:** `signal(t, context)` where context includes event history
3. **Hybrid model:** Some signals are pure, some are reactive

### 6.3 Scope of "Continuous"

How continuous is continuous? Options:

| Rate | Use case | Tradeoff |
|------|----------|----------|
| Audio rate (44.1kHz) | Sample-accurate modulation | CPU intensive |
| Control rate (250-1000Hz) | Smooth enough for most expression | Good balance |
| Event rate (on triggers) | Simple, efficient | Loses continuous character |

The current design targets control rate for expression and audio rate only for synthesis. This seems right for the MPE use case (MIDI CC resolution limits what's audible anyway).

### 6.4 Multi-device Sync

For performances with multiple canyons instances or integration with DAWs:

- **Ableton Link:** Network tempo sync, proven in practice
- **MIDI Clock:** Standard but jittery
- **OSC:** Flexible, can sync anything
- **None:** Each instance is independent

Probably start with none, add Ableton Link when there's demand.

---

## Part 7: Success Criteria

canyons will have succeeded if:

1. **The Boléro test:** `within(ramp(0, 1, 15 * 60), { ... })` expresses a 15-minute crescendo as the primary terrain in <10 lines, with the rhythm living inside it.

2. **The Gymnopédie test:** Rubato and breathing dynamics emerge from `within(sin(t/12).range(0.9, 1.1), { ... })`—continuous terrain definitions, not per-note annotations.

3. **The MPE test:** A cello phrase with per-note vibrato, pressure swells, and pitch slides is expressible via `perNote: { vibrato: sin(t * 5), ... }` in a way that feels like describing the music, not programming MIDI bytes.

4. **The hot reload test:** A performer can change tempo, add layers, and modify terrains mid-performance without glitches.

5. **The adoption test:** Musicians who've used TidalCycles or Sonic Pi can be productive in canyons within an hour. The `play([60, 64, 67])` on-ramp is instant; `within(terrain, content)` becomes natural within a session.

---

## Appendix A: Comparison with Existing Systems

| Feature | TidalCycles | Strudel | Sonic Pi | SuperCollider | canyons |
|---------|-------------|---------|----------|---------------|---------|
| Primary primitive | Pattern | Pattern | Thread/sleep | Signal graph | Terrain (continuous signal) |
| Time model | Cyclic | Cyclic | Imperative | Flexible | `t` as signal |
| Continuous expression | Bolted on | Bolted on | `_slide` params | Native | Primary (`within`) |
| MPE support | None | None | None | Manual | Native |
| Hot reload | Pattern swap | Pattern swap | Limited | Ndef | Graph diff |
| Runs in browser | No | Yes | No | No | Yes |
| Mini-notation | Yes (GPL) | Yes (GPL) | No | No | No (JS arrays) |
| Learning curve | Medium | Medium | Low | High | Low → Medium |

## Appendix B: Prior Art and Influences

- **TidalCycles:** Pattern algebra, mini-notation, cyclic time
- **Strudel:** Browser-based live coding, visualization
- **SuperCollider:** Signal graphs, patterns, Ndef for live coding
- **ChucK:** Strongly-timed, time as first-class citizen
- **Faust:** Functional signal processing, everything-is-a-signal
- **Nyquist:** Unified representation of signals and scores
- **Shader languages (GLSL):** Functional, time-based, declarative
- **React:** Declarative UI with reconciliation/diffing

## Appendix C: Glossary

- **Signal:** A function from time to a value; the fundamental primitive in canyons
- **Terrain:** A continuous envelope or shape that defines an expressive space; the first argument to `within()`
- **`within(terrain, content)`:** The signature composition pattern—content lives inside the terrain
- **`t`:** The time Proxy; when used in expressions, builds IR nodes for the signal graph
- **TimeWarp:** A signal that maps wall time to musical time
- **Playhead:** A continuous signal that indexes into a sequence; triggers occur at integer crossings
- **Trigger:** The moment when a playhead crosses an integer boundary (forward direction only by default)
- **Voice:** A temporary signal subgraph representing a sounding note
- **emit():** Shader-tier function for direct voice control
- **MPE:** MIDI Polyphonic Expression (per-note pitch bend, pressure, slide)
- **IR:** Intermediate Representation (the serializable signal graph format)
- **Proxy-based IR:** Construction pattern where signal expressions (`sin(t * 0.1)`) build IR nodes immediately
- **Control rate:** The frequency at which signals are evaluated (default: 500 Hz)
- **Lookahead:** How far ahead the engine schedules MIDI events (default: 50ms)
- **Jitter:** Timing deviation between scheduled and actual event occurrence (target: <2ms)
- **Kahan summation:** Compensated summation algorithm that maintains precision over many additions
- **Schmitt trigger:** Hysteresis mechanism to prevent retriggering when playhead oscillates near boundaries
- **Voice stealing:** Reallocating an active voice when all MPE channels are in use
- **Three-tier API:** Quick (`play`), Idiom (`within`), Shader (`emit`) levels of abstraction

---

*canyons: where notes live within continuous terrains.*
