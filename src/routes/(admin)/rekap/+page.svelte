<script lang="ts">
  import {
    collection,
    getDocs,
    query,
    where,
    doc,
    deleteDoc,
    updateDoc,
    Timestamp
  } from 'firebase/firestore';
  import { db } from '$lib/firebase/client';
  import { COLLECTIONS, MODUL_INFO } from '$lib/firebase/constants';
  import { authState } from '$lib/stores/auth.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { logActivity } from '$lib/utils/activity-log';
  import { gradePT, gradeKeterampilan, gradeUjianPraktik } from '$lib/utils/grading';
  import { getDoc as fsGetDoc } from 'firebase/firestore';
  import AdminLayout from '$lib/components/AdminLayout.svelte';
  import type { Jawaban, ModulId, QuizType, SoalKeterampilan } from '$lib/firebase/types';

  type FilterType = 'all' | QuizType;
  type FilterModul = 'all' | ModulId;

  let allJawaban = $state<(Jawaban & { _id: string })[]>([]);
  let filterType = $state<FilterType>('all');
  let filterModul = $state<FilterModul>('all');
  let searchInput = $state('');
  let loading = $state(true);

  // Detail modal
  let detailOpen = $state(false);
  let detailData = $state<(Jawaban & { _id: string }) | null>(null);

  // Edit nilai modal
  let editNilaiOpen = $state(false);
  let editTarget = $state<(Jawaban & { _id: string }) | null>(null);
  let editNilai = $state<number | null>(null);
  let editKeaktifan = $state<number | null>(null);
  let savingNilai = $state(false);

  // Auto-grade state — track per-jawaban grading status
  let gradingIds = $state<Set<string>>(new Set());

  $effect(() => {
    if (authState.isAdmin) {
      filterType;
      filterModul;
      loadRekap();
    }
  });

  async function loadRekap() {
    loading = true;
    try {
      const constraints = [];
      if (filterType !== 'all') constraints.push(where('type', '==', filterType));
      if (filterModul !== 'all') constraints.push(where('modul_id', '==', filterModul));

      const q =
        constraints.length > 0
          ? query(collection(db, COLLECTIONS.jawaban), ...constraints)
          : query(collection(db, COLLECTIONS.jawaban));
      const snap = await getDocs(q);
      const list: (Jawaban & { _id: string })[] = [];
      snap.forEach((d) =>
        list.push({ ...(d.data() as Jawaban), _id: d.id })
      );
      allJawaban = list;
    } catch (err) {
      console.error('Load rekap error:', err);
      toast.show('Gagal memuat data rekap', 'error');
    } finally {
      loading = false;
    }
  }

  const filtered = $derived.by(() => {
    const search = searchInput.trim().toLowerCase();
    if (!search) return allJawaban;
    return allJawaban.filter((j) =>
      (j.snapshot?.nama ?? '').toLowerCase().includes(search) ||
      j.nim.toLowerCase().includes(search)
    );
  });

  const stats = $derived.by(() => {
    const total = filtered.length;
    const dinilai = filtered.filter((j) => j.nilai !== null && j.nilai !== undefined).length;
    return { total, dinilai, belum: total - dinilai };
  });

  const groupedByKelas = $derived.by(() => {
    const groups = new Map<string, (Jawaban & { _id: string })[]>();
    for (const j of filtered) {
      const kelas = j.snapshot?.kelas ?? 'Tidak Diketahui';
      if (!groups.has(kelas)) groups.set(kelas, []);
      groups.get(kelas)!.push(j);
    }
    // Sort within kelas by nama
    for (const list of groups.values()) {
      list.sort((a, b) => (a.snapshot?.nama ?? '').localeCompare(b.snapshot?.nama ?? ''));
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  });

  function typeLabel(type: QuizType): string {
    switch (type) {
      case 'pretest':
        return 'Pre-test';
      case 'posttest':
        return 'Post-test';
      case 'keterampilan':
        return 'Keterampilan';
      case 'ujian_praktik':
        return 'Ujian Praktik';
    }
  }

  function typeBadgeClass(type: QuizType): string {
    switch (type) {
      case 'pretest':
        return 'badge-easy';
      case 'posttest':
        return 'badge-medium';
      case 'keterampilan':
        return 'badge-hard';
      case 'ujian_praktik':
        return '';
    }
  }

  function formatTime(ts: Timestamp | null | undefined): string {
    if (!ts) return '-';
    if (ts instanceof Timestamp) {
      return ts.toDate().toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });
    }
    if (typeof ts === 'object' && 'seconds' in ts) {
      return new Date((ts as { seconds: number }).seconds * 1000).toLocaleString('id-ID', {
        dateStyle: 'short',
        timeStyle: 'short'
      });
    }
    return '-';
  }

  function showDetail(j: Jawaban & { _id: string }) {
    detailData = j;
    detailOpen = true;
  }

  function openEditNilai(j: Jawaban & { _id: string }) {
    editTarget = j;
    editNilai = j.nilai;
    editKeaktifan = ((j as unknown as { keaktifan?: number }).keaktifan) ?? null;
    editNilaiOpen = true;
  }

  async function saveNilai() {
    if (!editTarget || savingNilai) return;
    savingNilai = true;
    try {
      const updates: Record<string, unknown> = {
        nilai: editNilai === null || (editNilai as unknown) === '' ? null : Number(editNilai)
      };
      if (editKeaktifan !== null) {
        updates['keaktifan'] = Number(editKeaktifan);
      }
      await updateDoc(doc(db, COLLECTIONS.jawaban, editTarget._id), updates);
      await logActivity({
        role: 'admin',
        nim: authState.mahasiswa?.nim ?? null,
        action: 'admin_write',
        message: `Updated nilai jawaban ${editTarget._id}`
      });
      toast.show('Nilai disimpan', 'success');
      editNilaiOpen = false;
      editTarget = null;
      await loadRekap();
    } catch (err) {
      console.error(err);
      toast.show('Gagal simpan nilai', 'error');
    } finally {
      savingNilai = false;
    }
  }

  async function handleAutoGrade(j: Jawaban & { _id: string }) {
    if (gradingIds.has(j._id)) return;
    gradingIds.add(j._id);
    gradingIds = new Set(gradingIds);

    try {
      let result;
      if (j.type === 'pretest' || j.type === 'posttest') {
        result = await gradePT(j);
      } else if (j.type === 'keterampilan') {
        // Fetch rubrik items dari soal_v2
        const soalSnap = await fsGetDoc(doc(db, COLLECTIONS.soal, `${j.modul_id}_keterampilan`));
        if (!soalSnap.exists()) throw new Error('Rubrik keterampilan tidak ditemukan');
        const items = (soalSnap.data() as SoalKeterampilan).items;
        result = await gradeKeterampilan(j, items);
      } else if (j.type === 'ujian_praktik') {
        result = await gradeUjianPraktik(j);
      } else {
        throw new Error('Type tidak dikenali');
      }

      await updateDoc(doc(db, COLLECTIONS.jawaban, j._id), {
        nilai: result.nilai,
        grading_detail: result.grading_detail
      });
      await logActivity({
        role: 'admin',
        nim: authState.mahasiswa?.nim ?? null,
        action: 'admin_grade',
        message: `AI-graded ${j.snapshot?.nama ?? j.nim} (${j.type}) → nilai: ${result.nilai}`
      });
      toast.show(`✅ ${j.snapshot?.nama ?? j.nim}: ${result.nilai}`, 'success');
      await loadRekap();
    } catch (err) {
      console.error('Auto-grade error:', err);
      const message = err instanceof Error ? err.message : 'Unknown';
      toast.show(`Gagal grade: ${message}`, 'error');
    } finally {
      gradingIds.delete(j._id);
      gradingIds = new Set(gradingIds);
    }
  }

  async function handleDelete(j: Jawaban & { _id: string }) {
    if (!confirm(`Hapus jawaban ${j.snapshot?.nama ?? j.nim} (${typeLabel(j.type)})?`)) return;
    try {
      await deleteDoc(doc(db, COLLECTIONS.jawaban, j._id));
      await logActivity({
        role: 'admin',
        nim: authState.mahasiswa?.nim ?? null,
        action: 'admin_delete',
        message: `Deleted jawaban ${j._id}`
      });
      toast.show('Jawaban dihapus', 'success');
      await loadRekap();
    } catch (err) {
      console.error(err);
      toast.show('Gagal hapus', 'error');
    }
  }

  function nilaiAkhir(j: Jawaban): number | null {
    if (j.nilai === null || j.nilai === undefined) return null;
    const k = (j as unknown as { keaktifan?: number }).keaktifan ?? 0;
    return Number(j.nilai) + Number(k);
  }
