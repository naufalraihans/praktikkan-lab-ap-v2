<script lang="ts">
  import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
  import { db } from '$lib/firebase/client';
  import { COLLECTIONS, MODUL_INFO } from '$lib/firebase/constants';
  import { authState } from '$lib/stores/auth.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { createEditor, renderMathJax } from '$lib/utils/monaco';
  import { renderMarkdownToHtml } from '$lib/utils/markdown';
  import { runCode, detectLang, type Lang, type RunCodeResult } from '$lib/utils/code-runner';
  import { logActivity } from '$lib/utils/activity-log';
  import Navbar from '$lib/components/Navbar.svelte';
  import QuizState from '$lib/components/QuizState.svelte';
  import type { SesiReguler } from '$lib/firebase/types';

  type ViewState = 'loading' | 'no-session' | 'denied' | 'quiz' | 'submitted';

  let view = $state<ViewState>('loading');
  let sesi = $state<SesiReguler | null>(null);
  let lang = $state<Lang>('c');
  let submitting = $state(false);

  let editorContainers = $state<(HTMLDivElement | null)[]>([]);
  let questionsContainer = $state<HTMLDivElement | null>(null);
  let outputs = $state<Record<number, { result: RunCodeResult | null; running: boolean }>>({});

  const editors = new Map<number, { getValue: () => string }>();
  let unsubscribeAccess: (() => void) | null = null;

  const boilerplate = $derived(
    lang === 'c'
      ? '#include <stdio.h>\n\nint main() {\n    \n    return 0;\n}'
      : '# Tulis kode Python di sini\n'
  );

  $effect(() => {
    if (authState.isLoggedIn && !authState.isAdmin && view === 'loading') {
      loadQuiz();
    }
  });

  $effect(() => () => unsubscribeAccess?.());

  async function loadQuiz() {
    try {
      const snap = await getDoc(doc(db, COLLECTIONS.sesi, 'reguler'));
      if (!snap.exists()) {
        view = 'no-session';
        return;
      }
      const data = snap.data() as SesiReguler;
      if (data.akses?.posttest === false) {
        view = 'denied';
        return;
      }
      const questions = data.snapshot?.posttest_questions ?? [];
      if (questions.length === 0) {
        view = 'no-session';
        return;
      }
      sesi = data;
      lang = detectLang(data.modul_id);
      view = 'quiz';

      unsubscribeAccess = onSnapshot(doc(db, COLLECTIONS.sesi, 'reguler'), (s) => {
        if (!s.exists()) return;
        if ((s.data() as SesiReguler).akses?.posttest === false) {
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
    const questions = sesi.snapshot.posttest_questions;
    (async () => {
      for (let i = 0; i < questions.length; i++) {
        const container = editorContainers[i];
        if (container && !editors.has(i)) {
          const q = questions[i]!;
          const isHard = q.level === 'hard';
          try {
            editors.set(
              i,
              await createEditor(container, {
                language: isHard ? lang : 'plaintext',
                lineNumbers: isHard ? 'on' : 'off',
                value: isHard ? boilerplate : ''
              })
            );
          } catch (e) {
            console.error('Failed to mount editor', i, e);
          }
        }
      }
    })();
    if (questionsContainer) {
      setTimeout(() => renderMathJax(questionsContainer), 100);
    }
  });

  async function handleRunCode(i: number) {
    const code = editors.get(i)?.getValue().trim() ?? '';
    if (!code) {
      toast.show('Tulis kode terlebih dahulu!', 'error');
      return;
    }
    outputs[i] = { result: null, running: true };
    const result = await runCode(code, lang);
    outputs[i] = { result, running: false };
  }

  function clearOutput(i: number) {
    delete outputs[i];
    outputs = { ...outputs };
  }

  async function submit(autoSubmit = false) {
    if (!sesi || !authState.mahasiswa || submitting) return;

    const questions = sesi.snapshot.posttest_questions;
    const answers = questions.map((q, i) => {
      const val = editors.get(i)?.getValue().trim() ?? '';
      const isHard = q.level === 'hard' && q.instruksi;
      if (isHard) {
        return {
          level: 'hard' as const,
          opsi: q.opsi,
          deskripsi: q.deskripsi,
          instruksi: q.instruksi,
          jawaban_mahasiswa: val,
          jawaban_referensi: q.jawaban_referensi
        };
      }
      return {
        nomor: q.nomor,
        level: q.level,
        soal: q.soal,
        jawaban_mahasiswa: val,
        jawaban_referensi: q.jawaban_referensi
      };
    });

    const empty = answers.filter((a) => !a.jawaban_mahasiswa).length;
    if (empty > 0 && !autoSubmit) {
      toast.show(`Masih ada ${empty} soal belum dijawab!`, 'error');
      return;
    }

    submitting = true;
    try {
      const nim = authState.mahasiswa.nim;
      await setDoc(doc(db, COLLECTIONS.jawaban, `${nim}_${sesi.modul_id}_posttest`), {
        nim,
        modul_id: sesi.modul_id,
        type: 'posttest',
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
        message: `Submitted jawaban Post-test (${MODUL_INFO[sesi.modul_id].display_name})`
      });
      view = autoSubmit ? 'denied' : 'submitted';
      if (!autoSubmit) toast.show('Jawaban berhasil dikirim!', 'success');
    } catch (err) {
      console.error('Error submitting:', err);
      toast.show('Gagal mengirim jawaban', 'error');
    } finally {
      submitting = false;
    }
  }
</script>

<Navbar title="POST-TEST" showBack backHref="/" />

<main class="dashboard-content content-full">
  {#if view === 'quiz' && sesi}
    {@const questions = sesi.snapshot.posttest_questions}
    <header class="quiz-header animate-fade-in">
      <h1>Post-test — <span class="highlight">{MODUL_INFO[sesi.modul_id].display_name}</span></h1>
      <p class="text-muted">
        Jawab semua pertanyaan di bawah ini. Total: <strong>{questions.length} soal</strong>
      </p>
    </header>

    <div class="quiz-questions-list" bind:this={questionsContainer}>
      {#each questions as q, i (q.nomor ?? `hard-${i}`)}
        {@const isHard = q.level === 'hard'}
        <div class="quiz-card glass-panel animate-fade-in" style="animation-delay: {i * 0.1}s;">
          <div class="quiz-card-header">
            <span class="quiz-number">Soal {i + 1}</span>
            <span class="badge badge-{q.level}">
              {isHard
                ? `HARD — ${lang === 'c' ? 'C' : 'Python'}${q.opsi ? ` (Opsi ${q.opsi})` : ''}`
                : q.level.toUpperCase()}
            </span>
          </div>

          {#if isHard}
            <div class="quiz-card-body">
              <div class="ket-layout">
                <div class="ket-instructions">
                  <div class="card glass-panel">
                    <div class="card-header"><h3>📋 Soal</h3></div>
                    <div class="card-body">
                      <div class="quiz-question markdown-body">
                        {@html renderMarkdownToHtml(q.deskripsi)}
                      </div>
                    </div>
                  </div>
                </div>
                <div class="ket-editor" style="position:sticky; top:1rem; align-self:start;">
                  <div class="card glass-panel editor-card">
                    <div class="card-header editor-header"><h3>💻 Code Editor</h3></div>
                    <div class="editor-wrapper">
                      <div
                        bind:this={editorContainers[i]}
                        style="height: 500px; width: 100%; border-radius: 8px; border: 1px solid var(--panel-border); overflow: hidden; background: #1e1e1e;"
                      ></div>
                    </div>
                  </div>
                </div>
              </div>

              <div class="run-section" style="margin-top:0.75rem;">
                <button class="run-btn" disabled={outputs[i]?.running} onclick={() => handleRunCode(i)}>
                  <span class="btn-text" class:loader-hidden={outputs[i]?.running}>▶ Run Code</span>
                  <div
                    class="spinner"
                    style="width:16px;height:16px;border-width:2px;"
                    class:loader-hidden={!outputs[i]?.running}
                  ></div>
                </button>
                {#if outputs[i]?.result}
                  {@const r = outputs[i].result}
                  <div class="output-panel">
                    <div class="output-header">
                      <span>📟 Output</span>
                      <button class="output-clear" onclick={() => clearOutput(i)}>Clear</button>
                    </div>
                    <pre
                      class="output-content {r.success ? 'output-success' : 'output-error'}">{r.success ? r.output || '(Tidak ada output)' : r.error || r.output || 'Error tidak diketahui'}</pre>
                  </div>
                {/if}
              </div>
            </div>
          {:else}
            <div class="quiz-card-body">
              <div class="quiz-question markdown-body">{@html renderMarkdownToHtml(q.soal)}</div>
              <div class="input-group" style="margin-bottom:0;">
                <label for="editor-{i}">Jawaban Anda</label>
                <div
                  bind:this={editorContainers[i]}
                  id="editor-{i}"
                  style="height: 150px; width: 100%; border-radius: 8px; border: 1px solid var(--panel-border); overflow: hidden; background: #1e1e1e;"
                ></div>
              </div>
            </div>
          {/if}
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
        <span class="btn-text" class:loader-hidden={submitting}>Kirim Jawaban Post-test</span>
        <div class="spinner" class:loader-hidden={!submitting}></div>
      </button>
    </div>
  {:else}
    <QuizState state={view} label="Post-test" loadingText="Memuat soal..." />
  {/if}
</main>
