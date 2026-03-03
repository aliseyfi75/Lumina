import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { WordEntry, Flashcard } from '../types';
import { lookupWord, getSpellingSuggestions } from '../services/dictionaryService';
import { getWordSuggestions } from '../services/suggestionService';
import { trackEvent, TRACKING_ACTION, TRACKING_CATEGORY } from '../services/trackingService';
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

  // Typo suggestion state
  const [typoSuggestion, setTypoSuggestion] = useState<string | null>(null);

  // Debounce logic for autocomplete suggestions
  useEffect(() => {
    const fetchSuggestions = async () => {
      if (query.trim().length < 2) {
        setSuggestions([]);
        return;
      }

      // Only fetch if we aren't already displaying a result for this exact query
      // (prevents dropdown from popping up after hitting enter)
      if (result && query.toLowerCase() === result.word.toLowerCase()) return;

      const words = await getWordSuggestions(query);
      setSuggestions(words);
      setShowSuggestions(words.length > 0);
    };

    const timeoutId = setTimeout(fetchSuggestions, 300);
    return () => clearTimeout(timeoutId);
  }, [query, result]);

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
        <h1 className="text-5xl font-serif font-bold text-slate-900 tracking-tight">Lumina</h1>
        <p className="text-slate-500 text-lg">Illuminate your vocabulary.</p>
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
            placeholder="Lookup a word..."
            className="block w-full pl-11 pr-4 py-4 bg-white border border-slate-200 rounded-2xl text-lg shadow-sm placeholder:text-slate-400 focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 transition-all"
            autoComplete="off"
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="absolute right-2 top-2 bottom-2 bg-slate-900 text-white px-4 rounded-xl font-medium hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Search'}
          </button>
        </form>

        {/* Autocomplete Dropdown */}
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-xl border border-slate-100 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
            <ul>
              {suggestions.map((word, index) => (
                <li
                  key={index}
                  onClick={() => handleSuggestionClick(word)}
                  className="px-4 py-3 flex items-center gap-3 hover:bg-slate-50 cursor-pointer text-slate-700 transition-colors border-b border-slate-50 last:border-none"
                >
                  <Search className="h-4 w-4 text-slate-300" />
                  <span className="font-medium">{word}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {error && (
        <div className="p-4 bg-red-50 text-red-600 rounded-xl text-center">
          <p>{error}</p>
          {typoSuggestion && (
            <p className="mt-2 text-slate-600">
              Did you mean{" "}
              <button
                onClick={() => handleSuggestionClick(typoSuggestion)}
                className="font-bold text-brand-600 hover:underline"
              >
                {typoSuggestion}
              </button>
              ?
            </p>
          )}
        </div>
      )}

      {result && (
        <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/50 overflow-hidden border border-slate-100">
          <div className="p-8 border-b border-slate-100 bg-slate-50/50">
            <div className="flex items-baseline gap-4 flex-wrap">
              <h2 className="text-4xl font-serif font-bold text-slate-900">{result.word}</h2>
              {result.phonetic && (
                <span className="text-xl text-slate-500 font-serif italic">{result.phonetic}</span>
              )}
              {result.audio && (
                <button
                  onClick={() => new Audio(result.audio!).play()}
                  className="p-1.5 text-slate-400 hover:text-brand-500 hover:bg-brand-50 rounded-full transition-colors"
                  title="Listen to pronunciation"
                >
                  <Volume2 className="h-6 w-6" />
                </button>
              )}
            </div>
          </div>

          <div className="p-8 space-y-8">
            {result.image && (
              <div className="mb-6 rounded-2xl overflow-hidden shadow-sm border border-slate-100 max-h-64 flex justify-center bg-slate-50 items-center">
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
                  <span className="px-3 py-1 bg-slate-100 text-slate-600 text-sm font-semibold rounded-full uppercase tracking-wider">
                    {meaning.partOfSpeech}
                  </span>
                  <div className="h-px bg-slate-100 flex-grow"></div>
                </div>

                <div className="space-y-6">
                  {meaning.definitions?.map((def, dIdx) => {
                    const savedCard = getSavedCard(result.word, def.definition);
                    const isSaved = !!savedCard;

                    return (
                      <div key={dIdx} className="group relative pl-4 border-l-2 border-transparent hover:border-brand-200 transition-colors">
                        <p className="text-slate-800 text-lg leading-relaxed">
                          {def.definition}
                        </p>
                        {def.example && (
                          <p className="mt-2 text-slate-500 italic font-serif">
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
                                ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                : 'bg-slate-50 text-slate-600 hover:bg-brand-50 hover:text-brand-600'
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
          <BookOpen className="h-16 w-16 mx-auto text-slate-300 mb-4" />
          <p className="text-slate-400 text-lg">Search for a word to get started</p>
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
