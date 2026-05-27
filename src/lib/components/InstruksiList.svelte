<script lang="ts">
  /**
   * Editor list instruksi (soal + poin) untuk hard-mode posttest dan ujian praktik.
   * Support bulk import: JSON, pipe-separated, tab-separated.
   */
  import { toast } from '$lib/stores/toast.svelte';

  interface Item {
    soal: string;
    poin: number;
  }

  interface Props {
    items: Item[];
  }

  let { items = $bindable([]) }: Props = $props();

  let bulkText = $state('');
  let bulkOpen = $state(false);

  function addItem() {
    items = [...items, { soal: '', poin: 0 }];
  }

  function removeItem(i: number) {
    items = items.filter((_, idx) => idx !== i);
  }

  function parseBulk(text: string): Item[] {
    const trimmed = text.trim();
    if (!trimmed) return [];

    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown[];
        if (!Array.isArray(parsed)) throw new Error('JSON harus berupa array');
        return parsed
          .map((it) => {
            const obj = it as { soal?: unknown; instruksi?: unknown; poin?: unknown; poin_max?: unknown };
            return {
              soal: String(obj.soal ?? obj.instruksi ?? '').trim(),
              poin: Number(obj.poin ?? obj.poin_max ?? 0) || 0
            };
          })
          .filter((it) => it.soal);
      } catch (e) {
        throw new Error('JSON tidak valid: ' + (e instanceof Error ? e.message : String(e)));
      }
    }

    return trimmed
      .split(/\r?\n/)
      .map((line) => {
        const t = line.trim();
        if (!t) return null;
        const sep = t.includes('\t') ? '\t' : t.includes('|') ? '|' : null;
        if (!sep) return { soal: t, poin: 0 };
        const parts = t.split(sep).map((s) => s.trim());
        const lastNum = Number(parts[parts.length - 1]);
        if (parts.length >= 2 && !isNaN(lastNum) && parts[parts.length - 1] !== '') {
          const soal = parts.slice(0, -1).join(sep === '|' ? ' | ' : ' ').trim();
          if (!soal) return null;
          return { soal, poin: lastNum };
        }
        return { soal: parts.join(sep === '|' ? ' | ' : ' ').trim(), poin: 0 };
      })
      .filter((it): it is Item => it !== null);
  }

  function applyBulk() {
    try {
      const parsed = parseBulk(bulkText);
      if (parsed.length === 0) {
        toast.show('Tidak ada instruksi valid', 'error');
        return;
      }
      items = [...items, ...parsed];
      bulkText = '';
      bulkOpen = false;
      toast.show(`✅ ${parsed.length} instruksi ditambahkan`, 'success');
    } catch (e) {
      toast.show(`Parse gagal: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  }
</script>

<div class="instruksi-form-list" style="display:grid; gap:0.5rem;">
  {#each items as item, i (i)}
    <div
      class="instruksi-form-item"
      style="display:flex; gap:0.5rem; align-items:flex-start; padding:0.5rem; background:rgba(255,255,255,0.03); border-radius:6px;"
    >
      <textarea
        placeholder="Soal instruksi... (Markdown + LaTeX OK)"
        style="flex:1; min-height:60px;"
        bind:value={items[i].soal}
      ></textarea>
      <input
        type="number"
        placeholder="Poin"
        min="0"
        style="width:80px;"
        bind:value={items[i].poin}
      />
      <button
        type="button"
        class="btn-action btn-action-danger"
        onclick={() => removeItem(i)}
        title="Hapus"
      >
        ✕
      </button>
    </div>
  {/each}
</div>

<div style="display:flex; gap:0.5rem; margin-top:0.5rem;">
  <button type="button" class="secondary-btn" style="flex:1;" onclick={addItem}>
    + Tambah Instruksi
  </button>
  <button
    type="button"
    class="secondary-btn"
    style="flex:1;"
    onclick={() => (bulkOpen = !bulkOpen)}
  >
    📋 Import Banyak
  </button>
</div>

{#if bulkOpen}
  <div
    style="margin-top:0.5rem; padding:0.75rem 0.85rem; background:rgba(245,158,11,0.05); border:1px solid rgba(245,158,11,0.25); border-radius:8px;"
  >
    <div style="font-size:0.78rem; color:var(--text-muted); margin-bottom:0.5rem; line-height:1.55;">
      <strong style="color:var(--primary);">Format yang didukung (auto-detect):</strong><br />
      • <code>Soal | poin</code> per baris (pipe-separated)<br />
      • <code>Soal &#8633; poin</code> per baris (paste dari Excel/Sheets)<br />
      • JSON array: <code>{`[{"soal":"...","poin":1}, ...]`}</code><br />
    </div>
    <textarea
      rows="6"
      placeholder={'Menyertakan #include <stdio.h> | 1\nMenggunakan scanf() untuk input | 2\n...'}
      style="width:100%; font-family:'Fira Code',monospace; font-size:0.82rem; padding:0.6rem; background:rgba(0,0,0,0.3); border:1px solid var(--panel-border); border-radius:6px; color:var(--text-main); resize:vertical; box-sizing:border-box;"
      bind:value={bulkText}
    ></textarea>
    <div style="display:flex; gap:0.5rem; margin-top:0.5rem;">
      <button type="button" class="primary-btn" onclick={applyBulk}>Parse & Tambahkan</button>
      <button type="button" class="secondary-btn" onclick={() => (bulkOpen = false)}>Tutup</button>
    </div>
  </div>
{/if}
