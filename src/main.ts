/**
 * canyons — Demo / Development Entry Point
 */

import { T, seq, _, engine, bpm, breath, crescendo, midi } from './index';
import type { StreamState } from './stream';

// --- UI Setup ---

const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="header">
    <h1><span>canyons</span> — phase 1</h1>
    <div class="controls">
      <button id="startBtn">Start</button>
      <button id="stopBtn">Stop</button>
      <select id="midiSelect">
        <option value="">MIDI: None</option>
      </select>
    </div>
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
`;

// --- Visualization State ---

interface HistoryEntry {
  t: number;
  streams: Map<string, StreamState>;
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

  // Find range
  let minVal = Infinity, maxVal = -Infinity;
  for (const entry of signalHistory) {
    for (const state of entry.streams.values()) {
      minVal = Math.min(minVal, state.driverValue);
      maxVal = Math.max(maxVal, state.driverValue);
    }
  }

  const range = maxVal - minVal || 1;
  minVal -= range * 0.1;
  maxVal += range * 0.1;

  // Draw integer lines
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 1;
  for (let i = Math.floor(minVal); i <= Math.ceil(maxVal); i++) {
    const y = h - ((i - minVal) / (maxVal - minVal)) * h;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();

    ctx.fillStyle = '#444';
    ctx.font = '10px monospace';
    ctx.fillText(i.toString(), 5, y - 3);
  }

  // Draw signals
  const colors = ['#4ecdc4', '#ff6b6b', '#ffe66d', '#95e1d3'];
  const streams = engine.getStreams();
  let colorIdx = 0;

  for (const name of streams.keys()) {
    ctx.strokeStyle = colors[colorIdx % colors.length];
    ctx.lineWidth = 2;
    ctx.beginPath();

    let first = true;
    for (let i = 0; i < signalHistory.length; i++) {
      const state = signalHistory[i].streams.get(name);
      if (!state) continue;

      const x = (i / (MAX_HISTORY - 1)) * w;
      const y = h - ((state.driverValue - minVal) / (maxVal - minVal)) * h;

      if (first) {
        ctx.moveTo(x, y);
        first = false;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // Draw trigger points
    ctx.fillStyle = colors[colorIdx % colors.length];
    for (let i = 0; i < signalHistory.length; i++) {
      const state = signalHistory[i].streams.get(name);
      if (state?.trigger) {
        const x = (i / (MAX_HISTORY - 1)) * w;
        const y = h - ((state.driverValue - minVal) / (maxVal - minVal)) * h;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    colorIdx++;
  }
}

// --- Engine Callbacks ---

engine.setNoteCallback((event) => {
  log(`NOTE ON ${event.note} (${event.stream}) vel=${event.velocity.toFixed(2)}`, true);
});

engine.setTickCallback((t, states) => {
  // Update time display
  document.getElementById('timeValue')!.textContent = t.toFixed(3);
  document.getElementById('timeFloor')!.textContent = Math.floor(t).toString();

  // Store history
  signalHistory.push({ t, streams: new Map(states) });
  if (signalHistory.length > MAX_HISTORY) signalHistory.shift();

  // Update viz
  updateStreamViz();
  drawSignalCanvas();
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

// --- Demo Streams ---

// Rubato: tempo breathes
const breathing = breath(4, 0.25);
const rubatoTempo = breathing.mul(bpm(80));
seq([60, 62, 64, 65, 67, 65, 64, 62]).drive(rubatoTempo).as('rubato');

// Polyrhythm: 3 against 4
const baseTempo = bpm(90);
seq([48, 52, 55]).drive(baseTempo).as('three');
seq([60, 63, 65, 67]).drive(baseTempo.mul(4 / 3)).as('four');

// Crescendo over 30 seconds
seq([36, 36, 43, 43]).drive(bpm(60)).vel(crescendo(30)).as('swell');

console.log('canyons Phase 1');
console.log('===============');
console.log('TypeScript core initialized.');
console.log('Click Start to begin.');
