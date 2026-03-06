import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { WordEntry, Flashcard } from '../types';
import { lookupWord, getSpellingSuggestions } from '../services/dictionaryService';
import { getWordSuggestions } from '../services/suggestionService';
import { trackEvent, TRACKING_ACTION, TRACKING_CATEGORY } from '../services/trackingService';
import { playAudio } from '../utils/audio';
import { Search, Plus, Check, Loader2, BookOpen, Clock, Volume2 } from 'lucide-react';

interface DictionaryProps {
  onAddCard: (entry: WordEntry, definition: string, example: string, partOfSpeech: string) => void;
  onRemoveCard: (id: string) => void;
  existingCards: Flashcard[];
}

export const Dictionary: React.FC<DictionaryProps> = ({ onAddCard, onRemoveCard, existingCards }) => {
  const location = useLocation();
  const initialQuery: string | undefined = (location.state as { query?: string } | null)?.query;
  const [query, setQuery] = useState(initialQuery || '');
  const [result, setResult] = useState<WordEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Suggestion State
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const lastSearched = useRef<string>(initialQuery || '');

  // Typo suggestion state
  const [typoSuggestion, setTypoSuggestion] = useState<string | null>(null);

  // Debounce logic for autocomplete suggestions
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

    const timeoutId = setTimeout(fetchSuggestions, 300);
    return () => clearTimeout(timeoutId);
  }, [query]);

  // Click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const performSearch = async (searchQuery: string) => {
    if (!searchQuery.trim()) return;

    lastSearched.current = searchQuery.trim();
    setLoading(true);
    setError('');
    setResult(null);
    setTypoSuggestion(null);
    setShowSuggestions(false); // Hide dropdown immediately

    trackEvent(TRACKING_ACTION.SEARCH, TRACKING_CATEGORY.DICTIONARY, searchQuery);

    try {
      const data = await lookupWord(searchQuery);
      if (data && data.word) {
        setResult(data);
        setQuery(data.word); // Normalize case in input
      } else {
        // If not found, try to find suggestions for typos
        const typoSuggestions = await getSpellingSuggestions(searchQuery);
        if (typoSuggestions.length > 0) {
          // Use the first suggestion
          setTypoSuggestion(typoSuggestions[0]);
        }
        setError(`Could not find a definition for "${searchQuery}".`);
      }
    } catch (err) {
      setError('An error occurred while fetching the definition. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Auto-search when navigated from Dashboard with a pre-filled query in router state
  useEffect(() => {
    if (initialQuery && initialQuery.trim()) {
      performSearch(initialQuery.trim());
    }
    // Only run on mount — location.state doesn't change after initial render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    performSearch(query);
  };

  const handleSuggestionClick = (word: string) => {
    setShowSuggestions(false);
    setSuggestions([]);
    setQuery(word);
    performSearch(word);
  };

  const getSavedCard = (word: string, def: string) => {
    return existingCards.find(card =>
      card.word.toLowerCase() === word.toLowerCase() &&
      card.mainDefinition === def
    );
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="text-center space-y-4">
        <h1 className="text-5xl font-serif font-bold text-slate-900 dark:text-white tracking-tight">Lumina</h1>
        <p className="text-slate-500 dark:text-slate-400 text-lg">Illuminate your vocabulary.</p>
      </div>

      <div ref={wrapperRef} className="relative group z-20">
        <form onSubmit={handleSearch} className="relative">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <Search className="h-5 w-5 text-slate-400 group-focus-within:text-brand-500 transition-colors" />
          </div>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => {
              if (suggestions.length > 0) setShowSuggestions(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setShowSuggestions(false);
              }
            }}
            placeholder="Lookup a word..."
            className="block w-full pl-11 pr-4 py-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-2xl text-lg text-slate-900 dark:text-white shadow-sm placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 transition-all"
            autoComplete="off"
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="absolute right-2 top-2 bottom-2 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 px-4 rounded-xl font-medium hover:bg-slate-800 dark:hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Search'}
          </button>
        </form>

        {/* Autocomplete Dropdown */}
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-100 dark:border-slate-700 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
            <ul>
              {suggestions.map((word, index) => (
                <li
                  key={index}
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

      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-xl text-center">
          <p>{error}</p>
          {typoSuggestion && (
            <p className="mt-2 text-slate-600 dark:text-slate-300">
              Did you mean{" "}
              <button
                onClick={() => handleSuggestionClick(typoSuggestion)}
                className="font-bold text-brand-600 dark:text-brand-400 hover:underline"
              >
                {typoSuggestion}
              </button>
              ?
            </p>
          )}
        </div>
      )}

      {/* Loading Skeleton */}
      {loading && !result && (
        <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-xl shadow-slate-200/50 dark:shadow-none overflow-hidden border border-slate-100 dark:border-slate-700 animate-pulse">
          <div className="p-8 border-b border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30">
            <div className="flex items-baseline gap-4 flex-wrap">
              <div className="h-10 w-48 bg-slate-200 dark:bg-slate-700 rounded-lg"></div>
              <div className="h-6 w-24 bg-slate-200 dark:bg-slate-700 rounded-lg"></div>
              <div className="h-8 w-8 bg-slate-200 dark:bg-slate-700 rounded-full ml-auto"></div>
            </div>
          </div>

          <div className="p-8 space-y-8">
            {/* Meaning Block 1 */}
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="h-6 w-24 bg-slate-200 dark:bg-slate-700 rounded-full"></div>
                <div className="h-px bg-slate-100 dark:bg-slate-700 flex-grow"></div>
              </div>

              <div className="space-y-6">
                <div className="pl-4 border-l-2 border-slate-100 dark:border-slate-700 mt-2">
                  <div className="h-5 w-full max-w-2xl bg-slate-200 dark:bg-slate-700 rounded mb-3"></div>
                  <div className="h-5 w-5/6 max-w-xl bg-slate-200 dark:bg-slate-700 rounded mb-4"></div>
                  <div className="h-4 w-3/4 max-w-lg bg-slate-200 dark:bg-slate-700 rounded mb-4"></div>
                  <div className="h-8 w-40 bg-slate-200 dark:bg-slate-700 rounded-lg mt-3"></div>
                </div>

                <div className="pl-4 border-l-2 border-slate-100 dark:border-slate-700 mt-6">
                  <div className="h-5 w-11/12 max-w-2xl bg-slate-200 dark:bg-slate-700 rounded mb-3"></div>
                  <div className="h-8 w-40 bg-slate-200 dark:bg-slate-700 rounded-lg mt-3"></div>
                </div>
              </div>
            </div>

            {/* Meaning Block 2 */}
            <div className="space-y-4 mt-8">
              <div className="flex items-center gap-3">
                <div className="h-6 w-20 bg-slate-200 dark:bg-slate-700 rounded-full"></div>
                <div className="h-px bg-slate-100 dark:bg-slate-700 flex-grow"></div>
              </div>

              <div className="space-y-6">
                <div className="pl-4 border-l-2 border-slate-100 dark:border-slate-700 mt-2">
                  <div className="h-5 w-full max-w-xl bg-slate-200 dark:bg-slate-700 rounded mb-3"></div>
                  <div className="h-8 w-40 bg-slate-200 dark:bg-slate-700 rounded-lg mt-3"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {result && (
        <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-xl shadow-slate-200/50 dark:shadow-none overflow-hidden border border-slate-100 dark:border-slate-700">
          <div className="p-8 border-b border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30">
            <div className="flex items-baseline gap-4 flex-wrap">
              <h2 className="text-4xl font-serif font-bold text-slate-900 dark:text-white">{result.word}</h2>
              {result.phonetic && (
                <span className="text-xl text-slate-500 dark:text-slate-400 font-serif italic">{result.phonetic}</span>
              )}
              <button
                onClick={() => playAudio(result.word, result.audio)}
                className="p-1.5 text-slate-400 hover:text-brand-500 hover:bg-brand-50 dark:hover:bg-brand-900/30 rounded-full transition-colors"
                title="Listen to pronunciation"
              >
                <Volume2 className="h-6 w-6" />
              </button>
            </div>
          </div>

          <div className="p-8 space-y-8">
            {result.image && (
              <div className="mb-6 rounded-2xl overflow-hidden shadow-sm border border-slate-100 dark:border-slate-700 max-h-64 flex justify-center bg-slate-50 dark:bg-slate-900 items-center">
                <img
                  src={result.image}
                  alt={`Visual mnemonic for ${result.word}`}
                  className="max-h-64 object-contain"
                  loading="lazy"
                />
              </div>
            )}
            {result.meanings?.map((meaning, idx) => (
              <div key={`${meaning.partOfSpeech}-${idx}`} className="space-y-4">
                <div className="flex items-center gap-3">
                  <span className="px-3 py-1 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-sm font-semibold rounded-full uppercase tracking-wider">
                    {meaning.partOfSpeech}
                  </span>
                  <div className="h-px bg-slate-100 dark:bg-slate-700 flex-grow"></div>
                </div>

                <div className="space-y-6">
                  {meaning.definitions?.map((def, dIdx) => {
                    const savedCard = getSavedCard(result.word, def.definition);
                    const isSaved = !!savedCard;

                    return (
                      <div key={dIdx} className="group relative pl-4 border-l-2 border-transparent hover:border-brand-200 transition-colors">
                        <p className="text-slate-800 dark:text-slate-200 text-lg leading-relaxed">
                          {def.definition}
                        </p>
                        {def.example && (
                          <p className="mt-2 text-slate-500 dark:text-slate-400 italic font-serif">
                            "{def.example}"
                          </p>
                        )}

                        <div className="mt-3">
                          <button
                            onClick={() => {
                              if (isSaved && savedCard) {
                                onRemoveCard(savedCard.id);
                                showToast(`"${result.word}" removed from deck`);
                              } else {
                                onAddCard(result, def.definition, def.example || '', meaning.partOfSpeech);
                                showToast(`"${result.word}" added to deck`);
                              }
                            }}
                            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all
                                  ${isSaved
                                ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/50'
                                : 'bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-brand-50 dark:hover:bg-brand-900/30 hover:text-brand-600 dark:hover:text-brand-400'
                              }`}
                          >
                            {isSaved ? (
                              <>
                                <Check className="h-4 w-4" />
                                Added to Deck
                              </>
                            ) : (
                              <>
                                <Plus className="h-4 w-4" />
                                Add to Flashcards
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!result && !loading && !error && (
        <div className="text-center py-20 opacity-50">
          <BookOpen className="h-16 w-16 mx-auto text-slate-300 dark:text-slate-600 mb-4" />
          <p className="text-slate-400 dark:text-slate-500 text-lg">Search for a word to get started</p>
        </div>
      )}

      {/* Toast Message */}
      {toastMessage && (
        <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2 bg-slate-900 text-white px-6 py-3 rounded-full shadow-lg z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
          {toastMessage}
        </div>
      )}
    </div>
  );
};
