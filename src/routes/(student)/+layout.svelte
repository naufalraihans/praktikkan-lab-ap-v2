<script lang="ts">
  /**
   * Route group guard untuk route mahasiswa.
   * Juga provide #app-container + home-decor wrapper sesuai pattern original.
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
  <div id="app-container">
    <div class="quiz-state-container">
      <div class="spinner" style="width:40px;height:40px;border-width:3px;"></div>
      <p class="text-muted mt-4">Memeriksa sesi...</p>
    </div>
  </div>
{:else if authState.isLoggedIn && !authState.isAdmin}
  <div id="app-container">
    <div class="home-decor">
      <div class="laser-line laser-1"></div>
      <div class="laser-line laser-2"></div>
      <div class="laser-line laser-3"></div>
    </div>
    {@render children()}
  </div>
{/if}
