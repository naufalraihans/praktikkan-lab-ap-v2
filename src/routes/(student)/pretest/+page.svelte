<script lang="ts">
  import {
    doc,
    getDoc,
    setDoc,
    onSnapshot,
    serverTimestamp
  } from 'firebase/firestore';
  import { db } from '$lib/firebase/client';
  import { COLLECTIONS, MODUL_INFO } from '$lib/firebase/constants';
  import { authState } from '$lib/stores/auth.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { createEditor, renderMathJax } from '$lib/utils/monaco';
  import { logActivity } from '$lib/utils/activity-log';
  import { saveAutosave, loadAutosave, clearAutosave, makeDebounce } from '$lib/utils/autosave';
  import Navbar from '$lib/components/Navbar.svelte';
  import QuizState from '$lib/components/QuizState.svelte';
  import type { SesiReguler } from '$lib/firebase/types';

  type ViewState = 'loading' | 'no-session' | 'denied' | 'quiz' | 'submitted';

  let view = $state<ViewState>('loading');
  let sesi = $state<SesiReguler | null>(null);
  let submitting = $state(false);
  let editorContainers = $state<(HTMLDivElement | null)[]>([]);
  let questionsContainer = $state<HTMLDivElement | null>(null);

  interface MonacoMin {
    getValue: () => string;
    setValue: (v: string) => void;
    onDidChangeModelContent: (cb: () => void) => void;
  }
  const editors = new Map<number, MonacoMin>();
  let unsubscribeAccess: (() => void) | null = null;

  // Save current answers ke localStorage — dipanggil by debounced or force
  function saveNow() {
    const mahasiswa = authState.mahasiswa;
    if (!mahasiswa || !sesi) return;
    const answers: string[] = [];
    for (let i = 0; i < sesi.snapshot.pretest_questions.length; i++) {
      answers.push(editors.get(i)?.getValue() ?? '');
    }
    saveAutosave(mahasiswa.nim, sesi.modul_id, 'pretest', { answers });
  }
  const triggerAutosave = makeDebounce(saveNow, 300);

  // Load saat auth ready (route guard ada di (student)/+layout.svelte)
  $effect(() => {
    if (authState.isLoggedIn && !authState.isAdmin && view === 'loading') {
      loadQuiz();
    }
  });

  $effect(() => () => unsubscribeAccess?.());

  // Force-save on unmount (navigate away) + beforeunload (close tab/refresh)
  $effect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => saveNow();
    window.addEventListener('beforeunload', handler);
    window.addEventListener('pagehide', handler);
    return () => {
      saveNow(); // last-chance save before unmount
      window.removeEventListener('beforeunload', handler);
      window.removeEventListener('pagehide', handler);
    };
  });

  async function loadQuiz() {
    try {
      const snap = await getDoc(doc(db, COLLECTIONS.sesi, 'reguler'));
      if (!snap.exists()) {
        view = 'no-session';
        return;
      }
      const data = snap.data() as SesiReguler;
      if (data.akses?.pretest === false) {
        view = 'denied';
        return;
      }
      const questions = data.snapshot?.pretest_questions ?? [];
      if (questions.length === 0) {
        view = 'no-session';
        return;
      }
      sesi = data;
      view = 'quiz';

      unsubscribeAccess = onSnapshot(doc(db, COLLECTIONS.sesi, 'reguler'), (s) => {
        if (!s.exists()) return;
        if ((s.data() as SesiReguler).akses?.pretest === false) {
          unsubscribeAccess?.();
          toast.show('Waktu habis! Menutup sesi otomatis...', 'error');
          submit(true);
        }
      });
    } catch (err) {
      console.error('Error loading quiz:', err);
      toast.show('Gagal memuat soal', 'error');
    }
  }

  $effect(() => {
    if (view !== 'quiz' || !sesi) return;
    const questions = sesi.snapshot.pretest_questions;
    const mahasiswa = authState.mahasiswa;
    if (!mahasiswa) return;

    // Restore autosave (if any)
    const saved = loadAutosave<{ answers: string[] }>(
      mahasiswa.nim,
      sesi.modul_id,
      'pretest'
    );

    (async () => {
      let restored = false;
      for (let i = 0; i < questions.length; i++) {
        const container = editorContainers[i];
        if (container && !editors.has(i)) {
          try {
            const ed = (await createEditor(container, { language: 'plaintext' })) as MonacoMin;
            // Restore saved answer (if any)
            const savedVal = saved?.answers?.[i];
            if (savedVal && savedVal.trim()) {
              ed.setValue(savedVal);
              restored = true;
            }
            ed.onDidChangeModelContent(() => triggerAutosave());
            editors.set(i, ed);
          } catch (e) {
            console.error('Failed to mount editor', i, e);
          }
        }
      }
      if (restored) {
        toast.show('✅ Jawaban sebelumnya dipulihkan', 'success');
      }
    })();

    if (questionsContainer) {
      setTimeout(() => renderMathJax(questionsContainer), 100);
    }
  });

  async function submit(autoSubmit = false) {
    if (!sesi || !authState.mahasiswa || submitting) return;

    const questions = sesi.snapshot.pretest_questions;
    const answers = questions.map((q, i) => ({
      nomor: q.nomor,
      level: q.level,
      soal: q.soal,
      jawaban_mahasiswa: editors.get(i)?.getValue().trim() ?? '',
      jawaban_referensi: q.jawaban_referensi
    }));

    const empty = answers.filter((a) => !a.jawaban_mahasiswa).length;
    if (empty > 0 && !autoSubmit) {
      toast.show(`Masih ada ${empty} soal belum dijawab!`, 'error');
      return;
    }

    submitting = true;
    try {
      const nim = authState.mahasiswa.nim;
      await setDoc(doc(db, COLLECTIONS.jawaban, `${nim}_${sesi.modul_id}_pretest`), {
        nim,
        modul_id: sesi.modul_id,
        type: 'pretest',
        tanggal: sesi.tanggal,
        submitted_at: serverTimestamp(),
        snapshot: { nama: authState.mahasiswa.nama, kelas: authState.mahasiswa.kelas },
        answers,
        nilai: null,
        grading_detail: null
      });
      await logActivity({
        role: 'mhs',
        nim,
        action: 'submitted_jawaban',
        message: `Submitted jawaban Pre-test (${MODUL_INFO[sesi.modul_id].display_name})`
      });
      clearAutosave(nim, sesi.modul_id, 'pretest');
      view = autoSubmit ? 'denied' : 'submitted';
      if (!autoSubmit) toast.show('Jawaban berhasil dikirim!', 'success');
    } catch (err) {
      console.error('Error submitting:', err);
      // Force denied even on failure — student SHOULD NOT continue typing kalau
      // akses udah ditutup. Jawaban tetap di localStorage untuk recovery.
      if (autoSubmit) {
        view = 'denied';
        toast.show('Sesi ditutup. Jawaban tersimpan di local — hubungi admin.', 'error');
      } else {
        toast.show('Gagal mengirim jawaban', 'error');
      }
    } finally {
      submitting = false;
    }
  }
