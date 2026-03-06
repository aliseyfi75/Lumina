import React, { useState, useRef, useEffect } from 'react';
import { Flashcard, FlashcardStatus, ViewState } from '../types';
import { getWordSuggestions } from '../services/suggestionService';
import { motion } from 'framer-motion';
import {
    Search, Play, BookOpen, CheckCircle, Brain, Loader2,
    Flame, Layers, Sparkles, Clock, TrendingUp, Volume2,
    ArrowRight, Star, Calendar, X, RotateCw
} from 'lucide-react';

interface DashboardProps {
    cards: Flashcard[];
    studyHistory: Record<string, number>;
    longestStreak: number;
    onNavigate: (view: ViewState) => void;
    onQuickSearch: (word: string) => void;
}

// ------------------------------------------------------------------
// Helper: get a stable "Word of the Day" based on today's date
// ------------------------------------------------------------------
const getWordOfTheDay = (cards: Flashcard[]): Flashcard | null => {
    if (cards.length === 0) return null;

    // Priority: New > Learning > Mastered
    const pool =
        cards.filter(c => c.status === FlashcardStatus.New).length > 0
            ? cards.filter(c => c.status === FlashcardStatus.New)
            : cards.filter(c => c.status === FlashcardStatus.Learning).length > 0
                ? cards.filter(c => c.status === FlashcardStatus.Learning)
                : cards.filter(c => c.status === FlashcardStatus.Mastered);

    const today = new Date();
    const dayIndex =
        (today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate()) %
        pool.length;
    return pool[dayIndex];
};

// ------------------------------------------------------------------
// Helper: local date string YYYY-MM-DD
// ------------------------------------------------------------------
const toLocalDateStr = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

// ------------------------------------------------------------------
// Helper: current streak from study history
// ------------------------------------------------------------------
const getCurrentStreak = (history: Record<string, number>): number => {
    let streak = 0;
    let d = new Date();
    const todayStr = toLocalDateStr(d);

    if (!history[todayStr] || history[todayStr] === 0) {
        d.setDate(d.getDate() - 1);
        const ydStr = toLocalDateStr(d);
        if (!history[ydStr] || history[ydStr] === 0) return 0;
    }

    while (history[toLocalDateStr(d)] > 0) {
        streak++;
        d.setDate(d.getDate() - 1);
    }
    return streak;
};

