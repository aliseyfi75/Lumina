import React, { useState, useRef, useEffect, useMemo, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { Flashcard, FlashcardStatus, MeaningLanguagePreference, ViewState } from '../types';
import { getWordSuggestions } from '../services/suggestionService';
import { prefetchWord } from '../services/dictionaryService';
import { playAudio } from '../utils/audio';
import { getLocalDateString, calculateStreakSummary, getDueCards, sortStudySessionCards } from '../utils/studyUtils';
import type { BookExtractedWord } from '../services/bookService';
import { MeaningDisplay } from './MeaningDisplay';

const BookPrepModal = lazy(() =>
    import('./BookPrepModal').then((m) => ({ default: m.BookPrepModal }))
);
import { parseTagHierarchy, formatBookTag } from '../utils/tagUtils';
import { useCardFlip3D } from '../utils/cardFlip';
import { getAdaptiveWordHeadingClass } from '../utils/deviceScale';
import { useAccessibleModal } from '../hooks/useAccessibleModal';
import { motion } from 'framer-motion';
import {
    Search, Play, BookOpen, CheckCircle, Brain, Loader2,
    Flame, Layers, Sparkles, Clock, TrendingUp, Volume2,
    ArrowRight, Star, Calendar, X, RotateCw, Tag, Plus, Trash2, AlertTriangle,
    Database, Globe, Snowflake, Zap
} from 'lucide-react';

interface DashboardProps {
    cards: Flashcard[];
    studyHistory: Record<string, number>;
    longestStreak: number;
    dailyGoal?: number;
    onNavigate: (view: ViewState) => void;
    onQuickSearch: (word: string) => void;
    onStartStudy?: (initialTag?: string, initialChapters?: string[]) => void;
    onImportBookWords?: (bookTitle: string, words: BookExtractedWord[]) => void;
    onDeleteBook?: (bookTag: string) => void;
    onOpenDataModal?: () => void;
    onOpenSettings?: () => void;
    onChangeLanguagePreference?: (pref: MeaningLanguagePreference) => void;
    onQuickReviewCard?: (id: string, quality: number) => void;
    languagePreference?: MeaningLanguagePreference;
}

interface CategoryProgressItem {
    id: string;
    name: string;
    rawTag?: string;
    kind: 'book' | 'tag' | 'general';
    total: number;
    newCount: number;
    learningCount: number;
    masteredCount: number;
    dueCount: number;
    progressPct: number;
    statusLabel: 'Completed' | 'In Progress' | 'Not Started';
    latestCreatedAt: number;
}

const buildCategoryProgress = (cards: Flashcard[]): CategoryProgressItem[] => {
    if (cards.length === 0) return [];

    const buckets = new Map<
        string,
        {
            name: string;
            rawTag?: string;
            kind: 'book' | 'tag' | 'general';
            cards: Flashcard[];
        }
    >();

    const untaggedCards: Flashcard[] = [];

    for (const card of cards) {
        const validTags = (card.tags ?? []).map(t => t.trim()).filter(Boolean);
        if (validTags.length === 0) {
            untaggedCards.push(card);
            continue;
        }

        const seenBucketKeysForCard = new Set<string>();
        for (const rawTag of validTags) {
            const parsed = parseTagHierarchy(rawTag);
            const isBook = parsed.isBook;
            const cleanName = isBook
                ? (parsed.bookTitle || parsed.name)
                : rawTag;
            const canonicalTag = isBook ? formatBookTag(cleanName) : rawTag;
            const key = isBook ? `book:${cleanName.toLowerCase()}` : `tag:${cleanName.toLowerCase()}`;
            if (seenBucketKeysForCard.has(key)) continue;
            seenBucketKeysForCard.add(key);

            const existing = buckets.get(key);
            if (!existing) {
                buckets.set(key, {
                    name: cleanName,
                    rawTag: canonicalTag,
                    kind: isBook ? 'book' : 'tag',
                    cards: [card],
                });
            } else {
                existing.cards.push(card);
            }
        }
    }

    if (untaggedCards.length > 0) {
        if (buckets.size > 0) {
            // Group untagged cards into "General Vocabulary" alongside Book & Tag categories
            buckets.set('general:vocabulary', {
                name: 'General Vocabulary',
                rawTag: undefined,
                kind: 'general',
                cards: untaggedCards,
            });
        } else {
            // If user has no Book or Tag categories yet, group by Part of Speech (or General Vocabulary)
            const posBuckets = new Map<string, Flashcard[]>();
            for (const c of untaggedCards) {
                const rawPos = (c.partOfSpeech || 'General').trim().toLowerCase();
                const label =
                    rawPos === 'noun' ? 'Nouns' :
                    rawPos === 'verb' ? 'Verbs' :
                    rawPos === 'adjective' ? 'Adjectives' :
                    rawPos === 'adverb' ? 'Adverbs' :
                    'General Vocabulary';
                const list = posBuckets.get(label) || [];
                list.push(c);
                posBuckets.set(label, list);
            }
            for (const [label, list] of posBuckets.entries()) {
                buckets.set(`general:${label.toLowerCase()}`, {
                    name: label,
                    rawTag: undefined,
                    kind: 'general',
                    cards: list,
                });
            }
        }
    }

    const items: CategoryProgressItem[] = [];
    for (const [id, bucket] of buckets.entries()) {
        const total = bucket.cards.length;
        if (total === 0) continue;
        const newCount = bucket.cards.filter(c => c.status === FlashcardStatus.New).length;
        const learningCount = bucket.cards.filter(c => c.status === FlashcardStatus.Learning).length;
        const masteredCount = bucket.cards.filter(c => c.status === FlashcardStatus.Mastered).length;
        const dueCount = getDueCards(bucket.cards).length;
        const progressPct = Math.round(((masteredCount + learningCount * 0.5) / total) * 100);
        const statusLabel: CategoryProgressItem['statusLabel'] =
            masteredCount === total
                ? 'Completed'
                : masteredCount > 0 || learningCount > 0
                    ? 'In Progress'
                    : 'Not Started';
        const latestCreatedAt = bucket.cards.reduce((max, c) => Math.max(max, c.createdAt || 0), 0);

        items.push({
            id,
            name: bucket.name,
            rawTag: bucket.rawTag,
            kind: bucket.kind,
            total,
            newCount,
            learningCount,
            masteredCount,
            dueCount,
            progressPct,
            statusLabel,
            latestCreatedAt,
        });
    }

    const kindPriority: Record<CategoryProgressItem['kind'], number> = {
        book: 0, // Books always have top priority
        tag: 1,
        general: 2,
    };

    return items.sort((a, b) => {
        if (kindPriority[a.kind] !== kindPriority[b.kind]) {
            return kindPriority[a.kind] - kindPriority[b.kind];
        }
        if (a.kind === 'book') {
            return b.latestCreatedAt - a.latestCreatedAt || b.dueCount - a.dueCount;
        }
        return b.dueCount - a.dueCount || b.total - a.total;
    });
};

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
    dailyGoal = 10,
    onNavigate,
    onQuickSearch,
    onStartStudy,
    onImportBookWords,
    onDeleteBook,
    onOpenDataModal,
    onOpenSettings,
    onChangeLanguagePreference,
    onQuickReviewCard,
    languagePreference = 'en',
}) => {
    const routerNavigate = useNavigate();
    const [query, setQuery] = useState('');
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [isSearching, setIsSearching] = useState(false);
    const [isBookPrepOpen, setIsBookPrepOpen] = useState(false);
    const [bookToDelete, setBookToDelete] = useState<{ tag: string; title: string; count: number } | null>(null);
    const [warmupRevealed, setWarmupRevealed] = useState(false);
    const [warmupCompletedCount, setWarmupCompletedCount] = useState(0);
    const [warmupSkippedIds, setWarmupSkippedIds] = useState<string[]>([]);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const cardPreviewModalRef = useRef<HTMLDivElement>(null);
    const deleteBookModalRef = useRef<HTMLDivElement>(null);
    const lastSearched = useRef<string>('');

    const categoryProgressItems = useMemo(() => buildCategoryProgress(cards), [cards]);
    const existingWordsSet = useMemo(
        () => new Set(cards.map(c => c.word.trim().toLowerCase())),
        [cards]
    );

    // Inline flashcard modal state
    const [selectedCard, setSelectedCard] = useState<Flashcard | null>(null);
    const [isFlipped, setIsFlipped] = useState(false);
    const {
        flipRotateY,
        frontVisibility,
        frontOpacity,
        backVisibility,
        backOpacity,
        flipContainerStyle,
        frontPlaneStyle,
        backPlaneStyle,
        resetFlipInstant,
    } = useCardFlip3D(isFlipped);

    const openCard = (card: Flashcard) => {
        resetFlipInstant(false);
        setSelectedCard(card);
        setIsFlipped(false);
    };
    const closeCard = () => setSelectedCard(null);

    useAccessibleModal(Boolean(selectedCard), closeCard, cardPreviewModalRef);
    useAccessibleModal(Boolean(bookToDelete), () => setBookToDelete(null), deleteBookModalRef);

    // Word of the Day
    const wordOfTheDay = getWordOfTheDay(cards);

    // Study stats
    const dueCardsList = useMemo(() => sortStudySessionCards(getDueCards(cards)), [cards]);
    const dueCount = dueCardsList.length;

    const newCount = cards.filter(c => c.status === FlashcardStatus.New).length;
    const learningCount = cards.filter(c => c.status === FlashcardStatus.Learning).length;
    const masteredCount = cards.filter(c => c.status === FlashcardStatus.Mastered).length;
    const streakSummary = useMemo(() => calculateStreakSummary(studyHistory), [studyHistory]);
    const currentStreak = streakSummary.currentStreak;
    const todayStr = getLocalDateString(new Date());
    const studiedToday = studyHistory[todayStr] ?? 0;
    const goalProgressPct = Math.min(100, Math.round((studiedToday / Math.max(1, dailyGoal)) * 100));
    const isGoalComplete = studiedToday >= dailyGoal;
    const isNewUser =
        cards.length === 0 || (cards.length === 1 && cards[0].id === 'welcome-card');

    const warmupCard = useMemo(() => {
        if (dueCardsList.length === 0) return null;
        return dueCardsList.find(c => !warmupSkippedIds.includes(c.id)) || dueCardsList[0];
    }, [dueCardsList, warmupSkippedIds]);

    // Recently added (last 6)
    const recentCards = [...cards]
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 6);

    // ------------------------------------------------------------------
    // Autocomplete for search bar
    // ------------------------------------------------------------------
    useEffect(() => {
        let isActive = true;
        const fetchSuggestions = async () => {
            const currentQuery = query.trim();
            if (currentQuery.length < 2 || currentQuery.toLowerCase() === lastSearched.current.toLowerCase()) {
                if (isActive) {
                    setSuggestions([]);
                    setShowSuggestions(false);
                }
                return;
            }
            const words = await getWordSuggestions(currentQuery);
            if (isActive && query.trim().toLowerCase() !== lastSearched.current.toLowerCase()) {
                setSuggestions(words);
                setShowSuggestions(words.length > 0);
                if (words.length > 0) {
                    prefetchWord(words[0]);
                    const exact = words.find(w => w.toLowerCase() === currentQuery.toLowerCase());
                    if (exact && exact !== words[0]) {
                        prefetchWord(exact);
                    }
                }
            }
        };
        const t = setTimeout(fetchSuggestions, 200);
        return () => {
            isActive = false;
            clearTimeout(t);
        };
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
                        ref={cardPreviewModalRef}
                        role="dialog"
                        aria-modal="true"
                        aria-label={`Flashcard preview for ${selectedCard.word}`}
                        className="relative w-full max-w-sm"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Close button */}
                        <button
                            type="button"
                            onClick={closeCard}
                            aria-label="Close card preview"
                            className="absolute -top-3 -right-2 sm:-top-4 sm:-right-4 z-10 bg-white dark:bg-slate-700 rounded-full p-2 shadow-lg text-slate-500 dark:text-slate-300 hover:text-slate-800 dark:hover:text-white transition-colors"
                        >
                            <X className="h-4 w-4" />
                        </button>

                        {/* Flip card */}
                        <div
                            className="h-72 sm:h-80 w-full perspective-1000 cursor-pointer"
                            onClick={() => setIsFlipped(f => !f)}
                        >
                            <motion.div
                                className="relative w-full h-full preserve-3d"
                                style={{ ...flipContainerStyle, rotateY: flipRotateY }}
                            >
                                {/* Front */}
                                <div
                                    data-testid="dashboard-card-front"
                                    aria-hidden={isFlipped}
                                    className="absolute inset-0 backface-hidden"
                                    style={frontPlaneStyle}
                                >
                                    <motion.div
                                        style={{ opacity: frontOpacity, visibility: frontVisibility }}
                                        className="w-full h-full bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-5 sm:p-6 flex flex-col items-center justify-between text-center overflow-hidden"
                                    >
                                        <div className="w-full flex justify-end shrink-0">
                                            <StatusPill status={selectedCard.status} />
                                        </div>
                                        <div className="flex-1 flex flex-col items-center justify-center w-full px-1 min-h-0">
                                            <h3 className={`${getAdaptiveWordHeadingClass(selectedCard.word, 'card')} font-serif font-bold text-slate-900 dark:text-white mb-1 break-words max-w-full leading-tight`}>
                                                {selectedCard.word}
                                            </h3>
                                            {selectedCard.phonetic && (
                                                <p className="text-slate-500 dark:text-slate-400 text-sm font-serif italic truncate max-w-full">{selectedCard.phonetic}</p>
                                            )}
                                            <button
                                                type="button"
                                                aria-label={`Listen to pronunciation of ${selectedCard.word}`}
                                                onClick={e => { e.stopPropagation(); playAudio(selectedCard.word, selectedCard.audio); }}
                                                className="mt-1 p-1.5 text-slate-500 dark:text-slate-400 hover:text-brand-500 rounded-full transition-colors"
                                            >
                                                <Volume2 className="h-4 w-4" />
                                            </button>
                                            <p className="text-slate-500 dark:text-slate-400 italic text-sm mt-1">{selectedCard.partOfSpeech}</p>
                                        </div>
                                        <div className="shrink-0 flex items-center gap-1.5 text-slate-500 dark:text-slate-400 text-xs font-medium uppercase tracking-wider">
                                            <RotateCw className="h-3.5 w-3.5" /> Tap to reveal
                                        </div>
                                    </motion.div>
                                </div>

                                {/* Back */}
                                <div
                                    data-testid="dashboard-card-back"
                                    aria-hidden={!isFlipped}
                                    className="absolute inset-0 backface-hidden"
                                    style={backPlaneStyle}
                                >
                                    <motion.div
                                        style={{ opacity: backOpacity, visibility: backVisibility }}
                                        className="w-full h-full bg-slate-900 rounded-2xl shadow-xl p-5 sm:p-6 flex flex-col gap-3 overflow-hidden"
                                    >
                                        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar flex flex-col gap-3">
                                            {selectedCard.image && (
                                                <div className="h-24 rounded-xl overflow-hidden border border-slate-700 bg-slate-800 flex items-center justify-center shrink-0">
                                                    <img src={selectedCard.image} alt={selectedCard.word} className="max-h-full object-contain" loading="lazy" />
                                                </div>
                                            )}
                                            <div className="flex-1">
                                                <MeaningDisplay
                                                    englishText={selectedCard.mainDefinition}
                                                    translations={selectedCard.translations}
                                                    preference={languagePreference}
                                                    variant="darkCard"
                                                    testIdPrefix="dashboard-card"
                                                />
                                            </div>
                                            {selectedCard.example && (
                                                <p className="text-slate-300 text-xs sm:text-sm italic border-t border-slate-700 pt-3">
                                                    "{selectedCard.example}"
                                                </p>
                                            )}
                                        </div>
                                    </motion.div>
                                </div>
                            </motion.div>
                        </div>
                    </div>
                </div>
            )}

            {
                <div className="max-w-5xl mx-auto space-y-6 sm:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-12 sm:pb-16">

                    {/* ── Hero / Search ───────────────────────────────────────────────── */}
                    <div className="relative rounded-2xl sm:rounded-3xl bg-gradient-to-br from-slate-900 via-brand-950 to-slate-900 dark:from-slate-700 dark:via-slate-800 dark:to-slate-700 dark:border dark:border-slate-600/50 p-5 sm:p-8 md:p-12 text-white shadow-2xl shadow-brand-900/20 dark:shadow-slate-900/50">
                        {/* Decorative blobs clipped to hero rounded corners without clipping autocomplete dropdown */}
                        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl sm:rounded-3xl">
                            <div className="absolute -top-20 -right-20 w-80 h-80 rounded-full bg-brand-500/10 blur-3xl" />
                            <div className="absolute -bottom-16 -left-16 w-64 h-64 rounded-full bg-indigo-500/10 blur-3xl" />
                        </div>

                        <div className="relative space-y-4 sm:space-y-6">
                            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                                <div className="space-y-1 min-w-0">
                                    <div className="flex items-center gap-2 text-brand-300 text-xs sm:text-sm font-medium flex-wrap">
                                        <Sparkles className="h-4 w-4 shrink-0" />
                                        <span>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</span>
                                        {(streakSummary.freezeProtected || streakSummary.freezesAvailable > 0) && (
                                            <span
                                                data-testid="streak-freeze-badge"
                                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-sky-500/20 text-sky-200 border border-sky-400/30"
                                            >
                                                <Snowflake className="h-3 w-3 shrink-0" />
                                                {streakSummary.freezeProtected
                                                    ? 'Streak Freeze active'
                                                    : `${streakSummary.freezesAvailable} Freeze ready`}
                                            </span>
                                        )}
                                    </div>
                                    <h1 className="text-2xl sm:text-3xl md:text-4xl font-serif font-bold tracking-tight">
                                        {isNewUser ? 'Welcome to Lumina ✨' : `Welcome back${studiedToday > 0 ? ' 🔥' : ' 👋'}`}
                                    </h1>
                                    <p className="text-slate-300 text-sm sm:text-base">
                                        {isNewUser
                                            ? 'Build your personal vocabulary with smart spaced repetition, book prep, and bilingual meanings.'
                                            : dueCount > 0
                                                ? `You have ${dueCount} card${dueCount !== 1 ? 's' : ''} to review today.`
                                                : cards.length > 0
                                                    ? 'You\'re all caught up! Great work.'
                                                    : 'Search for words to start building your vocabulary.'}
                                    </p>
                                </div>

                                {/* Daily Goal Progress Ring */}
                                {!isNewUser && (
                                    <button
                                        type="button"
                                        data-testid="daily-goal-ring"
                                        onClick={() => onOpenSettings?.()}
                                        title="Click to adjust your daily study goal"
                                        aria-label={`Daily goal progress: ${studiedToday} of ${dailyGoal} cards reviewed today`}
                                        className="self-start sm:self-center flex items-center gap-3 px-3.5 py-2.5 rounded-2xl bg-white/10 hover:bg-white/15 border border-white/15 backdrop-blur transition-colors shrink-0 text-left"
                                    >
                                        <div className="relative w-12 h-12 shrink-0 flex items-center justify-center">
                                            <svg className="w-12 h-12 -rotate-90" viewBox="0 0 44 44" aria-hidden="true">
                                                <circle
                                                    cx="22"
                                                    cy="22"
                                                    r="18"
                                                    fill="none"
                                                    stroke="rgba(255,255,255,0.16)"
                                                    strokeWidth="4"
                                                />
                                                <circle
                                                    cx="22"
                                                    cy="22"
                                                    r="18"
                                                    fill="none"
                                                    stroke={isGoalComplete ? '#4ade80' : '#22c55e'}
                                                    strokeWidth="4"
                                                    strokeLinecap="round"
                                                    strokeDasharray={2 * Math.PI * 18}
                                                    strokeDashoffset={2 * Math.PI * 18 * (1 - goalProgressPct / 100)}
                                                    className="transition-all duration-500"
                                                />
                                            </svg>
                                            <span className="absolute text-xs font-bold text-white tabular-nums">
                                                {isGoalComplete ? '✓' : `${goalProgressPct}%`}
                                            </span>
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-[11px] font-bold uppercase tracking-wider text-brand-300">
                                                {isGoalComplete ? 'Goal Complete' : 'Daily Goal'}
                                            </p>
                                            <p className="text-sm font-bold text-white tabular-nums">
                                                {studiedToday} <span className="text-slate-300 font-normal">/ {dailyGoal} cards</span>
                                            </p>
                                        </div>
                                    </button>
                                )}
                            </div>

                            {/* Search Bar */}
                            <div ref={wrapperRef} className="relative">
                                <form onSubmit={handleSearch} className="relative group">
                                    <div className="absolute inset-y-0 left-0 pl-3.5 sm:pl-4 flex items-center pointer-events-none">
                                        <Search className="h-5 w-5 text-slate-300 group-focus-within:text-brand-400 transition-colors" />
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
                                        aria-label="Look up a word"
                                        autoComplete="off"
                                        className="block w-full pl-10 sm:pl-11 pr-24 sm:pr-28 py-3 sm:py-4 bg-white/10 backdrop-blur border border-white/20 rounded-2xl text-white text-base sm:text-lg placeholder:text-slate-300/80 focus:outline-none focus:border-brand-400 focus:ring-4 focus:ring-brand-400/20 transition-all"
                                    />
                                    <button
                                        type="submit"
                                        disabled={isSearching || !query.trim()}
                                        className="absolute right-1.5 sm:right-2 top-1.5 sm:top-2 bottom-1.5 sm:bottom-2 bg-brand-500 hover:bg-brand-600 text-white px-3.5 sm:px-5 rounded-xl text-sm sm:text-base font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
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
                                                    onMouseEnter={() => prefetchWord(word)}
                                                    onClick={() => handleSuggestionClick(word)}
                                                    className="px-4 py-3 flex items-center gap-3 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer text-slate-700 dark:text-slate-200 transition-colors border-b border-slate-50 dark:border-slate-700 last:border-none"
                                                >
                                                    <Search className="h-4 w-4 text-slate-400 dark:text-slate-500" />
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
                                    className="inline-flex items-center gap-2 sm:gap-2.5 px-4 sm:px-6 py-2.5 sm:py-3 bg-brand-500 hover:bg-brand-600 text-white rounded-xl text-sm sm:text-base font-semibold shadow-lg shadow-brand-500/30 hover:scale-105 active:scale-95 transition-all"
                                >
                                    <Play className="h-4 w-4 fill-current shrink-0" />
                                    Start Study Session
                                    <span className="bg-white/20 text-white text-xs px-2 py-0.5 rounded-full font-bold">
                                        {dueCount}
                                    </span>
                                </button>
                            )}
                        </div>
                    </div>

                    {/* ── First-Time Quick-Start Onboarding Card ──────────────────────── */}
                    {isNewUser && (
                        <div
                            data-testid="ftue-onboarding-card"
                            className="bg-white dark:bg-slate-800 rounded-2xl sm:rounded-3xl border border-brand-200/80 dark:border-brand-800/50 shadow-sm p-5 sm:p-6 space-y-5"
                        >
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <h2 className="text-base sm:text-lg font-serif font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                        <Sparkles className="h-4 w-4 text-brand-500" />
                                        Get Started in 30 Seconds
                                    </h2>
                                    <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                                        Choose your favorite way to build your deck — everything works offline and stays private.
                                    </p>
                                </div>
                                {onChangeLanguagePreference && (
                                    <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-900/60 p-1 rounded-xl border border-slate-200/70 dark:border-slate-700" role="group" aria-label="Meaning language">
                                        <Globe className="h-3.5 w-3.5 text-slate-400 ml-1.5" />
                                        {([
                                            { value: 'en', label: 'EN' },
                                            { value: 'both', label: 'EN + FA' },
                                            { value: 'fa', label: 'فارسی' },
                                        ] as const).map((opt) => (
                                            <button
                                                key={opt.value}
                                                type="button"
                                                onClick={() => onChangeLanguagePreference(opt.value)}
                                                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                                                    languagePreference === opt.value
                                                        ? 'bg-brand-600 text-white shadow-sm'
                                                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                                                }`}
                                            >
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <button
                                    type="button"
                                    onClick={() => onNavigate('dictionary')}
                                    className="group text-left p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/50 hover:bg-brand-50 dark:hover:bg-brand-900/20 border border-slate-200/80 dark:border-slate-700 hover:border-brand-300 dark:hover:border-brand-700 transition-all space-y-2"
                                >
                                    <div className="w-9 h-9 rounded-xl bg-brand-100 dark:bg-brand-900/40 text-brand-600 dark:text-brand-400 flex items-center justify-center">
                                        <Search className="h-4 w-4" />
                                    </div>
                                    <div>
                                        <p className="font-semibold text-sm text-slate-900 dark:text-white group-hover:text-brand-700 dark:group-hover:text-brand-300">
                                            Explore Dictionary
                                        </p>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                            Look up words or try curated GRE & literary packs.
                                        </p>
                                    </div>
                                </button>

                                {onImportBookWords && (
                                    <button
                                        type="button"
                                        onClick={() => setIsBookPrepOpen(true)}
                                        className="group text-left p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/50 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 border border-slate-200/80 dark:border-slate-700 hover:border-emerald-300 dark:hover:border-emerald-700 transition-all space-y-2"
                                    >
                                        <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                                            <BookOpen className="h-4 w-4" />
                                        </div>
                                        <div>
                                            <p className="font-semibold text-sm text-slate-900 dark:text-white group-hover:text-emerald-700 dark:group-hover:text-emerald-300">
                                                Prepare for a Book
                                            </p>
                                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                                Extract chapter vocabulary from classics or your .epub/.txt.
                                            </p>
                                        </div>
                                    </button>
                                )}

                                {onOpenDataModal && (
                                    <button
                                        type="button"
                                        onClick={onOpenDataModal}
                                        className="group text-left p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/50 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 border border-slate-200/80 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-700 transition-all space-y-2"
                                    >
                                        <div className="w-9 h-9 rounded-xl bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                                            <Database className="h-4 w-4" />
                                        </div>
                                        <div>
                                            <p className="font-semibold text-sm text-slate-900 dark:text-white group-hover:text-indigo-700 dark:group-hover:text-indigo-300">
                                                Import Anki or Sync
                                            </p>
                                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                                Bring .apkg decks or connect GitHub Gist cloud sync.
                                            </p>
                                        </div>
                                    </button>
                                )}
                            </div>
                        </div>
                    )}

                    {/* ── Stats Grid (Clickable Shortcuts) ────────────────────────────── */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
                        {[
                            {
                                label: 'Due Today',
                                value: dueCount,
                                icon: Calendar,
                                color: 'text-amber-600 dark:text-amber-400',
                                bg: 'bg-amber-50 dark:bg-amber-900/20 border-amber-100 dark:border-amber-800/40 hover:border-amber-300 dark:hover:border-amber-600',
                                iconBg: 'bg-amber-100 dark:bg-amber-900/40',
                                onClick: () => (dueCount > 0 ? onNavigate('study') : onNavigate('flashcards')),
                            },
                            {
                                label: 'Current Streak',
                                value: currentStreak,
                                suffix: currentStreak === 1 ? ' day' : ' days',
                                icon: Flame,
                                color: 'text-orange-600 dark:text-orange-400',
                                bg: 'bg-orange-50 dark:bg-orange-900/20 border-orange-100 dark:border-orange-800/40 hover:border-orange-300 dark:hover:border-orange-600',
                                iconBg: 'bg-orange-100 dark:bg-orange-900/40',
                                onClick: () => onNavigate('statistics'),
                            },
                            {
                                label: 'Mastered',
                                value: masteredCount,
                                icon: CheckCircle,
                                color: 'text-emerald-600 dark:text-emerald-400',
                                bg: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-100 dark:border-emerald-800/40 hover:border-emerald-300 dark:hover:border-emerald-600',
                                iconBg: 'bg-emerald-100 dark:bg-emerald-900/40',
                                onClick: () => routerNavigate('/flashcards', { state: { statusFilter: FlashcardStatus.Mastered } }),
                            },
                            {
                                label: 'Total Cards',
                                value: cards.length,
                                icon: Layers,
                                color: 'text-blue-600 dark:text-blue-400',
                                bg: 'bg-blue-50 dark:bg-blue-900/20 border-blue-100 dark:border-blue-800/40 hover:border-blue-300 dark:hover:border-blue-600',
                                iconBg: 'bg-blue-100 dark:bg-blue-900/40',
                                onClick: () => onNavigate('flashcards'),
                            },
                        ].map(({ label, value, suffix, icon: Icon, color, bg, iconBg, onClick }) => (
                            <button
                                key={label}
                                type="button"
                                data-testid={`dashboard-stat-${label.toLowerCase().replace(/\s+/g, '-')}`}
                                onClick={onClick}
                                className={`text-left p-3.5 sm:p-5 rounded-2xl border ${bg} flex flex-col gap-2.5 sm:gap-3 transition-all hover:shadow-md active:scale-[0.99] cursor-pointer`}
                            >
                                <div className={`w-9 h-9 sm:w-10 sm:h-10 ${iconBg} rounded-xl flex items-center justify-center shrink-0`}>
                                    <Icon className={`h-4 w-4 sm:h-5 sm:w-5 ${color}`} />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white leading-none truncate">
                                        {value}{suffix}
                                    </p>
                                    <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1 truncate">{label}</p>
                                </div>
                            </button>
                        ))}
                    </div>

                    {/* ── Quick 1-Card Warmup Widget ──────────────────────────────────── */}
                    {!isNewUser && onQuickReviewCard && (warmupCard || warmupCompletedCount > 0) && (
                        <div
                            data-testid="quick-warmup-card"
                            className="bg-white dark:bg-slate-800 rounded-2xl sm:rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm p-4 sm:p-6 space-y-4"
                        >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                    <div className="p-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400">
                                        <Zap className="h-4 w-4" />
                                    </div>
                                    <div>
                                        <h2 className="font-semibold text-slate-800 dark:text-slate-100 text-sm uppercase tracking-wider">
                                            Quick 1-Card Warmup
                                        </h2>
                                        <p className="text-xs text-slate-500 dark:text-slate-400">
                                            Review one card right here to build momentum
                                        </p>
                                    </div>
                                </div>
                                {dueCount > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => onNavigate('study')}
                                        className="text-xs font-semibold text-brand-600 dark:text-brand-400 hover:underline inline-flex items-center gap-1"
                                    >
                                        Full Session ({dueCount})
                                        <ArrowRight className="h-3.5 w-3.5" />
                                    </button>
                                )}
                            </div>

                            {warmupCard ? (
                                <div className="rounded-2xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200/80 dark:border-slate-700 p-4 sm:p-5 space-y-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <h3 className="text-xl sm:text-2xl font-serif font-bold text-slate-900 dark:text-white break-words">
                                                    {warmupCard.word}
                                                </h3>
                                                {warmupCard.phonetic && (
                                                    <span className="text-sm text-slate-500 dark:text-slate-400 font-serif italic">
                                                        {warmupCard.phonetic}
                                                    </span>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => playAudio(warmupCard.word, warmupCard.audio)}
                                                    aria-label="Listen to warmup word"
                                                    className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-brand-500 hover:bg-brand-50 dark:hover:bg-brand-900/30 rounded-full transition-colors"
                                                >
                                                    <Volume2 className="h-4 w-4" />
                                                </button>
                                            </div>
                                            <p className="text-xs italic text-slate-500 dark:text-slate-400 mt-0.5">
                                                {warmupCard.partOfSpeech}
                                            </p>
                                        </div>
                                        <StatusPill status={warmupCard.status} />
                                    </div>

                                    {!warmupRevealed ? (
                                        <div className="flex items-center justify-between gap-2 pt-1">
                                            <span className="text-xs text-slate-500 dark:text-slate-400">
                                                Try recalling the definition before revealing
                                            </span>
                                            <button
                                                type="button"
                                                data-testid="warmup-reveal-btn"
                                                onClick={() => setWarmupRevealed(true)}
                                                className="px-4 py-2 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs sm:text-sm font-semibold hover:bg-slate-800 dark:hover:bg-white transition-colors"
                                            >
                                                Reveal Meaning
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="space-y-3 pt-2 border-t border-slate-200/80 dark:border-slate-700 animate-in fade-in duration-200">
                                            <MeaningDisplay
                                                englishText={warmupCard.mainDefinition}
                                                translations={warmupCard.translations}
                                                preference={languagePreference}
                                                variant="compact"
                                                englishClassName="text-sm sm:text-base text-slate-800 dark:text-slate-100 leading-relaxed"
                                                testIdPrefix="warmup"
                                            />
                                            {warmupCard.example && (
                                                <p className="text-xs sm:text-sm italic font-serif text-slate-500 dark:text-slate-400">
                                                    “{warmupCard.example}”
                                                </p>
                                            )}
                                            <div className="grid grid-cols-3 gap-2 pt-1">
                                                <button
                                                    type="button"
                                                    data-testid="warmup-rate-again"
                                                    onClick={() => {
                                                        onQuickReviewCard(warmupCard.id, 1);
                                                        setWarmupSkippedIds(prev => [...prev, warmupCard.id]);
                                                        setWarmupRevealed(false);
                                                        setWarmupCompletedCount(c => c + 1);
                                                    }}
                                                    className="py-2 px-3 rounded-xl text-xs font-bold bg-red-50 dark:bg-red-900/25 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800/60 transition-colors"
                                                >
                                                    Again
                                                </button>
                                                <button
                                                    type="button"
                                                    data-testid="warmup-rate-learned"
                                                    onClick={() => {
                                                        onQuickReviewCard(warmupCard.id, 3);
                                                        setWarmupRevealed(false);
                                                        setWarmupCompletedCount(c => c + 1);
                                                    }}
                                                    className="py-2 px-3 rounded-xl text-xs font-bold bg-blue-50 dark:bg-blue-900/25 hover:bg-blue-100 dark:hover:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/60 transition-colors"
                                                >
                                                    Learned
                                                </button>
                                                <button
                                                    type="button"
                                                    data-testid="warmup-rate-mastered"
                                                    onClick={() => {
                                                        onQuickReviewCard(warmupCard.id, 5);
                                                        setWarmupRevealed(false);
                                                        setWarmupCompletedCount(c => c + 1);
                                                    }}
                                                    className="py-2 px-3 rounded-xl text-xs font-bold bg-emerald-50 dark:bg-emerald-900/25 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60 transition-colors"
                                                >
                                                    Mastered
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/50 flex items-center justify-between gap-3">
                                    <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
                                        Nice warmup! You&apos;re all caught up on due cards right now.
                                    </p>
                                    <CheckCircle className="h-5 w-5 text-emerald-500 shrink-0" />
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── Categories & Books Progress (Books in Priority) ─────────────── */}
                    {categoryProgressItems.length > 0 && (
                        <div
                            data-testid="home-categories-section"
                            className="bg-white dark:bg-slate-800 rounded-2xl sm:rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm shadow-slate-100 dark:shadow-none overflow-hidden"
                        >
                            <div className="px-4 sm:px-6 pt-5 sm:pt-6 pb-4 border-b border-slate-50 dark:border-slate-700 flex flex-wrap items-center justify-between gap-3">
                                <div className="flex items-center gap-2.5 min-w-0">
                                    <div className="p-2 rounded-xl bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 shrink-0">
                                        <BookOpen className="h-4 w-4" />
                                    </div>
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <h2 className="font-semibold text-slate-800 dark:text-slate-100 text-sm uppercase tracking-wider">
                                                Categories & Books
                                            </h2>
                                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300">
                                                {categoryProgressItems.length}
                                            </span>
                                        </div>
                                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                                            Reading docks prioritized first, followed by custom categories and general vocabulary
                                        </p>
                                    </div>
                                </div>

                                <div className="flex flex-wrap items-center gap-2.5">
                                    {onImportBookWords && (
                                        <button
                                            type="button"
                                            onClick={() => setIsBookPrepOpen(true)}
                                            className="px-3 sm:px-3.5 py-2 rounded-xl bg-brand-50 hover:bg-brand-100 dark:bg-brand-900/30 dark:hover:bg-brand-900/50 text-brand-700 dark:text-brand-300 text-xs font-semibold border border-brand-200 dark:border-brand-800/60 transition-colors flex items-center gap-1.5"
                                        >
                                            <Plus className="h-3.5 w-3.5" />
                                            Prepare for a Book
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => onNavigate('flashcards')}
                                        className="text-sm text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1 group"
                                    >
                                        Manage Deck
                                        <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
                                    </button>
                                </div>
                            </div>

                            <div className="p-4 sm:p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {categoryProgressItems.map((cat) => {
                                    const isBook = cat.kind === 'book';
                                    const isTag = cat.kind === 'tag';
                                    const masteredWidth = cat.total > 0 ? (cat.masteredCount / cat.total) * 100 : 0;
                                    const learningWidth = cat.total > 0 ? (cat.learningCount / cat.total) * 100 : 0;
                                    const newWidth = cat.total > 0 ? (cat.newCount / cat.total) * 100 : 0;

                                    const statusBadgeStyle =
                                        cat.statusLabel === 'Completed'
                                            ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                                            : cat.statusLabel === 'In Progress'
                                                ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
                                                : 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300';

                                    return (
                                        <div
                                            key={cat.id}
                                            data-testid="home-category-card"
                                            data-category-kind={cat.kind}
                                            className={`rounded-2xl p-4 border flex flex-col justify-between gap-4 transition-all hover:shadow-md ${
                                                isBook
                                                    ? 'bg-gradient-to-br from-brand-50/70 via-white to-emerald-50/40 dark:from-brand-950/35 dark:via-slate-800/90 dark:to-slate-800 border-brand-200 dark:border-brand-800/70'
                                                    : 'bg-slate-50/70 dark:bg-slate-900/50 border-slate-200/80 dark:border-slate-700'
                                            }`}
                                        >
                                            <div className="space-y-3">
                                                {/* Top row: Category type badge + Status badge */}
                                                <div className="flex items-center justify-between gap-2">
                                                    <span
                                                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                                            isBook
                                                                ? 'bg-brand-600 text-white shadow-sm'
                                                                : isTag
                                                                    ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300'
                                                                    : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                                                        }`}
                                                    >
                                                        {isBook ? (
                                                            <>
                                                                <BookOpen className="h-3 w-3" />
                                                                Book
                                                            </>
                                                        ) : isTag ? (
                                                            <>
                                                                <Tag className="h-3 w-3" />
                                                                Category
                                                            </>
                                                        ) : (
                                                            <>
                                                                <Layers className="h-3 w-3" />
                                                                General
                                                            </>
                                                        )}
                                                    </span>

                                                    <div className="flex items-center gap-1.5">
                                                        {cat.dueCount > 0 && (
                                                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300">
                                                                {cat.dueCount} due
                                                            </span>
                                                        )}
                                                        <span
                                                            data-testid="category-status-badge"
                                                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${statusBadgeStyle}`}
                                                        >
                                                            {cat.statusLabel}
                                                        </span>
                                                        {isBook && cat.rawTag && onDeleteBook && (
                                                            <button
                                                                type="button"
                                                                data-testid="remove-book-button"
                                                                aria-label={`Remove ${cat.name}`}
                                                                title={`Remove ${cat.name} and its words`}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setBookToDelete({
                                                                        tag: cat.rawTag!,
                                                                        title: cat.name,
                                                                        count: cat.total,
                                                                    });
                                                                }}
                                                                className="p-1 rounded-lg text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                                                            >
                                                                <Trash2 className="h-3.5 w-3.5" />
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Title & total words */}
                                                <div>
                                                    <h3 className="font-serif font-bold text-lg text-slate-900 dark:text-white truncate">
                                                        {cat.name}
                                                    </h3>
                                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                                        {cat.total} {cat.total === 1 ? 'word' : 'words'} total
                                                    </p>
                                                </div>

                                                {/* Progress bar + percentage */}
                                                <div className="space-y-1.5">
                                                    <div className="flex items-center justify-between text-xs">
                                                        <span className="text-slate-500 dark:text-slate-400 font-medium">
                                                            Mastery Progress
                                                        </span>
                                                        <span
                                                            data-testid="category-progress-pct"
                                                            className="font-bold text-slate-800 dark:text-slate-100"
                                                        >
                                                            {cat.progressPct}%
                                                        </span>
                                                    </div>
                                                    <div className="h-2.5 w-full bg-slate-200/80 dark:bg-slate-700 rounded-full overflow-hidden flex">
                                                        {masteredWidth > 0 && (
                                                            <div
                                                                data-testid="category-bar-mastered"
                                                                className="h-full bg-emerald-500 transition-all duration-500"
                                                                style={{ width: `${masteredWidth}%` }}
                                                                title={`Mastered: ${cat.masteredCount}`}
                                                            />
                                                        )}
                                                        {learningWidth > 0 && (
                                                            <div
                                                                data-testid="category-bar-learning"
                                                                className="h-full bg-amber-400 transition-all duration-500"
                                                                style={{ width: `${learningWidth}%` }}
                                                                title={`Learning: ${cat.learningCount}`}
                                                            />
                                                        )}
                                                        {newWidth > 0 && (
                                                            <div
                                                                data-testid="category-bar-new"
                                                                className="h-full bg-blue-400 dark:bg-blue-500 transition-all duration-500"
                                                                style={{ width: `${newWidth}%` }}
                                                                title={`New: ${cat.newCount}`}
                                                            />
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Status breakdown pills */}
                                                <div className="grid grid-cols-3 gap-1.5 pt-0.5 text-center">
                                                    <div className="px-2 py-1 rounded-lg bg-blue-50/80 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/40">
                                                        <p className="text-xs font-bold text-blue-700 dark:text-blue-300">
                                                            {cat.newCount}
                                                        </p>
                                                        <p className="text-[10px] text-blue-600/80 dark:text-blue-400/80">
                                                            New
                                                        </p>
                                                    </div>
                                                    <div className="px-2 py-1 rounded-lg bg-amber-50/80 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800/40">
                                                        <p className="text-xs font-bold text-amber-700 dark:text-amber-300">
                                                            {cat.learningCount}
                                                        </p>
                                                        <p className="text-[10px] text-amber-600/80 dark:text-amber-400/80">
                                                            Learning
                                                        </p>
                                                    </div>
                                                    <div className="px-2 py-1 rounded-lg bg-emerald-50/80 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800/40">
                                                        <p className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
                                                            {cat.masteredCount}
                                                        </p>
                                                        <p className="text-[10px] text-emerald-600/80 dark:text-emerald-400/80">
                                                            Mastered
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Study Category Button */}
                                            <button
                                                type="button"
                                                aria-label={`Study ${cat.name}`}
                                                disabled={cat.dueCount === 0}
                                                onClick={() => {
                                                    if (onStartStudy) {
                                                        onStartStudy(cat.rawTag);
                                                    } else {
                                                        onNavigate('study');
                                                    }
                                                }}
                                                className={`w-full py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                                                    cat.dueCount === 0
                                                        ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/50'
                                                        : isBook
                                                            ? 'bg-brand-600 hover:bg-brand-700 text-white shadow-sm'
                                                            : 'bg-white dark:bg-slate-800 hover:bg-brand-50 dark:hover:bg-brand-900/30 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600'
                                                }`}
                                            >
                                                {cat.dueCount === 0 ? (
                                                    <>
                                                        <CheckCircle className="h-3.5 w-3.5" />
                                                        All Caught Up
                                                    </>
                                                ) : (
                                                    <>
                                                        <Play className="h-3.5 w-3.5 fill-current" />
                                                        Study {isBook ? 'Book' : 'Category'}
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* ── Two-column layout: Word of the Day + Progress ────────────────── */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">

                        {/* Word of the Day */}
                        <div className="bg-white dark:bg-slate-800 rounded-2xl sm:rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm shadow-slate-100 dark:shadow-none overflow-hidden flex flex-col">
                            <div className="px-4 sm:px-6 pt-5 sm:pt-6 pb-3.5 sm:pb-4 border-b border-slate-50 dark:border-slate-700 flex items-center gap-2">
                                <Star className="h-4 w-4 text-amber-500 fill-current" />
                                <h2 className="font-semibold text-slate-800 dark:text-slate-100 text-sm uppercase tracking-wider">Word of the Day</h2>
                            </div>

                            {wordOfTheDay ? (
                                <div className="p-4 sm:p-6 flex flex-col flex-1 gap-4">
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="min-w-0">
                                            <h3 className="text-2xl sm:text-3xl font-serif font-bold text-slate-900 dark:text-white break-words">{wordOfTheDay.word}</h3>
                                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                                                {wordOfTheDay.phonetic && (
                                                    <span className="text-slate-400 text-sm font-serif italic">{wordOfTheDay.phonetic}</span>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => playAudio(wordOfTheDay.word, wordOfTheDay.audio)}
                                                    className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-brand-500 hover:bg-brand-50 dark:hover:bg-brand-900/30 rounded-full transition-colors"
                                                    title="Listen"
                                                    aria-label="Listen to pronunciation"
                                                >
                                                    <Volume2 className="h-4 w-4" />
                                                </button>
                                                <StatusPill status={wordOfTheDay.status} />
                                            </div>
                                            <p className="text-xs text-slate-400 mt-0.5 italic">{wordOfTheDay.partOfSpeech}</p>
                                        </div>
                                        {wordOfTheDay.image && (
                                            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 flex items-center justify-center shrink-0">
                                                <img
                                                    src={wordOfTheDay.image}
                                                    alt={wordOfTheDay.word}
                                                    className="w-full h-full object-cover"
                                                    loading="lazy"
                                                />
                                            </div>
                                        )}
                                    </div>

                                    <MeaningDisplay
                                        englishText={wordOfTheDay.mainDefinition}
                                        translations={wordOfTheDay.translations}
                                        preference={languagePreference}
                                        variant="compact"
                                        englishClassName="text-slate-700 dark:text-slate-300 leading-relaxed text-sm"
                                        containerClassName="flex-1"
                                        testIdPrefix="wotd"
                                    />

                                    {wordOfTheDay.example && (
                                        <p className="text-slate-400 italic text-sm font-serif border-t border-slate-50 dark:border-slate-700 pt-3">
                                            "{wordOfTheDay.example}"
                                        </p>
                                    )}

                                    <div className="flex flex-wrap items-center gap-3 pt-1">
                                        <button
                                            type="button"
                                            data-testid="wotd-flip-preview-btn"
                                            onClick={() => openCard(wordOfTheDay)}
                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200/80 dark:border-amber-800/60 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors"
                                        >
                                            <RotateCw className="h-3.5 w-3.5" />
                                            Flip Card
                                        </button>
                                        <button
                                            type="button"
                                            data-testid="wotd-view-in-flashcards-btn"
                                            onClick={() =>
                                                routerNavigate('/flashcards', {
                                                    state: { searchQuery: wordOfTheDay.word },
                                                })
                                            }
                                            className="inline-flex items-center gap-1.5 text-brand-600 hover:text-brand-700 dark:text-brand-400 font-medium text-sm group"
                                        >
                                            View in Flashcards
                                            <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex-1 flex flex-col items-center justify-center p-8 sm:p-10 text-center gap-3">
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
                        <div className="bg-white dark:bg-slate-800 rounded-2xl sm:rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm shadow-slate-100 dark:shadow-none overflow-hidden flex flex-col">
                            <div className="px-4 sm:px-6 pt-5 sm:pt-6 pb-3.5 sm:pb-4 border-b border-slate-50 dark:border-slate-700 flex items-center gap-2">
                                <TrendingUp className="h-4 w-4 text-brand-500" />
                                <h2 className="font-semibold text-slate-800 dark:text-slate-100 text-sm uppercase tracking-wider">Progress</h2>
                            </div>

                            <div className="p-4 sm:p-6 flex flex-col gap-4 flex-1">
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
                                                <p className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">{currentStreak}</p>
                                                <p className="text-xs text-slate-400 mt-0.5 flex items-center justify-center gap-1">
                                                    <Flame className="h-3 w-3 text-orange-400" /> Current Streak
                                                </p>
                                            </div>
                                            <div className="text-center border-l border-slate-100 dark:border-slate-700">
                                                <p className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">{longestStreak}</p>
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
                        <div className="bg-white dark:bg-slate-800 rounded-2xl sm:rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm shadow-slate-100 dark:shadow-none overflow-hidden">
                            <div className="px-4 sm:px-6 pt-5 sm:pt-6 pb-3.5 sm:pb-4 border-b border-slate-50 dark:border-slate-700 flex items-center justify-between">
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

            {onImportBookWords && isBookPrepOpen && (
                <Suspense fallback={null}>
                    <BookPrepModal
                        isOpen={isBookPrepOpen}
                        onClose={() => setIsBookPrepOpen(false)}
                        existingWords={existingWordsSet}
                        existingCards={cards}
                        onImportBookWords={onImportBookWords}
                        languagePreference={languagePreference}
                    />
                </Suspense>
            )}

            {bookToDelete && (
                <div
                    data-testid="confirm-delete-book-modal"
                    className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
                    onClick={() => setBookToDelete(null)}
                >
                    <div
                        ref={deleteBookModalRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="dashboard-delete-book-title"
                        className="relative z-10 w-full max-w-md bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-slate-100 dark:border-slate-700 p-6 space-y-5"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-start gap-3.5">
                            <div className="p-3 rounded-2xl bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 shrink-0">
                                <AlertTriangle className="h-6 w-6" />
                            </div>
                            <div className="space-y-1.5">
                                <h3 id="dashboard-delete-book-title" className="text-lg font-serif font-bold text-slate-900 dark:text-white">
                                    Remove “{bookToDelete.title}”?
                                </h3>
                                <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                                    Are you sure you want to remove <strong>{bookToDelete.title}</strong> and permanently delete all{' '}
                                    <strong>{bookToDelete.count}</strong> {bookToDelete.count === 1 ? 'word' : 'words'} from your deck? This action cannot be undone.
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-700">
                            <button
                                type="button"
                                onClick={() => setBookToDelete(null)}
                                className="px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                data-testid="confirm-delete-book-btn"
                                onClick={() => {
                                    onDeleteBook?.(bookToDelete.tag);
                                    setBookToDelete(null);
                                }}
                                className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-red-600 hover:bg-red-700 text-white shadow-sm transition-colors inline-flex items-center gap-1.5"
                            >
                                <Trash2 className="h-4 w-4" />
                                Remove Book & Words
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};
