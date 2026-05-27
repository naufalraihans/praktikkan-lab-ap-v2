<script lang="ts">
  import { collection, doc, getDoc, getDocs, setDoc, Timestamp } from 'firebase/firestore';
  import { db } from '$lib/firebase/client';
  import { COLLECTIONS, MODUL_INFO } from '$lib/firebase/constants';
  import { authState } from '$lib/stores/auth.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { logActivity } from '$lib/utils/activity-log';
  import { createEditor, renderMathJax } from '$lib/utils/monaco';
  import AdminLayout from '$lib/components/AdminLayout.svelte';
  import type {
    Mahasiswa,
    ModulId,
    Question,
    QuestionLevel,
    SoalQuiz,
    SesiReguler
  } from '$lib/firebase/types';

  type Step = 'loading' | 'config' | 'pick' | 'input' | 'success';
  type Sumber = 'sesi_aktif' | 'bank_soal' | 'manual';
  type JawabanType = 'pretest' | 'posttest';

  const REGULER_MODULS: ModulId[] = ['m1', 'm2', 'm3', 'm45', 'm6'];
  const LEVEL_DISTRIBUTION: Record<JawabanType, Record<QuestionLevel, number>> = {
    pretest: { easy: 1, medium: 2, hard: 2 },
    posttest: { easy: 1, medium: 1, hard: 1 }
  };

  // === STATE ===
  let step = $state<Step>('loading');
  let allUsers = $state<Mahasiswa[]>([]);

  // Config form
  let selectedKelas = $state('');
  let selectedNim = $state('');
  let selectedModul = $state<ModulId>('m1');
  let selectedType = $state<JawabanType>('pretest');
  let selectedSumber = $state<Sumber>('sesi_aktif');
  let existingJawaban = $state<{ submitted_at: string; nama: string } | null>(null);

  // Loaded soal for input
  let currentSoalList = $state<Question[]>([]);
  let currentTanggal = $state('');
  let isManualMode = $state(false);

  // Bank soal picker
  let bankSoalAll = $state<Question[]>([]);
  let pickedIndices = $state(new Set<number>());

  // Editor refs
  let editorContainers = $state<(HTMLDivElement | null)[]>([]);
  let soalContainer = $state<HTMLDivElement | null>(null);
  const editors = new Map<number, { getValue: () => string }>();

  // Manual mode form values
  let manualSoal = $state<Record<number, string>>({});
  let manualLevel = $state<Record<number, QuestionLevel>>({});
  let manualReferensi = $state<Record<number, string>>({});

  let loadingSoal = $state(false);
  let submitting = $state(false);

  // Success info
  let successInfo = $state({ nama: '', nim: '', type: '', modul_nama: '', total: 0, answered: 0 });

  $effect(() => {
    if (authState.isAdmin && step === 'loading') {
      loadUsers();
    }
  });

  async function loadUsers() {
    try {
      const snap = await getDocs(collection(db, COLLECTIONS.mahasiswa));
      const list: Mahasiswa[] = [];
      snap.forEach((d) => {
        const data = d.data() as Mahasiswa;
        if (data.role !== 'admin') list.push(data);
      });
      list.sort((a, b) => (a.nama || '').localeCompare(b.nama || ''));
      allUsers = list;
      step = 'config';
    } catch (err) {
      console.error('Error loading users:', err);
      toast.show('Gagal memuat data mahasiswa', 'error');
    }
  }

  const kelasList = $derived(
    Array.from(new Set(allUsers.map((u) => u.kelas).filter(Boolean))).sort()
  );

  const nimList = $derived(
    selectedKelas
      ? allUsers
          .filter((u) => u.kelas === selectedKelas)
          .sort((a, b) => a.nim.localeCompare(b.nim))
      : []
  );

  const configValid = $derived(!!(selectedNim && selectedModul && selectedType));

  // Check existing whenever 3-fields combo changes
  $effect(() => {
    if (!selectedNim || !selectedModul || !selectedType) {
      existingJawaban = null;
      return;
    }
    const jawabanId = `${selectedNim}_${selectedModul}_${selectedType}`;
    getDoc(doc(db, COLLECTIONS.jawaban, jawabanId))
      .then((snap) => {
        if (snap.exists()) {
          const d = snap.data();
          existingJawaban = {
            submitted_at:
              d['submitted_at'] instanceof Timestamp
                ? d['submitted_at'].toDate().toLocaleString('id-ID')
                : String(d['submitted_at'] ?? '-'),
            nama: d['snapshot']?.nama ?? selectedNim
          };
        } else {
          existingJawaban = null;
        }
      })
      .catch(() => (existingJawaban = null));
  });

  async function loadSoal() {
    if (!configValid) return;
    const user = allUsers.find((u) => u.nim === selectedNim);
    if (!user) return;

    loadingSoal = true;
    try {
      currentTanggal = new Date().toISOString().split('T')[0]!;
      isManualMode = false;

      if (selectedSumber === 'sesi_aktif') {
        const snap = await getDoc(doc(db, COLLECTIONS.sesi, 'reguler'));
        if (!snap.exists()) {
          toast.show('Tidak ada sesi aktif', 'error');
          return;
        }
        const sesi = snap.data() as SesiReguler;
        if (sesi.modul_id !== selectedModul) {
          toast.show(
            `Sesi aktif modul ${MODUL_INFO[sesi.modul_id].display_name}, bukan ${MODUL_INFO[selectedModul].display_name}`,
            'error'
          );
          return;
        }
        const key = selectedType === 'pretest' ? 'pretest_questions' : 'posttest_questions';
        const questions = sesi.snapshot[key];
        if (!questions || questions.length === 0) {
          toast.show('Sesi tidak punya soal untuk type ini', 'error');
          return;
        }
        currentTanggal = sesi.tanggal || currentTanggal;
        currentSoalList = questions;
        await goToInputStep();
        return;
      }

      if (selectedSumber === 'bank_soal') {
        const soalSnap = await getDoc(
          doc(db, COLLECTIONS.soal, `${selectedModul}_${selectedType}`)
        );
        if (!soalSnap.exists()) {
          toast.show('Soal tidak ditemukan di bank', 'error');
          return;
        }
        const data = soalSnap.data() as SoalQuiz;
        if (!data.questions || data.questions.length === 0) {
          toast.show('Bank soal kosong', 'error');
          return;
        }
        bankSoalAll = data.questions;
        pickedIndices = new Set();
        step = 'pick';
        return;
      }

      if (selectedSumber === 'manual') {
        isManualMode = true;
        const count = selectedType === 'posttest' ? 3 : 5;
        const levels: QuestionLevel[] =
          selectedType === 'posttest' ? ['easy', 'medium', 'hard'] : ['easy', 'easy', 'easy', 'easy', 'easy'];
        currentSoalList = Array.from({ length: count }, (_, i) => ({
          nomor: i + 1,
          level: levels[i]!,
          soal: '',
          jawaban_referensi: ''
        }));
        manualSoal = {};
        manualLevel = Object.fromEntries(levels.map((l, i) => [i, l]));
        manualReferensi = {};
        await goToInputStep();
        return;
      }
    } catch (err) {
      console.error('Error loading soal:', err);
      toast.show('Gagal memuat soal', 'error');
    } finally {
      loadingSoal = false;
    }
  }

  async function goToInputStep() {
    step = 'input';
    // Mount editors after DOM
    await new Promise((r) => setTimeout(r, 50));
    for (let i = 0; i < currentSoalList.length; i++) {
      const c = editorContainers[i];
      if (c && !editors.has(i)) {
        try {
          const q = currentSoalList[i]!;
          const isHard = q.level === 'hard';
          editors.set(i, await createEditor(c, { language: 'plaintext', lineNumbers: isHard ? 'on' : 'off' }));
        } catch (e) {
          console.error('Editor mount error', i, e);
        }
      }
    }
    if (soalContainer) {
      setTimeout(() => renderMathJax(soalContainer), 100);
    }
  }

  // === BANK PICKER ===
  function togglePick(idx: number) {
    if (pickedIndices.has(idx)) pickedIndices.delete(idx);
    else pickedIndices.add(idx);
    pickedIndices = new Set(pickedIndices);
  }

  const pickerCounts = $derived.by(() => {
    const c: Record<QuestionLevel, number> = { easy: 0, medium: 0, hard: 0 };
    for (const idx of pickedIndices) {
      const q = bankSoalAll[idx];
      if (q) c[q.level]++;
    }
    return c;
  });

  const pickerValid = $derived.by(() => {
    const dist = LEVEL_DISTRIBUTION[selectedType];
    return Object.entries(dist).every(([level, need]) => pickerCounts[level as QuestionLevel] >= need);
  });

  function isLevelAtLimit(level: QuestionLevel, currentChecked: boolean): boolean {
    const need = LEVEL_DISTRIBUTION[selectedType][level];
    return !currentChecked && pickerCounts[level] >= need;
  }

  async function confirmPick() {
    const picked = Array.from(pickedIndices)
      .map((i) => bankSoalAll[i])
      .filter((q): q is Question => !!q)
      .sort((a, b) => (a.nomor ?? 9999) - (b.nomor ?? 9999));
    if (picked.length === 0) {
      toast.show('Belum ada soal yang dipilih', 'error');
      return;
    }
    currentSoalList = picked;
    await goToInputStep();
  }

  // === SUBMIT ===
  async function submitJawaban() {
    if (submitting) return;
    const user = allUsers.find((u) => u.nim === selectedNim);
    if (!user) return;

    const answers = currentSoalList.map((q, i) => {
      const jawaban = editors.get(i)?.getValue().trim() ?? '';
      if (isManualMode) {
        return {
          nomor: i + 1,
          level: manualLevel[i] ?? 'easy',
          soal: manualSoal[i]?.trim() ?? '',
          jawaban_mahasiswa: jawaban,
          jawaban_referensi: manualReferensi[i]?.trim() ?? ''
        };
      }
      const isHard = q.level === 'hard' && q.instruksi && q.instruksi.length > 0;
      if (isHard) {
        return {
          level: 'hard' as const,
          opsi: q.opsi,
          deskripsi: q.deskripsi,
          instruksi: q.instruksi,
          jawaban_mahasiswa: jawaban,
          jawaban_referensi: q.jawaban_referensi
        };
      }
      return {
        nomor: q.nomor,
        level: q.level,
        soal: q.soal,
        jawaban_mahasiswa: jawaban,
        jawaban_referensi: q.jawaban_referensi
      };
    });

    const emptyCount = answers.filter((a) => !a.jawaban_mahasiswa).length;
    if (emptyCount === answers.length) {
      toast.show('Semua jawaban masih kosong!', 'error');
      return;
    }
    if (emptyCount > 0 && !confirm(`Ada ${emptyCount} soal belum diisi. Tetap submit?`)) return;
    if (existingJawaban && !confirm('Jawaban sudah ada, akan ditimpa. Lanjutkan?')) return;

    submitting = true;
    try {
      const jawabanId = `${selectedNim}_${selectedModul}_${selectedType}`;
      await setDoc(doc(db, COLLECTIONS.jawaban, jawabanId), {
        nim: selectedNim,
        modul_id: selectedModul,
        type: selectedType,
        tanggal: currentTanggal,
        submitted_at: Timestamp.now(),
        snapshot: { nama: user.nama, kelas: user.kelas },
        sumber_soal: selectedSumber,
        submitted_by_admin: true,
        answers,
        nilai: null,
        grading_detail: null
      });

      await logActivity({
        role: 'admin',
        nim: authState.mahasiswa?.nim ?? null,
        action: 'admin_write',
        message: `Input jawaban ${selectedType} ${MODUL_INFO[selectedModul].display_name} untuk ${user.nama} (${selectedNim})`
      });

      successInfo = {
        nama: user.nama,
        nim: selectedNim,
        type: selectedType,
        modul_nama: MODUL_INFO[selectedModul].display_name,
        total: answers.length,
        answered: answers.length - emptyCount
      };
      step = 'success';
      toast.show('Jawaban berhasil disimpan!', 'success');
    } catch (err) {
      console.error('Submit error:', err);
      const message = err instanceof Error ? err.message : 'Unknown';
      toast.show(`Gagal: ${message}`, 'error');
    } finally {
      submitting = false;
    }
  }

  function resetForm() {
    selectedKelas = '';
    selectedNim = '';
    selectedModul = 'm1';
    selectedType = 'pretest';
    selectedSumber = 'sesi_aktif';
    currentSoalList = [];
    bankSoalAll = [];
    pickedIndices = new Set();
    existingJawaban = null;
    editors.clear();
    editorContainers = [];
    manualSoal = {};
    manualLevel = {};
    manualReferensi = {};
    step = 'config';
  }
