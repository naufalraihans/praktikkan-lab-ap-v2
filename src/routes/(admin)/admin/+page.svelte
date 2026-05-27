<script lang="ts">
  import {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    collection,
    getDocs,
    serverTimestamp,
    Timestamp
  } from 'firebase/firestore';
  import { db } from '$lib/firebase/client';
  import { COLLECTIONS, MODUL_INFO } from '$lib/firebase/constants';
  import { authState } from '$lib/stores/auth.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { logActivity } from '$lib/utils/activity-log';
  import AdminLayout from '$lib/components/AdminLayout.svelte';
  import type {
    ModulId,
    SoalQuiz,
    SoalKeterampilan,
    SoalUjianPraktik,
    Question,
    SesiReguler,
    SesiUjianPraktik
  } from '$lib/firebase/types';

  // Modul untuk reguler — uprak ada di bagian terpisah
  const REGULER_MODULS: ModulId[] = ['m1', 'm2', 'm3', 'm45', 'm6'];

  // === STATE ===
  let selectedModul = $state<ModulId>('m1');

  // Reguler
  let currentSesi = $state<SesiReguler | null>(null);
  let loadingSesi = $state(true);
  let generatedReguler = $state<{
    modul_id: ModulId;
    pretest_questions: Question[];
    posttest_questions: Question[];
    keterampilan_items: { referensi: string; kunci_jawaban: string; poin: number }[];
    keterampilan_judul_program: string;
    soal_refs: SesiReguler['soal_refs'];
  } | null>(null);
  let generating = $state(false);
  let activating = $state(false);
  let savingAkses = $state(false);

  // Akses toggles (local state, synced with currentSesi)
  let aksesPretest = $state(true);
  let aksesPosttest = $state(true);
  let aksesKeterampilan = $state(true);

  // Ujian Praktik
  let currentSesiUP = $state<SesiUjianPraktik | null>(null);
  let loadingSesiUP = $state(true);
  let generatedUP = $state<{ token: string; soal: SoalUjianPraktik[] } | null>(null);
  let generatingUP = $state(false);
  let activatingUP = $state(false);
  let savingAksesUP = $state(false);
  let aksesUP = $state(true);
  let copiedToken = $state(false);

  $effect(() => {
    if (authState.isAdmin) {
      loadCurrentSession();
      loadCurrentUPSession();
    }
  });

  // === LOAD SESI REGULER ===
  async function loadCurrentSession() {
    loadingSesi = true;
    try {
      const snap = await getDoc(doc(db, COLLECTIONS.sesi, 'reguler'));
      if (snap.exists()) {
        const data = snap.data() as SesiReguler;
        currentSesi = data;
        aksesPretest = data.akses?.pretest ?? true;
        aksesPosttest = data.akses?.posttest ?? true;
        aksesKeterampilan = data.akses?.keterampilan ?? true;
      } else {
        currentSesi = null;
      }
    } catch (err) {
      console.error('Error loading sesi:', err);
    } finally {
      loadingSesi = false;
    }
  }

  // === PICK BY LEVEL ===
  function pickByLevel(
    questions: Question[],
    distribution: { easy: number; medium: number; hard: number }
  ): Question[] {
    const grouped: Record<string, Question[]> = { easy: [], medium: [], hard: [] };
    for (const q of questions) {
      if (grouped[q.level]) grouped[q.level]!.push(q);
    }
    const picked: Question[] = [];
    for (const [level, count] of Object.entries(distribution)) {
      const pool = [...(grouped[level] ?? [])];
      // Fisher-Yates shuffle
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j]!, pool[i]!];
      }
      picked.push(...pool.slice(0, count));
    }
    picked.sort((a, b) => (a.nomor ?? 9999) - (b.nomor ?? 9999));
    return picked;
  }

  async function generateSoalReguler() {
    if (!selectedModul) {
      toast.show('Pilih modul dulu', 'error');
      return;
    }
    generating = true;
    try {
      const [preSnap, postSnap, ketSnap] = await Promise.all([
        getDoc(doc(db, COLLECTIONS.soal, `${selectedModul}_pretest`)),
        getDoc(doc(db, COLLECTIONS.soal, `${selectedModul}_posttest`)),
        getDoc(doc(db, COLLECTIONS.soal, `${selectedModul}_keterampilan`))
      ]);

      if (!preSnap.exists()) {
        toast.show(`Soal pretest ${selectedModul} tidak ditemukan`, 'error');
        return;
      }
      if (!postSnap.exists()) {
        toast.show(`Soal posttest ${selectedModul} tidak ditemukan`, 'error');
        return;
      }
      if (!ketSnap.exists()) {
        toast.show(`Soal keterampilan ${selectedModul} tidak ditemukan`, 'error');
        return;
      }

      const pretestData = preSnap.data() as SoalQuiz;
      const posttestData = postSnap.data() as SoalQuiz;
      const ketData = ketSnap.data() as SoalKeterampilan;

      const pretestPicked = pickByLevel(pretestData.questions, { easy: 1, medium: 2, hard: 2 });
      const posttestPicked = pickByLevel(posttestData.questions, { easy: 1, medium: 1, hard: 1 });

      generatedReguler = {
        modul_id: selectedModul,
        pretest_questions: pretestPicked,
        posttest_questions: posttestPicked,
        keterampilan_items: ketData.items,
        keterampilan_judul_program: ketData.judul_program ?? '',
        soal_refs: {
          pretest: `${selectedModul}_pretest`,
          posttest: `${selectedModul}_posttest`,
          keterampilan: `${selectedModul}_keterampilan`,
          pretest_question_ids: pretestPicked.map((q) => q.nomor),
          posttest_question_ids: posttestPicked.map((q) => q.nomor)
        }
      };
      toast.show('Soal berhasil di-generate', 'success');
    } catch (err) {
      console.error('Error generating soal:', err);
      toast.show('Gagal generate soal', 'error');
    } finally {
      generating = false;
    }
  }

  async function activateSesiReguler() {
    if (!generatedReguler) {
      toast.show('Generate soal dulu', 'error');
      return;
    }
    activating = true;
    try {
      const now = new Date();
      const data: SesiReguler = {
        kategori: 'reguler',
        modul_id: generatedReguler.modul_id,
        tanggal: now.toISOString().split('T')[0]!,
        created_at: Timestamp.now(),
        created_by: authState.mahasiswa?.nim ?? 'admin',
        akses: { pretest: true, posttest: true, keterampilan: true },
        soal_refs: generatedReguler.soal_refs,
        snapshot: {
          pretest_questions: generatedReguler.pretest_questions,
          posttest_questions: generatedReguler.posttest_questions,
          keterampilan_items: generatedReguler.keterampilan_items,
          keterampilan_judul_program: generatedReguler.keterampilan_judul_program
        }
      };
      await setDoc(doc(db, COLLECTIONS.sesi, 'reguler'), data);
      await logActivity({
        role: 'admin',
        nim: authState.mahasiswa?.nim ?? null,
        action: 'admin_write',
        message: `Activated sesi reguler ${MODUL_INFO[generatedReguler.modul_id].display_name}`
      });
      toast.show('Sesi reguler diaktifkan!', 'success');
      generatedReguler = null;
      await loadCurrentSession();
    } catch (err) {
      console.error('Activate error:', err);
      toast.show('Gagal mengaktifkan sesi', 'error');
    } finally {
      activating = false;
    }
  }

  async function saveAksesReguler() {
    if (!currentSesi) {
      toast.show('Belum ada sesi reguler', 'error');
      return;
    }
    savingAkses = true;
    try {
      await updateDoc(doc(db, COLLECTIONS.sesi, 'reguler'), {
        akses: { pretest: aksesPretest, posttest: aksesPosttest, keterampilan: aksesKeterampilan }
      });
      await logActivity({
        role: 'admin',
        nim: authState.mahasiswa?.nim ?? null,
        action: 'admin_write',
        message: 'Updated akses sesi reguler'
      });
      toast.show('Akses diperbarui', 'success');
      await loadCurrentSession();
    } catch (err) {
      console.error('Save akses error:', err);
      toast.show('Gagal menyimpan akses', 'error');
    } finally {
      savingAkses = false;
    }
  }

  // === UJIAN PRAKTIK ===
  async function loadCurrentUPSession() {
    loadingSesiUP = true;
    try {
      const snap = await getDoc(doc(db, COLLECTIONS.sesi, 'ujian_praktik'));
      if (snap.exists()) {
        const data = snap.data() as SesiUjianPraktik;
        currentSesiUP = data;
        aksesUP = data.akses?.ujian_praktik ?? true;
      } else {
        currentSesiUP = null;
      }
    } catch (err) {
      console.error('Error loading sesi UP:', err);
    } finally {
      loadingSesiUP = false;
    }
  }

  function generateToken(length = 6): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < length; i++) {
      s += chars[Math.floor(Math.random() * chars.length)];
    }
    return s;
  }

  async function generateUprakSoal() {
    generatingUP = true;
    try {
      const snap = await getDocs(collection(db, COLLECTIONS.soal));
      const allUP: (SoalUjianPraktik & { _id: string })[] = [];
      snap.forEach((d) => {
        const data = d.data() as SoalUjianPraktik;
        if (data.type === 'ujian_praktik') {
          allUP.push({ ...data, _id: d.id });
        }
      });

      // Group by legacy_origin
      const grouped: Record<string, (SoalUjianPraktik & { _id: string })[]> = {};
      for (const s of allUP) {
        const key = s.legacy_origin ?? 'unknown';
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(s);
      }

      const order = ['m1', 'm2', 'm3', 'm45', 'm6', 'flowchart'];
      const picked: SoalUjianPraktik[] = [];
      for (const origin of order) {
        const pool = grouped[origin];
        if (!pool || pool.length === 0) {
          console.warn(`No soal UP for origin: ${origin}`);
          continue;
        }
        const idx = Math.floor(Math.random() * pool.length);
        const { _id, ...rest } = pool[idx]!;
        picked.push(rest);
      }

      const token = generateToken();
      generatedUP = { token, soal: picked };
      toast.show('Soal UP berhasil di-generate', 'success');
    } catch (err) {
      console.error('Error generating UP:', err);
      toast.show('Gagal generate soal UP', 'error');
    } finally {
      generatingUP = false;
    }
  }

  async function activateSesiUP() {
    if (!generatedUP) {
      toast.show('Generate soal UP dulu', 'error');
      return;
    }
    activatingUP = true;
    try {
      // soal_refs reconstruct dari each soal: pakai pola sama dengan migration.
      const soalRefs = generatedUP.soal.map((s) => {
        if (s.legacy_origin === 'flowchart') {
          return `uprak_flowchart_${String(s.opsi).toLowerCase()}`;
        }
        return `uprak_${s.legacy_origin}_opsi${String(s.opsi).toLowerCase()}`;
      });

      const data: SesiUjianPraktik = {
        kategori: 'ujian_praktik',
        token: generatedUP.token,
        tanggal: new Date().toISOString().split('T')[0]!,
        created_at: Timestamp.now(),
        created_by: authState.mahasiswa?.nim ?? 'admin',
        akses: { ujian_praktik: true },
        soal_refs: soalRefs,
        snapshot: { soal: generatedUP.soal }
      };
      await setDoc(doc(db, COLLECTIONS.sesi, 'ujian_praktik'), data);
      await logActivity({
        role: 'admin',
        nim: authState.mahasiswa?.nim ?? null,
        action: 'admin_write',
        message: `Activated sesi ujian praktik (token: ${generatedUP.token})`
      });
      toast.show('Sesi UP diaktifkan!', 'success');
      generatedUP = null;
      await loadCurrentUPSession();
    } catch (err) {
      console.error('Activate UP error:', err);
      toast.show('Gagal mengaktifkan sesi UP', 'error');
    } finally {
      activatingUP = false;
    }
  }

  async function saveAksesUP() {
    if (!currentSesiUP) {
      toast.show('Belum ada sesi UP', 'error');
      return;
    }
    savingAksesUP = true;
    try {
      await updateDoc(doc(db, COLLECTIONS.sesi, 'ujian_praktik'), {
        akses: { ujian_praktik: aksesUP }
      });
      await logActivity({
        role: 'admin',
        nim: authState.mahasiswa?.nim ?? null,
        action: 'admin_write',
        message: 'Updated akses sesi ujian praktik'
      });
      toast.show('Akses UP diperbarui', 'success');
      await loadCurrentUPSession();
    } catch (err) {
      console.error('Save akses UP error:', err);
      toast.show('Gagal menyimpan akses UP', 'error');
    } finally {
      savingAksesUP = false;
    }
  }

  function copyToken() {
    const token = currentSesiUP?.token ?? generatedUP?.token;
    if (!token) return;
    navigator.clipboard.writeText(token);
    copiedToken = true;
    setTimeout(() => (copiedToken = false), 2000);
  }

  function formatDate(ts: Timestamp | null | undefined): string {
    if (!ts) return '-';
    if (ts instanceof Timestamp) return ts.toDate().toLocaleString('id-ID');
    if (typeof ts === 'object' && 'seconds' in ts) {
      return new Date((ts as { seconds: number }).seconds * 1000).toLocaleString('id-ID');
    }
    return '-';
  }
