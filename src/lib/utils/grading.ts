/**
 * AI grading via Ollama (proxy through /api/grade Go endpoint).
 * Port dari js/grading.js ke v2 schema dengan TypeScript.
 */
import { doc, getDoc } from 'firebase/firestore';
import { db, auth } from '$lib/firebase/client';
import { COLLECTIONS, DEFAULT_RUBRIK } from '$lib/firebase/constants';
import type { RubrikConfig, KeterampilanItem, Jawaban } from '$lib/firebase/types';

let rubrikCache: RubrikConfig | null = null;

export function clearRubrikCache() {
  rubrikCache = null;
}

async function loadRubrik(): Promise<RubrikConfig> {
  if (rubrikCache) return rubrikCache;
  try {
    const snap = await getDoc(doc(db, COLLECTIONS.rubrik, 'config'));
    if (snap.exists()) {
      // Deep merge with defaults
      const data = snap.data() as Partial<RubrikConfig>;
      rubrikCache = {
        pretest: { ...DEFAULT_RUBRIK.pretest, ...(data.pretest ?? {}) },
        posttest: { ...DEFAULT_RUBRIK.posttest, ...(data.posttest ?? {}) },
        sub_criteria: { ...DEFAULT_RUBRIK.sub_criteria, ...(data.sub_criteria ?? {}) }
      };
    } else {
      rubrikCache = structuredClone(DEFAULT_RUBRIK);
    }
  } catch {
    rubrikCache = structuredClone(DEFAULT_RUBRIK);
  }
  return rubrikCache;
}

interface SubCrit {
  sesuai_petunjuk_max: number;
  bte_max: number;
  tw_min: number;
  tw_max: number;
  max_raw?: number;
}

function sanitizeSubCriteria(sp: number, bte: number, tw: number, sc: SubCrit, hasCode: boolean) {
  let fixedSp = sp;
  let fixedBte = bte;
  if (hasCode && tw > sc.tw_min) {
    if (fixedSp === 0) {
      const twRatio = (tw - sc.tw_min) / (sc.tw_max - sc.tw_min);
      fixedSp = Math.max(1, Math.round(sc.sesuai_petunjuk_max * twRatio * 0.5));
    }
    if (fixedBte === 0 && fixedSp > 0) {
      fixedBte = Math.max(1, Math.round(sc.bte_max * 0.15));
    }
  }
  return { sp: fixedSp, bte: fixedBte, tw };
}

async function callOllama(prompt: string): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');
  const idToken = await user.getIdToken();

  const response = await fetch('/api/grade', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ prompt })
  });
  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `API error ${response.status}`);
  }
  const data = (await response.json()) as { message?: { content?: string } };
  return data.message?.content ?? '';
}

function extractJSON(text: string): unknown {
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) ?? text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    const jsonStr = jsonMatch[1] ?? jsonMatch[0];
    try {
      return JSON.parse(jsonStr.trim());
    } catch (e) {
      console.error('JSON parse error:', e, 'Raw:', jsonStr);
    }
  }
  try {
    return JSON.parse(text.trim());
  } catch {
    return null;
  }
}

// ============================================================================
// PROMPT BUILDERS
// ============================================================================

function buildPromptPTClassification(
  soal: string,
  jawabanMhs: string,
  jawabanRef: string,
  level: string,
  rubrikLevel: Record<string, number>
): string {
  const categories = Object.entries(rubrikLevel)
    .map(([k, v]) => `  - "${k}": ${v} poin`)
    .join('\n');
  return `Kamu adalah pengoreksi ujian Pre-test/Post-test mata kuliah Algoritma dan Pemrograman.

SOAL:
${soal}

JAWABAN REFERENSI (kunci jawaban yang benar):
${jawabanRef}

JAWABAN MAHASISWA:
${jawabanMhs || '(kosong / tidak dijawab)'}

RUBRIK PENILAIAN untuk level "${level}":
${categories}

INSTRUKSI:
1. Bandingkan jawaban mahasiswa dengan jawaban referensi.
2. Tentukan kategori yang PALING sesuai untuk jawaban mahasiswa.
3. Jika jawaban mahasiswa kosong atau hanya spasi, pilih "kosong".

Jawab HANYA dalam format JSON berikut (tanpa penjelasan lain):
{
  "kategori": "nama kategori yang dipilih",
  "poin": angka poin sesuai rubrik,
  "alasan": "penjelasan singkat (1 kalimat)"
}`;
}