</script>

<AdminLayout title="Input Jawaban">
  <section class="admin-section animate-fade-in">
    <div class="section-header">
      <h2>✍️ Input Jawaban (Admin)</h2>
    </div>

    {#if step === 'loading'}
      <div style="text-align:center; padding:3rem;">
        <div class="spinner" style="width:40px;height:40px;border-width:3px; margin:0 auto;"></div>
        <p class="text-muted mt-4">Memuat data mahasiswa...</p>
      </div>
    {:else if step === 'config'}
      <div class="dash-card">
        <div class="dash-card-body" style="display:grid; gap:1rem;">
          <div class="input-group">
            <label for="select-kelas">Kelas</label>
            <select id="select-kelas" class="select-input" bind:value={selectedKelas}>
              <option value="">-- Pilih Kelas --</option>
              {#each kelasList as k (k)}
                <option value={k}>{k}</option>
              {/each}
            </select>
          </div>

          <div class="input-group">
            <label for="select-nim">Mahasiswa</label>
            <select
              id="select-nim"
              class="select-input"
              bind:value={selectedNim}
              disabled={!selectedKelas}
            >
              <option value="">-- Pilih Mahasiswa --</option>
              {#each nimList as u (u.nim)}
                <option value={u.nim}>{u.nim} — {u.nama}</option>
              {/each}
            </select>
          </div>

          <div style="display:grid; gap:1rem; grid-template-columns: repeat(auto-fit, minmax(180px,1fr));">
            <div class="input-group">
              <label for="select-modul">Modul</label>
              <select id="select-modul" class="select-input" bind:value={selectedModul}>
                {#each REGULER_MODULS as m (m)}
                  <option value={m}>{MODUL_INFO[m].display_name}</option>
                {/each}
              </select>
            </div>
            <div class="input-group">
              <label for="select-type">Type</label>
              <select id="select-type" class="select-input" bind:value={selectedType}>
                <option value="pretest">Pre-test</option>
                <option value="posttest">Post-test</option>
              </select>
            </div>
            <div class="input-group">
              <label for="select-sumber">Sumber Soal</label>
              <select id="select-sumber" class="select-input" bind:value={selectedSumber}>
                <option value="sesi_aktif">Sesi Aktif</option>
                <option value="bank_soal">Bank Soal</option>
                <option value="manual">Manual</option>
              </select>
            </div>
          </div>

          {#if existingJawaban}
            <div
              class="card"
              style="background: rgba(245,158,11,0.1); border:1px solid rgba(245,158,11,0.3); padding:0.75rem 1rem; color:#fbbf24;"
            >
              ⚠️ Jawaban {selectedType} sudah ada untuk {existingJawaban.nama} (submit:
              {existingJawaban.submitted_at}). Submit baru akan menimpa data lama!
            </div>
          {/if}

          <button
            class="primary-btn"
            style="margin-top:0.5rem;"
            disabled={!configValid || loadingSoal}
            onclick={loadSoal}
          >
            <span class="btn-text" class:loader-hidden={loadingSoal}>👁️ Load Soal & Mulai Input</span>
            <div
              class="spinner"
              style="width:16px;height:16px;border-width:2px;"
              class:loader-hidden={!loadingSoal}
            ></div>
          </button>
        </div>
      </div>
    {:else if step === 'pick'}
      <div class="dash-card" style="margin-bottom:1rem;">
        <div class="dash-card-body">
          <p>
            📚 Pilih soal <strong>{selectedType}</strong> — <strong
              >{MODUL_INFO[selectedModul].display_name}</strong
            > (Bank Soal)
          </p>
          <div style="display:flex; gap:0.5rem; margin-top:0.5rem; align-items:center;">
            {#each Object.entries(LEVEL_DISTRIBUTION[selectedType]) as [level, need] (level)}
              {@const got = pickerCounts[level as QuestionLevel]}
              <span
                class="badge badge-{level}"
                style="opacity: {got >= need ? '1' : '0.6'};"
              >
                {level.toUpperCase()}: {got}/{need}
              </span>
            {/each}
            <span style="margin-left:auto;">
              <button class="secondary-btn" onclick={() => (step = 'config')}>← Kembali</button>
              <button class="primary-btn" disabled={!pickerValid} onclick={confirmPick}
                >Lanjut ke Input →</button
              >
            </span>
          </div>
        </div>
      </div>

      {#each ['easy', 'medium', 'hard'] as const as lv (lv)}
        {@const items = bankSoalAll
          .map((q, i) => ({ q, i }))
          .filter(({ q }) => q.level === lv)}
        {@const need = LEVEL_DISTRIBUTION[selectedType][lv]}
        {#if items.length > 0}
          <div style="margin-bottom:1rem;">
            <h4 style="margin-bottom:0.5rem;">
              <span class="badge badge-{lv}">{lv.toUpperCase()}</span>
              <span class="text-muted" style="font-size:0.85rem; margin-left:0.5rem;"
                >— pilih {need} dari {items.length}</span
              >
            </h4>
            <div style="display:grid; gap:0.5rem;">
              {#each items as { q, i } (i)}
                {@const checked = pickedIndices.has(i)}
                {@const disabled = isLevelAtLimit(lv, checked)}
                <label
                  class="dash-card"
                  style="cursor:{disabled ? 'not-allowed' : 'pointer'}; opacity: {disabled
                    ? '0.4'
                    : '1'}; padding:0.75rem 1rem; display:flex; gap:0.75rem; align-items:flex-start; {checked
                    ? 'border-color: var(--primary);'
                    : ''}"
                >
                  <input
                    type="checkbox"
                    {disabled}
                    {checked}
                    onchange={() => togglePick(i)}
                    style="margin-top:0.25rem;"
                  />
                  <div style="flex:1;">
                    {#if q.nomor}
                      <span class="text-muted" style="font-size:0.8rem;">#{q.nomor}</span>
                    {/if}
                    {#if q.opsi}
                      <span class="badge badge-hard" style="font-size:0.7rem;">Opsi {q.opsi}</span>
                    {/if}
                    <div style="white-space:pre-wrap; margin-top:0.25rem;">
                      {q.level === 'hard' && q.deskripsi ? q.deskripsi : q.soal}
                    </div>
                  </div>
                </label>
              {/each}
            </div>
          </div>
        {/if}
      {/each}
    {:else if step === 'input'}
      <div class="dash-card" style="margin-bottom:1rem;">
        <div class="dash-card-body">
          <p>
            📝 Input jawaban <strong>{selectedType}</strong> —
            <strong>{MODUL_INFO[selectedModul].display_name}</strong>
            ({selectedSumber === 'sesi_aktif'
              ? 'Sesi Aktif'
              : selectedSumber === 'bank_soal'
                ? 'Bank Soal'
                : 'Manual'})
          </p>
          <p class="text-muted">
            👤 {allUsers.find((u) => u.nim === selectedNim)?.nama} ({selectedNim}) — Kelas {selectedKelas}
          </p>
          {#if existingJawaban}
            <div
              class="card"
              style="background: rgba(245,158,11,0.1); border:1px solid rgba(245,158,11,0.3); padding:0.5rem 1rem; margin-top:0.5rem; color:#fbbf24;"
            >
              ⚠️ Data lama akan DITIMPA saat submit.
            </div>
          {/if}
        </div>
      </div>

      <div bind:this={soalContainer} style="display:grid; gap:1rem;">
        {#each currentSoalList as q, i (i)}
          {@const isHard = q.level === 'hard' && q.instruksi && q.instruksi.length > 0}
          <div class="card glass-panel animate-fade-in" style="animation-delay: {i * 0.08}s;">
            <div class="dash-card-body">
              <div style="display:flex; gap:0.5rem; align-items:center; margin-bottom:0.5rem;">
                <span
                  style="background: rgba(255,255,255,0.1); padding:0.25rem 0.5rem; border-radius:4px; font-weight:600;"
                  >Soal {i + 1}</span
                >
                {#if isManualMode}
                  <select
                    class="select-input select-small"
                    style="width:auto;"
                    bind:value={manualLevel[i]}
                  >
                    <option value="easy">EASY</option>
                    <option value="medium">MEDIUM</option>
                    <option value="hard">HARD</option>
                  </select>
                {:else if q.level}
                  <span class="badge badge-{q.level}">{q.level.toUpperCase()}</span>
                {/if}
              </div>

              {#if isManualMode}
                <div class="input-group">
                  <label for="manual-soal-{i}">Soal:</label>
                  <textarea
                    id="manual-soal-{i}"
                    class="text-input"
                    rows="3"
                    placeholder="Ketik soal di sini..."
                    bind:value={manualSoal[i]}
                  ></textarea>
                </div>
              {:else}
                <div style="white-space:pre-wrap; margin-bottom:0.75rem;">
                  {isHard
                    ? `${q.deskripsi ?? ''}\n\nInstruksi:\n${(q.instruksi ?? [])
                        .map((inst, j) => `${j + 1}. ${inst.soal} (${inst.poin} poin)`)
                        .join('\n')}`
                    : q.soal}
                </div>
              {/if}

              <div class="input-group">
                <label for="editor-{i}">Jawaban Mahasiswa:</label>
                <div
                  bind:this={editorContainers[i]}
                  id="editor-{i}"
                  style="height: {isHard ? 300 : 150}px; width:100%; border-radius:8px; border:1px solid var(--panel-border); overflow:hidden; background:#1e1e1e;"
                ></div>
              </div>

              {#if isManualMode}
                <div class="input-group">
                  <label for="manual-ref-{i}">Jawaban Referensi (opsional):</label>
                  <textarea
                    id="manual-ref-{i}"
                    class="text-input"
                    rows="2"
                    placeholder="Jawaban referensi (kosongkan kalau ga ada)..."
                    bind:value={manualReferensi[i]}
                  ></textarea>
                </div>
              {/if}
            </div>
          </div>
        {/each}
      </div>

      <div style="display:flex; gap:0.5rem; margin-top:1rem;">
        <button class="secondary-btn" onclick={() => (step = 'config')}>← Kembali</button>
        <button
          class="primary-btn btn-activate"
          style="flex:1;"
          disabled={submitting}
          onclick={submitJawaban}
        >
          <span class="btn-text" class:loader-hidden={submitting}>💾 Submit Jawaban</span>
          <div
            class="spinner"
            style="width:16px;height:16px;border-width:2px;"
            class:loader-hidden={!submitting}
          ></div>
        </button>
      </div>
    {:else if step === 'success'}
      <div class="dash-card" style="text-align:center; max-width:500px; margin: 4rem auto; padding:2.5rem;">
        <div style="font-size:3rem; margin-bottom:1rem;">✅</div>
        <h2 style="color:var(--success);">Jawaban Tersimpan!</h2>
        <p class="text-muted mt-4">
          <strong>{successInfo.nama}</strong> ({successInfo.nim})<br />
          {successInfo.type.charAt(0).toUpperCase() + successInfo.type.slice(1)} — {successInfo.modul_nama}<br
          />
          {successInfo.total} soal, {successInfo.answered} dijawab
        </p>
        <div style="display:flex; gap:0.5rem; justify-content:center; margin-top:1rem;">
          <button class="secondary-btn" onclick={resetForm}>Input Lagi</button>
          <a href="/rekap-nilai" class="primary-btn" style="display:inline-block;">Ke Rekap</a>
        </div>
      </div>
    {/if}
  </section>
</AdminLayout>
