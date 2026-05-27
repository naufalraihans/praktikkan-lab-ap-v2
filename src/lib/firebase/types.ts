/**
 * Schema TypeScript untuk koleksi V2 (post-migration).
 * Ini single source of truth — sinkron dengan scripts/migrate/types.ts (NEW section).
 *
 * Catatan: Timestamp di sini pakai tipe Firebase client SDK (bukan admin SDK).
 */
import type { Timestamp } from 'firebase/firestore';

// =============================================================================
// ENUMS
// =============================================================================

export type ModulId = 'm1' | 'm2' | 'm3' | 'm45' | 'm6' | 'uprak';
export type Role = 'mhs' | 'admin';
export type Bahasa = 'c' | 'python' | 'free';
export type QuizType = 'pretest' | 'posttest' | 'keterampilan' | 'ujian_praktik';
export type SesiKategori = 'reguler' | 'ujian_praktik';
export type QuestionLevel = 'easy' | 'medium' | 'hard';

// =============================================================================
// COLLECTIONS
// =============================================================================

export interface Mahasiswa {
  nim: string;
  nama: string;
  kelas: string;
  role: Role;
  is_registered: boolean;
  registered_at: Timestamp | null;
}

export interface Question {
  nomor: number;
  level: QuestionLevel;
  soal: string;
  jawaban_referensi: string;
  // hard variant:
  opsi?: number | string;
  deskripsi?: string;
  instruksi?: { soal: string; poin: number }[];
}

export interface KeterampilanItem {
  referensi: string;
  kunci_jawaban: string;
  poin: number;
}

export interface SoalBase {
  modul_id: ModulId;
  type: QuizType;
}

export interface SoalQuiz extends SoalBase {
  type: 'pretest' | 'posttest';
  questions: Question[];
}

export interface SoalKeterampilan extends SoalBase {
  type: 'keterampilan';
  judul_program: string;
  items: KeterampilanItem[];
}

export interface SoalUjianPraktik extends SoalBase {
  type: 'ujian_praktik';
  opsi: number | string;
  bahasa: Bahasa;
  deskripsi: string;
  jawaban_referensi?: string;
  poin?: number;
  gambar?: string;
  instruksi?: { soal: string; poin: number }[];
  legacy_origin?: string;
  legacy_id?: string;
}

export type Soal = SoalQuiz | SoalKeterampilan | SoalUjianPraktik;

export interface SesiReguler {
  kategori: 'reguler';
  modul_id: ModulId;
  tanggal: string;
  created_at: Timestamp;
  created_by: string;
  akses: { pretest: boolean; posttest: boolean; keterampilan: boolean };
  soal_refs: {
    pretest: string;
    posttest: string;
    keterampilan: string;
    pretest_question_ids: number[];
    posttest_question_ids: number[];
  };
  snapshot: {
    pretest_questions: Question[];
    posttest_questions: Question[];
    keterampilan_items: KeterampilanItem[];
    keterampilan_judul_program: string;
  };
}

export interface SesiUjianPraktik {
  kategori: 'ujian_praktik';
  token: string;
  tanggal: string;
  created_at: Timestamp;
  created_by: string;
  akses: { ujian_praktik: boolean };
  soal_refs: string[];
  snapshot: { soal: SoalUjianPraktik[] };
}

export type Sesi = SesiReguler | SesiUjianPraktik;

export interface Jawaban {
  nim: string;
  modul_id: ModulId;
  type: QuizType;
  tanggal: string;
  submitted_at: Timestamp;
  nilai: number | null;
  grading_detail: unknown | null;
  snapshot: { nama: string; kelas: string };
  answers?: Record<string, unknown>;
  bahasa?: Bahasa;
  kode?: string;
}

export interface RubrikConfig {
  pretest: {
    easy: { benar: number; salah: number; kosong: number };
    medium: {
      benar_penjelasan: number;
      benar_singkat: number;
      salah_penjelasan: number;
      salah: number;
      kosong: number;
    };
    hard: {
      benar_penjelasan: number;
      benar_singkat: number;
      salah_penjelasan: number;
      salah: number;
      kosong: number;
    };
  };
  posttest: {
    easy: { benar: number; salah: number; kosong: number };
    medium: {
      benar_penjelasan: number;
      benar_singkat: number;
      salah_penjelasan: number;
      salah: number;
      kosong: number;
    };
  };
  sub_criteria: {
    keterampilan: { sesuai_petunjuk_max: number; bte_max: number; tw_min: number; tw_max: number };
    posttest_hard: { sesuai_petunjuk_max: number; bte_max: number; tw_min: number; tw_max: number };
    ujian_praktik: {
      sesuai_petunjuk_max: number;
      bte_max: number;
      tw_min: number;
      tw_max: number;
      max_raw: number;
    };
  };
}

export interface ActivityLog {
  actor: { role: Role; nim: string | null };
  action: string;
  message: string;
  details?: Record<string, unknown>;
  timestamp: Timestamp;
}
