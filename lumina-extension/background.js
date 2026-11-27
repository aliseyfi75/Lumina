// Constants matching Lumina web app structure
const DICT_API = "https://api.dictionaryapi.dev/api/v2/entries/en";
const DATAMUSE_API = "https://api.datamuse.com/words";
const PANTRY_BASE = "https://getpantry.cloud/apiv1/pantry";
const BASKET_NAME = "Lumina"; // Must match the basket name in pantryService.ts
const MAX_BASKET_BYTES = 30 * 1024;
const GIST_API_BASE = "https://api.github.com/gists";
const GIST_FILENAME = "lumina_flashcards_backup.json"; // Must match gistService.ts
const GIST_PART_PREFIX = "lumina_flashcards_part_";
const LEGACY_GIST_FILENAMES = ["lumina_flashcards_backup.json", "lumina-deck.json", "lumina_backup.json"];
let rateLimitDelayMs = 1400;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizePantryId(raw) {
  const trimmed = String(raw || "").trim();
  const match = trimmed.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return match ? match[0] : trimmed;
}

function normalizeGistId(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  const urlMatch = trimmed.match(/gist\.github\.com\/(?:[^/]+\/)?([0-9a-f]{8,64})/i);
  if (urlMatch) return urlMatch[1];
  const hexMatch = trimmed.match(/([0-9a-f]{20,64})/i);
  return hexMatch ? hexMatch[1] : trimmed;
}

function cleanGitHubToken(rawToken) {
  return String(rawToken || "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .replace(/^(?:Bearer|token)\s+/i, "")
    .trim();
}

function extractDomainFromUrl(urlStr) {
  if (!urlStr) return "";
  try {
    const hostname = new URL(urlStr).hostname || "";
    return hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function formatSourceTag(sourceDomain) {
  const cleaned = String(sourceDomain || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./i, "")
    .toLowerCase();
  if (!cleaned || cleaned.length > 80) return "";
  return `Web: ${cleaned}`;
}

function cleanContextSentence(rawSentence) {
  const normalized = String(rawSentence || "").replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length < 4) return "";
  return normalized.length > 260 ? `${normalized.slice(0, 257).trim()}...` : normalized;
}

function splitCardsIntoChunks(cards, maxChunkBytes) {
  if (!cards || cards.length === 0) return [[]];
  const chunks = [];
  let currentChunk = [];
  let currentBytes = 32; // overhead for {"cards":[]}

  for (const card of cards) {
    const cardBytes = new Blob([JSON.stringify(card)]).size + 1;
    if (currentChunk.length > 0 && currentBytes + cardBytes > maxChunkBytes) {
      chunks.push(currentChunk);
      currentChunk = [card];
      currentBytes = 32 + cardBytes;
    } else {
      currentChunk.push(card);
      currentBytes += cardBytes;
    }
  }
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }
  return chunks;
}

async function lookupWordWithFallback(word) {
  // 1. Try Primary Dictionary API
  try {
    const dictRes = await fetch(`${DICT_API}/${encodeURIComponent(word)}`);
    if (dictRes.ok) {
      const dictData = await dictRes.json();
      if (Array.isArray(dictData) && dictData.length > 0 && dictData[0]?.meanings?.length > 0) {
        const entry = dictData[0];
        const firstMeaning = entry.meanings[0];
        const firstDef = firstMeaning.definitions?.[0] || { definition: "" };
        if (firstDef.definition) {
          return {
            word: entry.word,
            phonetic: entry.phonetic || entry.phonetics?.find((p) => p.text)?.text,
            audio: entry.phonetics?.find((p) => p.audio)?.audio,
            mainDefinition: firstDef.definition,
            example: firstDef.example || "",
            partOfSpeech: firstMeaning.partOfSpeech || "",
          };
        }
      }
    }
  } catch {
    // Fall through to Datamuse
  }

  // 2. Fallback to Datamuse API (matching dictionaryService.ts)
  const dmRes = await fetch(`${DATAMUSE_API}?sp=${encodeURIComponent(word)}&md=dr&ipa=1&max=1`);
  if (!dmRes.ok) {
    throw new Error("Word not found in dictionary.");
  }
  const dmData = await dmRes.json();
  if (!Array.isArray(dmData) || dmData.length === 0 || !dmData[0]?.defs?.length) {
    throw new Error("Word not found in dictionary.");
  }

  const entry = dmData[0];
  if (entry.word.toLowerCase() !== word.toLowerCase()) {
    throw new Error("Word not found in dictionary.");
  }

  let phonetic;
  if (Array.isArray(entry.tags)) {
    const pronTag = entry.tags.find((t) => t.startsWith("pron:"));
    if (pronTag) {
      phonetic = pronTag.replace("pron:", "").trim();
    }
  }

  const firstDefRaw = entry.defs[0];
  const tabIndex = firstDefRaw.indexOf("\t");
  const posCode = tabIndex !== -1 ? firstDefRaw.substring(0, tabIndex) : "";
  const definition = tabIndex !== -1 ? firstDefRaw.substring(tabIndex + 1) : firstDefRaw;

  const posMap = { n: "noun", v: "verb", adj: "adjective", adv: "adverb" };
  const partOfSpeech = posMap[posCode] || posCode;

  return {
    word: entry.word,
    phonetic,
    audio: undefined,
    mainDefinition: definition,
    example: "",
    partOfSpeech,
  };
}

// 1. Create Context Menu on Install & Listen to Inline Content Script Messages
if (typeof chrome !== "undefined" && chrome.runtime?.onInstalled) {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: "addToLumina",
        title: "Add '%s' to Lumina Deck",
        contexts: ["selection"],
      });
    });
  });

  // 2. Handle Context Menu Click Event
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "addToLumina" && info.selectionText) {
      const sourceDomain = extractDomainFromUrl(tab?.url || info.pageUrl);
      handleAddToLumina(info.selectionText.trim(), { sourceDomain });
    }
  });
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== "object") return false;

    if (message.type === "LUMINA_LOOKUP" && typeof message.word === "string") {
      lookupWordWithFallback(message.word.trim())
        .then((entry) => sendResponse({ ok: true, entry }))
        .catch((err) => sendResponse({ ok: false, error: err?.message || "Word not found." }));
      return true;
    }

    if (message.type === "LUMINA_ADD_WORD" && typeof message.word === "string") {
      const sourceDomain =
        message.sourceDomain || extractDomainFromUrl(sender?.tab?.url || "");
      handleAddToLumina(message.word.trim(), {
        contextSentence: message.contextSentence,
        sourceDomain,
      })
        .then((result) => sendResponse({ ok: true, result }))
        .catch((err) => sendResponse({ ok: false, error: err?.message || "Failed to add word." }));
      return true;
    }

    return false;
  });
}

