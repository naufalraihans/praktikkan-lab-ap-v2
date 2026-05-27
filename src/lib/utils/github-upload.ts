/**
 * Upload image to GitHub repo via Contents API.
 * Memerlukan Personal Access Token (PAT) yang disimpan di localStorage.
 */

const GITHUB_OWNER = 'naufalraihans';
const GITHUB_REPO = 'praktikkan-lab-ap';
const PAT_KEY = 'github_pat';

export function getGithubPat(): string {
  return typeof window !== 'undefined' ? localStorage.getItem(PAT_KEY) ?? '' : '';
}

export function setGithubPat(pat: string): void {
  if (typeof window !== 'undefined') localStorage.setItem(PAT_KEY, pat.trim());
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1] ?? '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function uploadImageToGithub(file: File, path: string): Promise<string> {
  const pat = getGithubPat();
  if (!pat) throw new Error('GitHub PAT belum disimpan');

  const base64 = await fileToBase64(file);

  // Check if file exists (to get sha for update)
  let sha: string | undefined;
  try {
    const check = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`,
      { headers: { Authorization: `token ${pat}` } }
    );
    if (check.ok) {
      const data = (await check.json()) as { sha?: string };
      sha = data.sha;
    }
  } catch {
    // file doesn't exist, OK
  }

  const body: { message: string; content: string; sha?: string } = {
    message: `Upload ${path.split('/').pop()} via manage-soal`,
    content: base64
  };
  if (sha) body.sha = sha;

  const resp = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `token ${pat}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }
  );

  if (!resp.ok) {
    const err = (await resp.json().catch(() => ({}))) as { message?: string };
    throw new Error(`GitHub upload failed: ${err.message ?? resp.status}`);
  }

  return path;
}
