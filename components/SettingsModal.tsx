import React from 'react';
import {
  X,
  Globe,
  Check,
  Sparkles,
  RefreshCw,
  Sun,
  Moon,
  CheckCircle2,
} from 'lucide-react';
import { MeaningLanguagePreference } from '../types';
import { LANGUAGE_PREFERENCE_OPTIONS } from '../utils/languageUtils';
import { MeaningDisplay } from './MeaningDisplay';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  languagePreference: MeaningLanguagePreference;
  onChangeLanguagePreference: (pref: MeaningLanguagePreference) => void;
  totalCards: number;
  translatedPersianCount: number;
  isBackfilling: boolean;
  backfillProgress: { completed: number; total: number } | null;
  onTriggerBackfill: () => void;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  languagePreference,
  onChangeLanguagePreference,
  totalCards,
  translatedPersianCount,
  isBackfilling,
  backfillProgress,
  onTriggerBackfill,
  isDarkMode,
  onToggleDarkMode,
}) => {
  if (!isOpen) return null;

  const missingPersianCount = Math.max(0, totalCards - translatedPersianCount);
  const progressPct =
    backfillProgress && backfillProgress.total > 0
      ? Math.round((backfillProgress.completed / backfillProgress.total) * 100)
      : 0;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
      data-testid="settings-modal"
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative w-full max-w-lg bg-white dark:bg-slate-800 rounded-2xl sm:rounded-3xl shadow-2xl border border-slate-100 dark:border-slate-700 overflow-hidden z-10 flex flex-col max-h-[88dvh]">
        {/* Header */}
        <div className="px-4 sm:px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between bg-slate-50/80 dark:bg-slate-800/80 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-brand-100 dark:bg-brand-900/40 text-brand-600 dark:text-brand-400">
              <Globe className="h-5 w-5" />
            </div>
            <div>
              <h2
                id="settings-modal-title"
                className="text-lg sm:text-xl font-serif font-bold text-slate-900 dark:text-white"
              >
                App Settings
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Customize dictionary languages & display preferences
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            data-testid="close-settings-button"
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-6 space-y-5 overflow-y-auto custom-scrollbar">
          {/* Language Selection */}
          <div className="space-y-3">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Meaning & Translation Language
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                Lumina always fetches and saves meanings in all supported languages in your JSON data, and displays only the language(s) selected below across Dictionary, Flashcards, and Study Sessions.
              </p>
            </div>

            <div className="space-y-2.5" role="radiogroup" aria-label="Meaning language preference">
              {LANGUAGE_PREFERENCE_OPTIONS.map((option) => {
                const isSelected = languagePreference === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    data-testid={`language-option-${option.value}`}
                    onClick={() => onChangeLanguagePreference(option.value)}
                    className={`w-full text-left p-3.5 rounded-2xl border-2 transition-all flex items-start justify-between gap-3 ${
                      isSelected
                        ? 'border-brand-500 bg-brand-50/70 dark:bg-brand-900/25 shadow-sm'
                        : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 bg-white dark:bg-slate-800/60'
                    }`}
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm sm:text-base text-slate-900 dark:text-white">
                          {option.label}
                        </span>
                        <span
                          dir={option.value !== 'en' ? 'rtl' : 'ltr'}
                          className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                            option.value !== 'en' ? 'font-persian' : ''
                          } ${
                            isSelected
                              ? 'bg-brand-600 text-white'
                              : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          {option.nativeSubtitle}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                        {option.description}
                      </p>
                    </div>

                    <div
                      className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                        isSelected
                          ? 'bg-brand-600 text-white'
                          : 'border-2 border-slate-300 dark:border-slate-600'
                      }`}
                    >
                      {isSelected && <Check className="h-3.5 w-3.5 stroke-[3]" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Live Flashcard Preview */}
          <div className="rounded-2xl bg-slate-900 text-white p-4 space-y-2.5 border border-slate-800 shadow-inner">
            <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
              <span className="flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-brand-400" />
                Flashcard Preview — "Ephemeral"
              </span>
              <span className="text-brand-400 font-mono">
                {languagePreference === 'both'
                  ? 'English → Persian'
                  : languagePreference === 'fa'
                    ? 'Persian (فارسی)'
                    : 'English'}
              </span>
            </div>

            <MeaningDisplay
              englishText="Lasting for a very short time."
              translations={{
                fa: 'زودگذر، ناپایدار — ماندگار برای مدت بسیار کوتاه',
              }}
              preference={languagePreference}
              variant="darkCard"
              testIdPrefix="settings-preview"
            />
          </div>

          {/* Existing Deck Multi-Language Coverage & Backfill */}
          {totalCards > 0 && (
            <div
              data-testid="settings-translation-sync-box"
              className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/40 p-4 space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                  Saved Deck Translations (Persian)
                </span>
                <span
                  data-testid="settings-translated-count"
                  className="text-xs font-semibold text-brand-600 dark:text-brand-400"
                >
                  {translatedPersianCount} / {totalCards} cards
                </span>
              </div>

              {isBackfilling ? (
                <div className="space-y-2" data-testid="settings-backfill-progress">
                  <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
                    <span className="flex items-center gap-1.5">
                      <RefreshCw className="h-3.5 w-3.5 animate-spin text-brand-500" />
                      Fetching Persian translations for existing cards...
                    </span>
                    <span className="font-mono font-semibold">{progressPct}%</span>
                  </div>
                  <div className="h-2 w-full bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-brand-500 transition-all duration-300"
                      style={{ width: `${Math.max(8, progressPct)}%` }}
                    />
                  </div>
                </div>
              ) : missingPersianCount === 0 ? (
                <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  All {totalCards} flashcards in your deck have both English & Persian saved in JSON!
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {missingPersianCount} older {missingPersianCount === 1 ? 'card does' : 'cards do'} not have a saved Persian translation yet.
                  </p>
                  <button
                    type="button"
                    data-testid="backfill-translations-button"
                    onClick={onTriggerBackfill}
                    className="px-3.5 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 shrink-0"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Translate {missingPersianCount} Missing
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Appearance Quick Toggle */}
          <div className="pt-1 flex items-center justify-between gap-3 border-t border-slate-100 dark:border-slate-700">
            <div>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Appearance</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Switch between Light and Dark theme
              </p>
            </div>
            <button
              type="button"
              onClick={onToggleDarkMode}
              className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-2 transition-colors"
            >
              {isDarkMode ? (
                <>
                  <Sun className="h-4 w-4 text-amber-400" />
                  Light Mode
                </>
              ) : (
                <>
                  <Moon className="h-4 w-4 text-slate-600" />
                  Dark Mode
                </>
              )}
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-6 py-3.5 border-t border-slate-100 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/80 flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold shadow-sm transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
