/**
 * UI — Editor and visualization for canyons.
 *
 * This module provides the user interface components:
 * - CodeMirror editor with live coding features
 * - Stream and signal visualization
 * - Editor highlights for active notes
 */

export { createEditor, setEditorContent } from './editor';
export type { EditorOptions } from './editor';

export { Visualizer } from './viz';
export type { HistoryEntry } from './viz';

export {
  editorHighlights,
  updateHighlights,
  updateSeqInfo,
  updateSignalPlots,
  parseConstPositions,
  registerSignal,
  clearSignalRegistry,
  rebuildSignalPlots,
} from './highlights';
