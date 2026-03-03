import React, { useState, useEffect } from 'react';
import { Flashcard, FlashcardStatus } from '../types';
import { RotateCw, CheckCircle, Brain, ArrowLeft, Volume2 } from 'lucide-react';
import Confetti from 'react-confetti';
import { useWindowSize } from 'react-use';
import { motion } from 'framer-motion';

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

  useEffect(() => {
    const dueCards = cards.filter(c => {
      if (c.status === FlashcardStatus.Mastered) return false;
      if (c.status === FlashcardStatus.New) return true;
      if (c.nextReviewDate) {
        return c.nextReviewDate <= Date.now();
      }
      return true;
    });

    // Shuffle
    const studySet = [...dueCards].sort(() => Math.random() - 0.5);

    setQueue(studySet);
    setIsInitialized(true);
    // We intentionally use an empty dependency array here.
    // This creates a stable "snapshot" of the cards when the session mounts.
    // We don't want the queue to re-shuffle or reset every time a card status is updated in the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentCard = queue[currentIndex];

  const handleNext = (quality: number) => {
    if (!currentCard) return;

    onReviewCard(currentCard.id, quality);

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
        <div className="p-6 bg-green-50 rounded-full">
          <CheckCircle className="h-16 w-16 text-green-500" />
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-3xl font-serif font-bold text-slate-900">
            {isAllMastered ? "All Cards Mastered!" : "Session Complete!"}
          </h2>
          <p className="text-slate-500">
            {isAllMastered ? "Great job! You've mastered all your cards." : "You've reviewed all your cards for now."}
          </p>
        </div>
        <button
          onClick={onExit}
          className="px-8 py-3 bg-slate-900 text-white rounded-xl font-medium hover:bg-slate-800 transition-colors shadow-lg shadow-slate-900/20 z-10"
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
          className="p-2 -ml-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full transition-colors"
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
        <div className="flex-1 mx-8 bg-slate-200 rounded-full h-2">
          <div
            className="bg-brand-500 h-2 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-sm font-medium text-slate-500 tabular-nums">
          {currentIndex + 1} / {queue.length}
        </span>
      </div>

      <div className="flex-1 relative perspective-1000 mb-8">
        <div
          className="relative w-full h-full cursor-pointer group perspective-1000"
          onClick={() => setIsFlipped(!isFlipped)}
        >
          <motion.div
            className="relative w-full h-full preserve-3d"
            style={{ transformStyle: 'preserve-3d' }}
            initial={false}
            animate={{ rotateY: isFlipped ? 180 : 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 20 }}
          >

            {/* Front of Card - Minimal Design (Word Only) */}
            <div
              className="absolute inset-0 backface-hidden bg-white rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-100 flex flex-col items-center justify-center p-8 text-center hover:shadow-2xl transition-shadow"
              style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
            >
              <h2 className="text-5xl font-serif font-bold text-slate-900 mb-6">{currentCard.word}</h2>
              <div className="flex items-center gap-3">
                {currentCard.phonetic && <p className="text-2xl text-slate-400 font-serif italic">{currentCard.phonetic}</p>}
                {currentCard.audio && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      new Audio(currentCard.audio!).play();
                    }}
                    className="p-2 text-slate-400 hover:text-brand-500 hover:bg-brand-50 rounded-full transition-colors z-10 relative"
                    title="Listen to pronunciation"
                  >
                    <Volume2 className="h-6 w-6" />
                  </button>
                )}
              </div>

              <div className="absolute bottom-10 text-slate-300 flex items-center gap-2 opacity-50 group-hover:opacity-100 transition-opacity">
                <RotateCw className="h-4 w-4" />
                <span className="text-xs uppercase tracking-widest font-medium">Click to reveal</span>
              </div>
            </div>

            {/* Back of Card - Definition & Controls */}
            <div
              className="absolute inset-0 backface-hidden rotate-y-180 bg-slate-900 rounded-3xl shadow-xl flex flex-col p-8 text-center overflow-hidden"
              style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
            >
              <div className="flex-1 flex flex-col items-center justify-center overflow-y-auto custom-scrollbar w-full">
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
              <div className="pt-6 mt-4 border-t border-slate-800 grid grid-cols-3 gap-3 w-full" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => handleNext(1)}
                  className="group/btn flex flex-col items-center justify-center p-3 rounded-xl bg-slate-800 hover:bg-red-900/20 border border-slate-700 hover:border-red-700/50 transition-all text-center"
                >
                  <span className="text-sm font-bold uppercase tracking-wider text-slate-300 group-hover/btn:text-red-400 mb-1">Again</span>
                  <span className="text-[9px] text-slate-500 leading-tight">Study again<br />today</span>
                </button>

                <button
                  onClick={() => handleNext(3)}
                  className="group/btn flex flex-col items-center justify-center p-3 rounded-xl bg-slate-800 hover:bg-blue-900/20 border border-slate-700 hover:border-blue-700/50 transition-all text-center"
                >
                  <span className="text-sm font-bold uppercase tracking-wider text-slate-300 group-hover/btn:text-blue-400 mb-1">Learned</span>
                  <span className="text-[9px] text-slate-500 leading-tight">Pushes to<br />tomorrow/next week</span>
                </button>

                <button
                  onClick={() => handleNext(5)}
                  className="group/btn flex flex-col items-center justify-center p-3 rounded-xl bg-slate-800 hover:bg-green-900/20 border border-slate-700 hover:border-green-700/50 transition-all text-center"
                >
                  <span className="text-sm font-bold uppercase tracking-wider text-slate-300 group-hover/btn:text-green-400 mb-1">Mastered</span>
                  <span className="text-[9px] text-slate-500 leading-tight">Remove from<br />study sessions</span>
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
};