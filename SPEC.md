# canyons

**A sequencer for continuous expression and composition**

*Version 0.8 — January 2025*

---

## Executive Summary

canyons is a browser-based live coding environment where **continuous signals are the fundamental primitive**. Notes, rhythms, and discrete events emerge from continuous envelopes via integer-crossing triggers.

The guiding metaphor: **music programming should feel like shaders for time.**

```javascript
// Hello World — hear sound immediately
seq([60, 64, 67]).drive(bpm(120)).as('melody')

// Boléro — the shape governs the piece
const beat = bpm(72)
const intensity = crescendo(900)  // 15-minute arc

seq([60, _, _, 60, _, _, 60, _, _, 60, 60, 60])
  .drive(beat.mul(1.5))
  .vel(intensity)
  .gate(p => p.lt(0.3))  // staccato
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
T                                              // global time (seconds)
T.mul(x)  T.div(x)  T.add(x)  T.sub(x)         // arithmetic
T.mod(x)  T.sin()  T.floor()                   // shaping
T.lt(x)  T.gt(x)  T.min(x)  T.max(x)           // comparison/clamping
seq([values]).drive(signal)                    // sequence driven by signal
.vel()  .gate()  .pressure()  .slide()  .bend()  .mask()  .inst()  // stream modifiers
```

**That's it.** Everything else—`bpm()`, `swell`, `crescendo`, articulation helpers—lives in the **Standard Prelude**, a JavaScript library that ships by default and is fully inspectable.

### 1.3 The Key Insight

Discrete events emerge from **integer crossings**:

```
Signal: 0.0 → 0.5 → 1.0 → 1.5 → 2.0 → ...
                     ↑           ↑
                  trigger     trigger
```

When `seq([60,64,67]).drive(signal)` is evaluated:
- The sequence outputs `values[floor(signal) % length]`
- A note-on triggers when `floor(signal)` increments

This is how **rubato works naturally**. A slowing tempo means the signal advances more slowly, so triggers occur less frequently—no rescheduling needed.

### 1.4 Design Philosophy: Library, Not DSL

canyons is a **library of composable functions**, not a domain-specific language with magic syntax.

- No magic globals that "know" their context
- Explicit function parameters instead of implicit binding
- Signal composition happens before passing to modifiers
- Plain JavaScript that's easy to debug and type-check

---

## Part 2: The Fluent API

### 2.1 Signals

`T` is global time in seconds. Signal operations return new signals:

```javascript
T                    // 0, 0.001, 0.002, ...
T.mul(2)             // 2x speed
T.div(2)             // 0.5x speed
T.add(1)             // offset by 1
T.sub(1)             // offset by -1
T.mod(4)             // loop every 4 seconds
T.sin()              // sine of T
T.floor()            // discretize
T.lt(10)             // 1 while T < 10, else 0
T.gt(5)              // 1 while T > 5, else 0
T.min(1).max(0)      // clamp to 0-1
```

### 2.2 Sequences and Streams

`seq([values]).drive(signal)` creates a **Stream**—a sequence driven by a signal:

```javascript
seq([60, 64, 67]).drive(beat)           // C-E-G at tempo
seq([60, 64, 67]).drive(beat.mul(2))    // twice as fast
```

**Chords** use nested arrays:

```javascript
seq([[60, 64, 67], [65, 69, 72]]).drive(beat)  // C major, F major
```

**Rests** use `_`:

```javascript
seq([60, _, 64, _, 67]).drive(beat)     // notes with rests
```

### 2.3 Stream Modifiers

Modifiers shape the stream. **Each modifier takes a signal or a function of phase.**

The phase `p` is 0→1 progress through each trigger period. When you pass a function `(p) => ...`, it receives this phase.

