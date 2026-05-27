<script lang="ts">
  import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
  import { db } from '$lib/firebase/client';
  import { COLLECTIONS } from '$lib/firebase/constants';
  import { authState } from '$lib/stores/auth.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { createEditor, renderMathJax } from '$lib/utils/monaco';
  import { renderMarkdownToHtml } from '$lib/utils/markdown';
  import { logActivity } from '$lib/utils/activity-log';
  import type { Lang } from '$lib/utils/code-runner';
  import Navbar from '$lib/components/Navbar.svelte';
  import QuizState from '$lib/components/QuizState.svelte';
  import type { SesiUjianPraktik, SoalUjianPraktik } from '$lib/firebase/types';

  type ViewState = 'loading' | 'token-entry' | 'no-session' | 'denied' | 'quiz' | 'submitted';

  interface MonacoEditor {
    getValue: () => string;
    setValue: (v: string) => void;
    getModel: () => unknown;
    onDidChangeModelContent: (cb: () => void) => void;
    layout: () => void;
  }

  const BOILERPLATES: Record<Lang, string> = {
    c: '#include <stdio.h>\n\nint main() {\n    \n    return 0;\n}',
    python: '# Tulis kode Python di sini\n'
  };

  let view = $state<ViewState>('loading');
  let sesi = $state<SesiUjianPraktik | null>(null);
  let soalList = $state<SoalUjianPraktik[]>([]);
  let tokenInput = $state('');
  let verifying = $state(false);
  let submitting = $state(false);

  // UI state
  let activeSoalIndex = $state(0);
  let editorContainers = $state<(HTMLDivElement | null)[]>([]);
  let codeStates = $state<Record<number, string>>({});
  let langStates = $state<Record<number, Lang>>({}); // for flowchart

  const editors = new Map<number, MonacoEditor>();
  let unsubscribeAccess: (() => void) | null = null;
  let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

  const autosaveKey = $derived(`ujian_autosave_${authState.mahasiswa?.nim ?? 'anon'}`);

  $effect(() => {
    if (authState.isLoggedIn && !authState.isAdmin && view === 'loading') {
      init();
    }
  });

  $effect(() => () => {
    unsubscribeAccess?.();
    if (autosaveTimer) clearTimeout(autosaveTimer);
  });

  async function init() {
    try {
      const snap = await getDoc(doc(db, COLLECTIONS.sesi, 'ujian_praktik'));
      if (!snap.exists()) {
        view = 'no-session';
        return;
      }
      const data = snap.data() as SesiUjianPraktik;
      if (data.akses?.ujian_praktik === false) {
        view = 'denied';
        return;
      }
      sesi = data;
      view = 'token-entry';
    } catch (err) {
      console.error('Error init ujian:', err);
      toast.show('Gagal memuat data ujian', 'error');
    }
  }

  async function verifyToken(e: SubmitEvent) {
    e.preventDefault();
    if (!sesi) return;
    if (tokenInput.toUpperCase().trim() !== sesi.token) {
      toast.show('Token salah! Periksa kembali.', 'error');
      return;
    }
    if (sesi.akses?.ujian_praktik === false) {
      view = 'denied';
      return;
    }
    verifying = true;
    soalList = sesi.snapshot.soal ?? [];
    // Init langStates untuk flowchart (default 'c')
    soalList.forEach((s, i) => {
      if (s.legacy_origin === 'flowchart' || s.gambar) {
        langStates[i] = 'c';
      }
    });
    view = 'quiz';
    setupAccessListener();
    verifying = false;
  }

  function setupAccessListener() {
    unsubscribeAccess = onSnapshot(doc(db, COLLECTIONS.sesi, 'ujian_praktik'), (s) => {
      if (!s.exists()) return;
      if ((s.data() as SesiUjianPraktik).akses?.ujian_praktik === false) {
        unsubscribeAccess?.();
        toast.show('Waktu habis! Jawaban akan otomatis dikirim...', 'error');
        submit(true);
      }
    });
  }

  // Mount editors + restore autosave saat quiz view ready
  $effect(() => {
    if (view !== 'quiz' || soalList.length === 0) return;

    (async () => {
      for (let i = 0; i < soalList.length; i++) {
        const container = editorContainers[i];
        if (container && !editors.has(i)) {
          const s = soalList[i]!;
          const isFlowchart = s.legacy_origin === 'flowchart' || !!s.gambar;
          const lang = isFlowchart ? langStates[i] ?? 'c' : (s.bahasa as Lang) ?? 'c';
          const boilerplate = BOILERPLATES[lang];

          try {
            const ed = (await createEditor(container, {
              value: boilerplate,
              language: lang,
              lineNumbers: 'on'
            })) as MonacoEditor;
            editors.set(i, ed);
            codeStates[i] = boilerplate;

            ed.onDidChangeModelContent(() => {
              codeStates[i] = ed.getValue();
              triggerAutosave();
            });

            // Re-layout after mount (containers with display:none on init)
            setTimeout(() => ed.layout(), 50);
          } catch (e) {
            console.error('Failed to mount editor', i, e);
          }
        }
      }
      // Restore autosave setelah semua editor siap
      restoreAutosave();
    })();

    setTimeout(() => renderMathJax(document.body), 200);
  });

  function goToSoal(i: number) {
    activeSoalIndex = i;
    // Re-layout the newly visible editor
    setTimeout(() => {
      editors.get(i)?.layout();
    }, 10);
  }

  function switchFlowchartLang(i: number, newLang: Lang) {
    langStates[i] = newLang;
    const ed = editors.get(i);
    if (!ed) return;
    const win = window as unknown as {
      monaco?: { editor: { setModelLanguage: (m: unknown, l: string) => void } };
    };
    win.monaco?.editor.setModelLanguage(ed.getModel(), newLang);
    const current = ed.getValue().trim();
    if (
      current === '' ||
      current === BOILERPLATES.c.trim() ||
      current === BOILERPLATES.python.trim()
    ) {
      ed.setValue(BOILERPLATES[newLang]);
    }
    triggerAutosave();
  }

  // === AUTOSAVE ===
  function triggerAutosave() {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(saveToLocalStorage, 500);
  }

  function saveToLocalStorage() {
    if (!sesi) return;
    try {
      const data = soalList.map((s, i) => {
        const isFlowchart = s.legacy_origin === 'flowchart' || !!s.gambar;
        const entry: { kode: string; bahasa?: Lang } = {
          kode: editors.get(i)?.getValue() ?? ''
        };
        if (isFlowchart) entry.bahasa = langStates[i] ?? 'c';
        return entry;
      });
      localStorage.setItem(
        autosaveKey,
        JSON.stringify({
          token: sesi.token,
          saved_at: new Date().toISOString(),
          answers: data
        })
      );
    } catch (e) {
      console.warn('Autosave failed:', e);
    }
  }

  function restoreAutosave() {
    if (!sesi) return;
    try {
      const raw = localStorage.getItem(autosaveKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        token: string;
        saved_at: string;
        answers: { kode: string; bahasa?: Lang }[];
      };
      if (saved.token !== sesi.token) {
        localStorage.removeItem(autosaveKey);
        return;
      }
      saved.answers?.forEach((a, i) => {
        if (i >= soalList.length) return;
        const ed = editors.get(i);
        if (ed && a.kode) ed.setValue(a.kode);
        if (a.bahasa && (soalList[i]?.legacy_origin === 'flowchart' || soalList[i]?.gambar)) {
          langStates[i] = a.bahasa;
        }
      });
      toast.show('✅ Pengerjaan sebelumnya berhasil dipulihkan!', 'success');
    } catch (e) {
      console.warn('Restore autosave failed:', e);
    }
  }

  function clearAutosave() {
    try {
      localStorage.removeItem(autosaveKey);
    } catch (_) {
      // ignore
    }
  }

  // === STATUS PER SOAL ===
  function isFilled(i: number): boolean {
    const val = (codeStates[i] ?? '').trim();
    if (!val) return false;
    if (val === BOILERPLATES.c.trim()) return false;
    if (val === BOILERPLATES.python.trim()) return false;
    return true;
  }

  function soalIcon(s: SoalUjianPraktik): string {
    if (s.legacy_origin === 'flowchart' || s.gambar) return '📊';
    return s.bahasa === 'python' ? '🐍' : '📝';
  }

  // === SUBMIT ===
  async function submit(autoSubmit = false) {
    if (!sesi || !authState.mahasiswa || submitting) return;

    const jawaban = soalList.map((s, i) => {
      const kode = editors.get(i)?.getValue().trim() ?? '';
      const isFlowchart = s.legacy_origin === 'flowchart' || !!s.gambar;

      if (isFlowchart) {
        return {
          modul: 'flowchart',
          opsi: s.opsi,
          gambar: s.gambar,
          deskripsi: s.deskripsi,
          poin: s.poin,
          instruksi: s.instruksi ?? [],
          bahasa: langStates[i] ?? 'c',
          kode
        };
      }
      return {
        modul: s.legacy_origin ?? s.modul_id,
        opsi: s.opsi,
        deskripsi: s.deskripsi,
        instruksi: s.instruksi,
        bahasa: s.bahasa,
        kode
      };
    });

    if (!autoSubmit) {
      const empty = jawaban.filter(
        (j) =>
          !j.kode ||
          j.kode === BOILERPLATES.c.trim() ||
          j.kode === BOILERPLATES.python.trim()
      );
      if (empty.length > 0) {
        const confirmed = window.confirm(
          `Ada ${empty.length} soal yang belum dijawab. Tetap kirim?`
        );
        if (!confirmed) return;
      }
    }

    submitting = true;
    try {
      const nim = authState.mahasiswa.nim;
      const jawabanId = `${nim}_uprak_ujian_praktik`;

      await setDoc(doc(db, COLLECTIONS.jawaban, jawabanId), {
        nim,
        modul_id: 'uprak',
        type: 'ujian_praktik',
        tanggal: sesi.tanggal,
        submitted_at: serverTimestamp(),
        snapshot: { nama: authState.mahasiswa.nama, kelas: authState.mahasiswa.kelas },
        answers: jawaban,
        nilai: null,
        grading_detail: null
      });

      await logActivity({
        role: 'mhs',
        nim,
        action: 'submitted_jawaban',
        message: 'Submitted jawaban Ujian Praktik'
      });

      clearAutosave();
      view = autoSubmit ? 'denied' : 'submitted';
      if (!autoSubmit) toast.show('Jawaban berhasil dikirim!', 'success');
      unsubscribeAccess?.();
    } catch (err) {
      console.error('Error submitting:', err);
      toast.show('Gagal mengirim jawaban', 'error');
    } finally {
      submitting = false;
    }
  }
