import { test, expect } from 'playwright/test';
import {
  segmentBookIntoChaptersOrPageRanges,
  extractComplexWordsFromText,
  formatTwentyPageBucket,
  formatPageRangeBucket,
  reassignWordsToBookSections,
} from '../services/bookService';
import {
  parseTagHierarchy,
  compareChapterNames,
  formatBookChapterTag,
  getCardBookInfo,
  getCardBookInfos,
  getCardBookInfoForBook,
} from '../utils/tagUtils';
import { Flashcard, FlashcardStatus } from '../types';

test.describe('Book Chapters & Page Sections Unit Tests', () => {
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

  test('supports Page-based mode with custom pagesPerSection and reassigns words across modes', async () => {
    expect(formatPageRangeBucket(1, 10)).toBe('Pages 1-10');
    expect(formatPageRangeBucket(10, 10)).toBe('Pages 1-10');
    expect(formatPageRangeBucket(11, 10)).toBe('Pages 11-20');
    expect(formatPageRangeBucket(25, 10)).toBe('Pages 21-30');
    expect(formatPageRangeBucket(3, 5)).toBe('Pages 1-5');
    expect(formatPageRangeBucket(6, 5)).toBe('Pages 6-10');

    // A book that has Chapter headings AND explicit Page markers
    const hybridBook = `
Chapter 1: The Beginning
Page 1
The ephemeral twilight settled over the labyrinthine citadel while the protagonist contemplated his trajectory.
Page 8
An ubiquitous murmur echoed through the cavernous sanctuary as the indomitable council convened.
Chapter 2: The Continuation
Page 12
The magnanimous sovereign articulated an eloquent benediction before the assembled multitude.
Page 23
A cacophonous symphony reverberated across the subterranean amphitheater during the solstice.
    `;

    // In 'chapters' mode -> Chapter 1, Chapter 2
    const chapterSections = segmentBookIntoChaptersOrPageRanges(hybridBook, 250, {
      mode: 'chapters',
      pagesPerSection: 10,
    });
    expect(chapterSections.map(s => s.label)).toEqual(['Chapter 1', 'Chapter 2']);

    // In 'pages' mode with 10 pages per section -> Pages 1-10, Pages 11-20, Pages 21-30
    const pageSections10 = segmentBookIntoChaptersOrPageRanges(hybridBook, 250, {
      mode: 'pages',
      pagesPerSection: 10,
    });
    expect(pageSections10.map(s => s.label)).toEqual(['Pages 1-10', 'Pages 11-20', 'Pages 21-30']);

    // Reassign words dynamically from Chapter-based to Page-based (10 pages/section and 5 pages/section)
    const sampleWords = [
      {
        word: 'Ephemeral',
        partOfSpeech: 'adjective',
        mainDefinition: 'Lasting for a very short time.',
        bookSentence: 'The ephemeral twilight settled over the labyrinthine citadel.',
        chapter: 'Chapter 1',
      },
      {
        word: 'Magnanimous',
        partOfSpeech: 'adjective',
        mainDefinition: 'Generous or forgiving.',
        bookSentence: 'The magnanimous sovereign articulated an eloquent benediction.',
        chapter: 'Chapter 2',
      },
      {
        word: 'Cacophonous',
        partOfSpeech: 'adjective',
        mainDefinition: 'Involving or producing a harsh, discordant mixture of sounds.',
        bookSentence: 'A cacophonous symphony reverberated across the subterranean amphitheater.',
        chapter: 'Chapter 2',
      },
    ];

    const reassigned10 = reassignWordsToBookSections(hybridBook, sampleWords, {
      mode: 'pages',
      pagesPerSection: 10,
    });
    expect(reassigned10.find(w => w.word === 'Ephemeral')?.chapter).toBe('Pages 1-10');
    expect(reassigned10.find(w => w.word === 'Magnanimous')?.chapter).toBe('Pages 11-20');
    expect(reassigned10.find(w => w.word === 'Cacophonous')?.chapter).toBe('Pages 21-30');

    const reassignedBackToChapters = reassignWordsToBookSections(hybridBook, reassigned10, {
      mode: 'chapters',
      pagesPerSection: 10,
    });
    expect(reassignedBackToChapters.find(w => w.word === 'Ephemeral')?.chapter).toBe('Chapter 1');
    expect(reassignedBackToChapters.find(w => w.word === 'Magnanimous')?.chapter).toBe('Chapter 2');
    expect(reassignedBackToChapters.find(w => w.word === 'Cacophonous')?.chapter).toBe('Chapter 2');
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

    const sharedCard = {
      tags: [
        'Book: First Odyssey',
        'Book: First Odyssey / Chapter 1',
        'Book: Second Odyssey',
        'Book: Second Odyssey / Chapter 3',
      ],
    };
    const allInfos = getCardBookInfos(sharedCard);
    expect(allInfos).toEqual([
      {
        bookTitle: 'First Odyssey',
        chapter: 'Chapter 1',
        bookTag: 'Book: First Odyssey',
        chapterTag: 'Book: First Odyssey / Chapter 1',
      },
      {
        bookTitle: 'Second Odyssey',
        chapter: 'Chapter 3',
        bookTag: 'Book: Second Odyssey',
        chapterTag: 'Book: Second Odyssey / Chapter 3',
      },
    ]);
    expect(getCardBookInfoForBook(sharedCard, 'Second Odyssey')?.chapter).toBe('Chapter 3');
    expect(getCardBookInfoForBook(sharedCard, 'First Odyssey')?.chapter).toBe('Chapter 1');
  });
});

