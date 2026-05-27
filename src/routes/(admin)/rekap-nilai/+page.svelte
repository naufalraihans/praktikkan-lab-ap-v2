<script lang="ts">
  import { collection, getDocs, query, where } from 'firebase/firestore';
  import { db } from '$lib/firebase/client';
  import { COLLECTIONS, MODUL_INFO } from '$lib/firebase/constants';
  import { toast } from '$lib/stores/toast.svelte';
  import Navbar from '$lib/components/Navbar.svelte';
  import type { Mahasiswa, Jawaban, ModulId } from '$lib/firebase/types';

  // Module yang ditampilkan di rekap (selain uprak).
  const REKAP_MODULS: ModulId[] = ['m1', 'm2', 'm3', 'm45', 'm6'];

  interface StudentRow {
    nim: string;
    nama: string;
    pt: Partial<Record<ModulId, number | null>>;
    ket: Partial<Record<ModulId, number | null>>;
    uprak_nilai: number | null;
    uprak_breakdown: { total_sesi?: number }[];
  }

  let kelasList = $state<string[]>([]);
  let selectedKelas = $state('');
  let loadingKelas = $state(true);
  let loadingNilai = $state(false);
  let students = $state<StudentRow[]>([]);
  let hasLoaded = $state(false);

  $effect(() => {
    loadKelasOptions();
  });

  async function loadKelasOptions() {
    try {
      const snap = await getDocs(collection(db, COLLECTIONS.mahasiswa));
      const set = new Set<string>();
      snap.forEach((d) => {
        const data = d.data() as Mahasiswa;
        if (data.kelas) set.add(data.kelas);
      });
      kelasList = Array.from(set).sort();
      if (kelasList.length > 0 && kelasList[0]) {
        selectedKelas = kelasList[0];
      }
    } catch (err) {
      console.error('Error loading kelas:', err);
      toast.show('Gagal memuat daftar kelas', 'error');
    } finally {
      loadingKelas = false;
    }
  }

  async function loadNilai() {
    if (!selectedKelas) {
      toast.show('Pilih kelas dulu', 'error');
      return;
    }
    loadingNilai = true;
    students = [];
    hasLoaded = false;
    try {
      const q = query(
        collection(db, COLLECTIONS.jawaban),
        where('snapshot.kelas', '==', selectedKelas)
      );
      const snap = await getDocs(q);

      const map = new Map<string, StudentRow>();
      snap.forEach((d) => {
        const j = d.data() as Jawaban & { grading_detail?: { results?: { total_sesi?: number }[] } };
        const nim = j.nim;
        if (!map.has(nim)) {
          map.set(nim, {
            nim,
            nama: j.snapshot?.nama ?? nim,
            pt: {},
            ket: {},
            uprak_nilai: null,
            uprak_breakdown: []
          });
        }
        const row = map.get(nim)!;

        if (j.type === 'posttest') {
          row.pt[j.modul_id] = j.nilai;
        } else if (j.type === 'pretest') {
          if (row.pt[j.modul_id] === undefined || row.pt[j.modul_id] === null) {
            row.pt[j.modul_id] = j.nilai;
          }
        } else if (j.type === 'keterampilan') {
          row.ket[j.modul_id] = j.nilai;
        } else if (j.type === 'ujian_praktik') {
          row.uprak_nilai = j.nilai;
          if (j.grading_detail?.results) {
            row.uprak_breakdown = j.grading_detail.results;
          }
        }
      });

      students = Array.from(map.values()).sort((a, b) => a.nim.localeCompare(b.nim));
      hasLoaded = true;
    } catch (err) {
      console.error('Error loading nilai:', err);
      toast.show('Gagal memuat data nilai', 'error');
    } finally {
      loadingNilai = false;
    }
  }

  function formatNilai(val: number | null | undefined): string {
    if (val === null || val === undefined) return '—';
    return String(val);
  }

  const stats = $derived.by(() => ({
    total: students.length,
    withPt: students.filter((s) => Object.keys(s.pt).length > 0).length,
    withKet: students.filter((s) => Object.keys(s.ket).length > 0).length,
    withUprak: students.filter((s) => s.uprak_nilai !== null).length
  }));
</script>

<Navbar title="ADMIN PANEL" />

