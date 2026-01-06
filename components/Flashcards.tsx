import React, { useState } from 'react';
import { Flashcard, FlashcardStatus } from '../types';
import { Play, BookOpen, CheckCircle, Brain, Trash2, RotateCw, Upload } from 'lucide-react';

interface FlashcardsProps {
  cards: Flashcard[];
  onStartStudy: () => void;
  onDeleteCard: (id: string) => void;
  onUpdateStatus: (id: string, status: FlashcardStatus) => void;
  onOpenImport: () => void;
}

const FlashcardItem: React.FC<{
  card: Flashcard;
  onDelete: (id: string) => void;
  onUpdate: (id: string, status: FlashcardStatus) => void;
}> = ({ card, onDelete, onUpdate }) => {
  const [isFlipped, setIsFlipped] = useState(false);

  return (
    <div
      className="group h-80 w-full perspective-1000 cursor-pointer"
      onClick={() => setIsFlipped(!isFlipped)}
    >
      <div className={`relative w-full h-full duration-500 preserve-3d transition-transform ${isFlipped ? 'rotate-y-180' : ''}`} style={{ transformStyle: 'preserve-3d' }}>
        {/* Front of Card */}
        <div className="absolute inset-0 backface-hidden bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col items-center justify-center text-center hover:shadow-md hover:border-brand-200 transition-all">
          <span className={`absolute top-4 right-4 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider
            ${card.status === FlashcardStatus.New ? 'bg-blue-100 text-blue-700' :
              card.status === FlashcardStatus.Learning ? 'bg-amber-100 text-amber-700' :
                'bg-green-100 text-green-700'}`}>
            {card.status}
          </span>

          <h3 className="text-3xl font-serif font-bold text-slate-900 mb-2">{card.word}</h3>
          <p className="text-slate-500 italic font-serif">{card.partOfSpeech}</p>
          {card.phonetic && <p className="text-slate-400 text-sm mt-1">{card.phonetic}</p>}

          <div className="absolute bottom-6 text-slate-300 group-hover:text-brand-400 transition-colors flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider">
            <RotateCw className="h-3.5 w-3.5" />
            Tap to reveal
          </div>
        </div>

        {/* Back of Card */}
        <div className="absolute inset-0 backface-hidden rotate-y-180 bg-slate-900 rounded-2xl shadow-xl p-6 flex flex-col items-center justify-between text-center overflow-hidden border border-slate-800">
          <div className="overflow-y-auto w-full flex-1 flex flex-col items-center justify-center custom-scrollbar px-2">
            <p className="text-slate-100 text-lg font-medium leading-relaxed mb-4">
              {card.mainDefinition}
            </p>
            {card.example && (
              <p className="text-slate-400 text-sm italic border-t border-slate-700 pt-3 mt-auto w-full">
                "{card.example}"
              </p>
            )}
          </div>

          <div className="pt-4 w-full flex items-center justify-center gap-3 border-t border-slate-800 mt-2" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => onUpdate(card.id, FlashcardStatus.Learning)}
              className={`flex-1 flex flex-col items-center gap-1 p-2 rounded-lg transition-colors
                ${card.status === FlashcardStatus.Learning
                  ? 'bg-amber-500/20 text-amber-400'
                  : 'text-slate-500 hover:bg-slate-800 hover:text-amber-400'}`}
              title="Needs work"
            >
              <Brain className="h-5 w-5" />
              <span className="text-[10px] font-bold uppercase">Needs Work</span>
            </button>

            <button
              onClick={() => onUpdate(card.id, FlashcardStatus.Mastered)}
              className={`flex-1 flex flex-col items-center gap-1 p-2 rounded-lg transition-colors
                ${card.status === FlashcardStatus.Mastered
                  ? 'bg-green-500/20 text-green-400'
                  : 'text-slate-500 hover:bg-slate-800 hover:text-green-400'}`}
              title="Mastered"
            >
              <CheckCircle className="h-5 w-5" />
              <span className="text-[10px] font-bold uppercase">Mastered</span>
            </button>

            <div className="w-px h-8 bg-slate-800 mx-1"></div>

            <button
              onClick={() => onDelete(card.id)}
              className="p-2 text-slate-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
              title="Delete Card"
            >
              <Trash2 className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export const Flashcards: React.FC<FlashcardsProps> = ({ cards, onStartStudy, onDeleteCard, onUpdateStatus, onOpenImport }) => {
  const [selectedStatus, setSelectedStatus] = useState<FlashcardStatus | null>(null);

  const newCount = cards.filter(c => c.status === FlashcardStatus.New).length;
  const learningCount = cards.filter(c => c.status === FlashcardStatus.Learning).length;
  const masteredCount = cards.filter(c => c.status === FlashcardStatus.Mastered).length;
  const studyQueueCount = newCount + learningCount;

  const filteredCards = selectedStatus
    ? cards.filter(c => c.status === selectedStatus)
    : cards;

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
        <div className="bg-slate-100 p-6 rounded-full">
          <BookOpen className="h-12 w-12 text-slate-400" />
        </div>
        <div className="space-y-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Your deck is empty</h2>
            <p className="text-slate-500 max-w-sm mx-auto mt-2">
              Search for words in the dictionary to add them, or import a previous backup.
            </p>
          </div>
          <button
            onClick={onOpenImport}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-white border border-slate-300 rounded-xl text-slate-700 font-medium hover:bg-slate-50 hover:text-brand-600 hover:border-brand-200 transition-all shadow-sm"
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
            <h1 className="text-3xl font-serif font-bold text-slate-900">My Deck</h1>
            <p className="text-slate-500 mt-1">{cards.length} cards total</p>
          </div>
          <button
            onClick={onStartStudy}
            disabled={studyQueueCount === 0}
            className={`flex items-center gap-2 px-6 py-3 rounded-xl font-medium shadow-lg transition-all 
              ${studyQueueCount > 0
                ? 'bg-brand-600 hover:bg-brand-700 text-white shadow-brand-500/30 hover:scale-105 active:scale-95'
                : 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
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
                base: 'bg-blue-50 border-blue-100',
                hover: 'hover:bg-blue-100 hover:border-blue-200',
                selected: 'bg-blue-100 border-blue-300 ring-blue-400',
                textData: { base: 'text-blue-600', hover: 'group-hover:text-blue-700', selected: 'text-blue-800' }
              }
            },
            {
              status: FlashcardStatus.Learning,
              label: 'Learning',
              icon: Brain,
              count: learningCount,
              styles: {
                base: 'bg-amber-50 border-amber-100',
                hover: 'hover:bg-amber-100 hover:border-amber-200',
                selected: 'bg-amber-100 border-amber-300 ring-amber-400',
                textData: { base: 'text-amber-600', hover: 'group-hover:text-amber-700', selected: 'text-amber-800' }
              }
            },
            {
              status: FlashcardStatus.Mastered,
              label: 'Mastered',
              icon: CheckCircle,
              count: masteredCount,
              styles: {
                base: 'bg-green-50 border-green-100',
                hover: 'hover:bg-green-100 hover:border-green-200',
                selected: 'bg-green-100 border-green-300 ring-green-400',
                textData: { base: 'text-green-600', hover: 'group-hover:text-green-700', selected: 'text-green-800' }
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
                      ? `${category.styles.selected} ring-2 ring-offset-2 ring-offset-slate-50 scale-[1.02] shadow-md`
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
                  <div className="p-2 bg-white rounded-lg shadow-sm">
                    <category.icon className="h-5 w-5" />
                  </div>
                  <span>{category.label}</span>
                </div>
                <p className="text-2xl font-bold text-slate-900">{category.count}</p>
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
              onUpdate={onUpdateStatus}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
          <BookOpen className="h-10 w-10 mb-4 opacity-20" />
          <p>No cards found in this category</p>
          <button
            onClick={() => setSelectedStatus(null)}
            className="mt-4 text-brand-600 font-medium hover:underline"
          >
            Show all cards
          </button>
        </div>
      )}
    </div>
  );
};