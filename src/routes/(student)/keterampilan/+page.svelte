<script lang="ts">
  import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
  import { db } from '$lib/firebase/client';
  import { COLLECTIONS, MODUL_INFO } from '$lib/firebase/constants';
  import { authState } from '$lib/stores/auth.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { createEditor } from '$lib/utils/monaco';
  import { runCode, detectLang, type Lang, type RunCodeResult } from '$lib/utils/code-runner';
  import { logActivity } from '$lib/utils/activity-log';
  import { saveAutosave, loadAutosave, clearAutosave, makeDebounce } from '$lib/utils/autosave';
  import Navbar from '$lib/components/Navbar.svelte';
  import QuizState from '$lib/components/QuizState.svelte';
  import type { SesiReguler } from '$lib/firebase/types';

  type ViewState = 'loading' | 'no-session' | 'denied' | 'quiz' | 'submitted';

  const BOILERPLATES: Record<Lang, string> = {
    c: `#include <stdio.h>\n\nint main() {\n    // Tulis kode C Anda di sini\n    \n    return 0;\n}`,
    python: `# Tulis kode Python Anda di sini\n\n`
  };

  let view = $state<ViewState>('loading');
  let sesi = $state<SesiReguler | null>(null);
  let lang = $state<Lang>('c');
  let submitting = $state(false);

  let editorContainer = $state<HTMLDivElement | null>(null);
  let output = $state<{ result: RunCodeResult | null; running: boolean }>({
    result: null,
    running: false
  });

  interface MonacoMin {
    getValue: () => string;
    setValue: (v: string) => void;
    getModel: () => unknown;
    onDidChangeModelContent: (cb: () => void) => void;
  }
  let editor: MonacoMin | null = null;
  let unsubscribeAccess: (() => void) | null = null;

  function saveNow() {
    const m = authState.mahasiswa;
    if (!m || !sesi || !editor) return;
    saveAutosave(m.nim, sesi.modul_id, 'keterampilan', {
      kode: editor.getValue(),
      bahasa: lang
    });
  }
  const triggerAutosave = makeDebounce(saveNow, 300);

  $effect(() => {
    if (authState.isLoggedIn && !authState.isAdmin && view === 'loading') {
      loadKeterampilan();
    }
  });

  $effect(() => () => unsubscribeAccess?.());

  $effect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => saveNow();
    window.addEventListener('beforeunload', handler);
    window.addEventListener('pagehide', handler);
    return () => {
      saveNow();
      window.removeEventListener('beforeunload', handler);
      window.removeEventListener('pagehide', handler);
    };
  });

  async function loadKeterampilan() {
    try {
      const snap = await getDoc(doc(db, COLLECTIONS.sesi, 'reguler'));
      if (!snap.exists()) {
        view = 'no-session';
        return;
      }
      const data = snap.data() as SesiReguler;
      if (data.akses?.keterampilan === false) {
        view = 'denied';
        return;
      }
      const items = data.snapshot?.keterampilan_items ?? [];
      if (items.length === 0) {
        view = 'no-session';
        return;
      }
      sesi = data;
      lang = detectLang(data.modul_id);
      view = 'quiz';

      unsubscribeAccess = onSnapshot(doc(db, COLLECTIONS.sesi, 'reguler'), (s) => {
        if (!s.exists()) return;
        if ((s.data() as SesiReguler).akses?.keterampilan === false) {
          unsubscribeAccess?.();
          toast.show('Waktu habis! Menutup sesi otomatis...', 'error');
          submit(true);
        }
      });
    } catch (err) {
      console.error('Error loading keterampilan:', err);
      toast.show('Gagal memuat soal', 'error');
    }
  }

  $effect(() => {
    if (view !== 'quiz' || !editorContainer || editor) return;
    const m = authState.mahasiswa;
    const s = sesi;
    if (!m || !s) return;

    const saved = loadAutosave<{ kode: string; bahasa: Lang }>(m.nim, s.modul_id, 'keterampilan');

    (async () => {
      try {
        const initialLang = saved?.bahasa ?? lang;
        const initialValue = saved?.kode && saved.kode.trim() ? saved.kode : BOILERPLATES[initialLang];
        if (saved?.bahasa) lang = saved.bahasa;
        const ed = (await createEditor(editorContainer!, {
          value: initialValue,
          language: initialLang,
          lineNumbers: 'on'
        })) as MonacoMin;
        ed.onDidChangeModelContent(() => triggerAutosave());
        editor = ed;
        if (saved?.kode && saved.kode.trim() && saved.kode !== BOILERPLATES[initialLang]) {
          toast.show('✅ Jawaban sebelumnya dipulihkan', 'success');
        }
      } catch (e) {
        console.error('Failed to mount editor', e);
      }
    })();
  });

  function handleLangChange(newLang: Lang) {
    lang = newLang;
    if (!editor) return;
    const win = window as unknown as {
      monaco?: { editor: { setModelLanguage: (m: unknown, l: string) => void } };
    };
    if (win.monaco) {
      win.monaco.editor.setModelLanguage(editor.getModel(), newLang);
    }
    const current = editor.getValue().trim();
    if (
      current === '' ||
      current === BOILERPLATES.c.trim() ||
      current === BOILERPLATES.python.trim()
    ) {
      editor.setValue(BOILERPLATES[newLang]);
    }
    triggerAutosave();
  }

  async function handleRunCode() {
    const code = editor?.getValue().trim() ?? '';
    if (!code) {
      toast.show('Tulis kode terlebih dahulu!', 'error');
      return;
    }
    output = { result: null, running: true };
    const result = await runCode(code, lang);
    output = { result, running: false };
  }

  function clearOutput() {
    output = { result: null, running: false };
  }

  async function submit(autoSubmit = false) {
    if (!sesi || !authState.mahasiswa || submitting) return;

    const code = editor?.getValue() ?? '';
    const trimmed = code.trim();
    if ((!trimmed || trimmed === BOILERPLATES[lang].trim()) && !autoSubmit) {
      toast.show('Tulis kode program terlebih dahulu!', 'error');
      return;
    }

    submitting = true;
    try {
      const nim = authState.mahasiswa.nim;
      await setDoc(doc(db, COLLECTIONS.jawaban, `${nim}_${sesi.modul_id}_keterampilan`), {
        nim,
        modul_id: sesi.modul_id,
        type: 'keterampilan',
        tanggal: sesi.tanggal,
        submitted_at: serverTimestamp(),
        snapshot: { nama: authState.mahasiswa.nama, kelas: authState.mahasiswa.kelas },
        bahasa: lang,
        kode: code,
        nilai: null,
        grading_detail: null
      });
      await logActivity({
        role: 'mhs',
        nim,
        action: 'submitted_jawaban',
        message: `Submitted jawaban Keterampilan (${MODUL_INFO[sesi.modul_id].display_name})`
      });
      clearAutosave(nim, sesi.modul_id, 'keterampilan');
      view = autoSubmit ? 'denied' : 'submitted';
      if (!autoSubmit) toast.show('Kode berhasil dikirim!', 'success');
    } catch (err) {
      console.error('Error submitting:', err);
      if (autoSubmit) {
        view = 'denied';
        toast.show('Sesi ditutup. Kode tersimpan di local — hubungi admin.', 'error');
      } else {
        toast.show('Gagal mengirim kode', 'error');
      }
    } finally {
      submitting = false;
    }
  }

  const totalPoin = $derived(
    (sesi?.snapshot.keterampilan_items ?? []).reduce((sum, it) => sum + (it.poin ?? 0), 0)
  );
