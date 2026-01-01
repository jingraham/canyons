# canyons

**A sequencer for continuous expression and composition**

*Version 0.6 — January 2025*

---

## Executive Summary

canyons is a browser-based live coding environment where **continuous signals are the fundamental primitive**. Notes, rhythms, and discrete events emerge from continuous envelopes via integer-crossing triggers.

The guiding metaphor: **music programming should feel like shaders for time.**

```javascript
// Boléro in 5 lines
const beat = bpm(72)

seq([60,_,_,60,_,_,60,_,_,60,60,60])
  .at(beat.mul(1.5))
  .vel(T.div(900))
  .as('snare')
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

**That's it.** Everything else—including `bpm()`, `swell`, and articulation helpers—lives in the **Standard Prelude**, a JavaScript library that ships by default but is fully inspectable and editable.

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

## Part 2: The Standard Prelude

The prelude translates "composer thought" into "signal math." It loads by default and is **visible in the UI** so users can inspect and modify it.

### 2.1 Time Units

```javascript
// Tempo
const bpm = (n) => T.mul(n / 60)      // bpm(120) → 2 beats per second
const hz = (n) => T.mul(n)             // hz(0.5) → cycle every 2 seconds

// Usage
const beat = bpm(120)                  // instead of T.mul(120/60)
const slow = bpm(60)
const fast = bpm(180)
```

### 2.2 Expression Shapes

```javascript
// Per-note shapes (use P)
const swell = P.mul(Math.PI).sin()              // 0→1→0 over trigger period
const attack = P.lt(0.1).mul(10).mul(P)         // fast rise, sustain
const release = P.gt(0.8).mul(1 - P).mul(5)     // sustain, fast fall

// Time-varying shapes (use T)
const breath = (period = 8, depth = 0.2) =>
  T.add(T.div(period).sin().mul(depth))         // breathing rubato

const vibrato = (rate = 5, depth = 0.3) =>
  T.mul(rate).sin().mul(depth)                  // pitch oscillation

const crescendo = (duration) => T.div(duration) // linear ramp over duration
```

### 2.3 Articulation Helpers

```javascript
// Gate sugar - controls note duration as fraction of trigger period
Signal.prototype.legato = function() { return this.mod(1).lt(0.95) }
Signal.prototype.stacc = function() { return this.mod(1).lt(0.3) }
Signal.prototype.tenuto = function() { return this.mod(1).lt(0.85) }

// Usage
seq([60, 64, 67]).at(beat).gate(beat.stacc())   // short, punchy
seq([60, 64, 67]).at(beat).gate(beat.legato())  // smooth, connected
```

### 2.4 Built-in Rest

```javascript
const _ = null  // rest/silence in sequences

// Usage - no more "const _ = null" boilerplate
seq([60, _, 64, _, 67]).at(beat)
```

The prelude is documentation. Seeing `const swell = P.mul(Math.PI).sin()` teaches what P does better than any explanation.

---

## Part 3: The Fluent API

### 3.1 Signals

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
const beat = bpm(120)                         // 120 BPM (via prelude)
const triplet = beat.mul(1.5)                 // triplets
const rubato = breath(8, 0.2).mul(bpm(66))    // breathing time (via prelude)
```

### 3.2 Sequences and Streams

`seq([values]).at(signal)` creates a **Stream**—a sequence driven by a signal:

```javascript
seq([60, 64, 67]).at(beat)           // C-E-G melody at tempo
seq([60, 64, 67]).at(beat.mul(2))    // twice as fast
seq([60, 64, 67]).at(triplet)        // triplet feel
```

**Chords** use nested arrays—all notes in the inner array trigger simultaneously:

```javascript
seq([[60, 64, 67], [65, 69, 72]]).at(beat)  // C major, F major alternating
seq([60, [64, 67], 72]).at(beat)            // single, chord, single
```

### 3.3 Stream Identity and Lifecycle

Streams are identified by explicit names via `.as()`:

