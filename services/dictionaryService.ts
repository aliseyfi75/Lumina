import type { WordEntry, Meaning, Definition } from "../types";

const PRIMARY_API_URL = "https://api.dictionaryapi.dev/api/v2/entries/en";
const FREE_DICT_API_URL = "https://freedictionaryapi.com/api/v1/entries/en";
const WIKTIONARY_REST_API_URL = "https://en.wiktionary.org/api/rest_v1/page/definition";
const DATAMUSE_API_URL = "https://api.datamuse.com/words";

const PRIMARY_TIMEOUT_MS = 2000;
const WIKTIONARY_TIMEOUT_MS = 2000;
const FREE_DICT_TIMEOUT_MS = 2000;
const DATAMUSE_TIMEOUT_MS = 2500;
const IMAGE_TIMEOUT_MS = 2000;
const ENRICH_MERGE_WINDOW_MS = 220;

interface DatamuseEntry {
  word: string;
  score: number;
  defs?: string[];
  tags?: string[];
}

// In-memory caches and in-flight request deduplication for instant lookups
const wordCache = new Map<string, WordEntry>();
const inFlightLookups = new Map<string, Promise<WordEntry | null>>();
const imageCache = new Map<string, string | null>();
const inFlightImages = new Map<string, Promise<string | null>>();

export const clearDictionaryCache = () => {
  wordCache.clear();
  inFlightLookups.clear();
  imageCache.clear();
  inFlightImages.clear();
};

const fetchWithTimeout = async (url: string, timeoutMs: number): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
};

export const normalizePartOfSpeech = (rawPos: string | undefined): string => {
  const cleaned = (rawPos || "noun").trim().toLowerCase();
  if (!cleaned) return "noun";
  if (cleaned === "n" || cleaned === "substantive" || cleaned === "proper noun") return "noun";
  if (
    cleaned === "v" ||
    cleaned === "verb" ||
    cleaned === "transitive verb" ||
    cleaned === "intransitive verb" ||
    cleaned === "auxiliary verb"
  ) {
    return "verb";
  }
  if (cleaned === "adj" || cleaned === "adjective" || cleaned === "participial adjective") {
    return "adjective";
  }
  if (cleaned === "participle") return "participle";
  if (cleaned === "adv" || cleaned === "adverb") return "adverb";
  return cleaned;
};

const HTML_ENTITY_MAP: Record<string, string> = {
  "&nbsp;": " ",
  "&#32;": " ",
  "&amp;": "&",
  "&quot;": '"',
  "&#34;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&lt;": "<",
  "&gt;": ">",
  "&ndash;": "–",
  "&mdash;": "—",
  "&hellip;": "…",
  "&lsquo;": "‘",
  "&rsquo;": "’",
  "&ldquo;": "“",
  "&rdquo;": "”",
};

