<script lang="ts">
  import {
    collection,
    getDocs,
    query,
    orderBy,
    limit,
    startAfter,
    type DocumentSnapshot,
    type DocumentData,
    Timestamp
  } from 'firebase/firestore';
  import { db } from '$lib/firebase/client';
  import { COLLECTIONS } from '$lib/firebase/constants';
  import { toast } from '$lib/stores/toast.svelte';
  import AdminLayout from '$lib/components/AdminLayout.svelte';
  import type { ActivityLog } from '$lib/firebase/types';

  const CHUNK_SIZE = 100;
  const ITEMS_PER_PAGE = 20;

  type LogRow = ActivityLog & { id: string };

  let allLogs = $state<LogRow[]>([]);
  let filterRole = $state<'ALL' | 'mhs' | 'admin'>('ALL');
  let searchInput = $state('');
  let currentPage = $state(1);
  let loading = $state(true);
  let loadingMore = $state(false);
  let lastVisibleDoc: DocumentSnapshot<DocumentData> | null = null;
  let hasMore = $state(false);

  $effect(() => {
    fetchLogs();
  });

  async function fetchLogs() {
    loading = true;
    try {
      const q = query(
        collection(db, COLLECTIONS.activity_logs),
        orderBy('timestamp', 'desc'),
        limit(CHUNK_SIZE)
      );
      const snap = await getDocs(q);
      allLogs = snap.docs.map((d) => ({ id: d.id, ...(d.data() as ActivityLog) }));
      lastVisibleDoc = snap.docs[snap.docs.length - 1] ?? null;
      hasMore = allLogs.length === CHUNK_SIZE;
      currentPage = 1;
    } catch (err) {
      console.error('Error fetching logs:', err);
      toast.show('Gagal memuat log aktivitas', 'error');
    } finally {
      loading = false;
    }
  }

  async function loadMore() {
    if (!lastVisibleDoc) return;
    loadingMore = true;
    try {
      const q = query(
        collection(db, COLLECTIONS.activity_logs),
        orderBy('timestamp', 'desc'),
        startAfter(lastVisibleDoc),
        limit(CHUNK_SIZE)
      );
      const snap = await getDocs(q);
      const newLogs = snap.docs.map((d) => ({ id: d.id, ...(d.data() as ActivityLog) }));
      if (newLogs.length > 0) {
        allLogs = [...allLogs, ...newLogs];
        lastVisibleDoc = snap.docs[snap.docs.length - 1] ?? null;
        toast.show(`Memuat ${newLogs.length} data tambahan`, 'success');
      }
      hasMore = newLogs.length === CHUNK_SIZE;
      if (newLogs.length === 0) toast.show('Semua data telah dimuat', 'success');
    } catch (err) {
      console.error('Error loading more:', err);
      toast.show('Gagal memuat data lama', 'error');
    } finally {
      loadingMore = false;
    }
  }

  function displayRole(actor: ActivityLog['actor']): string {
    if (actor.role === 'admin') return 'ADMIN';
    if (actor.role === 'mhs') return actor.nim ? `STUDENT (${actor.nim})` : 'STUDENT';
    return String(actor.role).toUpperCase();
  }

  function formatTimestamp(ts: Timestamp | { seconds: number; nanoseconds: number } | string): {
    date: string;
    time: string;
  } {
    let d: Date;
    if (ts instanceof Timestamp) d = ts.toDate();
    else if (typeof ts === 'object' && ts && 'seconds' in ts) d = new Date(ts.seconds * 1000);
    else d = new Date(ts);
    return {
      date: d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }),
      time: d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    };
  }

  // === FILTER + PAGINATION (reactive via $derived) ===
  const filtered = $derived.by(() => {
    const search = searchInput.toLowerCase().trim();
    return allLogs.filter((log) => {
      if (filterRole !== 'ALL' && log.actor.role !== filterRole) return false;
      if (search) {
        const text = `${displayRole(log.actor)} ${log.message}`.toLowerCase();
        if (!text.includes(search)) return false;
      }
      return true;
    });
  });

  const totalPages = $derived(Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE)));
  const safePage = $derived(Math.min(Math.max(1, currentPage), totalPages));

  const paginated = $derived(
    filtered.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE)
  );

  // Reset page kalau filter berubah
  $effect(() => {
    filterRole;
    searchInput;
    currentPage = 1;
  });
