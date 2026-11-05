import React, { useState, useEffect } from 'react';
import { X, Zap, Loader2, AlertCircle, FileText, ChevronDown, CheckCircle } from 'lucide-react';
import {
  readApkgSchema, importWithMapping, suggestMapping,
  AnkiModelInfo, AnkiSchema, LuminaFieldMapping, ModelMapping,
} from '../services/ankiService';
import { Flashcard } from '../types';

interface AnkiImportModalProps {
  file: File | null;
  onClose: () => void;
  onImport: (cards: Flashcard[]) => void;
}

const LUMINA_FIELDS: { key: keyof LuminaFieldMapping; label: string; required: boolean }[] = [
  { key: 'word',       label: 'Word',       required: true  },
  { key: 'definition', label: 'Definition', required: false },
  { key: 'example',    label: 'Example',    required: false },
  { key: 'phonetic',   label: 'Phonetic',   required: false },
];

// ── Sub-component: mapping row for one Lumina field ─────────────────────────

const MappingRow: React.FC<{
  lumina: { key: keyof LuminaFieldMapping; label: string; required: boolean };
  fields: string[];
  selected: string | null;
  preview: string;
  onChange: (val: string | null) => void;
}> = ({ lumina, fields, selected, preview, onChange }) => (
  <div className="grid grid-cols-[130px_1fr_1fr] items-center px-4 py-2.5 gap-3 hover:bg-slate-50/50 dark:hover:bg-slate-700/40 transition-colors">
    <div className="flex items-center gap-1">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{lumina.label}</span>
      {lumina.required && <span className="text-orange-500 text-xs">*</span>}
    </div>
    <div className="relative">
      <select
        value={selected ?? ''}
        onChange={e => onChange(e.target.value || null)}
        className="w-full text-sm appearance-none bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-1.5 pr-8 text-slate-700 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent cursor-pointer"
      >
        <option value="">(none)</option>
        {fields.map(f => <option key={f} value={f}>{f}</option>)}
      </select>
      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
    </div>
    <div className="truncate">
      {preview
        ? <span className="text-xs text-slate-400 dark:text-slate-300 italic truncate block" title={preview}>{preview}</span>
        : <span className="text-xs text-slate-300 dark:text-slate-600">—</span>
      }
    </div>
  </div>
);

// ── Sub-component: one model section ────────────────────────────────────────

const ModelSection: React.FC<{
  model: AnkiModelInfo;
  mapping: LuminaFieldMapping;
  enabled: boolean;
  onToggle: () => void;
  onChange: (field: keyof LuminaFieldMapping, val: string | null) => void;
}> = ({ model, mapping, enabled, onToggle, onChange }) => {
  const hasWord = !!mapping.word;
  const preview = (fieldName: string | null) => {
    if (!fieldName) return '';
    const idx = model.fields.indexOf(fieldName);
    return idx >= 0 ? (model.sampleValues[idx] ?? '') : '';
  };

  return (
    <div className={`rounded-xl border overflow-hidden transition-opacity ${enabled ? (hasWord ? 'border-slate-200 dark:border-slate-700' : 'border-amber-200 dark:border-amber-700') : 'border-slate-200 dark:border-slate-700 opacity-50'}`}>
      {/* Header */}
      <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          {/* Checkbox toggle */}
          <input
            type="checkbox"
            id={`model-toggle-${model.id}`}
            checked={enabled}
            onChange={onToggle}
            className="h-4 w-4 rounded accent-orange-500 cursor-pointer"
          />
          <label htmlFor={`model-toggle-${model.id}`} className="text-sm font-semibold text-slate-800 dark:text-slate-100 cursor-pointer select-none">
            {model.name}
          </label>
          {enabled && !hasWord && (
            <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 rounded-full uppercase tracking-wider">
              Word field required
            </span>
          )}
        </div>
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{model.noteCount.toLocaleString()} notes</span>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[130px_1fr_1fr] px-4 py-1.5 gap-3 bg-slate-50/50 dark:bg-slate-800/60 border-b border-slate-100 dark:border-slate-700">
        <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Lumina field</span>
        <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Anki field</span>
        <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Preview</span>
      </div>

      {/* Rows */}
      <div className={`divide-y divide-slate-100 dark:divide-slate-700 ${!enabled ? 'pointer-events-none' : ''}`}>
        {LUMINA_FIELDS.map(lf => (
          <MappingRow
            key={lf.key}
            lumina={lf}
            fields={model.fields}
            selected={mapping[lf.key]}
            preview={preview(mapping[lf.key])}
            onChange={val => onChange(lf.key, val)}
          />
        ))}
      </div>
    </div>
  );
};

