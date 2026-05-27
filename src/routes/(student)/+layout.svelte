<script lang="ts">
  /**
   * Route group guard untuk route mahasiswa (pretest, posttest, keterampilan, ujian).
   * - Redirect ke "/" kalau belum login atau role admin
   * - Show spinner kalau auth belum ready
   * - Render children kalau student logged in
   */
  import { goto } from '$app/navigation';
  import { authState } from '$lib/stores/auth.svelte';

  let { children } = $props();

  $effect(() => {
    if (!authState.ready) return;
    if (!authState.user) {
      goto('/');
      return;
    }
    if (authState.isAdmin) {
      goto('/');
    }
  });
</script>

{#if !authState.ready}
  <div class="quiz-state-container">
    <div class="spinner" style="width:40px;height:40px;border-width:3px;"></div>
    <p class="text-muted mt-4">Memeriksa sesi...</p>
  </div>
{:else if authState.isLoggedIn && !authState.isAdmin}
  {@render children()}
{/if}
