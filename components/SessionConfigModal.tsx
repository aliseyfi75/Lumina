import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Play, Zap, BrainCircuit, ListChecks, Tag, BookOpen, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { Flashcard } from '../types';
import { getDueCards } from '../utils/studyUtils';
import { parseTagHierarchy, formatBookTag, getCardBookInfo, getCardBookInfoForBook, compareChapterNames } from '../utils/tagUtils';

export type SessionMode = 'full' | 'short' | 'quiz';

const COLLAPSED_SESSION_CHAPTER_LIMIT = 6;

interface SessionConfigModalProps {
    isOpen: boolean;
    onClose: () => void;
    onStart: (config: { mode: SessionMode; count?: number; tag?: string; chapters?: string[] }) => void;
    dueCount: number;
    cards?: Flashcard[];
    initialTag?: string;
    initialChapters?: string[];
}

export const SessionConfigModal: React.FC<SessionConfigModalProps> = ({
    isOpen,
    onClose,
    onStart,
    dueCount,
    cards = [],
    initialTag,
    initialChapters,
}) => {
    const [mode, setMode] = useState<SessionMode>('full');
    const [count, setCount] = useState(10);
    const [selectedTag, setSelectedTag] = useState<string>(initialTag || '');
    const [selectedChapters, setSelectedChapters] = useState<string[]>(initialChapters || []);
    const [isChaptersExpanded, setIsChaptersExpanded] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setIsChaptersExpanded(false);
            if (initialTag) {
                const parsed = parseTagHierarchy(initialTag);
                if (parsed.folder === 'Books' && parsed.bookTitle) {
                    setSelectedTag(formatBookTag(parsed.bookTitle));
                    if (initialChapters && initialChapters.length > 0) {
                        setSelectedChapters(initialChapters);
                    } else if (parsed.chapter) {
                        setSelectedChapters([parsed.chapter]);
                    } else {
                        setSelectedChapters([]);
                    }
                    return;
                }
            }
            setSelectedTag(initialTag || '');
            setSelectedChapters(initialChapters || []);
        }
    }, [isOpen, initialTag, initialChapters]);

    const dueCards = useMemo(() => getDueCards(cards), [cards]);
    const dueCardIds = useMemo(() => new Set(dueCards.map(c => c.id)), [dueCards]);

    const availableTags = useMemo(() => {
        const tagCardSets = new Map<string, Set<string>>();
        for (const card of dueCards) {
            for (const rawTag of card.tags || []) {
                const t = rawTag.trim();
                if (!t) continue;
                const parsed = parseTagHierarchy(t);
                const canonicalTag =
                    parsed.folder === 'Books' && parsed.bookTitle
                        ? formatBookTag(parsed.bookTitle)
                        : t;
                if (!tagCardSets.has(canonicalTag)) {
                    tagCardSets.set(canonicalTag, new Set());
                }
                tagCardSets.get(canonicalTag)!.add(card.id);
            }
        }
        return Array.from(tagCardSets.entries())
            .map(([tag, set]) => [tag, set.size] as [string, number])
            .sort((a, b) => a[0].localeCompare(b[0]));
    }, [dueCards]);

    const selectedBookTitle = useMemo(() => {
        if (!selectedTag) return null;
        const parsed = parseTagHierarchy(selectedTag);
        return parsed.folder === 'Books' && parsed.bookTitle ? parsed.bookTitle : null;
    }, [selectedTag]);

    const availableChaptersForSelectedBook = useMemo(() => {
        if (!selectedBookTitle) return [];
        const chapterMap = new Map<string, { dueCount: number; totalCount: number }>();
        for (const card of cards) {
            const info = getCardBookInfoForBook(card, selectedBookTitle);
            if (!info) continue;
            if (!info.chapter) continue;
            const entry = chapterMap.get(info.chapter) || { dueCount: 0, totalCount: 0 };
            entry.totalCount += 1;
            if (dueCardIds.has(card.id)) {
                entry.dueCount += 1;
            }
            chapterMap.set(info.chapter, entry);
        }
        return Array.from(chapterMap.entries())
            .map(([chapter, counts]) => ({ chapter, ...counts }))
            .sort((a, b) => compareChapterNames(a.chapter, b.chapter));
    }, [selectedBookTitle, cards, dueCardIds]);

    const toggleChapterSelection = (chapter: string) => {
        setSelectedChapters(prev =>
            prev.includes(chapter) ? prev.filter(ch => ch !== chapter) : [...prev, chapter]
        );
    };

    const effectiveDueCount = useMemo(() => {
        if (!selectedTag) return dueCount;
        if (selectedBookTitle) {
            return dueCards.filter(c => {
                const info = getCardBookInfoForBook(c, selectedBookTitle);
                if (!info) return false;
                if (selectedChapters.length > 0) {
                    return Boolean(info.chapter && selectedChapters.includes(info.chapter));
                }
                return true;
            }).length;
        }
        return dueCards.filter(c => c.tags?.some(t => t.trim() === selectedTag)).length;
    }, [selectedTag, selectedBookTitle, selectedChapters, dueCount, dueCards]);

    if (!isOpen) return null;

    const handleStart = () => {
        onStart({
            mode,
            count: mode === 'short' || mode === 'quiz' ? Math.min(count, effectiveDueCount) : undefined,
            tag: selectedTag || undefined,
            chapters: selectedBookTitle && selectedChapters.length > 0 ? selectedChapters : undefined,
        });
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center modal-safe-overlay">
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
            />
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                transition={{ duration: 0.2 }}
                className="relative w-full max-w-md modal-safe-panel flex flex-col bg-white dark:bg-slate-800 rounded-2xl sm:rounded-3xl shadow-2xl overflow-hidden border border-slate-100 dark:border-slate-700"
            >
                {/* Header */}
                <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between bg-slate-50 dark:bg-slate-800/50 shrink-0">
                    <h2 className="text-lg sm:text-xl font-serif font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <BrainCircuit className="h-5 w-5 text-brand-500" />
                        Study Session
                    </h2>
                    <button
                        onClick={onClose}
                        className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full transition-colors"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-4 sm:p-6 space-y-4 sm:space-y-5 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                    {availableTags.length > 0 && (
                        <div className="space-y-2">
                            <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                <Tag className="h-3.5 w-3.5" />
                                Collection / Tag Filter
                            </label>
                            <select
                                aria-label="Study tag filter"
                                value={selectedTag}
                                onChange={(e) => {
                                    setSelectedTag(e.target.value);
                                    setSelectedChapters([]);
                                    setIsChaptersExpanded(false);
                                }}
                                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-800 dark:text-slate-100 focus:outline-none focus:border-brand-500"
                            >
                                <option value="">All Due Cards ({dueCount})</option>
                                {availableTags.map(([tag, tagDueCount]) => {
                                    const parsed = parseTagHierarchy(tag);
                                    return (
                                        <option key={tag} value={tag}>
                                            {parsed.breadcrumbLabel} ({tagDueCount} due)
                                        </option>
                                    );
                                })}
                            </select>
                        </div>
                    )}

                    {selectedBookTitle && availableChaptersForSelectedBook.length > 0 && (() => {
                        const hasManyChapters = availableChaptersForSelectedBook.length > COLLAPSED_SESSION_CHAPTER_LIMIT;
                        const visibleChapters =
                            hasManyChapters && !isChaptersExpanded
                                ? (() => {
                                      const sliced = availableChaptersForSelectedBook.slice(0, COLLAPSED_SESSION_CHAPTER_LIMIT);
                                      const extraSelected = availableChaptersForSelectedBook.filter(
                                          (ch, idx) =>
                                              idx >= COLLAPSED_SESSION_CHAPTER_LIMIT &&
                                              selectedChapters.includes(ch.chapter)
                                      );
                                      return [...sliced, ...extraSelected];
                                  })()
                                : availableChaptersForSelectedBook;
                        const hiddenCount = Math.max(0, availableChaptersForSelectedBook.length - visibleChapters.length);

                        return (
                            <div
                                data-testid="session-chapter-selector"
                                className="space-y-2.5 p-3.5 rounded-2xl bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/70 dark:border-amber-800/50"
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-300">
                                        <BookOpen className="h-3.5 w-3.5" />
                                        Chapters / Page Sections ({availableChaptersForSelectedBook.length})
                                    </label>
                                    <span className="text-[11px] font-medium text-amber-700/80 dark:text-amber-400/80">
                                        {selectedChapters.length === 0
                                            ? 'All chapters selected'
                                            : `${selectedChapters.length} selected`}
                                    </span>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    <button
                                        type="button"
                                        data-testid="session-chapter-option-all"
                                        onClick={() => setSelectedChapters([])}
                                        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                                            selectedChapters.length === 0
                                                ? 'bg-amber-600 text-white shadow-sm'
                                                : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-amber-200 dark:border-slate-700 hover:border-amber-400'
                                        }`}
                                    >
                                        All Chapters
                                    </button>
                                    {visibleChapters.map(ch => {
                                        const isSelected = selectedChapters.includes(ch.chapter);
                                        return (
                                            <button
                                                key={ch.chapter}
                                                type="button"
                                                data-testid="session-chapter-option"
                                                onClick={() => toggleChapterSelection(ch.chapter)}
                                                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                                                    isSelected
                                                        ? 'bg-amber-600 text-white shadow-sm'
                                                        : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-amber-200 dark:border-slate-700 hover:border-amber-400'
                                                }`}
                                            >
                                                {isSelected && <Check className="h-3 w-3" />}
                                                <span>{ch.chapter}</span>
                                                <span
                                                    className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                                                        isSelected
                                                            ? 'bg-amber-700/60 text-amber-50'
                                                            : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                                                    }`}
                                                >
                                                    {ch.dueCount} due
                                                </span>
                                            </button>
                                        );
                                    })}
                                    {hasManyChapters && (
                                        <button
                                            type="button"
                                            data-testid="session-chapters-expand-button"
                                            onClick={() => setIsChaptersExpanded(prev => !prev)}
                                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-amber-100/80 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-700 hover:bg-amber-200/80 transition-colors"
                                        >
                                            {isChaptersExpanded ? (
                                                <>
                                                    <span>Show fewer sections</span>
                                                    <ChevronUp className="h-3.5 w-3.5" />
                                                </>
                                            ) : (
                                                <>
                                                    <span>+{hiddenCount} more sections</span>
                                                    <ChevronDown className="h-3.5 w-3.5" />
                                                </>
                                            )}
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })()}

                    <div className="space-y-4">

                        {/* Full Session Option */}
                        <label
                            className={`block relative p-4 rounded-2xl border-2 cursor-pointer transition-all ${mode === 'full'
                                ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20'
                                : 'border-slate-200 dark:border-slate-700 hover:border-brand-300 dark:hover:border-brand-700'
                                }`}
                        >
                            <input
                                type="radio"
                                name="session_mode"
                                value="full"
                                checked={mode === 'full'}
                                onChange={() => setMode('full')}
                                className="sr-only"
                            />
                            <div className="flex items-start gap-4">
                                <div className={`mt-0.5 p-2 rounded-xl shrink-0 ${mode === 'full' ? 'bg-brand-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
                                    }`}>
                                    <Play className="h-5 w-5" />
                                </div>
                                <div>
                                    <h3 className={`font-semibold text-lg ${mode === 'full' ? 'text-brand-900 dark:text-brand-100' : 'text-slate-700 dark:text-slate-300'
                                        }`}>
                                        Full Session
                                    </h3>
                                    <p className={`text-sm mt-1 ${mode === 'full' ? 'text-brand-700 dark:text-brand-300/70' : 'text-slate-500'
                                        }`}>
                                        Review all {effectiveDueCount} cards that are due today{selectedTag ? ` in ${parseTagHierarchy(selectedTag).breadcrumbLabel}` : ''}. Best for keeping up with your daily goal.
                                    </p>
                                </div>
                            </div>
                        </label>

                        {/* Short Session Option */}
                        <label
                            className={`block relative p-4 rounded-2xl border-2 cursor-pointer transition-all ${mode === 'short'
                                ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20'
                                : 'border-slate-200 dark:border-slate-700 hover:border-amber-300 dark:hover:border-amber-700'
                                }`}
                        >
                            <input
                                type="radio"
                                name="session_mode"
                                value="short"
                                checked={mode === 'short'}
                                onChange={() => setMode('short')}
                                className="sr-only"
                            />
                            <div className="flex items-start gap-4">
                                <div className={`mt-0.5 p-2 rounded-xl shrink-0 ${mode === 'short' ? 'bg-amber-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
                                    }`}>
                                    <Zap className="h-5 w-5" />
                                </div>
                                <div className="flex-1">
                                    <h3 className={`font-semibold text-lg ${mode === 'short' ? 'text-amber-900 dark:text-amber-100' : 'text-slate-700 dark:text-slate-300'
                                        }`}>
                                        Short Burst
                                    </h3>
                                    <p className={`text-sm mt-1 mb-3 ${mode === 'short' ? 'text-amber-700 dark:text-amber-300/70' : 'text-slate-500'
                                        }`}>
                                        A quick session prioritizing new words. Perfect for when you're short on time.
                                    </p>

                                    {/* Count selector - only visible when short mode is selected */}
                                    <AnimatePresence>
                                        {mode === 'short' && (
                                            <motion.div
                                                initial={{ opacity: 0, height: 0 }}
                                                animate={{ opacity: 1, height: 'auto' }}
                                                exit={{ opacity: 0, height: 0 }}
                                                className="overflow-hidden"
                                            >
                                                <div className="flex items-center gap-3 bg-white dark:bg-slate-800 p-2 rounded-xl border border-amber-200 dark:border-amber-800/50" onClick={e => e.stopPropagation()}>
                                                    <span className="text-sm font-medium text-slate-600 dark:text-slate-400 ml-2">Cards:</span>
                                                    <input
                                                        type="range"
                                                        min="5"
                                                        max={Math.max(10, Math.ceil(effectiveDueCount / 5) * 5)}
                                                        step="5"
                                                        value={count}
                                                        onChange={(e) => setCount(Number(e.target.value))}
                                                        className="flex-1 accent-amber-500"
                                                    />
                                                    <span className="text-sm font-bold text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/50 px-3 py-1 rounded-lg w-12 text-center">
                                                        {Math.min(count, effectiveDueCount)}
                                                    </span>
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            </div>
                        </label>

                        {/* Multiple-Choice Quiz Option */}
                        <label
                            className={`block relative p-4 rounded-2xl border-2 cursor-pointer transition-all ${mode === 'quiz'
                                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
                                : 'border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-700'
                                }`}
                        >
                            <input
                                type="radio"
                                name="session_mode"
                                value="quiz"
                                checked={mode === 'quiz'}
                                onChange={() => setMode('quiz')}
                                className="sr-only"
                            />
                            <div className="flex items-start gap-4">
                                <div className={`mt-0.5 p-2 rounded-xl shrink-0 ${mode === 'quiz' ? 'bg-indigo-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
                                    }`}>
                                    <ListChecks className="h-5 w-5" />
                                </div>
                                <div className="flex-1">
                                    <h3 className={`font-semibold text-lg ${mode === 'quiz' ? 'text-indigo-900 dark:text-indigo-100' : 'text-slate-700 dark:text-slate-300'
                                        }`}>
                                        Multiple-Choice Quiz
                                    </h3>
                                    <p className={`text-sm mt-1 mb-3 ${mode === 'quiz' ? 'text-indigo-700 dark:text-indigo-300/70' : 'text-slate-500'
                                        }`}>
                                        Rapid-fire 4-option quiz using definitions from your deck. Great for active recall testing.
                                    </p>

                                    <AnimatePresence>
                                        {mode === 'quiz' && (
                                            <motion.div
                                                initial={{ opacity: 0, height: 0 }}
                                                animate={{ opacity: 1, height: 'auto' }}
                                                exit={{ opacity: 0, height: 0 }}
                                                className="overflow-hidden"
                                            >
                                                <div className="flex items-center gap-3 bg-white dark:bg-slate-800 p-2 rounded-xl border border-indigo-200 dark:border-indigo-800/50" onClick={e => e.stopPropagation()}>
                                                    <span className="text-sm font-medium text-slate-600 dark:text-slate-400 ml-2">Questions:</span>
                                                    <input
                                                        type="range"
                                                        min="5"
                                                        max={Math.max(10, Math.ceil(effectiveDueCount / 5) * 5)}
                                                        step="5"
                                                        value={count}
                                                        onChange={(e) => setCount(Number(e.target.value))}
                                                        className="flex-1 accent-indigo-500"
                                                    />
                                                    <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-100 dark:bg-indigo-900/50 px-3 py-1 rounded-lg w-12 text-center">
                                                        {Math.min(count, effectiveDueCount)}
                                                    </span>
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            </div>
                        </label>

                    </div>
                </div>

                {/* Footer */}
                <div className="px-4 sm:px-6 py-4 sm:py-5 border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 flex justify-end gap-2.5 sm:gap-3 shrink-0">
                    <button
                        onClick={onClose}
                        className="px-4 sm:px-5 py-2 sm:py-2.5 text-sm sm:text-base text-slate-600 dark:text-slate-300 font-medium hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleStart}
                        className={`px-4 sm:px-6 py-2 sm:py-2.5 text-sm sm:text-base text-white font-medium rounded-xl shadow-lg transition-all active:scale-95 flex items-center gap-2 ${mode === 'full'
                            ? 'bg-brand-600 hover:bg-brand-700 shadow-brand-500/30'
                            : mode === 'short'
                                ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/30'
                                : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-500/30'
                            }`}
                    >
                        {mode === 'full' ? (
                            <Play className="h-4 w-4 fill-current shrink-0" />
                        ) : mode === 'short' ? (
                            <Zap className="h-4 w-4 fill-current shrink-0" />
                        ) : (
                            <ListChecks className="h-4 w-4 shrink-0" />
                        )}
                        Start {mode === 'full' ? 'Full Session' : mode === 'short' ? 'Short Session' : 'Quiz Session'}
                    </button>
                </div>
            </motion.div>
        </div>
    );
};