test.describe('Book Nested Chapters & Page Sections E2E', () => {
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

    // 4. Start the study session for Chapter 1 and master both words in Chapter 1
    await page.getByRole('button', { name: /Start Full Session/i }).click();

    // Card 1 of 2 in Chapter 1 (sorted easier first: 'melange' is beginner, 'prescience' is advanced)
    await expect(page.getByRole('heading', { name: 'melange' })).toBeVisible();
    await expect(page.getByTestId('study-card-complexity-badge').first()).toHaveText(/beginner/i);
    await expect(page.getByTestId('study-card-chapter-badge').first()).toHaveText('Chapter 1');

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
  });

  test('allows selecting Chapter-based or Page-based vocab with custom pages per section when adding a book, and supports expandable section lists when sections are many', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });

    // Mock Datamuse and Dictionary APIs so book extraction runs deterministically and fast in E2E
    await page.route('https://api.datamuse.com/words*', async (route) => {
      const url = new URL(route.request().url());
      const word = url.searchParams.get('sp') || 'ephemeral';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            word,
            tags: ['f:0.45', 'pron:ɪˈfɛmərəl'],
            defs: [`adj\tLiterary definition for ${word} in this section.`],
          },
        ]),
      });
    });

    await page.route('https://api.dictionaryapi.dev/**', async (route) => {
      await route.fulfill({ status: 404, body: 'Not found' });
    });

    await page.goto('/#/flashcards');

    // Open "Prepare for a Book" modal
    await page.getByRole('button', { name: /Prepare for a Book/i }).first().click();

    const segSelector = page.getByTestId('segmentation-selector');
    await expect(segSelector).toBeVisible();

    // Select Page-based mode and verify user can clear the custom input with Backspace and type "2"
    await segSelector.getByTestId('segmentation-mode-pages').click();
    const pagesControl = segSelector.getByTestId('pages-per-section-control');
    await expect(pagesControl).toBeVisible();
    const customInput = pagesControl.getByTestId('pages-per-section-input');
    await customInput.click();
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await expect(customInput).toHaveValue('');
    await page.keyboard.type('2');
    await expect(customInput).toHaveValue('2');
    await expect(segSelector).toContainText('Groups every 2 pages per section');

    // Now select 10 pages per section for the 8-section test book
    await pagesControl.getByTestId('pages-per-section-preset-10').click();
    await expect(customInput).toHaveValue('10');

    // Capture screenshot of BookPrepModal with Page-based & Pages per Section selector
    await page.screenshot({
      path: '/home/antigravity/.gemini/jetski/brain/v1/default/jetski_remote_agents_3p/a7fcfaec-b0d2-4bc2-b62c-d69cd223389f/scratch/feature3-bookprep-page-mode-selector.png',
    });

    // Upload a book with 8 distinct 10-page sections (Pages 1-10 through Pages 71-80) AND Chapter headings
    const eightSectionWords = [
      'ephemeral',
      'labyrinthine',
      'magnanimous',
      'ubiquitous',
      'cacophonous',
      'indomitable',
      'luminescent',
      'subterranean',
    ];
    const bookLines: string[] = [];
    eightSectionWords.forEach((word, idx) => {
      const pageNum = idx * 10 + 2; // Pages 2, 12, 22, 32, 42, 52, 62, 72 -> 8 sections of 10 pages
      bookLines.push(`Chapter ${idx + 1}`);
      bookLines.push(`Page ${pageNum}`);
      bookLines.push(
        `The ${word} phenomenon captivated every scholar exploring the ancient library archives.`
      );
    });

    await page.getByLabel('Search book title').fill('Chronicles of Antiquity');
    const fileInput = page.locator('input[type="file"][aria-label="Upload book file"]');
    await fileInput.setInputFiles({
      name: 'chronicles.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(bookLines.join('\n'), 'utf-8'),
    });

    // Verify Preview screen appears with 8 page-based sections (10 pages each: Pages 1-10 ... Pages 71-80)
    const previewChapterFilter = page.getByTestId('preview-chapter-filter');
    await expect(previewChapterFilter).toBeVisible();
    await expect(previewChapterFilter).toContainText('Filter by Chapter / Section (8)');
    await expect(previewChapterFilter).toContainText('Pages 1-10');
    await expect(previewChapterFilter).toContainText('Pages 51-60');

    // Because there are 8 sections (> 6), the preview chapter filter collapses the remaining +2 sections behind an expand button
    const previewExpandBtn = previewChapterFilter.getByTestId('preview-chapters-expand-button');
    await expect(previewExpandBtn).toBeVisible();
    await expect(previewExpandBtn).toContainText('+2 more sections');
    await expect(previewChapterFilter).not.toContainText('Pages 71-80');

    // Expand all sections in Preview
    await previewExpandBtn.click();
    await expect(previewChapterFilter).toContainText('Pages 71-80');
    await expect(previewExpandBtn).toContainText('Show fewer sections');

    // Capture screenshot of Preview with Page-based 10-page sections and expandable filter
    await page.screenshot({
      path: '/home/antigravity/.gemini/jetski/brain/v1/default/jetski_remote_agents_3p/a7fcfaec-b0d2-4bc2-b62c-d69cd223389f/scratch/feature3-preview-page-sections-expanded.png',
    });

    // Also verify switching live to 20 pages per section in Preview updates sections to 4 buckets (Pages 1-20 ... Pages 61-80)
    const previewSegSelector = page.getByTestId('preview-segmentation-selector');
    await previewSegSelector.getByTestId('pages-per-section-preset-20').click();
    await expect(previewChapterFilter).toContainText('Filter by Chapter / Section (4)');
    await expect(previewChapterFilter).toContainText('Pages 1-20');
    await expect(previewChapterFilter).toContainText('Pages 61-80');

    // Switch back to 10 pages per section so we import 8 sections to test expandable sections across the app
    await previewSegSelector.getByTestId('pages-per-section-preset-10').click();
    await expect(previewChapterFilter).toContainText('Filter by Chapter / Section (8)');

    // Import the 8-section book into the deck
    await page.getByRole('button', { name: /Add \d+ Words to Book Dock/i }).click();

    // 1. Verify Book Vocabulary Dock shows only first 4 sections by default with "Show all 8 sections (+4 more)" button
    const dock = page.getByTestId('book-vocabulary-dock');
    await expect(dock).toBeVisible();
    await expect(dock.getByTestId('book-chapter-folder')).toHaveCount(4);
    const dockExpandBtn = dock.getByTestId('book-chapters-expand-button');
    await expect(dockExpandBtn).toBeVisible();
    await expect(dockExpandBtn).toContainText('Show all 8 sections (+4 more)');

    // Capture screenshot of collapsed Book Vocabulary Dock & Collections with expand buttons
    await page.screenshot({
      path: '/home/antigravity/.gemini/jetski/brain/v1/default/jetski_remote_agents_3p/a7fcfaec-b0d2-4bc2-b62c-d69cd223389f/scratch/feature3-dock-collapsed-sections.png',
    });

    // Click expand in Book Vocabulary Dock -> all 8 sections appear
    await dockExpandBtn.click();
    await expect(dock.getByTestId('book-chapter-folder')).toHaveCount(8);
    await expect(dockExpandBtn).toContainText('Show fewer sections');

    await page.screenshot({
      path: '/home/antigravity/.gemini/jetski/brain/v1/default/jetski_remote_agents_3p/a7fcfaec-b0d2-4bc2-b62c-d69cd223389f/scratch/feature3-dock-expanded-sections.png',
    });

    // Also test collapsing the entire Chapters / Sections drawer via header toggle
    const drawerToggle = dock.getByTestId('book-chapters-collapse-toggle');
    await drawerToggle.click();
    await expect(dock.getByTestId('book-chapter-folder')).toHaveCount(0);
    await drawerToggle.click();
    await expect(dock.getByTestId('book-chapter-folder')).toHaveCount(8);

    // 2. Verify Collections -> Books -> Chronicles of Antiquity Chapters bar has expandable pills (+2 more sections)
    const collectionChapters = page.getByTestId('collection-book-chapters');
    await expect(collectionChapters).toBeVisible();
    await expect(collectionChapters.getByTestId('collection-chapter-pill')).toHaveCount(6);
    const collectionExpandBtn = collectionChapters.getByTestId('collection-chapters-expand-button');
    await expect(collectionExpandBtn).toContainText('+2 more sections');
    await collectionExpandBtn.click();
    await expect(collectionChapters.getByTestId('collection-chapter-pill')).toHaveCount(8);

    // 3. Verify SessionConfigModal also collapses >6 sections and expands on click
    await dock.getByRole('button', { name: 'Study Chronicles of Antiquity', exact: true }).click();
    const sessionChapterSelector = page.getByTestId('session-chapter-selector');
    await expect(sessionChapterSelector).toBeVisible();
    await expect(sessionChapterSelector.getByTestId('session-chapter-option')).toHaveCount(6);
    const sessionExpandBtn = sessionChapterSelector.getByTestId('session-chapters-expand-button');
    await expect(sessionExpandBtn).toContainText('+2 more sections');
    await sessionExpandBtn.click();
    await expect(sessionChapterSelector.getByTestId('session-chapter-option')).toHaveCount(8);

    await page.screenshot({
      path: '/home/antigravity/.gemini/jetski/brain/v1/default/jetski_remote_agents_3p/a7fcfaec-b0d2-4bc2-b62c-d69cd223389f/scratch/feature3-session-expanded-sections.png',
    });
  });

  test('does not duplicate words already in the deck when adding a new book, updates them with the new book tag, and preserves their existing status', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const now = Date.now() - 60_000;

    // Seed deck with 2 existing words from a previous book ("First Odyssey"):
    // 1. 'ephemeral' -> already Mastered
    // 2. 'labyrinthine' -> currently Learning (due today)
    const initialCards: Flashcard[] = [
      {
        id: 'existing-mastered-ephemeral',
        word: 'ephemeral',
        phonetic: '/ɪˈfɛmərəl/',
        partOfSpeech: 'adjective',
        mainDefinition: 'Lasting for a very short time; fleeting.',
        example: 'An ephemeral moment of serenity in the First Odyssey.',
        tags: ['Book: First Odyssey', 'Book: First Odyssey / Chapter 1'],
        bookChapter: 'Chapter 1',
        status: FlashcardStatus.Mastered,
        lastReviewed: now,
        createdAt: now - 10_000,
        repetition: 5,
        nextReviewDate: now + 86_400_000 * 30,
        complexityLevel: 'intermediate',
        complexityScore: 60,
      },
      {
        id: 'existing-learning-labyrinthine',
        word: 'labyrinthine',
        phonetic: '/ˌlæbəˈrɪnθaɪn/',
        partOfSpeech: 'adjective',
        mainDefinition: 'Irregular and twisting; like a labyrinth.',
        example: 'The labyrinthine passages of the First Odyssey.',
        tags: ['Book: First Odyssey', 'Book: First Odyssey / Chapter 1'],
        bookChapter: 'Chapter 1',
        status: FlashcardStatus.Learning,
        lastReviewed: now - 86_400_000,
        createdAt: now - 9_000,
        repetition: 2,
        nextReviewDate: now - 1_000, // due now
        complexityLevel: 'advanced',
        complexityScore: 78,
      },
    ];

    await page.addInitScript((cardsData) => {
      localStorage.setItem('lumina_cards_v1', JSON.stringify(cardsData));
    }, initialCards);

    // Mock Datamuse and Dictionary APIs so book extraction runs deterministically
    await page.route('https://api.datamuse.com/words*', async (route) => {
      const url = new URL(route.request().url());
      const word = url.searchParams.get('sp') || 'ephemeral';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            word,
            tags: ['f:0.45', 'pron:ɪˈfɛmərəl'],
            defs: [`adj\tLiterary definition for ${word} in Second Odyssey.`],
          },
        ]),
      });
    });

    await page.route('https://api.dictionaryapi.dev/**', async (route) => {
      await route.fulfill({ status: 404, body: 'Not found' });
    });

    await page.goto('/#/flashcards');

    // Verify initial deck has 2 cards total
    await expect(page.getByText('2 cards total')).toBeVisible();

    // Open "Prepare for a Book" and upload a new book ("Second Odyssey") that contains:
    // - 'ephemeral' (already Mastered in deck)
    // - 'labyrinthine' (already Learning in deck)
    // - 'magnanimous' (brand new word not yet in deck)
    await page.getByRole('button', { name: /Prepare for a Book/i }).first().click();
    await page.getByLabel('Search book title').fill('Second Odyssey');

    const secondBookText = [
      'Chapter 1',
      'The ephemeral twilight settled over the labyrinthine fortress while the magnanimous commander watched.',
    ].join('\n');

    const fileInput = page.locator('input[type="file"][aria-label="Upload book file"]');
    await fileInput.setInputFiles({
      name: 'second-odyssey.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(secondBookText, 'utf-8'),
    });

    // In Step 3 Preview, verify that 'ephemeral' and 'labyrinthine' are extracted AND show their existing deck status badges!
    const existingStatusBadges = page.getByTestId('word-existing-status-badge');
    await expect(existingStatusBadges).toHaveCount(2);
    await expect(page.getByText('In Deck • Mastered')).toBeVisible();
    await expect(page.getByText('In Deck • Learning')).toBeVisible();

    // Take screenshot of Preview showing "In Deck • Mastered" and "In Deck • Learning" badges
    await page.screenshot({
      path: '/home/antigravity/.gemini/jetski/brain/v1/default/jetski_remote_agents_3p/a7fcfaec-b0d2-4bc2-b62c-d69cd223389f/scratch/feature4-preview-existing-words-status.png',
    });

    // Ensure only our 3 target words ('ephemeral', 'labyrinthine', 'magnanimous') are selected before importing
    // (deselect any other extracted words like 'fortress' or 'commander' if present)
    const targetWords = new Set(['ephemeral', 'labyrinthine', 'magnanimous']);
    const previewWordCards = page.locator('[data-testid="word-complexity-badge"]').locator('..');
    const count = await previewWordCards.count();
    for (let i = 0; i < count; i++) {
      const wordText = (await previewWordCards.nth(i).locator('span').first().innerText()).trim().toLowerCase();
      if (!targetWords.has(wordText)) {
        await previewWordCards.nth(i).click();
      }
    }

    await page.getByRole('button', { name: /Add 3 Words to Book Dock/i }).click();

    // 1. Verify NO duplicate cards were added: 2 existing + 1 new ('magnanimous') = 3 cards total (NOT 5!)
    await expect(page.getByText('3 cards total')).toBeVisible();

    // 2. Verify Book Vocabulary Dock shows BOTH books ("Second Odyssey" and "First Odyssey"),
    // and "Second Odyssey" immediately reflects 3 complex words • 1 mastered (50% Ready: 1 Mastered + 1 Learning + 1 New)!
    const dock = page.getByTestId('book-vocabulary-dock');
    await expect(dock).toBeVisible();
    const secondOdysseyCard = dock.getByTestId('book-dock-card').filter({ hasText: 'Second Odyssey' });
    await expect(secondOdysseyCard).toBeVisible();
    await expect(secondOdysseyCard).toContainText('3 complex words • 1 mastered');
    await expect(secondOdysseyCard).toContainText('50% Ready');
    await expect(secondOdysseyCard).toContainText('Chapter 1');
    await expect(secondOdysseyCard).toContainText('(1/3)');

    // Also verify "First Odyssey" still has its 2 words and 1 mastered
    const firstOdysseyCard = dock.getByTestId('book-dock-card').filter({ hasText: 'First Odyssey' });
    await expect(firstOdysseyCard).toBeVisible();
    await expect(firstOdysseyCard).toContainText('2 complex words • 1 mastered');

    // Take screenshot of the Book Vocabulary Dock and Deck showing shared words across books with preserved status
    await page.screenshot({
      path: '/home/antigravity/.gemini/jetski/brain/v1/default/jetski_remote_agents_3p/a7fcfaec-b0d2-4bc2-b62c-d69cd223389f/scratch/feature4-dock-shared-book-words.png',
    });

    // 3. Verify clicking "Study Second Odyssey" only has 2 due cards ('magnanimous' [New] and 'labyrinthine' [Learning]),
    // skipping 'ephemeral' because it kept its Mastered status!
    await secondOdysseyCard.getByRole('button', { name: 'Study Second Odyssey', exact: true }).click();
    await expect(page.getByText(/Review all 2 cards that are due today/i)).toBeVisible();
  });
});
