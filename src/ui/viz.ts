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

  /** Draw the signal canvas with stroboscope-style spinning ruler display */
  drawSignalCanvas(streams: Map<string, Stream>): void {
    const ctx = this.canvas.getContext('2d')!;

    this.canvas.width = this.canvas.offsetWidth * 2;
    this.canvas.height = this.canvas.offsetHeight * 2;
    ctx.scale(2, 2);

    const w = this.canvas.offsetWidth;
    const h = this.canvas.offsetHeight;

    ctx.fillStyle = '#0d0c0a';
    ctx.fillRect(0, 0, w, h);

    const streamNames = [...streams.keys()];
    const numStreams = streamNames.length;

    if (numStreams === 0) return;

    // Each stream gets its own horizontal lane
    const laneHeight = h / numStreams;

    // Reference point - where triggers "land"
    const refX = w / 2;

    streamNames.forEach((name, laneIdx) => {
      const stream = streams.get(name)!;
      const laneTop = laneIdx * laneHeight;
      const laneBottom = laneTop + laneHeight;
      const laneCenter = laneTop + laneHeight / 2;
      const color = this.colors[laneIdx % this.colors.length];

      // Lane padding
      const padding = laneHeight * 0.15;

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

      // Get current state from latest history
      const latest = this.history.length > 0
        ? this.history[this.history.length - 1].streams.get(name)
        : null;

      if (!latest) return;

      const seqLength = stream.values.length;
      const driverValue = latest.driverValue;

      // Scroll position (fractional position within sequence)
      const scrollPos = driverValue % seqLength;

      // Bar spacing - show 2 cycles for context
      const cyclesVisible = 2;
      const totalBars = seqLength * cyclesVisible;
      const barSpacing = w / seqLength;  // one cycle = screen width

      // Draw the scrolling ruler bars
      for (let cycle = -1; cycle <= cyclesVisible; cycle++) {
        for (let i = 0; i < seqLength; i++) {
          const barIndex = cycle * seqLength + i;

          // Distance from current scroll position (in sequence units)
          const dist = barIndex - scrollPos;

          // Convert to x position (refX is where current position appears)
          const x = refX + dist * barSpacing;

          // Skip if off screen
          if (x < -barSpacing || x > w + barSpacing) continue;

          // Determine if this is the "current" bar (just triggered or about to)
          const isCurrent = Math.abs(dist % seqLength) < 0.1 ||
                           Math.abs((dist % seqLength) - seqLength) < 0.1;

          // Bar height and style based on note value
          const noteValue = stream.values[i];
          const isRest = noteValue === null;

          // Draw the bar
          if (isRest) {
            // Subtle dashed line for rests
            ctx.strokeStyle = this.mutedColor(color, 0.15);
            ctx.setLineDash([2, 4]);
          } else {
            // Solid bar, brighter if current
            ctx.strokeStyle = isCurrent
              ? color
              : this.mutedColor(color, 0.4);
            ctx.setLineDash([]);
          }

          ctx.lineWidth = isCurrent ? 2 : 1;
          ctx.beginPath();
          ctx.moveTo(x, laneTop + padding);
          ctx.lineTo(x, laneBottom - padding);
          ctx.stroke();
        }
      }

      ctx.setLineDash([]);

      // Draw fixed reference marker at center
      ctx.strokeStyle = '#4a4640';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(refX, laneTop + padding * 0.5);
      ctx.lineTo(refX, laneTop + padding);
      ctx.moveTo(refX, laneBottom - padding);
      ctx.lineTo(refX, laneBottom - padding * 0.5);
      ctx.stroke();

      // Draw trigger flash at reference point when trigger just happened
      const justTriggered = this.history.length > 0 &&
        this.history[this.history.length - 1].triggers.has(name);

      if (justTriggered) {
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(refX, laneCenter, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    });
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
