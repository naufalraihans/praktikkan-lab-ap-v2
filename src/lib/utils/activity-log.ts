/**
 * Helper untuk write entry ke activity_logs collection.
 * Schema sesuai NewActivityLog di types.ts.
 */
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '$lib/firebase/client';
import { COLLECTIONS } from '$lib/firebase/constants';
import type { Role } from '$lib/firebase/types';

export interface LogActivityParams {
  role: Role;
  nim: string | null;
  action: string;
  message: string;
  details?: Record<string, unknown>;
}

export async function logActivity(params: LogActivityParams): Promise<void> {
  await addDoc(collection(db, COLLECTIONS.activity_logs), {
    actor: { role: params.role, nim: params.nim },
    action: params.action,
    message: params.message,
    ...(params.details ? { details: params.details } : {}),
    timestamp: serverTimestamp()
  });
}
