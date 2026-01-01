# canyons

**A sequencer for continuous expression and composition**

*Version 0.5 — January 2025*

---

## Executive Summary

canyons is a browser-based live coding environment where **continuous signals are the fundamental primitive**. Notes, rhythms, and discrete events emerge from continuous envelopes via integer-crossing triggers.

The guiding metaphor: **music programming should feel like shaders for time.**

```javascript
// Boléro in 5 lines
const _ = null
const beat = T.mul(72/60)

const d1 = seq([60,_,_,60,_,_,60,_,_,60,60,60])
  .at(beat.mul(1.5))
  .vel(T.div(900))
```

---

## Part 1: The Problem and The Kernel

### 1.1 The Gap

**Pattern-first systems** (TidalCycles, Strudel, Sonic Pi) excel at rhythmic complexity but treat continuous expression as secondary. A 15-minute crescendo requires `slow 900` on a pattern—awkward.

**Signal-first systems** (Faust, SuperCollider, Max/MSP) handle continuous modulation natively but lack the conciseness that makes pattern languages powerful.

**The gap:** No system makes continuous expression as effortless as TidalCycles makes polyrhythms.

### 1.2 The Kernel

canyons has exactly **six primitives**:

```javascript
T                              // global time (seconds)
T.mul(x)  T.div(x)  T.add(x)  T.mod(x)  T.sin()  T.lt(x)  // signal math
seq([values]).at(signal)       // sequence driven by signal (loops infinitely)
.vel()  .gate()  .pressure()  .slide()  .bend()  // stream modifiers
P                              // note phase: driver.mod(1), i.e. 0→1 per trigger period
```

**That's it.** Everything else emerges from these.

### 1.3 The Key Insight

Discrete events emerge from **integer crossings**:

```
Signal: 0.0 → 0.5 → 1.0 → 1.5 → 2.0 → ...
                     ↑           ↑
                  trigger     trigger
```

When `seq([60,64,67]).at(signal)` is evaluated:
- The sequence outputs `values[floor(signal) % length]`
- A note-on triggers when `floor(signal)` increments

This is how **rubato works naturally**. A slowing tempo means the signal advances more slowly, so triggers occur less frequently—no rescheduling needed.

---

## Part 2: The Fluent API

### 2.1 Signals

`T` is global time in seconds. Signal operations return new signals:

```javascript
T                    // 0, 0.001, 0.002, ...
T.mul(2)             // 0, 0.002, 0.004, ... (2x speed)
T.add(1)             // 1, 1.001, 1.002, ... (offset)
T.mod(4)             // 0→4, 0→4, 0→4, ... (loop every 4 sec)
T.sin()              // sine of T
T.floor()            // discretize
T.lt(10)             // 1 while T < 10, else 0
T.gt(5)              // 1 while T > 5, else 0
```

Compound expressions:

```javascript
const beat = T.mul(120/60)                    // 120 BPM
const triplet = beat.mul(1.5)                 // triplets
const rubato = T.add(T.div(8).sin().mul(0.2)) // breathing time
```

### 2.2 Sequences and Streams

`seq([values]).at(signal)` creates a **Stream**—a playing sequence of notes:

```javascript
seq([60, 64, 67]).at(beat)           // C-E-G melody at 120 BPM
seq([60, 64, 67]).at(beat.mul(2))    // twice as fast
seq([60, 64, 67]).at(triplet)        // triplet feel
```

**Chords** use nested arrays—all notes in the inner array trigger simultaneously:

```javascript
seq([[60, 64, 67], [65, 69, 72]]).at(beat)  // C major, F major alternating
seq([60, [64, 67], 72]).at(beat)            // single, chord, single
```

Streams **auto-play** when created and must be assigned to a named slot:

```javascript
const d1 = seq([60, 64, 67]).at(beat)  // starts playing
d1.stop()                               // stops this stream
hush()                                  // stops all streams
```

### 2.3 Stream Modifiers

Chain modifiers to shape the stream:

