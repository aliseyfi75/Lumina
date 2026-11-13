import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { WordEntry, Flashcard, LocalizedTranslations, MeaningLanguagePreference } from '../types';
import { lookupWord, fetchImageForWord, getSpellingSuggestions, prefetchWord } from '../services/dictionaryService';
import { getWordSuggestions } from '../services/suggestionService';
import { trackEvent, TRACKING_ACTION, TRACKING_CATEGORY } from '../services/trackingService';
import { playAudio } from '../utils/audio';
import { resolveMeaningDisplay } from '../utils/languageUtils';
import { Search, Plus, Check, Loader2, BookOpen, Clock, Volume2, Sparkles, Compass, X } from 'lucide-react';
import { TagSelectorInput } from './TagSelectorInput';

const RECENT_SEARCHES_KEY = 'lumina_recent_searches_v1';
const MAX_RECENT_SEARCHES = 10;

const CURATED_WORD_PACKS: Array<{
  title: string;
  subtitle: string;
  words: string[];
}> = [
  {
    title: 'Literary Gems',
    subtitle: 'Evocative words for vivid prose and poetry',
    words: ['Ephemeral', 'Mellifluous', 'Ineffable', 'Halcyon', 'Petrichor', 'Luminous'],
  },
  {
    title: 'Rhetoric & Persuasion',
    subtitle: 'Precision vocabulary for sharp arguments',
    words: ['Cogent', 'Trenchant', 'Pithy', 'Polemic', 'Didactic', 'Eloquent'],
  },
  {
    title: 'Sharp Adjectives',
    subtitle: 'Nuanced descriptors of character and mind',
    words: ['Perspicacious', 'Capricious', 'Fastidious', 'Taciturn', 'Sagacious', 'Recalcitrant'],
  },
  {
    title: 'GRE High-Frequency',
    subtitle: 'Classic academic and test-prep power words',
    words: ['Ubiquitous', 'Laconic', 'Pragmatic', 'Mitigate', 'Alacrity', 'Obsequious'],
  },
];

const ALL_DISCOVERY_WORDS = CURATED_WORD_PACKS.flatMap(p => p.words);

interface DictionaryProps {
  onAddCard: (
    entry: WordEntry,
    definition: string,
    example: string,
    partOfSpeech: string,
    tags?: string[],
    translations?: LocalizedTranslations
  ) => void;
  onRemoveCard: (id: string) => void;
  onUpdateCard?: (id: string, updates: { tags?: string[] }) => void;
  existingCards: Flashcard[];
  languagePreference?: MeaningLanguagePreference;
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'with', 'from', 'this', 'have', 'not', 'are',
  'was', 'were', 'been', 'being', 'into', 'such', 'one', 'who', 'whom', 'whose',
  'which', 'what', 'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each',
]);

