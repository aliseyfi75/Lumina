import React, { useState, useEffect } from 'react';
import { Flashcard, FlashcardStatus } from '../types';
import { RotateCw, CheckCircle, Brain, ArrowLeft } from 'lucide-react';

interface StudySessionProps {
  cards: Flashcard[];
  onUpdateStatus: (id: string, status: FlashcardStatus) => void;
  onExit: () => void;
}

export const StudySession: React.FC<StudySessionProps> = ({ cards, onUpdateStatus, onExit }) => {
  const [queue, setQueue] = useState<Flashcard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    // Filter out Mastered cards so they don't appear in the session
    const validCards = cards.filter(c => c.status !== FlashcardStatus.Mastered);
    
    // Shuffle
    const studySet = [...validCards].sort(() => Math.random() - 0.5);
    
    setQueue(studySet);
    setIsInitialized(true);
    // We intentionally use an empty dependency array here.
    // This creates a stable "snapshot" of the cards when the session mounts.
    // We don't want the queue to re-shuffle or reset every time a card status is updated in the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentCard = queue[currentIndex];

  const handleNext = (status: FlashcardStatus) => {
    if (!currentCard) return;

    onUpdateStatus(currentCard.id, status);
    
    // Flip back first
    setIsFlipped(false);
    
    // Wait for flip to partially complete before changing content
    setTimeout(() => {
        setCurrentIndex(prev => prev + 1);
    }, 300);
  };

  if (!isInitialized) return null;

  if (!currentCard) {
    const isAllMastered = cards.length > 0 && cards.every(c => c.status === FlashcardStatus.Mastered);

    return (
       <div className="flex flex-col items-center justify-center h-[60vh] space-y-6 animate-in fade-in slide-in-from-bottom-4">
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
            className="px-8 py-3 bg-slate-900 text-white rounded-xl font-medium hover:bg-slate-800 transition-colors shadow-lg shadow-slate-900/20"
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
          <div className={`relative w-full h-full duration-500 preserve-3d transition-transform ${isFlipped ? 'rotate-y-180' : ''}`} style={{ transformStyle: 'preserve-3d' }}>
            
            {/* Front of Card - Minimal Design (Word Only) */}
            <div className="absolute inset-0 backface-hidden bg-white rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-100 flex flex-col items-center justify-center p-8 text-center hover:shadow-2xl transition-shadow">
               <h2 className="text-5xl font-serif font-bold text-slate-900 mb-6">{currentCard.word}</h2>
               {currentCard.phonetic && <p className="text-2xl text-slate-400 font-serif italic">{currentCard.phonetic}</p>}
               
               <div className="absolute bottom-10 text-slate-300 flex items-center gap-2 opacity-50 group-hover:opacity-100 transition-opacity">
                  <RotateCw className="h-4 w-4" />
                  <span className="text-xs uppercase tracking-widest font-medium">Click to reveal</span>
               </div>
            </div>

            {/* Back of Card - Definition & Controls */}
            <div className="absolute inset-0 backface-hidden rotate-y-180 bg-slate-900 rounded-3xl shadow-xl flex flex-col p-8 text-center overflow-hidden">
               <div className="flex-1 flex flex-col items-center justify-center overflow-y-auto custom-scrollbar w-full">
                   <span className="inline-block px-3 py-1 bg-brand-900/50 text-brand-300 text-xs font-bold uppercase tracking-widest rounded-full mb-6">
                    {currentCard.partOfSpeech}
                   </span>
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
               <div className="pt-6 mt-4 border-t border-slate-800 grid grid-cols-2 gap-4 w-full" onClick={(e) => e.stopPropagation()}>
                    <button 
                       onClick={() => handleNext(FlashcardStatus.Learning)}
                       className="group/btn flex flex-col items-center justify-center gap-2 p-4 rounded-xl bg-slate-800 hover:bg-amber-900/20 border border-slate-700 hover:border-amber-700/50 transition-all"
                    >
                        <Brain className="h-6 w-6 text-slate-400 group-hover/btn:text-amber-400 transition-colors" />
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-400 group-hover/btn:text-amber-400">Needs Work</span>
                    </button>
                    
                    <button 
                       onClick={() => handleNext(FlashcardStatus.Mastered)}
                       className="group/btn flex flex-col items-center justify-center gap-2 p-4 rounded-xl bg-slate-800 hover:bg-green-900/20 border border-slate-700 hover:border-green-700/50 transition-all"
                    >
                        <CheckCircle className="h-6 w-6 text-slate-400 group-hover/btn:text-green-400 transition-colors" />
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-400 group-hover/btn:text-green-400">Mastered</span>
                    </button>
               </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};