function buildPromptHardCoding(
  deskripsi: string,
  instruksi: { soal: string; poin: number }[],
  jawabanMhs: string,
  sc: SubCrit
): string {
  const instruksiList = instruksi
    .map((inst, i) => `  ${i + 1}. ${inst.soal.trim()} (${inst.poin} poin)`)
    .join('\n');
  const bteMax = sc.bte_max;
  const bte4 = Math.max(1, Math.round(bteMax * 0.75));
  const bte1 = Math.max(1, Math.round(bteMax * 0.4));
  const twMin = sc.tw_min;
  const twMax = sc.tw_max;
  const tw10 = Math.round(twMax * 0.75);
  const tw4 = Math.round(twMax * 0.3);

  return `Kamu adalah pengoreksi ujian Post-test mata kuliah Algoritma dan Pemrograman.

DESKRIPSI SOAL:
${deskripsi}

INSTRUKSI (periksa setiap item):
${instruksiList}

KODE MAHASISWA:
${jawabanMhs || '(kosong / tidak dijawab)'}

SKALA "berjalan_tanpa_error" (0-${bteMax}):
- ${bteMax}: Perfect
- ${bte4}-${bteMax - 1}: Minor error
- ${bte1}-${bte4 - 1}: Major error
- 0: Kosong/total error

SKALA "tepat_waktu_selesai" (${twMin}-${twMax}):
- ${twMax}: Complete
- ${tw10}-${twMax - 1}: Minor missing
- ${tw4}-${tw10 - 1}: Incomplete
- ${twMin}-${tw4 - 1}: Minimum

ATURAN: Jika kode TIDAK KOSONG, total_poin minimal 1. berjalan_tanpa_error = 0 HANYA jika kode benar2 kosong.

Jawab HANYA JSON:
{
  "items": [{"nomor":1,"deskripsi":"...","poin_max":4,"poin_dapat":4,"terpenuhi":true}],
  "total_poin": angka,
  "berjalan_tanpa_error": angka_0_sampai_${bteMax},
  "tepat_waktu_selesai": angka_${twMin}_sampai_${twMax},
  "catatan": "penjelasan singkat"
}`;
}

function buildPromptKeterampilan(
  kode: string,
  items: KeterampilanItem[],
  bahasa: string,
  sc: SubCrit
): string {
  const bteMax = sc.bte_max;
  const bte90 = Math.round(bteMax * 0.8);
  const bte60 = Math.round(bteMax * 0.8) - 1;
  const bte30 = Math.round(bteMax * 0.5);
  const bte15 = Math.round(bteMax * 0.25);
  const twMin = sc.tw_min;
  const twMax = sc.tw_max;
  const tw75 = Math.round(twMax * 0.75);
  const tw30 = Math.round(twMax * 0.3);

  const itemList = items
    .map((item, i) => {
      if (item.kunci_jawaban === 'Bonus Otomatis') {
        return `  ${i + 1}. [BONUS OTOMATIS] ${item.referensi} (${item.poin} poin) → BERIKAN POIN PENUH`;
      }
      return `  ${i + 1}. ${item.referensi}\n     Kunci: ${item.kunci_jawaban}\n     Poin: ${item.poin}`;
    })
    .join('\n');

  return `Kamu adalah pengoreksi Program Keterampilan mata kuliah Algoritma dan Pemrograman.

BAHASA: ${bahasa === 'c' ? 'C' : 'Python'}

KODE MAHASISWA:
${kode || '(kosong)'}

RUBRIK PENILAIAN (periksa setiap item):
${itemList}

INSTRUKSI:
1. Periksa kode mahasiswa untuk SETIAP item rubrik.
2. [BONUS OTOMATIS] → SELALU poin penuh.
3. Penilaian parsial: terpenuhi=true (penuh), "partial" (proporsional), false (0).
4. Evaluasi kualitas kode.

SKALA berjalan_tanpa_error (0-${bteMax}):
- ${bteMax}: Perfect | ${bte90}-${bteMax - 1}: Minor | ${bte30}-${bte60}: Partial | ${bte15}-${bte30 - 1}: Major | 0: Kosong

SKALA tepat_waktu_selesai (${twMin}-${twMax}):
- ${twMax}: Complete | ${tw75}-${twMax - 1}: Minor missing | ${tw30}-${tw75 - 1}: Incomplete | ${twMin}-${tw30 - 1}: Minimum

ATURAN: kode tidak kosong → total minimal 1. berjalan_tanpa_error=0 hanya jika kode kosong.

Jawab HANYA JSON:
{
  "items": [{"nomor":1,"referensi":"...","poin_max":2,"poin_dapat":2,"terpenuhi":true,"alasan":"..."}],
  "total_poin": angka,
  "berjalan_tanpa_error": angka_0_sampai_${bteMax},
  "tepat_waktu_selesai": angka_${twMin}_sampai_${twMax},
  "catatan": "..."
}`;
}

