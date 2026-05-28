/**
 * LocalStorage autosave helpers untuk student quiz pages.
 * Key format: `quiz_autosave_${nim}_${modul_id}_${type}`
 * Data di-namespace per type (pretest/posttest/keterampilan/ujian_praktik).
 */

interface AutosaveData<T = unknown> {
  saved_at: string;
  modul_id: string;
  type: string;
  data: T;
}

function key(nim: string, modul_id: string, type: string): string {
  return `quiz_autosave_${nim}_${modul_id}_${type}`;
}

export function saveAutosave<T>(nim: string, modul_id: string, type: string, data: T): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: AutosaveData<T> = {
      saved_at: new Date().toISOString(),
      modul_id,
      type,
      data
    };
    localStorage.setItem(key(nim, modul_id, type), JSON.stringify(payload));
  } catch (e) {
    console.warn('Autosave failed:', e);
  }
}

export function loadAutosave<T>(nim: string, modul_id: string, type: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key(nim, modul_id, type));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AutosaveData<T>;
    if (parsed.modul_id !== modul_id || parsed.type !== type) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export function clearAutosave(nim: string, modul_id: string, type: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(key(nim, modul_id, type));
  } catch {
    // ignore
  }
}

/**
 * Debounce factory — useful untuk autosave on Monaco onDidChangeModelContent
 * agar tidak save tiap keystroke.
 */
export function makeDebounce<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  delay = 500
): (...args: TArgs) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: TArgs) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
