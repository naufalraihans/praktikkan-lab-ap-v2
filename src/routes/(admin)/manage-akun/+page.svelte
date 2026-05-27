<script lang="ts">
  import { collection, doc, getDocs, setDoc, updateDoc, Timestamp } from 'firebase/firestore';
  import { db } from '$lib/firebase/client';
  import { COLLECTIONS } from '$lib/firebase/constants';
  import { authState } from '$lib/stores/auth.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { logActivity } from '$lib/utils/activity-log';
  import { deleteUser, resetUserPassword } from '$lib/utils/admin-users';
  import AdminLayout from '$lib/components/AdminLayout.svelte';
  import type { Mahasiswa } from '$lib/firebase/types';

  let allUsers = $state<Mahasiswa[]>([]);
  let loading = $state(true);
  let searchInput = $state('');
  let filterKelas = $state('all');
  let selectedNims = $state(new Set<string>());

  // Add/Edit modal
  let modalOpen = $state(false);
  let editingNim = $state<string | null>(null);
  let formNim = $state('');
  let formNama = $state('');
  let formKelas = $state('');
  let saving = $state(false);

  // Reset password modal
  let resetModalOpen = $state(false);
  let resetTargetNim = $state<string | null>(null);
  let resetTargetName = $state('');
  let resetPassword = $state('');
  let resetting = $state(false);

  // CSV import modal
  let csvModalOpen = $state(false);
  let csvRows = $state<{ nim: string; nama: string; kelas: string; isDuplicate: boolean }[]>([]);
  let csvImporting = $state(false);
  let csvProgress = $state({ current: 0, total: 0, current_name: '' });

  let bulkDeleting = $state(false);

  $effect(() => {
    if (authState.isAdmin) {
      loadUsers();
    }
  });

  async function loadUsers() {
    loading = true;
    try {
      const snap = await getDocs(collection(db, COLLECTIONS.mahasiswa));
      const list: Mahasiswa[] = [];
      snap.forEach((d) => list.push(d.data() as Mahasiswa));
      list.sort((a, b) => (a.nama || '').localeCompare(b.nama || ''));
      allUsers = list;
    } catch (err) {
      console.error('Error loading users:', err);
      toast.show('Gagal memuat data akun', 'error');
    } finally {
      loading = false;
    }
  }

  const kelasList = $derived(
    Array.from(new Set(allUsers.map((u) => u.kelas).filter(Boolean))).sort()
  );

  const filtered = $derived.by(() => {
    const search = searchInput.trim().toLowerCase();
    return allUsers
      .filter((u) => u.role !== 'admin')
      .filter((u) => filterKelas === 'all' || u.kelas === filterKelas)
      .filter((u) => {
        if (!search) return true;
        return (
          u.nama.toLowerCase().includes(search) ||
          u.nim.toLowerCase().includes(search)
        );
      });
  });

  const stats = $derived.by(() => {
    const total = filtered.length;
    const registered = filtered.filter((u) => u.is_registered).length;
    return { total, registered, unregistered: total - registered };
  });

  function openAddModal() {
    editingNim = null;
    formNim = '';
    formNama = '';
    formKelas = '';
    modalOpen = true;
  }

  function openEditModal(u: Mahasiswa) {
    editingNim = u.nim;
    formNim = u.nim;
    formNama = u.nama;
    formKelas = u.kelas;
    modalOpen = true;
  }

  function closeModal() {
    modalOpen = false;
    editingNim = null;
  }

  async function saveAkun() {
    const nim = formNim.trim();
    const nama = formNama.trim();
    const kelas = formKelas.trim();

    if (!nim || !nama) {
      toast.show('NIM dan Nama wajib diisi', 'error');
      return;
    }

    saving = true;
    try {
      if (editingNim) {
        // Edit
        await updateDoc(doc(db, COLLECTIONS.mahasiswa, editingNim), { nama, kelas });
        await logActivity({
          role: 'admin',
          nim: authState.mahasiswa?.nim ?? null,
          action: 'admin_write',
          message: `Updated mahasiswa ${editingNim}`
        });
        toast.show(`✅ Data ${nama} diperbarui`, 'success');
      } else {
        // Create
        if (allUsers.find((u) => u.nim === nim)) {
          toast.show(`NIM ${nim} sudah ada`, 'error');
          return;
        }
        await setDoc(doc(db, COLLECTIONS.mahasiswa, nim), {
          nim,
          nama,
          kelas,
          role: 'mhs',
          is_registered: false,
          registered_at: null
        });
        await logActivity({
          role: 'admin',
          nim: authState.mahasiswa?.nim ?? null,
          action: 'admin_write',
          message: `Created mahasiswa ${nim} (${nama})`
        });
        toast.show(`✅ Akun ${nama} dibuat`, 'success');
      }
      closeModal();
      await loadUsers();
    } catch (err) {
      console.error('Save error:', err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast.show(`Gagal menyimpan: ${message}`, 'error');
    } finally {
      saving = false;
    }
  }

  async function handleDelete(u: Mahasiswa) {
    const msg = `Hapus akun mahasiswa?\n\nNIM: ${u.nim}\nNama: ${u.nama}\n\nAuth + Firestore akan terhapus permanen!`;
    if (!confirm(msg)) return;
    try {
      await deleteUser(u.nim);
      allUsers = allUsers.filter((x) => x.nim !== u.nim);
      selectedNims.delete(u.nim);
      selectedNims = new Set(selectedNims);
      toast.show(`✅ ${u.nama} dihapus`, 'success');
    } catch (err) {
      console.error('Delete error:', err);
      const message = err instanceof Error ? err.message : 'Unknown';
      toast.show(`Gagal hapus: ${message}`, 'error');
    }
  }

  async function handleBulkDelete() {
    if (selectedNims.size === 0) return;
    const msg = `Hapus ${selectedNims.size} akun?\n\nTidak bisa di-undo!`;
    if (!confirm(msg)) return;

    bulkDeleting = true;
    let success = 0;
    let errors = 0;
    const nims = Array.from(selectedNims);
    for (const nim of nims) {
      try {
        await deleteUser(nim);
        allUsers = allUsers.filter((x) => x.nim !== nim);
        success++;
      } catch (err) {
        console.error(`Delete ${nim} error:`, err);
        errors++;
      }
    }
    selectedNims = new Set();
    bulkDeleting = false;
    toast.show(
      `${success} dihapus${errors > 0 ? `, ${errors} gagal` : ''}`,
      errors > 0 ? 'error' : 'success'
    );
  }

  function openResetModal(u: Mahasiswa) {
    resetTargetNim = u.nim;
    resetTargetName = u.nama;
    resetPassword = '';
    resetModalOpen = true;
  }

  async function confirmResetPassword() {
    if (!resetTargetNim) return;
    if (resetPassword.length < 6) {
      toast.show('Password minimal 6 karakter', 'error');
      return;
    }
    resetting = true;
    try {
      await resetUserPassword(resetTargetNim, resetPassword);
      toast.show(`✅ Password ${resetTargetNim} direset`, 'success');
      resetModalOpen = false;
      resetTargetNim = null;
    } catch (err) {
      console.error('Reset error:', err);
      const message = err instanceof Error ? err.message : 'Unknown';
      toast.show(`Gagal reset: ${message}`, 'error');
    } finally {
      resetting = false;
    }
  }

  function toggleSelectAll() {
    const visibleNims = filtered.map((u) => u.nim);
    const allSelected = visibleNims.every((n) => selectedNims.has(n));
    if (allSelected) {
      for (const n of visibleNims) selectedNims.delete(n);
    } else {
      for (const n of visibleNims) selectedNims.add(n);
    }
    selectedNims = new Set(selectedNims);
  }

  function toggleRow(nim: string) {
    if (selectedNims.has(nim)) selectedNims.delete(nim);
    else selectedNims.add(nim);
    selectedNims = new Set(selectedNims);
  }

  // === CSV ===
  function parseCsv(text: string) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return [];
    const existingNims = new Set(allUsers.map((u) => u.nim));
    const seen = new Set<string>();
    const rows: { nim: string; nama: string; kelas: string; isDuplicate: boolean }[] = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i]!.split(';').map((p) => p.trim());
      if (parts.length < 2) continue;
      const nim = parts[0]!;
      const nama = parts[1]!;
      const kelas = parts[2] ?? '';
      if (!nim || !nama) continue;
      const isDuplicate = existingNims.has(nim) || seen.has(nim);
      seen.add(nim);
      rows.push({ nim, nama, kelas, isDuplicate });
    }
    return rows;
  }

  function handleCsvFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = String(e.target?.result ?? '');
      csvRows = parseCsv(text);
      if (csvRows.length === 0) {
        toast.show('File CSV kosong atau format invalid', 'error');
      }
    };
    reader.readAsText(file);
  }

  function handleCsvInput(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file) handleCsvFile(file);
  }

  async function importCsv() {
    const validRows = csvRows.filter((r) => !r.isDuplicate);
    if (validRows.length === 0) return;
    csvImporting = true;
    csvProgress = { current: 0, total: validRows.length, current_name: '' };
    let success = 0;
    let errors = 0;
    for (const r of validRows) {
      csvProgress = { ...csvProgress, current: csvProgress.current + 1, current_name: r.nama };
      try {
        await setDoc(doc(db, COLLECTIONS.mahasiswa, r.nim), {
          nim: r.nim,
          nama: r.nama,
          kelas: r.kelas,
          role: 'mhs',
          is_registered: false,
          registered_at: null
        });
        success++;
      } catch (err) {
        console.error(`CSV create ${r.nim} error:`, err);
        errors++;
      }
    }
    if (success > 0) {
      await logActivity({
        role: 'admin',
        nim: authState.mahasiswa?.nim ?? null,
        action: 'admin_write',
        message: `Bulk import: ${success} akun ditambahkan via CSV`
      });
    }
    csvImporting = false;
    toast.show(
      `${success} ditambahkan${errors > 0 ? `, ${errors} gagal` : ''}`,
      errors > 0 ? 'error' : 'success'
    );
    csvModalOpen = false;
    csvRows = [];
    await loadUsers();
  }

  const allVisibleSelected = $derived(
    filtered.length > 0 && filtered.every((u) => selectedNims.has(u.nim))
  );
