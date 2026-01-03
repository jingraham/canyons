/**
 * Editor — CodeMirror setup for canyons live coding.
 */

import { EditorView, basicSetup } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { editorHighlights } from '../editor-highlights';

// Geological theme overrides for CodeMirror
const geoTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: '#0d0c0a',
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: "'SF Mono', 'Consolas', 'Monaco', monospace",
  },
  '.cm-content': {
    caretColor: '#c9a66b',
  },
  '.cm-cursor': {
    borderLeftColor: '#c9a66b',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'rgba(201, 166, 107, 0.15) !important',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(201, 166, 107, 0.05)',
  },
  '.cm-gutters': {
    backgroundColor: '#0d0c0a',
    borderRight: 'none',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    color: '#3a3830',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'rgba(201, 166, 107, 0.05)',
  },
  '.cm-matchingBracket': {
    backgroundColor: 'rgba(201, 166, 107, 0.2)',
    outline: 'none',
  },
}, { dark: true });

export interface EditorOptions {
  parent: HTMLElement;
  initialCode: string;
  onChange: (code: string) => void;
  debounceMs?: number;
}

/**
 * Create a CodeMirror editor instance configured for canyons.
 */
export function createEditor(options: EditorOptions): EditorView {
  const { parent, initialCode, onChange, debounceMs = 500 } = options;

  let evalTimeout: number | null = null;

  const editor = new EditorView({
    doc: initialCode,
    extensions: [
      basicSetup,
      javascript({ typescript: true }),
      oneDark,
      geoTheme,
      editorHighlights,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          // Debounce evaluation
          if (evalTimeout !== null) {
            clearTimeout(evalTimeout);
          }
          evalTimeout = window.setTimeout(() => {
            const code = update.state.doc.toString();
            onChange(code);
          }, debounceMs);
        }
      }),
    ],
    parent,
  });

  return editor;
}

/**
 * Replace editor content with new code.
 */
export function setEditorContent(editor: EditorView, code: string): void {
  editor.dispatch({
    changes: {
      from: 0,
      to: editor.state.doc.length,
      insert: code,
    },
  });
}