```javascript
seq([60, 64, 67]).at(beat).as('melody')     // creates/updates stream "melody"
seq([36, 43]).at(beat.div(2)).as('bass')    // creates/updates stream "bass"

stop('melody')                               // stops the melody stream
hush()                                       // stops all streams (panic)
```

**Hot reload behavior:** Re-executing code with the same `.as()` name updates the stream in place. The engine:
1. Diffs the new IR against the running stream
2. Unchanged nodes keep their state
3. Changed parameters crossfade over ~50ms
4. Sends Note Off for any orphaned voices

**Why `.as()` instead of variable names:** JavaScript `const` can't be reassigned, so magic variable-name extraction would require re-evaluating entire code blocks. Explicit `.as()` is clearer, works with any evaluation strategy, and makes stream identity visible in the code.

### 3.4 Stream Modifiers

Chain modifiers to shape the stream:

```javascript
seq([60, 64, 67]).at(beat)
  .vel(0.8)                          // constant velocity
  .vel(T.div(900))                   // 15-minute crescendo
  .vel(swell.mul(0.3).add(0.5))      // velocity swells per note (via prelude)

seq([60, 64, 67]).at(beat)
  .gate(beat.stacc())                // staccato (via prelude)
  .gate(beat.legato())               // legato (via prelude)
  .gate(beat.mod(1).lt(0.8))         // explicit: 80% of trigger period

seq([60, 64, 67]).at(beat)
  .pressure(swell)                   // MPE pressure per note (via prelude)
  .slide(0.5)                        // MPE slide (CC74)
  .bend(vibrato(5, 0.3))             // vibrato via pitch bend (via prelude)
```

### 3.5 Rests

Use `_` (built-in via prelude) for rests:

```javascript
seq([60, _, 64, _, 67]).at(beat)     // notes with rests
```

Note: `0` is MIDI note 0 (C-1), not a rest. Always use `_` for silence.

### 3.6 Multiple Voices

Multiple streams create multiple voices:

```javascript
// Two voices in 3:4 polyrhythm
const beat = bpm(120)
seq([48, 55, 48, 52]).at(beat).as('bass')           // 4 notes per cycle
seq([60, 63, 67]).at(beat.mul(3/4)).as('melody')   // 3 notes per cycle
```

They stay locked because both derive from `beat`.

### 3.7 Note Phase (P)

`P` is the **fractional part of the driver signal**: `P = driver.mod(1)`.

This gives you 0→1 progress through each trigger period, enabling per-note envelopes without needing a separate envelope generator:

```javascript
seq([60, 64, 67]).at(beat)
  .pressure(swell)                // prelude: P.mul(Math.PI).sin()
  .pressure(P.sin())              // equivalent, explicit
  .slide(P)                       // slide ramps 0→1 over trigger period
  .vel(P.lt(0.5).mul(0.3).add(0.5)) // louder in first half
```

`P` is independent of gate—it tracks position within the trigger period, not note duration. This makes it predictable and trivially computable.

### 3.8 Phrases as Functions

For reusable patterns, use functions:

```javascript
const riff = (t) => seq([60, 64, 67, 72]).at(t.mul(4))

riff(beat).as('riff1')              // play at beat rate
riff(beat.mul(0.5)).as('riff2')     // half speed
riff(beat.add(0.5)).as('riff3')     // offset by half beat
```

---

## Part 4: Examples

### Boléro

```javascript
const beat = bpm(72)
const triplet = beat.mul(1.5)

seq([60,_,_,60,_,_,60,_,_,60,60,60])
  .at(triplet)
  .vel(T.div(900))                    // 15-minute crescendo
  .gate(triplet.stacc())              // short hits
  .as('snare')
```

### Rubato (Gymnopédie-style)

```javascript
const beat = breath(8, 0.2).mul(bpm(66))  // time that breathes

seq([60, 64, 67, 72, 67, 64])
  .at(beat)
  .vel(swell.mul(0.3).add(0.5))
  .gate(beat.legato())
  .as('piano')
```

