/**
 * Visualization — Stream and signal visualization for canyons.
 */

import type { Stream, StreamState } from '../stream';

export interface HistoryEntry {
  t: number;
  streams: Map<string, StreamState>;
  triggers: Set<string>;
}

export class Visualizer {
  private canvas: HTMLCanvasElement;
  private streamsContainer: HTMLElement;
  private history: HistoryEntry[] = [];
  private readonly maxHistory: number;
  private readonly colors = ['#c9a66b', '#b35d4b', '#d4c4a8', '#8a9a7b'];

  constructor(
    canvas: HTMLCanvasElement,
    streamsContainer: HTMLElement,
    maxHistory = 200
  ) {
    this.canvas = canvas;
    this.streamsContainer = streamsContainer;
    this.maxHistory = maxHistory;
  }

  /** Add a new history entry */
  push(entry: HistoryEntry): void {
    this.history.push(entry);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
  }

  /** Clear all history */
  clear(): void {
    this.history.length = 0;
  }

  /** Get current history length */
  get length(): number {
    return this.history.length;
  }

  /** Update stream visualization panels */
  updateStreamViz(streams: Map<string, Stream>): void {
    for (const [name, stream] of streams) {
      let el = document.getElementById(`stream-${name}`);
      if (!el) {
        el = document.createElement('div');
        el.id = `stream-${name}`;
        el.className = 'stream-viz';
        this.streamsContainer.appendChild(el);
      }

      const latest = this.history.length > 0
        ? this.history[this.history.length - 1].streams.get(name)
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

    // Remove stale stream elements
    for (const child of [...this.streamsContainer.children]) {
      const name = child.id.replace('stream-', '');
      if (!streams.has(name)) {
        this.streamsContainer.removeChild(child);
      }
    }
  }

  /** Draw the signal canvas with phase sawtooth patterns */
  drawSignalCanvas(streams: Map<string, Stream>): void {
    const ctx = this.canvas.getContext('2d')!;

    this.canvas.width = this.canvas.offsetWidth * 2;
    this.canvas.height = this.canvas.offsetHeight * 2;
    ctx.scale(2, 2);

    const w = this.canvas.offsetWidth;
    const h = this.canvas.offsetHeight;

    ctx.fillStyle = '#0d0c0a';
    ctx.fillRect(0, 0, w, h);

    if (this.history.length < 2) return;

    const streamNames = [...streams.keys()];
    const numStreams = streamNames.length;

    if (numStreams === 0) return;

    // Each stream gets its own horizontal lane
    const laneHeight = h / numStreams;

    streamNames.forEach((name, laneIdx) => {
      const laneTop = laneIdx * laneHeight;
      const laneBottom = laneTop + laneHeight;
      const color = this.colors[laneIdx % this.colors.length];

      // Draw lane separator
      ctx.strokeStyle = '#1a1914';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, laneBottom);
      ctx.lineTo(w, laneBottom);
      ctx.stroke();

      // Draw stream name
      ctx.fillStyle = '#5a564e';
      ctx.font = '10px monospace';
      ctx.fillText(name, 5, laneTop + 12);

      // Lane padding
      const padding = laneHeight * 0.15;

      // Draw subtle trigger markers (behind sawtooth)
      ctx.strokeStyle = '#2a2820';
      ctx.lineWidth = 1;
      for (let i = 0; i < this.history.length; i++) {
        const entry = this.history[i];
        if (entry.triggers.has(name)) {
          const x = (i / (this.maxHistory - 1)) * w;
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

      for (let i = 0; i < this.history.length; i++) {
        const state = this.history[i].streams.get(name);
        if (!state) continue;

        const x = (i / (this.maxHistory - 1)) * w;
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
    ctx.strokeStyle = '#8a857a';
    ctx.lineWidth = 1;
    const playheadX = ((this.history.length - 1) / (this.maxHistory - 1)) * w;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, h);
    ctx.stroke();
  }
}