function buildPromptUprakCoding(
  deskripsi: string,
  instruksi: { soal: string; poin: number }[],
  kode: string,
  bahasa: string,
  sc: SubCrit
): string {
  const instruksiText = (instruksi || [])
    .map((inst, i) => `${i + 1}. ${inst.soal} (${inst.poin} poin)`)
    .join('\n');
  const bteMax = sc.bte_max;
  const bte4 = Math.max(1, Math.round(bteMax * 0.75));
  const bte1 = Math.max(1, Math.round(bteMax * 0.4));
  const twMin = sc.tw_min;
  const twMax = sc.tw_max;
  const tw10 = Math.round(twMax * 0.75);
  const tw4 = Math.round(twMax * 0.3);

  return `Kamu adalah pengoreksi Ujian Praktik mata kuliah Algoritma dan Pemrograman.

SOAL CODING:
Deskripsi: ${deskripsi}
Bahasa: ${bahasa === 'c' ? 'C' : 'Python'}

INSTRUKSI SOAL:
${instruksiText || '(tidak ada)'}

KODE MAHASISWA:
${kode || '(kosong)'}

KRITERIA:
1. "sesuai_petunjuk" (max ${sc.sesuai_petunjuk_max}): proporsional ke jumlah instruksi terpenuhi.
2. "berjalan_tanpa_error" (max ${bteMax}): ${bteMax}=Perfect, ${bte4}-${bteMax - 1}=Minor, ${bte1}-${bte4 - 1}=Major, 0=Kosong.
3. "tepat_waktu_selesai" (${twMin}-${twMax}): ${twMax}=Complete, ${tw10}-${twMax - 1}=Minor missing, ${tw4}-${tw10 - 1}=Incomplete, ${twMin}-${tw4 - 1}=Minimum.

ATURAN: kode tidak kosong → sesuai_petunjuk minimal 1. berjalan_tanpa_error=0 hanya jika kosong.

Jawab HANYA JSON:
{
  "sesuai_petunjuk": angka_0_sampai_${sc.sesuai_petunjuk_max},
  "berjalan_tanpa_error": angka_0_sampai_${bteMax},
  "tepat_waktu_selesai": angka_${twMin}_sampai_${twMax},
  "catatan": "..."
}`;
}

