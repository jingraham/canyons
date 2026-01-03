/**
 * canyons — Live Coding Environment
 *
 * This is the application entry point. It wires together:
 * - Editor (CodeMirror)
 * - Evaluator (sandboxed code execution)
 * - Visualization (stream and signal display)
 * - Engine callbacks
 * - UI bindings
 */

import { engine, midi } from './index';
import { Signal } from './signal';
import { createEditor, setEditorContent } from './ui/editor';
import { Visualizer } from './ui/viz';
import { evaluateCode } from './evaluator';
import {
  updateHighlights, updateSeqInfo, updateSignalPlots,
  parseConstPositions, registerSignal, clearSignalRegistry, rebuildSignalPlots
} from './editor-highlights';
import type { EditorView } from 'codemirror';

// --- Examples ---

const examples: Record<string, { name: string; code: string }> = {
  glass: {
    name: 'Glass Machine',
    code: `// === Glass Machine ===
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
`,
  },
  acid: {
    name: 'Acid Rain',
    code: `// === Acid Rain ===
// Relentless 303 acid with aggressive filter modulation.
// pressure() → filter cutoff, slide() → resonance

const beat = bpm(138);
const sixteenth = beat.mul(4);  // 16th note driver

// === Filter Modulation ===
// Bar-synced ramp: opens on downbeat, closes toward end of bar
const barPhase = beat.mod(4).div(4);           // 0→1 over 1 bar
const barRamp = barPhase.mul(-1).add(1);       // 1→0 (closes through bar)

// Smoothed step: jumps up every 4 bars, decays down
const fourBar = beat.div(16).mod(1);           // 0→1 over 4 bars
const stepped = fourBar.mul(4).floor().div(4); // 0, 0.25, 0.5, 0.75 steps

// Combined: stepped base + per-bar shape
const filterMod = p => stepped.mul(0.5).add(barRamp.mul(0.4)).add(0.1);

// Resonance: peaks mid-bar for that squelchy accent
const rezCurve = barPhase.mul(2).sub(1).abs().mul(-1).add(1);  // peak at 0.5
const rez = rezCurve.mul(0.6).add(0.3);  // 0.3 to 0.9

// === The 303 Line ===
const bassline = [
  36, 36, 36, 39,
  36, 36, 41, 39,
  36, 43, 41, 39,
  46, 43, 39, 37,
];

seq(bassline)
  .drive(sixteenth)
  .vel(p => attack(p).mul(0.3).add(0.6))
  .gate(p => p.lt(0.65))
  .pressure(filterMod)
  .slide(p => rez.add(swell(p).mul(0.3)))
  .inst('saw')
  .as('acid');

// === Kick ===
seq([36, 36, 36, 36])
  .drive(beat)
  .vel(1.0)
  .inst('kick')
  .as('kick');

// === Hi-hats ===
const hatGroove = sixteenth.mod(4).div(4);
const hatVel = p => hatGroove.mul(-0.4).add(0.7).add(swell(p).mul(0.2));

seq([42, 42, 42, 42, 42, 42, 42, 42])
  .drive(sixteenth)
  .vel(hatVel)
  .gate(stacc)
  .inst('hihat')
  .as('hats');

// === Clap ===
seq([_, 39, _, 39])
  .drive(beat)
  .vel(0.8)
  .inst('snare')
  .as('clap');
`,
  },
};

// --- UI Setup ---

const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="menu-bar">
    <span class="logo">canyons</span>
    <div class="divider"></div>

    <div class="transport">
      <button class="transport-btn" id="playBtn" title="Play">
        <svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg>
      </button>
      <button class="transport-btn" id="stopBtn" title="Stop">
        <svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16"/></svg>
      </button>
    </div>

    <div class="scrubber">
      <span class="time" id="timeDisplay">0.00</span>
      <input type="range" id="timeScrubber" min="0" max="60" step="0.1" value="0">
    </div>

    <div class="divider"></div>

    <select class="menu-select" id="exampleSelect">
      <option value="">Examples</option>
      <option value="glass">Glass Machine</option>
      <option value="acid">Acid Rain</option>
    </select>

    <select class="menu-select" id="midiSelect">
      <option value="">MIDI: None</option>
    </select>

    <span class="status-indicator" id="status">ready</span>
  </div>

  <div class="layout">
    <div class="editor-panel">
      <details class="prelude">
        <summary>prelude</summary>
        <pre id="preludeCode"></pre>
      </details>
      <div id="editor"></div>
      <div class="error-panel" id="errorPanel"></div>
    </div>

    <div class="viz-panel">
      <canvas id="signalCanvas"></canvas>
      <div id="streamsContainer" class="streams"></div>
      <div class="log">
        <div class="log-header">Event Log</div>
        <div id="logEntries"></div>
      </div>
    </div>
  </div>