let addQueueChain = Promise.resolve();

function handleAddToLumina(word, options = {}) {
  const task = addQueueChain.then(() => executeAddToLumina(word, options));
  addQueueChain = task.catch(() => {});
  return task;
}

async function readGistFileJson(fileObj) {
  if (!fileObj) return null;
  let content = fileObj.content;
  if ((!content || fileObj.truncated) && fileObj.raw_url) {
    const rawRes = await fetch(fileObj.raw_url);
    if (rawRes.ok) {
      content = await rawRes.text();
    }
  }
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function syncCardToGist(newCard, rawToken, rawGistId, now) {
  const token = cleanGitHubToken(rawToken);
  const gistId = normalizeGistId(rawGistId);
  if (!token || !gistId) {
    throw new Error("GitHub Gist token or Gist ID is missing.");
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };

  // 1. Fetch existing Gist in 1 request
  const getRes = await fetch(`${GIST_API_BASE}/${encodeURIComponent(gistId)}`, {
    method: "GET",
    headers,
  });
  if (!getRes.ok) {
    throw new Error(`Failed to fetch GitHub Gist (${getRes.status}).`);
  }
  const gist = await getRes.json();
  const files = gist?.files || {};

  // Locate primary Lumina JSON file
  let targetFilename =
    LEGACY_GIST_FILENAMES.find((name) => Boolean(files[name])) ||
    Object.keys(files).find((name) => name.endsWith(".json")) ||
    GIST_FILENAME;

  const primaryData = (await readGistFileJson(files[targetFilename])) || {};
  const primaryCards = Array.isArray(primaryData.cards) ? primaryData.cards : [];

  // Also check any overflow part files for duplicates
  const allExistingCards = [...primaryCards];
  const partFilenames = Object.keys(files)
    .filter((name) => name.startsWith(GIST_PART_PREFIX) && name.endsWith(".json"))
    .sort();
  for (const partName of partFilenames) {
    const partData = await readGistFileJson(files[partName]);
    if (Array.isArray(partData?.cards)) {
      allExistingCards.push(...partData.cards);
    }
  }

  if (allExistingCards.some((c) => c.word && c.word.toLowerCase() === newCard.word.toLowerCase())) {
    notify("Duplicate", `"${newCard.word}" is already in your deck.`);
    return { status: "duplicate", word: newCard.word };
  }

  // 2. Prepend new card into primary file while preserving all metadata
  const updatedPrimaryPayload = {
    ...primaryData,
    cards: [newCard, ...primaryCards],
    studyHistory: primaryData.studyHistory || {},
    longestStreak: primaryData.longestStreak || 0,
    deletedCards: primaryData.deletedCards || {},
    lastAccessedAt: now,
  };

  const patchRes = await fetch(`${GIST_API_BASE}/${encodeURIComponent(gistId)}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      files: {
        [targetFilename]: {
          content: JSON.stringify(updatedPrimaryPayload),
        },
      },
    }),
  });

  if (!patchRes.ok) {
    throw new Error(`Failed to save card to GitHub Gist (${patchRes.status}).`);
  }

  notify("Success", `Added "${newCard.word}" to Lumina (GitHub Gist)!`);
  return { status: "added", word: newCard.word, provider: "gist" };
}

async function syncCardToPantry(newCard, rawPantryId, now) {
  const pantryId = normalizePantryId(rawPantryId);

  // Fetch Current Deck across all chunks
  const deckRes = await fetch(`${PANTRY_BASE}/${pantryId}/basket/${BASKET_NAME}?t=${now}`);

  let currentCards = [];
  let currentStudyHistory = {};
  let currentLongestStreak = 0;
  let currentDeletedCards = {};
  let currentLanguagePreference;
  let currentLanguagePreferenceUpdatedAt;
  let currentChunkCount = 1;

  if (deckRes.ok) {
    const data = await deckRes.json();
    currentCards = Array.isArray(data.cards) ? data.cards : [];
    currentStudyHistory = data.studyHistory || {};
    currentLongestStreak = data.longestStreak || 0;
    currentDeletedCards = data.deletedCards || {};
    if (data.languagePreference === "en" || data.languagePreference === "fa" || data.languagePreference === "both") {
      currentLanguagePreference = data.languagePreference;
    }
    if (typeof data.languagePreferenceUpdatedAt === "number") {
      currentLanguagePreferenceUpdatedAt = data.languagePreferenceUpdatedAt;
    }
    if (typeof data.chunkCount === "number" && data.chunkCount > 1) {
      currentChunkCount = data.chunkCount;
    }

    for (let i = 1; i < currentChunkCount; i++) {
      if (rateLimitDelayMs > 0) await sleep(rateLimitDelayMs);
      const chunkRes = await fetch(`${PANTRY_BASE}/${pantryId}/basket/${BASKET_NAME}_${i}?t=${now}`);
      if (!chunkRes.ok) {
        throw new Error(`Failed to load deck chunk ${i} from Pantry (${chunkRes.status}).`);
      }
      const chunkData = await chunkRes.json();
      if (Array.isArray(chunkData.cards)) {
        currentCards = currentCards.concat(chunkData.cards);
      }
    }
  } else if (deckRes.status !== 400 && deckRes.status !== 404) {
    throw new Error(`Failed to fetch existing deck from Pantry (${deckRes.status}).`);
  }

  // Check for duplicates across the entire multi-chunk deck
  if (currentCards.some((c) => c.word.toLowerCase() === newCard.word.toLowerCase())) {
    notify("Duplicate", `"${newCard.word}" is already in your deck.`);
    return { status: "duplicate", word: newCard.word };
  }

  const preservedLanguageMeta = {
    ...(currentLanguagePreference ? { languagePreference: currentLanguagePreference } : {}),
    ...(currentLanguagePreferenceUpdatedAt !== undefined
      ? { languagePreferenceUpdatedAt: currentLanguagePreferenceUpdatedAt }
      : {}),
  };

  // Save updated deck with 30 KB chunking
  const updatedCards = [newCard, ...currentCards];
  const fullPayload = JSON.stringify({
    cards: updatedCards,
    studyHistory: currentStudyHistory,
    longestStreak: currentLongestStreak,
    deletedCards: currentDeletedCards,
    ...preservedLanguageMeta,
    chunkCount: 1,
    lastAccessedAt: now,
  });

  if (new Blob([fullPayload]).size <= MAX_BASKET_BYTES) {
    if (rateLimitDelayMs > 0) await sleep(rateLimitDelayMs);
    const saveRes = await fetch(`${PANTRY_BASE}/${pantryId}/basket/${BASKET_NAME}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: fullPayload,
    });
    if (!saveRes.ok) {
      throw new Error(`Failed to save card to Pantry (${saveRes.status}).`);
    }
  } else {
    const metadataOverhead = new Blob([
      JSON.stringify({
        cards: [],
        studyHistory: currentStudyHistory,
        longestStreak: currentLongestStreak,
        deletedCards: currentDeletedCards,
        ...preservedLanguageMeta,
        chunkCount: 99,
        lastAccessedAt: now,
      }),
    ]).size;

    const firstChunkMax = Math.max(8 * 1024, MAX_BASKET_BYTES - metadataOverhead);
    const firstSplit = splitCardsIntoChunks(updatedCards, firstChunkMax);
    const chunk0 = firstSplit[0] || [];
    const remainingCards = updatedCards.slice(chunk0.length);
    const restChunks =
      remainingCards.length > 0 ? splitCardsIntoChunks(remainingCards, MAX_BASKET_BYTES - 512) : [];
    const allChunks = [chunk0, ...restChunks];

    if (rateLimitDelayMs > 0) await sleep(rateLimitDelayMs);
    const mainRes = await fetch(`${PANTRY_BASE}/${pantryId}/basket/${BASKET_NAME}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cards: allChunks[0],
        studyHistory: currentStudyHistory,
        longestStreak: currentLongestStreak,
        deletedCards: currentDeletedCards,
        ...preservedLanguageMeta,
        chunkCount: allChunks.length,
        lastAccessedAt: now,
      }),
    });
    if (!mainRes.ok) {
      throw new Error(`Failed to save main deck chunk to Pantry (${mainRes.status}).`);
    }

    for (let i = 1; i < allChunks.length; i++) {
      if (rateLimitDelayMs > 0) await sleep(rateLimitDelayMs);
      const chunkRes = await fetch(`${PANTRY_BASE}/${pantryId}/basket/${BASKET_NAME}_${i}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cards: allChunks[i],
          lastAccessedAt: now,
        }),
      });
      if (!chunkRes.ok) {
        throw new Error(`Failed to save deck chunk ${i} to Pantry (${chunkRes.status}).`);
      }
    }
  }

  notify("Success", `Added "${newCard.word}" to Lumina!`);
  return { status: "added", word: newCard.word, provider: "pantry" };
}

