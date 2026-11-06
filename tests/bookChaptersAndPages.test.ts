import { test, expect } from 'playwright/test';
import {
  segmentBookIntoChaptersOrPageRanges,
  extractComplexWordsFromText,
  formatTwentyPageBucket,
} from '../services/bookService';
import {
  parseTagHierarchy,
  compareChapterNames,
  formatBookChapterTag,
  getCardBookInfo,
} from '../utils/tagUtils';
import { Flashcard, FlashcardStatus } from '../types';

test.describe('Book Chapters & 20-Page Folders Unit Tests', () => {
  test('segments books with explicit chapter headings into per-chapter sections', async () => {
    const sampleBookWithChapters = `
Chapter 1: The Arrival
The ephemeral twilight settled over the labyrinthine citadel while the protagonist contemplated his trajectory.

Chapter 2: The Reckoning
An ubiquitous murmur echoed through the cavernous sanctuary as the indomitable council convened.

Chapter 3
The magnanimous sovereign articulated an eloquent benediction before the assembled multitude.
    `;

    const sections = segmentBookIntoChaptersOrPageRanges(sampleBookWithChapters);
    expect(sections.map(s => s.label)).toEqual([
      'Chapter 1',
      'Chapter 2',
      'Chapter 3',
    ]);

    const extracted = await extractComplexWordsFromText(sampleBookWithChapters, { maxWords: 20 });
    const ch1Words = extracted.filter(w => w.chapter === 'Chapter 1');
    const ch2Words = extracted.filter(w => w.chapter === 'Chapter 2');
    const ch3Words = extracted.filter(w => w.chapter === 'Chapter 3');

    expect(ch1Words.length).toBeGreaterThan(0);
    expect(ch2Words.length).toBeGreaterThan(0);
    expect(ch3Words.length).toBeGreaterThan(0);
  });

  test('segments chapterless books into 20-page folders (Pages 1-20, Pages 21-40, etc.)', async () => {
    expect(formatTwentyPageBucket(1)).toBe('Pages 1-20');
    expect(formatTwentyPageBucket(20)).toBe('Pages 1-20');
    expect(formatTwentyPageBucket(21)).toBe('Pages 21-40');
    expect(formatTwentyPageBucket(40)).toBe('Pages 21-40');
    expect(formatTwentyPageBucket(41)).toBe('Pages 41-60');

    // Create a chapterless book using form-feed page breaks (\f) spanning 25 pages
    const pages: string[] = [];
    for (let p = 1; p <= 25; p++) {
      if (p === 5) {
        pages.push('The ephemeral twilight illuminated the labyrinthine corridor with luminescent splendor.');
      } else if (p === 22) {
        pages.push('His magnanimous disposition and indomitable perseverance astonished the ubiquitous spectators.');
      } else {
        pages.push(`Simple text on page ${p} walking home quietly today.`);
      }
    }
    const chapterlessBook = pages.join('\f');

    const sections = segmentBookIntoChaptersOrPageRanges(chapterlessBook);
    expect(sections.map(s => s.label)).toEqual(['Pages 1-20', 'Pages 21-40']);

    const extracted = await extractComplexWordsFromText(chapterlessBook, { maxWords: 20 });
    const firstBucketWords = extracted.filter(w => w.chapter === 'Pages 1-20');
    const secondBucketWords = extracted.filter(w => w.chapter === 'Pages 21-40');

    expect(firstBucketWords.length).toBeGreaterThan(0);
    expect(secondBucketWords.length).toBeGreaterThan(0);

    // Also verify word-count based pagination when no form-feeds exist (using wordsPerPage = 5 -> 100 words per 20 pages)
    const block1 = Array.from({ length: 105 }, (_, i) => (i === 10 ? 'ephemeral' : 'simple')).join(' ') + '.';
    const block2 = Array.from({ length: 105 }, (_, i) => (i === 20 ? 'ubiquitous' : 'walking')).join(' ') + '.';
    const wordPaginatedSections = segmentBookIntoChaptersOrPageRanges(`${block1}\n${block2}`, 5);
    expect(wordPaginatedSections.map(s => s.label)).toEqual(['Pages 1-20', 'Pages 21-40']);
  });

  test('parses nested book chapter tags and sorts chapter & page range names naturally', () => {
    const tag = formatBookChapterTag('Dune', 'Chapter 1');
    expect(tag).toBe('Book: Dune / Chapter 1');

    const parsed = parseTagHierarchy(tag);
    expect(parsed.folder).toBe('Books');
    expect(parsed.bookTitle).toBe('Dune');
    expect(parsed.chapter).toBe('Chapter 1');
    expect(parsed.shortLabel).toBe('Dune / Chapter 1');
    expect(parsed.breadcrumbLabel).toBe('Books / Dune / Chapter 1');

    const unsorted = ['Chapter 10', 'Chapter 2', 'Chapter 1', 'Prologue'];
    expect([...unsorted].sort(compareChapterNames)).toEqual([
      'Prologue',
      'Chapter 1',
      'Chapter 2',
      'Chapter 10',
    ]);

    const unsortedPages = ['Pages 41-60', 'Pages 1-20', 'Pages 21-40'];
    expect([...unsortedPages].sort(compareChapterNames)).toEqual([
      'Pages 1-20',
      'Pages 21-40',
      'Pages 41-60',
    ]);
  });
});

