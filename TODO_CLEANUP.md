# Canyons Cleanup Plan

Pre-feature hardening to make the foundation solid.

---

## Phase 1: Quick Wins (< 1 hour total)

### 1.1 Signal DRY — Extract `toVal` helper
**Time:** ~5 min
**File:** `src/signal.ts`

The `number | Signal` resolution pattern repeats 15+ times. Extract once:

```typescript
private static toVal(x: number | Signal, t: number): number {
  return x instanceof Signal ? x.eval(t) : x;
}

// Then each method becomes:
mul(x: number | Signal): Signal {
  return new Signal((t) => this.eval(t) * Signal.toVal(x, t));
}
```

- [x] Add `toVal` static method
- [x] Refactor all arithmetic methods (mul, div, add, sub)
- [x] Refactor mod
- [x] Refactor comparisons (lt, gt, lte, gte, min, max)

---

### 1.2 Fix timing drift — Use AudioContext time
**Time:** ~10 min
**File:** `src/engine.ts`

`performance.now()` and `audioCtx.currentTime` can drift, especially when tab is backgrounded (browsers throttle JS timers but audio keeps running). The worklet already uses audio time — make the fallback consistent.

**Critical:** Both scheduling AND visualization must share the same clock source. If tick uses audioCtx time but viz uses performance.now(), they'll drift apart.

- [x] In `currentTime()`, prefer `audioCtx.currentTime` when available
- [x] Ensure `seekTo()` adjusts relative to audio time, not performance.now()
- [x] Ensure viz callbacks receive the same time value as tick logic
- [ ] Test: background tab for 30s, bring back, verify no timing jump

---

### 1.3 Add runtime warnings for common mistakes
**Time:** ~10 min
**Files:** `src/stream.ts`, `src/engine.ts`

Help live coders catch errors fast.

- [x] Warn when `.inst()` references unknown instrument name (in engine or synth)
- [x] Warn on NaN in modifier eval results (velocity, pressure, etc.)

**Skipped:** "Warn when Stream GC'd without .as()" — FinalizationRegistry is unreliable and misfires during hot reload. Not worth the false positives.

---

## Phase 2: Test Foundation (~30 min)

### 2.1 Add Vitest
**Time:** ~5 min

```bash
npm install -D vitest
```

```json
// package.json scripts
"test": "vitest run",
"test:watch": "vitest"
```

- [x] Install vitest
- [x] Add npm scripts
- [x] Create `src/__tests__/` directory

---

### 2.2 Core kernel tests
**Time:** ~25 min
**Files:** `src/__tests__/signal.test.ts`, `src/__tests__/stream.test.ts`

Cover the critical paths that are hard to test manually:

- [x] **Signal composition**: `T.mul(2).add(1).eval(5) === 11`
- [x] **Signal comparison**: `T.lt(5).eval(3) === 1`, `T.lt(5).eval(7) === 0`
- [x] **Proper modulo**: `T.sub(1).mod(4).eval(0) === 3` (negative handling)
- [x] **Integer crossing triggers**: advancing driver triggers once per crossing
- [x] **No double-trigger at boundary**: staying at same floor doesn't re-trigger
- [x] **Seek then resume**: scrubbing backward then forward triggers appropriately
- [x] **Mask suppresses trigger**: masked stream doesn't fire
- [x] **Mask vs gate**: mask drops triggers entirely; gate just closes note early
- [x] **Hot reload state transfer**: new stream preserves `_lastFloor`

---

## Phase 3: Decompose main.ts (~45 min)

**Note:** Create `src/ui/` folder as you extract these files — don't wait for a separate "folder restructure" phase.

### 3.1 Extract visualization
**Time:** ~20 min
**New file:** `src/ui/viz.ts`

Pull the canvas rendering and stream visualization out of main.ts.

```typescript
export class Visualizer {
  constructor(canvas: HTMLCanvasElement, container: HTMLElement);
  update(t: number, states: Map<string, StreamState>, triggers: Set<string>): void;
  clear(): void;
}
```