const ClickableDefinitionText: React.FC<{
  text: string;
  onWordClick: (word: string) => void;
}> = ({ text, onWordClick }) => {
  const tokens = text.split(/(\s+)/);
  return (
    <>
      {tokens.map((token, idx) => {
        if (/^\s+$/.test(token)) {
          return <React.Fragment key={idx}>{token}</React.Fragment>;
        }
        const match = token.match(/^([^a-zA-Z]*)([a-zA-Z'-]+)([^a-zA-Z]*)$/);
        if (!match) {
          return <React.Fragment key={idx}>{token}</React.Fragment>;
        }
        const [, prefix, coreWord, suffix] = match;
        const cleanLower = coreWord.toLowerCase();
        if (coreWord.length < 4 || STOP_WORDS.has(cleanLower)) {
          return <React.Fragment key={idx}>{token}</React.Fragment>;
        }
        return (
          <React.Fragment key={idx}>
            {prefix}
            <span
              role="button"
              tabIndex={0}
              onClick={() => onWordClick(coreWord)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onWordClick(coreWord);
                }
              }}
              title={`Look up "${coreWord}"`}
              className="cursor-pointer rounded px-0.5 -mx-0.5 hover:bg-brand-100/70 dark:hover:bg-brand-900/40 hover:text-brand-700 dark:hover:text-brand-300 transition-colors"
            >
              {coreWord}
            </span>
            {suffix}
          </React.Fragment>
        );
      })}
    </>
  );
};

export const Dictionary: React.FC<DictionaryProps> = ({
  onAddCard,
  onRemoveCard,
  onUpdateCard,
  existingCards,
  languagePreference = 'en',
}) => {
  const location = useLocation();
  const initialQuery: string | undefined = (location.state as { query?: string } | null)?.query;
  const [query, setQuery] = useState(initialQuery || '');
  const [result, setResult] = useState<WordEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  // Sync selectedTags when a new word result is loaded
  useEffect(() => {
    if (!result) return;
    const savedForWord = existingCards.filter(
      c => c.word.trim().toLowerCase() === result.word.trim().toLowerCase()
    );
    if (savedForWord.length > 0) {
      const merged = Array.from(
        new Set(savedForWord.flatMap(c => c.tags || []).map(t => t.trim()).filter(Boolean))
      );
      setSelectedTags(merged);
    } else {
      setSelectedTags([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.word]);

  const handleDictionaryTagsChange = (nextTags: string[]) => {
    setSelectedTags(nextTags);
    if (result && onUpdateCard) {
      const savedForWord = existingCards.filter(
        c => c.word.trim().toLowerCase() === result.word.trim().toLowerCase()
      );
      for (const card of savedForWord) {
        onUpdateCard(card.id, { tags: nextTags });
      }
    }
  };

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
  const searchRequestIdRef = useRef<number>(0);

  // Typo suggestion state
  const [typoSuggestion, setTypoSuggestion] = useState<string | null>(null);

  // Recent searches persisted in localStorage
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(RECENT_SEARCHES_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed.slice(0, MAX_RECENT_SEARCHES);
      }
    } catch {
      // ignore parse errors
    }
    return [];
  });

  const recordRecentSearch = (word: string) => {
    const clean = word.trim();
    if (!clean) return;
    setRecentSearches(prev => {
      const updated = [clean, ...prev.filter(w => w.toLowerCase() !== clean.toLowerCase())].slice(0, MAX_RECENT_SEARCHES);
      try {
        localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
      } catch {
        // ignore quota errors
      }
      return updated;
    });
  };

  const handleClearRecentSearches = () => {
    setRecentSearches([]);
    try {
      localStorage.removeItem(RECENT_SEARCHES_KEY);
    } catch {
      // ignore
    }
  };

  // Debounce logic for autocomplete suggestions
  useEffect(() => {
    let isActive = true;

    const fetchSuggestions = async () => {
      const currentQuery = query.trim();
      if (currentQuery.length < 2 || currentQuery.toLowerCase() === lastSearched.current.toLowerCase()) {
        if (isActive) {
          setSuggestions([]);
          setShowSuggestions(false);
        }
        return;
      }

      const words = await getWordSuggestions(currentQuery);

      if (isActive && query.trim().toLowerCase() !== lastSearched.current.toLowerCase()) {
        setSuggestions(words);
        setShowSuggestions(words.length > 0);
        // Prefetch top suggestion and exact match so search/click is instantaneous
        if (words.length > 0) {
          prefetchWord(words[0]);
          const exact = words.find(w => w.toLowerCase() === currentQuery.toLowerCase());
          if (exact && exact !== words[0]) {
            prefetchWord(exact);
          }
        }
      }
    };

    const timeoutId = setTimeout(fetchSuggestions, 200);
    return () => {
      isActive = false;
      clearTimeout(timeoutId);
    };
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
    const trimmedQuery = searchQuery.trim();
    if (!trimmedQuery) return;

    const requestId = ++searchRequestIdRef.current;
    lastSearched.current = trimmedQuery;
    setLoading(true);
    setError('');
    setResult(null);
    setTypoSuggestion(null);
    setShowSuggestions(false); // Hide dropdown immediately
    setSuggestions([]);

    trackEvent(TRACKING_ACTION.SEARCH, TRACKING_CATEGORY.DICTIONARY, trimmedQuery);

    try {
      const data = await lookupWord(trimmedQuery);
      if (requestId !== searchRequestIdRef.current) return;

      if (data && data.word) {
        setResult(data);
        lastSearched.current = data.word.trim();
        setQuery(data.word); // Normalize case in input
        recordRecentSearch(data.word);
        setLoading(false);

        // If the image wasn't in the quick cache window yet, resolve it non-blockingly in the background
        if (!data.image) {
          fetchImageForWord(data.word).then(image => {
            if (image && requestId === searchRequestIdRef.current) {
              setResult(prev => (prev && prev.word === data.word ? { ...prev, image } : prev));
            }
          });
        }
      } else {
        // If not found, try to find suggestions for typos
        const typoSuggestions = await getSpellingSuggestions(trimmedQuery);
        if (requestId !== searchRequestIdRef.current) return;
        if (typoSuggestions.length > 0) {
          // Use the first suggestion
          setTypoSuggestion(typoSuggestions[0]);
          prefetchWord(typoSuggestions[0]);
        }
        setError(`Could not find a definition for "${trimmedQuery}".`);
        setLoading(false);
      }
    } catch (err) {
      if (requestId !== searchRequestIdRef.current) return;
      setError('An error occurred while fetching the definition. Please try again.');
      setLoading(false);
    }
  };

  // Auto-search when navigated from Dashboard with a pre-filled query in router state
  useEffect(() => {
    if (initialQuery && initialQuery.trim()) {
      performSearch(initialQuery.trim());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

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

  const handleSurpriseMe = () => {
    const currentLower = result?.word?.toLowerCase() || query.trim().toLowerCase();
    const candidates = ALL_DISCOVERY_WORDS.filter(w => w.toLowerCase() !== currentLower);
    const randomWord = candidates[Math.floor(Math.random() * candidates.length)] || ALL_DISCOVERY_WORDS[0];
    handleSuggestionClick(randomWord);
  };

  const getSavedCard = (word: string, def: string) => {
    return existingCards.find(card =>
      card.word.toLowerCase() === word.toLowerCase() &&
      card.mainDefinition === def
    );
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 sm:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="text-center space-y-2 sm:space-y-4">
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-serif font-bold text-slate-900 dark:text-white tracking-tight">Lumina</h1>
        <p className="text-slate-500 dark:text-slate-400 text-base sm:text-lg">Illuminate your vocabulary.</p>
      </div>

      <div className="space-y-3">
        <div ref={wrapperRef} className="relative group z-20">
          <form onSubmit={handleSearch} className="relative">
            <div className="absolute inset-y-0 left-0 pl-3.5 sm:pl-4 flex items-center pointer-events-none">
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
              className="block w-full pl-10 sm:pl-11 pr-24 py-3 sm:py-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-2xl text-base sm:text-lg text-slate-900 dark:text-white shadow-sm placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 transition-all"
              autoComplete="off"
            />
            <button
              type="submit"
              disabled={(loading && query.trim().toLowerCase() === lastSearched.current.toLowerCase()) || !query.trim()}
              className="absolute right-2 top-1.5 bottom-1.5 sm:top-2 sm:bottom-2 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 px-3.5 sm:px-4 rounded-xl text-sm sm:text-base font-medium hover:bg-slate-800 dark:hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
                    onMouseEnter={() => prefetchWord(word)}
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

        {/* Surprise Me + Recent Searches Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <div className="flex flex-wrap items-center gap-1.5" aria-label="Recent searches">
            {recentSearches.length > 0 && (
              <>
                <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mr-1">
                  <Clock className="h-3.5 w-3.5" />
                  Recent:
                </span>
                {recentSearches.map((item) => (
                  <button
                    key={item}
                    onClick={() => handleSuggestionClick(item)}
                    className="px-2.5 py-1 rounded-full text-xs font-medium bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:border-brand-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors shadow-sm"
                  >
                    {item}
                  </button>
                ))}
                <button
                  onClick={handleClearRecentSearches}
                  aria-label="Clear recent searches"
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-400 hover:text-red-500 transition-colors"
                >
                  <X className="h-3 w-3" />
                  Clear
                </button>
              </>
            )}
          </div>

          <button
            onClick={handleSurpriseMe}
            className="ml-auto inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 border border-brand-200 dark:border-brand-800/60 hover:bg-brand-100 dark:hover:bg-brand-900/50 transition-colors shadow-sm"
          >
            <Sparkles className="h-3.5 w-3.5 text-brand-500" />
            Surprise Me
          </button>
        </div>
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
        <div className="bg-white dark:bg-slate-800 rounded-2xl sm:rounded-3xl shadow-xl shadow-slate-200/50 dark:shadow-none overflow-hidden border border-slate-100 dark:border-slate-700">
          <div className="p-5 sm:p-8 border-b border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30 space-y-3">
            <div className="flex items-baseline gap-3 sm:gap-4 flex-wrap">
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-serif font-bold text-slate-900 dark:text-white break-words">{result.word}</h2>
              {result.phonetic && (
                <span className="text-base sm:text-xl text-slate-500 dark:text-slate-400 font-serif italic">{result.phonetic}</span>
              )}
              <button
                onClick={() => playAudio(result.word, result.audio)}
                className="p-1.5 text-slate-400 hover:text-brand-500 hover:bg-brand-50 dark:hover:bg-brand-900/30 rounded-full transition-colors"
                title="Listen to pronunciation"
              >
                <Volume2 className="h-5 w-5 sm:h-6 sm:w-6" />
              </button>
            </div>
            {(languagePreference === 'fa' || languagePreference === 'both') &&
              result.wordTranslations?.fa &&
              result.wordTranslations.fa.length > 0 && (
                <div
                  lang="fa"
                  dir="rtl"
                  data-testid="dictionary-word-translation-fa"
                  className="font-persian text-base sm:text-lg font-semibold text-emerald-800 dark:text-emerald-300 bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-800/60 rounded-xl px-4 py-2.5 text-right"
                >
                  {result.wordTranslations.fa.join('، ')}
                </div>
              )}
            {result.origin && (
              <div className="text-sm text-slate-500 dark:text-slate-400 bg-white/70 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700/70 rounded-xl px-4 py-2.5">
                <span className="font-semibold uppercase tracking-wider text-[11px] text-slate-400 dark:text-slate-500 mr-2">
                  Origin
                </span>
                <span>{result.origin}</span>
              </div>
            )}

            <div className="pt-2">
              <TagSelectorInput
                selectedTags={selectedTags}
                onChange={handleDictionaryTagsChange}
                existingCards={existingCards}
                label="Collections & Tags for this Word"
                placeholder="Write a tag name to get suggestions or click to select..."
                compact
                inputAriaLabel="Dictionary word tags"
              />
            </div>
          </div>

          <div className="p-5 sm:p-8 space-y-6 sm:space-y-8">
            {result.image && (
              <div className="mb-4 sm:mb-6 rounded-2xl overflow-hidden shadow-sm border border-slate-100 dark:border-slate-700 max-h-56 sm:max-h-64 flex justify-center bg-slate-50 dark:bg-slate-900 items-center">
                <img
                  src={result.image}
                  alt={`Visual mnemonic for ${result.word}`}
                  className="max-h-56 sm:max-h-64 object-contain"
                  loading="lazy"
                />
              </div>
            )}
            {result.meanings?.map((meaning, idx) => (
              <div key={`${meaning.partOfSpeech}-${idx}`} className="space-y-4">
                <div className="flex items-center gap-3">
                  <span className="px-3 py-1 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs sm:text-sm font-semibold rounded-full uppercase tracking-wider">
                    {meaning.partOfSpeech}
                  </span>
                  <div className="h-px bg-slate-100 dark:bg-slate-700 flex-grow"></div>
                </div>

                <div className="space-y-5 sm:space-y-6">
                  {meaning.definitions?.map((def, dIdx) => {
                    const savedCard = getSavedCard(result.word, def.definition);
                    const isSaved = !!savedCard;
                    const resolvedDef = resolveMeaningDisplay(
                      def.definition,
                      def.translations,
                      languagePreference
                    );
                    const senseTranslations: LocalizedTranslations | undefined =
                      def.translations?.fa
                        ? def.translations
                        : result.wordTranslations?.fa?.length
                          ? { fa: result.wordTranslations.fa.join('، ') }
                          : undefined;

                    return (
                      <div key={dIdx} className="group relative pl-3.5 sm:pl-4 border-l-2 border-transparent hover:border-brand-200 transition-colors">
                        <div className="space-y-2" data-testid="dictionary-sense-meaning">
                          {resolvedDef.showEnglish && (
                            <p
                              lang="en"
                              dir="ltr"
                              data-testid="dictionary-def-en"
                              className="text-slate-800 dark:text-slate-200 text-base sm:text-lg leading-relaxed"
                            >
                              <ClickableDefinitionText
                                text={def.definition}
                                onWordClick={handleSuggestionClick}
                              />
                            </p>
                          )}
                          {resolvedDef.showPersian && (
                            <p
                              lang="fa"
                              dir="rtl"
                              data-testid="dictionary-def-fa"
                              className={
                                resolvedDef.showEnglish
                                  ? 'font-persian text-emerald-800 dark:text-emerald-300 text-base sm:text-lg leading-relaxed text-right pt-2 border-t border-slate-100 dark:border-slate-700/70'
                                  : 'font-persian text-slate-800 dark:text-slate-100 text-base sm:text-lg leading-relaxed text-right'
                              }
                            >
                              {resolvedDef.persianText}
                            </p>
                          )}
                        </div>
                        {def.example && (
                          <p className="mt-2 text-sm sm:text-base text-slate-500 dark:text-slate-400 italic font-serif">
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
                                onAddCard(
                                  result,
                                  def.definition,
                                  def.example || '',
                                  meaning.partOfSpeech,
                                  selectedTags.length > 0 ? selectedTags : undefined,
                                  senseTranslations
                                );
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

                {((meaning.synonyms && meaning.synonyms.length > 0) ||
                  (meaning.antonyms && meaning.antonyms.length > 0)) && (
                  <div className="pt-3 pl-4 space-y-2.5">
                    {meaning.synonyms && meaning.synonyms.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2" aria-label="Synonyms">
                        <span className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mr-1">
                          Synonyms
                        </span>
                        {meaning.synonyms.map((syn) => (
                          <button
                            key={syn}
                            onClick={() => handleSuggestionClick(syn)}
                            onMouseEnter={() => prefetchWord(syn)}
                            className="px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200/70 dark:border-emerald-800/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors"
                          >
                            {syn}
                          </button>
                        ))}
                      </div>
                    )}

                    {meaning.antonyms && meaning.antonyms.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2" aria-label="Antonyms">
                        <span className="text-xs font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400 mr-1">
                          Antonyms
                        </span>
                        {meaning.antonyms.map((ant) => (
                          <button
                            key={ant}
                            onClick={() => handleSuggestionClick(ant)}
                            onMouseEnter={() => prefetchWord(ant)}
                            className="px-2.5 py-1 rounded-full text-xs font-medium bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 border border-rose-200/70 dark:border-rose-800/60 hover:bg-rose-100 dark:hover:bg-rose-900/50 transition-colors"
                          >
                            {ant}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!result && !loading && !error && (
        <div className="space-y-4 pt-2" aria-label="Curated word packs">
          <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200 px-1">
            <Compass className="h-5 w-5 text-brand-500" />
            <h2 className="text-lg font-serif font-bold">Discover Curated Word Packs</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {CURATED_WORD_PACKS.map((pack) => (
              <div
                key={pack.title}
                className="p-5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shadow-sm space-y-3"
              >
                <div>
                  <h3 className="font-serif font-bold text-slate-900 dark:text-white text-base">
                    {pack.title}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {pack.subtitle}
                  </p>
                </div>

                <div className="flex flex-wrap gap-1.5 pt-1">
                  {pack.words.map((word) => {
                    const isAlreadyInDeck = existingCards.some(
                      c => c.word.toLowerCase() === word.toLowerCase()
                    );
                    return (
                      <button
                        key={word}
                        onClick={() => handleSuggestionClick(word)}
                        onMouseEnter={() => prefetchWord(word)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                          isAlreadyInDeck
                            ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/50'
                            : 'bg-slate-50 dark:bg-slate-900/50 text-slate-700 dark:text-slate-300 border-slate-200/70 dark:border-slate-700 hover:border-brand-400 hover:text-brand-600 dark:hover:text-brand-400'
                        }`}
                      >
                        {word}
                        {isAlreadyInDeck && <Check className="h-3 w-3 text-emerald-500" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
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
