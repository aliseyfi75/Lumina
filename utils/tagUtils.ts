export interface ParsedTag {
  /** The canonical tag string stored on Flashcard.tags (e.g. "Book: Kite Runner" or "GRE Prep") */
  raw: string;
  /** True when the tag belongs to the Books collection */
  isBook: boolean;
  /** Parent folder name if nested (e.g. "Books" or custom folder before "/"), otherwise null */
  folder: string | null;
  /** Clean leaf name without "#Book:" or folder prefix (e.g. "Kite Runner" or "GRE Prep") */
  name: string;
  /** Clean short label for pills/badges (e.g. "Kite Runner" for books, "#GRE Prep" for flat tags) */
  shortLabel: string;
  /** Breadcrumb label showing hierarchy (e.g. "Books / Kite Runner") */
  breadcrumbLabel: string;
}

export interface TagWithCount {
  tag: string;
  count: number;
  parsed: ParsedTag;
}

export const BOOKS_FOLDER_FILTER = '__folder:Books__';

/**
 * Parses a raw tag string into a hierarchical folder/item structure.
 * Book tags ("Book: Title" or "Books/Title") are placed inside the "Books" collection
 * and display their clean book title without "#Book:" clutter.
 */
export function parseTagHierarchy(rawTag: string): ParsedTag {
  const trimmed = rawTag.trim();

  // Match "Book: <Title>" or "Books/<Title>"
  const bookMatch = trimmed.match(/^(?:book\s*:|books\s*\/)\s*(.+)$/i);
  if (bookMatch && bookMatch[1]) {
    const cleanTitle = bookMatch[1].trim();
    return {
      raw: trimmed,
      isBook: true,
      folder: 'Books',
      name: cleanTitle,
      shortLabel: cleanTitle,
      breadcrumbLabel: `Books / ${cleanTitle}`,
    };
  }

  // Match custom nested folder syntax "Folder/Subtag"
  const slashIdx = trimmed.indexOf('/');
  if (slashIdx > 0 && slashIdx < trimmed.length - 1) {
    const folder = trimmed.slice(0, slashIdx).trim();
    const subName = trimmed.slice(slashIdx + 1).trim();
    if (folder && subName) {
      return {
        raw: trimmed,
        isBook: folder.toLowerCase() === 'books' || folder.toLowerCase() === 'book',
        folder: folder.toLowerCase() === 'books' || folder.toLowerCase() === 'book' ? 'Books' : folder,
        name: subName,
        shortLabel: subName,
        breadcrumbLabel: `${folder} / ${subName}`,
      };
    }
  }

  return {
    raw: trimmed,
    isBook: false,
    folder: null,
    name: trimmed,
    shortLabel: `#${trimmed}`,
    breadcrumbLabel: `#${trimmed}`,
  };
}

/**
 * Simple bigram Dice similarity (0..1) to suggest related tags even on partial/fuzzy typing.
 */
function diceSimilarity(a: string, b: string): number {
  const s1 = a.toLowerCase().trim();
  const s2 = b.toLowerCase().trim();
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;
  if (s1.length < 2 || s2.length < 2) {
    return s1.includes(s2) || s2.includes(s1) ? 0.6 : 0;
  }

  const bigrams1 = new Map<string, number>();
  for (let i = 0; i < s1.length - 1; i++) {
    const bg = s1.slice(i, i + 2);
    bigrams1.set(bg, (bigrams1.get(bg) || 0) + 1);
  }

  let intersection = 0;
  for (let i = 0; i < s2.length - 1; i++) {
    const bg = s2.slice(i, i + 2);
    const count = bigrams1.get(bg) || 0;
    if (count > 0) {
      bigrams1.set(bg, count - 1);
      intersection++;
    }
  }

  return (2 * intersection) / (s1.length - 1 + (s2.length - 1));
}

/**
 * Computes ranked tag suggestions given a user's current input query,
 * all existing tags in the deck, and the already-selected tags.
 */
export function getRelatedTagSuggestions(
  query: string,
  availableTags: TagWithCount[],
  selectedTags: string[],
  maxResults = 8
): TagWithCount[] {
  const selectedLower = new Set(selectedTags.map(t => t.trim().toLowerCase()));
  const unselected = availableTags.filter(item => !selectedLower.has(item.tag.trim().toLowerCase()));

  const cleanedQuery = query.replace(/^#+/, '').trim().toLowerCase();
  if (!cleanedQuery) {
    return unselected
      .slice()
      .sort((a, b) => b.count - a.count || a.parsed.name.localeCompare(b.parsed.name))
      .slice(0, maxResults);
  }

  const scored: { item: TagWithCount; score: number }[] = [];

  for (const item of unselected) {
    const nameLower = item.parsed.name.toLowerCase();
    const rawLower = item.tag.toLowerCase();
    const folderLower = (item.parsed.folder || '').toLowerCase();
    const words = nameLower.split(/[\s\-_/]+/).filter(Boolean);

    let score = 0;
    if (nameLower === cleanedQuery || rawLower === cleanedQuery) {
      score = 100;
    } else if (nameLower.startsWith(cleanedQuery)) {
      score = 92;
    } else if (words.some(w => w.startsWith(cleanedQuery))) {
      score = 86;
    } else if (nameLower.includes(cleanedQuery)) {
      score = 78;
    } else if (folderLower && folderLower.startsWith(cleanedQuery)) {
      score = 72;
    } else if (rawLower.includes(cleanedQuery)) {
      score = 68;
    } else {
      const simName = diceSimilarity(cleanedQuery, nameLower);
      const maxWordSim = words.reduce((max, w) => Math.max(max, diceSimilarity(cleanedQuery, w)), 0);
      const bestSim = Math.max(simName, maxWordSim);
      if (bestSim >= 0.35) {
        score = Math.round(bestSim * 65);
      }
    }

    if (score > 0) {
      scored.push({ item, score });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score || b.item.count - a.item.count || a.item.parsed.name.localeCompare(b.item.parsed.name))
    .slice(0, maxResults)
    .map(entry => entry.item);
}

/**
 * Resolves a user-entered tag string against existing tags so that typing a book name
 * or selecting a tag preserves its canonical tag representation.
 */
export function resolveCanonicalTag(input: string, availableTags: TagWithCount[]): string {
  const cleaned = input.replace(/^#+/, '').trim();
  if (!cleaned) return '';

  // Check if it matches an existing tag's raw string or parsed name (if unambiguous)
  const lower = cleaned.toLowerCase();
  const exactRaw = availableTags.find(t => t.tag.toLowerCase() === lower);
  if (exactRaw) return exactRaw.tag;

  const exactBreadcrumb = availableTags.find(
    t => t.parsed.breadcrumbLabel.toLowerCase() === lower
  );
  if (exactBreadcrumb) return exactBreadcrumb.tag;

  // Support "Books / Title" or "Books: Title" -> "Book: Title"
  const booksPrefix = cleaned.match(/^books?\s*[/,:]\s*(.+)$/i);
  if (booksPrefix && booksPrefix[1]) {
    const bookName = booksPrefix[1].trim();
    const existingBook = availableTags.find(
      t => t.parsed.isBook && t.parsed.name.toLowerCase() === bookName.toLowerCase()
    );
    return existingBook ? existingBook.tag : `Book: ${bookName}`;
  }

  const matchingByName = availableTags.find(t => t.parsed.name.toLowerCase() === lower);
  if (matchingByName) return matchingByName.tag;

  return cleaned;
}
