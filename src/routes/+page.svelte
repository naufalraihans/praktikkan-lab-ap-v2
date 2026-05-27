<script lang="ts">
  import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
  import {
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword
  } from 'firebase/auth';
  import { goto } from '$app/navigation';
  import { auth, db, emailFromNim } from '$lib/firebase/client';
  import { COLLECTIONS } from '$lib/firebase/constants';
  import { authState } from '$lib/stores/auth.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import type { Mahasiswa } from '$lib/firebase/types';

  type View = 'login' | 'set-password' | 'enter-password';

  let view = $state<View>('login');
  let loading = $state(false);
  let nimInput = $state('');
  let passwordInput = $state('');
  let passwordConfirm = $state('');
  let fetchedMahasiswa = $state<Mahasiswa | null>(null);

  // Admin auto-redirect ke /admin
  $effect(() => {
    if (authState.ready && authState.isAdmin) {
      goto('/admin');
    }
  });

  async function handleNimSubmit(e: SubmitEvent) {
    e.preventDefault();
    const nim = nimInput.trim();
    if (!nim) {
      toast.show('NIM tidak boleh kosong', 'error');
      return;
    }
    loading = true;
    try {
      const snap = await getDoc(doc(db, COLLECTIONS.mahasiswa, nim));
      if (!snap.exists()) {
        toast.show('NIM tidak terdaftar', 'error');
        return;
      }
      fetchedMahasiswa = snap.data() as Mahasiswa;
      view = fetchedMahasiswa.is_registered ? 'enter-password' : 'set-password';
      toast.show('NIM ditemukan', 'success');
    } catch (err) {
      console.error(err);
      toast.show('Kesalahan koneksi', 'error');
    } finally {
      loading = false;
    }
  }

  async function handleSetPassword(e: SubmitEvent) {
    e.preventDefault();
    if (passwordInput !== passwordConfirm) {
      toast.show('Konfirmasi password tidak cocok', 'error');
      return;
    }
    if (passwordInput.length < 6) {
      toast.show('Password minimal 6 karakter', 'error');
      return;
    }
    loading = true;
    try {
      const email = emailFromNim(nimInput.trim());
      await createUserWithEmailAndPassword(auth, email, passwordInput);
      await updateDoc(doc(db, COLLECTIONS.mahasiswa, nimInput.trim()), {
        is_registered: true,
        registered_at: serverTimestamp()
      });
      toast.show('Registrasi berhasil', 'success');
    } catch (err) {
      console.error(err);
      toast.show('Gagal registrasi', 'error');
    } finally {
      loading = false;
    }
  }

  async function handleLogin(e: SubmitEvent) {
    e.preventDefault();
    loading = true;
    try {
      const email = emailFromNim(nimInput.trim());
      await signInWithEmailAndPassword(auth, email, passwordInput);
      toast.show('Login berhasil', 'success');
    } catch (err) {
      console.error(err);
      toast.show('Password salah', 'error');
    } finally {
      loading = false;
    }
  }

  function resetFlow() {
    view = 'login';
    nimInput = '';
    passwordInput = '';
    passwordConfirm = '';
    fetchedMahasiswa = null;
  }
</script>

