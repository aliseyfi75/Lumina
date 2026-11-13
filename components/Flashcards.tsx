import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Flashcard, FlashcardStatus } from '../types';
import { Play, BookOpen, CheckCircle, Brain, Trash2, RotateCw, Upload, Volume2, ChevronDown, ChevronRight, ChevronUp, Search, X, ArrowUpDown, Filter, Plus, Pencil, Tag, Sparkles, AlertTriangle, Folder, FolderOpen, CornerDownRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { playAudio } from '../utils/audio';
import { getDueCards } from '../utils/studyUtils';
import { BookPrepModal } from './BookPrepModal';
import { BookExtractedWord } from '../services/bookService';
import { parseTagHierarchy, BOOKS_FOLDER_FILTER, compareChapterNames, getCardBookInfo, getCardBookInfos, getCardBookInfoForBook, formatBookTag, formatBookChapterTag } from '../utils/tagUtils';
import { TagSelectorInput } from './TagSelectorInput';
import { useCardFlip3D } from '../utils/cardFlip';
import { getAdaptiveWordHeadingClass } from '../utils/deviceScale';

const PAGE_SIZE = 24;
const COLLAPSED_DOCK_CHAPTER_LIMIT = 4;
const COLLAPSED_COLLECTION_CHAPTER_LIMIT = 6;

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
  onStartStudy: (initialTag?: string, initialChapters?: string[]) => void;
  onDeleteCard: (id: string) => void;
  onDeleteBook?: (bookTag: string) => void;
  onReviewCard: (id: string, quality: number) => void;
  onCreateCard?: (data: CustomCardFormData) => void;
  onUpdateCard?: (id: string, updates: CustomCardFormData) => void;
  onImportBookWords?: (bookTitle: string, words: BookExtractedWord[]) => void;
  onOpenImport: () => void;
}

