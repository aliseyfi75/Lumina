import React, { useState, useMemo } from 'react';
import { Tag, BookOpen, Folder, X, Plus } from 'lucide-react';
import { Flashcard } from '../types';
import {
  parseTagHierarchy,
  getRelatedTagSuggestions,
  resolveCanonicalTag,
  TagWithCount,
} from '../utils/tagUtils';

interface TagSelectorInputProps {
  selectedTags: string[];
  onChange: (tags: string[]) => void;
  existingCards: Flashcard[];
  label?: string;
  placeholder?: string;
  compact?: boolean;
  inputAriaLabel?: string;
}

export const TagSelectorInput: React.FC<TagSelectorInputProps> = ({
  selectedTags,
  onChange,
  existingCards,
  label = 'Collections & Tags',
  placeholder = 'Type a tag or book collection (e.g. GRE, Books/Dune)...',
  compact = false,
  inputAriaLabel = 'Tag name input',
}) => {
  const [inputValue, setInputValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);

  const availableTags: TagWithCount[] = useMemo(() => {
    const counts = new Map<string, number>();
    for (const card of existingCards) {
      for (const raw of card.tags || []) {
        const trimmed = raw.trim();
        if (trimmed) {
          counts.set(trimmed, (counts.get(trimmed) || 0) + 1);
        }
      }
    }
    return Array.from(counts.entries())
      .map(([tag, count]) => ({
        tag,
        count,
        parsed: parseTagHierarchy(tag),
      }))
      .sort((a, b) => a.parsed.name.localeCompare(b.parsed.name));
  }, [existingCards]);

  const suggestions = useMemo(
    () => getRelatedTagSuggestions(inputValue, availableTags, selectedTags, 8),
    [inputValue, availableTags, selectedTags]
  );

  const handleAddTag = (rawOrTyped: string) => {
    const parts = rawOrTyped
      .split(',')
      .map(p => resolveCanonicalTag(p, availableTags))
      .filter(Boolean);

    if (parts.length === 0) return;

    const existingLower = new Set(selectedTags.map(t => t.trim().toLowerCase()));
    const next = [...selectedTags];
    for (const part of parts) {
      if (!existingLower.has(part.toLowerCase())) {
        existingLower.add(part.toLowerCase());
        next.push(part);
      }
    }
    onChange(next);
    setInputValue('');
  };

  const handleRemoveTag = (tagToRemove: string) => {
    onChange(selectedTags.filter(t => t !== tagToRemove));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (inputValue.trim()) {
        handleAddTag(inputValue);
      }
    } else if (e.key === 'Backspace' && !inputValue && selectedTags.length > 0) {
      handleRemoveTag(selectedTags[selectedTags.length - 1]);
    }
  };

  const trimmedQuery = inputValue.replace(/^#+/, '').trim();
  const hasExactMatchInSelectedOrSuggestions =
    !trimmedQuery ||
    selectedTags.some(
      t =>
        t.toLowerCase() === trimmedQuery.toLowerCase() ||
        parseTagHierarchy(t).name.toLowerCase() === trimmedQuery.toLowerCase()
    ) ||
    suggestions.some(
      s =>
        s.tag.toLowerCase() === trimmedQuery.toLowerCase() ||
        s.parsed.name.toLowerCase() === trimmedQuery.toLowerCase()
    );

  return (
    <div className="space-y-2" data-testid="tag-selector-input">
      {label && (
        <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          <Tag className="h-3.5 w-3.5" />
          {label}
        </label>
      )}

      <div
        className={`bg-slate-50 dark:bg-slate-900/60 border rounded-xl transition-all ${
          compact ? 'p-2' : 'p-2.5'
        } ${
          isFocused
            ? 'border-brand-500 ring-2 ring-brand-500/15'
            : 'border-slate-200 dark:border-slate-700'
        }`}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          {selectedTags.map((rawTag) => {
            const parsed = parseTagHierarchy(rawTag);
            return (
              <span
                key={rawTag}
                data-testid="selected-tag-chip"
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                  parsed.isBook
                    ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60'
                    : 'bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 border-brand-200 dark:border-brand-800/60'
                }`}
              >
                {parsed.isBook ? (
                  <>
                    <BookOpen className="h-3 w-3 shrink-0" />
                    <span className="opacity-70 font-normal">Books /</span>
                    <span>{parsed.name}</span>
                  </>
                ) : parsed.folder ? (
                  <>
                    <Folder className="h-3 w-3 shrink-0" />
                    <span className="opacity-70 font-normal">{parsed.folder} /</span>
                    <span>{parsed.name}</span>
                  </>
                ) : (
                  <span>#{parsed.name}</span>
                )}
                <button
                  type="button"
                  onClick={() => handleRemoveTag(rawTag)}
                  aria-label={`Remove tag ${parsed.name}`}
                  className="ml-0.5 p-0.5 rounded-full hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}

          <div className="flex-1 min-w-[160px] flex items-center gap-1.5">
            <input
              type="text"
              aria-label={inputAriaLabel}
              value={inputValue}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={selectedTags.length === 0 ? placeholder : 'Add another tag...'}
              className="w-full bg-transparent text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none py-1 px-1"
            />
            {trimmedQuery && (
              <button
                type="button"
                onClick={() => handleAddTag(inputValue)}
                className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-brand-600 hover:bg-brand-700 text-white transition-colors"
              >
                <Plus className="h-3 w-3" />
                Add
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Suggested / Related Tags */}
      {(suggestions.length > 0 || !hasExactMatchInSelectedOrSuggestions) && (
        <div
          data-testid="tag-suggestions-list"
          className="flex flex-wrap items-center gap-1.5 pt-0.5"
        >
          <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 mr-0.5">
            {trimmedQuery ? 'Suggested tags:' : 'Quick select:'}
          </span>
          {suggestions.map(({ tag, count, parsed }) => (
            <button
              key={tag}
              type="button"
              data-testid="tag-suggestion-pill"
              onMouseDown={(e) => {
                // Prevent input blur before click registers
                e.preventDefault();
                handleAddTag(tag);
              }}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-all cursor-pointer ${
                parsed.isBook
                  ? 'bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 hover:border-emerald-400'
                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-brand-50 dark:hover:bg-brand-900/30 hover:text-brand-600 dark:hover:text-brand-400 hover:border-brand-300'
              }`}
            >
              {parsed.isBook ? (
                <>
                  <BookOpen className="h-3 w-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span className="opacity-70">Books /</span>
                  <span className="font-semibold">{parsed.name}</span>
                </>
              ) : parsed.folder ? (
                <>
                  <Folder className="h-3 w-3 text-brand-500 shrink-0" />
                  <span className="opacity-70">{parsed.folder} /</span>
                  <span className="font-semibold">{parsed.name}</span>
                </>
              ) : (
                <span className="font-semibold">#{parsed.name}</span>
              )}
              <span className="text-[10px] opacity-60">({count})</span>
            </button>
          ))}

          {!hasExactMatchInSelectedOrSuggestions && trimmedQuery && (
            <button
              type="button"
              data-testid="tag-create-pill"
              onMouseDown={(e) => {
                e.preventDefault();
                handleAddTag(inputValue);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 border border-brand-200 dark:border-brand-800 hover:bg-brand-100 transition-all"
            >
              <Plus className="h-3 w-3" />
              Create “#{trimmedQuery}”
            </button>
          )}
        </div>
      )}
    </div>
  );
};