</script>

<Navbar title="UJIAN PRAKTIK" showBack backHref="/" />

<main class="dashboard-content content-full">
  {#if view === 'token-entry' && sesi}
    <div class="quiz-state-container">
      <div class="login-card glass-panel" style="max-width:500px; text-align:center;">
        <h2>🔐 Masukkan Token Ujian</h2>
        <p class="subtitle mt-4">
          Masukkan token yang diberikan oleh admin untuk memulai ujian praktik.
        </p>
        <form onsubmit={verifyToken} style="margin-top:1.5rem;">
          <div class="input-group">
            <label for="token-input">Token Akses</label>
            <input
              id="token-input"
              type="text"
              bind:value={tokenInput}
              placeholder="Masukkan token (contoh: A7X9K2)"
              autocomplete="off"
              required
              style="text-align:center; font-size:1.5rem; font-weight:700; letter-spacing:4px; font-family:'Fira Code',monospace; text-transform:uppercase;"
            />
          </div>
          <button type="submit" class="primary-btn" disabled={verifying} style="width:100%;">
            <span class="btn-text" class:loader-hidden={verifying}>Masuk Ujian</span>
            <div class="spinner" class:loader-hidden={!verifying}></div>
          </button>
        </form>
      </div>
    </div>
  {:else if view === 'quiz' && sesi && soalList.length > 0}
    <div class="exam-layout">
      <main class="exam-main">
        <header class="quiz-header animate-fade-in" style="margin-bottom:1.5rem;">
          <h1>Ujian Praktik</h1>
          <p class="text-muted">
            Kerjakan semua soal di bawah ini. Tulis kode program sesuai instruksi.
          </p>
        </header>

        <div>
          {#each soalList as s, i (i)}
            {@const isFlowchart = s.legacy_origin === 'flowchart' || !!s.gambar}
            {@const langLabel = (langStates[i] ?? s.bahasa) === 'c' ? 'C' : 'Python'}
            <div style:display={i === activeSoalIndex ? 'block' : 'none'}>
              <div
                class="quiz-card glass-panel animate-fade-in"
                style="animation-delay: {i * 0.1}s; margin-bottom:1.5rem;"
              >
                <div class="quiz-card-header">
                  <span class="quiz-number">Soal {i + 1}</span>
                  {#if isFlowchart}
                    <span
                      class="badge"
                      style="background:rgba(139,92,246,0.15);color:#8b5cf6;">FLOWCHART TO PROGRAM</span
                    >
                  {:else}
                    <span class="badge badge-hard">
                      {s.legacy_origin ?? ''} — {langLabel} (Opsi {s.opsi})
                    </span>
                  {/if}
                </div>

                <div class="quiz-card-body">
                  {#if isFlowchart}
                    <p class="quiz-question" style="margin-bottom:0.75rem;">
                      Terjemahkan flowchart berikut ke dalam program (C atau Python):
                    </p>
                  {/if}

                  <div class="ket-layout">
                    <div class="ket-instructions {isFlowchart ? 'flowchart-container' : ''}">
                      <div class="card glass-panel" style={isFlowchart ? 'height:100%;' : ''}>
                        <div class="card-header">
                          <h3>{isFlowchart ? '📊 Flowchart' : '📋 Soal'}</h3>
                        </div>
                        <div
                          class="card-body"
                          style={isFlowchart
                            ? 'display:flex; justify-content:center; align-items:flex-start;'
                            : ''}
                        >
                          {#if isFlowchart}
                            <img
                              src="/ujianPraktik/{s.gambar}"
                              alt="Flowchart"
                              style="max-width:100%; border-radius:8px; background:#fff; padding:0.5rem;"
                            />
                          {:else}
                            <div class="quiz-question markdown-body">
                              {@html renderMarkdownToHtml(s.deskripsi)}
                            </div>
                          {/if}
                        </div>
                      </div>
                    </div>

                    <div class="ket-editor">
                      <div class="card glass-panel editor-card">
                        <div class="card-header editor-header">
                          <h3>💻 Code Editor</h3>
                          {#if isFlowchart}
                            <div class="editor-controls">
                              <select
                                class="select-input select-small"
                                value={langStates[i] ?? 'c'}
                                onchange={(e) =>
                                  switchFlowchartLang(
                                    i,
                                    (e.currentTarget as HTMLSelectElement).value as Lang
                                  )}
                              >
                                <option value="c">C</option>
                                <option value="python">Python</option>
                              </select>
                            </div>
                          {:else}
                            <span
                              class="badge"
                              style="background:rgba(100,5,15,0.2);color:#fca5a5;"
                              >{langLabel}</span
                            >
                          {/if}
                        </div>
                        <div class="editor-wrapper">
                          <div
                            bind:this={editorContainers[i]}
                            style="flex:1; min-height:400px; width:100%; border-radius:8px; border:1px solid var(--panel-border); overflow:hidden; background:#1e1e1e;"
                          ></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          {/each}
        </div>
      </main>

      <aside class="exam-sidebar">
        <div class="sidebar-header">
          <h3>⚡ Daftar Soal</h3>
        </div>
        <nav class="sidebar-nav">
          {#each soalList as s, i (i)}
            <button
              class="sidebar-item"
              class:active={i === activeSoalIndex}
              class:filled={isFilled(i)}
              onclick={() => goToSoal(i)}
            >
              <span class="sidebar-icon">{soalIcon(s)}</span>
              <span class="sidebar-label">Soal {i + 1}</span>
              <span class="sidebar-status">{isFilled(i) ? '✅' : '⬜'}</span>
            </button>
          {/each}
        </nav>
        <div class="sidebar-footer">
          <button
            class="primary-btn btn-activate"
            style="width:100%;"
            disabled={submitting}
            onclick={() => submit(false)}
          >
            <span class="btn-text" class:loader-hidden={submitting}>Kirim Jawaban</span>
            <div class="spinner" class:loader-hidden={!submitting}></div>
          </button>
        </div>
      </aside>
    </div>
  {:else}
    <QuizState
      state={view as Exclude<ViewState, 'token-entry'>}
      label="Ujian Praktik"
      submittedTitle="Jawaban Berhasil Dikirim!"
      submittedText="Jawaban ujian praktik Anda telah disimpan."
    />
  {/if}
</main>
