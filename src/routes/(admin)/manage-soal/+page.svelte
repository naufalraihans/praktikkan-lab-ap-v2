<script lang="ts">
  import {
    doc,
    getDoc,
    setDoc,
    deleteDoc,
    collection,
    getDocs,
    query,
    where
  } from 'firebase/firestore';
  import { db } from '$lib/firebase/client';
  import { COLLECTIONS, MODUL_INFO } from '$lib/firebase/constants';
  import { authState } from '$lib/stores/auth.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { logActivity } from '$lib/utils/activity-log';
  import { renderMarkdownToHtml } from '$lib/utils/markdown';
  import { renderMathJax } from '$lib/utils/monaco';
  import {
    uploadImageToGithub,
    getGithubPat,
    setGithubPat
  } from '$lib/utils/github-upload';
  import AdminLayout from '$lib/components/AdminLayout.svelte';
  import MarkdownEditor from '$lib/components/MarkdownEditor.svelte';
  import InstruksiList from '$lib/components/InstruksiList.svelte';
  import type {
    ModulId,
    Question,
    KeterampilanItem,
    SoalQuiz,
    SoalKeterampilan,
    SoalUjianPraktik,
    Bahasa,
    QuestionLevel
  } from '$lib/firebase/types';

  type Tipe = 'pretest' | 'posttest' | 'keterampilan' | 'ujian_praktik';
  type ModulOrFlowchart = ModulId | 'flowchart';

  const REGULER_MODULS: ModulId[] = ['m1', 'm2', 'm3', 'm45', 'm6'];
  const MODUL_BAHASA: Record<ModulId, Bahasa> = {
    m1: 'c',
    m2: 'c',
    m3: 'c',
    m45: 'python',
    m6: 'python',
    uprak: 'c'
  };

  // === STATE ===
  let currentTipe = $state<Tipe>('pretest');
  let currentModul = $state<ModulOrFlowchart>('m1');
  let loading = $state(false);

  // Quiz (pretest/posttest)
  let quizQuestions = $state<Question[]>([]);
  // Keterampilan
  let ketItems = $state<KeterampilanItem[]>([]);
  let ketJudulProgram = $state('');
  let judulEditOpen = $state(false);
  let judulEditValue = $state('');
  // Ujian praktik
  let uprakSoal = $state<(SoalUjianPraktik & { _id: string })[]>([]);

  // Modal state
  let modalOpen = $state(false);
  let modalTitle = $state('');
  // editingKey: number = index (quiz/ket), string = doc id (uprak), null = new
  let editingKey = $state<number | string | null>(null);

  // Form fields (re-used across types — page reads only the ones relevant)
  let fNomor = $state(1);
  let fLevel = $state<QuestionLevel>('easy');
  let fSoal = $state('');
  let fJawaban = $state('');
  let fHardMode = $state(false);
  let fOpsi = $state<number | string>(1);
  let fDeskripsi = $state('');
  let fInstruksi = $state<{ soal: string; poin: number }[]>([]);
  let fReferensi = $state('');
  let fKunciJawaban = $state('');
  let fPoin = $state(0);
  let fUpType = $state<'coding' | 'flowchart'>('coding');
  let fFcGambar = $state(''); // existing image filename
  let fFcFile = $state<File | null>(null);
  let saving = $state(false);

  // GitHub PAT
  let githubPat = $state(getGithubPat());

  $effect(() => {
    if (authState.isAdmin) {
      loadList();
    }
  });

  // Re-load when tab or modul changes
  $effect(() => {
    currentTipe;
    currentModul;
    if (authState.isAdmin) {
      loadList();
    }
  });

  async function loadList() {
    loading = true;
    try {
      if (currentTipe === 'pretest' || currentTipe === 'posttest') {
        if (currentModul === 'flowchart') {
          quizQuestions = [];
          return;
        }
        const snap = await getDoc(doc(db, COLLECTIONS.soal, `${currentModul}_${currentTipe}`));
        const data = snap.exists() ? (snap.data() as SoalQuiz) : null;
        quizQuestions = data?.questions ?? [];
      } else if (currentTipe === 'keterampilan') {
        if (currentModul === 'flowchart') {
          ketItems = [];
          ketJudulProgram = '';
          return;
        }
        const snap = await getDoc(doc(db, COLLECTIONS.soal, `${currentModul}_keterampilan`));
        const data = snap.exists() ? (snap.data() as SoalKeterampilan) : null;
        ketItems = data?.items ?? [];
        ketJudulProgram = data?.judul_program ?? '';
      } else if (currentTipe === 'ujian_praktik') {
        const q = query(collection(db, COLLECTIONS.soal), where('type', '==', 'ujian_praktik'));
        const snap = await getDocs(q);
        const all: (SoalUjianPraktik & { _id: string })[] = [];
        snap.forEach((d) => all.push({ ...(d.data() as SoalUjianPraktik), _id: d.id }));

        if (currentModul === 'flowchart') {
          uprakSoal = all.filter((s) => s.legacy_origin === 'flowchart');
        } else {
          uprakSoal = all.filter((s) => s.legacy_origin === currentModul);
        }
      }
    } catch (err) {
      console.error('Load list error:', err);
      toast.show('Gagal memuat soal', 'error');
    } finally {
      loading = false;
    }
  }

  // === FORM OPEN ===
  function openAddModal() {
    editingKey = null;
    modalTitle = 'Tambah Soal';
    resetForm();
    if (currentTipe === 'ujian_praktik') {
      fUpType = currentModul === 'flowchart' ? 'flowchart' : 'coding';
    }
    modalOpen = true;
  }

  function openEditQuiz(i: number) {
    const q = quizQuestions[i];
    if (!q) return;
    editingKey = i;
    modalTitle = 'Edit Soal';
    resetForm();
    if (q.level === 'hard' && q.instruksi) {
      fHardMode = true;
      fOpsi = q.opsi ?? '';
      fDeskripsi = q.deskripsi ?? '';
      fJawaban = q.jawaban_referensi ?? '';
      fInstruksi = q.instruksi.map((it) => ({ ...it }));
    } else {
      fNomor = q.nomor;
      fLevel = q.level;
      fSoal = q.soal;
      fJawaban = q.jawaban_referensi;
    }
    modalOpen = true;
  }

  function openEditKet(i: number) {
    const item = ketItems[i];
    if (!item) return;
    editingKey = i;
    modalTitle = 'Edit Soal';
    resetForm();
    fReferensi = item.referensi;
    fKunciJawaban = item.kunci_jawaban;
    fPoin = item.poin;
    modalOpen = true;
  }

  function openEditUprak(s: SoalUjianPraktik & { _id: string }) {
    editingKey = s._id;
    modalTitle = 'Edit Soal';
    resetForm();
    const isFlowchart = s.legacy_origin === 'flowchart';
    fUpType = isFlowchart ? 'flowchart' : 'coding';
    fOpsi = s.opsi;
    fDeskripsi = s.deskripsi;
    fJawaban = s.jawaban_referensi ?? '';
    fInstruksi = (s.instruksi ?? []).map((it) => ({ ...it }));
    fFcGambar = s.gambar ?? '';
    fPoin = s.poin ?? 25;
    modalOpen = true;
  }

  function resetForm() {
    fNomor = 1;
    fLevel = 'easy';
    fSoal = '';
    fJawaban = '';
    fHardMode = false;
    fOpsi = 1;
    fDeskripsi = '';
    fInstruksi = [];
    fReferensi = '';
    fKunciJawaban = '';
    fPoin = 0;
    fUpType = 'coding';
    fFcGambar = '';
    fFcFile = null;
  }

  function closeModal() {
    modalOpen = false;
    editingKey = null;
  }

  // === SAVE ===
  async function save() {
    if (saving) return;
    saving = true;
    try {
      if (currentTipe === 'pretest' || currentTipe === 'posttest') {
        await saveQuiz();
      } else if (currentTipe === 'keterampilan') {
        await saveKeterampilan();
      } else if (currentTipe === 'ujian_praktik') {
        await saveUprak();
      }
      await logActivity({
        role: 'admin',
        nim: authState.mahasiswa?.nim ?? null,
        action: 'admin_write',
        message: `${editingKey !== null ? 'Updated' : 'Added'} soal ${currentTipe} ${currentModul}`
      });
      toast.show('Soal disimpan!', 'success');
      closeModal();
      await loadList();
    } catch (err) {
      console.error('Save error:', err);
      const message = err instanceof Error ? err.message : 'Unknown';
      toast.show(`Gagal: ${message}`, 'error');
    } finally {
      saving = false;
    }
  }

  async function saveQuiz() {
    if (currentModul === 'flowchart') throw new Error('Quiz tidak bisa untuk flowchart');
    const modulId = currentModul;

    let soalObj: Question;
    if (fHardMode) {
      soalObj = {
        nomor: typeof fOpsi === 'number' ? fOpsi : Number(fOpsi) || 1,
        level: 'hard',
        soal: fDeskripsi,
        jawaban_referensi: fJawaban,
        opsi: fOpsi,
        deskripsi: fDeskripsi,
        instruksi: fInstruksi.filter((it) => it.soal.trim())
      };
    } else {
      soalObj = {
        nomor: fNomor,
        level: fLevel,
        soal: fSoal,
        jawaban_referensi: fJawaban
      };
    }

    const newQuestions = [...quizQuestions];
    if (typeof editingKey === 'number') {
      newQuestions[editingKey] = soalObj;
    } else {
      newQuestions.push(soalObj);
    }

    const data: SoalQuiz = {
      modul_id: modulId,
      type: currentTipe as 'pretest' | 'posttest',
      questions: newQuestions
    };
    await setDoc(doc(db, COLLECTIONS.soal, `${modulId}_${currentTipe}`), data);
  }

  async function saveKeterampilan() {
    if (currentModul === 'flowchart') throw new Error('Keterampilan tidak bisa untuk flowchart');
    const modulId = currentModul;

    const itemObj: KeterampilanItem = {
      referensi: fReferensi,
      kunci_jawaban: fKunciJawaban,
      poin: fPoin
    };

    const newItems = [...ketItems];
    if (typeof editingKey === 'number') {
      newItems[editingKey] = itemObj;
    } else {
      newItems.push(itemObj);
    }

    const data: SoalKeterampilan = {
      modul_id: modulId,
      type: 'keterampilan',
      judul_program: ketJudulProgram,
      items: newItems
    };
    await setDoc(doc(db, COLLECTIONS.soal, `${modulId}_keterampilan`), data);
  }

  async function saveUprak() {
    const isFlowchart = fUpType === 'flowchart';
    let gambar = fFcGambar;

    if (isFlowchart && fFcFile) {
      if (!githubPat) throw new Error('GitHub PAT belum disimpan!');
      const ext = fFcFile.name.split('.').pop()?.toLowerCase() ?? 'jpg';
      const fileName = `flowchart_${String(fOpsi).toLowerCase()}.${ext}`;
      await uploadImageToGithub(fFcFile, `data/soal/ujianPraktik/${fileName}`);
      gambar = fileName;
    }

    const docId = isFlowchart
      ? `uprak_flowchart_${String(fOpsi).toLowerCase()}`
      : `uprak_${currentModul === 'flowchart' ? 'm1' : currentModul}_opsi${String(fOpsi).toLowerCase()}`;

    const legacy_origin = isFlowchart
      ? 'flowchart'
      : currentModul === 'flowchart'
        ? 'm1'
        : currentModul;

    const data: SoalUjianPraktik = {
      modul_id: 'uprak',
      type: 'ujian_praktik',
      opsi: fOpsi,
      bahasa: isFlowchart ? 'free' : (MODUL_BAHASA[legacy_origin as ModulId] ?? 'c'),
      deskripsi: fDeskripsi,
      instruksi: fInstruksi.filter((it) => it.soal.trim()),
      legacy_origin,
      legacy_id: docId
    };
    if (!isFlowchart && fJawaban) data.jawaban_referensi = fJawaban;
    if (isFlowchart) {
      data.gambar = gambar;
      data.poin = fPoin || 25;
    }

    await setDoc(doc(db, COLLECTIONS.soal, docId), data);

    // Kalau editingKey beda dari new docId (rare: ganti opsi/type), delete old
    if (typeof editingKey === 'string' && editingKey !== docId) {
      await deleteDoc(doc(db, COLLECTIONS.soal, editingKey));
    }
  }

  // === DELETE ===
  async function deleteQuiz(i: number) {
    if (!confirm('Hapus soal ini?')) return;
    if (currentModul === 'flowchart') return;
    try {
      const newQuestions = quizQuestions.filter((_, idx) => idx !== i);
      const data: SoalQuiz = {
        modul_id: currentModul,
        type: currentTipe as 'pretest' | 'posttest',
        questions: newQuestions
      };
      await setDoc(doc(db, COLLECTIONS.soal, `${currentModul}_${currentTipe}`), data);
      await logActivity({
        role: 'admin',
        nim: authState.mahasiswa?.nim ?? null,
        action: 'admin_delete',
        message: `Deleted soal ${currentTipe} #${i + 1} ${currentModul}`
      });
      toast.show('Soal dihapus', 'success');
      await loadList();
    } catch (err) {
      console.error(err);
      toast.show('Gagal hapus', 'error');
    }
  }

  async function deleteKet(i: number) {
    if (!confirm('Hapus item ini?')) return;
    if (currentModul === 'flowchart') return;
    try {
      const newItems = ketItems.filter((_, idx) => idx !== i);
      const data: SoalKeterampilan = {
        modul_id: currentModul,
        type: 'keterampilan',
        judul_program: ketJudulProgram,
        items: newItems
      };
      await setDoc(doc(db, COLLECTIONS.soal, `${currentModul}_keterampilan`), data);
      await logActivity({
        role: 'admin',
        nim: authState.mahasiswa?.nim ?? null,
        action: 'admin_delete',
        message: `Deleted keterampilan item #${i + 1} ${currentModul}`
      });
      toast.show('Item dihapus', 'success');
      await loadList();
    } catch (err) {
      console.error(err);
      toast.show('Gagal hapus', 'error');
    }
  }

  async function deleteUprak(docId: string) {
    if (!confirm('Hapus soal ini?')) return;
    try {
      await deleteDoc(doc(db, COLLECTIONS.soal, docId));
      await logActivity({
        role: 'admin',
        nim: authState.mahasiswa?.nim ?? null,
        action: 'admin_delete',
        message: `Deleted soal ujian praktik ${docId}`
      });
      toast.show('Soal dihapus', 'success');
      await loadList();
    } catch (err) {
      console.error(err);
      toast.show('Gagal hapus', 'error');
    }
  }

  async function saveJudulProgram() {
    if (currentModul === 'flowchart') return;
    try {
      await setDoc(doc(db, COLLECTIONS.soal, `${currentModul}_keterampilan`), {
        modul_id: currentModul,
        type: 'keterampilan',
        judul_program: judulEditValue.trim(),
        items: ketItems
      } satisfies SoalKeterampilan);
      ketJudulProgram = judulEditValue.trim();
      judulEditOpen = false;
      toast.show('Judul disimpan', 'success');
      await logActivity({
        role: 'admin',
        nim: authState.mahasiswa?.nim ?? null,
        action: 'admin_write',
        message: `Updated judul program ${currentModul}: ${ketJudulProgram}`
      });
    } catch (err) {
      console.error(err);
      toast.show('Gagal simpan judul', 'error');
    }
  }

  // For showing rendered markdown previews in cards
  let cardsContainer = $state<HTMLDivElement | null>(null);
  $effect(() => {
    quizQuestions;
    ketItems;
    uprakSoal;
    if (cardsContainer) {
      setTimeout(() => renderMathJax(cardsContainer), 100);
    }
  });

  function handleFcFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file) fFcFile = file;
  }

  function savePat() {
    setGithubPat(githubPat);
    toast.show('GitHub PAT disimpan', 'success');
  }
