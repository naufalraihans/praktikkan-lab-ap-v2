/**
 * Markdown + LaTeX renderer. Port dari js/markdown-renderer.js.
 * - marked v18+ untuk markdown
 * - LaTeX delimiters ($...$ / $$...$$) di-passthrough, MathJax handle
 * - Code block ```output → terminal-style block
 * - LaTeX list (\begin{enumerate}...\end{enumerate}) → HTML <ol>/<ul>
 */
import { marked } from 'marked';

let configured = false;

function configure() {
  if (configured) return;
  marked.use({
    breaks: true,
    gfm: true,
    renderer: {
      code({ text, lang }) {
        const tag = (lang ?? '').trim().toLowerCase();
        if (tag === 'output' || tag === 'terminal' || tag === 'shell') {
          const escaped = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
          return `<div class="terminal-block">
  <div class="terminal-header">
    <span class="terminal-dot dot-red"></span>
    <span class="terminal-dot dot-yellow"></span>
    <span class="terminal-dot dot-green"></span>
    <span class="terminal-label">OUTPUT</span>
  </div>
  <pre class="terminal-body"><code>${escaped}</code></pre>
</div>`;
        }
        return false; // fall back ke default renderer
      }
    }
  });
  configured = true;
}

/**
 * Convert \begin{enumerate}\item...\end{enumerate} → <ol><li>...</li></ol>.
 * Strip optional $$ wrapping. Item content tetap di-parse markdown rekursif.
 */
function preprocessLatexLists(text: string): string {
  return text.replace(
    /(?:\$\$)?\s*\\begin\s*\{(enumerate|itemize)\}([\s\S]*?)\\end\s*\{\1\}\s*(?:\$\$)?/g,
    (_match, type: string, inner: string) => {
      const tag = type === 'enumerate' ? 'ol' : 'ul';
      const items = inner
        .split(/\\item\b\s*/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (items.length === 0) return '';
      const lis = items
        .map((itemText) => `<li>${marked.parse(itemText) as string}</li>`)
        .join('');
      return `\n\n<${tag} class="latex-list">${lis}</${tag}>\n\n`;
    }
  );
}

/**
 * Render markdown + LaTeX ke HTML string.
 */
export function renderMarkdownToHtml(text: string | null | undefined): string {
  if (!text) return '';
  configure();
  const preprocessed = preprocessLatexLists(String(text));
  return marked.parse(preprocessed) as string;
}
