<script lang="ts">
  import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
  import {
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword
  } from 'firebase/auth';
  import { auth, db, emailFromNim } from '$lib/firebase/client';
  import { COLLECTIONS, MODUL_INFO, MODUL_IDS } from '$lib/firebase/constants';
  import { authState } from '$lib/stores/auth.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import Navbar from '$lib/components/Navbar.svelte';
  import type { Mahasiswa } from '$lib/firebase/types';

  type View = 'login' | 'set-password' | 'enter-password';

  let view = $state<View>('login');
  let loading = $state(false);
  let nimInput = $state('');
  let passwordInput = $state('');
  let passwordConfirm = $state('');
  let fetchedMahasiswa = $state<Mahasiswa | null>(null);

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

<Navbar />

<main class="dashboard-content">
  {#if !authState.ready}
    <div class="quiz-state-container">
      <div class="spinner" style="width:40px;height:40px;border-width:3px;"></div>
      <p class="text-muted mt-4">Memuat...</p>
    </div>
  {:else if authState.isLoggedIn && authState.mahasiswa}
    <!-- HOME VIEW (logged in) -->
    <section class="animate-fade-in">
      <header class="quiz-header">
        <h1>Selamat datang, <span class="highlight">{authState.mahasiswa.nama}</span></h1>
        <p class="text-muted">
          {authState.mahasiswa.nim} • {authState.mahasiswa.kelas} •
          {authState.mahasiswa.role === 'admin' ? 'Administrator' : 'Mahasiswa'}
        </p>
      </header>

      <div class="card glass-panel" style="margin-top: 2rem;">
        <div class="card-header">
          <h3>📚 Modul Tersedia</h3>
        </div>
        <div class="card-body">
          <ul style="list-style: none; padding: 0; display: grid; gap: 0.5rem;">
            {#each MODUL_IDS as id}
              <li class="info-row">
                <span class="label">{MODUL_INFO[id].display_name}</span>
                <span class="value text-muted">{id}</span>
              </li>
            {/each}
          </ul>
        </div>
      </div>

      {#if authState.isAdmin}
        <div class="card glass-panel" style="margin-top: 1rem;">
          <div class="card-header">
            <h3>🛠 Admin Tools</h3>
          </div>
          <div class="card-body">
            <div
              style="display: grid; gap: 0.75rem; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));"
            >
              <a href="/logs" class="primary-btn" style="text-align: center;">System Logs</a>
              <a href="/rubrik" class="primary-btn" style="text-align: center;">Rubrik</a>
              <a href="/rekap-nilai" class="primary-btn" style="text-align: center;">Rekap Nilai</a>
              <a href="/admin" class="primary-btn" style="text-align: center;">Dashboard</a>
              <a href="/manage-akun" class="primary-btn" style="text-align: center;">Manage Akun</a>
              <a href="/input-jawaban" class="primary-btn" style="text-align: center;">Input Jawaban</a>
              <a href="/manage-soal" class="primary-btn" style="text-align: center;">Manage Soal</a>
              <a href="/rekap" class="primary-btn" style="text-align: center;">Rekap Jawaban</a>
            </div>
          </div>
        </div>
      {:else}
        <div class="card glass-panel" style="margin-top: 1rem;">
          <div class="card-header">
            <h3>📝 Aktivitas</h3>
          </div>
          <div class="card-body">
            <div
              style="display: grid; gap: 0.75rem; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));"
            >
              <a href="/pretest" class="primary-btn" style="text-align: center;">Pre-test</a>
              <a href="/posttest" class="primary-btn" style="text-align: center;">Post-test</a>
              <a href="/keterampilan" class="primary-btn" style="text-align: center;"
                >Keterampilan</a
              >
              <a href="/ujian" class="primary-btn" style="text-align: center;">Ujian Praktik</a>
            </div>
          </div>
        </div>
      {/if}

      <div class="card glass-panel" style="margin-top: 1rem;">
        <div class="card-header">
          <h3>🛠 Status</h3>
        </div>
        <div class="card-body">
          <p class="text-muted">
            SvelteKit v2 — masih in-progress. DB udah di-migrate ke <code>*_v2</code>. Page lain
            menyusul.
          </p>
        </div>
      </div>
    </section>
  {:else}
    <!-- LOGIN FLOW -->
    <div class="auth-container">
      {#if view === 'login'}
        <div class="card glass-panel" style="max-width: 420px; margin: 4rem auto; padding: 2rem;">
          <h2>Masuk</h2>
          <p class="text-muted mt-4">Masukkan NIM untuk melanjutkan</p>
          <form onsubmit={handleNimSubmit} style="margin-top: 1.5rem;">
            <input
              type="text"
              class="text-input"
              placeholder="NIM"
              bind:value={nimInput}
              disabled={loading}
              required
              style="width: 100%; margin-bottom: 1rem;"
            />
            <button type="submit" class="primary-btn" disabled={loading} style="width: 100%;">
              {loading ? 'Memeriksa...' : 'Lanjut'}
            </button>
          </form>
        </div>
      {:else if view === 'set-password'}
        <div class="card glass-panel" style="max-width: 420px; margin: 4rem auto; padding: 2rem;">
          <h2>Buat Password</h2>
          <p class="text-muted mt-4">
            NIM {nimInput} terdaftar. Buat password baru.
          </p>
          <form onsubmit={handleSetPassword} style="margin-top: 1.5rem;">
            <input
              type="password"
              class="text-input"
              placeholder="Password baru (min 6 karakter)"
              bind:value={passwordInput}
              disabled={loading}
              required
              style="width: 100%; margin-bottom: 1rem;"
            />
            <input
              type="password"
              class="text-input"
              placeholder="Konfirmasi password"
              bind:value={passwordConfirm}
              disabled={loading}
              required
              style="width: 100%; margin-bottom: 1rem;"
            />
            <button type="submit" class="primary-btn" disabled={loading} style="width: 100%;">
              {loading ? 'Memproses...' : 'Daftar & Masuk'}
            </button>
            <button
              type="button"
              class="secondary-btn"
              onclick={resetFlow}
              style="width: 100%; margin-top: 0.5rem;"
            >
              Kembali
            </button>
          </form>
        </div>
      {:else}
        <div class="card glass-panel" style="max-width: 420px; margin: 4rem auto; padding: 2rem;">
          <h2>Masukkan Password</h2>
          <p class="text-muted mt-4">
            {fetchedMahasiswa?.nama} — {nimInput}
          </p>
          <form onsubmit={handleLogin} style="margin-top: 1.5rem;">
            <input
              type="password"
              class="text-input"
              placeholder="Password"
              bind:value={passwordInput}
              disabled={loading}
              required
              style="width: 100%; margin-bottom: 1rem;"
            />
            <button type="submit" class="primary-btn" disabled={loading} style="width: 100%;">
              {loading ? 'Memproses...' : 'Masuk'}
            </button>
            <button
              type="button"
              class="secondary-btn"
              onclick={resetFlow}
              style="width: 100%; margin-top: 0.5rem;"
            >
              Ganti NIM
            </button>
          </form>
        </div>
      {/if}
    </div>
  {/if}
</main>
