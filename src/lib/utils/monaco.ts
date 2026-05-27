/**
 * Lazy load Monaco editor dari CDN via AMD loader (require.js).
 * Resolve cached promise kalau udah loaded sebelumnya.
 */

let loadPromise: Promise<typeof window.monaco> | null = null;

export function loadMonaco(): Promise<typeof window.monaco> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Monaco can only load in browser'));
  }
  if (window.monaco) return Promise.resolve(window.monaco);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    // AMD require di-inject via <script> di app.html (require.js). NodeJS-style
    // require type conflict di TS — pakai cast ke window.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const amdRequire = (window as any).require as {
      config: (c: { paths: Record<string, string> }) => void;
      (deps: string[], cb: () => void): void;
    };
    if (typeof amdRequire === 'undefined') {
      reject(new Error('require.js (AMD loader) belum di-load'));
      return;
    }
    amdRequire.config({
      paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.38.0/min/vs' }
    });
    amdRequire(['vs/editor/editor.main'], () => {
      resolve(window.monaco);
    });
  });

  return loadPromise;
}

export interface MonacoEditorOptions {
  value?: string;
  language?: 'plaintext' | 'c' | 'python' | string;
  readOnly?: boolean;
  lineNumbers?: 'on' | 'off';
  height?: number; // px, default by container
}

/**
 * Create a Monaco editor instance dengan default config standard project ini.
 */
export async function createEditor(container: HTMLElement, opts: MonacoEditorOptions = {}) {
  const m = await loadMonaco();
  return m.editor.create(container, {
    value: opts.value ?? '',
    language: opts.language ?? 'plaintext',
    theme: 'vs-dark',
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 14,
    fontFamily: "'Fira Code', monospace",
    scrollBeyondLastLine: false,
    roundedSelection: false,
    lineNumbers: opts.lineNumbers ?? 'off',
    readOnly: opts.readOnly ?? false
  });
}

/**
 * Render MathJax pada element tertentu (atau seluruh document kalau null).
 */
export async function renderMathJax(element?: Element | null) {
  if (typeof window === 'undefined' || !window.MathJax) return;
  try {
    await window.MathJax.typesetPromise(element ? [element] : undefined);
  } catch (err) {
    console.warn('MathJax render error:', err);
  }
}