- [x] Create `src/ui/` directory
- [x] Extract `Visualizer` class
- [x] Move stream color assignment logic
- [x] Move canvas drawing code
- [x] Update main.ts to import and use Visualizer

---

### 3.2 Extract editor setup
**Time:** ~15 min
**New file:** `src/ui/editor.ts`

```typescript
export function createEditor(
  parent: HTMLElement,
  initialCode: string,
  onChange: (code: string) => void
): EditorView;
```

- [x] Extract CodeMirror setup
- [x] Extract syntax highlighting config
- [ ] Move editor-highlights.ts to `src/ui/highlights.ts` (deferred - works fine in current location)

---

### 3.3 Extract code evaluator
**Time:** ~10 min
**New file:** `src/evaluator.ts`

Encapsulate the `new Function()` creation in one place.

- [x] Create `evaluateCode(code: string): EvalResult`
- [x] Move hot reload begin/end symmetry here
- [x] Add structured error handling
- [ ] Consider timeout/guardrails for infinite loops (stretch goal)

---

## Phase 4: Break Circular Dependencies (~20 min)

### 4.1 Decouple Stream from Engine
**Time:** ~20 min
**Files:** `src/stream.ts`, `src/engine.ts`

Currently `stream.ts` imports `engine` singleton for `.as()`. This prevents testing Stream in isolation.

**Use Option B — Context injection.** The fluent `seq().drive().as('melody')` API is the magic of canyons. Don't break it with explicit registration.

```typescript
// stream.ts
interface StreamRegistry {
  register(name: string, stream: Stream): void;
}

let currentRegistry: StreamRegistry | null = null;

export function setRegistry(registry: StreamRegistry): void {
  currentRegistry = registry;
}

// In Stream.as():
as(name: string): this {
  this.name = name;
  if (currentRegistry) {
    currentRegistry.register(name, this);
  }
  return this;
}
```

```typescript
// In evaluator or main.ts, before running user code:
setRegistry(engine);
```

```typescript
// In tests:
const mockRegistry = { register: vi.fn() };
setRegistry(mockRegistry);
```

- [ ] Define `StreamRegistry` interface
- [ ] Add `setRegistry()` function to stream.ts
- [ ] Update `.as()` to use registry instead of direct engine import
- [ ] Remove `import { engine }` from stream.ts
- [ ] Call `setRegistry(engine)` in evaluator before user code runs
- [ ] Verify streams can be tested with mock registry

---

## Phase 5: Further Folder Structure (Optional)

Phase 3 already creates `src/ui/`. This phase is only if you want to go further with `core/` and `audio/` separation.

```
src/
├── core/           # Platform-agnostic runtime
│   ├── signal.ts
│   ├── stream.ts
│   ├── engine.ts
│   └── prelude.ts
├── audio/          # Web Audio / MIDI
│   ├── midi.ts
│   ├── synth.ts
│   └── instruments.ts
├── ui/             # Browser UI (created in Phase 3)
│   ├── editor.ts
│   ├── viz.ts
│   └── highlights.ts
├── evaluator.ts
├── main.ts         # Bootstrap only
└── index.ts        # Public exports
```

- [ ] Create `src/core/` and move signal, stream, engine, prelude
- [ ] Create `src/audio/` and move midi, internal-synth, instruments
- [ ] Update all imports
- [ ] Verify build still works

**Note:** This is pure organization. Only do it if the flat structure is bothering you.

---

## Not Now

These are good ideas but lower priority than the above:

- **ESLint/Prettier** — Add when you have contributors
- **Auto-generate prelude docs** — Nice but not blocking
- **CI pipeline** — After tests exist
- **Performance profiling** — Only if you hear audio glitches

---

## Definition of Done

The foundation is "tight" when:

1. `npm test` passes with meaningful coverage of Signal/Stream
2. main.ts is < 300 lines (bootstrap + glue only)
3. Stream can be unit tested without importing engine
4. No timing drift when tab is backgrounded
5. New contributor can understand the architecture in 5 minutes

---

*Created: January 2025*