</script>

<Navbar title="KETERAMPILAN" showBack backHref="/" />

<main class="dashboard-content content-full">
  {#if view === 'quiz' && sesi}
    {@const items = sesi.snapshot.keterampilan_items}
    {@const judul = sesi.snapshot.keterampilan_judul_program}
    <header class="quiz-header animate-fade-in">
      <h1>
        Program Keterampilan — <span class="highlight"
          >{MODUL_INFO[sesi.modul_id].display_name}</span
        >
      </h1>
      {#if judul}
        <p
          style="font-size:1.1rem; font-weight:600; color:var(--primary-hover); margin-bottom:0.25rem;"
        >
          📌 {judul}
        </p>
      {/if}
      <p class="text-muted">Tulis kode program sesuai instruksi di bawah ini.</p>
    </header>

    <div class="ket-layout">
      <div class="ket-instructions">
        <div class="card glass-panel">
          <div class="card-header"><h3>📋 Instruksi & Rubrik Penilaian</h3></div>
          <div class="card-body">
            <div>
              {#each items as item, i (i)}
                {@const isBonus = item.kunci_jawaban === 'Bonus Otomatis'}
                <div class="instruction-item {isBonus ? 'instruction-bonus' : ''}">
                  <div class="instruction-header">
                    <span class="instruction-num">{i + 1}</span>
                    <span class="instruction-poin">{item.poin} poin</span>
                  </div>
                  <p class="instruction-text">{item.referensi}</p>
                  {#if isBonus}
                    <span
                      class="badge"
                      style="background: rgba(16,185,129,0.15); color: #10b981; margin-top:0.5rem;"
                    >
                      BONUS OTOMATIS
                    </span>
                  {/if}
                </div>
              {/each}
            </div>
            <div class="ket-total-poin mt-4">
              Total Poin: <strong>{totalPoin}</strong>
            </div>
          </div>
        </div>
      </div>

      <div class="ket-editor" style="position:sticky; top:1rem; align-self:start;">
        <div class="card glass-panel editor-card">
          <div class="card-header editor-header">
            <h3>💻 Code Editor</h3>
            <div class="editor-controls">
              <select
                class="select-input select-small"
                value={lang}
                onchange={(e) =>
                  handleLangChange((e.currentTarget as HTMLSelectElement).value as Lang)}
              >
                <option value="c">C</option>
                <option value="python">Python</option>
              </select>
            </div>
          </div>
          <div class="editor-wrapper">
            <div
              bind:this={editorContainer}
              style="height: 550px; width: 100%; border-radius: 8px; border: 1px solid var(--panel-border); overflow: hidden; background: #1e1e1e;"
            ></div>
          </div>
        </div>
      </div>
    </div>

    <div class="run-section" style="margin-top:1rem;">
      <button class="run-btn" disabled={output.running} onclick={handleRunCode}>
        <span class="btn-text" class:loader-hidden={output.running}>▶ Run Code</span>
        <div
          class="spinner"
          style="width:16px;height:16px;border-width:2px;"
          class:loader-hidden={!output.running}
        ></div>
      </button>
      {#if output.result}
        {@const r = output.result}
        <div class="output-panel">
          <div class="output-header">
            <span>📟 Output</span>
            <button class="output-clear" onclick={clearOutput}>Clear</button>
          </div>
          <pre
            class="output-content {r.success ? 'output-success' : 'output-error'}">{r.success ? r.output || '(Tidak ada output)' : r.error || r.output || 'Error tidak diketahui'}</pre>
        </div>
      {/if}
    </div>

    <div class="quiz-submit-area" style="margin-top:2rem;">
      <button
        class="primary-btn btn-activate"
        style="width:100%; max-width:400px;"
        disabled={submitting}
        onclick={() => submit(false)}
      >
        <span class="btn-text" class:loader-hidden={submitting}>Kirim Kode Program</span>
        <div class="spinner" class:loader-hidden={!submitting}></div>
      </button>
    </div>
  {:else}
    <QuizState
      state={view}
      label="Keterampilan"
      loadingText="Memuat soal keterampilan..."
      submittedTitle="Kode Berhasil Dikirim!"
      submittedText="Kode program keterampilan Anda telah disimpan."
    />
  {/if}
</main>