function buildPromptUprakFlowchart(
  deskripsi: string,
  kode: string,
  bahasa: string,
  instruksi: { soal: string; poin: number }[] | undefined,
  sc: SubCrit
): string {
  const bteMax = sc.bte_max;
  const bte4 = Math.max(1, Math.round(bteMax * 0.75));
  const bte1 = Math.max(1, Math.round(bteMax * 0.4));
  const twMin = sc.tw_min;
  const twMax = sc.tw_max;
  const tw10 = Math.round(twMax * 0.75);
  const tw4 = Math.round(twMax * 0.3);

  const hasInstr = Array.isArray(instruksi) && instruksi.length > 0;
  const referensi = hasInstr
    ? `\nRUBRIK PENILAIAN:\n${instruksi.map((i, j) => `${j + 1}. ${i.soal} (${i.poin} poin)`).join('\n')}\n`
    : '';

  return `Kamu adalah pengoreksi Ujian Praktik mata kuliah Algoritma dan Pemrograman.

SOAL FLOWCHART:
Deskripsi: ${deskripsi}
Bahasa mahasiswa: ${bahasa === 'c' ? 'C' : 'Python'}
${referensi}
KODE MAHASISWA:
${kode || '(kosong)'}

KRITERIA:
1. "kesesuaian_alur" (max ${sc.sesuai_petunjuk_max}): seberapa sesuai kode dengan alur flowchart.
2. "berjalan_tanpa_error" (max ${bteMax}): ${bteMax}=Perfect, ${bte4}-${bteMax - 1}=Minor, ${bte1}-${bte4 - 1}=Major, 0=Kosong.
3. "tepat_waktu_selesai" (${twMin}-${twMax}): ${twMax}=Complete, ${tw10}-${twMax - 1}=Minor, ${tw4}-${tw10 - 1}=Incomplete, ${twMin}-${tw4 - 1}=Minimum.

ATURAN: kode tidak kosong → kesesuaian_alur minimal 1.

Jawab HANYA JSON:
{
  "kesesuaian_alur": angka_0_sampai_${sc.sesuai_petunjuk_max},
  "berjalan_tanpa_error": angka_0_sampai_${bteMax},
  "tepat_waktu_selesai": angka_${twMin}_sampai_${twMax},
  "catatan": "..."
}`;
}

// ============================================================================
// GRADING FUNCTIONS
// ============================================================================

export interface GradingResult {
  nilai: number;
  grading_detail: {
    graded_by: 'ai';
    graded_at: string;
    [key: string]: unknown;
  };
}

interface PTAnswer {
  nomor?: number;
  level: string;
  soal?: string;
  deskripsi?: string;
  jawaban_mahasiswa?: string;
  jawaban_referensi?: string;
  instruksi?: { soal: string; poin: number }[];
}

export async function gradePT(jawaban: Jawaban): Promise<GradingResult> {
  const rubrik = await loadRubrik();
  const type = jawaban.type;
  const answers = (jawaban.answers ?? []) as unknown as PTAnswer[];
  const breakdown: Record<string, unknown>[] = [];
  let totalPoin = 0;

  for (let i = 0; i < answers.length; i++) {
    const a = answers[i]!;
    const level = a.level;

    if (type === 'posttest' && level === 'hard' && a.instruksi && a.instruksi.length > 0) {
      const sc = rubrik.sub_criteria.posttest_hard;
      const prompt = buildPromptHardCoding(
        a.deskripsi ?? a.soal ?? '',
        a.instruksi,
        a.jawaban_mahasiswa ?? '',
        sc
      );
      const responseText = await callOllama(prompt);
      const result = extractJSON(responseText) as
        | { items: { poin_max: number; poin_dapat: number }[]; total_poin?: number; berjalan_tanpa_error: number; tepat_waktu_selesai: number; catatan?: string }
        | null;

      if (result && result.items) {
        const rawInstrPoin =
          typeof result.total_poin === 'number'
            ? result.total_poin
            : result.items.reduce((sum, item) => sum + (Number(item.poin_dapat) || 0), 0);
        const maxInstrPoin =
          result.items.reduce((sum, item) => sum + (Number(item.poin_max) || 0), 0) ||
          sc.sesuai_petunjuk_max;
        const rawSp =
          Math.round((rawInstrPoin / maxInstrPoin) * sc.sesuai_petunjuk_max * 100) / 100;
        const rawBte = Math.min(result.berjalan_tanpa_error ?? 0, sc.bte_max);
        const rawTw = Math.max(sc.tw_min, Math.min(result.tepat_waktu_selesai ?? sc.tw_min, sc.tw_max));
        const hasCode = !!a.jawaban_mahasiswa?.trim();
        const s = sanitizeSubCriteria(rawSp, rawBte, rawTw, sc, hasCode);
        const totalSoal = Math.round((s.sp + s.bte + s.tw) * 100) / 100;
        totalPoin += totalSoal;
        breakdown.push({
          label: `Soal ${i + 1} (${level})`,
          kategori: 'coding sub-criteria',
          poin: totalSoal,
          sub_items: result.items,
          sub_criteria: { sesuai_petunjuk: s.sp, berjalan_tanpa_error: s.bte, tepat_waktu: s.tw },
          catatan: result.catatan ?? ''
        });
      } else {
        totalPoin += sc.tw_min;
        breakdown.push({ label: `Soal ${i + 1} (${level})`, kategori: 'error parsing', poin: sc.tw_min });
      }
    } else {
      // Easy/Medium classification
      const rubrikLevel =
        type === 'pretest'
          ? (rubrik.pretest as unknown as Record<string, Record<string, number>>)[level] ?? {}
          : (rubrik.posttest as unknown as Record<string, Record<string, number>>)[level] ?? {};
      const prompt = buildPromptPTClassification(
        a.soal ?? '',
        a.jawaban_mahasiswa ?? '',
        a.jawaban_referensi ?? '',
        level,
        rubrikLevel
      );
      const responseText = await callOllama(prompt);
      const result = extractJSON(responseText) as
        | { kategori?: string; poin?: number; alasan?: string }
        | null;

      if (result && typeof result.poin === 'number') {
        totalPoin += result.poin;
        breakdown.push({
          label: `Soal ${i + 1} (${level})`,
          kategori: result.kategori ?? '',
          poin: result.poin,
          alasan: result.alasan ?? ''
        });
      } else {
        breakdown.push({ label: `Soal ${i + 1} (${level})`, kategori: 'error parsing', poin: 0 });
      }
    }
  }

  return {
    nilai: Math.round(totalPoin * 100) / 100,
    grading_detail: {
      graded_by: 'ai',
      graded_at: new Date().toISOString(),
      breakdown
    }
  };
}