</script>

<AdminLayout title="Rekap Jawaban">
  <section class="admin-section animate-fade-in">
    <div class="section-header">
      <h2>📋 Rekap Jawaban</h2>
      <button class="secondary-btn" onclick={loadRekap} disabled={loading}>Refresh</button>
    </div>

    <!-- Filter Bar -->
    <div class="dash-card" style="margin-bottom:1rem;">
      <div class="dash-card-body" style="display:flex; gap:1rem; flex-wrap:wrap; align-items:center;">
        <label for="filter-type" style="color:var(--text-muted);">Jenis:</label>
        <select id="filter-type" class="select-input select-small" bind:value={filterType}>
          <option value="all">Semua</option>
          <option value="pretest">Pre-test</option>
          <option value="posttest">Post-test</option>
          <option value="keterampilan">Keterampilan</option>
          <option value="ujian_praktik">Ujian Praktik</option>
        </select>

        <label for="filter-modul" style="color:var(--text-muted);">Modul:</label>
        <select id="filter-modul" class="select-input select-small" bind:value={filterModul}>
          <option value="all">Semua</option>
          <option value="m1">Modul 1</option>
          <option value="m2">Modul 2</option>
          <option value="m3">Modul 3</option>
          <option value="m45">Modul 4 & 5</option>
          <option value="m6">Modul 6</option>
          <option value="uprak">Ujian Praktik</option>
        </select>

        <input
          type="text"
          class="text-input"
          placeholder="Cari nama atau NIM..."
          bind:value={searchInput}
          style="flex:1; min-width:200px;"
        />
      </div>
    </div>

    <!-- Stats -->
    {#if !loading}
      <div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-bottom:1rem;">
        <span class="stat-chip">📊 Total: <strong>{stats.total}</strong></span>
        <span class="stat-chip">✅ Dinilai: <strong>{stats.dinilai}</strong></span>
        <span class="stat-chip">⏳ Belum: <strong>{stats.belum}</strong></span>
      </div>
    {/if}

    {#if loading}
      <div style="text-align:center; padding:3rem;">
        <div class="spinner" style="width:40px;height:40px;border-width:3px; margin:0 auto;"></div>
        <p class="text-muted mt-4">Memuat rekap...</p>
      </div>
    {:else if filtered.length === 0}
      <div class="dash-card" style="text-align:center; padding:4rem 2rem;">
        <div style="font-size:3rem; margin-bottom:1rem; opacity:0.5;">📂</div>
        <h3 style="margin-bottom:0.5rem;">Tidak ada data</h3>
        <p class="text-muted">Belum ada jawaban yang cocok dengan filter.</p>
      </div>
    {:else}
      {#each groupedByKelas as [kelas, students] (kelas)}
        <details class="dash-card" style="margin-bottom:1rem;" open>
          <summary
            style="padding: 0.75rem 1rem; cursor:pointer; display:flex; justify-content:space-between; align-items:center; user-select:none;"
          >
            <h3 style="margin:0;">📚 {kelas}</h3>
            <span class="badge">{students.length} jawaban</span>
          </summary>
          <div style="overflow-x:auto;">
            <table class="rekap-table" style="width:100%;">
              <thead>
                <tr>
                  <th>Nama</th>
                  <th>NIM</th>
                  <th>Jenis</th>
                  <th>Modul</th>
                  <th>Waktu</th>
                  <th>Nilai</th>
                  <th>Keaktifan</th>
                  <th>Nilai Akhir</th>
                  <th style="width:200px;">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {#each students as s (s._id)}
                  {@const k = (s as unknown as { keaktifan?: number }).keaktifan}
                  {@const akhir = nilaiAkhir(s)}
                  {@const aiGraded =
                    (s.grading_detail as { graded_by?: string } | null)?.graded_by === 'ai'}
                  <tr>
                    <td class="td-name">{s.snapshot?.nama ?? s.nim}</td>
                    <td class="td-nim">{s.nim}</td>
                    <td>
                      <span class="badge {typeBadgeClass(s.type)}">{typeLabel(s.type)}</span>
                    </td>
                    <td>{MODUL_INFO[s.modul_id]?.display_name ?? s.modul_id}</td>
                    <td class="td-time">{formatTime(s.submitted_at)}</td>
                    <td class="td-nilai">
                      {#if s.nilai === null || s.nilai === undefined}
                        <span class="text-muted">-</span>
                      {:else}
                        {s.nilai}{aiGraded ? ' 🤖' : ''}
                      {/if}
                    </td>
                    <td class="td-nilai">
                      {#if k === null || k === undefined}
                        <span class="text-muted">-</span>
                      {:else}
                        {k}
                      {/if}
                    </td>
                    <td class="td-nilai">
                      {#if akhir === null}
                        <span class="text-muted">-</span>
                      {:else}
                        <strong>{akhir}</strong>
                      {/if}
                    </td>
                    <td class="td-actions" style="white-space:nowrap;">
                      <button
                        class="btn-detail"
                        onclick={() => showDetail(s)}
                        title="Lihat Detail"
                      >
                        Detail
                      </button>
                      <button
                        class="btn-grade"
                        disabled={gradingIds.has(s._id)}
                        onclick={() => handleAutoGrade(s)}
                        title="Auto-Grade dengan AI"
                      >
                        {gradingIds.has(s._id) ? '⏳' : '🤖'}
                      </button>
                      <button
                        class="btn-detail"
                        style="background:rgba(245,158,11,0.15); color:#fbbf24; border-color:rgba(245,158,11,0.3);"
                        onclick={() => openEditNilai(s)}
                        title="Edit Nilai Manual"
                      >
                        📝
                      </button>
                      <button
                        class="btn-detail"
                        style="background:rgba(239,68,68,0.15); color:#ef4444; border-color:rgba(239,68,68,0.3);"
                        onclick={() => handleDelete(s)}
                        title="Hapus Jawaban"
                      >
                        🗑️
                      </button>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </details>
      {/each}
    {/if}
  </section>
</AdminLayout>

<!-- Detail Modal -->
{#if detailOpen && detailData}
  <div
    class="modal-overlay active"
    onclick={(e) => {
      if (e.target === e.currentTarget) detailOpen = false;
    }}
    role="presentation"
  >
    <div class="modal-content card glass-panel" style="max-width:900px;">
      <div class="dash-card-header">
        <h3>📄 Detail Jawaban</h3>
      </div>
      <div class="dash-card-body" style="max-height:75vh; overflow-y:auto;">
        <div class="info-row">
          <span class="label">Nama</span>
          <span class="value">{detailData.snapshot?.nama ?? '-'}</span>
        </div>
        <div class="info-row">
          <span class="label">NIM</span>
          <span class="value">{detailData.nim}</span>
        </div>
        <div class="info-row">
          <span class="label">Kelas</span>
          <span class="value">{detailData.snapshot?.kelas ?? '-'}</span>
        </div>
        <div class="info-row">
          <span class="label">Jenis</span>
          <span class="value">{typeLabel(detailData.type)}</span>
        </div>
        <div class="info-row">
          <span class="label">Modul</span>
          <span class="value">
            {MODUL_INFO[detailData.modul_id]?.display_name ?? detailData.modul_id}
          </span>
        </div>
        <div class="info-row">
          <span class="label">Tanggal</span>
          <span class="value">{detailData.tanggal}</span>
        </div>
        <div class="info-row">
          <span class="label">Submitted</span>
          <span class="value">{formatTime(detailData.submitted_at)}</span>
        </div>

        <hr style="margin: 1rem 0; border:none; border-top:1px solid var(--panel-border);" />

        <h4 style="margin-bottom:0.5rem;">Jawaban</h4>

        {#if detailData.type === 'keterampilan'}
          <p class="text-muted">Bahasa: <strong>{detailData.bahasa}</strong></p>
          <pre
            style="background:#1e1e1e; padding:1rem; border-radius:8px; overflow-x:auto; max-height:400px; color:#d4d4d4; font-family:'Fira Code',monospace; font-size:0.85rem;">
{detailData.kode}
          </pre>
        {:else if detailData.answers}
          {@const answers = detailData.answers as unknown as {
            nomor?: number;
            level?: string;
            soal?: string;
            deskripsi?: string;
            jawaban_mahasiswa?: string;
            jawaban_referensi?: string;
            bahasa?: string;
            kode?: string;
            opsi?: string | number;
          }[]}
          {#each answers as a, i (i)}
            <div
              class="dash-card"
              style="margin-bottom:0.75rem; padding:0.75rem 1rem;"
            >
              <div style="display:flex; gap:0.5rem; align-items:center; margin-bottom:0.5rem;">
                <strong>Soal {i + 1}</strong>
                {#if a.level}
                  <span class="badge badge-{a.level}">{a.level.toUpperCase()}</span>
                {/if}
                {#if a.opsi}
                  <span class="text-muted">Opsi {a.opsi}</span>
                {/if}
              </div>
              <p style="white-space:pre-wrap; margin-bottom:0.5rem;">
                {a.soal ?? a.deskripsi ?? '-'}
              </p>
              <div style="margin-bottom:0.5rem;">
                <strong style="color:var(--primary-hover);">Jawaban Mahasiswa:</strong>
                <pre
                  style="background:#1e1e1e; padding:0.75rem; border-radius:6px; overflow-x:auto; color:#d4d4d4; font-family:'Fira Code',monospace; font-size:0.85rem; margin:0.25rem 0;">
{a.jawaban_mahasiswa ?? a.kode ?? ''}
                </pre>
              </div>
              {#if a.jawaban_referensi}
                <details>
                  <summary style="cursor:pointer; color:var(--text-muted);">
                    Jawaban Referensi
                  </summary>
                  <pre
                    style="background:rgba(16,185,129,0.05); padding:0.75rem; border-radius:6px; overflow-x:auto; font-family:'Fira Code',monospace; font-size:0.85rem; margin:0.5rem 0;">
{a.jawaban_referensi}
                  </pre>
                </details>
              {/if}
            </div>
          {/each}
        {:else}
          <p class="text-muted">Tidak ada data jawaban.</p>
        {/if}

        {#if detailData.grading_detail}
          <hr style="margin: 1rem 0; border:none; border-top:1px solid var(--panel-border);" />
          <h4>Grading Detail</h4>
          <pre
            style="background:rgba(0,0,0,0.3); padding:0.75rem; border-radius:6px; overflow-x:auto; font-size:0.8rem; max-height:400px;">
{JSON.stringify(detailData.grading_detail, null, 2)}
          </pre>
        {/if}

        <div style="margin-top:1rem; text-align:right;">
          <button class="secondary-btn" onclick={() => (detailOpen = false)}>Tutup</button>
        </div>
      </div>
    </div>
  </div>
{/if}

<!-- Edit Nilai Modal -->
{#if editNilaiOpen && editTarget}
  <div
    class="modal-overlay active"
    onclick={(e) => {
      if (e.target === e.currentTarget) editNilaiOpen = false;
    }}
    role="presentation"
  >
    <div class="modal-content card glass-panel" style="max-width:500px;">
      <div class="dash-card-header">
        <h3>📝 Edit Nilai</h3>
      </div>
      <div class="dash-card-body">
        <p class="text-muted">
          {editTarget.snapshot?.nama} ({editTarget.nim}) — {typeLabel(editTarget.type)}
          {MODUL_INFO[editTarget.modul_id]?.display_name ?? editTarget.modul_id}
        </p>
        <div class="input-group">
          <label for="edit-nilai">Nilai (0-100)</label>
          <input
            id="edit-nilai"
            type="number"
            class="text-input"
            min="0"
            max="100"
            bind:value={editNilai}
          />
        </div>
        <div class="input-group">
          <label for="edit-keaktifan">Keaktifan (opsional)</label>
          <input
            id="edit-keaktifan"
            type="number"
            class="text-input"
            min="0"
            bind:value={editKeaktifan}
          />
        </div>
        <div style="display:flex; gap:0.5rem; justify-content:flex-end;">
          <button class="secondary-btn" onclick={() => (editNilaiOpen = false)}>Batal</button>
          <button class="primary-btn" disabled={savingNilai} onclick={saveNilai}>
            <span class="btn-text" class:loader-hidden={savingNilai}>Simpan</span>
            <div
              class="spinner"
              style="width:16px;height:16px;border-width:2px;"
              class:loader-hidden={!savingNilai}
            ></div>
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
  }
  .modal-content {
    width: 100%;
    max-height: 90vh;
    overflow-y: auto;
  }
</style>