### Glass Phasing

```javascript
const beat = bpm(120)

// Two phrases, slightly different speeds
seq([60, 64, 67, 64]).at(beat).as('piano1')
seq([60, 64, 67, 64]).at(beat.mul(1.01)).as('piano2')  // 1% faster → phasing
```

### 3:4 Polyrhythm

```javascript
const beat = bpm(120)

seq([48, 55]).at(beat).as('bass')              // 2 notes per beat
seq([60, 63, 67]).at(beat.mul(3/2)).as('mel')  // 3 notes per beat
```

### MPE Cello

```javascript
const beat = bpm(60)

seq([36, 43, 48, 55])
  .at(beat)
  .vel(crescendo(20).mul(0.6).add(0.3))       // slow crescendo over 20 sec
  .pressure(swell)                             // bow pressure swell per note
  .bend(P.gt(0.2).mul(vibrato(5, 0.3)))       // vibrato, delayed onset
  .slide(P.mul(0.4).add(0.3))                 // slide ramps up per note
  .as('cello')
```

---

## Part 5: Architecture

### 5.1 System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Main Thread                                │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────────┐ │
│  │    Editor    │  │ Visualizer   │  │    Graph Constructor       │ │
│  │   (Monaco)   │  │   (Canvas)   │  │  (Fluent API → IR)         │ │
│  └──────────────┘  └──────────────┘  └────────────────────────────┘ │
│         │                 │                      │                   │
│         │                 │                      │ Serialized IR     │
│         │                 ▼                      ▼                   │
│         │    ┌─────────────────────────────────────────────────┐    │
│         │    │              Prelude (visible)                   │    │
│         │    │   bpm(), swell, breath(), legato(), stacc()     │    │
│         │    └─────────────────────────────────────────────────┘    │
│         │                                        │                   │
│         │                                        ▼                   │
│         │                 ┌─────────────────────────────────┐       │
│         │                 │      MIDI Output Queue          │       │
│         │                 │   (WebMIDI with timestamps)     │       │
│         │                 └─────────────────────────────────┘       │
└─────────┼───────────────────────────┬───────────────────────────────┘
          │                           │ SharedArrayBuffer
          │                           │ (Ring Buffer)
┌─────────┼───────────────────────────┼───────────────────────────────┐
│         │                    Audio Thread                            │
│         │               (AudioWorklet + WASM)                       │
│  ┌──────┼─────────────────────────────────────────────────────────┐ │
│  │      ▼              Signal Evaluator (Rust/WASM)               │ │
│  │  • Evaluates signal graph at control rate (250-1000 Hz)        │ │
│  │  • Detects integer crossings (note triggers)                   │ │
│  │  • Warns on non-monotonic drivers                              │ │
│  │  • Manages voice allocation (MPE channels 2-16)                │ │
│  │  • Writes MIDI messages to output ring buffer                  │ │
│  │  • Generates audio samples for internal synths                 │ │
│  └────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.2 The Intermediate Representation

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
  id: string                   // from .as('name')
  sequence: NoteValue[]        // values (MIDI notes, chords, or rests)
  driver: SignalIR             // the .at() signal
  velocity?: SignalIR
  gate?: SignalIR
  pressure?: SignalIR
  slide?: SignalIR
  bend?: SignalIR
  allowNonMonotonic?: boolean  // opt-in for scrubbing/phasing
}
```

**Design principle:** The Rust engine stays dumb. All musical logic lives in TypeScript. The prelude is pure JavaScript sugar over the kernel primitives.

### 5.3 Signal Evaluator (Rust/WASM)

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

        // Monotonicity warning
        if curr < prev && !stream.allow_non_monotonic {
            self.warn_non_monotonic(stream.id, prev, curr);
        }

        if curr.floor() > prev.floor() {
            // Trigger! Emit note-on with interpolated timestamp
            let crossing_time = interpolate_crossing(prev, curr, ...);
            self.emit_note_on(stream, crossing_time);
        }

        stream.prev_driver_value = curr;
    }
}
```

