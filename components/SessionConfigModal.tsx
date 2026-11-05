import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Play, Zap, BrainCircuit, ListChecks, Tag } from 'lucide-react';
import { Flashcard } from '../types';
import { getDueCards } from '../utils/studyUtils';

export type SessionMode = 'full' | 'short' | 'quiz';

interface SessionConfigModalProps {
    isOpen: boolean;
    onClose: () => void;
    onStart: (config: { mode: SessionMode; count?: number; tag?: string }) => void;
    dueCount: number;
    cards?: Flashcard[];
}

export const SessionConfigModal: React.FC<SessionConfigModalProps> = ({
    isOpen,
    onClose,
    onStart,
    dueCount,
    cards = [],
}) => {
    const [mode, setMode] = useState<SessionMode>('full');
    const [count, setCount] = useState(10);
    const [selectedTag, setSelectedTag] = useState<string>('');

    const dueCards = useMemo(() => getDueCards(cards), [cards]);

    const availableTags = useMemo(() => {
        const tagMap = new Map<string, number>();
        for (const card of dueCards) {
            for (const rawTag of card.tags || []) {
                const t = rawTag.trim();
                if (t) tagMap.set(t, (tagMap.get(t) || 0) + 1);
            }
        }
        return Array.from(tagMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    }, [dueCards]);

    const effectiveDueCount = useMemo(() => {
        if (!selectedTag) return dueCount;
        return dueCards.filter(c => c.tags?.some(t => t.trim() === selectedTag)).length;
    }, [selectedTag, dueCount, dueCards]);

    if (!isOpen) return null;

    const handleStart = () => {
        onStart({
            mode,
            count: mode === 'short' || mode === 'quiz' ? Math.min(count, effectiveDueCount) : undefined,
            tag: selectedTag || undefined,
        });
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
            />
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                transition={{ duration: 0.2 }}
                className="relative w-full max-w-md bg-white dark:bg-slate-800 rounded-3xl shadow-2xl overflow-hidden border border-slate-100 dark:border-slate-700"
            >
                {/* Header */}
                <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between bg-slate-50 dark:bg-slate-800/50">
                    <h2 className="text-xl font-serif font-bold text-slate-900 dark:text-white flex items-center gap-2">
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
                <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto custom-scrollbar">
                    {availableTags.length > 0 && (
                        <div className="space-y-2">
                            <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                <Tag className="h-3.5 w-3.5" />
                                Collection / Tag Filter
                            </label>
                            <select
                                aria-label="Study tag filter"
                                value={selectedTag}
                                onChange={(e) => setSelectedTag(e.target.value)}
                                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-800 dark:text-slate-100 focus:outline-none focus:border-brand-500"
                            >
                                <option value="">All Due Cards ({dueCount})</option>
                                {availableTags.map(([tag, tagDueCount]) => (
                                    <option key={tag} value={tag}>
                                        #{tag} ({tagDueCount} due)
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

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
                                        Review all {effectiveDueCount} cards that are due today{selectedTag ? ` in #${selectedTag}` : ''}. Best for keeping up with your daily goal.
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
                <div className="px-6 py-5 border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-5 py-2.5 text-slate-600 dark:text-slate-300 font-medium hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleStart}
                        className={`px-6 py-2.5 text-white font-medium rounded-xl shadow-lg transition-all active:scale-95 flex items-center gap-2 ${mode === 'full'
                            ? 'bg-brand-600 hover:bg-brand-700 shadow-brand-500/30'
                            : mode === 'short'
                                ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/30'
                                : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-500/30'
                            }`}
                    >
                        {mode === 'full' ? (
                            <Play className="h-4 w-4 fill-current" />
                        ) : mode === 'short' ? (
                            <Zap className="h-4 w-4 fill-current" />
                        ) : (
                            <ListChecks className="h-4 w-4" />
                        )}
                        Start {mode === 'full' ? 'Full Session' : mode === 'short' ? 'Short Session' : 'Quiz Session'}
                    </button>
                </div>
            </motion.div>
        </div>
    );
};