```javascript
seq([60, 64, 67]).at(beat)
  .vel(0.8)                          // constant velocity
  .vel(T.div(900))                   // 15-minute crescendo
  .vel(beat.mod(1).sin())            // velocity swells per beat

seq([60, 64, 67]).at(beat)
  .gate(beat.mod(1).lt(0.8))         // 80% gate (staccato)
  .gate(beat.mod(1).lt(0.95))        // 95% gate (legato)

seq([60, 64, 67]).at(beat)
  .pressure(beat.mod(1).sin())       // MPE pressure per beat
  .slide(0.5)                        // MPE slide (CC74)
  .bend(T.mul(5).sin().mul(0.5))     // vibrato via pitch bend
```

### 2.4 Rests

Use `null` (or `_` as shorthand) for rests:

```javascript
const _ = null

seq([60, _, 64, _, 67]).at(beat)     // notes with rests
```

Note: `0` is MIDI note 0 (C-1), not a rest. Always use `null` for silence.

### 2.5 Multiple Voices

Multiple `seq().at()` calls create multiple voices:

```javascript
// Two voices in 3:4 polyrhythm
const beat = T.mul(2)
seq([48, 55, 48, 52]).at(beat)                // bass: 4 notes per cycle
seq([60, 63, 67]).at(beat.mul(3/4))           // melody: 3 notes per cycle
```

They stay locked because both derive from `beat`.

### 2.6 Note Phase (P)

`P` is the **fractional part of the driver signal**: `P = driver.mod(1)`.

This gives you 0→1 progress through each trigger period, enabling per-note envelopes without needing a separate envelope generator:

```javascript
seq([60, 64, 67]).at(beat)
  .pressure(P.sin())              // pressure swells 0→1→0 over each trigger period
  .pressure(P.mul(Math.PI).sin()) // same, explicit half-sine
  .slide(P)                       // slide ramps 0→1 over each trigger period
  .vel(P.lt(0.5).mul(0.3).add(0.5)) // louder in first half
```

`P` is independent of gate—it tracks position within the trigger period, not note duration. This makes it predictable and trivially computable:

```javascript
// Works with any rhythm
seq([60, 64, 67]).at(T.mul(1.3))  // weird tempo
  .pressure(P.sin())               // still swells per trigger period
```

### 2.7 Phrases as Functions

For reusable patterns, use functions:

```javascript
const riff = (t) => seq([60, 64, 67, 72]).at(t.mul(4))

riff(beat)              // play at beat rate
riff(beat.mul(0.5))     // half speed
riff(beat.add(0.5))     // offset by half beat
```

---

## Part 3: Examples

### Boléro

```javascript
const _ = null
const beat = T.mul(72/60)
const triplet = beat.mul(1.5)

const d1 = seq([60,_,_,60,_,_,60,_,_,60,60,60])
  .at(triplet)
  .vel(T.div(900))              // 15-minute crescendo
  .gate(triplet.mod(1).lt(0.3)) // short hits
```

### Rubato (Gymnopédie-style)

```javascript
const breath = T.add(T.div(8).sin().mul(0.2))  // time that breathes
const beat = breath.mul(66/60)

const d1 = seq([60, 64, 67, 72, 67, 64])
  .at(beat)
  .vel(beat.mod(1).mul(Math.PI).sin().mul(0.3).add(0.5))
  .gate(beat.mod(1).lt(0.9))
```

### Glass Phasing

```javascript
const beat = T.mul(2)

// Two phrases, slightly different speeds
const d1 = seq([60, 64, 67, 64]).at(beat)
const d2 = seq([60, 64, 67, 64]).at(beat.mul(1.01))  // 1% faster → phasing
```

### 3:4 Polyrhythm

```javascript
const beat = T.mul(2)

const d1 = seq([48, 55]).at(beat)              // 2 notes per beat
const d2 = seq([60, 63, 67]).at(beat.mul(3/2)) // 3 notes per beat
```

### MPE Cello