<main class="dashboard-content">
  <section class="admin-section animate-fade-in">
    <div class="section-header">
      <h2>📊 Rekap Nilai per Kelas</h2>
    </div>

    <div class="card glass-panel" style="margin-bottom:1.5rem;">
      <div class="card-body" style="display:flex; gap:1rem; align-items:center; flex-wrap:wrap;">
        <label for="kelas-select" style="color:var(--text-muted);">Kelas:</label>
        <select
          id="kelas-select"
          class="select-input select-small"
          disabled={loadingKelas}
          bind:value={selectedKelas}
        >
          <option value="">-- Pilih Kelas --</option>
          {#each kelasList as k (k)}
            <option value={k}>{k}</option>
          {/each}
        </select>
        <button
          class="primary-btn"
          disabled={!selectedKelas || loadingNilai}
          onclick={loadNilai}
        >
          <span class="btn-text" class:loader-hidden={loadingNilai}>Tampilkan Nilai</span>
          <div
            class="spinner"
            style="width:16px;height:16px;border-width:2px;"
            class:loader-hidden={!loadingNilai}
          ></div>
        </button>
      </div>
    </div>

    {#if hasLoaded && students.length > 0}
      <div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-bottom:1rem;">
        <span class="stat-chip">👤 Total: <strong>{stats.total}</strong></span>
        <span class="stat-chip">📝 PT: <strong>{stats.withPt}</strong></span>
        <span class="stat-chip">💻 Keterampilan: <strong>{stats.withKet}</strong></span>
        <span class="stat-chip">🎯 Uprak: <strong>{stats.withUprak}</strong></span>
      </div>
    {/if}

    {#if loadingNilai}
      <div style="text-align:center; padding:3rem;">
        <div class="spinner" style="width:40px;height:40px;border-width:3px; margin:0 auto;"></div>
        <p class="text-muted mt-4">Memuat data nilai...</p>
      </div>
    {:else if hasLoaded && students.length === 0}
      <div class="card glass-panel" style="text-align:center; padding:4rem 2rem;">
        <div style="font-size:3rem; margin-bottom:1rem; opacity:0.5;">📂</div>
        <h3 style="margin-bottom:0.5rem;">Belum ada data</h3>
        <p class="text-muted">Belum ada jawaban untuk kelas {selectedKelas}.</p>
      </div>
    {:else if hasLoaded}
      <div class="card glass-panel">
        <div style="overflow-x:auto;">
          <table class="rekap-table" style="width:100%; min-width: 1200px;">
            <thead>
              <tr>
                <th class="th-info" rowspan="2">No</th>
                <th class="th-info" rowspan="2">NIM</th>
                <th class="th-info" rowspan="2">Nama</th>
                <th class="th-pt" colspan={REKAP_MODULS.length}>📝 PT (Pre/Post-test)</th>
                <th class="th-ket" colspan={REKAP_MODULS.length}>💻 Keterampilan</th>
                <th class="th-uprak" colspan={7}>🎯 Ujian Praktik</th>
              </tr>
              <tr>
                {#each REKAP_MODULS as m (m + 'pt')}
                  <th class="th-pt">{MODUL_INFO[m].display_name.replace('Modul ', 'M')}</th>
                {/each}
                {#each REKAP_MODULS as m (m + 'ket')}
                  <th class="th-ket">{MODUL_INFO[m].display_name.replace('Modul ', 'M')}</th>
                {/each}
                {#each [1, 2, 3, 4, 5, 6] as i (i)}
                  <th class="th-uprak">S{i}</th>
                {/each}
                <th class="th-uprak">Total</th>
              </tr>
            </thead>
            <tbody>
              {#each students as s, idx (s.nim)}
                <tr>
                  <td>{idx + 1}</td>
                  <td class="td-nim">{s.nim}</td>
                  <td class="td-name">{s.nama}</td>
                  {#each REKAP_MODULS as m (m + 'pt')}
                    <td class="td-pt">
                      {#if s.pt[m] === null || s.pt[m] === undefined}
                        <span class="nilai-empty">—</span>
                      {:else}
                        {s.pt[m]}
                      {/if}
                    </td>
                  {/each}
                  {#each REKAP_MODULS as m (m + 'ket')}
                    <td class="td-ket">
                      {#if s.ket[m] === null || s.ket[m] === undefined}
                        <span class="nilai-empty">—</span>
                      {:else}
                        {s.ket[m]}
                      {/if}
                    </td>
                  {/each}
                  {#each [0, 1, 2, 3, 4, 5] as i (i)}
                    <td class="td-uprak">
                      {formatNilai(s.uprak_breakdown[i]?.total_sesi ?? null)}
                    </td>
                  {/each}
                  <td class="td-uprak">
                    <strong>{formatNilai(s.uprak_nilai)}</strong>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    {/if}
  </section>
</main>