{#if !authState.ready}
  <div id="app-container">
    <div class="view-container active">
      <div class="login-card glass-panel" style="text-align:center;">
        <div class="spinner" style="width:40px;height:40px;border-width:3px;margin:0 auto;"></div>
        <p class="text-muted mt-4">Memuat...</p>
      </div>
    </div>
  </div>
{:else if authState.isLoggedIn && authState.mahasiswa && !authState.isAdmin}
  <!-- ====== HOME / LOBBY (STUDENT) ====== -->
  <div id="app-container">
    <div class="view-container active">
      <div class="home-decor">
        <div class="laser-line laser-1"></div>
        <div class="laser-line laser-2"></div>
        <div class="laser-line laser-3"></div>
      </div>

      <nav class="navbar glass-panel">
        <div class="nav-brand">
          <img src="/logoLab.png" alt="Lab-AP Logo" class="brand-logo-small" />
          <div class="brand-text">
            <span class="brand-title">LABORATORIUM</span>
            <span class="brand-subtitle">algoritma dan pemrograman</span>
          </div>
        </div>
        <div class="nav-actions">
          <div class="user-chip">
            <span class="dot"></span>
            <span>{authState.mahasiswa.nama}</span>
          </div>
          <button
            class="secondary-btn"
            onclick={async () => {
              const { signOut } = await import('firebase/auth');
              await signOut(auth);
              toast.show('Logout berhasil', 'success');
            }}
          >
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
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Logout
          </button>
        </div>
      </nav>

      <main class="dashboard-content">
        <header class="dashboard-header animate-fade-in">
          <h1>
            Selamat datang, <span class="highlight">{authState.mahasiswa.nama}</span>!
          </h1>
          <p>
            Anda berhasil masuk ke halaman utama Laboratorium Algoritma dan Pemrograman.
          </p>
        </header>

        <div class="dashboard-grid">
          <div class="card glass-panel animate-fade-in-delayed">
            <div class="card-header">
              <h3>Data Mahasiswa</h3>
            </div>
            <div class="card-body">
              <div class="info-row">
                <span class="label">Nama Lengkap</span>
                <span class="value">{authState.mahasiswa.nama}</span>
              </div>
              <div class="info-row">
                <span class="label">Nomor Induk Mahasiswa (NIM)</span>
                <span class="value">{authState.mahasiswa.nim}</span>
              </div>
              <div class="info-row">
                <span class="label">Kelas</span>
                <span class="value badge">{authState.mahasiswa.kelas}</span>
              </div>
            </div>
          </div>

          <div class="card glass-panel abstract-decor animate-fade-in-delayed-more">
            <div class="decor-circle"></div>
            <div class="card-content">
              <h3>Siap Praktikum?</h3>
              <p>
                Pastikan Anda sudah mengekstrak tugas dan menyiapkan modul sebelum memulai sesi hari
                ini.
              </p>
              <div
                style="display:grid; gap:0.5rem; grid-template-columns: repeat(2, 1fr); margin-top:1.25rem;"
              >
                <a href="/pretest" class="primary-btn" style="text-align:center;">Pre-test</a>
                <a href="/posttest" class="primary-btn" style="text-align:center;">Post-test</a>
                <a href="/keterampilan" class="primary-btn" style="text-align:center;"
                  >Keterampilan</a
                >
                <a href="/ujian" class="primary-btn" style="text-align:center;">Ujian Praktik</a>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  </div>
{:else}
  <!-- ====== LOGIN VIEWS ====== -->
  <div id="app-container">
    <div class="view-container active">
      <div class="glow-orb orb-1"></div>
      <div class="glow-orb orb-2"></div>

      {#if view === 'login'}
        <div class="login-card glass-panel">
          <div class="logo-container">
            <img src="/logoLab.png" alt="Lab-AP Logo" class="brand-logo-large" />
            <h1>Lab-AP</h1>
          </div>
          <h2>Selamat Datang</h2>
          <p class="subtitle">Silakan masukkan NIM Anda untuk masuk.</p>

          <form onsubmit={handleNimSubmit}>
            <div class="input-group">
              <label for="nim-input">NIM Mahasiswa</label>
              <input
                id="nim-input"
                type="text"
                placeholder="Masukkan NIM"
                autocomplete="off"
                required
                bind:value={nimInput}
              />
            </div>
            <button type="submit" class="primary-btn" disabled={loading}>
              <span class="btn-text" class:loader-hidden={loading}>Lanjut</span>
              <div class="spinner" class:loader-hidden={!loading}></div>
            </button>
          </form>
        </div>
      {:else if view === 'set-password'}
        <div class="login-card glass-panel">
          <div class="logo-container">
            <img src="/logoLab.png" alt="Lab-AP Logo" class="brand-logo-large" />
            <h1>Lab-AP</h1>
          </div>
          <h2>Buat Password</h2>
          <p class="subtitle">Akun Anda belum memiliki password. Silakan buat password baru.</p>

          <form onsubmit={handleSetPassword}>
            <div class="input-group">
              <label for="new-password">Password Baru</label>
              <input
                id="new-password"
                type="password"
                placeholder="Masukkan password"
                required
                bind:value={passwordInput}
              />
            </div>
            <div class="input-group">
              <label for="confirm-password">Konfirmasi Password</label>
              <input
                id="confirm-password"
                type="password"
                placeholder="Ulangi password"
                required
                bind:value={passwordConfirm}
              />
            </div>
            <button type="submit" class="primary-btn" disabled={loading}>
              <span class="btn-text" class:loader-hidden={loading}>Simpan & Masuk</span>
              <div class="spinner" class:loader-hidden={!loading}></div>
            </button>
            <button type="button" class="secondary-btn mt-4 w-100" onclick={resetFlow}>
              Kembali
            </button>
          </form>
        </div>
      {:else}
        <div class="login-card glass-panel">
          <div class="logo-container">
            <img src="/logoLab.png" alt="Lab-AP Logo" class="brand-logo-large" />
            <h1>Lab-AP</h1>
          </div>
          <h2>Masukkan Password</h2>
          <p class="subtitle">
            NIM ditemukan{fetchedMahasiswa ? ` — ${fetchedMahasiswa.nama}` : ''}. Masukkan password Anda.
          </p>

          <form onsubmit={handleLogin}>
            <div class="input-group">
              <label for="login-password">Password</label>
              <input
                id="login-password"
                type="password"
                placeholder="Masukkan Password"
                required
                bind:value={passwordInput}
              />
            </div>
            <button type="submit" class="primary-btn" disabled={loading}>
              <span class="btn-text" class:loader-hidden={loading}>Masuk Portal</span>
              <div class="spinner" class:loader-hidden={!loading}></div>
            </button>
            <button type="button" class="secondary-btn mt-4 w-100" onclick={resetFlow}>
              Ganti NIM
            </button>
          </form>
        </div>
      {/if}
    </div>
  </div>
{/if}