```javascript
const beat = T.mul(1)

const d1 = seq([36, 43, 48, 55])
  .at(beat)
  .vel(T.div(20).mul(0.6).add(0.3))        // slow crescendo over 20 sec
  .pressure(P.mul(Math.PI).sin())          // bow pressure swell per trigger
  .bend(P.gt(0.2).mul(T.mul(5).sin().mul(0.3)))  // vibrato, delayed onset
  .slide(P.mul(0.4).add(0.3))              // slide ramps up per trigger
```

---

## Part 4: Architecture

### 4.1 System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Main Thread                                │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────────┐ │
│  │    Editor    │  │ Visualizer   │  │    Graph Constructor       │ │
│  │   (Monaco)   │  │   (Canvas)   │  │  (Fluent API → IR)         │ │
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
│  │  • Detects integer crossings (note triggers)                    ││
│  │  • Manages voice allocation (MPE channels 2-16)                 ││
│  │  • Writes MIDI messages to output ring buffer                   ││
│  │  • Generates audio samples for internal synths                  ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 The Intermediate Representation

The fluent API compiles to a minimal IR:

```typescript
type SignalIR =
  | { op: 'const', value: number }
  | { op: 'time' }                                    // T
  | { op: 'phase' }                                   // P = driver.mod(1)
  | { op: 'add', a: SignalIR, b: SignalIR }
  | { op: 'mul', a: SignalIR, b: SignalIR }
  | { op: 'div', a: SignalIR, b: SignalIR }
  | { op: 'mod', a: SignalIR, b: SignalIR }
  | { op: 'sin', a: SignalIR }
  | { op: 'floor', a: SignalIR }
  | { op: 'lt', a: SignalIR, b: SignalIR }
  | { op: 'gt', a: SignalIR, b: SignalIR }

type NoteValue = number | number[] | null    // single note, chord, or rest

type StreamIR = {
  id: string                   // for lifecycle management
  sequence: NoteValue[]        // values (MIDI notes, chords, or rests)
  driver: SignalIR             // the .at() signal
  velocity?: SignalIR
  gate?: SignalIR
  pressure?: SignalIR
  slide?: SignalIR
  bend?: SignalIR
}
```

**Design principle:** The Rust engine stays dumb. All musical logic lives in TypeScript.

### 4.3 Signal Evaluator (Rust/WASM)

Runs in an AudioWorklet for timing stability. Core loop:

```rust
fn evaluate_tick(&mut self, wall_time: f64) {
    // Evaluate all signals at current time
    for node in &self.nodes {
        self.values[node.id] = self.eval_node(node, wall_time);
    }

    // Check for integer crossings on each stream's driver
    for stream in &mut self.streams {
        let prev = stream.prev_driver_value;
        let curr = self.values[stream.driver_node];

        if curr.floor() > prev.floor() {
            // Trigger! Emit note-on with interpolated timestamp
            let crossing_time = interpolate_crossing(prev, curr, ...);
            self.emit_note_on(stream, crossing_time);
        }

        stream.prev_driver_value = curr;
    }
}
```

### 4.4 Integration Precision

For long pieces (Boléro = 15 minutes), use Kahan summation to avoid floating-point drift:

```rust
struct Integrator {
    sum: f64,
    compensation: f64,
}

impl Integrator {
    fn add(&mut self, value: f64) -> f64 {
        let y = value - self.compensation;
        let t = self.sum + y;
        self.compensation = (t - self.sum) - y;
        self.sum = t;
        self.sum
    }
}
```

### 4.5 MIDI/MPE Output

Each stream maps to an MPE voice:

| Stream property | MIDI output |
|-----------------|-------------|
| sequence value | Note On (channel N) |
| `.vel()` | Note velocity |
| `.gate()` | Note duration (off when gate < 0.5) |
| `.pressure()` | Channel Pressure |
| `.slide()` | CC74 |
| `.bend()` | Pitch Bend (14-bit) |

**Voice allocation:** Round-robin through MPE channels 2-16. If all 15 are busy, steal the oldest voice.

### 4.6 Timing and MPE Defaults

