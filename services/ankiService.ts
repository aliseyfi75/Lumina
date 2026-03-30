import JSZip from 'jszip';
import initSqlJs from 'sql.js';
import { Flashcard, FlashcardStatus } from '../types';

const FIELD_SEPARATOR = String.fromCharCode(0x1f);
let sqlJsPromise: ReturnType<typeof initSqlJs> | null = null;

async function loadSqlJs() {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs({ locateFile: () => './sql-wasm.wasm' });
  }
  return sqlJsPromise;
}

function stripHtml(html: string): string {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html;
  return (div.textContent ?? div.innerText ?? '').trim();
}

function listTables(db: import('sql.js').Database): string[] {
  for (const catalog of ['sqlite_master', 'sqlite_schema']) {
    try {
      const res = db.exec(`SELECT name FROM ${catalog} WHERE type='table'`);
      if (res.length && res[0].values.length) return res[0].values.map(r => String(r[0]));
    } catch { continue; }
  }
  return [];
}

async function openApkgDb(file: File): Promise<import('sql.js').Database> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(file); }
  catch (e: any) { throw new Error(`Not a valid ZIP/APKG archive: ${e?.message ?? e}`); }

  const zipEntries = Object.keys(zip.files);
  const dbFile = zip.file('collection.anki21') || zip.file('collection.anki2');
  if (!dbFile) {
    throw new Error(`No Anki database found. Expected "collection.anki21" or "collection.anki2", but found: ${zipEntries.join(', ') || '(empty)'}`);
  }

  const dbBuffer = await dbFile.async('arraybuffer');
  const magic = new Uint8Array(dbBuffer, 0, 16);
  const expected = [0x53,0x51,0x4c,0x69,0x74,0x65,0x20,0x66,0x6f,0x72,0x6d,0x61,0x74,0x20,0x33,0x00];
  if (!expected.every((b, i) => magic[i] === b)) throw new Error('File is not a valid SQLite database.');

  let SQL: Awaited<ReturnType<typeof initSqlJs>>;
  try { SQL = await loadSqlJs(); }
  catch (e: any) { throw new Error(`Could not load SQLite engine: ${e?.message ?? e}`); }

  let db: import('sql.js').Database;
  try { db = new SQL.Database(new Uint8Array(dbBuffer)); }
  catch (e: any) { throw new Error(`Could not open database: ${e?.message ?? e}`); }

  const tables = listTables(db);
  if (!tables.includes('notes')) {
    db.close();
    throw new Error(`Database has no "notes" table. Tables found: ${tables.join(', ') || '(none)'}`);
  }
  return db;
}

// ── Public types ────────────────────────────────────────────────────────────

export interface AnkiModelInfo {
  id: string;
  name: string;
  fields: string[];
  noteCount: number;
  sampleValues: string[]; // stripped values from first note (parallel to fields[])
}

export interface AnkiSchema {
  models: AnkiModelInfo[];
  totalNotes: number;
}

export interface LuminaFieldMapping {
  word: string | null;
  definition: string | null;
  example: string | null;
  phonetic: string | null;
}

export interface ModelMapping {
  modelId: string;
  mapping: LuminaFieldMapping;
}

// ── Auto-suggestion heuristics ──────────────────────────────────────────────

const WORD_NAMES     = /^(word|english|front|term|vocab|expression|kanji|hanzi|simplified|traditional|target)$/i;
const MEANING_NAMES  = /^(meaning|definition|back|def|translation|gloss|native|l1)$/i;
const EXAMPLE_NAMES  = /^(example|sentence|context|sample|usage)$/i;
const PHONETIC_NAMES = /^(transcription|ipa|reading|kana|pronunciation|am&?brtranscription|amtranscription|brtranscription)$/i;

export function suggestMapping(fields: string[]): LuminaFieldMapping {
  return {
    word:       fields.find(n => WORD_NAMES.test(n))     ?? null,
    definition: fields.find(n => MEANING_NAMES.test(n))  ?? null,
    example:    fields.find(n => EXAMPLE_NAMES.test(n))  ?? null,
    phonetic:   fields.find(n => PHONETIC_NAMES.test(n)) ?? null,
  };
}

// ── Schema reader (used by the mapping UI) ──────────────────────────────────

