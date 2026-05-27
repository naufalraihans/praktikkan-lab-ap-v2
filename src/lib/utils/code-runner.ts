/**
 * Call Go backend /api/run-code untuk eksekusi code dengan auth bearer.
 * Backend lama tetap dipakai (lihat api/run-code.go di root project).
 */
import { auth } from '$lib/firebase/client';

export type Lang = 'c' | 'python';

export interface RunCodeResult {
  output: string;
  error: string;
  exitCode: number;
  success: boolean;
}

export async function runCode(code: string, lang: Lang, stdin = ''): Promise<RunCodeResult> {
  if (!code.trim()) {
    return {
      output: '',
      error: 'Kode kosong. Tulis kode terlebih dahulu.',
      exitCode: 1,
      success: false
    };
  }

  try {
    const user = auth.currentUser;
    if (!user) {
      return { output: '', error: 'Tidak login', exitCode: 1, success: false };
    }
    const idToken = await user.getIdToken();

    const response = await fetch('/api/run-code', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify({ code, lang, stdin })
    });

    if (!response.ok) {
      const errData = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(errData.error ?? `Server error: ${response.status}`);
    }

    return (await response.json()) as RunCodeResult;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      output: '',
      error: `Gagal menjalankan kode: ${message}`,
      exitCode: 1,
      success: false
    };
  }
}

/**
 * Tentukan bahasa default dari modul.
 * m1, m2, m3 → C
 * m45, m6   → Python
 */
import type { ModulId } from '$lib/firebase/types';

export function detectLang(modulId: ModulId): Lang {
  if (modulId === 'm1' || modulId === 'm2' || modulId === 'm3') return 'c';
  return 'python';
}