| Parameter | Default | Notes |
|-----------|---------|-------|
| Control rate | 500 Hz | Signal evaluation frequency |
| Lookahead | 50 ms | MIDI scheduling buffer |
| Jitter target | <2 ms | Note timing accuracy |
| MPE pitch bend range | ±48 semitones | Per MPE spec default |
| MPE zone | Lower zone, channels 2-16 | Master channel 1 |
| Gate threshold | 0.5 | Note-off when gate crosses below |
| Default gate | `driver.mod(1).lt(0.9)` | 90% of trigger period |

### 4.7 Hot Reload

When code changes:

1. Compile new IR
2. Diff against current IR
3. Patch running graph:
   - Unchanged nodes: keep state
   - Changed parameters: update in place
   - Structural changes: crossfade over ~50ms

---

## Part 5: Open Questions

### 5.1 What Determines Note Duration?

Gate signal controls note lifetime:
- Note-on fires when driver crosses an integer (forward only—non-monotonic signals re-trigger)
- Note-off fires when gate crosses 0.5 downward

Default gate if not specified: `driver.mod(1).lt(0.9)` (90% of each trigger period).

`P` (note phase) is simply `driver.mod(1)`—the fractional part of the driver. It does not depend on gate. This makes `P` trivially computable without needing to predict when gate will close.

### 5.2 Stream Lifecycle (Resolved)

**Named slots + `hush()`:**

```javascript
const d1 = seq([60, 64, 67]).at(beat)  // playing
d1.stop()                               // stop this stream
hush()                                  // stop all streams (panic button)
```

When a stream is stopped or its slot is reassigned, the engine immediately sends Note Off for any active voices. This prevents stuck notes on hot reload.

### 5.3 Should `T` Be Wall Time or Musical Time?

Currently `T` is wall time (seconds). For tempo changes:

```javascript
const beat = T.mul(120/60)  // derive beat from T
```

Alternative: `T` could be "beats" with a global tempo. But this hides the relationship.

### 5.4 Per-Note Scoping (Resolved)

Solved by `P = driver.mod(1)`. Use `P` for any expression that should cycle per trigger:

```javascript
.pressure(P.sin())      // cycles every trigger period
.bend(P.gt(0.2).mul(T.mul(5).sin()))  // vibrato with delayed onset per trigger
```

`P` is 0→1 over each trigger period (not note duration), making it predictable and independent of gate timing.

---

## Part 6: Success Criteria

1. **Boléro:** 15-minute crescendo + triplet rhythm in <5 lines
2. **Rubato:** Breathing tempo via `T.add(T.div(8).sin().mul(0.2))`
3. **Polyrhythm:** 3:4 relationship expressed as `beat.mul(3/4)`
4. **MPE:** Per-note pressure/slide/bend working with external instruments
5. **Hot reload:** Change tempo mid-performance without glitch
6. **Latency:** <2ms jitter on note triggers

---

## Part 7: What We're NOT Building (Yet)

- Musical vocabulary (`pp`, `mf`, `bar()`, `beat()`)
- Mini-notation parsing
- Phrase containers or nesting constructs
- Multiple time contexts / scopes
- Built-in scales, chords, or music theory helpers

All of that is sugar. Build the kernel first. Add sugar when the pain reveals what's needed.

---

## Appendix: Implementation Phases

### Phase 1: Signal Engine
- `T` and `P` proxies that build IR
- Signal operations (`.mul()`, `.div()`, `.add()`, `.mod()`, `.sin()`, `.floor()`, `.lt()`, `.gt()`)
- `seq([]).at()` returning Stream with id
- Stream modifiers (`.vel()`, `.gate()`, `.pressure()`, `.slide()`, `.bend()`)
- Stream lifecycle (`.stop()`, `hush()`)
- Simple web REPL for testing

### Phase 2: Audio Thread
- Rust/WASM signal evaluator
- AudioWorklet integration
- Integer crossing detection
- Control rate evaluation

### Phase 3: MIDI Output
- WebMIDI integration
- MPE voice allocation
- Lookahead scheduling
- Timestamp precision

### Phase 4: Hot Reload
- IR diffing
- State preservation
- Error handling

### Phase 5: Visualization
- Signal waveform display
- Playhead overlay
- Real-time updates

---

*canyons: continuous signals, discrete triggers, expressive music.*
