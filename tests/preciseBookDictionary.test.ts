import { test, expect } from 'playwright/test';
import {
  stripWiktionaryHtmlAndExtractTags,
  extractFormOfLemma,
  deriveCandidateLemmas,
  isCircularOrFormOfDefinition,
  mergeWordEntries,
} from '../services/dictionaryService';
import {
  inferContextualPosWeights,
  selectBestMeaningForContext,
} from '../services/bookService';
import type { WordEntry } from '../types';

test.describe('Option 1: Wiktionary / FreeDictionaryAPI Parsing & Lemma Resolution Unit Tests', () => {
  test('strips Wiktionary Parsoid HTML, style tags, entities, and extracts usage/domain tags', () => {
    const rawHtml =
      '<style data-mw-deduplicate="TemplateStyles:r123">.mw-parser-output .ib-brac{font-style:normal}</style>' +
      '<span class="ib-brac">(</span><span class="ib-content"><a href="/wiki/Appendix:Glossary#transitive">transitive</a>' +
      '<span class="ib-comma">,</span>&#32;<a href="/wiki/Appendix:Glossary#archaic">archaic</a>' +
      '<span class="ib-comma">,</span>&#32;<a href="/wiki/nautical">nautical</a></span><span class="ib-brac">)</span> ' +
      'To steer a <a href="/wiki/vessel">vessel</a> toward windward<sup class="reference">[1]</sup>.';

    const parsed = stripWiktionaryHtmlAndExtractTags(rawHtml);
    expect(parsed.text).toBe('To steer a vessel toward windward.');
    expect(parsed.tags).toEqual(expect.arrayContaining(['transitive', 'archaic', 'nautical']));
  });

  test('detects circular form-of glosses and manner-adverb stubs and derives candidate lemmas', () => {
    const formHtml =
      '<span class="form-of-definition use-with-mention">simple past and past participle of ' +
      '<span class="form-of-definition-link"><i class="Latn mention" lang="en"><a href="/wiki/harbor#English">harbor</a></i></span></span>';
    const stripped = stripWiktionaryHtmlAndExtractTags(formHtml);
    expect(isCircularOrFormOfDefinition(stripped.text, 'harbored')).toBe(true);
    expect(extractFormOfLemma(stripped.text, stripped.tags)).toEqual({
      lemma: 'harbor',
      inflectedPos: 'verb',
    });

    const pluralRef = extractFormOfLemma('Plural of vicissitude.');
    expect(pluralRef).toEqual({ lemma: 'vicissitude', inflectedPos: 'noun' });

    const mannerStub = extractFormOfLemma('In an ignominious manner.');
    expect(mannerStub).toEqual({
      lemma: 'ignominious',
      inflectedPos: 'adjective',
      isMannerStub: true,
    });

    expect(deriveCandidateLemmas('vicissitudes').map((c) => c.lemma)).toContain('vicissitude');
    expect(deriveCandidateLemmas('circumambulated').map((c) => c.lemma)).toContain('circumambulate');
    expect(deriveCandidateLemmas('indefatigably').map((c) => c.lemma)).toContain('indefatigable');
    expect(deriveCandidateLemmas('compelled').map((c) => c.lemma)).toContain('compel');
  });

  test('merges tags and extra senses from Wiktionary/FreeDictionaryAPI onto primary entries', () => {
    const primary: WordEntry = {
      word: 'precipitate',
      phonetic: '/prɪˈsɪpɪteɪt/',
      audio: 'https://example.com/precipitate.mp3',
      meanings: [
        {
          partOfSpeech: 'verb',
          definitions: [
            { definition: 'To cause a substance to be deposited in solid form from a solution.' },
          ],
        },
      ],
    };

    const freeDict: WordEntry = {
      word: 'precipitate',
      meanings: [
        {
          partOfSpeech: 'verb',
          definitions: [
            {
              definition: 'Cause a substance to be deposited in solid form from a solution.',
              tags: ['chemistry'],
            },
            {
              definition: 'To cause an event or situation, typically an undesirable one, to happen suddenly or prematurely.',
              synonyms: ['hasten', 'accelerate'],
            },
          ],
        },
        {
          partOfSpeech: 'adjective',
          definitions: [
            {
              definition: 'Done, made, or acting suddenly or without careful consideration; hasty, rash.',
              synonyms: ['hasty', 'impetuous', 'rash'],
            },
          ],
        },
      ],
    };

    const merged = mergeWordEntries([primary, freeDict], 'precipitate');
    expect(merged).not.toBeNull();
    expect(merged!.audio).toBe('https://example.com/precipitate.mp3');
    const verbMeaning = merged!.meanings.find((m) => m.partOfSpeech === 'verb')!;
    expect(verbMeaning.definitions[0].tags).toContain('chemistry');
    expect(verbMeaning.definitions).toHaveLength(2);
    expect(merged!.meanings.find((m) => m.partOfSpeech === 'adjective')).toBeDefined();
  });
});

