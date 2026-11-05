import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Flashcard, FlashcardStatus } from '../types';
import { Play, BookOpen, CheckCircle, Brain, Trash2, RotateCw, Upload, Volume2, ChevronDown, Search, X, ArrowUpDown, Filter, Plus, Pencil, Tag } from 'lucide-react';
import { motion } from 'framer-motion';
import { playAudio } from '../utils/audio';
import { getDueCards } from '../utils/studyUtils';

const PAGE_SIZE = 24;

export type FlashcardSortOption = 'priority' | 'newest' | 'oldest' | 'alpha' | 'due';

export interface CustomCardFormData {
  word: string;
  partOfSpeech: string;
  phonetic?: string;
  mainDefinition: string;
  example?: string;
  image?: string;
  tags?: string[];
}

interface FlashcardsProps {
  cards: Flashcard[];
  onStartStudy: () => void;
  onDeleteCard: (id: string) => void;
  onReviewCard: (id: string, quality: number) => void;
  onCreateCard?: (data: CustomCardFormData) => void;
  onUpdateCard?: (id: string, updates: CustomCardFormData) => void;
  onOpenImport: () => void;
}

const FlashcardItem: React.FC<{
  card: Flashcard;
  onDelete: (id: string) => void;
  onReview: (id: string, quality: number) => void;
  onEdit: (card: Flashcard) => void;
}> = ({ card, onDelete, onReview, onEdit }) => {
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
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit(card);
            }}
            aria-label={`Edit ${card.word}`}
            title="Edit Card"
            className="absolute top-3.5 left-3.5 p-1.5 text-slate-400 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>

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
            <button
              onClick={(e) => {
                e.stopPropagation();
                playAudio(card.word, card.audio);
              }}
              className="p-1 text-slate-400 hover:text-brand-500 hover:bg-brand-50 rounded-full transition-colors"
              title="Listen to pronunciation"
            >
              <Volume2 className="h-4 w-4" />
            </button>
          </div>

          {card.tags && card.tags.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-1.5 mt-3 max-w-full px-2">
              {card.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 dark:bg-slate-700/80 text-slate-600 dark:text-slate-300 border border-slate-200/70 dark:border-slate-600"
                >
                  #{tag}
                </span>
              ))}
              {card.tags.length > 3 && (
                <span className="text-[10px] font-medium text-slate-400">+{card.tags.length - 3}</span>
              )}
            </div>
          )}

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
            {card.synonyms && card.synonyms.length > 0 && (
              <div className="flex flex-wrap items-center justify-center gap-1.5 pt-2 mt-2 w-full">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Syn:</span>
                {card.synonyms.slice(0, 4).map((syn) => (
                  <span
                    key={syn}
                    className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-800 text-emerald-300 border border-slate-700"
                  >
                    {syn}
                  </span>
                ))}
              </div>
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
            <div className="flex border-l border-slate-700 justify-center items-center ml-1 pl-1 gap-0.5">
              <button
                onClick={() => onEdit(card)}
                className="p-1.5 text-slate-500 hover:text-brand-400 hover:bg-brand-500/10 rounded-lg transition-colors"
                title="Edit Card"
                aria-label={`Edit ${card.word} (back)`}
              >
                <Pencil className="h-4 w-4" />
              </button>
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

const CardEditorModal: React.FC<{
  isOpen: boolean;
  editingCard: Flashcard | null;
  onClose: () => void;
  onSubmit: (data: CustomCardFormData) => void;
}> = ({ isOpen, editingCard, onClose, onSubmit }) => {
  const [word, setWord] = useState('');
  const [partOfSpeech, setPartOfSpeech] = useState('noun');
  const [phonetic, setPhonetic] = useState('');
  const [mainDefinition, setMainDefinition] = useState('');
  const [example, setExample] = useState('');
  const [image, setImage] = useState('');
  const [tagsInput, setTagsInput] = useState('');

  useEffect(() => {
    if (editingCard) {
      setWord(editingCard.word || '');
      setPartOfSpeech(editingCard.partOfSpeech || 'noun');
      setPhonetic(editingCard.phonetic || '');
      setMainDefinition(editingCard.mainDefinition || '');
      setExample(editingCard.example || '');
      setImage(editingCard.image || '');
      setTagsInput((editingCard.tags || []).join(', '));
    } else {
      setWord('');
      setPartOfSpeech('noun');
      setPhonetic('');
      setMainDefinition('');
      setExample('');
      setImage('');
      setTagsInput('');
    }
  }, [editingCard, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!word.trim() || !mainDefinition.trim()) return;
    const parsedTags = Array.from(
      new Set(
        tagsInput
          .split(',')
          .map(t => t.trim().replace(/^#+/, ''))
          .filter(Boolean)
      )
    );
    onSubmit({
      word: word.trim(),
      partOfSpeech: partOfSpeech.trim() || 'noun',
      phonetic: phonetic.trim() || undefined,
      mainDefinition: mainDefinition.trim(),
      example: example.trim() || undefined,
      image: image.trim() || undefined,
      tags: parsedTags,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-slate-100 dark:border-slate-700 overflow-hidden z-10">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between bg-slate-50 dark:bg-slate-800/60">
          <h2 className="text-xl font-serif font-bold text-slate-900 dark:text-white">
            {editingCard ? 'Edit Flashcard' : 'Create Custom Card'}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close card editor"
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto custom-scrollbar">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                Word / Term *
              </label>
              <input
                type="text"
                required
                aria-label="Word"
                value={word}
                onChange={(e) => setWord(e.target.value)}
                placeholder="e.g. Perspicacious"
                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                Part of Speech
              </label>
              <select
                aria-label="Part of Speech"
                value={partOfSpeech}
                onChange={(e) => setPartOfSpeech(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-brand-500"
              >
                <option value="noun">noun</option>
                <option value="verb">verb</option>
                <option value="adjective">adjective</option>
                <option value="adverb">adverb</option>
                <option value="phrase">phrase</option>
                <option value="idiom">idiom</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                Phonetic (Optional)
              </label>
              <input
                type="text"
                aria-label="Phonetic"
                value={phonetic}
                onChange={(e) => setPhonetic(e.target.value)}
                placeholder="e.g. /ˌpərspəˈkāSHəs/"
                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-brand-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                Image URL (Optional)
              </label>
              <input
                type="url"
                aria-label="Image URL"
                value={image}
                onChange={(e) => setImage(e.target.value)}
                placeholder="https://..."
                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-brand-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
              Definition *
            </label>
            <textarea
              required
              rows={3}
              aria-label="Definition"
              value={mainDefinition}
              onChange={(e) => setMainDefinition(e.target.value)}
              placeholder="Write a clear definition or personal study note..."
              className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
              Example Sentence (Optional)
            </label>
            <textarea
              rows={2}
              aria-label="Example Sentence"
              value={example}
              onChange={(e) => setExample(e.target.value)}
              placeholder="e.g. Give an example showing the word in context..."
              className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-brand-500 resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
              Tags / Collections (Optional, comma-separated)
            </label>
            <input
              type="text"
              aria-label="Tags"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="e.g. GRE, Literary, Book: Dune"
              className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-brand-500"
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-100 dark:border-slate-700">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!word.trim() || !mainDefinition.trim()}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-brand-600 hover:bg-brand-700 text-white shadow-md shadow-brand-500/20 disabled:opacity-50 transition-colors"
            >
              {editingCard ? 'Save Changes' : 'Create Card'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export const Flashcards: React.FC<FlashcardsProps> = ({
  cards,
  onStartStudy,
  onDeleteCard,
  onReviewCard,
  onCreateCard,
  onUpdateCard,
  onOpenImport,
}) => {
  const [selectedStatus, setSelectedStatus] = useState<FlashcardStatus | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPos, setSelectedPos] = useState<string>('all');
  const [selectedTag, setSelectedTag] = useState<string>('all');
  const [sortBy, setSortBy] = useState<FlashcardSortOption>('priority');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<Flashcard | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const handleOpenCreateModal = () => {
    setEditingCard(null);
    setIsEditorOpen(true);
  };

  const handleOpenEditModal = (card: Flashcard) => {
    setEditingCard(card);
    setIsEditorOpen(true);
  };

  const handleEditorSubmit = (data: CustomCardFormData) => {
    if (editingCard) {
      onUpdateCard?.(editingCard.id, data);
    } else {
      onCreateCard?.(data);
    }
  };

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [selectedStatus, searchQuery, selectedPos, selectedTag, sortBy]);

  const newCount = cards.filter(c => c.status === FlashcardStatus.New).length;
  const learningCount = cards.filter(c => c.status === FlashcardStatus.Learning).length;
  const masteredCount = cards.filter(c => c.status === FlashcardStatus.Mastered).length;

  const studyQueueCount = getDueCards(cards).length;

  const partsOfSpeech = useMemo(() => {
    const posSet = new Set<string>();
    for (const c of cards) {
      const normalized = c.partOfSpeech?.trim().toLowerCase();
      if (normalized) posSet.add(normalized);
    }
    return Array.from(posSet).sort();
  }, [cards]);

  const availableTags = useMemo(() => {
    const tagCounts = new Map<string, number>();
    for (const c of cards) {
      for (const raw of c.tags || []) {
        const t = raw.trim();
        if (t) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
      }
    }
    return Array.from(tagCounts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [cards]);

  const statusPriority = {
    [FlashcardStatus.New]: 0,
    [FlashcardStatus.Learning]: 1,
    [FlashcardStatus.Mastered]: 2,
  };

  const filteredCards = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return cards
      .filter(c => {
        if (selectedStatus && c.status !== selectedStatus) return false;
        if (selectedPos !== 'all' && (c.partOfSpeech?.trim().toLowerCase() || '') !== selectedPos) return false;
        if (selectedTag !== 'all' && !c.tags?.some(t => t.trim() === selectedTag)) return false;
        if (q) {
          const wordMatch = c.word.toLowerCase().includes(q);
          const defMatch = c.mainDefinition.toLowerCase().includes(q);
          const exMatch = (c.example || '').toLowerCase().includes(q);
          const tagMatch = (c.tags || []).some(t => t.toLowerCase().includes(q));
          if (!wordMatch && !defMatch && !exMatch && !tagMatch) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'newest') {
          return (b.createdAt || 0) - (a.createdAt || 0);
        }
        if (sortBy === 'oldest') {
          return (a.createdAt || 0) - (b.createdAt || 0);
        }
        if (sortBy === 'alpha') {
          return a.word.localeCompare(b.word, undefined, { sensitivity: 'base' });
        }
        if (sortBy === 'due') {
          const dueA = a.status === FlashcardStatus.New ? 0 : (a.nextReviewDate ?? Infinity);
          const dueB = b.status === FlashcardStatus.New ? 0 : (b.nextReviewDate ?? Infinity);
          if (dueA !== dueB) return dueA - dueB;
          return (b.createdAt || 0) - (a.createdAt || 0);
        }

        // Default 'priority' sort
        if (a.status !== b.status) {
          return statusPriority[a.status] - statusPriority[b.status];
        }
        if (a.status === FlashcardStatus.Learning) {
          const dateA = a.nextReviewDate || Infinity;
          const dateB = b.nextReviewDate || Infinity;
          if (dateA !== dateB) return dateA - dateB;
        }
        return (b.createdAt || 0) - (a.createdAt || 0);
      });
  }, [cards, selectedStatus, selectedPos, selectedTag, searchQuery, sortBy]);

  const handleStatusClick = (status: FlashcardStatus) => {
    if (selectedStatus === status) {
      setSelectedStatus(null);
    } else {
      setSelectedStatus(status);
    }
  };

  const handleClearFilters = () => {
    setSelectedStatus(null);
    setSearchQuery('');
    setSelectedPos('all');
    setSelectedTag('all');
    setSortBy('priority');
  };

  const visibleCards = filteredCards.slice(0, visibleCount);
  const hasMoreCards = visibleCount < filteredCards.length;

  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!sentinel || !hasMoreCards) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, filteredCards.length));
        }
      },
      { rootMargin: '300px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMoreCards, filteredCards.length]);



  if (cards.length === 0) {
    return (
      <>
        <div className="flex flex-col items-center justify-center h-[60vh] text-center space-y-6 animate-in fade-in zoom-in duration-500">
          <div className="bg-slate-100 dark:bg-slate-800 p-6 rounded-full">
            <BookOpen className="h-12 w-12 text-slate-400" />
          </div>
          <div className="space-y-4">
            <div>
              <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Your deck is empty</h2>
              <p className="text-slate-500 dark:text-slate-400 max-w-sm mx-auto mt-2">
                Search for words in the dictionary to add them, create a custom card, or import a previous backup.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={handleOpenCreateModal}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 rounded-xl text-white font-medium transition-all shadow-sm"
              >
                <Plus className="h-4 w-4" />
                Create Card
              </button>
              <button
                onClick={onOpenImport}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-xl text-slate-700 dark:text-slate-200 font-medium hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-brand-600 dark:hover:text-brand-400 hover:border-brand-200 transition-all shadow-sm"
              >
                <Upload className="h-4 w-4" />
                Import Deck
              </button>
            </div>
          </div>
        </div>
        <CardEditorModal
          isOpen={isEditorOpen}
          editingCard={editingCard}
          onClose={() => setIsEditorOpen(false)}
          onSubmit={handleEditorSubmit}
        />
      </>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header and Stats */}
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row gap-6 justify-between items-start md:items-end">
          <div>
            <h1 className="text-3xl font-serif font-bold text-slate-900 dark:text-white">My Deck</h1>
            <p className="text-slate-500 dark:text-slate-400 mt-1">{cards.length} cards total</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleOpenCreateModal}
              className="flex items-center gap-2 px-4 py-3 rounded-xl font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 hover:border-brand-300 transition-all shadow-sm"
            >
              <Plus className="h-4 w-4 text-brand-600 dark:text-brand-400" />
              Create Card
            </button>
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

        {/* Search, Part-of-Speech Filter, and Sort Toolbar */}
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center bg-white dark:bg-slate-800 p-3 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
          <div className="relative flex-1">
            <Search className="h-4 w-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search words, definitions, or examples..."
              aria-label="Search flashcards"
              className="w-full pl-10 pr-9 py-2 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="relative flex-1 sm:flex-initial">
              <Filter className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <select
                value={selectedPos}
                onChange={(e) => setSelectedPos(e.target.value)}
                aria-label="Filter by part of speech"
                className="w-full sm:w-auto pl-8 pr-8 py-2 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:border-brand-500"
              >
                <option value="all">All Parts of Speech</option>
                {partsOfSpeech.map((pos) => (
                  <option key={pos} value={pos}>
                    {pos.charAt(0).toUpperCase() + pos.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            <div className="relative flex-1 sm:flex-initial">
              <ArrowUpDown className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as FlashcardSortOption)}
                aria-label="Sort flashcards"
                className="w-full sm:w-auto pl-8 pr-8 py-2 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:border-brand-500"
              >
                <option value="priority">Sort: Priority</option>
                <option value="newest">Sort: Newest First</option>
                <option value="oldest">Sort: Oldest First</option>
                <option value="alpha">Sort: Alphabetical (A–Z)</option>
                <option value="due">Sort: Due Date</option>
              </select>
            </div>
          </div>
        </div>

        {/* Tag / Collection Filter Pills */}
        {availableTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-2" aria-label="Tag filter pills">
            <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mr-1">
              <Tag className="h-3.5 w-3.5" />
              Collections:
            </span>
            <button
              onClick={() => setSelectedTag('all')}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors duration-150 border ${
                selectedTag === 'all'
                  ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-brand-300'
              }`}
            >
              All ({cards.length})
            </button>
            {availableTags.map(([tag, count]) => (
              <button
                key={tag}
                onClick={() => setSelectedTag(selectedTag === tag ? 'all' : tag)}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors duration-150 border ${
                  selectedTag === tag
                    ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-brand-300'
                }`}
              >
                #{tag} ({count})
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Grid of Flashcards */}
      {filteredCards.length > 0 ? (
        <div className="space-y-8 pb-20">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {visibleCards.map((card) => (
              <FlashcardItem
                key={card.id}
                card={card}
                onDelete={onDeleteCard}
                onReview={onReviewCard}
                onEdit={handleOpenEditModal}
              />
            ))}
          </div>

          {hasMoreCards && (
            <div ref={loadMoreRef} className="flex flex-col items-center justify-center pt-2 gap-2">
              <p className="text-xs text-slate-400 dark:text-slate-500">
                Showing {visibleCards.length} of {filteredCards.length} cards
              </p>
              <button
                onClick={() => setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, filteredCards.length))}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 hover:border-brand-300 transition-colors shadow-sm"
              >
                <ChevronDown className="h-4 w-4" />
                Load More Cards
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400 dark:text-slate-600">
          <BookOpen className="h-10 w-10 mb-4 opacity-20" />
          <p>No cards found matching your filters</p>
          <button
            onClick={handleClearFilters}
            className="mt-4 text-brand-600 dark:text-brand-400 font-medium hover:underline"
          >
            Show all cards
          </button>
        </div>
      )}

      <CardEditorModal
        isOpen={isEditorOpen}
        editingCard={editingCard}
        onClose={() => setIsEditorOpen(false)}
        onSubmit={handleEditorSubmit}
      />
    </div>
  );
};