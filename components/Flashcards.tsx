import React, { useState } from 'react';
import { Flashcard, FlashcardStatus } from '../types';
import { Play, BookOpen, CheckCircle, Brain, Trash2, RotateCw, Upload, Volume2, ThumbsUp, Zap } from 'lucide-react';
import { motion } from 'framer-motion';

interface FlashcardsProps {
  cards: Flashcard[];
  onStartStudy: () => void;
  onDeleteCard: (id: string) => void;
  onReviewCard: (id: string, quality: number) => void;
  onOpenImport: () => void;
}

const FlashcardItem: React.FC<{
  card: Flashcard;
  onDelete: (id: string) => void;
  onReview: (id: string, quality: number) => void;
}> = ({ card, onDelete, onReview }) => {
  const [isFlipped, setIsFlipped] = useState(false);

  return (
    <div
      className="group h-80 w-full perspective-1000 cursor-pointer"
      onClick={() => setIsFlipped(!isFlipped)}
    >
      <motion.div
        className="relative w-full h-full preserve-3d"
        style={{ transformStyle: 'preserve-3d' }}
        initial={false}
        animate={{ rotateY: isFlipped ? 180 : 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 20 }}
      >
        {/* Front of Card */}
        <div
          className="absolute inset-0 backface-hidden bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 flex flex-col items-center justify-center text-center hover:shadow-md hover:border-brand-200 transition-all"
          style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
        >
          <div className="absolute top-4 right-4 flex items-center gap-1.5 pl-2">
            {/* Added logic for displaying the due string for Learning cards */}
            {card.status === FlashcardStatus.Learning && card.nextReviewDate && (
              <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded-md">
                {card.nextReviewDate <= Date.now() ? 'Due Today' : `in ${Math.max(1, Math.ceil((card.nextReviewDate - Date.now()) / (1000 * 60 * 60 * 24)))} days`}
              </span>
            )}
            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider
              ${card.status === FlashcardStatus.New ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' :
                card.status === FlashcardStatus.Learning ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' :
                  'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'}`}>
              {card.status}
            </span>
          </div>

          <h3 className="text-3xl font-serif font-bold text-slate-900 dark:text-white mb-2">{card.word}</h3>
          <p className="text-slate-500 dark:text-slate-400 italic font-serif">{card.partOfSpeech}</p>
          <div className="flex items-center gap-2 mt-1">
            {card.phonetic && <p className="text-slate-400 text-sm">{card.phonetic}</p>}
            {card.audio && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  new Audio(card.audio!).play();
                }}
                className="p-1 text-slate-400 hover:text-brand-500 hover:bg-brand-50 rounded-full transition-colors"
                title="Listen to pronunciation"
              >
                <Volume2 className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="absolute bottom-6 text-slate-300 dark:text-slate-600 group-hover:text-brand-400 transition-colors flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider">
            <RotateCw className="h-3.5 w-3.5" />
            Tap to reveal
          </div>
        </div>

        {/* Back of Card */}
        <div
          className="absolute inset-0 backface-hidden rotate-y-180 bg-slate-900 rounded-2xl shadow-xl p-6 flex flex-col items-center justify-between text-center overflow-hidden border border-slate-800"
          style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
        >
          <div className="overflow-y-auto w-full flex-1 flex flex-col items-center justify-start custom-scrollbar px-2 py-4">
            {card.image && (
              <div className="mb-4 shrink-0 rounded-xl overflow-hidden shadow-sm border border-slate-700 h-32 flex justify-center bg-slate-800 items-center w-full mt-auto">
                <img
                  src={card.image}
                  alt={`Visual mnemonic for ${card.word}`}
                  className="max-h-full max-w-full object-contain"
                  loading="lazy"
                />
              </div>
            )}
            <p className="text-slate-100 text-lg font-medium leading-relaxed mb-auto w-full text-center">
              {card.mainDefinition}
            </p>
            {card.example && (
              <p className="text-slate-400 text-sm italic border-t border-slate-700 pt-3 mt-auto w-full">
                "{card.example}"
              </p>
            )}
          </div>

          <div className="pt-4 w-full grid grid-cols-4 gap-1 border-t border-slate-800 mt-2" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => onReview(card.id, 1)}
              className={`flex flex-col items-center justify-center gap-1 p-1.5 rounded-lg transition-colors 
                ${card.lastQuality === 1
                  ? 'bg-red-500/20 text-red-400'
                  : 'text-slate-500 hover:bg-slate-800 hover:text-red-400'}`}
              title="Again"
            >
              <RotateCw className="h-4 w-4" />
              <span className="text-[8px] font-bold uppercase">Again</span>
            </button>
            <button
              onClick={() => onReview(card.id, 3)}
              className={`flex flex-col items-center justify-center gap-1 p-1.5 rounded-lg transition-colors
                ${card.lastQuality === 3
                  ? 'bg-blue-500/20 text-blue-400'
                  : 'text-slate-500 hover:bg-slate-800 hover:text-blue-400'}`}
              title="Learned"
            >
              <Brain className="h-4 w-4" />
              <span className="text-[8px] font-bold uppercase">Learned</span>
            </button>
            <button
              onClick={() => onReview(card.id, 5)}
              className={`flex flex-col items-center justify-center gap-1 p-1.5 rounded-lg transition-colors
                ${card.lastQuality === 5
                  ? 'bg-green-500/20 text-green-400'
                  : 'text-slate-500 hover:bg-slate-800 hover:text-green-400'}`}
              title="Mastered"
            >
              <CheckCircle className="h-4 w-4" />
              <span className="text-[8px] font-bold uppercase">Mastered</span>
            </button>
            <div className="flex border-l border-slate-700 justify-center items-center ml-1 pl-1">
              <button
                onClick={() => onDelete(card.id)}
                className="p-1.5 text-slate-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                title="Delete Card"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export const Flashcards: React.FC<FlashcardsProps> = ({ cards, onStartStudy, onDeleteCard, onReviewCard, onOpenImport }) => {
  const [selectedStatus, setSelectedStatus] = useState<FlashcardStatus | null>(null);

  const newCount = cards.filter(c => c.status === FlashcardStatus.New).length;
  const learningCount = cards.filter(c => c.status === FlashcardStatus.Learning).length;
  const masteredCount = cards.filter(c => c.status === FlashcardStatus.Mastered).length;

  const studyQueueCount = cards.filter(c => {
    if (c.status === FlashcardStatus.Mastered) return false;
    if (c.status === FlashcardStatus.New) return true;
    if (c.nextReviewDate) {
      return c.nextReviewDate <= Date.now();
    }
    return true;
  }).length;

  let filteredCards = selectedStatus
    ? cards.filter(c => c.status === selectedStatus)
    : cards;

  if (selectedStatus === FlashcardStatus.Learning) {
    filteredCards = [...filteredCards].sort((a, b) => {
      const dateA = a.nextReviewDate || Infinity;
      const dateB = b.nextReviewDate || Infinity;
      return dateA - dateB;
    });
  }

  const handleStatusClick = (status: FlashcardStatus) => {
    if (selectedStatus === status) {
      setSelectedStatus(null);
    } else {
      setSelectedStatus(status);
    }
  };



  if (cards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center space-y-6 animate-in fade-in zoom-in duration-500">
        <div className="bg-slate-100 dark:bg-slate-800 p-6 rounded-full">
          <BookOpen className="h-12 w-12 text-slate-400" />
        </div>
        <div className="space-y-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Your deck is empty</h2>
            <p className="text-slate-500 dark:text-slate-400 max-w-sm mx-auto mt-2">
              Search for words in the dictionary to add them, or import a previous backup.
            </p>
          </div>
          <button
            onClick={onOpenImport}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-xl text-slate-700 dark:text-slate-200 font-medium hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-brand-600 dark:hover:text-brand-400 hover:border-brand-200 transition-all shadow-sm"
          >
            <Upload className="h-4 w-4" />
            Import CSV
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header and Stats */}
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row gap-6 justify-between items-end">
          <div>
            <h1 className="text-3xl font-serif font-bold text-slate-900 dark:text-white">My Deck</h1>
            <p className="text-slate-500 dark:text-slate-400 mt-1">{cards.length} cards total</p>
          </div>
          <button
            onClick={onStartStudy}
            disabled={studyQueueCount === 0}
            className={`flex items-center gap-2 px-6 py-3 rounded-xl font-medium shadow-lg transition-all 
              ${studyQueueCount > 0
                ? 'bg-brand-600 hover:bg-brand-700 text-white shadow-brand-500/30 hover:scale-105 active:scale-95'
                : 'bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed shadow-none'
              }`}
          >
            {studyQueueCount > 0 ? (
              <>
                <Play className="h-5 w-5 fill-current" />
                Start Study Session
              </>
            ) : (
              <>
                <CheckCircle className="h-5 w-5" />
                All Mastered
              </>
            )}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              status: FlashcardStatus.New,
              label: 'New',
              icon: BookOpen,
              count: newCount,
              styles: {
                base: 'bg-blue-50 dark:bg-blue-900/20 border-blue-100 dark:border-blue-800/40',
                hover: 'hover:bg-blue-100 dark:hover:bg-blue-900/30 hover:border-blue-200',
                selected: 'bg-blue-100 dark:bg-blue-900/30 border-blue-300 ring-blue-400',
                textData: { base: 'text-blue-600 dark:text-blue-400', hover: 'group-hover:text-blue-700', selected: 'text-blue-800 dark:text-blue-300' }
              }
            },
            {
              status: FlashcardStatus.Learning,
              label: 'Learning',
              icon: Brain,
              count: learningCount,
              styles: {
                base: 'bg-amber-50 dark:bg-amber-900/20 border-amber-100 dark:border-amber-800/40',
                hover: 'hover:bg-amber-100 dark:hover:bg-amber-900/30 hover:border-amber-200',
                selected: 'bg-amber-100 dark:bg-amber-900/30 border-amber-300 ring-amber-400',
                textData: { base: 'text-amber-600 dark:text-amber-400', hover: 'group-hover:text-amber-700', selected: 'text-amber-800 dark:text-amber-300' }
              }
            },
            {
              status: FlashcardStatus.Mastered,
              label: 'Mastered',
              icon: CheckCircle,
              count: masteredCount,
              styles: {
                base: 'bg-green-50 dark:bg-green-900/20 border-green-100 dark:border-green-800/40',
                hover: 'hover:bg-green-100 dark:hover:bg-green-900/30 hover:border-green-200',
                selected: 'bg-green-100 dark:bg-green-900/30 border-green-300 ring-green-400',
                textData: { base: 'text-green-600 dark:text-green-400', hover: 'group-hover:text-green-700', selected: 'text-green-800 dark:text-green-300' }
              }
            }
          ].map((category) => {
            const isSelected = selectedStatus === category.status;
            const isOthersSelected = selectedStatus !== null && !isSelected;

            return (
              <div
                key={category.status}
                onClick={() => handleStatusClick(category.status)}
                className={`p-4 rounded-2xl flex items-center justify-between cursor-pointer transition-all duration-200 border group
                  ${isOthersSelected
                    ? `${category.styles.base} opacity-50 grayscale-[0.5]`
                    : isSelected
                      ? `${category.styles.selected} ring-2 ring-offset-2 ring-offset-slate-50 dark:ring-offset-slate-900 scale-[1.02] shadow-md`
                      : `${category.styles.base} ${category.styles.hover} hover:scale-[1.01] hover:shadow-sm`
                  }
                `}
              >
                <div className={`flex items-center gap-3 transition-colors duration-200
                  ${isSelected
                    ? `${category.styles.textData.selected} font-extrabold`
                    : `${category.styles.textData.base} font-semibold ${category.styles.textData.hover} group-hover:font-bold`
                  }
                `}>
                  <div className="p-2 bg-white dark:bg-slate-700 rounded-lg shadow-sm">
                    <category.icon className="h-5 w-5" />
                  </div>
                  <span>{category.label}</span>
                </div>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">{category.count}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Grid of Flashcards */}
      {filteredCards.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 pb-20">
          {filteredCards.map((card) => (
            <FlashcardItem
              key={card.id}
              card={card}
              onDelete={onDeleteCard}
              onReview={onReviewCard}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400 dark:text-slate-600">
          <BookOpen className="h-10 w-10 mb-4 opacity-20" />
          <p>No cards found in this category</p>
          <button
            onClick={() => setSelectedStatus(null)}
            className="mt-4 text-brand-600 dark:text-brand-400 font-medium hover:underline"
          >
            Show all cards
          </button>
        </div>
      )}
    </div>
  );
};