test.describe('Option 1: Context-Aware Book Sense & Part-of-Speech Ranking Unit Tests', () => {
  test('distinguishes noun vs verb usage of "countenance" from surrounding book syntax', () => {
    const countenanceEntry: WordEntry = {
      word: 'countenance',
      meanings: [
        {
          partOfSpeech: 'noun',
          definitions: [
            { definition: 'Obsolete legal patronage or appearance in court.', tags: ['obsolete', 'law'] },
            {
              definition: 'A person’s face or facial expression.',
              synonyms: ['visage', 'expression'],
            },
          ],
        },
        {
          partOfSpeech: 'verb',
          definitions: [
            {
              definition: 'To admit as acceptable or possible; to tolerate or approve.',
              synonyms: ['tolerate', 'sanction', 'brook'],
            },
          ],
        },
      ],
    };

    const nounChoice = selectBestMeaningForContext(
      countenanceEntry,
      'His countenance expressed the deepest sorrow and remorse as he read the letter.',
      'countenance'
    );
    expect(nounChoice?.partOfSpeech).toBe('noun');
    expect(nounChoice?.definition).toBe('A person’s face or facial expression.');

    const verbChoice = selectBestMeaningForContext(
      countenanceEntry,
      'She would never countenance such reckless cruelty within her household.',
      'countenance'
    );
    expect(verbChoice?.partOfSpeech).toBe('verb');
    expect(verbChoice?.definition).toContain('tolerate or approve');
  });

  test('filters out narrow chemistry jargon unless the book sentence has chemistry context', () => {
    const precipitateEntry: WordEntry = {
      word: 'precipitate',
      meanings: [
        {
          partOfSpeech: 'noun',
          definitions: [
            {
              definition: 'A solid substance separated from a chemical solution.',
              tags: ['chemistry'],
            },
          ],
        },
        {
          partOfSpeech: 'verb',
          definitions: [
            {
              definition: 'To cause a substance to separate in solid form from a chemical solution.',
              tags: ['chemistry'],
            },
            {
              definition: 'To cause an undesirable event to happen suddenly or prematurely.',
            },
          ],
        },
        {
          partOfSpeech: 'adjective',
          definitions: [
            {
              definition: 'Done, made, or acting suddenly or without careful consideration; hasty and rash.',
              synonyms: ['hasty', 'impetuous'],
            },
          ],
        },
      ],
    };

    // Literary narrative context -> adjective "hasty and rash"
    const literaryChoice = selectBestMeaningForContext(
      precipitateEntry,
      'His precipitate departure alarmed the entire household before dawn.',
      'precipitate'
    );
    expect(literaryChoice?.partOfSpeech).toBe('adjective');
    expect(literaryChoice?.definition).toContain('hasty and rash');

    // Laboratory context (e.g. Frankenstein) -> chemistry sense boosted!
    const labChoice = selectBestMeaningForContext(
      precipitateEntry,
      'In the laboratory vessel, the dark chemical precipitate settled beneath the acid solution.',
      'precipitate'
    );
    expect(labChoice?.partOfSpeech).toBe('noun');
    expect(labChoice?.definition).toContain('chemical solution');
  });

  test('selects figurative literary senses for coordinated adjectives ("pedestrian") and emotional verbs ("harbored")', () => {
    const pedestrianEntry: WordEntry = {
      word: 'pedestrian',
      meanings: [
        {
          partOfSpeech: 'noun',
          definitions: [
            { definition: 'A person walking along a road or in a developed area.' },
          ],
        },
        {
          partOfSpeech: 'adjective',
          definitions: [
            { definition: 'Relating to walking or designed for walkers.' },
            {
              definition: 'Lacking inspiration, originality, or excitement; dull and prosaic.',
              synonyms: ['prosaic', 'uninspired', 'mundane'],
            },
          ],
        },
      ],
    };

    const posWeights = inferContextualPosWeights(
      'pedestrian',
      'The critic dismissed the treatise as a pedestrian and uninspired effort.'
    );
    expect(posWeights.adjective).toBeGreaterThan(posWeights.noun);

    const pedChoice = selectBestMeaningForContext(
      pedestrianEntry,
      'The critic dismissed the treatise as a pedestrian and uninspired effort.',
      'pedestrian'
    );
    expect(pedChoice?.partOfSpeech).toBe('adjective');
    expect(pedChoice?.definition).toContain('Lacking inspiration');

    const harborEntry: WordEntry = {
      word: 'harbored',
      meanings: [
        {
          partOfSpeech: 'verb',
          definitions: [
            { definition: 'Simple past and past participle of harbor.', tags: ['form-of'] },
            { definition: 'To provide a sheltered port or anchorage for ships and vessels.', tags: ['nautical'] },
            {
              definition: 'To keep a thought, feeling, or resentment secretly in one’s mind over a long period.',
              synonyms: ['cherish', 'entertain', 'nurture'],
            },
          ],
        },
      ],
    };

    const harborChoice = selectBestMeaningForContext(
      harborEntry,
      'For years he harbored a secret resentment against his former benefactor.',
      'harbored'
    );
    expect(harborChoice?.partOfSpeech).toBe('verb');
    expect(harborChoice?.definition).toContain('secretly in one’s mind');
  });
});