</script>

<AdminLayout title="Dashboard">
  <section class="admin-section animate-fade-in" style="margin-bottom: 2rem;">
    <div class="section-header">
      <h2>📚 Sesi Reguler (Pretest / Posttest / Keterampilan)</h2>
    </div>

    <!-- Current Session Info -->
    <div class="card glass-panel" style="margin-bottom:1rem;">
      <div class="card-header">
        <h3>Status Sesi Saat Ini</h3>
        <span
          class="status-badge {currentSesi ? 'status-active' : 'status-inactive'}"
          style="margin-left:auto;"
        >
          {currentSesi ? 'Sesi Aktif' : 'Tidak Ada Sesi'}
        </span>
      </div>
      {#if loadingSesi}
        <div class="card-body" style="text-align:center;">
          <div class="spinner" style="width:24px;height:24px;border-width:2px; margin:0 auto;"></div>
        </div>
      {:else if currentSesi}
        <div class="card-body">
          <div class="info-row">
            <span class="label">Modul</span>
            <span class="value">{MODUL_INFO[currentSesi.modul_id].display_name}</span>
          </div>
          <div class="info-row">
            <span class="label">Tanggal</span>
            <span class="value">{currentSesi.tanggal}</span>
          </div>
          <div class="info-row">
            <span class="label">Pre-test</span>
            <span class="value">{currentSesi.snapshot.pretest_questions.length} soal</span>
          </div>
          <div class="info-row">
            <span class="label">Post-test</span>
            <span class="value">{currentSesi.snapshot.posttest_questions.length} soal</span>
          </div>
          <div class="info-row">
            <span class="label">Keterampilan</span>
            <span class="value">{currentSesi.snapshot.keterampilan_items.length} item</span>
          </div>
          <div class="info-row">
            <span class="label">Dibuat</span>
            <span class="value">{formatDate(currentSesi.created_at)}</span>
          </div>
        </div>
      {:else}
        <div class="card-body">
          <p class="text-muted">Belum ada sesi yang diaktifkan.</p>
        </div>
      {/if}
    </div>

    <!-- Akses Controls -->
    {#if currentSesi}
      <div class="card glass-panel" style="margin-bottom:1rem;">
        <div class="card-header">
          <h3>🔓 Akses Mahasiswa</h3>
        </div>
        <div class="card-body" style="display:flex; gap:1rem; flex-wrap:wrap; align-items:center;">
          <label style="display:flex; gap:0.5rem; align-items:center;">
            <input type="checkbox" bind:checked={aksesPretest} /> Pre-test
          </label>
          <label style="display:flex; gap:0.5rem; align-items:center;">
            <input type="checkbox" bind:checked={aksesPosttest} /> Post-test
          </label>
          <label style="display:flex; gap:0.5rem; align-items:center;">
            <input type="checkbox" bind:checked={aksesKeterampilan} /> Keterampilan
          </label>
          <button class="primary-btn" disabled={savingAkses} onclick={saveAksesReguler}>
            <span class="btn-text" class:loader-hidden={savingAkses}>Simpan Akses</span>
            <div
              class="spinner"
              style="width:16px;height:16px;border-width:2px;"
              class:loader-hidden={!savingAkses}
            ></div>
          </button>
        </div>
      </div>
    {/if}

    <!-- Generate New Session -->
    <div class="card glass-panel">
      <div class="card-header">
        <h3>✨ Generate Sesi Baru</h3>
      </div>
      <div class="card-body" style="display:flex; gap:1rem; flex-wrap:wrap; align-items:center;">
        <label for="select-modul" style="color:var(--text-muted);">Modul:</label>
        <select id="select-modul" class="select-input select-small" bind:value={selectedModul}>
          {#each REGULER_MODULS as m (m)}
            <option value={m}>{MODUL_INFO[m].display_name}</option>
          {/each}
        </select>
        <button class="primary-btn" disabled={generating} onclick={generateSoalReguler}>
          <span class="btn-text" class:loader-hidden={generating}>🎲 Generate Soal</span>
          <div
            class="spinner"
            style="width:16px;height:16px;border-width:2px;"
            class:loader-hidden={!generating}
          ></div>
        </button>
        {#if generatedReguler}
          <button class="primary-btn btn-activate" disabled={activating} onclick={activateSesiReguler}>
            <span class="btn-text" class:loader-hidden={activating}>🚀 Aktifkan Sesi</span>
            <div
              class="spinner"
              style="width:16px;height:16px;border-width:2px;"
              class:loader-hidden={!activating}
            ></div>
          </button>
        {/if}
      </div>
      {#if generatedReguler}
        <div class="card-body" style="border-top: 1px solid rgba(255,255,255,0.1);">
          <p class="text-muted" style="margin-bottom:0.5rem;">Preview soal yang akan diaktifkan:</p>
          <div style="display:grid; gap:0.5rem; grid-template-columns:repeat(auto-fit, minmax(200px,1fr));">
            <div class="info-row">
              <span class="label">Pretest</span>
              <span class="value">{generatedReguler.pretest_questions.length} soal</span>
            </div>
            <div class="info-row">
              <span class="label">Posttest</span>
              <span class="value">{generatedReguler.posttest_questions.length} soal</span>
            </div>
            <div class="info-row">
              <span class="label">Keterampilan</span>
              <span class="value">{generatedReguler.keterampilan_items.length} item</span>
            </div>
          </div>
        </div>
      {/if}
    </div>
  </section>

  <!-- ===== UJIAN PRAKTIK ===== -->
  <section class="admin-section animate-fade-in">
    <div class="section-header">
      <h2>🎯 Sesi Ujian Praktik</h2>
    </div>

    <div class="card glass-panel" style="margin-bottom:1rem;">
      <div class="card-header">
        <h3>Status Sesi UP</h3>
        <span
          class="status-badge {currentSesiUP ? 'status-active' : 'status-inactive'}"
          style="margin-left:auto;"
        >
          {currentSesiUP ? 'Sesi UP Aktif' : 'Tidak Ada Sesi UP'}
        </span>
      </div>
      {#if loadingSesiUP}
        <div class="card-body" style="text-align:center;">
          <div class="spinner" style="width:24px;height:24px;border-width:2px; margin:0 auto;"></div>
        </div>
      {:else if currentSesiUP}
        <div class="card-body">
          <div class="info-row">
            <span class="label">Token</span>
            <span class="value" style="display:flex; gap:0.5rem; align-items:center;">
              <code
                style="font-family:'Fira Code',monospace; font-weight:700; letter-spacing:2px; color:var(--primary-hover);"
                >{currentSesiUP.token}</code
              >
              <button class="secondary-btn" style="padding:0.25rem 0.5rem;" onclick={copyToken}>
                {copiedToken ? '✅ Copied' : '📋 Copy'}
              </button>
            </span>
          </div>
          <div class="info-row">
            <span class="label">Tanggal</span>
            <span class="value">{currentSesiUP.tanggal}</span>
          </div>
          <div class="info-row">
            <span class="label">Jumlah Soal</span>
            <span class="value">{currentSesiUP.snapshot.soal.length} soal</span>
          </div>
          <div class="info-row">
            <span class="label">Dibuat</span>
            <span class="value">{formatDate(currentSesiUP.created_at)}</span>
          </div>
        </div>
      {:else}
        <div class="card-body">
          <p class="text-muted">Belum ada sesi ujian praktik yang diaktifkan.</p>
        </div>
      {/if}
    </div>

    {#if currentSesiUP}
      <div class="card glass-panel" style="margin-bottom:1rem;">
        <div class="card-header">
          <h3>🔓 Akses UP</h3>
        </div>
        <div class="card-body" style="display:flex; gap:1rem; align-items:center;">
          <label style="display:flex; gap:0.5rem; align-items:center;">
            <input type="checkbox" bind:checked={aksesUP} /> Akses UP terbuka
          </label>
          <button class="primary-btn" disabled={savingAksesUP} onclick={saveAksesUP}>
            <span class="btn-text" class:loader-hidden={savingAksesUP}>Simpan Akses</span>
            <div
              class="spinner"
              style="width:16px;height:16px;border-width:2px;"
              class:loader-hidden={!savingAksesUP}
            ></div>
          </button>
        </div>
      </div>
    {/if}

    <div class="card glass-panel">
      <div class="card-header">
        <h3>✨ Generate Sesi UP Baru</h3>
      </div>
      <div class="card-body" style="display:flex; gap:1rem; align-items:center; flex-wrap:wrap;">
        <button class="primary-btn" disabled={generatingUP} onclick={generateUprakSoal}>
          <span class="btn-text" class:loader-hidden={generatingUP}>🎲 Generate UP</span>
          <div
            class="spinner"
            style="width:16px;height:16px;border-width:2px;"
            class:loader-hidden={!generatingUP}
          ></div>
        </button>
        {#if generatedUP}
          <button class="primary-btn btn-activate" disabled={activatingUP} onclick={activateSesiUP}>
            <span class="btn-text" class:loader-hidden={activatingUP}>🚀 Aktifkan Sesi UP</span>
            <div
              class="spinner"
              style="width:16px;height:16px;border-width:2px;"
              class:loader-hidden={!activatingUP}
            ></div>
          </button>
          <span style="margin-left:auto;">
            Token: <code
              style="font-family:'Fira Code',monospace; font-weight:700; letter-spacing:2px; color:var(--primary-hover);"
              >{generatedUP.token}</code
            >
          </span>
        {/if}
      </div>
      {#if generatedUP}
        <div class="card-body" style="border-top: 1px solid rgba(255,255,255,0.1);">
          <p class="text-muted" style="margin-bottom:0.5rem;">Preview soal UP:</p>
          <ul style="list-style:none; padding:0; display:grid; gap:0.25rem;">
            {#each generatedUP.soal as s, i (i)}
              <li class="info-row">
                <span class="label">#{i + 1}</span>
                <span class="value">
                  {s.legacy_origin === 'flowchart'
                    ? `Flowchart Opsi ${String(s.opsi).toUpperCase()}`
                    : `${s.legacy_origin?.toUpperCase()} Opsi ${s.opsi} (${s.bahasa === 'c' ? 'C' : 'Python'})`}
                </span>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>
  </section>
</AdminLayout>
