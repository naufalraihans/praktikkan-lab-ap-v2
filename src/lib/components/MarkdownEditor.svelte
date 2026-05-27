<script lang="ts">
  /**
   * Split-pane Markdown editor dengan live preview.
   * Marked + LaTeX (MathJax) — re-typeset preview tiap edit.
   */
  import { renderMarkdownToHtml } from '$lib/utils/markdown';
  import { renderMathJax } from '$lib/utils/monaco';

  interface Props {
    value: string;
    placeholder?: string;
    rows?: number;
  }

  let { value = $bindable(''), placeholder = '', rows = 8 }: Props = $props();

  let previewEl = $state<HTMLDivElement | null>(null);
  let rendered = $derived(renderMarkdownToHtml(value));

  $effect(() => {
    rendered;
    if (previewEl) {
      setTimeout(() => renderMathJax(previewEl), 50);
    }
  });
</script>

<div class="md-split">
  <div class="md-editor">
    <div class="md-pane-label">EDITOR (Markdown + LaTeX)</div>
    <textarea
      class="md-editor-input"
      {placeholder}
      {rows}
      bind:value
    ></textarea>
  </div>
  <div class="md-preview">
    <div class="md-pane-label">PREVIEW</div>
    <div bind:this={previewEl} class="md-preview-body" class:is-empty={!value.trim()}>
      {#if value.trim()}
        {@html rendered}
      {:else}
        <em>Mulai ketik untuk lihat preview…</em>
      {/if}
    </div>
  </div>
</div>
<div class="md-help-hint">
  Format: <code>**tebal**</code>, <code>*miring*</code>, <code>`kode`</code>,
  <code>- list</code>, <code>```output</code> (terminal style), LaTeX <code>$x^2$</code> /
  <code>$$\sum$$</code>.
</div>