`;

// --- State ---

const defaultCode = examples.glass.code;
let lastGoodCode = defaultCode;
let editor: EditorView;

// --- Visualization ---

const visualizer = new Visualizer(
  document.getElementById('signalCanvas') as HTMLCanvasElement,
  document.getElementById('streamsContainer')!
);

// --- Logging ---

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

// --- Code Evaluation ---

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

  editor.dispatch({ effects: rebuildSignalPlots.of(undefined) });
}

function evalCode(code: string): void {
  const errorPanel = document.getElementById('errorPanel')!;
  const statusEl = document.getElementById('status')!;

  const result = evaluateCode(code);

  if (result.success) {
    lastGoodCode = code;
    errorPanel.textContent = '';
    errorPanel.classList.remove('visible');
    statusEl.textContent = 'OK';
    statusEl.classList.remove('error');
    statusEl.classList.add('ok');

    if (result.values) {
      registerDetectedSignals(code, result.values);
    }
  } else {
    // Show error but keep running last good code
    errorPanel.textContent = result.error?.message ?? 'Unknown error';
    errorPanel.classList.add('visible');
    statusEl.textContent = 'Error';
    statusEl.classList.add('error');
    statusEl.classList.remove('ok');

    // Clear signal plots since positions won't match current document
    clearSignalRegistry();
    editor.dispatch({ effects: rebuildSignalPlots.of(undefined) });

    // Re-evaluate last good code
    evaluateCode(lastGoodCode);
  }
}

// --- Editor Setup ---

editor = createEditor({
  parent: document.getElementById('editor')!,
  initialCode: defaultCode,
  onChange: (code) => {
    evalCode(code);
    updateSeqInfo(editor, code);
  },
});

// Initial evaluation
evalCode(defaultCode);
updateSeqInfo(editor, defaultCode);

// --- Engine Callbacks ---

engine.setNoteCallback((event) => {
  log(`NOTE ON ${event.note} (${event.stream}) vel=${event.velocity.toFixed(2)}`, true);
});

const timeScrubber = document.getElementById('timeScrubber') as HTMLInputElement;
let isScrubbing = false;

engine.setTickCallback((t, states, triggers) => {
  // Update time display and scrubber
  document.getElementById('timeDisplay')!.textContent = t.toFixed(2);
  if (!isScrubbing) {
    timeScrubber.value = String(Math.min(t, 60));
  }

  // Update visualization
  visualizer.push({ t, streams: new Map(states), triggers });
  visualizer.updateStreamViz(engine.getStreams());
  visualizer.drawSignalCanvas(engine.getStreams());

  // Update editor highlights
  const activeIndices = new Map<string, number>();
  for (const [name, state] of states) {
    activeIndices.set(name, state.index);
  }
  updateHighlights(editor, activeIndices);
  updateSignalPlots(t);
});

// --- UI Bindings ---

const playBtn = document.getElementById('playBtn')!;
const stopBtn = document.getElementById('stopBtn')!;

playBtn.addEventListener('click', () => {
  visualizer.clear();
  document.getElementById('logEntries')!.innerHTML = '';
  log('Engine started');
  engine.start();
  playBtn.classList.add('active');
});

stopBtn.addEventListener('click', () => {
  engine.shutdown();
  log('Engine stopped');
  playBtn.classList.remove('active');
});

// --- Scrubber ---

timeScrubber.addEventListener('mousedown', () => { isScrubbing = true; });
timeScrubber.addEventListener('touchstart', () => { isScrubbing = true; });
timeScrubber.addEventListener('mouseup', () => { isScrubbing = false; });
timeScrubber.addEventListener('touchend', () => { isScrubbing = false; });
document.addEventListener('mouseup', () => { isScrubbing = false; });

timeScrubber.addEventListener('input', () => {
  const t = parseFloat(timeScrubber.value);
  engine.seekTo(t);
  visualizer.clear();
});

// --- MIDI Setup ---

const midiSelect = document.getElementById('midiSelect') as HTMLSelectElement;

function updateMidiDevices() {
  const devices = midi.getDevices();
  while (midiSelect.options.length > 1) {
    midiSelect.remove(1);
  }
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

midi.init().then((success) => {
  if (success) {
    updateMidiDevices();
    midi.setDevicesChangedCallback(updateMidiDevices);
  }
});

// --- Example Selector ---

const exampleSelect = document.getElementById('exampleSelect') as HTMLSelectElement;

exampleSelect.addEventListener('change', () => {
  const exampleId = exampleSelect.value;
  if (exampleId && examples[exampleId]) {
    const example = examples[exampleId];
    setEditorContent(editor, example.code);
    evalCode(example.code);
    updateSeqInfo(editor, example.code);
    log(`Loaded example: ${example.name}`);
  }
  exampleSelect.value = '';
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

console.log('canyons — Live Coding Environment');