export async function gradeKeterampilan(
  jawaban: Jawaban,
  rubrikItems: KeterampilanItem[]
): Promise<GradingResult> {
  const rubrik = await loadRubrik();
  const sc = rubrik.sub_criteria.keterampilan;

  const prompt = buildPromptKeterampilan(jawaban.kode ?? '', rubrikItems, jawaban.bahasa ?? 'c', sc);
  const responseText = await callOllama(prompt);
  const result = extractJSON(responseText) as
    | {
        items: { nomor?: number; referensi?: string; poin_max?: number; poin_dapat?: number; terpenuhi?: unknown; alasan?: string }[];
        total_poin?: number;
        berjalan_tanpa_error?: number;
        tepat_waktu_selesai?: number;
        catatan?: string;
      }
    | null;

  if (result && result.items) {
    const rawItemPoin =
      typeof result.total_poin === 'number'
        ? result.total_poin
        : result.items.reduce((s, item) => s + (Number(item.poin_dapat) || 0), 0);
    const rawSp = Math.min(rawItemPoin, sc.sesuai_petunjuk_max);
    const rawBte = Math.min(result.berjalan_tanpa_error ?? 0, sc.bte_max);
    const rawTw = Math.max(sc.tw_min, Math.min(result.tepat_waktu_selesai ?? sc.tw_min, sc.tw_max));
    const hasCode = !!jawaban.kode?.trim();
    const s = sanitizeSubCriteria(rawSp, rawBte, rawTw, sc, hasCode);
    const totalNilai = s.sp + s.bte + s.tw;

    return {
      nilai: totalNilai,
      grading_detail: {
        graded_by: 'ai',
        graded_at: new Date().toISOString(),
        breakdown: result.items.map((item) => ({
          label: item.referensi ?? `Item ${item.nomor ?? '-'}`,
          terpenuhi: item.terpenuhi,
          poin: item.poin_dapat,
          poin_max: item.poin_max,
          alasan: item.alasan ?? ''
        })),
        sub_criteria: {
          sesuai_petunjuk: s.sp,
          sesuai_petunjuk_max: sc.sesuai_petunjuk_max,
          berjalan_tanpa_error: s.bte,
          berjalan_tanpa_error_max: sc.bte_max,
          tepat_waktu: s.tw,
          tepat_waktu_max: sc.tw_max,
          total: totalNilai,
          total_max: sc.sesuai_petunjuk_max + sc.bte_max + sc.tw_max
        },
        catatan: result.catatan ?? ''
      }
    };
  }

  return {
    nilai: sc.tw_min,
    grading_detail: {
      graded_by: 'ai',
      graded_at: new Date().toISOString(),
      breakdown: [],
      error: 'Failed to parse AI response',
      raw_response: responseText
    }
  };
}

