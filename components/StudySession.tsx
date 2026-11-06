import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Flashcard, FlashcardStatus } from '../types';
import { RotateCw, CheckCircle, Brain, ArrowLeft, Volume2, MoveUp, MoveDown, MoveLeft, MoveRight, XCircle, ArrowRight, ListChecks, Undo2, RefreshCw, Lightbulb, BookOpen } from 'lucide-react';
import Confetti from 'react-confetti';
import { useWindowSize } from 'react-use';
import { motion, useMotionValue, useTransform, PanInfo, AnimatePresence } from 'framer-motion';
import { useLocation } from 'react-router-dom';
import { playAudio } from '../utils/audio';
import { getDueCards, sortStudySessionCards, isBookFlashcard, getCardComplexityLevel } from '../utils/studyUtils';
import { parseTagHierarchy, getCardBookInfo } from '../utils/tagUtils';
import { SessionMode } from './SessionConfigModal';

const FALLBACK_DISTRACTORS = [
  'Lasting for a very short time; fleeting or transitory.',
  'Showing great attention to detail; very careful and precise.',
  'Present, appearing, or found everywhere at the same time.',
  'Fluent or persuasive in speaking or writing.',
  'Open to more than one interpretation; not having one obvious meaning.',
];

interface ReviewHistoryItem {
  index: number;
  previousCard: Flashcard;
  quality: number;
}

interface StudySessionProps {
  cards: Flashcard[];
  onReviewCard: (id: string, quality: number) => void;
  onRestoreCard?: (previousCard: Flashcard) => void;
  onSessionComplete: () => void;
  onExit: () => void;
}