const FlashcardItem: React.FC<{
  card: Flashcard;
  onDelete: (id: string) => void;
  onReview: (id: string, quality: number) => void;
  onEdit: (card: Flashcard) => void;
}> = ({ card, onDelete, onReview, onEdit }) => {
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
  } = useCardFlip3D(isFlipped);

  const displayTags = useMemo(() => {
    const rawTags = card.tags || [];
    // If a card has both "Book: Title" and "Book: Title / Chapter 1", keep the more specific chapter tag
    const booksWithChapter = new Set<string>();
    for (const t of rawTags) {
      const p = parseTagHierarchy(t);
      if (p.isBook && p.bookTitle && p.chapter) {
        booksWithChapter.add(p.bookTitle.toLowerCase());
      }
    }
    return rawTags.filter(t => {
      const p = parseTagHierarchy(t);
      if (p.isBook && p.bookTitle && !p.chapter && booksWithChapter.has(p.bookTitle.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [card.tags]);

  return (
    <div
      className="group h-72 sm:h-80 w-full perspective-1000 cursor-pointer"
      onClick={() => setIsFlipped(!isFlipped)}
    >
      <motion.div
        className="relative w-full h-full preserve-3d"
        style={{ ...flipContainerStyle, rotateY: flipRotateY }}
      >
        {/* Front of Card */}
        <div
          data-testid="deck-card-front"
          aria-hidden={isFlipped}
          className="absolute inset-0 backface-hidden"
          style={frontPlaneStyle}
        >
          <motion.div
            style={{ opacity: frontOpacity, visibility: frontVisibility }}
            className="w-full h-full bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-4 sm:p-6 flex flex-col items-center justify-between text-center hover:shadow-md hover:border-brand-200 transition-shadow overflow-hidden"
          >
            <div className="w-full flex items-center justify-between gap-2 shrink-0">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(card);
                }}
                aria-label={`Edit ${card.word}`}
                title="Edit Card"
                className="p-1.5 text-slate-400 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 transition-all"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>

              <div className="flex items-center gap-1.5 pl-1">
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
            </div>

            <div className="flex-1 flex flex-col items-center justify-center w-full min-h-0 px-1 my-1">
              <h3 className={`${getAdaptiveWordHeadingClass(card.word, 'card')} font-serif font-bold text-slate-900 dark:text-white mb-1.5 break-words max-w-full leading-tight`}>
                {card.word}
              </h3>
              <p className="text-slate-500 dark:text-slate-400 italic font-serif text-sm">{card.partOfSpeech}</p>
              <div className="flex items-center gap-2 mt-1 max-w-full">
                {card.phonetic && <p className="text-slate-400 text-xs sm:text-sm truncate">{card.phonetic}</p>}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    playAudio(card.word, card.audio);
                  }}
                  className="p-1 text-slate-400 hover:text-brand-500 hover:bg-brand-50 rounded-full transition-colors shrink-0"
                  title="Listen to pronunciation"
                >
                  <Volume2 className="h-4 w-4" />
                </button>
              </div>

              {displayTags.length > 0 && (
                <div className="flex flex-wrap items-center justify-center gap-1 mt-2.5 max-w-full px-1">
                  {displayTags.slice(0, 3).map((tag) => {
                    const parsed = parseTagHierarchy(tag);
                    return (
                      <span
                        key={tag}
                        data-testid="card-tag-badge"
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border max-w-full truncate ${
                          parsed.isBook
                            ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-200/70 dark:border-emerald-800/60'
                            : 'bg-slate-100 dark:bg-slate-700/80 text-slate-600 dark:text-slate-300 border-slate-200/70 dark:border-slate-600'
                        }`}
                      >
                        {parsed.isBook ? (
                          <>
                            <BookOpen className="h-2.5 w-2.5 shrink-0" />
                            <span className="opacity-70">Books /</span>
                            <span className="truncate">{parsed.bookTitle || parsed.name}</span>
                            {parsed.chapter && (
                              <>
                                <span className="opacity-70">/</span>
                                <span className="truncate">{parsed.chapter}</span>
                              </>
                            )}
                          </>
                        ) : parsed.folder ? (
                          <>
                            <Folder className="h-2.5 w-2.5 shrink-0" />
                            <span className="opacity-70">{parsed.folder} /</span>
                            <span className="truncate">{parsed.name}</span>
                          </>
                        ) : (
                          <span className="truncate">#{parsed.name}</span>
                        )}
                      </span>
                    );
                  })}
                  {displayTags.length > 3 && (
                    <span className="text-[10px] font-medium text-slate-400">+{displayTags.length - 3}</span>
                  )}
                </div>
              )}
            </div>

            <div className="shrink-0 pt-1 text-slate-300 dark:text-slate-600 group-hover:text-brand-400 transition-colors flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider">
              <RotateCw className="h-3.5 w-3.5" />
              Tap to reveal
            </div>
          </motion.div>
        </div>

        {/* Back of Card */}
        <div
          data-testid="deck-card-back"
          aria-hidden={!isFlipped}
          className="absolute inset-0 backface-hidden"
          style={backPlaneStyle}
        >
          <motion.div
            style={{ opacity: backOpacity, visibility: backVisibility }}
            className="w-full h-full bg-slate-900 rounded-2xl shadow-xl p-4 sm:p-6 flex flex-col items-center justify-between text-center overflow-hidden border border-slate-800"
          >
            <div className="overflow-y-auto w-full flex-1 flex flex-col items-center justify-start custom-scrollbar px-2 py-2 sm:py-4">
              {card.image && (
                <div className="mb-3 sm:mb-4 shrink-0 rounded-xl overflow-hidden shadow-sm border border-slate-700 h-28 sm:h-32 flex justify-center bg-slate-800 items-center w-full mt-auto">
                  <img
                    src={card.image}
                    alt={`Visual mnemonic for ${card.word}`}
                    className="max-h-full max-w-full object-contain"
                    loading="lazy"
                  />
                </div>
              )}
              <p className="text-slate-100 text-base sm:text-lg font-medium leading-relaxed mb-auto w-full text-center">
                {card.mainDefinition}
              </p>
              {card.example && (
                <p className="text-slate-400 text-xs sm:text-sm italic border-t border-slate-700 pt-2.5 sm:pt-3 mt-auto w-full">
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

            <div className="pt-3 sm:pt-4 w-full grid grid-cols-4 gap-1 border-t border-slate-800 mt-2 shrink-0" onClick={(e) => e.stopPropagation()}>
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
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
};

const CardEditorModal: React.FC<{
  isOpen: boolean;
  editingCard: Flashcard | null;
  existingCards: Flashcard[];
  onClose: () => void;
  onSubmit: (data: CustomCardFormData) => void;
}> = ({ isOpen, editingCard, existingCards, onClose, onSubmit }) => {
  const [word, setWord] = useState('');
  const [partOfSpeech, setPartOfSpeech] = useState('noun');
  const [phonetic, setPhonetic] = useState('');
  const [mainDefinition, setMainDefinition] = useState('');
  const [example, setExample] = useState('');
  const [image, setImage] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  useEffect(() => {
    if (editingCard) {
      setWord(editingCard.word || '');
      setPartOfSpeech(editingCard.partOfSpeech || 'noun');
      setPhonetic(editingCard.phonetic || '');
      setMainDefinition(editingCard.mainDefinition || '');
      setExample(editingCard.example || '');
      setImage(editingCard.image || '');
      setSelectedTags(editingCard.tags ? [...editingCard.tags] : []);
    } else {
      setWord('');
      setPartOfSpeech('noun');
      setPhonetic('');
      setMainDefinition('');
      setExample('');
      setImage('');
      setSelectedTags([]);
    }
  }, [editingCard, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!word.trim() || !mainDefinition.trim()) return;
    const parsedTags = Array.from(
      new Set(
        selectedTags
          .map(t => t.trim())
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white dark:bg-slate-800 rounded-2xl sm:rounded-3xl shadow-2xl border border-slate-100 dark:border-slate-700 overflow-hidden z-10">
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between bg-slate-50 dark:bg-slate-800/60">
          <h2 className="text-lg sm:text-xl font-serif font-bold text-slate-900 dark:text-white">
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

        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 max-h-[82dvh] overflow-y-auto custom-scrollbar">
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

          <TagSelectorInput
            selectedTags={selectedTags}
            onChange={setSelectedTags}
            existingCards={existingCards}
            label="Collections & Tags (Optional)"
            placeholder="Type a tag name to see suggestions or add new..."
            inputAriaLabel="Tags"
          />

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
  onDeleteBook,
  onReviewCard,
  onCreateCard,
  onUpdateCard,
  onImportBookWords,
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
  const [isBookPrepOpen, setIsBookPrepOpen] = useState(false);
  const [bookToDelete, setBookToDelete] = useState<{ tag: string; title: string; count: number } | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const existingWordsSet = useMemo(
    () => new Set(cards.map(c => c.word.trim().toLowerCase())),
    [cards]
  );

  const bookGroups = useMemo(() => {
    const groups = new Map<
      string,
      {
        tag: string;
        title: string;
        cardMap: Map<string, Flashcard>;
        chapterCardsMap: Map<string, Map<string, Flashcard>>;
      }
    >();

    for (const card of cards) {
      const bookInfos = getCardBookInfos(card);
      for (const bookInfo of bookInfos) {
        const { bookTitle, chapter, bookTag } = bookInfo;
        let group = groups.get(bookTag);
        if (!group) {
          group = {
            tag: bookTag,
            title: bookTitle,
            cardMap: new Map<string, Flashcard>(),
            chapterCardsMap: new Map<string, Map<string, Flashcard>>(),
          };
          groups.set(bookTag, group);
        }
        group.cardMap.set(card.id, card);

        if (chapter) {
          let chapMap = group.chapterCardsMap.get(chapter);
          if (!chapMap) {
            chapMap = new Map<string, Flashcard>();
            group.chapterCardsMap.set(chapter, chapMap);
          }
          chapMap.set(card.id, card);
        }
      }
    }

    return Array.from(groups.values())
      .map(group => {
        const bookCards = Array.from(group.cardMap.values());
        const total = bookCards.length;
        const mastered = bookCards.filter(c => c.status === FlashcardStatus.Mastered).length;
        const learning = bookCards.filter(c => c.status === FlashcardStatus.Learning).length;
        const newWords = bookCards.filter(c => c.status === FlashcardStatus.New).length;
        const dueCount = getDueCards(bookCards).length;
        const readiness = total > 0 ? Math.round(((mastered + learning * 0.5) / total) * 100) : 0;

        const chapters = Array.from(group.chapterCardsMap.entries())
          .map(([chapterName, cMap]) => {
            const cCards = Array.from(cMap.values());
            const cTotal = cCards.length;
            const cMastered = cCards.filter(c => c.status === FlashcardStatus.Mastered).length;
            const cLearning = cCards.filter(c => c.status === FlashcardStatus.Learning).length;
            const cDue = getDueCards(cCards).length;
            const cReadiness = cTotal > 0 ? Math.round(((cMastered + cLearning * 0.5) / cTotal) * 100) : 0;
            return {
              chapter: chapterName,
              chapterTag: formatBookChapterTag(group.title, chapterName),
              total: cTotal,
              mastered: cMastered,
              dueCount: cDue,
              readiness: cReadiness,
              isMastered: cTotal > 0 && cMastered === cTotal,
            };
          })
          .sort((a, b) => compareChapterNames(a.chapter, b.chapter));

        return {
          tag: group.tag,
          title: group.title,
          cards: bookCards,
          chapters,
          total,
          mastered,
          learning,
          newWords,
          dueCount,
          readiness,
        };
      })
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [cards]);

  const handleBookWordsImported = (bookTitle: string, words: BookExtractedWord[]) => {
    onImportBookWords?.(bookTitle, words);
    setSelectedTag(`Book: ${bookTitle.trim()}`);
  };

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

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set(['Books']));
  const [expandedDockBookChapters, setExpandedDockBookChapters] = useState<Set<string>>(() => new Set());
  const [collapsedDockBookDrawers, setCollapsedDockBookDrawers] = useState<Set<string>>(() => new Set());
  const [expandedCollectionBookChapters, setExpandedCollectionBookChapters] = useState<Set<string>>(() => new Set());

  const toggleSetEntry = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, key: string) => {
    setter(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

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

  const collectionsTree = useMemo(() => {
    const folders = new Map<
      string,
      {
        folderName: string;
        isBooksFolder: boolean;
        cardIds: Set<string>;
        items: {
          rawTag: string;
          name: string;
          count: number;
          chapters?: { rawTag: string; chapter: string; count: number }[];
        }[];
      }
    >();
    const flatTags: { rawTag: string; name: string; count: number }[] = [];

    // Populate Books folder from bookGroups so book pills are deduplicated per book title
    // and carry their nested chapter / 20-page folders.
    if (bookGroups.length > 0) {
      const bookCardIds = new Set<string>();
      for (const bg of bookGroups) {
        for (const c of bg.cards) bookCardIds.add(c.id);
      }
      folders.set('Books', {
        folderName: 'Books',
        isBooksFolder: true,
        cardIds: bookCardIds,
        items: bookGroups.map(bg => ({
          rawTag: bg.tag,
          name: bg.title,
          count: bg.total,
          chapters: bg.chapters.map(ch => ({
            rawTag: ch.chapterTag,
            chapter: ch.chapter,
            count: ch.total,
          })),
        })),
      });
    }

    for (const [rawTag, count] of availableTags) {
      const parsed = parseTagHierarchy(rawTag);
      if (parsed.isBook || parsed.folder === 'Books') {
        continue;
      }
      if (parsed.folder) {
        let folderEntry = folders.get(parsed.folder);
        if (!folderEntry) {
          folderEntry = {
            folderName: parsed.folder,
            isBooksFolder: false,
            cardIds: new Set<string>(),
            items: [],
          };
          folders.set(parsed.folder, folderEntry);
        }
        folderEntry.items.push({
          rawTag,
          name: parsed.name,
          count,
        });
      } else {
        flatTags.push({
          rawTag,
          name: parsed.name,
          count,
        });
      }
    }

    for (const c of cards) {
      for (const raw of c.tags || []) {
        const parsed = parseTagHierarchy(raw);
        if (parsed.folder && parsed.folder !== 'Books') {
          folders.get(parsed.folder)?.cardIds.add(c.id);
        }
      }
    }

    const folderList = Array.from(folders.values())
      .map(f => ({
        ...f,
        totalCards: f.cardIds.size,
        items: f.items.sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => {
        if (a.isBooksFolder !== b.isBooksFolder) return a.isBooksFolder ? -1 : 1;
        return a.folderName.localeCompare(b.folderName);
      });

    return {
      folders: folderList,
      flatTags: flatTags.sort((a, b) => a.name.localeCompare(b.name)),
    };
  }, [availableTags, cards, bookGroups]);

  // Ensure parent folder is expanded whenever one of its sub-tags is selected
  useEffect(() => {
    if (selectedTag !== 'all' && !selectedTag.startsWith('__folder:')) {
      const parsed = parseTagHierarchy(selectedTag);
      if (parsed.folder) {
        setExpandedFolders(prev => {
          if (prev.has(parsed.folder!)) return prev;
          const next = new Set(prev);
          next.add(parsed.folder!);
          return next;
        });
      }
    }
  }, [selectedTag]);

  const toggleFolder = (folderName: string) => {
    const folderFilterKey = `__folder:${folderName}__`;
    const isCurrentlyInFolder =
      selectedTag === folderFilterKey ||
      (selectedTag !== 'all' &&
        !selectedTag.startsWith('__folder:') &&
        parseTagHierarchy(selectedTag).folder === folderName);

    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderName) && selectedTag === folderFilterKey) {
        next.delete(folderName);
      } else {
        next.add(folderName);
      }
      return next;
    });

    if (selectedTag === folderFilterKey) {
      setSelectedTag('all');
    } else if (!isCurrentlyInFolder) {
      setSelectedTag(folderFilterKey);
    } else {
      setSelectedTag(folderFilterKey);
    }
  };

  const statusPriority = {
    [FlashcardStatus.New]: 0,
    [FlashcardStatus.Learning]: 1,
    [FlashcardStatus.Mastered]: 2,
  };

  const filteredCards = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const parsedSelected = selectedTag !== 'all' && !selectedTag.startsWith('__folder:')
      ? parseTagHierarchy(selectedTag)
      : null;

    return cards
      .filter(c => {
        if (selectedStatus && c.status !== selectedStatus) return false;
        if (selectedPos !== 'all' && (c.partOfSpeech?.trim().toLowerCase() || '') !== selectedPos) return false;
        if (selectedTag !== 'all') {
          if (selectedTag.startsWith('__folder:') && selectedTag.endsWith('__')) {
            const folderName = selectedTag.slice('__folder:'.length, -2);
            const inFolder = c.tags?.some(t => parseTagHierarchy(t).folder === folderName);
            if (!inFolder) return false;
          } else if (parsedSelected?.isBook && parsedSelected.bookTitle) {
            const cardBook = getCardBookInfoForBook(c, parsedSelected.bookTitle);
            if (!cardBook) {
              return false;
            }
            if (parsedSelected.chapter) {
              if ((cardBook.chapter || '').toLowerCase() !== parsedSelected.chapter.toLowerCase()) {
                return false;
              }
            }
          } else if (!c.tags?.some(t => t.trim() === selectedTag)) {
            return false;
          }
        }
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
                Search for words in the dictionary to add them, prepare for a book, create a custom card, or import a previous backup.
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
                onClick={() => setIsBookPrepOpen(true)}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-xl text-slate-700 dark:text-slate-200 font-medium hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-brand-600 dark:hover:text-brand-400 hover:border-brand-200 transition-all shadow-sm"
              >
                <Sparkles className="h-4 w-4 text-brand-600 dark:text-brand-400" />
                Prepare for a Book
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
          existingCards={cards}
          onClose={() => setIsEditorOpen(false)}
          onSubmit={handleEditorSubmit}
        />
        <BookPrepModal
          isOpen={isBookPrepOpen}
          onClose={() => setIsBookPrepOpen(false)}
          existingWords={existingWordsSet}
          existingCards={cards}
          onImportBookWords={handleBookWordsImported}
        />
      </>
    );
  }

  return (
    <div className="space-y-6 sm:space-y-8 animate-in fade-in duration-500">
      {/* Header and Stats */}
      <div className="space-y-5 sm:space-y-6">
        <div className="flex flex-col md:flex-row gap-4 sm:gap-6 justify-between items-start md:items-end">
          <div>
            <h1 className="text-2xl sm:text-3xl font-serif font-bold text-slate-900 dark:text-white">My Deck</h1>
            <p className="text-slate-500 dark:text-slate-400 mt-1 text-sm sm:text-base">{cards.length} cards total</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <button
              onClick={() => setIsBookPrepOpen(true)}
              className="flex items-center gap-2 px-3.5 sm:px-4 py-2.5 sm:py-3 rounded-xl text-sm sm:text-base font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 hover:border-brand-300 transition-all shadow-sm"
            >
              <BookOpen className="h-4 w-4 text-brand-600 dark:text-brand-400 shrink-0" />
              Prepare for a Book
            </button>
            <button
              onClick={handleOpenCreateModal}
              className="flex items-center gap-2 px-3.5 sm:px-4 py-2.5 sm:py-3 rounded-xl text-sm sm:text-base font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 hover:border-brand-300 transition-all shadow-sm"
            >
              <Plus className="h-4 w-4 text-brand-600 dark:text-brand-400 shrink-0" />
              Create Card
            </button>
            <button
              onClick={() => onStartStudy()}
              disabled={studyQueueCount === 0}
              className={`flex items-center gap-2 px-4 sm:px-6 py-2.5 sm:py-3 rounded-xl text-sm sm:text-base font-medium shadow-lg transition-all 
                ${studyQueueCount > 0
                  ? 'bg-brand-600 hover:bg-brand-700 text-white shadow-brand-500/30 hover:scale-105 active:scale-95'
                  : 'bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed shadow-none'
                }`}
            >
              {studyQueueCount > 0 ? (
                <>
                  <Play className="h-4 w-4 sm:h-5 sm:w-5 fill-current shrink-0" />
                  Start Study Session
                </>
              ) : (
                <>
                  <CheckCircle className="h-4 w-4 sm:h-5 sm:w-5 shrink-0" />
                  All Mastered
                </>
              )}
            </button>
          </div>
        </div>

        {/* Book Vocabulary Dock (Pre-Reading Study Groups) */}
        {bookGroups.length > 0 && (
          <div
            data-testid="book-vocabulary-dock"
            className="bg-white dark:bg-slate-800/90 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 shadow-sm space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-brand-50 dark:bg-brand-900/40 text-brand-600 dark:text-brand-400">
                  <BookOpen className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-sm font-serif font-bold text-slate-900 dark:text-white">
                    Book Vocabulary Dock
                  </h2>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Pre-study complex vocabulary from your books before reading
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsBookPrepOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-900/50 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Book
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {bookGroups.map((book) => {
                const isSelected = selectedTag === book.tag;
                return (
                  <div
                    key={book.tag}
                    data-testid="book-dock-card"
                    onClick={() => setSelectedTag(isSelected ? 'all' : book.tag)}
                    className={`p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between gap-3 ${
                      isSelected
                        ? 'bg-brand-50/70 dark:bg-brand-900/30 border-brand-400 dark:border-brand-500 ring-1 ring-brand-400/50 shadow-sm'
                        : 'bg-slate-50/70 dark:bg-slate-900/50 border-slate-200 dark:border-slate-700 hover:border-brand-300 dark:hover:border-brand-700'
                    }`}
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="font-serif font-bold text-base text-slate-900 dark:text-white truncate">
                            {book.title}
                          </h3>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {book.total} complex {book.total === 1 ? 'word' : 'words'} • {book.mastered} mastered
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-brand-100 dark:bg-brand-900/50 text-brand-700 dark:text-brand-300">
                            {book.readiness}% Ready
                          </span>
                          {onDeleteBook && (
                            <button
                              type="button"
                              data-testid="remove-book-button"
                              aria-label={`Remove ${book.title}`}
                              title={`Remove ${book.title} and its words`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setBookToDelete({
                                  tag: book.tag,
                                  title: book.title,
                                  count: book.total,
                                });
                              }}
                              className="p-1 rounded-lg text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-brand-600 dark:bg-brand-400 rounded-full transition-all"
                          style={{ width: `${Math.max(book.readiness, book.total > 0 ? 6 : 0)}%` }}
                        />
                      </div>

                      {book.chapters.length > 0 && (() => {
                        const isDrawerCollapsed = collapsedDockBookDrawers.has(book.tag);
                        const isAllExpanded = expandedDockBookChapters.has(book.tag);
                        const hasManySections = book.chapters.length > COLLAPSED_DOCK_CHAPTER_LIMIT;
                        const visibleChapters =
                          hasManySections && !isAllExpanded
                            ? (() => {
                                const sliced = book.chapters.slice(0, COLLAPSED_DOCK_CHAPTER_LIMIT);
                                const activeBeyondSlice = book.chapters.find(
                                  (ch, idx) =>
                                    idx >= COLLAPSED_DOCK_CHAPTER_LIMIT && selectedTag === ch.chapterTag
                                );
                                if (activeBeyondSlice) sliced.push(activeBeyondSlice);
                                return sliced;
                              })()
                            : book.chapters;
                        const hiddenCount = Math.max(0, book.chapters.length - visibleChapters.length);

                        return (
                          <div
                            data-testid="book-chapters-list"
                            className="pt-1.5 space-y-1.5 border-t border-slate-200/70 dark:border-slate-700/70"
                          >
                            <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                              <button
                                type="button"
                                data-testid="book-chapters-collapse-toggle"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleSetEntry(setCollapsedDockBookDrawers, book.tag);
                                }}
                                className="inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
                              >
                                {isDrawerCollapsed ? (
                                  <ChevronRight className="h-3 w-3 shrink-0" />
                                ) : (
                                  <ChevronDown className="h-3 w-3 shrink-0" />
                                )}
                                <span>Chapters / Sections ({book.chapters.length})</span>
                              </button>
                              {!isDrawerCollapsed && <span>Mastery</span>}
                            </div>

                            {!isDrawerCollapsed && (
                              <>
                                <div className={`space-y-1 ${isAllExpanded ? 'max-h-80' : 'max-h-44'} overflow-y-auto pr-0.5 custom-scrollbar`}>
                                  {visibleChapters.map((ch) => {
                                    const isChapActive = selectedTag === ch.chapterTag;
                                    return (
                                      <div
                                        key={ch.chapterTag}
                                        data-testid="book-chapter-folder"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setSelectedTag(isChapActive ? book.tag : ch.chapterTag);
                                        }}
                                        className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs border transition-colors ${
                                          isChapActive
                                            ? 'bg-brand-100/80 dark:bg-brand-900/50 border-brand-400 text-brand-900 dark:text-brand-100'
                                            : ch.isMastered
                                              ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200/80 dark:border-emerald-800/60 text-emerald-900 dark:text-emerald-200'
                                              : 'bg-white/80 dark:bg-slate-800/80 border-slate-200/70 dark:border-slate-700/70 text-slate-700 dark:text-slate-200 hover:border-brand-300'
                                        }`}
                                      >
                                        <div className="flex items-center gap-1.5 min-w-0">
                                          <Folder className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                                          <span className="font-medium truncate">{ch.chapter}</span>
                                          <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0">
                                            ({ch.mastered}/{ch.total})
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-1.5 shrink-0">
                                          {ch.isMastered ? (
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300">
                                              <CheckCircle className="h-2.5 w-2.5" />
                                              Mastered
                                            </span>
                                          ) : (
                                            <button
                                              type="button"
                                              data-testid="study-book-chapter-button"
                                              aria-label={`Study ${book.title} ${ch.chapter}`}
                                              disabled={ch.dueCount === 0}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                onStartStudy(book.tag, [ch.chapter]);
                                              }}
                                              className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-40 transition-colors inline-flex items-center gap-1"
                                            >
                                              <Play className="h-2.5 w-2.5 fill-current" />
                                              Study
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>

                                {hasManySections && (
                                  <button
                                    type="button"
                                    data-testid="book-chapters-expand-button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleSetEntry(setExpandedDockBookChapters, book.tag);
                                    }}
                                    className="w-full py-1 px-2 rounded-lg text-[11px] font-semibold text-brand-600 dark:text-brand-400 bg-brand-50/60 dark:bg-brand-900/20 hover:bg-brand-100/70 dark:hover:bg-brand-900/40 transition-colors inline-flex items-center justify-center gap-1"
                                  >
                                    {isAllExpanded ? (
                                      <>
                                        <span>Show fewer sections</span>
                                        <ChevronUp className="h-3 w-3" />
                                      </>
                                    ) : (
                                      <>
                                        <span>
                                          Show all {book.chapters.length} sections (+{hiddenCount} more)
                                        </span>
                                        <ChevronDown className="h-3 w-3" />
                                      </>
                                    )}
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        );
                      })()}
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-1">
                      <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        {isSelected ? 'Showing book words' : 'Click to filter deck'}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onStartStudy(book.tag);
                        }}
                        disabled={book.dueCount === 0}
                        aria-label={`Study ${book.title}`}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-brand-600 hover:bg-brand-700 text-white shadow-sm disabled:opacity-50 transition-colors inline-flex items-center gap-1.5"
                      >
                        <Play className="h-3 w-3 fill-current" />
                        Study Book
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

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

        {/* Nested Folder Architecture for Collections & Tags */}
        {availableTags.length > 0 && (
          <div className="space-y-2" aria-label="Tag filter pills">
            {/* Top-Level Collections Bar */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mr-1">
                <Tag className="h-3.5 w-3.5" />
                Collections:
              </span>
              <button
                type="button"
                onClick={() => setSelectedTag('all')}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors duration-150 border ${
                  selectedTag === 'all'
                    ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-brand-300'
                }`}
              >
                All ({cards.length})
              </button>

              {/* Folder Collections (e.g. Books folder, custom folders) */}
              {collectionsTree.folders.map((folder) => {
                const folderFilterKey = `__folder:${folder.folderName}__`;
                const isExpanded = expandedFolders.has(folder.folderName);
                const isChildSelected =
                  selectedTag !== 'all' &&
                  !selectedTag.startsWith('__folder:') &&
                  parseTagHierarchy(selectedTag).folder === folder.folderName;
                const isFolderActive = selectedTag === folderFilterKey || isChildSelected;
                const FolderIcon = isExpanded ? FolderOpen : Folder;

                return (
                  <button
                    key={folder.folderName}
                    type="button"
                    data-testid={`collection-folder-${folder.folderName}`}
                    onClick={() => toggleFolder(folder.folderName)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-150 border ${
                      isFolderActive
                        ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
                        : isExpanded
                          ? 'bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 border-brand-300 dark:border-brand-700'
                          : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-brand-300'
                    }`}
                  >
                    <FolderIcon className="h-3.5 w-3.5 shrink-0" />
                    <span>{folder.folderName}</span>{' '}
                    <span className="opacity-80">({folder.totalCards})</span>
                    {isExpanded ? (
                      <ChevronDown className="h-3 w-3 opacity-80 shrink-0" />
                    ) : (
                      <ChevronRight className="h-3 w-3 opacity-80 shrink-0" />
                    )}
                  </button>
                );
              })}

              {/* Top-Level Flat Tags */}
              {collectionsTree.flatTags.map((tagItem) => (
                <button
                  key={tagItem.rawTag}
                  type="button"
                  data-testid="collection-flat-tag-pill"
                  onClick={() =>
                    setSelectedTag(selectedTag === tagItem.rawTag ? 'all' : tagItem.rawTag)
                  }
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors duration-150 border ${
                    selectedTag === tagItem.rawTag
                      ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-brand-300'
                  }`}
                >
                  #{tagItem.name} ({tagItem.count})
                </button>
              ))}
            </div>

            {/* Nested Subfolder Bars (e.g. Books -> individual books without #Book: prefix) */}
            {collectionsTree.folders.map((folder) => {
              const folderFilterKey = `__folder:${folder.folderName}__`;
              const isExpanded = expandedFolders.has(folder.folderName);
              const isChildSelected =
                selectedTag !== 'all' &&
                !selectedTag.startsWith('__folder:') &&
                parseTagHierarchy(selectedTag).folder === folder.folderName;

              if (!isExpanded && !isChildSelected && selectedTag !== folderFilterKey) {
                return null;
              }

              const activeBookItem = folder.isBooksFolder
                ? folder.items.find(
                    item =>
                      selectedTag === item.rawTag ||
                      item.chapters?.some(ch => ch.rawTag === selectedTag)
                  )
                : undefined;

              return (
                <div key={`subfolder-group-${folder.folderName}`} className="space-y-1.5">
                  <div
                    data-testid={`collection-subfolder-${folder.folderName}`}
                    className="flex flex-wrap items-center gap-2 pl-3 sm:pl-4 py-2 px-3 rounded-2xl bg-slate-100/80 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/70"
                  >
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 dark:text-slate-400 mr-1">
                      <CornerDownRight className="h-3.5 w-3.5 text-brand-500" />
                      {folder.isBooksFolder ? (
                        <BookOpen className="h-3.5 w-3.5 text-brand-600 dark:text-brand-400" />
                      ) : (
                        <FolderOpen className="h-3.5 w-3.5 text-brand-600 dark:text-brand-400" />
                      )}
                      <span>{folder.folderName}:</span>
                    </span>

                    <button
                      type="button"
                      data-testid={`collection-folder-all-${folder.folderName}`}
                      onClick={() =>
                        setSelectedTag(selectedTag === folderFilterKey ? 'all' : folderFilterKey)
                      }
                      className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors duration-150 border ${
                        selectedTag === folderFilterKey
                          ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
                          : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-brand-300'
                      }`}
                    >
                      All {folder.folderName} ({folder.totalCards})
                    </button>

                    {folder.items.map((subItem) => {
                      const isSubSelected =
                        selectedTag === subItem.rawTag ||
                        Boolean(subItem.chapters?.some(ch => ch.rawTag === selectedTag));
                      return (
                        <button
                          key={subItem.rawTag}
                          type="button"
                          data-testid={
                            folder.isBooksFolder
                              ? 'collection-book-pill'
                              : 'collection-subfolder-item-pill'
                          }
                          onClick={() =>
                            setSelectedTag(
                              selectedTag === subItem.rawTag ? folderFilterKey : subItem.rawTag
                            )
                          }
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-colors duration-150 border ${
                            isSubSelected
                              ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
                              : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-brand-300'
                          }`}
                        >
                          {folder.isBooksFolder && (
                            <BookOpen
                              className={`h-3 w-3 shrink-0 ${
                                isSubSelected
                                  ? 'text-white'
                                  : 'text-brand-600 dark:text-brand-400'
                              }`}
                            />
                          )}
                          <span>{subItem.name}</span>{' '}
                          <span className="opacity-75">({subItem.count})</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* 3rd-Level Nested Chapter / Page Section Folders Bar for the Active Book */}
                  {activeBookItem && activeBookItem.chapters && activeBookItem.chapters.length > 0 && (() => {
                    const allChapters = activeBookItem.chapters;
                    const isExpanded = expandedCollectionBookChapters.has(activeBookItem.rawTag);
                    const hasMany = allChapters.length > COLLAPSED_COLLECTION_CHAPTER_LIMIT;
                    const visibleChapters =
                      hasMany && !isExpanded
                        ? (() => {
                            const sliced = allChapters.slice(0, COLLAPSED_COLLECTION_CHAPTER_LIMIT);
                            const activeBeyond = allChapters.find(
                              (ch, idx) =>
                                idx >= COLLAPSED_COLLECTION_CHAPTER_LIMIT && selectedTag === ch.rawTag
                            );
                            if (activeBeyond) sliced.push(activeBeyond);
                            return sliced;
                          })()
                        : allChapters;
                    const hiddenCount = Math.max(0, allChapters.length - visibleChapters.length);

                    return (
                      <div
                        data-testid="collection-book-chapters"
                        className="flex flex-wrap items-center gap-2 ml-4 sm:ml-6 py-2 px-3 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200/80 dark:border-indigo-800/60"
                      >
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 dark:text-indigo-300 mr-1">
                          <CornerDownRight className="h-3.5 w-3.5 text-indigo-500" />
                          <FolderOpen className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                          <span>{activeBookItem.name} Chapters:</span>
                        </span>

                        <button
                          type="button"
                          data-testid="collection-book-all-chapters"
                          onClick={() => setSelectedTag(activeBookItem.rawTag)}
                          className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors duration-150 border ${
                            selectedTag === activeBookItem.rawTag
                              ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                              : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-300'
                          }`}
                        >
                          All Chapters ({activeBookItem.count})
                        </button>

                        {visibleChapters.map((chapItem) => {
                          const isChapSelected = selectedTag === chapItem.rawTag;
                          return (
                            <button
                              key={chapItem.rawTag}
                              type="button"
                              data-testid="collection-chapter-pill"
                              onClick={() =>
                                setSelectedTag(
                                  isChapSelected ? activeBookItem.rawTag : chapItem.rawTag
                                )
                              }
                              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-colors duration-150 border ${
                                isChapSelected
                                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-indigo-300'
                              }`}
                            >
                              <Folder
                                className={`h-3 w-3 shrink-0 ${
                                  isChapSelected
                                    ? 'text-white'
                                    : 'text-indigo-600 dark:text-indigo-400'
                                }`}
                              />
                              <span>{chapItem.chapter}</span>{' '}
                              <span className="opacity-75">({chapItem.count})</span>
                            </button>
                          );
                        })}

                        {hasMany && (
                          <button
                            type="button"
                            data-testid="collection-chapters-expand-button"
                            onClick={() =>
                              toggleSetEntry(setExpandedCollectionBookChapters, activeBookItem.rawTag)
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-100/80 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-700 hover:bg-indigo-200/80 transition-colors"
                          >
                            {isExpanded ? (
                              <>
                                <span>Show fewer sections</span>
                                <ChevronUp className="h-3 w-3" />
                              </>
                            ) : (
                              <>
                                <span>+{hiddenCount} more sections</span>
                                <ChevronDown className="h-3 w-3" />
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    );
                  })()}
                </div>
              );
            })}
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
        existingCards={cards}
        onClose={() => setIsEditorOpen(false)}
        onSubmit={handleEditorSubmit}
      />

      <BookPrepModal
        isOpen={isBookPrepOpen}
        onClose={() => setIsBookPrepOpen(false)}
        existingWords={existingWordsSet}
        existingCards={cards}
        onImportBookWords={handleBookWordsImported}
      />

      {bookToDelete && (
        <div
          data-testid="confirm-delete-book-modal"
          className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setBookToDelete(null)}
        >
          <div
            className="relative z-10 w-full max-w-md bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-slate-100 dark:border-slate-700 p-6 space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3.5">
              <div className="p-3 rounded-2xl bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 shrink-0">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-lg font-serif font-bold text-slate-900 dark:text-white">
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
                  if (selectedTag === bookToDelete.tag) {
                    setSelectedTag('all');
                  }
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
    </div>
  );
};