// ── Main modal ───────────────────────────────────────────────────────────────

export const AnkiImportModal: React.FC<AnkiImportModalProps> = ({ file, onClose, onImport }) => {
  const [schema, setSchema]       = useState<AnkiSchema | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [mappings, setMappings]   = useState<Record<string, LuminaFieldMapping>>({});
  const [enabled, setEnabled]     = useState<Record<string, boolean>>({});
  const [isImporting, setIsImporting] = useState(false);

  useEffect(() => {
    if (!file) { setSchema(null); setError(null); setMappings({}); setEnabled({}); return; }
    setIsLoading(true); setError(null); setSchema(null); setMappings({}); setEnabled({});
    readApkgSchema(file)
      .then(s => {
        setSchema(s);
        const initMappings: Record<string, LuminaFieldMapping> = {};
        const initEnabled: Record<string, boolean> = {};
        s.models.forEach(m => {
          initMappings[m.id] = suggestMapping(m.fields);
          initEnabled[m.id] = true;
        });
        setMappings(initMappings);
        setEnabled(initEnabled);
      })
      .catch((e: any) => setError(e.message ?? 'Failed to read Anki file.'))
      .finally(() => setIsLoading(false));
  }, [file]);

  if (!file) return null;

  const handleMappingChange = (modelId: string, field: keyof LuminaFieldMapping, val: string | null) => {
    setMappings(prev => ({ ...prev, [modelId]: { ...prev[modelId], [field]: val } }));
  };

  const handleImport = async () => {
    if (!schema) return;
    const modelMappings: ModelMapping[] = schema.models
      .filter(m => enabled[m.id])
      .map(m => ({
        modelId: m.id,
        mapping: mappings[m.id] ?? { word: null, definition: null, example: null, phonetic: null },
      }));
    setIsImporting(true);
    setError(null);
    try {
      const cards = await importWithMapping(file, modelMappings);
      onImport(cards);
    } catch (e: any) {
      setError(e.message ?? 'Import failed.');
    } finally {
      setIsImporting(false);
    }
  };

  const selectedCount = schema?.models
    .filter(m => enabled[m.id])
    .reduce((s, m) => s + m.noteCount, 0) ?? 0;

  const canImport = !!schema && schema.models.some(m => enabled[m.id] && mappings[m.id]?.word);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-2xl flex flex-col max-h-[90vh] border border-slate-100 dark:border-slate-700">

        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between bg-orange-50/60 dark:bg-orange-950/30 rounded-t-2xl shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-100 dark:bg-orange-900/40 text-orange-600 dark:text-orange-400 rounded-lg">
              <Zap className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-serif font-bold text-slate-900 dark:text-white">Import from Anki</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-1.5">
                <FileText className="h-3 w-3" />{file.name}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar">
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-500 dark:text-slate-400">
              <Loader2 className="h-8 w-8 text-orange-400 animate-spin" />
              <p className="text-sm">Reading deck structure…</p>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-3 p-4 bg-red-50 dark:bg-red-900/20 rounded-xl text-red-700 dark:text-red-400 text-sm">
              <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
              <p>{error}</p>
            </div>
          )}

          {schema && (
            <>
              <div className="flex items-center gap-2.5 text-sm text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-900/50 rounded-xl p-3.5 border border-slate-100 dark:border-slate-700">
                <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                <span>
                  Found <strong>{schema.models.length}</strong> note type{schema.models.length !== 1 ? 's' : ''} · <strong>{schema.totalNotes.toLocaleString()}</strong> cards total.
                  {' '}Map each Anki field to the corresponding Lumina field, then click Import.
                </span>
              </div>

              <div className="space-y-4">
                {schema.models.map(model => (
                  <ModelSection
                    key={model.id}
                    model={model}
                    mapping={mappings[model.id] ?? { word: null, definition: null, example: null, phonetic: null }}
                    enabled={enabled[model.id] ?? true}
                    onToggle={() => setEnabled(prev => ({ ...prev, [model.id]: !prev[model.id] }))}
                    onChange={(field, val) => handleMappingChange(model.id, field, val)}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between shrink-0">
          <button onClick={onClose} className="text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors px-4 py-2">
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!canImport || isImporting || isLoading}
            className="flex items-center gap-2 px-6 py-2.5 bg-orange-500 text-white text-sm font-semibold rounded-xl hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm shadow-orange-400/30"
          >
            {isImporting
              ? <><Loader2 className="h-4 w-4 animate-spin" />Importing…</>
              : <><Zap className="h-4 w-4" />Import {selectedCount.toLocaleString()} cards</>
            }
          </button>
        </div>
      </div>
    </div>
  );
};