// ------------------------------------------------------------------
// Status pill
// ------------------------------------------------------------------
const StatusPill: React.FC<{ status: FlashcardStatus }> = ({ status }) => {
    const styles =
        status === FlashcardStatus.New
            ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
            : status === FlashcardStatus.Learning
                ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
                : 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300';
    return (
        <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${styles}`}>
            {status}
        </span>
    );
};

// ------------------------------------------------------------------
// Main Dashboard Component
// ------------------------------------------------------------------
export const Dashboard: React.FC<DashboardProps> = ({
    cards,
    studyHistory,
    longestStreak,
    onNavigate,
    onQuickSearch,
}) => {
    const [query, setQuery] = useState('');
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [isSearching, setIsSearching] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const lastSearched = useRef<string>('');

    // Inline flashcard modal state
    const [selectedCard, setSelectedCard] = useState<Flashcard | null>(null);
    const [isFlipped, setIsFlipped] = useState(false);

    const openCard = (card: Flashcard) => {
        setSelectedCard(card);
        setIsFlipped(false);
    };
    const closeCard = () => setSelectedCard(null);

    // Word of the Day
    const wordOfTheDay = getWordOfTheDay(cards);

    // Study stats
    const now = Date.now();
    const dueCount = cards.filter(c => {
        if (c.status === FlashcardStatus.Mastered) return false;
        if (c.status === FlashcardStatus.New) return true;
        return (c.nextReviewDate ?? 0) <= now;
    }).length;

    const newCount = cards.filter(c => c.status === FlashcardStatus.New).length;
    const learningCount = cards.filter(c => c.status === FlashcardStatus.Learning).length;
    const masteredCount = cards.filter(c => c.status === FlashcardStatus.Mastered).length;
    const currentStreak = getCurrentStreak(studyHistory);
    const todayStr = toLocalDateStr(new Date());
    const studiedToday = studyHistory[todayStr] ?? 0;

    // Recently added (last 6)
    const recentCards = [...cards]
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 6);

    // ------------------------------------------------------------------
    // Autocomplete for search bar
    // ------------------------------------------------------------------
    useEffect(() => {
        const fetchSuggestions = async () => {
            const currentQuery = query.trim();
            if (currentQuery.length < 2 || currentQuery.toLowerCase() === lastSearched.current.toLowerCase()) {
                setSuggestions([]);
                setShowSuggestions(false);
                return;
            }
            const words = await getWordSuggestions(query);
            if (query.trim().toLowerCase() !== lastSearched.current.toLowerCase()) {
                setSuggestions(words);
                setShowSuggestions(words.length > 0);
            }
        };
        const t = setTimeout(fetchSuggestions, 300);
        return () => clearTimeout(t);
    }, [query]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
                setShowSuggestions(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        const q = query.trim();
        if (!q) return;
        lastSearched.current = q;
        setShowSuggestions(false);
        setIsSearching(true);
        await onQuickSearch(q);
        setIsSearching(false);
    };

    const handleSuggestionClick = async (word: string) => {
        lastSearched.current = word.trim();
        setQuery(word);
        setShowSuggestions(false);
        setIsSearching(true);
        await onQuickSearch(word);
        setIsSearching(false);
    };

    return (
        <>
            {/* ── Inline Flashcard Modal ─────────────────────────────────────── */}
            {selectedCard && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
                    onClick={closeCard}
                >
                    <div
                        className="relative w-full max-w-sm"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Close button */}
                        <button
                            onClick={closeCard}
                            className="absolute -top-4 -right-4 z-10 bg-white dark:bg-slate-700 rounded-full p-2 shadow-lg text-slate-500 dark:text-slate-300 hover:text-slate-800 dark:hover:text-white transition-colors"
                        >
                            <X className="h-4 w-4" />
                        </button>

                        {/* Flip card */}
                        <div
                            className="h-80 w-full perspective-1000 cursor-pointer"
                            onClick={() => setIsFlipped(f => !f)}
                        >
                            <motion.div
                                className="relative w-full h-full"
                                style={{ transformStyle: 'preserve-3d' }}
                                initial={false}
                                animate={{ rotateY: isFlipped ? 180 : 0 }}
                                transition={{ type: 'spring', stiffness: 260, damping: 20 }}
                            >
                                {/* Front */}
                                <div
                                    className="absolute inset-0 bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-6 flex flex-col items-center justify-center text-center"
                                    style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
                                >
                                    <div className="absolute top-4 right-4">
                                        <StatusPill status={selectedCard.status} />
                                    </div>
                                    <h3 className="text-3xl font-serif font-bold text-slate-900 dark:text-white mb-1">{selectedCard.word}</h3>
                                    {selectedCard.phonetic && (
                                        <p className="text-slate-400 text-sm font-serif italic">{selectedCard.phonetic}</p>
                                    )}
                                    {selectedCard.audio && (
                                        <button
                                            onClick={e => { e.stopPropagation(); new Audio(selectedCard.audio!).play(); }}
                                            className="mt-1 p-1 text-slate-400 hover:text-brand-500 rounded-full transition-colors"
                                        >
                                            <Volume2 className="h-4 w-4" />
                                        </button>
                                    )}
                                    <p className="text-slate-500 dark:text-slate-400 italic text-sm mt-1">{selectedCard.partOfSpeech}</p>
                                    <div className="absolute bottom-5 flex items-center gap-1.5 text-slate-300 dark:text-slate-600 text-xs font-medium uppercase tracking-wider">
                                        <RotateCw className="h-3.5 w-3.5" /> Tap to reveal
                                    </div>
                                </div>

                                {/* Back */}
                                <div
                                    className="absolute inset-0 bg-slate-900 rounded-2xl shadow-xl p-6 flex flex-col gap-3 overflow-hidden"
                                    style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
                                >
                                    {selectedCard.image && (
                                        <div className="h-24 rounded-xl overflow-hidden border border-slate-700 bg-slate-800 flex items-center justify-center shrink-0">
                                            <img src={selectedCard.image} alt={selectedCard.word} className="max-h-full object-contain" loading="lazy" />
                                        </div>
                                    )}
                                    <p className="text-slate-100 text-base leading-relaxed flex-1">{selectedCard.mainDefinition}</p>
                                    {selectedCard.example && (
                                        <p className="text-slate-400 text-sm italic border-t border-slate-700 pt-3">
                                            "{selectedCard.example}"
                                        </p>
                                    )}
                                </div>
                            </motion.div>
                        </div>
                    </div>
                </div>
            )}

            {
                <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-16">

                    {/* ── Hero / Search ───────────────────────────────────────────────── */}
                    <div className="relative rounded-3xl bg-gradient-to-br from-slate-900 via-brand-950 to-slate-900 dark:from-slate-700 dark:via-slate-800 dark:to-slate-700 dark:border dark:border-slate-600/50 p-8 md:p-12 text-white shadow-2xl shadow-brand-900/20 dark:shadow-slate-900/50">
                        {/* Decorative blobs */}
                        <div className="pointer-events-none absolute -top-20 -right-20 w-80 h-80 rounded-full bg-brand-500/10 blur-3xl" />
                        <div className="pointer-events-none absolute -bottom-16 -left-16 w-64 h-64 rounded-full bg-indigo-500/10 blur-3xl" />

                        <div className="relative space-y-6">
                            <div className="space-y-1">
                                <div className="flex items-center gap-2 text-brand-300 text-sm font-medium">
                                    <Sparkles className="h-4 w-4" />
                                    {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                                </div>
                                <h1 className="text-3xl md:text-4xl font-serif font-bold tracking-tight">
                                    Welcome back{studiedToday > 0 ? ' 🔥' : ' 👋'}
                                </h1>
                                <p className="text-slate-400 text-base">
                                    {dueCount > 0
                                        ? `You have ${dueCount} card${dueCount !== 1 ? 's' : ''} to review today.`
                                        : cards.length > 0
                                            ? 'You\'re all caught up! Great work.'
                                            : 'Search for words to start building your vocabulary.'}
                                </p>
                            </div>

                            {/* Search Bar */}
                            <div ref={wrapperRef} className="relative">
                                <form onSubmit={handleSearch} className="relative group">
                                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                                        <Search className="h-5 w-5 text-slate-400 group-focus-within:text-brand-400 transition-colors" />
                                    </div>
                                    <input
                                        type="text"
                                        value={query}
                                        onChange={e => setQuery(e.target.value)}
                                        onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Escape') {
                                                setShowSuggestions(false);
                                            }
                                        }}
                                        placeholder="Look up a word…"
                                        autoComplete="off"
                                        className="block w-full pl-11 pr-28 py-4 bg-white/10 backdrop-blur border border-white/20 rounded-2xl text-white text-lg placeholder:text-slate-500 focus:outline-none focus:border-brand-400 focus:ring-4 focus:ring-brand-400/20 transition-all"
                                    />
                                    <button
                                        type="submit"
                                        disabled={isSearching || !query.trim()}
                                        className="absolute right-2 top-2 bottom-2 bg-brand-500 hover:bg-brand-600 text-white px-5 rounded-xl font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                                    >
                                        {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}
                                    </button>
                                </form>

                                {/* Autocomplete Dropdown */}
                                {showSuggestions && suggestions.length > 0 && (
                                    <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-100 dark:border-slate-700 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150 z-30">
                                        <ul>
                                            {suggestions.map((word, i) => (
                                                <li
                                                    key={i}
                                                    onClick={() => handleSuggestionClick(word)}
                                                    className="px-4 py-3 flex items-center gap-3 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer text-slate-700 dark:text-slate-200 transition-colors border-b border-slate-50 dark:border-slate-700 last:border-none"
                                                >
                                                    <Search className="h-4 w-4 text-slate-300 dark:text-slate-500" />
                                                    <span className="font-medium">{word}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>

                            {/* Quick CTA */}
                            {dueCount > 0 && (
                                <button
                                    onClick={() => onNavigate('study')}
                                    className="inline-flex items-center gap-2.5 px-6 py-3 bg-brand-500 hover:bg-brand-600 text-white rounded-xl font-semibold shadow-lg shadow-brand-500/30 hover:scale-105 active:scale-95 transition-all"
                                >
                                    <Play className="h-4 w-4 fill-current" />
                                    Start Study Session
                                    <span className="bg-white/20 text-white text-xs px-2 py-0.5 rounded-full font-bold">
                                        {dueCount}
                                    </span>
                                </button>
                            )}
                        </div>
                    </div>

                    {/* ── Stats Grid ──────────────────────────────────────────────────── */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {[
                            {
                                label: 'Due Today',
                                value: dueCount,
                                icon: Calendar,
                                color: 'text-amber-600 dark:text-amber-400',
                                bg: 'bg-amber-50 dark:bg-amber-900/20 border-amber-100 dark:border-amber-800/40',
                                iconBg: 'bg-amber-100 dark:bg-amber-900/40',
                            },
                            {
                                label: 'Current Streak',
                                value: currentStreak,
                                suffix: currentStreak === 1 ? ' day' : ' days',
                                icon: Flame,
                                color: 'text-orange-600 dark:text-orange-400',
                                bg: 'bg-orange-50 dark:bg-orange-900/20 border-orange-100 dark:border-orange-800/40',
                                iconBg: 'bg-orange-100 dark:bg-orange-900/40',
                            },
                            {
                                label: 'Mastered',
                                value: masteredCount,
                                icon: CheckCircle,
                                color: 'text-emerald-600 dark:text-emerald-400',
                                bg: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-100 dark:border-emerald-800/40',
                                iconBg: 'bg-emerald-100 dark:bg-emerald-900/40',
                            },
                            {
                                label: 'Total Cards',
                                value: cards.length,
                                icon: Layers,
                                color: 'text-blue-600 dark:text-blue-400',
                                bg: 'bg-blue-50 dark:bg-blue-900/20 border-blue-100 dark:border-blue-800/40',
                                iconBg: 'bg-blue-100 dark:bg-blue-900/40',
                            },
                        ].map(({ label, value, suffix, icon: Icon, color, bg, iconBg }) => (
                            <div key={label} className={`p-5 rounded-2xl border ${bg} flex flex-col gap-3`}>
                                <div className={`w-10 h-10 ${iconBg} rounded-xl flex items-center justify-center`}>
                                    <Icon className={`h-5 w-5 ${color}`} />
                                </div>
                                <div>
                                    <p className="text-2xl font-bold text-slate-900 dark:text-white leading-none">
                                        {value}{suffix}
                                    </p>
                                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{label}</p>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* ── Two-column layout: Word of the Day + Progress ────────────────── */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                        {/* Word of the Day */}
                        <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm shadow-slate-100 dark:shadow-none overflow-hidden flex flex-col">
                            <div className="px-6 pt-6 pb-4 border-b border-slate-50 dark:border-slate-700 flex items-center gap-2">
                                <Star className="h-4 w-4 text-amber-500 fill-current" />
                                <h2 className="font-semibold text-slate-800 dark:text-slate-100 text-sm uppercase tracking-wider">Word of the Day</h2>
                            </div>

                            {wordOfTheDay ? (
                                <div className="p-6 flex flex-col flex-1 gap-4">
                                    <div className="flex items-start justify-between gap-4">
                                        <div>
                                            <h3 className="text-3xl font-serif font-bold text-slate-900 dark:text-white">{wordOfTheDay.word}</h3>
                                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                                                {wordOfTheDay.phonetic && (
                                                    <span className="text-slate-400 text-sm font-serif italic">{wordOfTheDay.phonetic}</span>
                                                )}
                                                {wordOfTheDay.audio && (
                                                    <button
                                                        onClick={() => new Audio(wordOfTheDay.audio!).play()}
                                                        className="p-1 text-slate-400 hover:text-brand-500 hover:bg-brand-50 dark:hover:bg-brand-900/30 rounded-full transition-colors"
                                                        title="Listen"
                                                    >
                                                        <Volume2 className="h-4 w-4" />
                                                    </button>
                                                )}
                                                <StatusPill status={wordOfTheDay.status} />
                                            </div>
                                            <p className="text-xs text-slate-400 mt-0.5 italic">{wordOfTheDay.partOfSpeech}</p>
                                        </div>
                                        {wordOfTheDay.image && (
                                            <div className="w-20 h-20 rounded-xl overflow-hidden border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 flex items-center justify-center shrink-0">
                                                <img
                                                    src={wordOfTheDay.image}
                                                    alt={wordOfTheDay.word}
                                                    className="w-full h-full object-cover"
                                                    loading="lazy"
                                                />
                                            </div>
                                        )}
                                    </div>

                                    <p className="text-slate-700 dark:text-slate-300 leading-relaxed text-sm flex-1">
                                        {wordOfTheDay.mainDefinition}
                                    </p>

                                    {wordOfTheDay.example && (
                                        <p className="text-slate-400 italic text-sm font-serif border-t border-slate-50 dark:border-slate-700 pt-3">
                                            "{wordOfTheDay.example}"
                                        </p>
                                    )}

                                    <button
                                        onClick={() => onNavigate('flashcards')}
                                        className="inline-flex items-center gap-2 text-brand-600 hover:text-brand-700 font-medium text-sm self-start group"
                                    >
                                        View in Flashcards
                                        <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
                                    </button>
                                </div>
                            ) : (
                                <div className="flex-1 flex flex-col items-center justify-center p-10 text-center gap-3">
                                    <BookOpen className="h-10 w-10 text-slate-200 dark:text-slate-700" />
                                    <p className="text-slate-400 text-sm">
                                        Add words to your deck to get a Word of the Day.
                                    </p>
                                    <button
                                        onClick={() => onNavigate('dictionary')}
                                        className="mt-1 text-sm text-brand-600 hover:underline font-medium"
                                    >
                                        Search the Dictionary →
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Progress Breakdown */}
                        <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm shadow-slate-100 dark:shadow-none overflow-hidden flex flex-col">
                            <div className="px-6 pt-6 pb-4 border-b border-slate-50 dark:border-slate-700 flex items-center gap-2">
                                <TrendingUp className="h-4 w-4 text-brand-500" />
                                <h2 className="font-semibold text-slate-800 dark:text-slate-100 text-sm uppercase tracking-wider">Progress</h2>
                            </div>

                            <div className="p-6 flex flex-col gap-4 flex-1">
                                {cards.length === 0 ? (
                                    <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
                                        <Brain className="h-10 w-10 text-slate-200 dark:text-slate-700" />
                                        <p className="text-slate-400 text-sm">Start adding cards to track progress.</p>
                                    </div>
                                ) : (
                                    <>
                                        {/* Progress bars */}
                                        {[
                                            { label: 'New', count: newCount, total: cards.length, color: 'bg-blue-400' },
                                            { label: 'Learning', count: learningCount, total: cards.length, color: 'bg-amber-400' },
                                            { label: 'Mastered', count: masteredCount, total: cards.length, color: 'bg-green-500' },
                                        ].map(({ label, count, total, color }) => (
                                            <div key={label} className="space-y-1.5">
                                                <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 font-medium">
                                                    <span>{label}</span>
                                                    <span className="text-slate-700 dark:text-slate-200 font-semibold">{count} <span className="text-slate-400 font-normal">/ {total}</span></span>
                                                </div>
                                                <div className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                                                    <div
                                                        className={`h-full ${color} rounded-full transition-all duration-700`}
                                                        style={{ width: total > 0 ? `${(count / total) * 100}%` : '0%' }}
                                                    />
                                                </div>
                                            </div>
                                        ))}

                                        {/* Streak info */}
                                        <div className="mt-2 pt-4 border-t border-slate-50 dark:border-slate-700 grid grid-cols-2 gap-4">
                                            <div className="text-center">
                                                <p className="text-2xl font-bold text-slate-900 dark:text-white">{currentStreak}</p>
                                                <p className="text-xs text-slate-400 mt-0.5 flex items-center justify-center gap-1">
                                                    <Flame className="h-3 w-3 text-orange-400" /> Current Streak
                                                </p>
                                            </div>
                                            <div className="text-center border-l border-slate-100 dark:border-slate-700">
                                                <p className="text-2xl font-bold text-slate-900 dark:text-white">{longestStreak}</p>
                                                <p className="text-xs text-slate-400 mt-0.5 flex items-center justify-center gap-1">
                                                    <Star className="h-3 w-3 text-amber-400" /> Longest Streak
                                                </p>
                                            </div>
                                        </div>

                                        <button
                                            onClick={() => onNavigate('statistics')}
                                            className="inline-flex items-center gap-2 text-brand-600 hover:text-brand-700 font-medium text-sm self-start group mt-auto"
                                        >
                                            View Statistics
                                            <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* ── Recently Added ──────────────────────────────────────────────── */}
                    {recentCards.length > 0 && (
                        <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm shadow-slate-100 dark:shadow-none overflow-hidden">
                            <div className="px-6 pt-6 pb-4 border-b border-slate-50 dark:border-slate-700 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Clock className="h-4 w-4 text-slate-400" />
                                    <h2 className="font-semibold text-slate-800 dark:text-slate-100 text-sm uppercase tracking-wider">Recently Added</h2>
                                </div>
                                <button
                                    onClick={() => onNavigate('flashcards')}
                                    className="text-sm text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1 group"
                                >
                                    View All
                                    <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
                                </button>
                            </div>

                            <div className="p-4 md:p-6">
                                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                                    {recentCards.map(card => (
                                        <button
                                            key={card.id}
                                            onClick={() => openCard(card)}
                                            className="group bg-slate-50 dark:bg-slate-900/50 hover:bg-brand-50 dark:hover:bg-brand-900/20 border border-slate-100 dark:border-slate-700 hover:border-brand-200 dark:hover:border-brand-700 rounded-2xl p-4 text-left transition-all hover:shadow-sm"
                                        >
                                            <p className="font-serif font-bold text-slate-900 dark:text-white text-base truncate group-hover:text-brand-700 dark:group-hover:text-brand-400 transition-colors">
                                                {card.word}
                                            </p>
                                            <p className="text-slate-400 text-xs italic truncate mt-0.5">{card.partOfSpeech}</p>
                                            <div className="mt-2">
                                                <StatusPill status={card.status} />
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            }
        </>
    );
};
