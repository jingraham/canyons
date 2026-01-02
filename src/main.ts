/**
 * canyons — Phase 3: Live Coding Environment
 */

import { EditorView, basicSetup } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import {
  T, seq, _, engine, midi, stop, hush,
  bpm, hz, swell, attack, decay, legato, stacc, tenuto,
  breath, vibrato, crescendo, decrescendo, onBeat, offBeat
} from './index';
import { Signal } from './signal';
import type { StreamState } from './stream';
import {
  editorHighlights, updateHighlights, updateSeqInfo, updateSignalPlots,
  parseConstPositions, registerSignal, clearSignalRegistry, rebuildSignalPlots
} from './editor-highlights';

// --- UI Setup ---

const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="layout">
    <div class="editor-panel">
      <div class="editor-header">
        <span class="title">canyons</span>
        <span class="status" id="status">Ready</span>
      </div>
      <details class="prelude">
        <summary>prelude</summary>
        <pre id="preludeCode"></pre>
      </details>
      <div id="editor"></div>
      <div class="error-panel" id="errorPanel"></div>
    </div>

    <div class="viz-panel">
      <div class="controls">
        <button id="startBtn">Start</button>
        <button id="stopBtn">Stop</button>
        <select id="midiSelect">
          <option value="">MIDI: None</option>
        </select>
      </div>

      <div class="time-display">
        <div class="label">Global Time T</div>
        <div class="value" id="timeValue">0.000</div>
        <div class="floor">floor: <span id="timeFloor">0</span></div>
      </div>

      <canvas id="signalCanvas"></canvas>

      <div id="streamsContainer" class="streams"></div>

      <div class="log">
        <div class="log-header">Event Log</div>
        <div id="logEntries"></div>
      </div>
    </div>
  </div>
`;

// --- Code Editor ---

const defaultCode = `// === Glass Machine ===
// Philip Glass-inspired ostinato with breathing tempo and dynamics.

// Subtle breath — barely perceptible ±1% variation
const breathing = breath(12, 0.01);

// Base tempo: 180 BPM with gentle breathing
const pulse = breathing.mul(bpm(180));

// Dynamic arc: starts soft, swells over 60 seconds
const arc = crescendo(60).mul(0.4).add(0.4);

// === The Arpeggio ===
// A simple rising/falling figure in A minor — the "cell"
const cell = [
  57, 60, 64, 67,  // A C E G (Am7 rising)
  64, 60, 57, 60,  // E C A C (falling back)
];

// Voice 1: The main arpeggio (plucked string)
seq(cell).drive(pulse).vel(arc).inst('pluck').as('arp1');

// Voice 2: Same pattern, 1.5% faster — creates the Glass phasing effect
seq(cell).drive(pulse.mul(1.015)).vel(arc.mul(0.8)).inst('pluck').as('arp2');

