import React, { useState, useRef } from 'react';
import {
  X,
  Search,
  BookOpen,
  Upload,
  Sparkles,
  Check,
  Loader2,
  FileText,
  AlertCircle,
  ArrowLeft,
  Quote,
} from 'lucide-react';
import {
  GutenbergBook,
  BookExtractedWord,
  searchGutenbergBooks,
  fetchGutenbergBookText,
  extractTextFromBookFile,
  extractComplexWordsFromText,
} from '../services/bookService';

interface BookPrepModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingWords: Set<string>;
  onImportBookWords: (bookTitle: string, words: BookExtractedWord[]) => void;
}

export const BookPrepModal: React.FC<BookPrepModalProps> = ({
  isOpen,
  onClose,
  existingWords,
  onImportBookWords,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchResults, setSearchResults] = useState<GutenbergBook[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Extraction state
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionStage, setExtractionStage] = useState('');
  const [activeBookTitle, setActiveBookTitle] = useState('');
  const [extractedWords, setExtractedWords] = useState<BookExtractedWord[]>([]);
  const [selectedWordSet, setSelectedWordSet] = useState<Set<string>>(new Set());
  const [extractionError, setExtractionError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  const resetModal = () => {
    setSearchQuery('');
    setIsSearching(false);
    setHasSearched(false);
    setSearchResults([]);
    setSearchError(null);
    setIsExtracting(false);
    setExtractionStage('');
    setActiveBookTitle('');
    setExtractedWords([]);
    setSelectedWordSet(new Set());
    setExtractionError(null);
  };

  const handleClose = () => {
    resetModal();
    onClose();
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchQuery.trim();
    if (!trimmed) return;

    setIsSearching(true);
    setSearchError(null);
    setExtractionError(null);
    setExtractedWords([]);

    try {
      const results = await searchGutenbergBooks(trimmed);
      setSearchResults(results);
      setHasSearched(true);
      if (results.length === 0) {
        setActiveBookTitle(trimmed);
      }
    } catch {
      setSearchResults([]);
      setHasSearched(true);
      setActiveBookTitle(trimmed);
    } finally {
      setIsSearching(false);
    }
  };

  const runExtraction = async (title: string, text: string) => {
    setActiveBookTitle(title);
    setExtractionStage('Analyzing book text and extracting complex words...');
    const words = await extractComplexWordsFromText(text, {
      maxWords: 12,
      existingWords,
      onProgress: (stage) => setExtractionStage(stage),
    });

    if (words.length === 0) {
      setExtractionError(
        'No new complex words were found in this text (or they are already in your deck).'
      );
      return;
    }

    setExtractedWords(words);
    setSelectedWordSet(new Set(words.map(w => w.word.toLowerCase())));
  };

  const handleSelectGutenbergBook = async (book: GutenbergBook) => {
    setIsExtracting(true);
    setExtractionError(null);
    setActiveBookTitle(book.title);
    setExtractionStage(`Downloading "${book.title}" from Project Gutenberg...`);

    try {
      const text = await fetchGutenbergBookText(book);
      await runExtraction(book.title, text);
    } catch {
      setSearchResults([]);
      setHasSearched(true);
      setActiveBookTitle(book.title);
      setExtractionError(
        `Could not download "${book.title}" directly. Please upload a .txt or .epub copy below to extract its vocabulary.`
      );
    } finally {
      setIsExtracting(false);
      setExtractionStage('');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    setIsExtracting(true);
    setExtractionError(null);
    setExtractionStage(`Reading ${file.name}...`);

    try {
      const { title: parsedTitle, text } = await extractTextFromBookFile(file);
      const finalTitle = activeBookTitle.trim() || searchQuery.trim() || parsedTitle;
      await runExtraction(finalTitle, text);
    } catch (err: any) {
      setExtractionError(
        err instanceof Error ? err.message : 'Failed to read book file. Please upload a .txt or .epub file.'
      );
    } finally {
      setIsExtracting(false);
      setExtractionStage('');
    }
  };

  const toggleWordSelection = (wordLower: string) => {
    setSelectedWordSet(prev => {
      const next = new Set(prev);
      if (next.has(wordLower)) {
        next.delete(wordLower);
      } else {
        next.add(wordLower);
      }
      return next;
    });
  };

  const handleConfirmImport = () => {
    const chosen = extractedWords.filter(w => selectedWordSet.has(w.word.toLowerCase()));
    if (chosen.length === 0) return;
    const cleanTitle = activeBookTitle.trim() || 'Untitled Book';
    onImportBookWords(cleanTitle, chosen);
    handleClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />

      <div className="relative w-full max-w-2xl bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-slate-100 dark:border-slate-700 overflow-hidden z-10 flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between bg-slate-50 dark:bg-slate-800/60 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-brand-100 dark:bg-brand-900/40 text-brand-600 dark:text-brand-400">
              <BookOpen className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-serif font-bold text-slate-900 dark:text-white">
                Prepare for a Book
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Extract complex words & real book sentences into a dedicated study dock
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            aria-label="Close book preparation modal"
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto custom-scrollbar space-y-6 flex-1">
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.epub,.md,.html"
            aria-label="Upload book file"
            onChange={handleFileUpload}
            className="hidden"
          />

          {/* Loading State during Extraction */}
          {isExtracting && (
            <div className="py-14 flex flex-col items-center justify-center text-center space-y-4">
              <div className="p-4 rounded-2xl bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-serif font-bold text-slate-900 dark:text-white">
                  Building Vocabulary Dock for “{activeBookTitle || 'Book'}”
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {extractionStage || 'Extracting complex words and real sentences from the book...'}
                </p>
              </div>
            </div>
          )}

          {/* Step 3: Extracted Words Preview */}
          {!isExtracting && extractedWords.length > 0 && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setExtractedWords([]);
                    setExtractionError(null);
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back to book search
                </button>

                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 border border-brand-200 dark:border-brand-800">
                    #Book: {activeBookTitle}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedWordSet.size === extractedWords.length) {
                        setSelectedWordSet(new Set());
                      } else {
                        setSelectedWordSet(new Set(extractedWords.map(w => w.word.toLowerCase())));
                      }
                    }}
                    className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline"
                  >
                    {selectedWordSet.size === extractedWords.length ? 'Deselect All' : 'Select All'}
                  </button>
                </div>
              </div>

              <div className="space-y-2.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Book Title for Dock Group
                </label>
                <input
                  type="text"
                  aria-label="Book title for dock"
                  value={activeBookTitle}
                  onChange={(e) => setActiveBookTitle(e.target.value)}
                  className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:border-brand-500"
                />
              </div>

              <div className="space-y-3">
                {extractedWords.map((item) => {
                  const lower = item.word.toLowerCase();
                  const isChecked = selectedWordSet.has(lower);
                  return (
                    <div
                      key={lower}
                      onClick={() => toggleWordSelection(lower)}
                      className={`p-4 rounded-2xl border transition-all cursor-pointer flex items-start gap-3.5 ${
                        isChecked
                          ? 'bg-brand-50/50 dark:bg-brand-900/20 border-brand-300 dark:border-brand-700 shadow-sm'
                          : 'bg-white dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 opacity-65'
                      }`}
                    >
                      <div
                        className={`mt-1 w-5 h-5 rounded-md flex items-center justify-center border shrink-0 transition-colors ${
                          isChecked
                            ? 'bg-brand-600 border-brand-600 text-white'
                            : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800'
                        }`}
                      >
                        {isChecked && <Check className="h-3.5 w-3.5" />}
                      </div>

                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-serif font-bold text-lg text-slate-900 dark:text-white">
                            {item.word}
                          </span>
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                            {item.partOfSpeech}
                          </span>
                          {item.phonetic && (
                            <span className="text-xs text-slate-400 font-mono">
                              {item.phonetic}
                            </span>
                          )}
                        </div>

                        <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                          {item.mainDefinition}
                        </p>

                        {item.bookSentence && (
                          <div className="flex items-start gap-2 pt-1 text-xs italic text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/50 p-2.5 rounded-xl border border-slate-100 dark:border-slate-700/60">
                            <Quote className="h-3.5 w-3.5 text-brand-500 shrink-0 mt-0.5" />
                            <span>“{item.bookSentence}”</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Step 1 & 2: Search Public Domain Books OR Upload Book File */}
          {!isExtracting && extractedWords.length === 0 && (
            <div className="space-y-6">
              <form onSubmit={handleSearch} className="space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  1. Search by Book Title (Public Domain Catalog)
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="h-4 w-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="e.g. Frankenstein, Pride and Prejudice, Moby Dick..."
                      aria-label="Search book title"
                      className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isSearching || !searchQuery.trim()}
                    className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold rounded-xl shadow-sm transition-colors disabled:opacity-50 flex items-center gap-2 shrink-0"
                  >
                    {isSearching ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Searching...
                      </>
                    ) : (
                      <>
                        <Search className="h-4 w-4" />
                        Find Book
                      </>
                    )}
                  </button>
                </div>
              </form>

              {searchError && (
                <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{searchError}</span>
                </div>
              )}

              {extractionError && (
                <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{extractionError}</span>
                </div>
              )}

              {/* Tier 1 Results: Matching Gutenberg Books */}
              {hasSearched && searchResults.length > 0 && (
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    Matching Books Found ({searchResults.length})
                  </p>
                  <div className="grid grid-cols-1 gap-3">
                    {searchResults.map((book) => (
                      <div
                        key={book.id}
                        className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-4 hover:border-brand-300 dark:hover:border-brand-600 transition-all"
                      >
                        <div className="flex items-center gap-3.5 min-w-0">
                          {book.coverUrl ? (
                            <img
                              src={book.coverUrl}
                              alt={book.title}
                              className="w-11 h-16 object-cover rounded-lg border border-slate-200 dark:border-slate-700 shrink-0 bg-slate-200"
                            />
                          ) : (
                            <div className="w-11 h-16 rounded-lg bg-brand-100 dark:bg-brand-900/40 text-brand-600 dark:text-brand-400 flex items-center justify-center shrink-0">
                              <BookOpen className="h-5 w-5" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <h4 className="font-serif font-bold text-slate-900 dark:text-white truncate">
                              {book.title}
                            </h4>
                            <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                              {book.authors.join(', ')}
                            </p>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleSelectGutenbergBook(book)}
                          className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold rounded-xl shadow-sm transition-colors flex items-center gap-1.5 shrink-0"
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                          Extract Words
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Tier 1 -> Tier 2 Handoff when Book Not Found */}
              {hasSearched && searchResults.length === 0 && (
                <div
                  data-testid="book-not-found-upload-prompt"
                  className="p-5 rounded-2xl bg-amber-50/80 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 space-y-4"
                >
                  <div className="flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <h4 className="text-sm font-bold text-amber-900 dark:text-amber-200">
                        “{searchQuery.trim()}” wasn’t found in the public domain catalog
                      </h4>
                      <p className="text-xs text-amber-800/90 dark:text-amber-300/80 leading-relaxed">
                        Upload your own <strong>.epub</strong> or <strong>.txt</strong> copy of the book below—Lumina will scan it right in your browser, extract its complex words along with the actual sentences from the book, and create your study dock.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-amber-900 dark:text-amber-200">
                      Book Title for Dock
                    </label>
                    <input
                      type="text"
                      aria-label="Fallback book title"
                      value={activeBookTitle}
                      onChange={(e) => setActiveBookTitle(e.target.value)}
                      placeholder="Enter book title..."
                      className="w-full px-3.5 py-2 bg-white dark:bg-slate-800 border border-amber-300 dark:border-amber-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-brand-500"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full py-3 px-4 bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold rounded-xl shadow-sm transition-colors flex items-center justify-center gap-2"
                  >
                    <Upload className="h-4 w-4" />
                    Upload Book File (.epub or .txt)
                  </button>
                </div>
              )}

              {/* Direct Tier 2 Upload Option */}
              <div className="pt-2 border-t border-slate-100 dark:border-slate-700/70">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/40 border border-dashed border-slate-200 dark:border-slate-700">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                        Have an eBook file on your device?
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Upload any <strong>.epub</strong> or <strong>.txt</strong> book to extract complex words locally
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-4 py-2 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600 rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5 shrink-0 shadow-sm"
                  >
                    <Upload className="h-3.5 w-3.5 text-brand-600 dark:text-brand-400" />
                    Upload .epub / .txt
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {!isExtracting && extractedWords.length > 0 && (
          <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 flex items-center justify-between gap-3 shrink-0">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {selectedWordSet.size} of {extractedWords.length} complex words selected
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2.5 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={selectedWordSet.size === 0 || !activeBookTitle.trim()}
                onClick={handleConfirmImport}
                className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-brand-600 hover:bg-brand-700 text-white shadow-md shadow-brand-500/20 disabled:opacity-50 transition-colors flex items-center gap-2"
              >
                <Sparkles className="h-4 w-4" />
                Add {selectedWordSet.size} Words to Book Dock
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
