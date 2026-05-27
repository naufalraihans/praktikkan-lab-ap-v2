<script lang="ts">
  import { signOut } from 'firebase/auth';
  import { auth } from '$lib/firebase/client';
  import { authState } from '$lib/stores/auth.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { goto } from '$app/navigation';

  interface Props {
    title?: string;
    subtitle?: string;
    showBack?: boolean;
    backHref?: string;
  }

  let {
    title = 'LAB-AP',
    subtitle = 'laboratorium algoritma dan pemrograman',
    showBack = false,
    backHref = '/'
  }: Props = $props();

  async function handleLogout() {
    try {
      await signOut(auth);
      toast.show('Berhasil logout', 'success');
      await goto('/');
    } catch {
      toast.show('Gagal logout', 'error');
    }
  }
</script>

<nav class="navbar glass-panel">
  <div class="nav-brand">
    <img src="/logoLab.png" alt="Lab-AP Logo" class="brand-logo-small" />
    <div class="brand-text">
      <span class="brand-title">{title}</span>
      <span class="brand-subtitle">{subtitle}</span>
    </div>
  </div>
  <div class="nav-actions">
    {#if showBack}
      <a href={backHref} class="secondary-btn">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        Kembali
      </a>
    {/if}
    {#if authState.isLoggedIn}
      <button class="secondary-btn" onclick={handleLogout}> Logout </button>
    {/if}
  </div>
</nav>