async function executeAddToLumina(word, options = {}) {
  try {
    // A. Retrieve Sync Provider Config (GitHub Gist or Pantry)
    const storage = await chrome.storage.sync.get([
      "luminaSyncProvider",
      "luminaGistToken",
      "luminaGistId",
      "luminaPantryId",
    ]);

    const useGist =
      storage.luminaSyncProvider === "gist" ||
      (!storage.luminaSyncProvider && Boolean(storage.luminaGistToken && storage.luminaGistId));

    if (useGist && (!storage.luminaGistToken || !storage.luminaGistId)) {
      notify("Setup Required", "Please click the Lumina extension icon and connect GitHub Gist.");
      return { status: "unconfigured" };
    }
    if (!useGist && !storage.luminaPantryId) {
      notify("Setup Required", "Please click the extension icon and connect GitHub Gist or Pantry.");
      return { status: "unconfigured" };
    }

    // B. Fetch Definition (Primary + Datamuse fallback)
    const lookedUp = await lookupWordWithFallback(word);
    const now = Date.now();
    const capturedContext = cleanContextSentence(options?.contextSentence);
    const sourceTag = formatSourceTag(options?.sourceDomain);

    // C. Construct Flashcard (Matching interface in types.ts)
    const newCard = {
      id: crypto.randomUUID(),
      word: lookedUp.word,
      ...(lookedUp.phonetic ? { phonetic: lookedUp.phonetic } : {}),
      ...(lookedUp.audio ? { audio: lookedUp.audio } : {}),
      mainDefinition: lookedUp.mainDefinition,
      ...(capturedContext || lookedUp.example ? { example: capturedContext || lookedUp.example } : {}),
      partOfSpeech: lookedUp.partOfSpeech,
      ...(sourceTag ? { tags: [sourceTag] } : {}),
      status: "New", // FlashcardStatus.New
      lastReviewed: 0,
      createdAt: now,
      repetition: 0,
      nextReviewDate: now,
      updatedAt: now,
    };

    if (useGist) {
      return await syncCardToGist(newCard, storage.luminaGistToken, storage.luminaGistId, now);
    }
    return await syncCardToPantry(newCard, storage.luminaPantryId, now);
  } catch (error) {
    console.error(error);
    notify("Error", error.message || "Failed to save card.");
    throw error;
  }
}

// Helper for Chrome Notifications
function notify(title, message) {
  if (typeof chrome !== "undefined" && chrome.notifications) {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icon.png",
      title: `Lumina: ${title}`,
      message: message,
    });
  }
}

// Export hooks for automated testing
if (typeof globalThis !== "undefined") {
  globalThis.__luminaExtension = {
    handleAddToLumina,
    lookupWordWithFallback,
    splitCardsIntoChunks,
    normalizeGistId,
    setRateLimitDelayForTests: (ms) => {
      rateLimitDelayMs = ms;
    },
  };
}
