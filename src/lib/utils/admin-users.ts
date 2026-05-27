/**
 * Wrapper untuk admin user management API (Firebase Auth operations).
 * Endpoint: /api/admin/users-v2
 *
 * NOTE: di dev mode tanpa Vercel CLI / Go server, endpoint ini 404.
 * Operasi yang tetap bisa dari client SDK (create, update, list) ada di page.
 */
import { auth } from '$lib/firebase/client';

type Action = 'deleteUser' | 'resetPassword';

async function callApi(action: Action, nim: string, data?: Record<string, unknown>) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');
  const idToken = await user.getIdToken();

  const res = await fetch('/api/admin/users-v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`
    },
    body: JSON.stringify({ action, nim, data })
  });

  const json = (await res.json().catch(() => ({}))) as { error?: string; success?: boolean };
  if (!res.ok) {
    throw new Error(json.error ?? `API error: ${res.status}`);
  }
  return json;
}

export async function deleteUser(nim: string): Promise<void> {
  await callApi('deleteUser', nim);
}

export async function resetUserPassword(nim: string, newPassword: string): Promise<void> {
  if (!newPassword || newPassword.length < 6) {
    throw new Error('Password minimal 6 karakter');
  }
  await callApi('resetPassword', nim, { newPassword });
}
