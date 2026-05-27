<script lang="ts">
  /**
   * Admin shell: sidebar + topbar + main content.
   * Match desain asli (admin.html lama).
   */
  import { page } from '$app/state';
  import { signOut } from 'firebase/auth';
  import { goto } from '$app/navigation';
  import { auth } from '$lib/firebase/client';
  import { authState } from '$lib/stores/auth.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    children: Snippet;
  }

  let { title, children }: Props = $props();

  let sidebarOpen = $state(false);

  function toggleSidebar() {
    sidebarOpen = !sidebarOpen;
  }
  function closeSidebar() {
    sidebarOpen = false;
  }

  async function handleLogout() {
    try {
      await signOut(auth);
      toast.show('Berhasil logout', 'success');
      await goto('/');
    } catch {
      toast.show('Gagal logout', 'error');
    }
  }

  function isActive(href: string): boolean {
    return page.url.pathname === href;
  }

  const initial = $derived(authState.mahasiswa?.nama?.[0]?.toUpperCase() ?? 'A');
</script>

<div
  class="sidebar-overlay"
  class:active={sidebarOpen}
  onclick={closeSidebar}
  role="presentation"
></div>

<aside class="sidebar" class:open={sidebarOpen}>
  <div class="sidebar-brand">
    <img src="/logoLab.png" alt="Lab-AP Logo" />
    <div class="sidebar-brand-text">
      <span class="sidebar-brand-title">Lab-AP</span>
      <span class="sidebar-brand-sub">Admin Panel</span>
    </div>
  </div>

  <nav class="sidebar-nav">
    <span class="sidebar-label">Menu Utama</span>

    <a href="/admin" class="sidebar-item" class:active={isActive('/admin')}>
      <svg
        class="sidebar-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect
          x="14"
          y="14"
          width="7"
          height="7"
        /><rect x="3" y="14" width="7" height="7" />
      </svg>
      Dashboard
    </a>

    <a href="/rekap" class="sidebar-item" class:active={isActive('/rekap')}>
      <svg
        class="sidebar-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
      Rekap Jawaban
    </a>

    <a href="/rekap-nilai" class="sidebar-item" class:active={isActive('/rekap-nilai')}>
      <svg
        class="sidebar-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M3 3v18h18" /><path d="M18 9l-5 5-4-4-3 3" />
      </svg>
      Rekap Nilai
    </a>

    <span class="sidebar-label">Manajemen</span>

    <a href="/manage-akun" class="sidebar-item" class:active={isActive('/manage-akun')}>
      <svg
        class="sidebar-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
      Manage Akun
    </a>

    <a href="/manage-soal" class="sidebar-item" class:active={isActive('/manage-soal')}>
      <svg
        class="sidebar-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
      </svg>
      Manage Soal
    </a>

    <a href="/input-jawaban" class="sidebar-item" class:active={isActive('/input-jawaban')}>
      <svg
        class="sidebar-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <line x1="17" y1="10" x2="3" y2="10" />
        <line x1="21" y1="6" x2="3" y2="6" />
        <line x1="21" y1="14" x2="3" y2="14" />
        <line x1="17" y1="18" x2="3" y2="18" />
      </svg>
      Input Jawaban
    </a>

    <a href="/rubrik" class="sidebar-item" class:active={isActive('/rubrik')}>
      <svg
        class="sidebar-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect
          x="14"
          y="14"
          width="7"
          height="7"
        /><rect x="3" y="14" width="7" height="7" />
      </svg>
      Rubrik Penilaian
    </a>

    <span class="sidebar-label">Sistem</span>

    <a href="/logs" class="sidebar-item" class:active={isActive('/logs')}>
      <svg
        class="sidebar-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline points="4 7 4 4 20 4 20 7" />
        <line x1="9" y1="20" x2="15" y2="20" />
        <line x1="12" y1="4" x2="12" y2="20" />
      </svg>
      System Logs
    </a>
  </nav>

  <div class="sidebar-footer">
    <div class="sidebar-divider"></div>
    <button class="sidebar-item logout-item" onclick={handleLogout}>
      <svg
        class="sidebar-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <polyline points="16 17 21 12 16 7" />
        <line x1="21" y1="12" x2="9" y2="12" />
      </svg>
      Logout
    </button>
  </div>
</aside>

<div class="main-with-sidebar">
  <header class="dashboard-topbar">
    <div style="display:flex;align-items:center;gap:0.75rem;">
      <button class="sidebar-toggle" onclick={toggleSidebar} aria-label="Toggle sidebar">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          ><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line
            x1="3"
            y1="18"
            x2="21"
            y2="18"
          /></svg
        >
      </button>
      <h1 class="topbar-title">{title}</h1>
    </div>
    <div class="topbar-user">
      <div class="topbar-user-info" style="text-align:right;">
        <span class="topbar-user-name">{authState.mahasiswa?.nama ?? 'Administrator'}</span>
        <span class="topbar-user-role">Lab AP</span>
      </div>
      <div class="topbar-avatar">{initial}</div>
    </div>
  </header>

  <main class="dashboard-main">
    <div class="home-decor">
      <div class="laser-line laser-1"></div>
      <div class="laser-line laser-2"></div>
      <div class="laser-line laser-3"></div>
    </div>

    {@render children()}
  </main>
</div>