</script>

<AdminLayout title="System Logs">
  <section class="admin-section animate-fade-in">
    <div class="section-header">
      <h2>📜 System Logs (Aktivitas)</h2>
      <div style="display:flex; gap:0.5rem;">
        {#if hasMore}
          <button class="secondary-btn" disabled={loadingMore} onclick={loadMore}>
            <span class="btn-text" class:loader-hidden={loadingMore}
              >Muat {CHUNK_SIZE} Log Lama</span
            >
            <div
              class="spinner"
              style="width:16px;height:16px;border-width:2px;"
              class:loader-hidden={!loadingMore}
            ></div>
          </button>
        {/if}
        <button class="secondary-btn" disabled={loading} onclick={fetchLogs}>Refresh</button>
      </div>
    </div>

    <div class="card glass-panel" style="margin-bottom:1.5rem;">
      <div class="card-body">
        <div style="display:flex; gap:1rem; align-items:center; flex-wrap:wrap;">
          <label for="filter-role" style="color:var(--text-muted);">Filter Role:</label>
          <select
            id="filter-role"
            class="select-input select-small"
            style="width:auto;"
            bind:value={filterRole}
          >
            <option value="ALL">Semua</option>
            <option value="admin">Admin Saja</option>
            <option value="mhs">Mahasiswa Saja</option>
          </select>
          <label for="search-log" style="color:var(--text-muted); margin-left:1rem;">Cari:</label>
          <input
            id="search-log"
            type="text"
            class="text-input"
            placeholder="Cari pesan atau NIM..."
            style="max-width:300px; padding:0.5rem;"
            bind:value={searchInput}
          />
        </div>
      </div>
    </div>

    {#if loading}
      <div style="text-align:center; padding:3rem;">
        <div class="spinner" style="width:40px;height:40px;border-width:3px; margin:0 auto;"></div>
        <p class="text-muted mt-4">Memuat log aktivitas...</p>
      </div>
    {:else if filtered.length === 0}
      <div class="card glass-panel" style="text-align:center; padding:4rem 2rem;">
        <div style="font-size:3rem; margin-bottom:1rem; opacity:0.5;">📂</div>
        <h3 style="margin-bottom:0.5rem;">Belum ada log</h3>
        <p class="text-muted">Tidak ada aktivitas yang tercatat saat ini.</p>
      </div>
    {:else}
      <div class="card glass-panel">
        <div style="overflow-x:auto;">
          <table class="rekap-table" style="width:100%;">
            <thead>
              <tr>
                <th style="width:20%;">Waktu</th>
                <th style="width:20%;">Role</th>
                <th style="width:60%;">Aktivitas</th>
              </tr>
            </thead>
            <tbody>
              {#each paginated as log (log.id)}
                {@const t = formatTimestamp(log.timestamp)}
                {@const isAdmin = log.actor.role === 'admin'}
                <tr style="transition: background 0.2s ease;">
                  <td>
                    <div>{t.date}</div>
                    <div style="color:var(--text-muted); font-size:0.85rem;">{t.time}</div>
                  </td>
                  <td>
                    <span
                      style="font-weight:600; color:{isAdmin ? '#f59e0b' : '#10b981'};"
                    >
                      {displayRole(log.actor)}
                    </span>
                  </td>
                  <td>{log.message}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>

        <div
          style="display:flex; justify-content:space-between; align-items:center; padding:1rem 1.5rem; border-top:1px solid rgba(255,255,255,0.1);"
        >
          <button
            class="secondary-btn"
            style="padding:0.4rem 1rem;"
            disabled={safePage === 1}
            onclick={() => currentPage--}
          >
            ← Prev
          </button>
          <span style="color:var(--text-muted); font-size:0.9rem;">
            Halaman {safePage} dari {totalPages}
          </span>
          <button
            class="secondary-btn"
            style="padding:0.4rem 1rem;"
            disabled={safePage === totalPages}
            onclick={() => currentPage++}
          >
            Next →
          </button>
        </div>
      </div>
    {/if}
  </section>
</AdminLayout>
