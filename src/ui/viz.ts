/**
 * Visualization — Stream and signal visualization for canyons.
 */

import type { Stream, StreamState, HistoryEntry } from '../core/types';
import { VIZ_HISTORY_SIZE } from '../config';

export type { HistoryEntry };

/** Trigger dot for Guitar Hero-style visualization */
interface TriggerDot {
  historyIndex: number;  // When the trigger occurred (absolute index)
  velocity: number;      // For dot size
}

export class Visualizer {
  private canvas: HTMLCanvasElement;
  private streamsContainer: HTMLElement;
  private history: HistoryEntry[] = [];
  private readonly maxHistory: number;
  private readonly colors = ['#c9a66b', '#b35d4b', '#d4c4a8', '#8a9a7b'];

  // Track trigger dots per stream for scrolling display
  private triggerDots = new Map<string, TriggerDot[]>();
  private totalHistoryIndex = 0;  // Absolute index across all history

  constructor(
    canvas: HTMLCanvasElement,
    streamsContainer: HTMLElement,
    maxHistory = VIZ_HISTORY_SIZE
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

    // Track trigger dots for each stream that triggered
    for (const streamName of entry.triggers) {
      if (!this.triggerDots.has(streamName)) {
        this.triggerDots.set(streamName, []);
      }
      const dots = this.triggerDots.get(streamName)!;

      // Get velocity from the stream state
      const state = entry.streams.get(streamName);
      const velocity = state?.velocity ?? 1;

      dots.push({
        historyIndex: this.totalHistoryIndex,
        velocity,
      });

      // Prune old dots that have scrolled off screen
      const oldestVisible = this.totalHistoryIndex - this.maxHistory;
      while (dots.length > 0 && dots[0].historyIndex < oldestVisible) {
        dots.shift();
      }
    }

    this.totalHistoryIndex++;
  }

  /** Clear all history */
  clear(): void {
    this.history.length = 0;
    this.triggerDots.clear();
    this.totalHistoryIndex = 0;
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

  /** Draw the signal canvas with trigger-focused Guitar Hero-style display */
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

    // Calculate x-position for a given absolute history index
    const historyStartIndex = this.totalHistoryIndex - this.history.length;
    const xForIndex = (idx: number): number => {
      const relativeIndex = idx - historyStartIndex;
      return (relativeIndex / (this.maxHistory - 1)) * w;
    };

    streamNames.forEach((name, laneIdx) => {
      const laneTop = laneIdx * laneHeight;
      const laneBottom = laneTop + laneHeight;
      const laneCenter = laneTop + laneHeight / 2;
      const color = this.colors[laneIdx % this.colors.length];

      // Lane padding
      const padding = laneHeight * 0.15;
      const signalHeight = laneHeight - 2 * padding;

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

      // 1. Draw muted phase signal centered at 0 (+/-0.5)
      // Shift so phase=0 (trigger point) maps to center
      ctx.strokeStyle = this.mutedColor(color, 0.4);
      ctx.lineWidth = 1;
      ctx.beginPath();

      let first = true;
      let lastShifted = 0;

      for (let i = 0; i < this.history.length; i++) {
        const state = this.history[i].streams.get(name);
        if (!state) continue;

        const x = (i / (this.maxHistory - 1)) * w;
        const phase = state.phase;

        // Shift phase so trigger (phase=0) is at center
        // phase=0 → shifted=0.5 → centered=0
        // phase=0.5 → shifted=1→0 (wrap) → centered=-0.5 (bottom)
        const shifted = (phase + 0.5) % 1;
        const centered = shifted - 0.5;  // -0.5 to +0.5
        const y = laneCenter - centered * signalHeight;

        // Detect discontinuity (at shifted wrap, which is phase=0.5)
        if (first) {
          ctx.moveTo(x, y);
          first = false;
        } else if (Math.abs(shifted - lastShifted) > 0.5) {
          // Discontinuity, start new line segment
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }

        lastShifted = shifted;
      }
      ctx.stroke();

      // 2. Draw flat colored trigger line at center (where phase=0 crosses)
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, laneCenter);
      ctx.lineTo(w, laneCenter);
      ctx.stroke();

      // 3. Draw trigger dots on the line
      const dots = this.triggerDots.get(name) || [];
      for (const dot of dots) {
        const x = xForIndex(dot.historyIndex);

        // Skip dots outside visible area
        if (x < -10 || x > w + 10) continue;

        // Dot size based on velocity (subtle: 2.5-4px radius)
        const baseRadius = 2.5;
        const maxExtra = 1.5;
        const radius = baseRadius + dot.velocity * maxExtra;

        // Draw filled dot with subtle glow
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 3;
        ctx.beginPath();
        ctx.arc(x, laneCenter, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
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

  /** Mute a hex color by reducing its opacity */
  private mutedColor(hex: string, alpha: number): string {
    // Parse hex color
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
}
