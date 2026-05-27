<script lang="ts">
  /**
   * 4 non-quiz state containers (loading / no-session / denied / submitted).
   * Quiz state sendiri di-handle oleh page (karena content beda-beda).
   * State 'quiz' di-ignore (render nothing) supaya page bisa pass full ViewState
   * tanpa narrowing manual.
   */
  type State = 'loading' | 'no-session' | 'denied' | 'submitted' | 'quiz';

  interface Props {
    state: State;
    /** Label aktivitas — dipakai di message no-session, denied, submitted. */
    label: string;
    /** Custom text untuk state loading. Default: "Memuat..." */
    loadingText?: string;
    /** Custom title untuk state submitted. Default: "Jawaban Terkirim!" */
    submittedTitle?: string;
    /** Custom subtitle untuk state submitted. Default: "Jawaban {label} Anda telah disimpan." */
    submittedText?: string;
  }

  let {
    state,
    label,
    loadingText = 'Memuat...',
    submittedTitle = 'Jawaban Terkirim!',
    submittedText = `Jawaban ${label} Anda telah berhasil disimpan.`
  }: Props = $props();
</script>

{#if state === 'loading'}
  <div class="quiz-state-container">
    <div class="spinner" style="width:40px;height:40px;border-width:3px;"></div>
    <p class="text-muted mt-4">{loadingText}</p>
  </div>
{:else if state === 'no-session'}
  <div class="quiz-state-container">
    <div class="card glass-panel" style="text-align:center; max-width:500px; padding:2.5rem;">
      <h2>Belum Ada Sesi Aktif</h2>
      <p class="text-muted mt-4">
        Admin belum mengaktifkan sesi {label} untuk hari ini.
      </p>
      <a href="/" class="primary-btn mt-4" style="display:inline-block;">Kembali ke Lobby</a>
    </div>
  </div>
{:else if state === 'denied'}
  <div class="quiz-state-container">
    <div class="card glass-panel" style="text-align:center; max-width:500px; padding:2.5rem;">
      <h2>Akses Ditutup</h2>
      <p class="text-muted mt-4">Admin telah menutup akses {label}.</p>
      <a href="/" class="primary-btn mt-4" style="display:inline-block;">Kembali ke Lobby</a>
    </div>
  </div>
{:else if state === 'submitted'}
  <div class="quiz-state-container">
    <div class="card glass-panel" style="text-align:center; max-width:500px; padding:2.5rem;">
      <h2 style="color: var(--success);">{submittedTitle}</h2>
      <p class="text-muted mt-4">{submittedText}</p>
      <a href="/" class="primary-btn mt-4" style="display:inline-block;">Kembali ke Lobby</a>
    </div>
  </div>
{/if}