</script>

<Navbar title="PRE-TEST" showBack backHref="/" />

<main class="dashboard-content content-full">
  {#if view === 'quiz' && sesi}
    {@const questions = sesi.snapshot.pretest_questions}
    <header class="quiz-header animate-fade-in">
      <h1>Pre-test — <span class="highlight">{MODUL_INFO[sesi.modul_id].display_name}</span></h1>
      <p class="text-muted">
        Jawab semua pertanyaan di bawah ini. Total: <strong>{questions.length} soal</strong>
      </p>
    </header>

    <div class="quiz-questions-list" bind:this={questionsContainer}>
      {#each questions as q, i (q.nomor)}
        <div class="quiz-card glass-panel animate-fade-in" style="animation-delay: {i * 0.1}s;">
          <div class="quiz-card-header">
            <span class="quiz-number">Soal {i + 1}</span>
            <span class="badge badge-{q.level}">{q.level.toUpperCase()}</span>
          </div>
          <div class="quiz-card-body">
            <p class="quiz-question">{@html q.soal.replace(/\n/g, '<br>')}</p>
            <div class="input-group" style="margin-bottom:0;">
              <label for="editor-{i}">Jawaban Anda</label>
              <div
                bind:this={editorContainers[i]}
                id="editor-{i}"
                style="height: 150px; width: 100%; border-radius: 8px; border: 1px solid var(--panel-border); overflow: hidden; background: #1e1e1e;"
              ></div>
            </div>
          </div>
        </div>
      {/each}
    </div>

    <div class="quiz-submit-area">
      <button
        class="primary-btn btn-activate"
        style="width:100%; max-width:400px;"
        disabled={submitting}
        onclick={() => submit(false)}
      >
        <span class="btn-text" class:loader-hidden={submitting}>Kirim Jawaban Pre-test</span>
        <div class="spinner" class:loader-hidden={!submitting}></div>
      </button>
    </div>
  {:else}
    <QuizState
      state={view}
      label="Pre-test"
      loadingText="Memuat soal..."
    />
  {/if}
</main>
