<script lang="ts">
  import { doc, getDoc, setDoc } from 'firebase/firestore';
  import { db } from '$lib/firebase/client';
  import { COLLECTIONS, DEFAULT_RUBRIK } from '$lib/firebase/constants';
  import { authState } from '$lib/stores/auth.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { logActivity } from '$lib/utils/activity-log';
  import AdminLayout from '$lib/components/AdminLayout.svelte';
  import type { RubrikConfig, QuestionLevel } from '$lib/firebase/types';

  type TabId = 'pretest' | 'posttest' | 'sub_criteria';

  let activeTab = $state<TabId>('pretest');
  let loading = $state(true);
  let saving = $state(false);
  let fromFirestore = $state(false);
  let rubrik = $state<RubrikConfig>(structuredClone(DEFAULT_RUBRIK));

  const LEVEL_LABEL: Record<QuestionLevel, { label: string; class: string }> = {
    easy: { label: 'Easy', class: 'badge-easy' },
    medium: { label: 'Medium', class: 'badge-medium' },
    hard: { label: 'Hard', class: 'badge-hard' }
  };

  const FIELD_LABELS: Record<string, string> = {
    benar: 'Jawaban Benar',
    salah: 'Jawaban Salah',
    kosong: 'Jawaban Kosong',
    benar_penjelasan: 'Benar + Penjelasan',
    benar_singkat: 'Benar Singkat',
    salah_penjelasan: 'Salah + Penjelasan',
    sesuai_petunjuk_max: 'Sesuai Petunjuk (max)',
    bte_max: 'Berjalan Tanpa Error (max)',
    tw_min: 'Tepat Waktu (min)',
    tw_max: 'Tepat Waktu (max)',
    max_raw: 'Max Raw (÷ untuk final score)'
  };

  const SC_CARDS: { key: 'keterampilan' | 'posttest_hard' | 'ujian_praktik'; title: string }[] = [
    { key: 'keterampilan', title: '🛠️ Keterampilan' },
    { key: 'posttest_hard', title: '📝 Posttest Hard' },
    { key: 'ujian_praktik', title: '🎯 Ujian Praktik' }
  ];

  function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = { ...target };
    for (const [k, v] of Object.entries(source)) {
      const t = target[k];
      if (
        v &&
        typeof v === 'object' &&
        !Array.isArray(v) &&
        t &&
        typeof t === 'object' &&
        !Array.isArray(t)
      ) {
        result[k] = deepMerge(t as Record<string, unknown>, v as Record<string, unknown>);
      } else if (v !== undefined) {
        result[k] = v;
      }
    }
    return result;
  }

  $effect(() => {
    if (authState.isAdmin && loading) {
      loadRubrik();
    }
  });

  async function loadRubrik() {
    try {
      const snap = await getDoc(doc(db, COLLECTIONS.rubrik, 'config'));
      if (snap.exists()) {
        const data = snap.data() as Record<string, unknown>;
        const merged = deepMerge(
          structuredClone(DEFAULT_RUBRIK) as unknown as Record<string, unknown>,
          data
        );
        rubrik = merged as unknown as RubrikConfig;
        fromFirestore = true;
      } else {
        rubrik = structuredClone(DEFAULT_RUBRIK);
        fromFirestore = false;
      }
    } catch (err) {
      console.error('Error loading rubrik:', err);
      toast.show('Gagal memuat rubrik, pakai default', 'error');
      rubrik = structuredClone(DEFAULT_RUBRIK);
      fromFirestore = false;
    } finally {
      loading = false;
    }
  }

  async function saveRubrik() {
    if (saving) return;
    saving = true;
    try {
      await setDoc(doc(db, COLLECTIONS.rubrik, 'config'), rubrik);
      fromFirestore = true;
      await logActivity({
        role: 'admin',
        nim: authState.mahasiswa?.nim ?? null,
        action: 'admin_write',
        message: 'Updated rubrik penilaian (config)'
      });
      toast.show('✅ Rubrik berhasil disimpan!', 'success');
    } catch (err) {
      console.error('Save rubrik error:', err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast.show(`Gagal menyimpan: ${message}`, 'error');
    } finally {
      saving = false;
    }
  }

  function resetToDefault() {
    if (!confirm('Reset semua nilai ke default bawaan?\n\nIni hanya merubah form — belum disimpan sampai klik "Simpan".')) {
      return;
    }
    rubrik = structuredClone(DEFAULT_RUBRIK);
    toast.show('Nilai direset ke default. Klik "Simpan" untuk persist.', 'success');
  }

  // Type-safe accessor untuk pretest/posttest field values
  function getPTValue(type: 'pretest' | 'posttest', level: QuestionLevel, key: string): number {
    const section = rubrik[type] as Record<string, Record<string, number>>;
    return section[level]?.[key] ?? 0;
  }

  function setPTValue(
    type: 'pretest' | 'posttest',
    level: QuestionLevel,
    key: string,
    value: number
  ) {
    const section = rubrik[type] as unknown as Record<string, Record<string, number>>;
    if (!section[level]) section[level] = {};
    section[level]![key] = value;
  }

  function getSCValue(
    cardKey: 'keterampilan' | 'posttest_hard' | 'ujian_praktik',
    field: string
  ): number {
    return (rubrik.sub_criteria[cardKey] as unknown as Record<string, number>)[field] ?? 0;
  }

  function setSCValue(
    cardKey: 'keterampilan' | 'posttest_hard' | 'ujian_praktik',
    field: string,
    value: number
  ) {
    (rubrik.sub_criteria[cardKey] as unknown as Record<string, number>)[field] = value;
  }
</script>

<AdminLayout title="Rubrik Penilaian">
  <section class="admin-section animate-fade-in">
    <div class="section-header">
      <h2>📊 Rubrik Penilaian</h2>
      <div style="display:flex; gap:0.5rem; align-items:center;">
        <span class="status-badge {fromFirestore ? 'status-active' : 'status-inactive'}">
          {fromFirestore ? '✅ Dari Firestore' : '⚙️ Menggunakan Default'}
        </span>
        <button class="secondary-btn" disabled={loading || saving} onclick={resetToDefault}>
          Reset ke Default
        </button>
        <button class="primary-btn" disabled={loading || saving} onclick={saveRubrik}>
          <span class="btn-text" class:loader-hidden={saving}>💾 Simpan Rubrik</span>
          <div
            class="spinner"
            style="width:16px;height:16px;border-width:2px;"
            class:loader-hidden={!saving}
          ></div>
        </button>
      </div>
    </div>

    {#if loading}
      <div style="text-align:center; padding:3rem;">
        <div class="spinner" style="width:40px;height:40px;border-width:3px; margin:0 auto;"></div>
        <p class="text-muted mt-4">Memuat rubrik...</p>
      </div>
    {:else}
      <!-- Tabs -->
      <div class="dash-card" style="margin-bottom:1rem;">
        <div class="dash-card-body" style="display:flex; gap:0.5rem; flex-wrap:wrap;">
          {#each ['pretest', 'posttest', 'sub_criteria'] as const as t (t)}
            <button
              class="tab-btn {activeTab === t ? 'active' : ''}"
              onclick={() => (activeTab = t)}
            >
              {t === 'pretest' ? '📘 Pretest' : t === 'posttest' ? '📕 Posttest' : '🎯 Sub-Kriteria'}
            </button>
          {/each}
        </div>
      </div>

      <!-- Tab Content -->
      {#if activeTab === 'pretest' || activeTab === 'posttest'}
        {@const tab = activeTab}
        {@const section = rubrik[tab]}
        <div class="dash-card">
          <div class="dash-card-body">
            {#each Object.entries(section) as [level, kategoriMap] (level)}
              {@const cfg = LEVEL_LABEL[level as QuestionLevel] ?? { label: level, class: '' }}
              <div class="rubrik-level-block">
                <div class="rubrik-level-title">
                  <span class="badge-label {cfg.class}">{cfg.label}</span>
                </div>
                {#each Object.keys(kategoriMap as Record<string, number>) as fieldKey (fieldKey)}
                  <div class="rubrik-row">
                    <span class="rubrik-label">{FIELD_LABELS[fieldKey] ?? fieldKey}</span>
                    <input
                      type="number"
                      class="rubrik-input"
                      min="0"
                      max="100"
                      value={getPTValue(tab, level as QuestionLevel, fieldKey)}
                      oninput={(e) =>
                        setPTValue(
                          tab,
                          level as QuestionLevel,
                          fieldKey,
                          Number((e.currentTarget as HTMLInputElement).value) || 0
                        )}
                    />
                    <span class="rubrik-unit">poin</span>
                  </div>
                {/each}
              </div>
            {/each}
          </div>
        </div>
      {:else}
        <!-- Sub-Criteria tab -->
        <div
          style="display:grid; gap:1rem; grid-template-columns:repeat(auto-fit, minmax(280px,1fr));"
        >
          {#each SC_CARDS as card (card.key)}
            {@const data = rubrik.sub_criteria[card.key] as unknown as Record<string, number>}
            <div class="card glass-panel sc-card">
              <div class="dash-card-body">
                <h4>{card.title}</h4>
                {#each Object.keys(data) as fieldKey (fieldKey)}
                  <div class="sc-row">
                    <label for="{card.key}-{fieldKey}">{FIELD_LABELS[fieldKey] ?? fieldKey}</label>
                    <input
                      id="{card.key}-{fieldKey}"
                      type="number"
                      min="0"
                      max="9999"
                      value={getSCValue(card.key, fieldKey)}
                      oninput={(e) =>
                        setSCValue(
                          card.key,
                          fieldKey,
                          Number((e.currentTarget as HTMLInputElement).value) || 0
                        )}
                    />
                  </div>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  </section>
</AdminLayout>