// Voice 3: Bass — root notes, one per cell cycle
seq([45, 45, 48, 45]).drive(pulse.mul(1/8)).vel(arc.mul(0.7)).inst('pluckBass').as('bass');
`;

let lastGoodCode = defaultCode;
let editor: EditorView;
let evalTimeout: number | null = null;
const DEBOUNCE_MS = 500;

/** Extract const names from code */
function extractConstNames(code: string): string[] {
  const names: string[] = [];
  const regex = /const\s+(\w+)\s*=/g;
  let match;
  while ((match = regex.exec(code)) !== null) {
    names.push(match[1]);
  }
  return names;
}

/** Wrap code to return all const values for signal detection */
function wrapCodeForSignalDetection(code: string, constNames: string[]): string {
  if (constNames.length === 0) return code;
  const returnObj = constNames.map(n => `${n}: typeof ${n} !== 'undefined' ? ${n} : undefined`).join(', ');
  return `${code}\nreturn { ${returnObj} };`;
}

/** Register detected signals and rebuild plots */
function registerDetectedSignals(code: string, values: Record<string, unknown>): void {
  clearSignalRegistry();
  const positions = parseConstPositions(code);

  for (const [name, value] of Object.entries(values)) {
    if (value instanceof Signal) {
      const lineEnd = positions.get(name);
      if (lineEnd !== undefined) {
        registerSignal(name, value, lineEnd);
      }
    }
  }

  // Trigger decoration rebuild
  editor.dispatch({ effects: rebuildSignalPlots.of(undefined) });
}

// Create a function that evaluates code with canyons primitives in scope
function evalCode(code: string): void {
  const errorPanel = document.getElementById('errorPanel')!;
  const statusEl = document.getElementById('status')!;

  try {
    // Hot reload: mark start of eval cycle
    engine.beginHotReload();

    // Extract const names for signal detection
    const constNames = extractConstNames(code);
    const wrappedCode = wrapCodeForSignalDetection(code, constNames);

    // Create a function with all canyons primitives in scope
    const fn = new Function(
      'T', 'seq', '_', 'engine', 'midi', 'stop', 'hush',
      'bpm', 'hz', 'swell', 'attack', 'decay', 'legato', 'stacc', 'tenuto',
      'breath', 'vibrato', 'crescendo', 'decrescendo', 'onBeat', 'offBeat',
      wrappedCode
    );
    const result = fn(
      T, seq, _, engine, midi, stop, hush,
      bpm, hz, swell, attack, decay, legato, stacc, tenuto,
      breath, vibrato, crescendo, decrescendo, onBeat, offBeat
    );

    // Hot reload: remove streams that weren't re-registered
    engine.endHotReload();

    // Register any Signals for plotting
    if (result && typeof result === 'object') {
      registerDetectedSignals(code, result);
    }

    // Success!
    lastGoodCode = code;
    errorPanel.textContent = '';
    errorPanel.classList.remove('visible');
    statusEl.textContent = 'OK';
    statusEl.classList.remove('error');
    statusEl.classList.add('ok');

    // Engine keeps running - no restart needed for hot reload!
  } catch (e) {
    // Show error but keep running last good code
    const err = e as Error;
    errorPanel.textContent = err.message;
    errorPanel.classList.add('visible');
    statusEl.textContent = 'Error';
    statusEl.classList.add('error');
    statusEl.classList.remove('ok');

    // Re-evaluate last good code (also using hot reload)
    try {
      engine.beginHotReload();
      const constNames = extractConstNames(lastGoodCode);
      const wrappedCode = wrapCodeForSignalDetection(lastGoodCode, constNames);
      const fn = new Function(
        'T', 'seq', '_', 'engine', 'midi', 'stop', 'hush',
        'bpm', 'hz', 'swell', 'attack', 'decay', 'legato', 'stacc', 'tenuto',
        'breath', 'vibrato', 'crescendo', 'decrescendo', 'onBeat', 'offBeat',
        wrappedCode
      );
      const result = fn(
        T, seq, _, engine, midi, stop, hush,
        bpm, hz, swell, attack, decay, legato, stacc, tenuto,
        breath, vibrato, crescendo, decrescendo, onBeat, offBeat
      );
      engine.endHotReload();
      if (result && typeof result === 'object') {
        registerDetectedSignals(lastGoodCode, result);
      }
    } catch {
      // Last good code also failed - shouldn't happen
    }
  }
}

// Initialize CodeMirror
editor = new EditorView({
  doc: defaultCode,
  extensions: [
    basicSetup,
    javascript({ typescript: true }),
    oneDark,
    editorHighlights,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        // Debounce evaluation
        if (evalTimeout !== null) {
          clearTimeout(evalTimeout);
        }
        evalTimeout = window.setTimeout(() => {
          const code = update.state.doc.toString();
          evalCode(code);
          // Update sequence position info for highlighting
          updateSeqInfo(editor, code);
        }, DEBOUNCE_MS);
      }
    }),
    EditorView.theme({
      '&': { height: '100%' },
      '.cm-scroller': { overflow: 'auto' },
    }),
  ],
  parent: document.getElementById('editor')!,
});

// Initial evaluation and sequence parsing
evalCode(defaultCode);
updateSeqInfo(editor, defaultCode);

// --- Visualization State ---

interface HistoryEntry {
  t: number;
  streams: Map<string, StreamState>;
  triggers: Set<string>; // accumulated triggers since last viz frame
}

const signalHistory: HistoryEntry[] = [];
const MAX_HISTORY = 200;

function log(message: string, isTrigger = false): void {
  const logEl = document.getElementById('logEntries')!;
  const entry = document.createElement('div');
  entry.className = 'log-entry' + (isTrigger ? ' trigger' : '');
  const elapsed = engine.currentTime().toFixed(2);
  entry.innerHTML = `<span class="time">${elapsed}s</span>${message}`;
  logEl.insertBefore(entry, logEl.firstChild);

  while (logEl.children.length > 50) {
    logEl.removeChild(logEl.lastChild!);
  }
}

function updateStreamViz(): void {
  const container = document.getElementById('streamsContainer')!;
  const streams = engine.getStreams();

  for (const [name, stream] of streams) {
    let el = document.getElementById(`stream-${name}`);
    if (!el) {
      el = document.createElement('div');
      el.id = `stream-${name}`;
      el.className = 'stream-viz';
      container.appendChild(el);
    }

    const latest = signalHistory.length > 0
      ? signalHistory[signalHistory.length - 1].streams.get(name)
      : null;

    const noteCells = stream.values.map((v, i) => {
      const isActive = latest && latest.index === i;
      const isRest = v === null;
      const display = isRest ? '_' : (Array.isArray(v) ? v.join(',') : v);
      return `<div class="note-cell ${isActive ? 'active' : ''} ${isRest ? 'rest' : ''}">${display}</div>`;
    }).join('');

    el.innerHTML = `
      <h2>${name}</h2>
      <div class="stream-notes">${noteCells}</div>
      <div class="stream-info">
        driver: <span>${latest ? latest.driverValue.toFixed(2) : '-'}</span> |
        floor: <span>${latest ? latest.currentFloor : '-'}</span> |
        phase: <span>${latest ? latest.phase.toFixed(2) : '-'}</span> |
        vel: <span>${latest ? latest.velocity.toFixed(2) : '-'}</span>
      </div>
    `;
  }

  // Remove stale
  for (const child of [...container.children]) {
    const name = child.id.replace('stream-', '');
    if (!streams.has(name)) {
      container.removeChild(child);
    }
  }
}

function drawSignalCanvas(): void {
  const canvas = document.getElementById('signalCanvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;

  canvas.width = canvas.offsetWidth * 2;
  canvas.height = canvas.offsetHeight * 2;
  ctx.scale(2, 2);

  const w = canvas.offsetWidth;
  const h = canvas.offsetHeight;

  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, w, h);

  if (signalHistory.length < 2) return;

  const streams = engine.getStreams();
  const streamNames = [...streams.keys()];
  const numStreams = streamNames.length;

  if (numStreams === 0) return;

  // Each stream gets its own horizontal lane
  const laneHeight = h / numStreams;
  const colors = ['#4ecdc4', '#ff6b6b', '#ffe66d', '#95e1d3'];

  streamNames.forEach((name, laneIdx) => {
    const laneTop = laneIdx * laneHeight;
    const laneBottom = laneTop + laneHeight;
    const color = colors[laneIdx % colors.length];

    // Draw lane separator
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, laneBottom);
    ctx.lineTo(w, laneBottom);
    ctx.stroke();

    // Draw stream name
    ctx.fillStyle = '#444';
    ctx.font = '10px monospace';
    ctx.fillText(name, 5, laneTop + 12);

    // Lane padding (same for sawtooth and trigger lines)
    const padding = laneHeight * 0.15;

    // Draw subtle trigger markers first (behind sawtooth)
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    for (let i = 0; i < signalHistory.length; i++) {
      const entry = signalHistory[i];
      if (entry.triggers.has(name)) {
        const x = (i / (MAX_HISTORY - 1)) * w;
        ctx.beginPath();
        ctx.moveTo(x, laneTop + padding);
        ctx.lineTo(x, laneBottom - padding);
        ctx.stroke();
      }
    }

    // Draw phase line (sawtooth pattern, 0-1)
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    let first = true;
    let lastPhase = 0;

    for (let i = 0; i < signalHistory.length; i++) {
      const state = signalHistory[i].streams.get(name);
      if (!state) continue;

      const x = (i / (MAX_HISTORY - 1)) * w;
      const phase = state.phase;

      // Map phase 0-1 to lane
      const y = laneBottom - padding - (phase * (laneHeight - 2 * padding));

      // Detect phase wrap (trigger) - don't draw line across reset
      if (first) {
        ctx.moveTo(x, y);
        first = false;
      } else if (phase < lastPhase - 0.5) {
        // Phase wrapped, start new line segment
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }

      lastPhase = phase;
    }
    ctx.stroke();
  });

  // Draw playhead
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  const playheadX = ((signalHistory.length - 1) / (MAX_HISTORY - 1)) * w;
  ctx.beginPath();
  ctx.moveTo(playheadX, 0);
  ctx.lineTo(playheadX, h);
  ctx.stroke();
}

// --- Engine Callbacks ---

engine.setNoteCallback((event) => {
  log(`NOTE ON ${event.note} (${event.stream}) vel=${event.velocity.toFixed(2)}`, true);
});

engine.setTickCallback((t, states, triggers) => {
  // Update time display
  document.getElementById('timeValue')!.textContent = t.toFixed(3);
  document.getElementById('timeFloor')!.textContent = Math.floor(t).toString();

  // Store history with triggers from engine
  signalHistory.push({ t, streams: new Map(states), triggers });
  if (signalHistory.length > MAX_HISTORY) signalHistory.shift();

  // Update viz
  updateStreamViz();
  drawSignalCanvas();

  // Update editor highlights with active indices
  const activeIndices = new Map<string, number>();
  for (const [name, state] of states) {
    activeIndices.set(name, state.index);
  }
  updateHighlights(editor, activeIndices);

  // Update signal plot playheads
  updateSignalPlots(t);
});

// --- UI Bindings ---

document.getElementById('startBtn')!.addEventListener('click', () => {
  signalHistory.length = 0;
  document.getElementById('logEntries')!.innerHTML = '';
  log('Engine started');
  engine.start();
  document.getElementById('startBtn')!.classList.add('active');
});

document.getElementById('stopBtn')!.addEventListener('click', () => {
  engine.shutdown();
  log('Engine stopped');
  document.getElementById('startBtn')!.classList.remove('active');
});

// --- MIDI Setup ---

const midiSelect = document.getElementById('midiSelect') as HTMLSelectElement;

function updateMidiDevices() {
  const devices = midi.getDevices();

  // Clear existing options except "None"
  while (midiSelect.options.length > 1) {
    midiSelect.remove(1);
  }

  // Add device options
  for (const device of devices) {
    const option = document.createElement('option');
    option.value = device.id;
    option.textContent = `MIDI: ${device.name}`;
    midiSelect.appendChild(option);
  }
}

midiSelect.addEventListener('change', () => {
  const deviceId = midiSelect.value;
  if (deviceId) {
    if (midi.selectDevice(deviceId)) {
      log(`MIDI output: ${midiSelect.options[midiSelect.selectedIndex].textContent}`);
    }
  } else {
    midi.disable();
    log('MIDI output disabled');
  }
});

// Initialize MIDI
midi.init().then((success) => {
  if (success) {
    updateMidiDevices();
    midi.setDevicesChangedCallback(updateMidiDevices);
    console.log('WebMIDI initialized');
  } else {
    console.log('WebMIDI not available');
  }
});

// --- Prelude Viewer ---

const preludeCode = `// Time Units
bpm(n)                    // beats per minute → signal
hz(n)                     // hertz → signal

// Per-Note Shapes (phase → signal)
swell(p)                  // 0 → 1 → 0
attack(p)                 // fast rise
decay(p)                  // fall off

// Gate Helpers (phase → signal)
legato(p)                 // 95% of period
stacc(p)                  // 30% of period
tenuto(p)                 // 85% of period

// Time-Varying Shapes (use T)
breath(period, depth)     // oscillates around 1
vibrato(rate, depth)      // oscillates around 0
crescendo(duration)       // 0 → 1 over duration
decrescendo(duration)     // 1 → 0 over duration

// Masks
onBeat(driver, n)         // every nth beat
offBeat(driver)           // off-beats

// Instruments
'sine', 'saw', 'square', 'triangle'
'piano', 'epiano'
'kick', 'snare', 'hihat'
'pluck', 'pluckBass'

// Rest
_                         // null (skip note)
`;

document.getElementById('preludeCode')!.textContent = preludeCode;

console.log('canyons Phase 3 — Live Coding Environment');
console.log('=========================================');
console.log('Edit code on the left. Changes auto-reload after 500ms.');
console.log('Errors preserve last working code.');