```javascript
seq([60, 64, 67]).drive(beat)
  .vel(0.8)                              // constant velocity
  .vel(crescendo(60))                    // 60-second crescendo
  .vel(p => p.mul(Math.PI).sin())        // per-note swell

seq([60, 64, 67]).drive(beat)
  .gate(p => p.lt(0.3))                  // staccato (30% of period)
  .gate(p => p.lt(0.95))                 // legato (95% of period)

seq([60, 64, 67]).drive(beat)
  .bend(p => T.mul(5).sin().mul(0.3))    // vibrato
  .pressure(p => p.mul(Math.PI).sin())   // bow pressure swell
  .slide(p => p.mul(0.4).add(0.3))       // slide ramps up
```

**Modifier semantics:** Each call replaces the previous value for that modifier. Compose signals explicitly:

```javascript
// Velocity = 0.8 × crescendo × swell — compose as a function:
const myVel = (p) => swell(p).mul(crescendo(60)).mul(0.8)
seq([60, 64, 67]).drive(beat).vel(myVel)

// Bend = vibrato + offset — compose inline:
seq([60, 64, 67]).drive(beat).bend(p => vibrato(5, 0.3).add(0.5))
```

### 2.4 Masks

`.mask(signal)` suppresses triggers when the signal is < 0.5:

```javascript
seq([60, 64, 67]).drive(beat)
  .mask(T.div(4).sin().gt(0))        // only when sine > 0
  .as('gated')
```

### 2.5 Instrument Selection

`.inst(name)` selects which instrument plays the stream:

```javascript
seq([60, 64, 67]).drive(beat).inst('piano').as('melody')
seq([36, 43]).drive(beat).inst('kick').as('drums')
```

**Built-in instruments:** `'sine'` (default), `'saw'`, `'piano'`, `'kick'`, `'snare'`, `'hihat'`

If omitted, streams use `'sine'`. For external MIDI instruments, the instrument name is ignored—all streams output to the selected MIDI device.

### 2.6 Stream Identity and Lifecycle

Streams are identified by `.as()`:

```javascript
seq([60, 64, 67]).drive(beat).as('melody')
seq([36, 43]).drive(beat.div(2)).as('bass')

stop('melody')    // stops the melody stream
hush()            // stops all streams
```

**Hot reload:** Re-executing code with the same `.as()` name updates the stream smoothly. Changes crossfade over ~50ms. Active notes receive note-off before structural changes.

---

## Part 3: The Standard Prelude

The prelude translates "composer thought" into "signal math." It's visible in the UI.

```javascript
// === Time Units ===
const bpm = (n) => T.mul(n / 60)
const hz = (n) => T.mul(n)

// === Per-Note Shapes (functions of phase) ===
const swell = (p) => p.mul(Math.PI).sin()           // 0→1→0
const attack = (p) => p.lt(0.1).mul(10).mul(p)      // fast rise
const release = (p) => p.gt(0.8).mul(p.sub(1).mul(-5))

// === Time-Varying Shapes (use T) ===
const breath = (period = 8, depth = 0.2) =>
  T.div(period).sin().mul(depth).add(1)             // 1 ± depth

const vibrato = (rate = 5, depth = 0.3) =>
  T.mul(rate).sin().mul(depth)                      // oscillates ±depth

const crescendo = (duration) => T.div(duration).min(1)
const decrescendo = (duration) => T.div(duration).mul(-1).add(1).max(0)

// === Gate Helpers (functions of phase) ===
const legato = (p) => p.lt(0.95)
const stacc = (p) => p.lt(0.3)
const tenuto = (p) => p.lt(0.85)

// === Masks ===
const onBeat = (driver, n) => driver.mod(n).lt(1)
const offBeat = (driver) => driver.add(0.5).mod(1).lt(0.5)

// === Rest ===
const _ = null

// === Default Instruments ===
// Built-in: 'sine', 'saw', 'piano', 'kick', 'snare', 'hihat'
```

---

## Part 4: Examples

### Hello World

```javascript
// Minimum to hear sound:
seq([60, 64, 67]).drive(bpm(120)).as('melody')
```

Uses the default 'sine' instrument. To specify:

```javascript
seq([60, 64, 67]).drive(bpm(120)).inst('piano').as('melody')
```

### Boléro (15-minute crescendo)

The composition IS the crescendo. Start there.

```javascript
const beat = bpm(72)
const intensity = crescendo(900)  // 15-minute arc governs everything

seq([60, _, _, 60, _, _, 60, _, _, 60, 60, 60])
  .drive(beat.mul(1.5))
  .vel(intensity)
  .gate(stacc)
  .as('snare')
```

### Rubato (Gymnopédie-style)

The piece breathes. Define the breath first.

```javascript
const breathing = breath(8, 0.15)           // the shape
const beat = breathing.mul(bpm(66))         // tempo breathes

seq([60, 64, 67, 72, 67, 64])
  .drive(beat)
  .vel(p => swell(p).mul(0.3).add(0.5))
  .gate(legato)
  .as('piano')
```

### Glass Phasing

Two patterns, slightly different speeds.

```javascript
const beat = bpm(120)

seq([60, 64, 67, 64]).drive(beat).as('piano1')
seq([60, 64, 67, 64]).drive(beat.mul(1.01)).as('piano2')  // 1% faster
```

### 3:4 Polyrhythm

```javascript
const beat = bpm(120)

seq([48, 55]).drive(beat).as('bass')              // 2 notes per beat
seq([60, 63, 67]).drive(beat.mul(3/2)).as('mel')  // 3 notes per beat
```

### MPE Cello

```javascript
const beat = bpm(60)
const arc = crescendo(20)

seq([36, 43, 48, 55])
  .drive(beat)
  .vel(p => arc.mul(0.6).add(0.3))
  .pressure(swell)
  .bend(p => p.gt(0.2).mul(vibrato(5, 0.3)))  // delayed vibrato
  .slide(p => p.mul(0.4).add(0.3))
  .as('cello')
```

### Sparse Generative

```javascript
const beat = bpm(90)

seq([60, 63, 67, 70, 72])
  .drive(beat)
  .mask(T.div(3).sin().gt(0.3))     // ~60% density
  .vel(p => p.mul(0.4).add(0.4))
  .as('sparse')
```

---

## Part 5: MIDI/MPE Output

Each stream maps to an MPE voice:

| Stream property | MIDI output |
|-----------------|-------------|
| sequence value | Note On (channel N) |
| `.vel()` | Note velocity (0-127) |
| `.gate()` | Note duration (off when gate < 0.5) |
| `.pressure()` | Channel Pressure (0-127) |
| `.slide()` | CC74 (0-127) |
| `.bend()` | Pitch Bend (14-bit) |

**Voice allocation:** Lower zone, channels 2-16, round-robin. Oldest voice stolen when full.

**Bend range:** ±48 semitones (MPE default). Global config via `canyons.bendRange = 12`.

---

## Part 6: Visualization

The integer-crossing display is **essential**—it's how users understand why rubato works.

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
          ───────────────────────────────▶
                    Time