export const decodeHtmlEntities = (input: string): string => {
  return input
    .replace(/&(?:nbsp|#32|amp|quot|#34|#39|apos|lt|gt|ndash|mdash|hellip|lsquo|rsquo|ldquo|rdquo);/gi, (m) => {
      return HTML_ENTITY_MAP[m.toLowerCase()] ?? m;
    })
    .replace(/&#(\d+);/g, (_m, dec) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    });
};

const KNOWN_USAGE_TAG_KEYWORDS = new Set([
  "transitive",
  "intransitive",
  "ambitransitive",
  "ditransitive",
  "reflexive",
  "ergative",
  "countable",
  "uncountable",
  "plural",
  "in the plural",
  "singular",
  "attributive",
  "predicative",
  "stative",
  "archaic",
  "obsolete",
  "dated",
  "rare",
  "historical",
  "literary",
  "poetic",
  "formal",
  "informal",
  "colloquial",
  "slang",
  "vulgar",
  "derogatory",
  "pejorative",
  "offensive",
  "euphemistic",
  "humorous",
  "figurative",
  "figuratively",
  "idiomatic",
  "dialectal",
  "regional",
  "nonstandard",
  "proscribed",
  "uk",
  "us",
  "britain",
  "british",
  "american",
  "chiefly",
  "usually",
  "often",
  "sometimes",
  "now",
  "formerly",
  "botany",
  "zoology",
  "entomology",
  "ornithology",
  "ichthyology",
  "mycology",
  "taxonomy",
  "biology",
  "chemistry",
  "organic chemistry",
  "inorganic chemistry",
  "biochemistry",
  "physics",
  "astronomy",
  "geology",
  "mineralogy",
  "mathematics",
  "geometry",
  "algebra",
  "calculus",
  "logic",
  "statistics",
  "medicine",
  "pathology",
  "anatomy",
  "surgery",
  "pharmacology",
  "psychiatry",
  "psychology",
  "law",
  "legal",
  "heraldry",
  "nautical",
  "military",
  "music",
  "architecture",
  "theology",
  "ecclesiastical",
  "christianity",
  "philosophy",
  "linguistics",
  "grammar",
  "phonetics",
  "prosody",
  "computing",
  "programming",
  "finance",
  "economics",
]);

const looksLikeUsageLabelGroup = (groupContent: string): string[] | null => {
  const trimmed = groupContent.trim();
  if (!trimmed || trimmed.length > 65) return null;
  const rawParts = trimmed
    .split(/[,;]|(?:\s+or\s+)|(?:\s+and\s+)/i)
    .map((p) =>
      p
        .trim()
        .toLowerCase()
        .replace(/^(?:chiefly|usually|often|sometimes|mostly|especially|now|formerly|also)\s+/i, "")
        .trim()
    )
    .filter(Boolean);

  if (rawParts.length === 0) return null;
  const recognized = rawParts.filter((p) => KNOWN_USAGE_TAG_KEYWORDS.has(p));
  if (recognized.length === 0) return null;
  // Require at least half of the comma-separated items to be recognized usage/domain tags
  if (recognized.length * 2 < rawParts.length) return null;
  return Array.from(new Set(rawParts));
};

export const stripWiktionaryHtmlAndExtractTags = (
  rawHtml: string
): { text: string; tags: string[] } => {
  if (!rawHtml) return { text: "", tags: [] };

  const formOfClass = /form-of-definition/i.test(rawHtml);

  let cleaned = rawHtml
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    // Remove MediaWiki citation / reference superscripts
    .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/li>/gi, "; ")
    .replace(/<[^>]+>/g, "");

  cleaned = decodeHtmlEntities(cleaned)
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?)\]])/g, "$1")
    .replace(/([(\[])\s+/g, "$1")
    .trim();

  const extractedTags: string[] = formOfClass ? ["form-of"] : [];

  // Extract one or more leading parenthetical usage/domain label groups: e.g. "(transitive, archaic) To..."
  let strippedLeadingLabel = false;
  while (cleaned.startsWith("(")) {
    const closeIdx = cleaned.indexOf(")");
    if (closeIdx <= 1 || closeIdx > 70) break;
    const inside = cleaned.slice(1, closeIdx);
    const parsedTags = looksLikeUsageLabelGroup(inside);
    if (!parsedTags) break;
    extractedTags.push(...parsedTags);
    const remainder = cleaned.slice(closeIdx + 1).replace(/^[\s:;,-]+/, "").trim();
    if (!remainder) break;
    cleaned = remainder;
    strippedLeadingLabel = true;
  }

  if (strippedLeadingLabel && /^[a-z]/.test(cleaned) && !isCircularOrFormOfDefinition(cleaned)) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  return {
    text: cleaned,
    tags: Array.from(new Set(extractedTags)),
  };
};

const FORM_OF_REGEX =
  /^(?:\([^)]{1,45}\)\s*)?(?:(?:simple\s+)?past(?:\s+tense)?(?:\s+and\s+past\s+participle)?|past\s+participle|present\s+participle(?:\s+and\s+gerund)?|gerund|plural(?:\s+form)?|third-person\s+singular(?:\s+simple\s+present(?:\s+indicative)?)?(?:\s+form)?|inflection|alternative\s+(?:spelling|form|case|typography)|archaic\s+(?:spelling|form)|obsolete\s+(?:spelling|form)|dated\s+(?:spelling|form)|eye\s+dialect\s+spelling|nonstandard\s+(?:spelling|form)|comparative(?:\s+form)?|superlative(?:\s+form)?|(?:british|american|uk|us|commonwealth|canadian|australian|standard)\s+(?:standard\s+)?(?:spelling|form))\s+of\s+["'“”‘’]?([a-zA-Z][a-zA-Z'-]{2,})["'“”‘’]?(?:[\s.:;,(]|$)/i;

const MANNER_ADVERB_STUB_REGEX =
  /^in\s+an?\s+([a-zA-Z][a-zA-Z-]{3,})\s+(?:manner|way|fashion|style|wise)\.?$/i;

export const extractFormOfLemma = (
  definition: string,
  tags?: string[]
): { lemma: string; inflectedPos?: string; isMannerStub?: boolean } | null => {
  const trimmed = definition.trim();
  if (!trimmed) return null;

  const match = trimmed.match(FORM_OF_REGEX);
  if (match && match[1]) {
    const lemma = match[1].trim();
    // Ensure there isn't already a rich substantive definition appended after a colon/semicolon
    const afterLemmaIdx = trimmed.toLowerCase().indexOf(lemma.toLowerCase()) + lemma.length;
    const trailingGloss = trimmed.slice(afterLemmaIdx).replace(/^[\s.:;,()]+/, "").trim();
    if (trailingGloss.length >= 24 && !FORM_OF_REGEX.test(trailingGloss)) {
      return null;
    }

    const lowerDef = trimmed.toLowerCase();
    let inflectedPos: string | undefined;
    if (lowerDef.includes("plural")) inflectedPos = "noun";
    else if (
      lowerDef.includes("past") ||
      lowerDef.includes("participle") ||
      lowerDef.includes("third-person singular")
    ) {
      inflectedPos = "verb";
    } else if (lowerDef.includes("comparative") || lowerDef.includes("superlative")) {
      inflectedPos = "adjective";
    }
    return { lemma, inflectedPos };
  }

  const mannerMatch = trimmed.match(MANNER_ADVERB_STUB_REGEX);
  if (mannerMatch && mannerMatch[1]) {
    return { lemma: mannerMatch[1].toLowerCase(), inflectedPos: "adjective", isMannerStub: true };
  }

  if (tags?.includes("form-of")) {
    const fallbackOf = trimmed.match(/\bof\s+([a-zA-Z][a-zA-Z'-]{2,})\.?$/i);
    if (fallbackOf?.[1]) {
      return { lemma: fallbackOf[1] };
    }
  }

  return null;
};

export const isCircularOrFormOfDefinition = (definition: string, queriedWord?: string): boolean => {
  const trimmed = definition.trim();
  if (!trimmed) return true;
  const extracted = extractFormOfLemma(trimmed);
  if (extracted && !extracted.isMannerStub) return true;
  if (queriedWord) {
    const lowerWord = queriedWord.trim().toLowerCase();
    const bareSelf = trimmed.toLowerCase().replace(/[^a-z\s]/g, "").trim();
    if (bareSelf === lowerWord) return true;
  }
  return false;
};

export const deriveCandidateLemmas = (
  word: string
): Array<{ lemma: string; expectedPos?: string }> => {
  const lower = word.trim().toLowerCase();
  if (lower.length < 5) return [];

  const results: Array<{ lemma: string; expectedPos?: string }> = [];
  const pushUnique = (lemma: string, expectedPos?: string) => {
    const clean = lemma.trim().toLowerCase();
    if (clean.length >= 4 && clean !== lower && !results.some((r) => r.lemma === clean)) {
      results.push({ lemma: clean, expectedPos });
    }
  };

  if (lower.endsWith("ies") && lower.length >= 6) {
    pushUnique(lower.slice(0, -3) + "y", "noun");
  }
  if (lower.endsWith("ied") && lower.length >= 6) {
    pushUnique(lower.slice(0, -3) + "y", "verb");
  }
  if (lower.endsWith("bly") && lower.length >= 6) {
    pushUnique(lower.slice(0, -3) + "ble", "adjective");
  }
  if (lower.endsWith("ily") && lower.length >= 6) {
    pushUnique(lower.slice(0, -3) + "y", "adjective");
  }
  if (lower.endsWith("ally") && lower.length >= 7) {
    pushUnique(lower.slice(0, -4) + "al", "adjective");
    pushUnique(lower.slice(0, -4), "adjective"); // e.g. tragically -> tragic
  }
  if (lower.endsWith("ly") && lower.length >= 6) {
    pushUnique(lower.slice(0, -2), "adjective");
  }
  if (lower.endsWith("ing") && lower.length >= 7) {
    const stem = lower.slice(0, -3);
    pushUnique(stem + "e", "verb");
    pushUnique(stem, "verb");
    if (/([^aeiou])\1$/.test(stem)) {
      pushUnique(stem.slice(0, -1), "verb");
    }
  }
  if (lower.endsWith("ed") && lower.length >= 6) {
    pushUnique(lower.slice(0, -1), "verb"); // e.g. circumambulated -> circumambulate
    const stem = lower.slice(0, -2);
    pushUnique(stem, "verb"); // e.g. harbored -> harbor
    if (/([^aeiou])\1$/.test(stem)) {
      pushUnique(stem.slice(0, -1), "verb"); // e.g. compelled -> compel
    }
  }
  if (lower.endsWith("es") && lower.length >= 6) {
    pushUnique(lower.slice(0, -1), "noun"); // e.g. precipices -> precipice
    pushUnique(lower.slice(0, -2), "noun"); // e.g. marshes -> marsh
  } else if (
    lower.endsWith("s") &&
    !lower.endsWith("ss") &&
    !lower.endsWith("ous") &&
    !lower.endsWith("us") &&
    !lower.endsWith("is") &&
    lower.length >= 6
  ) {
    pushUnique(lower.slice(0, -1), "noun"); // e.g. vicissitudes -> vicissitude
  }
  if (lower.endsWith("iest") && lower.length >= 7) {
    pushUnique(lower.slice(0, -4) + "y", "adjective");
  } else if (lower.endsWith("est") && lower.length >= 7) {
    pushUnique(lower.slice(0, -3), "adjective");
    pushUnique(lower.slice(0, -2), "adjective");
  }
  if (lower.endsWith("ier") && lower.length >= 6) {
    pushUnique(lower.slice(0, -3) + "y", "adjective");
  }

  return results;
};

const lookupPrimary = async (word: string): Promise<WordEntry | null> => {
  try {
    const response = await fetchWithTimeout(
      `${PRIMARY_API_URL}/${encodeURIComponent(word)}`,
      PRIMARY_TIMEOUT_MS
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    if (!Array.isArray(data) || data.length === 0) return null;

    const entry = data[0];
    // Combine meanings across multiple etymology entries when dictionaryapi.dev returns >1 entry
    const rawMeanings = data.flatMap((item: any) =>
      Array.isArray(item?.meanings) ? item.meanings : []
    );
    if (rawMeanings.length === 0) return null;

    const wordEntry: WordEntry = {
      word: entry.word,
      phonetic:
        entry.phonetic ||
        data.flatMap((item: any) => item?.phonetics || []).find((p: any) => p?.text)?.text,
      audio: data.flatMap((item: any) => item?.phonetics || []).find((p: any) => p?.audio)?.audio,
      origin: entry.origin || data.find((item: any) => item?.origin)?.origin || undefined,
      meanings: rawMeanings.map((m: any) => {
        const mergedSyns = Array.from(
          new Set<string>(
            [
              ...(Array.isArray(m.synonyms) ? m.synonyms : []),
              ...(Array.isArray(m.definitions)
                ? m.definitions.flatMap((d: any) => (Array.isArray(d.synonyms) ? d.synonyms : []))
                : []),
            ]
              .map((s: string) => String(s).trim())
              .filter(Boolean)
          )
        ).slice(0, 10);

        const mergedAnts = Array.from(
          new Set<string>(
            [
              ...(Array.isArray(m.antonyms) ? m.antonyms : []),
              ...(Array.isArray(m.definitions)
                ? m.definitions.flatMap((d: any) => (Array.isArray(d.antonyms) ? d.antonyms : []))
                : []),
            ]
              .map((s: string) => String(s).trim())
              .filter(Boolean)
          )
        ).slice(0, 10);

        return {
          partOfSpeech: normalizePartOfSpeech(m.partOfSpeech),
          synonyms: mergedSyns.length > 0 ? mergedSyns : undefined,
          antonyms: mergedAnts.length > 0 ? mergedAnts : undefined,
          definitions: (Array.isArray(m.definitions) ? m.definitions : [])
            .filter((d: any) => typeof d?.definition === "string" && d.definition.trim())
            .map((d: any) => {
              // Extract any leading parenthetical labels as tags without mutating primary text
              const tags: string[] = [];
              const trimmedDef = String(d.definition).trim();
              if (trimmedDef.startsWith("(")) {
                const closeIdx = trimmedDef.indexOf(")");
                if (closeIdx > 1 && closeIdx <= 65) {
                  const parsed = looksLikeUsageLabelGroup(trimmedDef.slice(1, closeIdx));
                  if (parsed) tags.push(...parsed);
                }
              }
              return {
                definition: d.definition,
                example: d.example,
                synonyms:
                  Array.isArray(d.synonyms) && d.synonyms.length > 0
                    ? d.synonyms.slice(0, 6)
                    : undefined,
                antonyms:
                  Array.isArray(d.antonyms) && d.antonyms.length > 0
                    ? d.antonyms.slice(0, 6)
                    : undefined,
                tags: tags.length > 0 ? tags : undefined,
              };
            }),
        };
      }),
    };

    return wordEntry.meanings.some((m) => m.definitions.length > 0) ? wordEntry : null;
  } catch {
    return null;
  }
};

const lookupFreeDictionaryApi = async (word: string): Promise<WordEntry | null> => {
  try {
    const response = await fetchWithTimeout(
      `${FREE_DICT_API_URL}/${encodeURIComponent(word.toLowerCase())}`,
      FREE_DICT_TIMEOUT_MS
    );

    if (!response.ok) return null;

    const data = await response.json();
    if (!data || !Array.isArray(data.entries) || data.entries.length === 0) return null;

    const englishEntries = data.entries.filter((e: any) => {
      const code = e?.language?.code?.toLowerCase();
      const name = e?.language?.name?.toLowerCase();
      return !code || code === "en" || code === "eng" || name === "english";
    });

    if (englishEntries.length === 0) return null;

    let phonetic: string | undefined;
    for (const entry of englishEntries) {
      if (Array.isArray(entry.pronunciations)) {
        const ipa = entry.pronunciations.find(
          (p: any) =>
            typeof p?.text === "string" &&
            p.text.trim() &&
            (!p.type || String(p.type).toLowerCase() === "ipa")
        );
        if (ipa?.text) {
          phonetic = ipa.text.trim();
          break;
        }
      }
    }

    const meanings: Meaning[] = [];

    for (const entry of englishEntries) {
      const partOfSpeech = normalizePartOfSpeech(entry.partOfSpeech);
      const rawSenses = Array.isArray(entry.senses) ? entry.senses : [];
      const definitions: Definition[] = [];

      const collectSense = (sense: any, inheritedTags: string[] = []) => {
        if (!sense) return;
        const senseTags = Array.from(
          new Set<string>([
            ...inheritedTags,
            ...(Array.isArray(sense.tags)
              ? sense.tags.map((t: any) => String(t).trim().toLowerCase()).filter(Boolean)
              : []),
          ])
        );

        if (typeof sense.definition === "string" && sense.definition.trim()) {
          const parsed = stripWiktionaryHtmlAndExtractTags(sense.definition);
          const allTags = Array.from(new Set([...senseTags, ...parsed.tags]));
          const example =
            (Array.isArray(sense.examples) &&
              typeof sense.examples[0] === "string" &&
              sense.examples[0].trim()) ||
            (Array.isArray(sense.quotes) &&
              typeof sense.quotes[0]?.text === "string" &&
              sense.quotes[0].text.trim()) ||
            undefined;

          const syns = Array.isArray(sense.synonyms)
            ? sense.synonyms.map((s: any) => String(s).trim()).filter(Boolean).slice(0, 6)
            : [];
          const ants = Array.isArray(sense.antonyms)
            ? sense.antonyms.map((s: any) => String(s).trim()).filter(Boolean).slice(0, 6)
            : [];

          if (parsed.text) {
            definitions.push({
              definition: parsed.text,
              example,
              synonyms: syns.length > 0 ? syns : undefined,
              antonyms: ants.length > 0 ? ants : undefined,
              tags: allTags.length > 0 ? allTags : undefined,
            });
          }
        }

        if (Array.isArray(sense.subsenses)) {
          for (const sub of sense.subsenses) {
            collectSense(sub, senseTags);
          }
        }
      };

      for (const sense of rawSenses) {
        collectSense(sense);
      }

      if (definitions.length === 0) continue;

      const entrySyns = Array.from(
        new Set<string>([
          ...(Array.isArray(entry.synonyms) ? entry.synonyms : []),
          ...definitions.flatMap((d) => d.synonyms || []),
        ].map((s: any) => String(s).trim()).filter(Boolean))
      ).slice(0, 10);

      const entryAnts = Array.from(
        new Set<string>([
          ...(Array.isArray(entry.antonyms) ? entry.antonyms : []),
          ...definitions.flatMap((d) => d.antonyms || []),
        ].map((s: any) => String(s).trim()).filter(Boolean))
      ).slice(0, 10);

      meanings.push({
        partOfSpeech,
        definitions,
        synonyms: entrySyns.length > 0 ? entrySyns : undefined,
        antonyms: entryAnts.length > 0 ? entryAnts : undefined,
      });
    }

    if (meanings.length === 0) return null;

    return {
      word: typeof data.word === "string" && data.word.trim() ? data.word : word.toLowerCase(),
      phonetic,
      meanings,
    };
  } catch {
    return null;
  }
};

const lookupWiktionaryRest = async (word: string): Promise<WordEntry | null> => {
  try {
    const queryWord = word.toLowerCase();
    const response = await fetchWithTimeout(
      `${WIKTIONARY_REST_API_URL}/${encodeURIComponent(queryWord)}`,
      WIKTIONARY_TIMEOUT_MS
    );

    if (!response.ok) return null;

    const data = await response.json();
    const englishSections = Array.isArray(data?.en)
      ? data.en.filter(
          (sec: any) => !sec?.language || String(sec.language).toLowerCase() === "english"
        )
      : [];

    if (englishSections.length === 0) return null;

    const meanings: Meaning[] = [];

    for (const sec of englishSections) {
      const partOfSpeech = normalizePartOfSpeech(sec.partOfSpeech);
      const rawDefs = Array.isArray(sec.definitions) ? sec.definitions : [];
      const definitions: Definition[] = [];

      for (const rawDef of rawDefs) {
        if (typeof rawDef?.definition !== "string" || !rawDef.definition.trim()) continue;
        const { text, tags } = stripWiktionaryHtmlAndExtractTags(rawDef.definition);
        if (!text) continue;

        let example: string | undefined;
        if (Array.isArray(rawDef.parsedExamples) && rawDef.parsedExamples.length > 0) {
          const rawEx = rawDef.parsedExamples.find((ex: any) => typeof ex?.example === "string");
          if (rawEx?.example) {
            const parsedEx = stripWiktionaryHtmlAndExtractTags(rawEx.example);
            if (parsedEx.text) example = parsedEx.text;
          }
        } else if (Array.isArray(rawDef.examples) && rawDef.examples.length > 0) {
          const rawEx = rawDef.examples.find((ex: any) => typeof ex === "string");
          if (rawEx) {
            const parsedEx = stripWiktionaryHtmlAndExtractTags(rawEx);
            if (parsedEx.text) example = parsedEx.text;
          }
        }

        definitions.push({
          definition: text,
          example,
          tags: tags.length > 0 ? tags : undefined,
        });
      }

      if (definitions.length > 0) {
        meanings.push({
          partOfSpeech,
          definitions,
        });
      }
    }

    if (meanings.length === 0) return null;

    return {
      word: queryWord,
      meanings,
    };
  } catch {
    return null;
  }
};

const lookupDatamuse = async (word: string): Promise<WordEntry | null> => {
  try {
    // md=d (definitions), md=r (pronunciation), ipa=1 (IPA pronunciation)
    const response = await fetchWithTimeout(
      `${DATAMUSE_API_URL}?sp=${encodeURIComponent(word)}&md=dr&ipa=1&max=1`,
      DATAMUSE_TIMEOUT_MS
    );

    if (!response.ok) return null;

    const data: DatamuseEntry[] = await response.json();

    if (!Array.isArray(data) || data.length === 0 || !data[0].defs) return null;

    const entry = data[0];

    // Only accept exact case-insensitive match so typos still trigger "Did you mean...?"
    if (entry.word.toLowerCase() !== word.toLowerCase()) return null;

    // Extract phonetic from tags (e.g., "pron:/ˈæpəl/")
    let phonetic: string | undefined;
    if (entry.tags) {
      const pronTag = entry.tags.find((t) => t.startsWith("pron:"));
      if (pronTag) {
        phonetic = pronTag.replace("pron:", "").trim();
      }
    }

    // Group definitions by part of speech
    const meaningsMap = new Map<string, Definition[]>();

    entry.defs.forEach((defStr) => {
      // Format: "n\tDefinition text"
      const tabIndex = defStr.indexOf("\t");
      if (tabIndex === -1) return;

      const posCode = defStr.substring(0, tabIndex);
      const definition = defStr.substring(tabIndex + 1).trim();
      if (!definition) return;

      const partOfSpeech = normalizePartOfSpeech(posCode);

      if (!meaningsMap.has(partOfSpeech)) {
        meaningsMap.set(partOfSpeech, []);
      }

      meaningsMap.get(partOfSpeech)?.push({ definition });
    });

    const meanings: Meaning[] = Array.from(meaningsMap.entries()).map(
      ([partOfSpeech, definitions]) => ({
        partOfSpeech,
        definitions,
      })
    );

    if (meanings.length === 0) return null;

    return {
      word: entry.word,
      phonetic,
      meanings,
    };
  } catch {
    return null;
  }
};

const normalizeDefFingerprint = (text: string): string => {
  return text
    .toLowerCase()
    .replace(/^\([^)]{1,50}\)\s*/, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(?:a|an|the|to|be|of|in|on|for|with|by|or|and|that|which|is|are)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const areDefinitionsEquivalent = (defA: string, defB: string): boolean => {
  const fpA = normalizeDefFingerprint(defA);
  const fpB = normalizeDefFingerprint(defB);
  if (!fpA || !fpB) return false;
  if (fpA === fpB) return true;
  if (fpA.length >= 16 && fpB.length >= 16 && (fpA.includes(fpB) || fpB.includes(fpA))) {
    return true;
  }
  const tokensA = fpA.split(" ").filter((t) => t.length >= 3);
  const tokensB = fpB.split(" ").filter((t) => t.length >= 3);
  if (tokensA.length < 2 || tokensB.length < 2) return false;
  const setB = new Set(tokensB);
  const shared = tokensA.filter((t) => setB.has(t)).length;
  const minLen = Math.min(tokensA.length, tokensB.length);
  return shared / minLen >= 0.8;
};

export const mergeWordEntries = (
  sources: Array<WordEntry | null | undefined>,
  fallbackWord: string
): WordEntry | null => {
  const valid = sources.filter((s): s is WordEntry => Boolean(s && s.meanings?.length));
  if (valid.length === 0) return null;

  const base = valid[0];
  const phonetic = valid.find((s) => s.phonetic)?.phonetic;
  const audio = valid.find((s) => s.audio)?.audio;
  const origin = valid.find((s) => s.origin)?.origin;
  const image = valid.find((s) => s.image)?.image;

  const meaningsByPos = new Map<string, Meaning>();

  for (const source of valid) {
    for (const m of source.meanings) {
      const pos = normalizePartOfSpeech(m.partOfSpeech);
      const existing = meaningsByPos.get(pos);

      if (!existing) {
        meaningsByPos.set(pos, {
          partOfSpeech: pos,
          definitions: m.definitions.map((d) => ({
            ...d,
            synonyms: d.synonyms ? [...d.synonyms] : undefined,
            antonyms: d.antonyms ? [...d.antonyms] : undefined,
            tags: d.tags ? [...d.tags] : undefined,
          })),
          synonyms: m.synonyms ? [...m.synonyms] : undefined,
          antonyms: m.antonyms ? [...m.antonyms] : undefined,
        });
        continue;
      }

      // Merge synonyms and antonyms at Meaning level
      const combinedSyns = Array.from(
        new Set([...(existing.synonyms || []), ...(m.synonyms || [])])
      ).slice(0, 10);
      const combinedAnts = Array.from(
        new Set([...(existing.antonyms || []), ...(m.antonyms || [])])
      ).slice(0, 10);
      existing.synonyms = combinedSyns.length > 0 ? combinedSyns : undefined;
      existing.antonyms = combinedAnts.length > 0 ? combinedAnts : undefined;

      for (const incomingDef of m.definitions) {
        const match = existing.definitions.find((ed) =>
          areDefinitionsEquivalent(ed.definition, incomingDef.definition)
        );
        if (match) {
          if (!match.example && incomingDef.example) {
            match.example = incomingDef.example;
          }
          if (incomingDef.tags?.length) {
            match.tags = Array.from(new Set([...(match.tags || []), ...incomingDef.tags]));
          }
          if (incomingDef.synonyms?.length) {
            match.synonyms = Array.from(
              new Set([...(match.synonyms || []), ...incomingDef.synonyms])
            ).slice(0, 6);
          }
          if (incomingDef.antonyms?.length) {
            match.antonyms = Array.from(
              new Set([...(match.antonyms || []), ...incomingDef.antonyms])
            ).slice(0, 6);
          }
        } else if (existing.definitions.length < 12) {
          existing.definitions.push({
            ...incomingDef,
            synonyms: incomingDef.synonyms ? [...incomingDef.synonyms] : undefined,
            antonyms: incomingDef.antonyms ? [...incomingDef.antonyms] : undefined,
            tags: incomingDef.tags ? [...incomingDef.tags] : undefined,
          });
        }
      }
    }
  }

  return {
    word: base.word || fallbackWord,
    phonetic,
    audio,
    origin,
    image,
    meanings: Array.from(meaningsByPos.values()),
  };
};

const hasSubstantiveDefinition = (entry: WordEntry | null | undefined, word: string): boolean => {
  if (!entry || !entry.meanings?.length) return false;
  return entry.meanings.some((m) =>
    m.definitions.some((d) => !isCircularOrFormOfDefinition(d.definition, word))
  );
};

export const fetchImageForWord = async (word: string): Promise<string | null> => {
  const cleanWord = word.trim();
  if (!cleanWord) return null;
  const cacheKey = cleanWord.toLowerCase();

  if (imageCache.has(cacheKey)) {
    return imageCache.get(cacheKey) ?? null;
  }

  const existing = inFlightImages.get(cacheKey);
  if (existing) return existing;

  const promise = (async (): Promise<string | null> => {
    try {
      const wikiResponse = await fetchWithTimeout(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(cleanWord)}`,
        IMAGE_TIMEOUT_MS
      );
      if (wikiResponse.ok) {
        const wikiData = await wikiResponse.json();
        const img = wikiData.thumbnail?.source || wikiData.originalimage?.source || null;
        imageCache.set(cacheKey, img);
        const cachedWord = wordCache.get(cacheKey);
        if (cachedWord && img) {
          cachedWord.image = img;
        }
        return img;
      }
    } catch {
      // Ignore image fetch timeouts/errors so they never block word lookup
    }
    imageCache.set(cacheKey, null);
    return null;
  })();

  inFlightImages.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    inFlightImages.delete(cacheKey);
  }
};

const lookupWordCore = async (
  cleanWord: string,
  allowLemmaResolution: boolean
): Promise<WordEntry | null> => {
  const primaryPromise = lookupPrimary(cleanWord);
  const freeDictPromise = lookupFreeDictionaryApi(cleanWord);
  const wiktionaryPromise = lookupWiktionaryRest(cleanWord);
  const datamusePromise = lookupDatamuse(cleanWord);

  const primary = await primaryPromise;

  let freeDict: WordEntry | null = null;
  let wiktionary: WordEntry | null = null;

  if (hasSubstantiveDefinition(primary, cleanWord)) {
    // Primary resolved cleanly; give Wiktionary & FreeDictionaryAPI a fast merge window
    // so mocked/offline environments never block while real sessions get enriched tags & senses.
    const settled = await Promise.race([
      Promise.all([freeDictPromise, wiktionaryPromise]),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), ENRICH_MERGE_WINDOW_MS)),
    ]);
    if (settled) {
      [freeDict, wiktionary] = settled;
    }
  } else {
    // Primary 404'd or only returned circular "form of" glosses — await Wiktionary & FreeDictionaryAPI fully
    [freeDict, wiktionary] = await Promise.all([freeDictPromise, wiktionaryPromise]);
  }

  // Order: keep primary first when it has substantive definitions; otherwise prefer structured Wiktionary sources
  const orderedSources = hasSubstantiveDefinition(primary, cleanWord)
    ? [primary, freeDict, wiktionary]
    : [freeDict, wiktionary, primary];

  let result = mergeWordEntries(orderedSources, cleanWord);

  // Enrich circular "-ly" manner stubs (e.g. "In an ignominious manner.") with the base adjective's meaning
  if (allowLemmaResolution && result) {
    for (const meaning of result.meanings) {
      if (meaning.partOfSpeech !== "adverb") continue;
      for (const def of meaning.definitions) {
        const extracted = extractFormOfLemma(def.definition, def.tags);
        if (extracted?.isMannerStub && extracted.lemma) {
          const baseEntry = await lookupWordCore(extracted.lemma, false);
          const adjMeaning =
            baseEntry?.meanings.find((m) => m.partOfSpeech === "adjective") ||
            baseEntry?.meanings[0];
          const adjDef = adjMeaning?.definitions.find(
            (d) => !isCircularOrFormOfDefinition(d.definition, extracted.lemma)
          );
          if (adjDef) {
            const cleanStub = def.definition.replace(/\.$/, "");
            const cleanAdj =
              adjDef.definition.charAt(0).toLowerCase() + adjDef.definition.slice(1);
            def.definition = `${cleanStub} (${cleanAdj.replace(/\.$/, "")}).`;
            if (!meaning.synonyms?.length && adjMeaning?.synonyms?.length) {
              meaning.synonyms = adjMeaning.synonyms;
            }
          }
        }
      }
    }
  }

  // Resolve inflected forms / circular "form of" entries (e.g. "harbored", "vicissitudes") via base lemma
  if (allowLemmaResolution && !hasSubstantiveDefinition(result, cleanWord)) {
    const lemmaCandidates: Array<{ lemma: string; expectedPos?: string }> = [];

    if (result) {
      for (const m of result.meanings) {
        for (const d of m.definitions) {
          const ref = extractFormOfLemma(d.definition, d.tags);
          if (ref?.lemma && ref.lemma.toLowerCase() !== cleanWord.toLowerCase()) {
            lemmaCandidates.push({
              lemma: ref.lemma,
              expectedPos: ref.inflectedPos || m.partOfSpeech,
            });
          }
        }
      }
    }

    for (const derived of deriveCandidateLemmas(cleanWord)) {
      if (!lemmaCandidates.some((c) => c.lemma.toLowerCase() === derived.lemma.toLowerCase())) {
        lemmaCandidates.push(derived);
      }
    }

    for (const candidate of lemmaCandidates.slice(0, 3)) {
      const lemmaEntry = await lookupWordCore(candidate.lemma, false);
      if (lemmaEntry && hasSubstantiveDefinition(lemmaEntry, candidate.lemma)) {
        const substantiveMeanings: Meaning[] = lemmaEntry.meanings
          .map((m) => ({
            ...m,
            definitions: m.definitions.filter(
              (d) => !isCircularOrFormOfDefinition(d.definition, candidate.lemma)
            ),
          }))
          .filter((m) => m.definitions.length > 0);

        if (substantiveMeanings.length > 0) {
          // Prioritize meanings matching the inflected part of speech when known
          if (candidate.expectedPos) {
            substantiveMeanings.sort((a, b) => {
              const aMatch = a.partOfSpeech === candidate.expectedPos ? 1 : 0;
              const bMatch = b.partOfSpeech === candidate.expectedPos ? 1 : 0;
              return bMatch - aMatch;
            });
          }

          result = {
            word: result?.word || cleanWord,
            phonetic: result?.phonetic || lemmaEntry.phonetic,
            audio: result?.audio || lemmaEntry.audio,
            origin: result?.origin || lemmaEntry.origin,
            meanings: substantiveMeanings,
          };
          break;
        }
      }
    }
  }

  // Last-resort fallback to Datamuse WordNet if all Wiktionary-backed APIs failed
  if (!result) {
    result = await datamusePromise;
  } else if (!result.phonetic) {
    const dm = await Promise.race([
      datamusePromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 250)),
    ]);
    if (dm?.phonetic) {
      result.phonetic = dm.phonetic;
    }
  }

  return result;
};

export const lookupWord = async (word: string): Promise<WordEntry | null> => {
  const cleanWord = word.trim();
  if (!cleanWord) return null;
  const cacheKey = cleanWord.toLowerCase();

  const cached = wordCache.get(cacheKey);
  if (cached) {
    const cachedImage = imageCache.get(cacheKey);
    return {
      ...cached,
      ...(cachedImage ? { image: cachedImage } : {}),
    };
  }

  const inFlight = inFlightLookups.get(cacheKey);
  if (inFlight) return inFlight;

  const lookupPromise = (async (): Promise<WordEntry | null> => {
    const imagePromise = fetchImageForWord(cleanWord);
    const result = await lookupWordCore(cleanWord, true);

    if (!result) {
      return null;
    }

    const resultKey = result.word.toLowerCase();
    // Attach image immediately if it already resolved, otherwise don't block definition display
    const quickImage = await Promise.race([
      imagePromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 150)),
    ]);
    if (quickImage) {
      result.image = quickImage;
    } else if (imageCache.get(resultKey)) {
      result.image = imageCache.get(resultKey)!;
    }

    wordCache.set(cacheKey, result);
    wordCache.set(resultKey, result);
    return { ...result };
  })();

  inFlightLookups.set(cacheKey, lookupPromise);
  try {
    return await lookupPromise;
  } finally {
    inFlightLookups.delete(cacheKey);
  }
};

export const prefetchWord = (word: string): void => {
  const clean = word?.trim();
  if (!clean || clean.length < 2) return;
  lookupWord(clean).catch(() => {});
};

export const getSpellingSuggestions = async (word: string): Promise<string[]> => {
  const cleanWord = word.trim();
  if (!cleanWord) return [];
  try {
    // sp = spelled like (handles typos)
    const response = await fetchWithTimeout(
      `${DATAMUSE_API_URL}?sp=${encodeURIComponent(cleanWord)}&max=5`,
      DATAMUSE_TIMEOUT_MS
    );

    if (!response.ok) return [];

    const data: DatamuseEntry[] = await response.json();

    return data
      .map((entry) => entry.word)
      .filter((w) => w.toLowerCase() !== cleanWord.toLowerCase());
  } catch (error) {
    console.error("Error fetching spelling suggestions:", error);
    return [];
  }
};
