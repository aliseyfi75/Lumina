import React, { useState, useEffect, useCallback } from 'react';
import { Flashcard, FlashcardStatus } from '../types';
import { RotateCw, CheckCircle, Brain, ArrowLeft, Volume2, MoveUp, MoveDown, MoveLeft, MoveRight } from 'lucide-react';
import Confetti from 'react-confetti';
import { useWindowSize } from 'react-use';
import { motion, useMotionValue, useTransform, PanInfo, AnimatePresence } from 'framer-motion';
import { useLocation } from 'react-router-dom';
import { playAudio } from '../utils/audio';

interface StudySessionProps {
  cards: Flashcard[];
  onReviewCard: (id: string, quality: number) => void;
  onSessionComplete: () => void;
  onExit: () => void;
}

export const StudySession: React.FC<StudySessionProps> = ({ cards, onReviewCard, onSessionComplete, onExit }) => {
  const [queue, setQueue] = useState<Flashcard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  const { width, height } = useWindowSize();
  const [showConfetti, setShowConfetti] = useState(false);
  const [actionToast, setActionToast] = useState<{ message: string; colorClass: string; bgColorClass: string } | null>(null);

  const location = useLocation();

  useEffect(() => {
    const dueCards = cards.filter(c => {
      if (c.status === FlashcardStatus.Mastered) return false;
      if (c.status === FlashcardStatus.New) return true;
      if (c.nextReviewDate) {
        return c.nextReviewDate <= Date.now();
      }
      return true;
    });

    const sessionConfig = location.state?.sessionConfig as { mode: 'full' | 'short'; count?: number } | undefined;

    let studySet: Flashcard[] = [];

    if (sessionConfig?.mode === 'short' && sessionConfig.count) {
      const newCards = dueCards.filter(c => c.status === FlashcardStatus.New).sort(() => Math.random() - 0.5);
      const otherCards = dueCards.filter(c => c.status !== FlashcardStatus.New).sort(() => Math.random() - 0.5);

      studySet = [...newCards, ...otherCards].slice(0, sessionConfig.count).sort(() => Math.random() - 0.5);
    } else {
      studySet = [...dueCards].sort(() => Math.random() - 0.5);
    }

    setQueue(studySet);
    setIsInitialized(true);
    // We intentionally use an empty dependency array here.
    // This creates a stable "snapshot" of the cards when the session mounts.
    // We don't want the queue to re-shuffle or reset every time a card status is updated in the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentCard = queue[currentIndex];

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
    }, 300);
  }, [currentCard, onReviewCard, queue.length, onSessionComplete, x, y]);

  // Keyboard support for desktop
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!currentCard) return;
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;

      switch (e.key) {
        case 'ArrowLeft':
          handleNext(1);
          break;
        case 'ArrowRight':
          handleNext(5);
          break;
        case 'ArrowDown':
        case 'ArrowUp':
          handleNext(3);
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
  }, [handleNext, currentCard]);

  const handleDragEnd = (event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
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

    return (
      <div className="flex flex-col items-center justify-center h-[60vh] space-y-6 animate-in fade-in slide-in-from-bottom-4">
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
        <div className="p-6 bg-green-50 dark:bg-green-900/20 rounded-full">
          <CheckCircle className="h-16 w-16 text-green-500" />
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-3xl font-serif font-bold text-slate-900 dark:text-white">
            {isAllMastered ? "All Cards Mastered!" : "Session Complete!"}
          </h2>
          <p className="text-slate-500 dark:text-slate-400">
            {isAllMastered ? "Great job! You've mastered all your cards." : "You've reviewed all your cards for now."}
          </p>
        </div>
        <button
          onClick={onExit}
          className="px-8 py-3 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-xl font-medium hover:bg-slate-800 dark:hover:bg-white transition-colors shadow-lg shadow-slate-900/20 z-10"
        >
          Return to Dashboard
        </button>
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
        <div className="flex-1 mx-8 bg-slate-200 dark:bg-slate-700 rounded-full h-2">
          <div
            className="bg-brand-500 h-2 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-sm font-medium text-slate-500 dark:text-slate-400 tabular-nums">
          {currentIndex + 1} / {queue.length}
        </span>
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
            drag
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
                  <div className="hidden sm:flex text-[10px] items-center gap-1 text-slate-600 bg-slate-900/50 px-2 py-0.5 rounded border border-slate-700/50 z-10 transition-colors"><MoveDown className="w-3 h-3" /> Swipe</div>
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
      </div>
    </div>
  );
};