● = trigger (integer crossing)
Slope = tempo (steeper = faster)
```

**v0.8 scope:** Read-only strip chart with playhead. Interactive scrubbing deferred.

---

## Part 7: Open Questions

### 7.1 The Reset Problem

If two streams drift apart (polyrhythm) and you want to re-sync:

```javascript
seq(A).drive(beat1).as('a')
seq(B).drive(beat2).as('b')
// They're drifting... how to re-sync?
```

Current answer: Everything derives from `T`, so streams stay phase-coherent if they share ancestors. True independence means true drift.

Possible addition: `sync()` function that snaps a signal to the nearest integer.

### 7.2 Counting / Stateful Logic

"Play this motif 4 times, then stop" requires counting crossings:

```javascript
// Possible addition:
const n = count(beat)  // how many integers has beat crossed?
seq([60, 64, 67]).drive(beat).mask(n.lt(12)).as('intro')  // 12 notes then silence
```

Deferred pending real-world usage.

### 7.3 Hysteresis at Integer Boundaries

When a signal hovers near an integer (e.g., 0.999 → 1.001 → 0.998), naive floor() could double-trigger. Implementation must latch: once an integer is crossed, it can't trigger again until the signal moves away and returns.

### 7.4 Absolute Duration

Currently, gate is relative to trigger period. For absolute duration ("this note lasts 2 seconds"):

```javascript
// Possible addition:
.hold(2)  // 2 seconds absolute
```

Deferred pending real-world usage.

### 7.5 Randomness

Probabilistic masks need a noise primitive:

```javascript
// Possible addition:
noise              // 0-1 random, sample-and-hold per tick
noise.gt(0.3)      // 70% probability mask
```

---

## Part 8: Implementation Plan

### Phase 0: HTML Prototype (Do This First)

Build a single HTML file that:
- Runs `setInterval` at 50ms (20Hz)
- Evaluates a hardcoded signal graph
- Console logs "NOTE ON 60" on integer crossings
- Uses Web Audio oscillator to make sound

**Goal:** Validate integer-crossing logic handles hysteresis correctly before building infrastructure.

### Phase 1: TypeScript Core

Pure TypeScript, no Rust/WASM. The math is cheap.

- Signal proxy that builds expression trees
- `seq().drive()` returning Stream
- Stream modifiers (`.vel()`, `.gate()`, etc.)
- Evaluation at 500Hz in AudioWorklet
- Integer crossing detection with latching
- WebMIDI output

### Phase 2: Sound & Prelude

- Built-in instruments: sine, saw, piano, drums
- Standard prelude loaded by default
- Prelude visible/editable in UI

### Phase 3: Editor & Visualization

- Monaco editor with live reload
- Read-only integer-crossing visualizer
- Playhead showing current time
- Error display (preserve last good state)

### Phase 4: Polish

- MPE voice allocation
- Hot reload crossfading
- Signal notebook (solo any signal)
- Interactive scrubbing

### Deferred (v0.9+)

- Rust/WASM engine (only if JS bottlenecks)
- `count()` for stateful logic
- `noise` for randomness
- `hold()` for absolute duration
- WASM synth modules

---

## Part 9: Success Criteria

1. **Hello World:** `seq([60,64,67]).drive(bpm(120)).as('x')` produces sound
2. **Boléro:** 15-minute crescendo in <6 lines
3. **Rubato:** Breathing tempo via `breath(8).mul(bpm(66))`
4. **Polyrhythm:** 3:4 as `beat.mul(3/2)`
5. **MPE:** Per-note pressure/slide/bend with external instruments
6. **Hot reload:** Change tempo mid-performance without glitch
7. **Comprehension:** User understands rubato in 30 seconds of seeing visualization

---

## Appendix: What We're NOT Building (Yet)

- Mini-notation parsing
- Multiple time contexts / scopes
- Built-in scales, chords, music theory
- Section routing (A-B-A, verse-chorus)
- Polyphonic overlap within streams

All of that is sugar or extension. Build the kernel first.

---

## Changelog

### v0.8 (January 2025)

- **Simplified:** Removed magic `P` global; all phase access via explicit `(p) => ...` functions
- **Simplified:** Modifiers replace rather than stack; compose signals explicitly
- **Simplified:** Hot reload behavior reduced to one sentence
- **Simplified:** Removed `.nonMonotonic()` from core API
- **Simplified:** Removed per-stream MPE config; global defaults only
- **Moved:** IR type definitions and architecture diagrams to implementation docs
- **Added:** Real hello world with sound
- **Added:** `.inst()` for instrument selection
- **Added:** Default instrument kit
- **Added:** Open questions for Reset, Counting, Hysteresis
- **Added:** Implementation plan starting with HTML prototype
- **Added:** "Library, not DSL" design philosophy
- **Reordered:** API documentation now before Prelude (learn the primitives first)

### v0.7 (January 2025)

- Initial public spec

---

*canyons: continuous signals, discrete triggers, expressive music.*