</script>

<AdminLayout title="Manage Soal">
  <section class="admin-section animate-fade-in">
    <div class="section-header">
      <h2>📝 Manage Soal</h2>
      <button class="primary-btn" onclick={openAddModal}>+ Tambah Soal</button>
    </div>

    <!-- Tabs -->
    <div class="dash-card" style="margin-bottom:1rem;">
      <div class="dash-card-body" style="display:flex; gap:0.5rem; flex-wrap:wrap;">
        {#each ['pretest', 'posttest', 'keterampilan', 'ujian_praktik'] as const as t (t)}
          <button
            class="tab-btn"
            class:active={currentTipe === t}
            onclick={() => (currentTipe = t)}
          >
            {t === 'ujian_praktik' ? 'Ujian Praktik' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        {/each}
      </div>
    </div>

    <!-- Modul + GitHub PAT -->
    <div class="dash-card" style="margin-bottom:1rem;">
      <div class="dash-card-body" style="display:flex; gap:1rem; flex-wrap:wrap; align-items:center;">
        <label for="select-modul" style="color:var(--text-muted);">Modul:</label>
        <select id="select-modul" class="select-input select-small" bind:value={currentModul}>
          {#each REGULER_MODULS as m (m)}
            <option value={m}>{MODUL_INFO[m].display_name}</option>
          {/each}
          {#if currentTipe === 'ujian_praktik'}
            <option value="flowchart">Flowchart</option>
          {/if}
        </select>

        {#if currentTipe === 'ujian_praktik'}
          <label for="github-pat" style="color:var(--text-muted); margin-left:1rem;"
            >GitHub PAT:</label
          >
          <input
            id="github-pat"
            type="password"
            class="text-input"
            placeholder="Untuk upload flowchart image"
            bind:value={githubPat}
            style="flex:1; min-width:200px;"
          />
          <button class="secondary-btn" onclick={savePat}>Simpan PAT</button>
        {/if}
      </div>
    </div>

    <!-- Content -->
    {#if loading}
      <div style="text-align:center; padding:3rem;">
        <div class="spinner" style="width:40px;height:40px;border-width:3px; margin:0 auto;"></div>
        <p class="text-muted mt-4">Memuat soal...</p>
      </div>
    {:else}
      <div bind:this={cardsContainer}>
        {#if currentTipe === 'pretest' || currentTipe === 'posttest'}
          {#if quizQuestions.length === 0}
            <div class="dash-card" style="text-align:center; padding:3rem;">
              <p class="text-muted">Belum ada soal {currentTipe} untuk {MODUL_INFO[currentModul as ModulId]?.display_name ?? currentModul}.</p>
            </div>
          {:else}
            <div style="display:grid; gap:1rem;">
              {#each quizQuestions as q, i (i)}
                {@const isHard = q.level === 'hard' && q.instruksi && q.instruksi.length > 0}
                <div class="dash-card">
                  <div
                    class="dash-card-header"
                    style="display:flex; justify-content:space-between; align-items:center;"
                  >
                    <div style="display:flex; gap:0.5rem; align-items:center;">
                      {#if isHard}
                        <span class="badge badge-hard">HARD — Opsi {q.opsi}</span>
                      {:else}
                        <span class="badge badge-{q.level}">{q.level.toUpperCase()}</span>
                        <span class="text-muted" style="font-size:0.8rem;">No. {q.nomor}</span>
                      {/if}
                    </div>
                    <div style="display:flex; gap:0.25rem;">
                      <button class="btn-action" onclick={() => openEditQuiz(i)}>✏️</button>
                      <button
                        class="btn-action btn-action-danger"
                        onclick={() => deleteQuiz(i)}>🗑️</button
                      >
                    </div>
                  </div>
                  <div class="dash-card-body">
                    {#if isHard}
                      <div class="markdown-body">{@html renderMarkdownToHtml(q.deskripsi)}</div>
                      <ol style="margin-top:0.5rem; padding-left:1.5rem;">
                        {#each q.instruksi ?? [] as inst, j (j)}
                          <li>
                            <span class="markdown-body" style="display:inline;"
                              >{@html renderMarkdownToHtml(inst.soal)}</span
                            >
                            <strong>({inst.poin} poin)</strong>
                          </li>
                        {/each}
                      </ol>
                    {:else}
                      <div class="markdown-body">{@html renderMarkdownToHtml(q.soal)}</div>
                    {/if}
                    <p
                      class="text-muted"
                      style="margin-top:0.5rem; font-size:0.85rem;"
                    >
                      Jawaban: {(q.jawaban_referensi ?? '').slice(0, 100)}{(q.jawaban_referensi ?? '').length > 100 ? '...' : ''}
                    </p>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        {:else if currentTipe === 'keterampilan'}
          <!-- Judul Program -->
          <div
            class="dash-card"
            style="margin-bottom:1rem; padding:1rem 1.25rem; display:flex; align-items:center; gap:1rem; flex-wrap:wrap;"
          >
            <div style="flex:1;">
              <div
                style="font-size:0.75rem; text-transform:uppercase; color:var(--text-muted); margin-bottom:0.25rem;"
              >
                Judul Program
              </div>
              <div style="font-size:1.05rem; font-weight:600; color:var(--primary-hover);">
                {ketJudulProgram || 'Belum ada judul'}
              </div>
            </div>
            <button
              class="secondary-btn"
              onclick={() => {
                judulEditValue = ketJudulProgram;
                judulEditOpen = !judulEditOpen;
              }}>✏️ Edit Judul</button
            >
          </div>

          {#if judulEditOpen}
            <div class="dash-card" style="margin-bottom:1rem;">
              <div class="dash-card-body" style="display:flex; gap:0.75rem; align-items:center;">
                <input
                  type="text"
                  class="text-input"
                  bind:value={judulEditValue}
                  style="flex:1;"
                  placeholder="Judul Program Keterampilan"
                />
                <button class="primary-btn" onclick={saveJudulProgram}>Simpan</button>
                <button class="secondary-btn" onclick={() => (judulEditOpen = false)}>Batal</button>
              </div>
            </div>
          {/if}

          {#if ketItems.length === 0}
            <div class="dash-card" style="text-align:center; padding:3rem;">
              <p class="text-muted">Belum ada item keterampilan.</p>
            </div>
          {:else}
            <div style="display:grid; gap:1rem;">
              {#each ketItems as item, i (i)}
                <div class="dash-card">
                  <div
                    class="dash-card-header"
                    style="display:flex; justify-content:space-between; align-items:center;"
                  >
                    <span class="badge">{item.poin} poin</span>
                    <div style="display:flex; gap:0.25rem;">
                      <button class="btn-action" onclick={() => openEditKet(i)}>✏️</button>
                      <button
                        class="btn-action btn-action-danger"
                        onclick={() => deleteKet(i)}>🗑️</button
                      >
                    </div>
                  </div>
                  <div class="dash-card-body">
                    <div class="markdown-body">{@html renderMarkdownToHtml(item.referensi)}</div>
                    <p
                      class="text-muted"
                      style="margin-top:0.5rem; font-size:0.85rem;"
                    >
                      Kunci: {item.kunci_jawaban.slice(0, 100)}{item.kunci_jawaban.length > 100 ? '...' : ''}
                    </p>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        {:else if currentTipe === 'ujian_praktik'}
          {#if uprakSoal.length === 0}
            <div class="dash-card" style="text-align:center; padding:3rem;">
              <p class="text-muted">
                Belum ada soal ujian praktik untuk {currentModul === 'flowchart'
                  ? 'Flowchart'
                  : MODUL_INFO[currentModul as ModulId]?.display_name ?? currentModul}.
              </p>
            </div>
          {:else}
            <div style="display:grid; gap:1rem;">
              {#each uprakSoal as s (s._id)}
                {@const isFlowchart = s.legacy_origin === 'flowchart'}
                <div class="dash-card">
                  <div
                    class="dash-card-header"
                    style="display:flex; justify-content:space-between; align-items:center;"
                  >
                    {#if isFlowchart}
                      <span
                        class="badge"
                        style="background:rgba(139,92,246,0.15);color:#8b5cf6;"
                      >
                        FLOWCHART — Opsi {String(s.opsi).toUpperCase()}
                      </span>
                    {:else}
                      <span class="badge badge-hard">
                        {s.legacy_origin?.toUpperCase()} — Opsi {s.opsi} ({s.bahasa === 'c'
                          ? 'C'
                          : 'Python'})
                      </span>
                    {/if}
                    <div style="display:flex; gap:0.25rem;">
                      <button class="btn-action" onclick={() => openEditUprak(s)}>✏️</button>
                      <button
                        class="btn-action btn-action-danger"
                        onclick={() => deleteUprak(s._id)}>🗑️</button
                      >
                    </div>
                  </div>
                  <div class="dash-card-body">
                    <div class="markdown-body">{@html renderMarkdownToHtml(s.deskripsi)}</div>
                    {#if s.gambar}
                      <img
                        src="/ujianPraktik/{s.gambar}"
                        alt="Flowchart"
                        style="max-width:300px; margin-top:0.5rem; border-radius:8px; background:#fff; padding:0.25rem;"
                      />
                    {/if}
                    {#if s.instruksi && s.instruksi.length > 0}
                      <ol style="margin-top:0.5rem; padding-left:1.5rem;">
                        {#each s.instruksi as inst, j (j)}
                          <li>
                            <span class="markdown-body" style="display:inline;"
                              >{@html renderMarkdownToHtml(inst.soal)}</span
                            >
                            <strong>({inst.poin} poin)</strong>
                          </li>
                        {/each}
                      </ol>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        {/if}
      </div>
    {/if}
  </section>
</AdminLayout>

<!-- Modal -->
{#if modalOpen}
  <div
    class="modal-overlay active"
    onclick={(e) => {
      if (e.target === e.currentTarget) closeModal();
    }}
    role="presentation"
  >
    <div class="modal-content dash-card form-modal-wide" style="max-width: min(1600px, calc(100vw - 2rem)); width: 100%;">
      <div class="dash-card-header">
        <h3>{modalTitle}</h3>
      </div>
      <div class="dash-card-body" style="max-height:70vh; overflow-y:auto;">
        {#if currentTipe === 'pretest' || currentTipe === 'posttest'}
          {#if !fHardMode}
            <div class="input-group">
              <label for="f-nomor">Nomor</label>
              <input id="f-nomor" type="number" class="text-input" min="1" bind:value={fNomor} />
            </div>
            <div class="input-group">
              <label for="f-level">Level</label>
              <select id="f-level" class="select-input" bind:value={fLevel}>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard (text)</option>
              </select>
            </div>
            <div class="input-group">
              <label for="f-soal">Soal</label>
              <MarkdownEditor bind:value={fSoal} placeholder="Tulis soal... Markdown + LaTeX" />
            </div>
            <div class="input-group">
              <label for="f-jawaban">Jawaban Referensi (plain text)</label>
              <textarea
                id="f-jawaban"
                class="text-input"
                rows="3"
                bind:value={fJawaban}
              ></textarea>
            </div>
            {#if currentTipe === 'posttest'}
              <label style="display:flex; gap:0.5rem; align-items:center;">
                <input type="checkbox" bind:checked={fHardMode} /> Mode Hard Coding (Instruksi + Opsi)
              </label>
            {/if}
          {:else}
            <div class="input-group">
              <label for="f-opsi">Opsi</label>
              <input id="f-opsi" type="number" class="text-input" min="1" bind:value={fOpsi} />
            </div>
            <div class="input-group">
              <label for="f-deskripsi">Deskripsi</label>
              <MarkdownEditor bind:value={fDeskripsi} placeholder="Deskripsi soal..." />
            </div>
            <div class="input-group">
              <label for="f-jawaban">Jawaban Referensi (plain text)</label>
              <textarea
                id="f-jawaban"
                class="text-input"
                rows="3"
                bind:value={fJawaban}
              ></textarea>
            </div>
            <div class="input-group">
              <label for="instruksi">Instruksi</label>
              <InstruksiList bind:items={fInstruksi} />
            </div>
            <label style="display:flex; gap:0.5rem; align-items:center;">
              <input type="checkbox" bind:checked={fHardMode} /> Mode Hard Coding aktif
            </label>
          {/if}
        {:else if currentTipe === 'keterampilan'}
          <div class="input-group">
            <label for="f-referensi">Referensi</label>
            <MarkdownEditor bind:value={fReferensi} placeholder="Cek: variabel x bertipe int..." />
          </div>
          <div class="input-group">
            <label for="f-kunci">Kunci Jawaban (plain text)</label>
            <textarea
              id="f-kunci"
              class="text-input"
              rows="3"
              bind:value={fKunciJawaban}
            ></textarea>
          </div>
          <div class="input-group">
            <label for="f-poin">Poin</label>
            <input id="f-poin" type="number" class="text-input" min="0" bind:value={fPoin} />
          </div>
        {:else if currentTipe === 'ujian_praktik'}
          <div class="input-group">
            <label for="f-up-type">Tipe</label>
            <select id="f-up-type" class="select-input" bind:value={fUpType}>
              <option value="coding">Coding</option>
              <option value="flowchart">Flowchart</option>
            </select>
          </div>
          <div class="input-group">
            <label for="f-opsi">Opsi</label>
            <input
              id="f-opsi"
              type="text"
              class="text-input"
              placeholder="1, 2, 3... atau a, b, c..."
              bind:value={fOpsi}
            />
          </div>
          {#if fUpType === 'coding'}
            <div class="input-group">
              <label for="f-deskripsi">Deskripsi</label>
              <MarkdownEditor bind:value={fDeskripsi} placeholder="Deskripsi soal coding..." />
            </div>
            <div class="input-group">
              <label for="f-jawaban">Jawaban Referensi (plain text)</label>
              <textarea
                id="f-jawaban"
                class="text-input"
                rows="3"
                bind:value={fJawaban}
              ></textarea>
            </div>
            <div class="input-group">
              <label for="instruksi-coding">Instruksi</label>
              <InstruksiList bind:items={fInstruksi} />
            </div>
          {:else}
            <div class="input-group">
              <label for="f-fc-deskripsi">Deskripsi Flowchart</label>
              <MarkdownEditor bind:value={fDeskripsi} placeholder="Deskripsi flowchart..." />
            </div>
            <div class="input-group">
              <label for="f-fc-poin">Poin</label>
              <input
                id="f-fc-poin"
                type="number"
                class="text-input"
                min="0"
                bind:value={fPoin}
              />
            </div>
            <div class="input-group">
              <label for="f-fc-image">Gambar Flowchart (JPG/PNG)</label>
              <input
                id="f-fc-image"
                type="file"
                accept="image/jpeg,image/png"
                onchange={handleFcFile}
              />
              {#if fFcGambar}
                <img
                  src="/ujianPraktik/{fFcGambar}"
                  alt="Current"
                  style="max-width:300px; margin-top:0.5rem; border-radius:8px; background:#fff; padding:0.25rem;"
                />
              {/if}
            </div>
            <div class="input-group">
              <label for="instruksi-fc">Instruksi (untuk AI grader, tidak ditampilkan ke mahasiswa)</label>
              <InstruksiList bind:items={fInstruksi} />
            </div>
          {/if}
        {/if}
        <div style="display:flex; gap:0.5rem; justify-content:flex-end; margin-top:1rem;">
          <button class="secondary-btn" onclick={closeModal}>Batal</button>
          <button class="primary-btn" disabled={saving} onclick={save}>
            <span class="btn-text" class:loader-hidden={saving}>Simpan</span>
            <div
              class="spinner"
              style="width:16px;height:16px;border-width:2px;"
              class:loader-hidden={!saving}
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