export async function gradeUjianPraktik(jawaban: Jawaban): Promise<GradingResult> {
  const rubrik = await loadRubrik();
  const sc = rubrik.sub_criteria.ujian_praktik;
  const answers = (jawaban.answers ?? []) as unknown as {
    modul?: string;
    opsi?: string | number;
    deskripsi?: string;
    bahasa?: string;
    kode?: string;
    instruksi?: { soal: string; poin: number }[];
    modul_nama?: string;
  }[];

  const gradingResults: Record<string, unknown>[] = [];
  let totalRaw = 0;

  for (let idx = 0; idx < answers.length; idx++) {
    const item = answers[idx]!;
    const isFlowchart = item.modul === 'flowchart';
    const prompt = isFlowchart
      ? buildPromptUprakFlowchart(
          item.deskripsi ?? '',
          item.kode ?? '',
          item.bahasa ?? 'c',
          item.instruksi,
          sc
        )
      : buildPromptUprakCoding(
          item.deskripsi ?? '',
          item.instruksi ?? [],
          item.kode ?? '',
          item.bahasa ?? 'c',
          sc
        );

    const responseText = await callOllama(prompt);
    const result = extractJSON(responseText) as
      | { kesesuaian_alur?: number; sesuai_petunjuk?: number; berjalan_tanpa_error?: number; tepat_waktu_selesai?: number; catatan?: string }
      | null;

    if (result) {
      const rawSp = isFlowchart
        ? Math.min(result.kesesuaian_alur ?? 0, sc.sesuai_petunjuk_max)
        : Math.min(result.sesuai_petunjuk ?? 0, sc.sesuai_petunjuk_max);
      const rawBte = Math.min(result.berjalan_tanpa_error ?? 0, sc.bte_max);
      const rawTw = Math.max(sc.tw_min, Math.min(result.tepat_waktu_selesai ?? sc.tw_min, sc.tw_max));
      const hasCode = !!item.kode?.trim();
      const s = sanitizeSubCriteria(rawSp, rawBte, rawTw, sc, hasCode);
      const totalSesi = s.sp + s.bte + s.tw;
      totalRaw += totalSesi;

      gradingResults.push({
        sesi: idx + 1,
        modul: item.modul_nama ?? (isFlowchart ? 'Flowchart' : `Modul ${item.modul}`),
        opsi: item.opsi,
        sesuai_petunjuk: s.sp,
        berjalan_tanpa_error: s.bte,
        tepat_waktu: s.tw,
        total_sesi: totalSesi,
        catatan: result.catatan ?? ''
      });
    } else {
      gradingResults.push({
        sesi: idx + 1,
        modul: item.modul_nama ?? (isFlowchart ? 'Flowchart' : `Modul ${item.modul}`),
        opsi: item.opsi,
        sesuai_petunjuk: 0,
        berjalan_tanpa_error: 0,
        tepat_waktu: sc.tw_min,
        total_sesi: sc.tw_min,
        catatan: 'Failed to parse',
        error: true
      });
      totalRaw += sc.tw_min;
    }
  }

  const maxRaw = sc.max_raw || 270;
  const nilaiAkhir = Math.round((totalRaw / maxRaw) * 100 * 100) / 100;

  return {
    nilai: nilaiAkhir,
    grading_detail: {
      graded_by: 'ai',
      graded_at: new Date().toISOString(),
      total_raw: totalRaw,
      max_raw: maxRaw,
      results: gradingResults
    }
  };
}
