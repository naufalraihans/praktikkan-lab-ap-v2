/**
 * Auth state global pakai Svelte 5 runes.
 * Pattern: class dengan $state field → reactive otomatis di komponen yang import.
 *
 * Usage di komponen:
 *   import { authState } from '$lib/stores/auth.svelte';
 *   authState.user      // Firebase User | null
 *   authState.mahasiswa // Mahasiswa dari Firestore | null
 *   authState.ready     // sudah resolve dari onAuthStateChanged?
 */
import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db, nimFromEmail } from '$lib/firebase/client';
import { COLLECTIONS } from '$lib/firebase/constants';
import type { Mahasiswa } from '$lib/firebase/types';

class AuthState {
  user = $state<User | null>(null);
  mahasiswa = $state<Mahasiswa | null>(null);
  ready = $state(false);

  init() {
    if (typeof window === 'undefined') return;
    onAuthStateChanged(auth, async (user) => {
      this.user = user;
      if (user?.email) {
        const nim = nimFromEmail(user.email);
        const snap = await getDoc(doc(db, COLLECTIONS.mahasiswa, nim));
        this.mahasiswa = snap.exists() ? (snap.data() as Mahasiswa) : null;
      } else {
        this.mahasiswa = null;
      }
      this.ready = true;
    });
  }

  get isLoggedIn() {
    return this.user !== null && this.mahasiswa !== null;
  }

  get isAdmin() {
    return this.mahasiswa?.role === 'admin';
  }
}

export const authState = new AuthState();