### 5.4 Monotonicity Safety

Non-monotonic driver signals (where the value decreases) can cause unexpected retriggering. The engine provides safety rails:

```javascript
// Default: warns in console when driver decreases
seq([60, 64, 67]).at(wobblySignal).as('melody')
// Console: "Stream 'melody': driver decreased (2.3 → 2.1). This may cause unexpected retriggering."

// Opt-in for intentional non-monotonic use (scrubbing, phasing effects)
seq([60, 64, 67]).at(wobblySignal).allowNonMonotonic().as('scrub')
```

This catches footguns without preventing advanced use cases.

### 5.5 Integration Precision

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

### 5.6 MIDI/MPE Output

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

### 5.7 Timing and MPE Defaults

| Parameter | Default | Notes |
|-----------|---------|-------|
| Control rate | 500 Hz | Signal evaluation frequency |
| Lookahead | 50 ms | MIDI scheduling buffer |
| Jitter target | <2 ms | Note timing accuracy |
| MPE pitch bend range | ±48 semitones | Per MPE spec default |
| MPE zone | Lower zone, channels 2-16 | Master channel 1 |
| Gate threshold | 0.5 | Note-off when gate crosses below |
| Default gate | `driver.mod(1).lt(0.9)` | 90% of trigger period |

### 5.8 Hot Reload

When code changes:

1. Compile new IR
2. Match streams by `.as()` name
3. Diff against current IR
4. Patch running graph:
   - Unchanged nodes: keep state
   - Changed parameters: update in place
   - Structural changes: crossfade over ~50ms
   - Removed streams: send Note Off for active voices

---

## Part 6: Visualization

### 6.1 The Integer Crossing Display

The visualizer is **not optional**—it's how users understand why rubato works.

```
                    Integer Crossings
    ─────────────────────────────────────────────
    3.0 ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─●─ ─ ─ ─ ─
                                    /
    2.0 ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─●─ ─ ─/─ ─ ─ ─ ─ ─
                            /    /
    1.0 ─ ─ ─ ─ ─ ─●─ ─ ─ ─/─ ─/─ ─ ─ ─ ─ ─ ─ ─
                  /      /  /
    0.0 ════════/══════/══/════════════════════
              /      /  /
            ───────────────────────────────────▶
                        Time

    ● = trigger (integer crossing)
    Curve = driver signal value
    Slope = tempo (steeper = faster)
```

**Required elements:**
1. **Horizontal grid lines** at integers (1.0, 2.0, 3.0...)
2. **The driver signal curve** moving through time
3. **Trigger markers** (●) where curve crosses integer lines
4. **Playhead** showing current time position
5. **Per-stream visualization** (multiple curves if multiple streams)

**Why this matters:** A flatter slope = slower tempo = triggers further apart. Users see rubato as literally "stretching the curve." This single visualization replaces pages of documentation.

### 6.2 Waveform Overlays

Optionally show continuous modulation signals:

```
    Velocity ───────────────────────────
    1.0 ┤                          ╱
        │                        ╱
    0.5 ┤                      ╱
        │                    ╱
    0.0 ┤══════════════════╱
        └──────────────────────────────▶
                    Time (15 min crescendo)
```

---

## Part 7: Open Questions

### 7.1 What Determines Note Duration?

Gate signal controls note lifetime:
- Note-on fires when driver crosses an integer (forward only—non-monotonic signals warn by default)
- Note-off fires when gate crosses 0.5 downward

Default gate if not specified: `driver.mod(1).lt(0.9)` (90% of each trigger period).

`P` (note phase) is simply `driver.mod(1)`—the fractional part of the driver. It does not depend on gate. This makes `P` trivially computable without needing to predict when gate will close.

### 7.2 Should `T` Be Wall Time or Musical Time?

Currently `T` is wall time (seconds). Musical time derives from it:

```javascript
const beat = bpm(120)  // derive beat from T
```