</script>

<AdminLayout title="Manage Akun">
  <section class="admin-section animate-fade-in">
    <div class="section-header">
      <h2>👥 Manage Akun Mahasiswa</h2>
      <div style="display:flex; gap:0.5rem;">
        <button class="secondary-btn" onclick={() => (csvModalOpen = true)}>📂 Import CSV</button>
        <button class="primary-btn" onclick={openAddModal}>+ Tambah Akun</button>
      </div>
    </div>

    <!-- Filter Bar -->
    <div class="dash-card" style="margin-bottom:1.5rem;">
      <div class="dash-card-body" style="display:flex; gap:1rem; flex-wrap:wrap; align-items:center;">
        <input
          type="text"
          class="text-input"
          placeholder="Cari NIM atau Nama..."
          bind:value={searchInput}
          style="flex:1; min-width:200px;"
        />
        <label for="filter-kelas" style="color:var(--text-muted);">Kelas:</label>
        <select
          id="filter-kelas"
          class="select-input select-small"
          bind:value={filterKelas}
        >
          <option value="all">Semua Kelas</option>
          {#each kelasList as k (k)}
            <option value={k}>{k}</option>
          {/each}
        </select>
        <button class="secondary-btn" onclick={loadUsers}>Refresh</button>
      </div>
    </div>

    <!-- Stats -->
    {#if !loading}
      <div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-bottom:1rem;">
        <span class="stat-chip">👤 Total: <strong>{stats.total}</strong></span>
        <span class="stat-chip">✅ Terdaftar: <strong>{stats.registered}</strong></span>
        <span class="stat-chip">⏳ Belum Daftar: <strong>{stats.unregistered}</strong></span>
      </div>
    {/if}

    <!-- Bulk action bar -->
    {#if selectedNims.size > 0}
      <div
        class="dash-card"
        style="margin-bottom:1rem; padding: 0.75rem 1rem; display:flex; align-items:center; gap:1rem;"
      >
        <span><strong>{selectedNims.size}</strong> dipilih</span>
        <button
          class="secondary-btn"
          style="margin-left:auto;"
          onclick={() => {
            selectedNims = new Set();
          }}>Batal</button
        >
        <button class="primary-btn" disabled={bulkDeleting} onclick={handleBulkDelete}>
          🗑️ Hapus Terpilih
        </button>
      </div>
    {/if}

    {#if loading}
      <div style="text-align:center; padding:3rem;">
        <div class="spinner" style="width:40px;height:40px;border-width:3px; margin:0 auto;"></div>
        <p class="text-muted mt-4">Memuat data akun...</p>
      </div>
    {:else if filtered.length === 0}
      <div class="dash-card" style="text-align:center; padding:4rem 2rem;">
        <div style="font-size:3rem; margin-bottom:1rem; opacity:0.5;">📂</div>
        <p class="text-muted">Tidak ada akun yang sesuai filter.</p>
      </div>
    {:else}
      <div class="dash-card">
        <div style="overflow-x:auto;">
          <table class="rekap-table" style="width:100%;">
            <thead>
              <tr>
                <th style="width:40px;">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onchange={toggleSelectAll}
                  />
                </th>
                <th style="width:40px;">No</th>
                <th>NIM</th>
                <th>Nama</th>
                <th>Kelas</th>
                <th>Status</th>
                <th style="width:120px;">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {#each filtered as u, i (u.nim)}
                <tr class:row-selected={selectedNims.has(u.nim)}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedNims.has(u.nim)}
                      onchange={() => toggleRow(u.nim)}
                    />
                  </td>
                  <td>{i + 1}</td>
                  <td>{u.nim}</td>
                  <td>{u.nama}</td>
                  <td>{u.kelas || '-'}</td>
                  <td>
                    {#if u.is_registered}
                      <span style="color:#10b981; font-weight:600;">✅ Terdaftar</span>
                    {:else}
                      <span style="color:var(--text-muted);">Belum Daftar</span>
                    {/if}
                  </td>
                  <td>
                    <button
                      class="btn-action"
                      onclick={() => openEditModal(u)}
                      title="Edit">✏️</button
                    >
                    <button
                      class="btn-action btn-action-warn"
                      onclick={() => openResetModal(u)}
                      title="Reset Password">🔑</button
                    >
                    <button
                      class="btn-action btn-action-danger"
                      onclick={() => handleDelete(u)}
                      title="Hapus">🗑️</button
                    >
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    {/if}
  </section>
</AdminLayout>

<!-- Modal: Add/Edit -->
{#if modalOpen}
  <div
    class="modal-overlay active"
    onclick={(e) => {
      if (e.target === e.currentTarget) closeModal();
    }}
    role="presentation"
  >
    <div class="modal-content card glass-panel" style="max-width:500px;">
      <div class="dash-card-header">
        <h3>{editingNim ? '✏️ Edit Mahasiswa' : '+ Tambah Akun'}</h3>
      </div>
      <div class="dash-card-body">
        <div class="input-group">
          <label for="f-nim">NIM</label>
          <input
            id="f-nim"
            type="text"
            class="text-input"
            bind:value={formNim}
            disabled={!!editingNim}
          />
        </div>
        <div class="input-group">
          <label for="f-nama">Nama</label>
          <input id="f-nama" type="text" class="text-input" bind:value={formNama} />
        </div>
        <div class="input-group">
          <label for="f-kelas">Kelas</label>
          <input id="f-kelas" type="text" class="text-input" bind:value={formKelas} />
        </div>
        <div style="display:flex; gap:0.5rem; justify-content:flex-end; margin-top:1rem;">
          <button class="secondary-btn" onclick={closeModal}>Batal</button>
          <button class="primary-btn" disabled={saving} onclick={saveAkun}>
            <span class="btn-text" class:loader-hidden={saving}
              >{editingNim ? 'Simpan' : 'Tambah'}</span
            >
            <div
              class="spinner"
              style="width:16px;height:16px;border-width:2px;"
              class:loader-hidden={!saving}
            ></div>
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<!-- Modal: Reset Password -->
{#if resetModalOpen}
  <div
    class="modal-overlay active"
    onclick={(e) => {
      if (e.target === e.currentTarget) {
        resetModalOpen = false;
        resetTargetNim = null;
      }
    }}
    role="presentation"
  >
    <div class="modal-content card glass-panel" style="max-width:500px;">
      <div class="dash-card-header">
        <h3>🔑 Reset Password</h3>
      </div>
      <div class="dash-card-body">
        <p class="text-muted">
          Reset password untuk <strong>{resetTargetName}</strong> ({resetTargetNim})
        </p>
        <div class="input-group">
          <label for="f-new-password">Password Baru (min 6 karakter)</label>
          <input
            id="f-new-password"
            type="password"
            class="text-input"
            bind:value={resetPassword}
          />
        </div>
        <div style="display:flex; gap:0.5rem; justify-content:flex-end;">
          <button
            class="secondary-btn"
            onclick={() => {
              resetModalOpen = false;
              resetTargetNim = null;
            }}>Batal</button
          >
          <button class="primary-btn" disabled={resetting} onclick={confirmResetPassword}>
            <span class="btn-text" class:loader-hidden={resetting}>Reset</span>
            <div
              class="spinner"
              style="width:16px;height:16px;border-width:2px;"
              class:loader-hidden={!resetting}
            ></div>
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<!-- Modal: CSV Import -->
{#if csvModalOpen}
  <div
    class="modal-overlay active"
    onclick={(e) => {
      if (e.target === e.currentTarget) {
        csvModalOpen = false;
        csvRows = [];
      }
    }}
    role="presentation"
  >
    <div class="modal-content card glass-panel" style="max-width:700px;">
      <div class="dash-card-header">
        <h3>📂 Import CSV</h3>
      </div>
      <div class="dash-card-body">
        {#if csvRows.length === 0}
          <p class="text-muted" style="margin-bottom:1rem;">
            Format CSV: <code>NIM;NAMA;KELAS</code> (semicolon-separated, baris 1 = header).
          </p>
          <input type="file" accept=".csv,text/csv" onchange={handleCsvInput} />
        {:else}
          {@const validCount = csvRows.filter((r) => !r.isDuplicate).length}
          {@const dupCount = csvRows.length - validCount}
          <p>
            <strong>{validCount}</strong> akun baru akan ditambahkan
            {#if dupCount > 0}
              · <span style="color:#ef4444;">{dupCount} dilewati (NIM sudah ada)</span>
            {/if}
          </p>
          {#if csvImporting}
            <div style="margin: 1rem 0;">
              <p>
                {csvProgress.current}/{csvProgress.total} — {csvProgress.current_name}
              </p>
              <div style="background:#1e1e1e; height:8px; border-radius:4px; overflow:hidden;">
                <div
                  style="background:var(--primary); height:100%; width:{(csvProgress.current /
                    csvProgress.total) *
                    100}%; transition: width 0.2s;"
                ></div>
              </div>
            </div>
          {:else}
            <div style="max-height:300px; overflow-y:auto;">
              <table class="rekap-table" style="width:100%;">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>NIM</th>
                    <th>Nama</th>
                    <th>Kelas</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {#each csvRows as r, i (r.nim + i)}
                    <tr style:opacity={r.isDuplicate ? '0.5' : '1'}>
                      <td>{i + 1}</td>
                      <td>{r.nim}</td>
                      <td>{r.nama}</td>
                      <td>{r.kelas}</td>
                      <td>
                        {#if r.isDuplicate}
                          <span style="color:#ef4444;">⚠️ Sudah ada</span>
                        {:else}
                          <span style="color:#10b981;">✅ Baru</span>
                        {/if}
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        {/if}
        <div style="display:flex; gap:0.5rem; justify-content:flex-end; margin-top:1rem;">
          <button
            class="secondary-btn"
            disabled={csvImporting}
            onclick={() => {
              csvModalOpen = false;
              csvRows = [];
            }}>Batal</button
          >
          {#if csvRows.length > 0}
            <button
              class="primary-btn"
              disabled={csvImporting || csvRows.filter((r) => !r.isDuplicate).length === 0}
              onclick={importCsv}
            >
              <span class="btn-text" class:loader-hidden={csvImporting}>Import</span>
              <div
                class="spinner"
                style="width:16px;height:16px;border-width:2px;"
                class:loader-hidden={!csvImporting}
              ></div>
            </button>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
  }
  .modal-content {
    width: 100%;
    max-height: 90vh;
    overflow-y: auto;
  }
  .row-selected {
    background: rgba(59, 130, 246, 0.1);
  }
</style>