export async function readApkgSchema(file: File): Promise<AnkiSchema> {
  const db = await openApkgDb(file);
  try {
    const colRes = db.exec('SELECT models FROM col LIMIT 1');
    if (!colRes.length || !colRes[0].values.length) throw new Error('col table is empty.');
    const rawModels: Record<string, any> = JSON.parse(String(colRes[0].values[0][0]));

    const countRes = db.exec('SELECT mid, COUNT(*) FROM notes GROUP BY mid');
    const noteCounts: Record<string, number> = {};
    if (countRes.length) {
      for (const row of countRes[0].values) noteCounts[String(row[0])] = Number(row[1]);
    }

    // One sample note per model
    const sampleRes = db.exec('SELECT mid, flds FROM notes GROUP BY mid');
    const sampleByMid: Record<string, string> = {};
    if (sampleRes.length) {
      for (const row of sampleRes[0].values) sampleByMid[String(row[0])] = String(row[1]);
    }

    const models: AnkiModelInfo[] = Object.entries(rawModels).map(([id, model]) => {
      const flds: Array<{ name: string; ord: number }> = model.flds ?? [];
      const fieldNames = [...flds].sort((a, b) => a.ord - b.ord).map(f => f.name);
      const sampleRaw = sampleByMid[id] ?? '';
      const parts = sampleRaw.split(FIELD_SEPARATOR);
      const sampleValues = fieldNames.map((_, i) =>
        stripHtml(parts[i] ?? '').replace(/\[sound:[^\]]+\]/g, '').trim()
      );
      return { id, name: model.name ?? `Model ${id}`, fields: fieldNames, noteCount: noteCounts[id] ?? 0, sampleValues };
    });

    models.sort((a, b) => b.noteCount - a.noteCount);
    return { models, totalNotes: models.reduce((s, m) => s + m.noteCount, 0) };
  } finally {
    db.close();
  }
}

// ── Importer (uses explicit per-model mappings) ─────────────────────────────

export async function importWithMapping(file: File, modelMappings: ModelMapping[]): Promise<Flashcard[]> {
  const db = await openApkgDb(file);
  try {
    const colRes = db.exec('SELECT models FROM col LIMIT 1');
    const rawModels: Record<string, any> = JSON.parse(String(colRes[0].values[0][0]));

    // Build fieldName→index maps per model
    const fieldIndexMaps = new Map<string, Map<string, number>>();
    for (const [id, model] of Object.entries(rawModels)) {
      const flds: Array<{ name: string; ord: number }> = model.flds ?? [];
      const sorted = [...flds].sort((a, b) => a.ord - b.ord);
      const indexMap = new Map<string, number>();
      sorted.forEach((f, i) => indexMap.set(f.name, i));
      fieldIndexMaps.set(id, indexMap);
    }

    const mappingMap = new Map(modelMappings.map(m => [m.modelId, m.mapping]));
    const results = db.exec('SELECT mid, flds FROM notes');
    if (!results.length || !results[0].values.length) throw new Error('No notes found.');

    const now = Date.now();
    const flashcards: Flashcard[] = [];
    let skipped = 0;

    for (const row of results[0].values) {
      const mid = String(row[0]);
      const fldsRaw = row[1];
      if (typeof fldsRaw !== 'string') { skipped++; continue; }

      const mapping = mappingMap.get(mid);
      const indexMap = fieldIndexMaps.get(mid);
      if (!mapping || !indexMap) { skipped++; continue; }

      const parts = fldsRaw.split(FIELD_SEPARATOR);
      const get = (fieldName: string | null): string => {
        if (!fieldName) return '';
        const idx = indexMap.get(fieldName);
        if (idx === undefined) return '';
        return stripHtml(parts[idx] ?? '').replace(/\[sound:[^\]]+\]/g, '').trim();
      };

      const word = get(mapping.word);
      if (!word) { skipped++; continue; }

      flashcards.push({
        id: crypto.randomUUID(),
        word,
        mainDefinition: get(mapping.definition) || '—',
        example:        get(mapping.example)    || undefined,
        phonetic:       get(mapping.phonetic)   || undefined,
        partOfSpeech: '',
        audio: undefined, image: undefined,
        status: FlashcardStatus.New,
        lastReviewed: 0, createdAt: now,
        interval: 0, repetition: 0, easinessFactor: 2.5, nextReviewDate: now,
      });
    }

    if (flashcards.length === 0) throw new Error(`No importable cards found (${skipped} notes skipped).`);
    return flashcards;
  } finally {
    db.close();
  }
}