test.describe('Book Nested Chapters & 20-Page Folders E2E', () => {
  test('renders nested chapter & 20-page folders, supports multi-chapter study selection, and masters Chapter 1 separately', async ({ page }) => {
    const now = Date.now() - 60_000;
    const seededCards: Flashcard[] = [
      // Book 1: Dune (with Chapters 1, 2, 3)
      {
        id: 'dune-ch1-1',
        word: 'melange',
        phonetic: '/meɪˈlɑːnʒ/',
        partOfSpeech: 'noun',
        mainDefinition: 'A mixture or medley; the geriatric spice of Arrakis.',
        example: 'The spice melange extends life and expands consciousness across the imperium.',
        synonyms: ['mixture', 'blend'],
        tags: ['Book: Dune', 'Book: Dune / Chapter 1'],
        bookChapter: 'Chapter 1',
        status: FlashcardStatus.New,
        nextReview: now,
        CreatedAt: now,
        interval: 0,
        repetition: 0,
        efactor: 2.5,
        complexityLevel: 'beginner',
        complexityScore: 30,
      },
      {
        id: 'dune-ch1-2',
        word: 'prescience',
        phonetic: '/ˈprɛʃəns/',
        partOfSpeech: 'noun',
        mainDefinition: 'The fact of knowing something before it takes place; foreknowledge.',
        example: 'Paul struggled with the terrible burden of prescience in the desert tent.',
        synonyms: ['foresight', 'foreknowledge'],
        tags: ['Book: Dune', 'Book: Dune / Chapter 1'],
        bookChapter: 'Chapter 1',
        status: FlashcardStatus.New,
        nextReview: now,
        CreatedAt: now,
        interval: 0,
        repetition: 0,
        efactor: 2.5,
        complexityLevel: 'advanced',
        complexityScore: 78,
      },
      {
        id: 'dune-ch2-1',
        word: 'benevolent',
        phonetic: '/bəˈnɛvələnt/',
        partOfSpeech: 'adjective',
        mainDefinition: 'Well meaning and kindly.',
        example: 'Duke Leto was revered as a benevolent leader by his loyal household.',
        synonyms: ['kindly', 'gracious'],
        tags: ['Book: Dune', 'Book: Dune / Chapter 2'],
        bookChapter: 'Chapter 2',
        status: FlashcardStatus.New,
        nextReview: now,
        CreatedAt: now,
        interval: 0,
        repetition: 0,
        efactor: 2.5,
        complexityLevel: 'intermediate',
        complexityScore: 52,
      },
      {
        id: 'dune-ch3-1',
        word: 'subterfuge',
        phonetic: '/ˈsʌbtərfjuːdʒ/',
        partOfSpeech: 'noun',
        mainDefinition: 'Deceit used in order to achieve ones goal.',
        example: 'Harkonnen subterfuge threatened every stronghold on Arrakeen.',
        synonyms: ['deception', 'artifice'],
        tags: ['Book: Dune', 'Book: Dune / Chapter 3'],
        bookChapter: 'Chapter 3',
        status: FlashcardStatus.New,
        nextReview: now,
        CreatedAt: now,
        interval: 0,
        repetition: 0,
        efactor: 2.5,
        complexityLevel: 'advanced',
        complexityScore: 74,
      },
      // Book 2: The Stranger (chapterless book organized in 20-page folders)
      {
        id: 'stranger-p1-20',
        word: 'listless',
        phonetic: '/ˈlɪstləs/',
        partOfSpeech: 'adjective',
        mainDefinition: 'Lacking energy or enthusiasm.',
        example: 'Under the glaring Algiers sun, the procession moved at a listless pace.',
        synonyms: ['lethargic', 'spiritless'],
        tags: ['Book: The Stranger', 'Book: The Stranger / Pages 1-20'],
        bookChapter: 'Pages 1-20',
        status: FlashcardStatus.New,
        nextReview: now,
        CreatedAt: now,
        interval: 0,
        repetition: 0,
        efactor: 2.5,
        complexityLevel: 'intermediate',
        complexityScore: 48,
      },
      {
        id: 'stranger-p21-40',
        word: 'implacable',
        phonetic: '/ɪmˈplækəbəl/',
        partOfSpeech: 'adjective',
        mainDefinition: 'Unable to be appeased or placated; relentless.',
        example: 'He opened himself to the benign indifference of an implacable universe.',
        synonyms: ['relentless', 'inexorable'],
        tags: ['Book: The Stranger', 'Book: The Stranger / Pages 21-40'],
        bookChapter: 'Pages 21-40',
        status: FlashcardStatus.New,
        nextReview: now,
        CreatedAt: now,
        interval: 0,
        repetition: 0,
        efactor: 2.5,
        complexityLevel: 'advanced',
        complexityScore: 76,
      },
    ];

    await page.addInitScript((cards) => {
      localStorage.setItem('lumina_cards_v1', JSON.stringify(cards));
    }, seededCards);

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/#/flashcards');

    // 1. Verify Book Vocabulary Dock shows nested chapter folders for Dune and 20-page folders for The Stranger
    const dock = page.getByTestId('book-vocabulary-dock');
    await expect(dock).toBeVisible();
    const chapterFolders = dock.getByTestId('book-chapter-folder');
    await expect(chapterFolders).toHaveCount(5); // Chapter 1, Chapter 2, Chapter 3, Pages 1-20, Pages 21-40
    await expect(dock).toContainText('Chapter 1');
    await expect(dock).toContainText('Chapter 2');
    await expect(dock).toContainText('Chapter 3');
    await expect(dock).toContainText('Pages 1-20');
    await expect(dock).toContainText('Pages 21-40');

    // 2. Verify Collections -> Books -> Dune shows 3rd-level nested chapter bar
    await page.getByTestId('collection-folder-Books').click();
    const booksSubfolder = page.getByTestId('collection-subfolder-Books');
    await expect(booksSubfolder).toBeVisible();

    await booksSubfolder.getByTestId('collection-book-pill').filter({ hasText: 'Dune' }).click();
    const nestedChapterBar = page.getByTestId('collection-book-chapters');
    await expect(nestedChapterBar).toBeVisible();
    await expect(nestedChapterBar.getByTestId('collection-chapter-pill')).toHaveCount(3);

    // Click Chapter 1 pill in Collections to filter flashcards to Chapter 1 only
    await nestedChapterBar.getByTestId('collection-chapter-pill').filter({ hasText: 'Chapter 1' }).click();
    await expect(page.getByRole('heading', { name: 'melange' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'prescience' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'benevolent' })).toHaveCount(0);

    // Capture screenshot of nested chapter folders & 20-page folders
    await page.screenshot({
      path: '/home/antigravity/.gemini/jetski/brain/v1/default/jetski_remote_agents_3p/a7fcfaec-b0d2-4bc2-b62c-d69cd223389f/scratch/feature2-nested-chapters-dock.png',
      fullPage: false,
    });

    // 3. Click Study on Chapter 1 in Book Vocabulary Dock to open SessionConfigModal pre-configured for Dune -> Chapter 1
    await dock.getByRole('button', { name: 'Study Dune Chapter 1' }).click();

    const chapterSelector = page.getByTestId('session-chapter-selector');
    await expect(chapterSelector).toBeVisible();
    await expect(page.getByLabel('Study tag filter')).toHaveValue('Book: Dune');
    await expect(chapterSelector).toContainText('1 selected');
    await expect(page.getByText(/Review all 2 cards that are due today/i)).toBeVisible();

    // Test multi-chapter selection: toggle Chapter 2 on as well -> 3 cards due, then toggle Chapter 2 off -> back to 2 cards due (Chapter 1 only)
    const ch2Option = chapterSelector.getByTestId('session-chapter-option').filter({ hasText: 'Chapter 2' });
    await ch2Option.click();
    await expect(chapterSelector).toContainText('2 selected');
    await expect(page.getByText(/Review all 3 cards that are due today/i)).toBeVisible();

    await ch2Option.click();
    await expect(chapterSelector).toContainText('1 selected');
    await expect(page.getByText(/Review all 2 cards that are due today/i)).toBeVisible();

    // Capture screenshot of SessionConfigModal with Chapter selector
    await page.screenshot({
      path: '/home/antigravity/.gemini/jetski/brain/v1/default/jetski_remote_agents_3p/a7fcfaec-b0d2-4bc2-b62c-d69cd223389f/scratch/feature2-session-chapter-selector.png',
    });

    // 4. Start the study session for Chapter 1 and master both words in Chapter 1
    await page.getByRole('button', { name: /Start Full Session/i }).click();

    // Card 1 of 2 in Chapter 1 (sorted easier first: 'melange' is beginner, 'prescience' is advanced)
    await expect(page.getByRole('heading', { name: 'melange' })).toBeVisible();
    await expect(page.getByTestId('study-card-complexity-badge').first()).toHaveText(/beginner/i);
    await expect(page.getByTestId('study-card-chapter-badge').first()).toHaveText('Chapter 1');

    // Capture screenshot of studying a specific chapter
    await page.screenshot({
      path: '/home/antigravity/.gemini/jetski/brain/v1/default/jetski_remote_agents_3p/a7fcfaec-b0d2-4bc2-b62c-d69cd223389f/scratch/feature2-study-chapter.png',
    });

    // Mark 'melange' as Mastered
    await page.getByText('Click to reveal').click();
    await page.getByRole('button', { name: /Mastered/i }).click();

    // Card 2 of 2 in Chapter 1: 'prescience' (advanced)
    await expect(page.getByRole('heading', { name: 'prescience' })).toBeVisible();
    await expect(page.getByTestId('study-card-complexity-badge').first()).toHaveText(/advanced/i);
    await expect(page.getByTestId('study-card-chapter-badge').first()).toHaveText('Chapter 1');

    // Mark 'prescience' as Mastered
    await page.getByText('Click to reveal').click();
    await page.getByRole('button', { name: /Mastered/i }).click();

    // Session completes after the 2 Chapter 1 cards (Chapter 2 and Chapter 3 were not included!)
    await expect(page.getByRole('heading', { name: /Session Complete/i })).toBeVisible();
    await page.getByRole('button', { name: /Return to Dashboard/i }).click();
    await page.getByRole('link', { name: /Flashcards/i }).click();

    // Verify Chapter 1 is now Mastered (2/2) while Chapter 2 is still 0/1
    const updatedDock = page.getByTestId('book-vocabulary-dock');
    await expect(updatedDock).toBeVisible();
    const ch1Folder = updatedDock.getByTestId('book-chapter-folder').filter({ hasText: 'Chapter 1' });
    await expect(ch1Folder).toContainText('2/2');
    await expect(ch1Folder).toContainText('Mastered');

    const ch2Folder = updatedDock.getByTestId('book-chapter-folder').filter({ hasText: 'Chapter 2' });
    await expect(ch2Folder).toContainText('0/1');

    await page.screenshot({
      path: '/home/antigravity/.gemini/jetski/brain/v1/default/jetski_remote_agents_3p/a7fcfaec-b0d2-4bc2-b62c-d69cd223389f/scratch/feature2-chapter1-mastered.png',
    });
  });
});