Alternative: `T` could be "beats" with a global tempo. But this hides the relationship and loses the signal-first clarity.

### 7.3 Structure and Sections (Future)

The kernel handles one continuous idea. A-B-A form, section transitions, and conditional routing are deferred to a future version. Possible directions:

```javascript
// Future: conditional routing based on signals
const section = T.div(32).floor().mod(3)  // 0, 1, 2, 0, 1, 2...
// ...some way to route to different sequences based on section
```

This is composition sugar for v0.5+, not v0.

---

## Part 8: Success Criteria

1. **Boléro:** 15-minute crescendo + triplet rhythm in <5 lines
2. **Rubato:** Breathing tempo via `breath(8, 0.2).mul(bpm(66))`
3. **Polyrhythm:** 3:4 relationship expressed as `beat.mul(3/2)`
4. **MPE:** Per-note pressure/slide/bend working with external instruments
5. **Hot reload:** Change tempo mid-performance without glitch
6. **Latency:** <2ms jitter on note triggers
7. **Comprehension:** User understands rubato within 30 seconds of seeing the integer-crossing visualization

---

## Part 9: What We're NOT Building (Yet)

- Mini-notation parsing
- Phrase containers or nesting constructs
- Multiple time contexts / scopes
- Built-in scales, chords, or music theory helpers
- Section/form routing (A-B-A, verse-chorus)
- Randomness/noise primitives

All of that is sugar. Build the kernel first. Add sugar when the pain reveals what's needed.

---

## Appendix A: Implementation Phases

### Phase 1: Signal Engine
- `T` and `P` proxies that build IR
- Signal operations (`.mul()`, `.div()`, `.add()`, `.mod()`, `.sin()`, `.floor()`, `.lt()`, `.gt()`)
- `seq([]).at()` returning Stream
- Stream modifiers (`.vel()`, `.gate()`, `.pressure()`, `.slide()`, `.bend()`)
- Stream identity via `.as()`
- `stop()` and `hush()`
- Simple web REPL for testing

### Phase 2: Standard Prelude
- `bpm()`, `hz()` time units
- `swell`, `breath()`, `vibrato()` shapes
- `.legato()`, `.stacc()`, `.tenuto()` articulation
- Global `_` for rests
- Visible/editable prelude panel in UI

### Phase 3: Audio Thread
- Rust/WASM signal evaluator
- AudioWorklet integration
- Integer crossing detection with monotonicity warnings
- Control rate evaluation

### Phase 4: MIDI Output
- WebMIDI integration
- MPE voice allocation
- Lookahead scheduling
- Timestamp precision

### Phase 5: Visualization
- Integer crossing display (THE critical feature)
- Driver signal curves
- Playhead overlay
- Trigger markers
- Per-stream views

### Phase 6: Hot Reload
- IR diffing by stream name
- State preservation
- Crossfade on structural changes
- Error recovery

---

## Appendix B: Prelude Reference

The complete standard prelude (loaded by default, visible in UI):

```javascript
// === Time Units ===
const bpm = (n) => T.mul(n / 60)
const hz = (n) => T.mul(n)

// === Per-Note Shapes (use P) ===
const swell = P.mul(Math.PI).sin()
const attack = P.lt(0.1).mul(10).mul(P)
const release = P.gt(0.8).mul(1 - P).mul(5)

// === Time-Varying Shapes (use T) ===
const breath = (period = 8, depth = 0.2) =>
  T.add(T.div(period).sin().mul(depth))

const vibrato = (rate = 5, depth = 0.3) =>
  T.mul(rate).sin().mul(depth)

const crescendo = (duration) => T.div(duration)

// === Articulation (gate helpers) ===
Signal.prototype.legato = function() { return this.mod(1).lt(0.95) }
Signal.prototype.stacc = function() { return this.mod(1).lt(0.3) }
Signal.prototype.tenuto = function() { return this.mod(1).lt(0.85) }

// === Rest ===
const _ = null
```

---

*canyons: continuous signals, discrete triggers, expressive music.*