export const StudySession: React.FC<StudySessionProps> = ({ cards, onReviewCard, onRestoreCard, onSessionComplete, onExit }) => {
  const [queue, setQueue] = useState<Flashcard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [showBookHint, setShowBookHint] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [selectedQuizOption, setSelectedQuizOption] = useState<string | null>(null);
  const [reviewHistory, setReviewHistory] = useState<ReviewHistoryItem[]>([]);

  const { width, height } = useWindowSize();
  const [showConfetti, setShowConfetti] = useState(false);
  const [actionToast, setActionToast] = useState<{ message: string; colorClass: string; bgColorClass: string } | null>(null);

  const location = useLocation();
  const sessionConfig = location.state?.sessionConfig as {
    mode: SessionMode;
    count?: number;
    tag?: string;
    chapters?: string[];
  } | undefined;
  const isQuizMode = sessionConfig?.mode === 'quiz';

  useEffect(() => {
    if (isInitialized || cards.length === 0) return;

    const allDueCards = getDueCards(cards);
    let dueCards = allDueCards;

    if (sessionConfig?.tag) {
      const parsed = parseTagHierarchy(sessionConfig.tag);
      if (parsed.folder === 'Books' && parsed.bookTitle) {
        const targetBookLower = parsed.bookTitle.toLowerCase();
        const effectiveChapters =
          sessionConfig.chapters && sessionConfig.chapters.length > 0
            ? sessionConfig.chapters
            : parsed.chapter
              ? [parsed.chapter]
              : [];
        dueCards = allDueCards.filter(c => {
          const info = getCardBookInfo(c);
          if (!info || info.bookTitle.toLowerCase() !== targetBookLower) return false;
          if (effectiveChapters.length > 0) {
            return Boolean(info.chapter && effectiveChapters.includes(info.chapter));
          }
          return true;
        });
      } else {
        dueCards = allDueCards.filter(c => c.tags?.some(t => t.trim() === sessionConfig.tag));
      }
    }

    const isBookSession = Boolean(
      (sessionConfig?.tag && /^(?:book\s*:|books\s*\/|__folder:Books__)/i.test(sessionConfig.tag.trim())) ||
      dueCards.some(c => isBookFlashcard(c) || c.complexityLevel !== undefined)
    );

    const sortedCards = sortStudySessionCards(dueCards, { isBookSession });

    const studySet =
      (sessionConfig?.mode === 'short' || sessionConfig?.mode === 'quiz') && sessionConfig.count
        ? sortedCards.slice(0, sessionConfig.count)
        : sortedCards;

    setQueue(studySet);
    setIsInitialized(true);
    // Snapshot the queue once cards have loaded so in-session status updates do not reshuffle the queue.
  }, [cards, isInitialized, sessionConfig]);

  const currentCard = queue[currentIndex];

  const currentCardBookInfo = useMemo(() => {
    if (!currentCard) return null;
    return getCardBookInfo(currentCard);
  }, [currentCard]);

  // Determine if the current card comes from a Book dock and has a real sentence from the book
  const bookSourceTitle = useMemo(() => {
    if (!currentCard?.example?.trim()) return null;
    if (currentCardBookInfo?.bookTitle) return currentCardBookInfo.bookTitle;
    const bookTag = currentCard.tags?.find(t => /^book\s*:/i.test(t.trim()));
    if (!bookTag) return null;
    return bookTag.replace(/^book\s*:\s*/i, '').trim() || 'Book';
  }, [currentCard, currentCardBookInfo]);

  const currentCardChapter = useMemo(() => {
    return currentCardBookInfo?.chapter || null;
  }, [currentCardBookInfo]);

  const currentCardComplexity = useMemo(() => {
    if (!currentCard) return null;
    if (!isBookFlashcard(currentCard) && !currentCard.complexityLevel) return null;
    return getCardComplexityLevel(currentCard);
  }, [currentCard]);

  const renderHighlightedBookSentence = useCallback((sentence: string, targetWord: string) => {
    const cleanWord = targetWord.trim();
    if (!cleanWord) return <>“{sentence}”</>;
    const escaped = cleanWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped}[a-zA-Z]*)`, 'gi');
    const parts = sentence.split(regex);
    return (
      <>
        “
        {parts.map((part, i) =>
          part.toLowerCase().startsWith(cleanWord.toLowerCase()) ? (
            <mark
              key={i}
              className="bg-amber-200/80 dark:bg-amber-500/30 text-amber-950 dark:text-amber-200 font-bold px-1 rounded not-italic"
            >
              {part}
            </mark>
          ) : (
            <React.Fragment key={i}>{part}</React.Fragment>
          )
        )}
        ”
      </>
    );
  }, []);

  // Build 4 deterministic multiple-choice options for the current quiz card
  const quizOptions = useMemo(() => {
    if (!currentCard || !isQuizMode) return [];
    const correct = currentCard.mainDefinition.trim();
    const otherDefs = Array.from(
      new Set(
        cards
          .filter(c => c.id !== currentCard.id && c.mainDefinition.trim() !== correct)
          .map(c => c.mainDefinition.trim())
          .filter(Boolean)
      )
    );
    // Deterministic pseudo-random shuffle seeded by card id + currentIndex
    const hashStr = (str: string) => {
      let h = 2166136261 ^ currentIndex;
      for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return h >>> 0;
    };

    const sortedDeckDistractors = [...otherDefs].sort(
      (a, b) => hashStr(currentCard.id + a) - hashStr(currentCard.id + b)
    );
    const fallbackNeeded = Math.max(0, 3 - sortedDeckDistractors.length);
    const distractors = [
      ...sortedDeckDistractors.slice(0, 3),
      ...FALLBACK_DISTRACTORS.filter(d => d !== correct && !sortedDeckDistractors.includes(d)).slice(0, fallbackNeeded),
    ];

    return [correct, ...distractors].sort(
      (a, b) => hashStr('opt:' + currentCard.id + a) - hashStr('opt:' + currentCard.id + b)
    );
  }, [currentCard, isQuizMode, cards, currentIndex]);

  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-10, 10]);

  const swipeRightOpacity = useTransform(x, [50, 150], [0, 1]);
  const swipeLeftOpacity = useTransform(x, [-50, -150], [0, 1]);
  const swipeDownOpacity = useTransform(y, [50, 150], [0, 1]);
  const swipeUpOpacity = useTransform(y, [-50, -150], [0, 1]);

  const handleNext = useCallback((quality: number | null) => {
    if (!currentCard) return;

    if (quality !== null) {
      const snapshot = cards.find(c => c.id === currentCard.id) || currentCard;
      setReviewHistory(prev => [...prev, { index: currentIndex, previousCard: { ...snapshot }, quality }]);
      onReviewCard(currentCard.id, quality);

      let toastMsg = "";
      let toastColor = "";
      let toastBg = "";

      if (quality === 1) {
        toastMsg = "Again"; toastColor = "text-red-500"; toastBg = "bg-red-500/10 border-red-500/20";
      } else if (quality === 3) {
        toastMsg = "Learned"; toastColor = "text-blue-500"; toastBg = "bg-blue-500/10 border-blue-500/20";
      } else if (quality === 5) {
        toastMsg = "Mastered"; toastColor = "text-green-500"; toastBg = "bg-green-500/10 border-green-500/20";
      }

      setActionToast({ message: toastMsg, colorClass: toastColor, bgColorClass: toastBg });
      setTimeout(() => setActionToast(null), 2000);
    }

    // Reset position instantly
    x.set(0);
    y.set(0);

    // Flip back first
    setIsFlipped(false);
    setShowBookHint(false);
    setSelectedQuizOption(null);

    // Wait for flip to partially complete before changing content
    setTimeout(() => {
      setCurrentIndex(prev => {
        const nextIndex = prev + 1;
        if (nextIndex >= queue.length) {
          setShowConfetti(true);
          onSessionComplete();
        }
        return nextIndex;
      });
    }, isQuizMode ? 100 : 300);
  }, [currentCard, cards, currentIndex, onReviewCard, queue.length, onSessionComplete, x, y, isQuizMode]);

  const handleSelectQuizOption = useCallback((option: string) => {
    if (!currentCard || selectedQuizOption !== null) return;
    setSelectedQuizOption(option);
    const isCorrect = option === currentCard.mainDefinition.trim();
    const quality = isCorrect ? 3 : 1;
    const snapshot = cards.find(c => c.id === currentCard.id) || currentCard;
    setReviewHistory(prev => [...prev, { index: currentIndex, previousCard: { ...snapshot }, quality }]);
    onReviewCard(currentCard.id, quality);
  }, [currentCard, cards, currentIndex, selectedQuizOption, onReviewCard]);

  const handleUndo = useCallback(() => {
    if (reviewHistory.length === 0) return;
    const lastEntry = reviewHistory[reviewHistory.length - 1];
    setReviewHistory(prev => prev.slice(0, -1));
    onRestoreCard?.(lastEntry.previousCard);
    x.set(0);
    y.set(0);
    setIsFlipped(false);
    setShowBookHint(false);
    setSelectedQuizOption(null);
    setShowConfetti(false);
    setCurrentIndex(lastEntry.index);
    setActionToast({
      message: "Undone",
      colorClass: "text-amber-500",
      bgColorClass: "bg-amber-500/10 border-amber-500/20",
    });
    setTimeout(() => setActionToast(null), 1800);
  }, [reviewHistory, onRestoreCard, x, y]);

  const handleReviewMissedCards = useCallback((missedCards: Flashcard[]) => {
    if (missedCards.length === 0) return;
    setQueue(missedCards);
    setCurrentIndex(0);
    setReviewHistory([]);
    setIsFlipped(false);
    setShowBookHint(false);
    setSelectedQuizOption(null);
    setShowConfetti(false);
  }, []);

  // Keyboard support for desktop
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        if (reviewHistory.length > 0) {
          e.preventDefault();
          handleUndo();
        }
        return;
      }

      if (!currentCard) return;

      if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'h' && bookSourceTitle) {
        if (!isFlipped && (!isQuizMode || selectedQuizOption === null)) {
          e.preventDefault();
          setShowBookHint(prev => !prev);
          return;
        }
      }

      if (isQuizMode) {
        if (selectedQuizOption === null) {
          const num = parseInt(e.key, 10);
          if (num >= 1 && num <= quizOptions.length) {
            e.preventDefault();
            handleSelectQuizOption(quizOptions[num - 1]);
          }
        } else if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') {
          e.preventDefault();
          handleNext(null);
        }
        return;
      }

      switch (e.key) {
        case 'ArrowLeft':
          if (isFlipped) handleNext(1);
          break;
        case 'ArrowRight':
          if (isFlipped) handleNext(5);
          break;
        case 'ArrowDown':
        case 'ArrowUp':
          if (isFlipped) handleNext(3);
          break;
        case ' ':
        case 'Enter':
          e.preventDefault();
          setIsFlipped(prev => !prev);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleNext, handleUndo, reviewHistory.length, currentCard, isFlipped, isQuizMode, selectedQuizOption, quizOptions, handleSelectQuizOption, bookSourceTitle]);

  const handleDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (!isFlipped) return;
    const threshold = 100;
    if (info.offset.x > threshold) {
      handleNext(5);
    } else if (info.offset.x < -threshold) {
      handleNext(1);
    } else if (info.offset.y > threshold || info.offset.y < -threshold) {
      handleNext(3);
    }
  };

  if (!isInitialized) return null;

  if (!currentCard) {
    const isAllMastered = cards.length > 0 && cards.every(c => c.status === FlashcardStatus.Mastered);
    const totalReviewed = reviewHistory.length;
    const masteredInSession = reviewHistory.filter(r => r.quality === 5).length;
    const learnedInSession = reviewHistory.filter(r => r.quality === 3).length;
    const againEntries = reviewHistory.filter(r => r.quality === 1);
    const againInSession = againEntries.length;
    const accuracy = totalReviewed > 0 ? Math.round(((masteredInSession + learnedInSession) / totalReviewed) * 100) : 100;
    const missedCards = Array.from(
      new Map<string, Flashcard>(againEntries.map(r => [r.previousCard.id, r.previousCard])).values()
    );

    return (
      <div className="max-w-lg mx-auto flex flex-col items-center justify-center min-h-[65vh] py-8 px-4 space-y-6 animate-in fade-in slide-in-from-bottom-4">
        {showConfetti && (
          <div className="fixed inset-0 z-[100] pointer-events-none">
            <Confetti
              width={width}
              height={height}
              recycle={false}
              numberOfPieces={500}
              gravity={0.15}
            />
          </div>
        )}
        <div className="p-5 bg-green-50 dark:bg-green-900/20 rounded-full">
          <CheckCircle className="h-14 w-14 text-green-500" />
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-3xl font-serif font-bold text-slate-900 dark:text-white">
            {isAllMastered ? "All Cards Mastered!" : "Session Complete!"}
          </h2>
          <p className="text-slate-500 dark:text-slate-400">
            {isAllMastered
              ? "Great job! You've mastered all your cards."
              : totalReviewed > 0
                ? `You reviewed ${totalReviewed} card${totalReviewed === 1 ? '' : 's'} with ${accuracy}% accuracy.`
                : "You've reviewed all your cards for now."}
          </p>
        </div>

        {totalReviewed > 0 && (
          <div className="w-full bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 p-6 shadow-sm space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-700/60">
                <p className="text-2xl font-bold text-slate-900 dark:text-white">{totalReviewed}</p>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">Reviewed</p>
              </div>
              <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800/40">
                <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{accuracy}%</p>
                <p className="text-xs font-medium text-emerald-700/80 dark:text-emerald-300/80 mt-0.5">Accuracy</p>
              </div>
              <div className="p-3 rounded-2xl bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/40">
                <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{masteredInSession + learnedInSession}</p>
                <p className="text-xs font-medium text-blue-700/80 dark:text-blue-300/80 mt-0.5">Recalled</p>
              </div>
              <div className="p-3 rounded-2xl bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800/40">
                <p className="text-2xl font-bold text-red-600 dark:text-red-400">{againInSession}</p>
                <p className="text-xs font-medium text-red-700/80 dark:text-red-300/80 mt-0.5">Missed</p>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row items-center gap-3 w-full justify-center z-10">
          {missedCards.length > 0 && (
            <button
              onClick={() => handleReviewMissedCards(missedCards)}
              className="w-full sm:w-auto whitespace-nowrap inline-flex items-center justify-center gap-2 px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-semibold transition-colors shadow-lg shadow-brand-500/25"
            >
              <RefreshCw className="h-4 w-4 shrink-0" />
              Review Missed Cards ({missedCards.length})
            </button>
          )}
          {reviewHistory.length > 0 && (
            <button
              onClick={handleUndo}
              className="w-full sm:w-auto whitespace-nowrap inline-flex items-center justify-center gap-2 px-5 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-xl font-medium transition-colors"
            >
              <Undo2 className="h-4 w-4 shrink-0" />
              Undo Last
            </button>
          )}
          <button
            onClick={onExit}
            className="w-full sm:w-auto whitespace-nowrap px-6 py-3 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-xl font-medium hover:bg-slate-800 dark:hover:bg-white transition-colors shadow-lg shadow-slate-900/20"
          >
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // If we've gone past the last card (due to state update delay), show completion or null
  if (currentIndex >= queue.length) {
    return null;
  }

  const progress = ((currentIndex) / queue.length) * 100;

  return (
    <div className="max-w-xl mx-auto h-[calc(100vh-140px)] flex flex-col">
      <div className="flex items-center justify-between mb-8 px-4">
        <button
          onClick={onExit}
          className="p-2 -ml-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors"
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
        <div className="flex-1 mx-6 bg-slate-200 dark:bg-slate-700 rounded-full h-2">
          <div
            className="bg-brand-500 h-2 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleUndo}
            disabled={reviewHistory.length === 0}
            title="Undo last review (⌘Z / Ctrl+Z)"
            aria-label="Undo last review"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:pointer-events-none transition-colors"
          >
            <Undo2 className="h-4 w-4" />
            <span className="hidden sm:inline">Undo</span>
          </button>
          <span className="text-sm font-medium text-slate-500 dark:text-slate-400 tabular-nums">
            {currentIndex + 1} / {queue.length}
          </span>
        </div>
      </div>

      {/* Action Toast */}
      <div className="absolute top-24 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
        <AnimatePresence>
          {actionToast && (
            <motion.div
              initial={{ opacity: 0, y: -20, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.9 }}
              transition={{ duration: 0.2 }}
              className={`px-4 py-2 rounded-full border backdrop-blur-sm shadow-sm font-bold tracking-wider uppercase text-sm flex items-center gap-2 ${actionToast.colorClass} ${actionToast.bgColorClass}`}
            >
              {actionToast.message}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex-1 relative perspective-1000 mb-8 sm:px-12 flex justify-center items-center">
        {isQuizMode ? (
          <div className="w-full max-w-lg bg-white dark:bg-slate-800 rounded-3xl shadow-xl border border-slate-100 dark:border-slate-700 p-6 sm:p-8 flex flex-col gap-6">
            <div className="text-center space-y-2 border-b border-slate-100 dark:border-slate-700 pb-5">
              <div className="flex flex-wrap items-center justify-center gap-2 mb-1">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 text-xs font-bold uppercase tracking-wider">
                  <ListChecks className="h-3.5 w-3.5" />
                  Multiple-Choice Quiz
                </div>
                {currentCardComplexity && (
                  <span
                    data-testid="study-card-complexity-badge"
                    className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                      currentCardComplexity === 'advanced'
                        ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800/60'
                        : currentCardComplexity === 'intermediate'
                          ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/60'
                          : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60'
                    }`}
                  >
                    {currentCardComplexity}
                  </span>
                )}
                {currentCardChapter && (
                  <span
                    data-testid="study-card-chapter-badge"
                    className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/60"
                  >
                    {currentCardChapter}
                  </span>
                )}
              </div>
              <h2 className="text-4xl font-serif font-bold text-slate-900 dark:text-white">{currentCard.word}</h2>
              <div className="flex items-center justify-center gap-2">
                {currentCard.partOfSpeech && (
                  <span className="text-xs italic text-slate-400 dark:text-slate-500">{currentCard.partOfSpeech}</span>
                )}
                {currentCard.phonetic && (
                  <span className="text-sm text-slate-400 dark:text-slate-500 font-serif italic">{currentCard.phonetic}</span>
                )}
                <button
                  onClick={() => playAudio(currentCard.word, currentCard.audio)}
                  className="p-1.5 text-slate-400 hover:text-brand-500 hover:bg-brand-50 dark:hover:bg-brand-900/30 rounded-full transition-colors"
                  title="Listen to pronunciation"
                >
                  <Volume2 className="h-4 w-4" />
                </button>
              </div>

              {bookSourceTitle && currentCard.example && (
                <div className="pt-2 flex flex-col items-center">
                  {!showBookHint ? (
                    <button
                      type="button"
                      data-testid="book-hint-button"
                      onClick={() => setShowBookHint(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors"
                    >
                      <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
                      Show Book Hint
                    </button>
                  ) : (
                    <div
                      data-testid="book-hint-content"
                      className="w-full mt-1 p-3.5 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/60 text-left space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                          <BookOpen className="h-3 w-3" />
                          From {bookSourceTitle}
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowBookHint(false)}
                          className="text-[11px] font-semibold text-amber-700/80 dark:text-amber-400/80 hover:underline"
                        >
                          Hide Hint
                        </button>
                      </div>
                      <p className="text-xs sm:text-sm italic font-serif text-slate-700 dark:text-slate-200 leading-relaxed">
                        {renderHighlightedBookSentence(currentCard.example, currentCard.word)}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-3">
              {quizOptions.map((option, idx) => {
                const isCorrectOption = option === currentCard.mainDefinition.trim();
                const isSelected = selectedQuizOption === option;
                const hasAnswered = selectedQuizOption !== null;

                let optionClasses =
                  'border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/40 hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-indigo-50/40 dark:hover:bg-indigo-900/20 text-slate-700 dark:text-slate-200';
                if (hasAnswered) {
                  if (isCorrectOption) {
                    optionClasses =
                      'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-900 dark:text-emerald-100 ring-1 ring-emerald-500';
                  } else if (isSelected) {
                    optionClasses =
                      'border-red-500 bg-red-50 dark:bg-red-900/30 text-red-900 dark:text-red-100 ring-1 ring-red-500';
                  } else {
                    optionClasses =
                      'border-slate-200 dark:border-slate-700 bg-slate-50/40 dark:bg-slate-900/20 text-slate-400 dark:text-slate-500 opacity-60';
                  }
                }

                return (
                  <button
                    key={idx}
                    disabled={hasAnswered}
                    onClick={() => handleSelectQuizOption(option)}
                    className={`w-full text-left p-4 rounded-2xl border-2 transition-all flex items-start gap-3 ${optionClasses}`}
                  >
                    <span className="shrink-0 w-6 h-6 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-xs font-bold flex items-center justify-center text-slate-500 dark:text-slate-400 mt-0.5">
                      {idx + 1}
                    </span>
                    <span className="flex-1 text-sm sm:text-base leading-snug font-medium">{option}</span>
                    {hasAnswered && isCorrectOption && (
                      <CheckCircle className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
                    )}
                    {hasAnswered && isSelected && !isCorrectOption && (
                      <XCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                    )}
                  </button>
                );
              })}
            </div>

            {selectedQuizOption !== null && (
              <div className="pt-2 flex items-center justify-between border-t border-slate-100 dark:border-slate-700">
                <span
                  className={`text-sm font-semibold ${
                    selectedQuizOption === currentCard.mainDefinition.trim()
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {selectedQuizOption === currentCard.mainDefinition.trim()
                    ? 'Correct! Marked as Learned.'
                    : 'Not quite — marked for review again.'}
                </span>
                <button
                  onClick={() => handleNext(null)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl shadow-md shadow-indigo-500/20 transition-colors"
                >
                  Next Question
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        ) : (
        <>
        {/* Swipe Indicators */}
        <motion.div style={{ opacity: swipeRightOpacity, pointerEvents: 'none' }} className="absolute left-0 top-1/2 -translate-y-1/2 z-0 flex flex-col items-center text-green-500">
          <MoveRight className="h-10 w-10" />
          <span className="font-bold tracking-widest uppercase mt-2 text-xs">Mastered</span>
        </motion.div>
        <motion.div style={{ opacity: swipeLeftOpacity, pointerEvents: 'none' }} className="absolute right-0 top-1/2 -translate-y-1/2 z-0 flex flex-col items-center text-red-500">
          <MoveLeft className="h-10 w-10" />
          <span className="font-bold tracking-widest uppercase mt-2 text-xs">Again</span>
        </motion.div>
        <motion.div style={{ opacity: swipeDownOpacity, pointerEvents: 'none' }} className="absolute top-[-20px] left-1/2 -translate-x-1/2 z-0 flex flex-col items-center text-blue-500">
          <MoveDown className="h-10 w-10" />
          <span className="font-bold tracking-widest uppercase mt-2 text-xs">Learned</span>
        </motion.div>
        <motion.div style={{ opacity: swipeUpOpacity, pointerEvents: 'none' }} className="absolute bottom-[-10px] left-1/2 -translate-x-1/2 z-0 flex flex-col items-center text-blue-500">
          <MoveUp className="h-10 w-10" />
          <span className="font-bold tracking-widest uppercase mt-2 text-xs">Learned</span>
        </motion.div>

        <div className="relative w-full h-full cursor-pointer group perspective-1000 z-10 mx-auto max-w-sm">
          <motion.div
            className="relative w-full h-full preserve-3d"
            style={{
              transformStyle: 'preserve-3d',
              x,
              y,
              rotateZ: rotate
            }}
            drag={isFlipped}
            dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
            dragElastic={0.8}
            onDragEnd={handleDragEnd}
            onClick={() => setIsFlipped(!isFlipped)}
            whileDrag={{ scale: 1.05, cursor: "grabbing" }}
            initial={false}
            animate={{ rotateY: isFlipped ? 180 : 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 20 }}
          >

            {/* Front of Card - Minimal Design (Word Only) */}
            <div
              className="absolute inset-0 backface-hidden bg-white dark:bg-slate-800 rounded-3xl shadow-xl shadow-slate-200/50 dark:shadow-none border border-slate-100 dark:border-slate-700 flex flex-col items-center justify-center p-8 text-center hover:shadow-2xl transition-shadow"
              style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
            >
              {/* Drag Overlays */}
              <motion.div style={{ opacity: swipeRightOpacity }} className="absolute inset-0 rounded-3xl pointer-events-none bg-green-500/10 dark:bg-green-500/20" />
              <motion.div style={{ opacity: swipeLeftOpacity }} className="absolute inset-0 rounded-3xl pointer-events-none bg-red-500/10 dark:bg-red-500/20" />
              <motion.div style={{ opacity: swipeDownOpacity }} className="absolute inset-0 rounded-3xl pointer-events-none bg-blue-500/10 dark:bg-blue-500/20" />
              <motion.div style={{ opacity: swipeUpOpacity }} className="absolute inset-0 rounded-3xl pointer-events-none bg-blue-500/10 dark:bg-blue-500/20" />

              <div className="relative z-10 flex flex-col items-center w-full">
                {(currentCardComplexity || currentCardChapter) && (
                  <div className="mb-3 flex flex-wrap items-center justify-center gap-1.5">
                    {currentCardComplexity && (
                      <span
                        data-testid="study-card-complexity-badge"
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                          currentCardComplexity === 'advanced'
                            ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800/60'
                            : currentCardComplexity === 'intermediate'
                              ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/60'
                              : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60'
                        }`}
                      >
                        {currentCardComplexity}
                      </span>
                    )}
                    {currentCardChapter && (
                      <span
                        data-testid="study-card-chapter-badge"
                        className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/60"
                      >
                        {currentCardChapter}
                      </span>
                    )}
                  </div>
                )}
                <h2 className="text-5xl font-serif font-bold text-slate-900 dark:text-white mb-6">{currentCard.word}</h2>
                <div className="flex items-center gap-3 justify-center">
                  {currentCard.phonetic && <p className="text-2xl text-slate-400 dark:text-slate-500 font-serif italic">{currentCard.phonetic}</p>}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      playAudio(currentCard.word, currentCard.audio);
                    }}
                    className="p-2 text-slate-400 hover:text-brand-500 hover:bg-brand-50 dark:hover:bg-brand-900/30 rounded-full transition-colors z-10 relative"
                    title="Listen to pronunciation"
                  >
                    <Volume2 className="h-6 w-6" />
                  </button>
                </div>

                {bookSourceTitle && currentCard.example && (
                  <div
                    className="mt-6 w-full flex flex-col items-center"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {!showBookHint ? (
                      <button
                        type="button"
                        data-testid="book-hint-button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowBookHint(true);
                        }}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-all shadow-sm"
                      >
                        <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
                        <span>Show Book Hint</span>
                        <span className="text-[10px] opacity-60 font-mono">(H)</span>
                      </button>
                    ) : (
                      <div
                        data-testid="book-hint-content"
                        className="w-full p-4 rounded-2xl bg-amber-50/80 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/60 text-left space-y-2 animate-in fade-in zoom-in-95 duration-150"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                            <BookOpen className="h-3 w-3 shrink-0" />
                            <span className="truncate">From {bookSourceTitle}</span>
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowBookHint(false);
                            }}
                            className="text-[11px] font-semibold text-amber-700/80 dark:text-amber-400/80 hover:underline shrink-0"
                          >
                            Hide Hint
                          </button>
                        </div>
                        <p className="text-sm italic font-serif text-slate-700 dark:text-slate-200 leading-relaxed max-h-28 overflow-y-auto custom-scrollbar">
                          {renderHighlightedBookSentence(currentCard.example, currentCard.word)}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="absolute bottom-10 text-slate-300 dark:text-slate-600 flex items-center gap-2 opacity-50 group-hover:opacity-100 transition-opacity z-10">
                <RotateCw className="h-4 w-4" />
                <span className="text-xs uppercase tracking-widest font-medium">Click to reveal</span>
              </div>
            </div>

            {/* Back of Card - Definition & Controls */}
            <div
              className="absolute inset-0 backface-hidden rotate-y-180 bg-slate-900 rounded-3xl shadow-xl flex flex-col p-8 text-center overflow-hidden"
              style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
            >
              {/* Drag Overlays */}
              <motion.div style={{ opacity: swipeRightOpacity }} className="absolute inset-0 rounded-3xl pointer-events-none bg-green-500/10" />
              <motion.div style={{ opacity: swipeLeftOpacity }} className="absolute inset-0 rounded-3xl pointer-events-none bg-red-500/10" />
              <motion.div style={{ opacity: swipeDownOpacity }} className="absolute inset-0 rounded-3xl pointer-events-none bg-blue-500/10" />
              <motion.div style={{ opacity: swipeUpOpacity }} className="absolute inset-0 rounded-3xl pointer-events-none bg-blue-500/10" />

              <div className="relative z-10 flex-1 flex flex-col items-center justify-center overflow-y-auto custom-scrollbar w-full">
                <span className="inline-block px-3 py-1 bg-brand-900/50 text-brand-300 text-xs font-bold uppercase tracking-widest rounded-full mb-6">
                  {currentCard.partOfSpeech}
                </span>

                {currentCard.image && (
                  <div className="mb-6 shrink-0 rounded-2xl overflow-hidden shadow-sm border border-slate-700 h-48 flex justify-center bg-slate-800 items-center w-full max-w-sm mx-auto">
                    <img
                      src={currentCard.image}
                      alt={`Visual mnemonic for ${currentCard.word}`}
                      className="max-h-full max-w-full object-contain"
                      loading="lazy"
                    />
                  </div>
                )}

                <p className="text-xl text-slate-50 leading-relaxed font-medium mb-6">
                  {currentCard.mainDefinition}
                </p>
                {currentCard.example && (
                  <div className="bg-slate-800/50 p-4 rounded-xl w-full border border-slate-800">
                    <p className="text-slate-400 italic font-serif text-lg">"{currentCard.example}"</p>
                  </div>
                )}
              </div>

              {/* Integrated Controls */}
              <div className="relative z-10 pt-6 mt-4 border-t border-slate-800 grid grid-cols-3 gap-3 w-full" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => handleNext(1)}
                  className="group/btn flex flex-col items-center justify-center p-3 rounded-xl bg-slate-800 hover:bg-red-900/20 border border-slate-700 hover:border-red-700/50 transition-all text-center relative overflow-hidden"
                >
                  <span className="text-sm font-bold uppercase tracking-wider text-slate-300 group-hover/btn:text-red-400 mb-1 z-10 transition-colors">Again</span>
                  <span className="text-[9px] text-slate-500 leading-tight mb-2 z-10 transition-colors">Study again<br />today</span>
                  <div className="hidden sm:flex text-[10px] items-center gap-1 text-slate-600 bg-slate-900/50 px-2 py-0.5 rounded border border-slate-700/50 z-10 transition-colors"><MoveLeft className="w-3 h-3" /> Swipe</div>
                </button>

                <button
                  onClick={() => handleNext(3)}
                  className="group/btn flex flex-col items-center justify-center p-3 rounded-xl bg-slate-800 hover:bg-blue-900/20 border border-slate-700 hover:border-blue-700/50 transition-all text-center relative overflow-hidden"
                >
                  <span className="text-sm font-bold uppercase tracking-wider text-slate-300 group-hover/btn:text-blue-400 mb-1 z-10 transition-colors">Learned</span>
                  <span className="text-[9px] text-slate-500 leading-tight mb-2 z-10 transition-colors">Pushes to<br />tomorrow</span>
                  <div className="hidden sm:flex text-[10px] items-center gap-1 text-slate-600 bg-slate-900/50 px-2 py-0.5 rounded border border-slate-700/50 z-10 transition-colors"><MoveDown className="w-3 h-3" /><MoveUp className="w-3 h-3" /> Swipe</div>
                </button>

                <button
                  onClick={() => handleNext(5)}
                  className="group/btn flex flex-col items-center justify-center p-3 rounded-xl bg-slate-800 hover:bg-green-900/20 border border-slate-700 hover:border-green-700/50 transition-all text-center relative overflow-hidden"
                >
                  <span className="text-sm font-bold uppercase tracking-wider text-slate-300 group-hover/btn:text-green-400 mb-1 z-10 transition-colors">Mastered</span>
                  <span className="text-[9px] text-slate-500 leading-tight mb-2 z-10 transition-colors">Remove from<br />sessions</span>
                  <div className="hidden sm:flex text-[10px] items-center gap-1 text-slate-600 bg-slate-900/50 px-2 py-0.5 rounded border border-slate-700/50 z-10 transition-colors"><MoveRight className="w-3 h-3" /> Swipe</div>
                </button>
              </div>
            </div>
          </motion.div>
        </div>
        </>
        )}
      </div>
    </div>
  );
};
