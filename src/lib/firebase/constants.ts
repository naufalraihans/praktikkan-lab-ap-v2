import type { ModulId } from './types';

export const MODUL_INFO: Record<ModulId, { display_name: string; order: number }> = {
  m1: { display_name: 'Modul 1', order: 1 },
  m2: { display_name: 'Modul 2', order: 2 },
  m3: { display_name: 'Modul 3', order: 3 },
  m45: { display_name: 'Modul 4 & 5', order: 4 },
  m6: { display_name: 'Modul 6', order: 5 },
  uprak: { display_name: 'Ujian Praktik', order: 6 }
};

export const MODUL_IDS: ModulId[] = ['m1', 'm2', 'm3', 'm45', 'm6', 'uprak'];

export const COLLECTIONS = {
  mahasiswa: 'mahasiswa_v2',
  soal: 'soal_v2',
  sesi: 'sesi_v2',
  jawaban: 'jawaban_v2',
  rubrik: 'rubrik_v2',
  activity_logs: 'activity_logs_v2'
} as const;

import type { RubrikConfig } from './types';

/**
 * Default rubrik penilaian — fallback kalau Firestore belum punya config.
 * Port dari grading.js DEFAULT_RUBRIK tapi pakai key snake_case (v2 schema).
 */
export const DEFAULT_RUBRIK: RubrikConfig = {
  pretest: {
    easy: { benar: 20, salah: 8, kosong: 0 },
    medium: {
      benar_penjelasan: 15,
      benar_singkat: 10,
      salah_penjelasan: 7,
      salah: 3,
      kosong: 0
    },
    hard: {
      benar_penjelasan: 25,
      benar_singkat: 15,
      salah_penjelasan: 10,
      salah: 5,
      kosong: 0
    }
  },
  posttest: {
    easy: { benar: 20, salah: 8, kosong: 0 },
    medium: {
      benar_penjelasan: 35,
      benar_singkat: 20,
      salah_penjelasan: 15,
      salah: 10,
      kosong: 0
    }
  },
  sub_criteria: {
    keterampilan: { sesuai_petunjuk_max: 35, bte_max: 30, tw_min: 3, tw_max: 20 },
    posttest_hard: { sesuai_petunjuk_max: 25, bte_max: 30, tw_min: 3, tw_max: 13 },
    ujian_praktik: { sesuai_petunjuk_max: 25, bte_max: 30, tw_min: 3, tw_max: 13, max_raw: 408 }
  }
};
