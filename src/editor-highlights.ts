/**
 * Editor Highlights — CodeMirror extension for live sequence visualization.
 *
 * - Highlights the currently active note in each seq([...]) as it plays.
 * - Shows inline curve previews for signal functions (breath, crescendo, etc.)
 */

import {
  EditorView,
  Decoration,
  DecorationSet,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { StateField, StateEffect, RangeSetBuilder } from '@codemirror/state';

// --- Types ---

interface SeqElement {
  start: number;  // character position in doc
  end: number;
}

interface SeqInfo {
  streamName: string;
  elements: SeqElement[];
}

// --- State Effects ---

/** Effect to update which elements are active */
export const setActiveIndices = StateEffect.define<Map<string, number>>();

/** Effect to update parsed sequence info */
export const setSeqInfo = StateEffect.define<SeqInfo[]>();

// --- Parsing ---

/**
 * Parse code to find seq([...])...as('name') patterns.
 * Returns info about each sequence's elements and their positions.
 */
export function parseSequences(code: string): SeqInfo[] {
  const results: SeqInfo[] = [];

  // Find all seq([...])...as('name') patterns
  // This regex finds seq( followed by array content
  const seqPattern = /seq\s*\(\s*(\[[\s\S]*?\])\s*\)[^;]*\.as\s*\(\s*['"`](\w+)['"`]\s*\)/g;

  let match;
  while ((match = seqPattern.exec(code)) !== null) {
    const arrayStr = match[1];
    const streamName = match[2];
    const arrayStart = match.index + match[0].indexOf('[');

    // Parse the array elements
    const elements = parseArrayElements(code, arrayStart);
    if (elements.length > 0) {
      results.push({ streamName, elements });
    }
  }

  // Also handle seq(varName)...as('name') where varName is a const
  const varSeqPattern = /seq\s*\(\s*(\w+)\s*\)[^;]*\.as\s*\(\s*['"`](\w+)['"`]\s*\)/g;
  while ((match = varSeqPattern.exec(code)) !== null) {
    const varName = match[1];
    const streamName = match[2];

    // Find the const definition: const varName = [...]
    const constPattern = new RegExp(`const\\s+${varName}\\s*=\\s*(\\[[\\s\\S]*?\\])`, 'g');
    const constMatch = constPattern.exec(code);
    if (constMatch) {
      const arrayStart = constMatch.index + constMatch[0].indexOf('[');
      const elements = parseArrayElements(code, arrayStart);
      if (elements.length > 0) {
        results.push({ streamName, elements });
      }
    }
  }

  return results;
}

/**
 * Parse array elements starting at a '[' position.
 * Returns positions of each top-level element.
 */
function parseArrayElements(code: string, arrayStart: number): SeqElement[] {
  const elements: SeqElement[] = [];
  let i = arrayStart + 1; // skip '['
  let depth = 1;
  let elementStart = -1;
  let inString = false;
  let stringChar = '';

  while (i < code.length && depth > 0) {
    const char = code[i];

    // Handle strings
    if ((char === '"' || char === "'" || char === '`') && code[i - 1] !== '\\') {
      if (!inString) {
        inString = true;
        stringChar = char;
      } else if (char === stringChar) {
        inString = false;
      }
      i++;
      continue;
    }

    if (inString) {
      i++;
      continue;
    }

    // Skip line comments - jump to end of line
    if (char === '/' && code[i + 1] === '/') {
      while (i < code.length && code[i] !== '\n') {
        i++;
      }
      continue;
    }

    // Track nesting
    if (char === '[' || char === '(' || char === '{') {
      if (elementStart === -1) {
        elementStart = i;
      }
      depth++;
    } else if (char === ']' || char === ')' || char === '}') {
      depth--;
      if (depth === 0 && elementStart !== -1) {
        // End of array - save last element
        const end = findElementEnd(code, elementStart, i);
        if (end > elementStart) {
          elements.push({ start: elementStart, end });
        }
      }
    } else if (char === ',' && depth === 1) {
      // Element separator at top level
      if (elementStart !== -1) {
        const end = findElementEnd(code, elementStart, i);
        if (end > elementStart) {
          elements.push({ start: elementStart, end });
        }
      }
      elementStart = -1;
    } else if (!/\s/.test(char) && elementStart === -1) {
      // Start of new element (non-whitespace)
      elementStart = i;
    }

    i++;
  }

  return elements;
}

/** Find the end of an element (trim trailing whitespace/comments) */
function findElementEnd(code: string, start: number, maxEnd: number): number {
  let end = maxEnd;
  // Backtrack over whitespace and comments
  while (end > start && /[\s,]/.test(code[end - 1])) {
    end--;
  }
  // Check for line comments
  const segment = code.slice(start, end);
  const commentIdx = segment.indexOf('//');
  if (commentIdx !== -1) {
    end = start + commentIdx;
    while (end > start && /\s/.test(code[end - 1])) {
      end--;
    }
  }
  return end;
}

// --- State Field ---

interface HighlightState {
  seqInfo: SeqInfo[];
  activeIndices: Map<string, number>;
}

const highlightState = StateField.define<HighlightState>({
  create() {
    return { seqInfo: [], activeIndices: new Map() };
  },
  update(state, tr) {
    let newState = state;

    for (const effect of tr.effects) {
      if (effect.is(setSeqInfo)) {
        newState = { ...newState, seqInfo: effect.value };
      }
      if (effect.is(setActiveIndices)) {
        newState = { ...newState, activeIndices: effect.value };
      }
    }

    return newState;
  },
});

// --- Decorations ---

const activeNoteMark = Decoration.mark({
  class: 'cm-active-note',
});

const triggerNoteMark = Decoration.mark({
  class: 'cm-trigger-note',
});

function buildDecorations(state: HighlightState): DecorationSet {
  const decorations: { from: number; to: number; decoration: Decoration }[] = [];

  for (const seq of state.seqInfo) {
    const activeIndex = state.activeIndices.get(seq.streamName);
    if (activeIndex !== undefined && activeIndex >= 0 && activeIndex < seq.elements.length) {
      const elem = seq.elements[activeIndex];
      decorations.push({
        from: elem.start,
        to: elem.end,
        decoration: activeNoteMark,
      });
    }
  }

  // Sort by position (required by CodeMirror)
  decorations.sort((a, b) => a.from - b.from);

  return Decoration.set(decorations.map(d => d.decoration.range(d.from, d.to)));
}

// --- View Plugin ---

const highlightPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      const state = view.state.field(highlightState);
      this.decorations = buildDecorations(state);
    }

    update(update: ViewUpdate) {
      // Check if our state changed
      const state = update.state.field(highlightState);
      const oldState = update.startState.field(highlightState);

      if (state !== oldState || update.docChanged) {
        this.decorations = buildDecorations(state);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

// --- Live Signal Plot Widgets ---

import { Signal } from './signal';

/** Registered signal with analyzed properties */
interface RegisteredSignal {
  name: string;
  signal: Signal;
  lineEnd: number;
  duration: number;
  periodic: boolean;
  min: number;
  max: number;
}

/** Global registry of signals to plot */
const signalRegistry = new Map<string, RegisteredSignal>();

/** Parse code to find const definitions and their line-end positions */
export function parseConstPositions(code: string): Map<string, number> {
  const positions = new Map<string, number>();
  const lines = code.split('\n');
  let pos = 0;

  for (const line of lines) {
    const lineEnd = pos + line.length;
    const match = line.match(/const\s+(\w+)\s*=/);
    if (match) {
      positions.set(match[1], lineEnd);
    }
    pos = lineEnd + 1;
  }

  return positions;
}

/** Analyze a signal by sampling to detect period, range, etc. */
function analyzeSignal(signal: Signal): { duration: number; periodic: boolean; min: number; max: number } {
  const sampleDuration = 30;
  const step = 0.05;
  const samples: number[] = [];

  for (let t = 0; t <= sampleDuration; t += step) {
    samples.push(signal.eval(t));
  }

  const min = Math.min(...samples);
  const max = Math.max(...samples);

  // Detect periodicity by looking for pattern repetition
  let periodic = false;
  let duration = 10;

  const firstSamples = samples.slice(0, 20);
  for (let offset = 10; offset < samples.length - 20; offset++) {
    const windowSamples = samples.slice(offset, offset + 20);
    let matches = true;
    for (let i = 0; i < 20; i++) {
      if (Math.abs(firstSamples[i] - windowSamples[i]) > 0.01 * (max - min + 0.01)) {
        matches = false;
        break;
      }
    }
    if (matches) {
      periodic = true;
      duration = offset * step;
      break;
    }
  }

  // For non-periodic, find when signal stabilizes
  if (!periodic) {
    const lastVal = samples[samples.length - 1];
    const threshold = 0.01 * (max - min + 0.01);
    for (let i = samples.length - 1; i >= 0; i--) {
      if (Math.abs(samples[i] - lastVal) > threshold) {
        duration = Math.min(sampleDuration, (i + 20) * step);
        break;
      }
    }
  }

  return { duration, periodic, min, max };
}

/** Register a signal for plotting */
export function registerSignal(name: string, signal: Signal, lineEnd: number): void {
  const analysis = analyzeSignal(signal);
  signalRegistry.set(name, {
    name,
    signal,
    lineEnd,
    ...analysis,
  });
}

/** Clear the signal registry */
export function clearSignalRegistry(): void {
  signalRegistry.clear();
}

/** Get registered signals sorted by position */
function getRegisteredSignals(): RegisteredSignal[] {
  return [...signalRegistry.values()].sort((a, b) => a.lineEnd - b.lineEnd);
}

/** Track active SVG elements for live updates */
const signalPlotSvgs = new Map<string, { svg: SVGSVGElement; reg: RegisteredSignal }>();

/** Generate SVG path for a signal using actual .eval() */
function generateSignalPathFromSignal(reg: RegisteredSignal, w: number, h: number): string {
  const steps = 150;
  const points: string[] = [];
  const range = reg.max - reg.min || 1;

  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * reg.duration;
    const val = reg.signal.eval(t);
    const normalized = (val - reg.min) / range;
    const x = (i / steps) * w;
    const y = h - normalized * h;
    points.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`);
  }

  return points.join(' ');
}

/** Widget that displays a minimal SVG signal plot */
class SignalPlotWidget extends WidgetType {
  constructor(readonly reg: RegisteredSignal) {
    super();
  }

  toDOM(): HTMLElement {
    const w = 300;
    const h = 20;

    const wrapper = document.createElement('span');
    wrapper.className = 'cm-signal-plot';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.classList.add('cm-signal-svg');

    // Signal curve path
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', generateSignalPathFromSignal(this.reg, w, h));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', '#4ecdc4');
    path.setAttribute('stroke-width', '1');
    path.setAttribute('opacity', '0.6');
    path.classList.add('signal-curve');
    svg.appendChild(path);

    // Playhead line
    const playhead = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    playhead.setAttribute('x1', '0');
    playhead.setAttribute('y1', '0');
    playhead.setAttribute('x2', '0');
    playhead.setAttribute('y2', String(h));
    playhead.setAttribute('stroke', '#666');
    playhead.setAttribute('stroke-width', '1');
    playhead.setAttribute('opacity', '0');
    playhead.classList.add('signal-playhead');
    svg.appendChild(playhead);

    // Current value dot
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('r', '2.5');
    dot.setAttribute('fill', '#4ecdc4');
    dot.setAttribute('opacity', '0');
    dot.classList.add('signal-dot');
    svg.appendChild(dot);

    wrapper.appendChild(svg);
    signalPlotSvgs.set(this.reg.name, { svg, reg: this.reg });

    return wrapper;
  }

  destroy(): void {
    signalPlotSvgs.delete(this.reg.name);
  }

  eq(other: SignalPlotWidget): boolean {
    return other.reg.name === this.reg.name && other.reg.signal === this.reg.signal;
  }
}

/** Build decorations from the signal registry */
function buildSignalPlotDecorations(): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const signals = getRegisteredSignals();

  for (const reg of signals) {
    builder.add(
      reg.lineEnd,
      reg.lineEnd,
      Decoration.widget({
        widget: new SignalPlotWidget(reg),
        block: true,
        side: 1,
      })
    );
  }

  return builder.finish();
}

/** Effect to trigger signal plot rebuild */
export const rebuildSignalPlots = StateEffect.define<void>();

/** StateField for signal plot decorations */
const signalPlotState = StateField.define<DecorationSet>({
  create() {
    return buildSignalPlotDecorations();
  },
  update(decorations, tr) {
    for (const effect of tr.effects) {
      if (effect.is(rebuildSignalPlots)) {
        return buildSignalPlotDecorations();
      }
    }
    if (tr.docChanged) {
      // Doc changed but signals not re-registered yet - keep old decorations
      // The rebuildSignalPlots effect will be dispatched after eval
      return decorations;
    }
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Update all signal plots with current playhead position */
export function updateSignalPlots(currentTime: number): void {
  for (const { svg, reg } of signalPlotSvgs.values()) {
    const w = 300;
    const h = 20;
    const range = reg.max - reg.min || 1;

    const playhead = svg.querySelector('.signal-playhead') as SVGLineElement | null;
    const dot = svg.querySelector('.signal-dot') as SVGCircleElement | null;

    if (currentTime < 0) {
      if (playhead) playhead.setAttribute('opacity', '0');
      if (dot) dot.setAttribute('opacity', '0');
    } else if (reg.periodic) {
      const loopedTime = currentTime % reg.duration;
      const x = (loopedTime / reg.duration) * w;
      const val = reg.signal.eval(loopedTime);
      const normalized = (val - reg.min) / range;
      const y = h - normalized * h;

      if (playhead) {
        playhead.setAttribute('x1', String(x));
        playhead.setAttribute('x2', String(x));
        playhead.setAttribute('opacity', '0.4');
      }
      if (dot) {
        dot.setAttribute('cx', String(x));
        dot.setAttribute('cy', String(y));
        dot.setAttribute('opacity', '1');
      }
    } else {
      const clampedTime = Math.min(currentTime, reg.duration);
      const x = (clampedTime / reg.duration) * w;
      const val = reg.signal.eval(clampedTime);
      const normalized = (val - reg.min) / range;
      const y = h - normalized * h;
      const finished = currentTime > reg.duration;

      if (playhead) {
        playhead.setAttribute('x1', String(x));
        playhead.setAttribute('x2', String(x));
        playhead.setAttribute('opacity', finished ? '0.2' : '0.4');
      }
      if (dot) {
        dot.setAttribute('cx', String(x));
        dot.setAttribute('cy', String(y));
        dot.setAttribute('opacity', finished ? '0.4' : '1');
      }
    }
  }
}

// --- Theme ---

const highlightTheme = EditorView.baseTheme({
  '.cm-active-note': {
    backgroundColor: 'rgba(78, 205, 196, 0.3)',
    borderRadius: '2px',
    boxShadow: '0 0 4px rgba(78, 205, 196, 0.5)',
  },
  '.cm-trigger-note': {
    backgroundColor: 'rgba(78, 205, 196, 0.6)',
    borderRadius: '2px',
    boxShadow: '0 0 8px rgba(78, 205, 196, 0.8)',
  },
  '.cm-signal-plot': {
    display: 'block',
    marginLeft: '32px',
    marginTop: '2px',
    marginBottom: '4px',
  },
  '.cm-signal-svg': {
    display: 'block',
    overflow: 'visible',
  },
});

// --- Extension ---

export const editorHighlights = [
  highlightState,
  highlightPlugin,
  signalPlotState,
  highlightTheme,
];

// --- API for updating from engine ---

export function updateHighlights(
  view: EditorView,
  activeIndices: Map<string, number>
): void {
  view.dispatch({
    effects: setActiveIndices.of(activeIndices),
  });
}

export function updateSeqInfo(view: EditorView, code: string): void {
  const seqInfo = parseSequences(code);
  view.dispatch({
    effects: setSeqInfo.of(seqInfo),
  });
}
