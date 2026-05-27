<script lang="ts">
  /**
   * Route group guard untuk page admin.
   * - Redirect ke "/" kalau belum login atau bukan admin
   * - Show spinner kalau auth belum ready
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
    if (!authState.isAdmin) {
      goto('/');
    }
  });
</script>

{#if !authState.ready}
  <div class="quiz-state-container">
    <div class="spinner" style="width:40px;height:40px;border-width:3px;"></div>
    <p class="text-muted mt-4">Memeriksa sesi...</p>
  </div>
{:else if authState.isAdmin}
  {@render children()}
{/if}