test.describe('Option 1: E2E Book Extraction with Wiktionary REST, FreeDictionaryAPI & >24 Candidate Words', () => {
  test('enriches >24 book words via Wiktionary/FreeDictionaryAPI, resolves inflected lemmas, and ranks contextual senses', async ({ page }) => {
    // Generate 28 rare literary words across a chapter so words #25-#28 test removal of the old 24-word cutoff
    const extraWords = Array.from({ length: 26 }, (_, idx) => {
      const suffix = String.fromCharCode(97 + Math.floor(idx / 26)) + String.fromCharCode(97 + (idx % 26));
      return `circumspect${suffix}`;
    });

    const sentences = [
      'Chapter 1',
      'For many silent winters he harbored a secret resentment within his troubled mind.',
      'The sudden vicissitudes of fortune left the young traveler humble and observant.',
      'He behaved ignominiously when confronted with the solemn testimony of his peers.',
      'His precipitate departure startled the guests gathered beside the hearth.',
      ...extraWords.map(
        (w, idx) =>
          `The chronicle described the ${w} deliberation during the ${idx + 10}th assembly of elders.`
      ),
    ];
    const bookText = sentences.join(' ');

    await page.route('https://gutendex.com/books**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          count: 1,
          results: [
            {
              id: 9991,
              title: 'Chronicles of Precision',
              authors: [{ name: 'Clara Vance' }],
              formats: { 'text/plain; charset=utf-8': 'https://www.gutenberg.org/ebooks/9991.txt.utf-8' },
            },
          ],
        }),
      });
    });

    await page.route('https://openlibrary.org/search.json**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ docs: [] }) });
    });
    await page.route('https://en.wikisource.org/w/api.php**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ query: { search: [] } }) });
    });
    await page.route('https://en.wikipedia.org/w/api.php**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ query: { search: [] } }) });
    });
    await page.route('https://www.googleapis.com/books/v1/volumes**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) });
    });
    await page.route('https://archive.org/advancedsearch.php**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ response: { docs: [] } }) });
    });
    await page.route('https://api.datamuse.com/sug**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
    });
    await page.route('https://en.wikipedia.org/api/rest_v1/page/summary/**', async (route) => {
      await route.fulfill({ status: 404, body: '{}' });
    });

    await page.route('https://www.gutenberg.org/ebooks/9991.txt.utf-8', async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: bookText });
    });

    // Datamuse deliberately returns misleading raw WordNet defs[0] so we verify Wiktionary/FreeDictionaryAPI wins for ALL words (even >24!)
    await page.route('https://api.datamuse.com/words**', async (route) => {
      const url = new URL(route.request().url());
      const sp = (url.searchParams.get('sp') || '').toLowerCase();
      if (
        sp === 'harbored' ||
        sp === 'harbor' ||
        sp === 'vicissitudes' ||
        sp === 'vicissitude' ||
        sp === 'ignominiously' ||
        sp === 'ignominious' ||
        sp === 'precipitate' ||
        sp.startsWith('circumspect')
      ) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              word: sp,
              score: 1000,
              tags: ['f:0.45', 'pron:/test/'],
              defs: [`n\tWRONG_RAW_WORDNET_FALLBACK_FOR_${sp.toUpperCase()}`],
            },
          ]),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([{ word: sp, score: 100, tags: ['f:80.0'] }]),
        });
      }
    });

    // Primary dictionaryapi.dev returns 404 for everything in this test so Wiktionary REST + FreeDictionaryAPI drive 100% of lookups!
    await page.route('https://api.dictionaryapi.dev/api/v2/entries/en/**', async (route) => {
      await route.fulfill({ status: 404, body: 'Not Found' });
    });

    // Mock FreeDictionaryAPI.com v1
    await page.route('https://freedictionaryapi.com/api/v1/entries/en/**', async (route) => {
      const word = decodeURIComponent(route.request().url().split('/').pop() || '').toLowerCase();
      if (word === 'harbored') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            word: 'harbored',
            entries: [
              {
                language: { code: 'en', name: 'English' },
                partOfSpeech: 'verb',
                senses: [{ definition: 'simple past and past participle of harbor', tags: ['form-of'] }],
              },
            ],
          }),
        });
        return;
      }
      if (word === 'harbor') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            word: 'harbor',
            entries: [
              {
                language: { code: 'en', name: 'English' },
                partOfSpeech: 'verb',
                pronunciations: [{ type: 'ipa', text: '/ˈhɑːrbər/' }],
                senses: [
                  { definition: 'To provide a port or haven for ships.', tags: ['nautical'] },
                  {
                    definition: 'To hold or persistently entertain a thought or feeling secretly in the mind.',
                    synonyms: ['cherish', 'nurture'],
                  },
                ],
              },
            ],
          }),
        });
        return;
      }
      if (word === 'precipitate') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            word: 'precipitate',
            entries: [
              {
                language: { code: 'en', name: 'English' },
                partOfSpeech: 'noun',
                senses: [
                  {
                    definition: 'A solid separated from a chemical solution.',
                    tags: ['chemistry'],
                  },
                ],
              },
              {
                language: { code: 'en', name: 'English' },
                partOfSpeech: 'adjective',
                senses: [
                  {
                    definition: 'Acting or done suddenly and without careful consideration; hasty.',
                    synonyms: ['hasty', 'rash'],
                  },
                ],
              },
            ],
          }),
        });
        return;
      }
      await route.fulfill({ status: 404, body: 'Not Found' });
    });

    // Mock Wikimedia Wiktionary REST API
    await page.route('https://en.wiktionary.org/api/rest_v1/page/definition/**', async (route) => {
      const word = decodeURIComponent(route.request().url().split('/').pop() || '').toLowerCase();
      if (word === 'vicissitudes') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            en: [
              {
                partOfSpeech: 'Noun',
                language: 'English',
                definitions: [
                  {
                    definition:
                      '<span class="form-of-definition">plural of <a href="/wiki/vicissitude">vicissitude</a></span>',
                  },
                ],
              },
            ],
          }),
        });
        return;
      }
      if (word === 'vicissitude') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            en: [
              {
                partOfSpeech: 'Noun',
                language: 'English',
                definitions: [
                  {
                    definition:
                      'A change of circumstances or fortune, typically one that is unwelcome or unpleasant.',
                  },
                ],
              },
            ],
          }),
        });
        return;
      }
      if (word === 'ignominiously') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            en: [
              {
                partOfSpeech: 'Adverb',
                language: 'English',
                definitions: [{ definition: 'In an ignominious manner.' }],
              },
            ],
          }),
        });
        return;
      }
      if (word === 'ignominious') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            en: [
              {
                partOfSpeech: 'Adjective',
                language: 'English',
                definitions: [
                  { definition: 'Deserving or causing public disgrace or shame.' },
                ],
              },
            ],
          }),
        });
        return;
      }
      if (word.startsWith('circumspect')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            en: [
              {
                partOfSpeech: 'Adjective',
                language: 'English',
                definitions: [
                  {
                    definition: `(<a href="/wiki/formal">formal</a>) Wary and unwilling to take risks (${word}).`,
                  },
                ],
              },
            ],
          }),
        });
        return;
      }
      await route.fulfill({ status: 404, body: 'Not Found' });
    });

    await page.addInitScript(() => {
      localStorage.setItem(
        'lumina_cards_v1',
        JSON.stringify([
          {
            id: 'seed-1',
            word: 'Ephemeral',
            partOfSpeech: 'adjective',
            mainDefinition: 'Lasting for a very short time.',
            status: 'New',
            lastReviewed: 0,
            createdAt: Date.now() - 10000,
          },
        ])
      );
    });

    await page.goto('/#/flashcards');
    await page.getByRole('button', { name: /Prepare for a Book/i }).click();

    await page.getByLabel('Search book title').fill('Chronicles of Precision');
    await page.getByRole('button', { name: /Find Book/i }).click();

    await expect(page.getByText('Clara Vance')).toBeVisible();
    await page.getByRole('button', { name: /Extract Words/i }).click();

    // Wait for extraction preview list to load all 30 complex words (4 literary + 26 extra > 24!)
    await expect(
      page.getByText('To hold or persistently entertain a thought or feeling secretly in the mind.')
    ).toBeVisible({ timeout: 15000 });

    await expect(
      page.getByText('A change of circumstances or fortune, typically one that is unwelcome or unpleasant.')
    ).toBeVisible();

    await expect(
      page.getByText('In an ignominious manner (deserving or causing public disgrace or shame).')
    ).toBeVisible();

    await expect(
      page.getByText('Acting or done suddenly and without careful consideration; hasty.')
    ).toBeVisible();

    // Ensure ZERO words fell back to raw Datamuse WordNet defs[0], even past index 24!
    await expect(page.getByText(/WRONG_RAW_WORDNET_FALLBACK/)).toHaveCount(0);
    await expect(page.getByText(/Wary and unwilling to take risks \(circumspectaz\)/)).toBeVisible();
  });
});
