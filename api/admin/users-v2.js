/**
 * Endpoint admin user management untuk schema V2.
 * - deleteUser: delete dari Firebase Auth + Firestore mahasiswa_v2
 * - resetPassword: update Firebase Auth password
 *
 * Verifikasi admin via mahasiswa_v2/{nim}.role === 'admin'.
 */
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

function getAdminApp() {
  if (getApps().length > 0) return getApps()[0];

  const serviceAccountEnv = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccountEnv) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT environment variable is not set');
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(serviceAccountEnv);
  } catch (e) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON: ' + e.message);
  }

  return initializeApp({ credential: cert(serviceAccount) });
}

const ALLOWED_ACTIONS = ['deleteUser', 'resetPassword'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const app = getAdminApp();
    const adminAuth = getAuth(app);
    const db = getFirestore(app);

    const idToken = authHeader.split('Bearer ')[1];

    const decoded = await adminAuth.verifyIdToken(idToken);
    const adminNim = decoded.email.split('@')[0];

    // Verify admin via mahasiswa_v2
    const adminDoc = await db.collection('mahasiswa_v2').doc(adminNim).get();
    if (!adminDoc.exists || adminDoc.data().role !== 'admin') {
      return res.status(403).json({ error: 'Not an admin' });
    }

    const { action, nim, data } = req.body;

    if (!ALLOWED_ACTIONS.includes(action)) {
      return res.status(400).json({ error: `Action "${action}" not allowed` });
    }
    if (!nim) {
      return res.status(400).json({ error: 'Missing nim' });
    }

    const email = `${nim}@mhs.lab-ap.com`;

    if (action === 'deleteUser') {
      // Delete Firebase Auth user (best-effort, lanjut walau gagal)
      try {
        const userRecord = await adminAuth.getUserByEmail(email);
        await adminAuth.deleteUser(userRecord.uid);
      } catch (authErr) {
        if (authErr.code !== 'auth/user-not-found') {
          console.warn('Auth delete warning:', authErr.message);
        }
      }

      // Delete Firestore doc (mahasiswa_v2)
      await db.collection('mahasiswa_v2').doc(nim).delete();

      // Log activity
      await db.collection('activity_logs_v2').add({
        actor: { role: 'admin', nim: adminNim },
        action: 'admin_delete',
        message: `Deleted mahasiswa ${nim}`,
        timestamp: new Date()
      });

      return res.status(200).json({ success: true, action, nim });
    }

    if (action === 'resetPassword') {
      const { newPassword } = data || {};
      if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ error: 'Password minimal 6 karakter' });
      }

      try {
        const userRecord = await adminAuth.getUserByEmail(email);
        await adminAuth.updateUser(userRecord.uid, { password: newPassword });
      } catch (authErr) {
        if (authErr.code === 'auth/user-not-found') {
          return res.status(404).json({
            error: `Akun auth untuk NIM ${nim} tidak ditemukan. User mungkin belum pernah registrasi.`
          });
        }
        throw authErr;
      }

      await db.collection('activity_logs_v2').add({
        actor: { role: 'admin', nim: adminNim },
        action: 'admin_reset_password',
        message: `Reset password mahasiswa ${nim}`,
        timestamp: new Date()
      });

      return res.status(200).json({ success: true, action, nim });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (error) {
    console.error('Admin users-v2 error:', error.code || '', error.message);
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({ error: 'Token expired, please refresh the page.' });
    }
    if (error.code === 'auth/argument-error' || error.code === 'auth/invalid-id-token') {
      return res.status(401).json({ error: 'Invalid auth token.' });
    }
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
