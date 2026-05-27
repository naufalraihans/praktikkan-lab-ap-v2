<script lang="ts">
  /**
   * Wrapper di atas Edra (Tiptap-based WYSIWYG) dengan API mirip MarkdownEditor:
   * - bind:value untuk markdown string in/out
   * - placeholder
   *
   * Editor jalan WYSIWYG, tapi storage tetap markdown (via tiptap-markdown).
   */
  import { onMount } from 'svelte';
  import type { Editor } from '@tiptap/core';
  import { EdraEditor, EdraToolBar } from '$lib/components/edra/headless';

  interface Props {
    value: string;
    placeholder?: string;
    minHeight?: string;
  }

  let { value = $bindable(''), placeholder = 'Mulai ketik...', minHeight = '200px' }: Props =
    $props();

  let editor = $state<Editor | undefined>(undefined);
  let mounted = $state(false);

  // Track local content untuk avoid feedback loop (editor update → value update → editor update)
  let lastEmittedValue = '';

  onMount(() => {
    mounted = true;
  });

  // Saat editor ready, set initial markdown content
  $effect(() => {
    if (!editor) return;
    // Set initial value once (kalau ada)
    if (value && value !== lastEmittedValue) {
      lastEmittedValue = value;
      editor.commands.setContent(value, { emitUpdate: false });
    }
  });

  function handleUpdate() {
    if (!editor) return;
    // Get markdown dari storage (tiptap-markdown extension)
    const storage = editor.storage as { markdown?: { getMarkdown: () => string } };
    const md = storage.markdown?.getMarkdown() ?? '';
    lastEmittedValue = md;
    value = md;
  }
</script>

<div class="edra-wrap" style="--edra-min-height: {minHeight};">
  {#if mounted}
    <EdraEditor
      bind:editor
      content={value}
      autofocus={false}
      onUpdate={handleUpdate}
      class="edra-editor"
    />
    {#if editor}
      <EdraToolBar {editor} class="edra-toolbar" />
    {/if}
  {/if}
</div>

<style>
  .edra-wrap {
    border: 1px solid var(--panel-border);
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.2);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  :global(.edra-wrap .edra-editor) {
    min-height: var(--edra-min-height, 200px);
    padding: 0.75rem 1rem;
    color: var(--text-main);
  }
  :global(.edra-wrap .edra-editor .tiptap) {
    outline: none;
    min-height: var(--edra-min-height, 200px);
  }
  :global(.edra-wrap .edra-toolbar) {
    border-top: 1px solid var(--panel-border);
    padding: 0.5rem;
    display: flex;
    gap: 0.25rem;
    flex-wrap: wrap;
    background: rgba(0, 0, 0, 0.3);
  }
  :global(.edra-wrap .tiptap p.is-empty:first-child::before) {
    color: var(--text-muted);
    content: attr(data-placeholder);
    float: left;
    height: 0;
    pointer-events: none;
  }
</style>
