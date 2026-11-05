// Constants matching your App structure
const DICT_API = "https://api.dictionaryapi.dev/api/v2/entries/en";
const DATAMUSE_API = "https://api.datamuse.com/words";
const PANTRY_BASE = "https://getpantry.cloud/apiv1/pantry";
const BASKET_NAME = "Lumina"; // Must match the basket name in pantryService.ts
const MAX_BASKET_BYTES = 30 * 1024;
let rateLimitDelayMs = 1400;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizePantryId(raw) {
  const trimmed = String(raw || "").trim();
  const match = trimmed.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return match ? match[0] : trimmed;
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

// 1. Create Context Menu on Install
if (typeof chrome !== "undefined" && chrome.runtime?.onInstalled) {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
      id: "addToLumina",
      title: "Add '%s' to Lumina Deck",
      contexts: ["selection"],
    });
  });

  // 2. Handle the Click Event
  chrome.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId === "addToLumina" && info.selectionText) {
      handleAddToLumina(info.selectionText.trim());
    }
  });
}

async function handleAddToLumina(word) {
  try {
    // A. Retrieve Pantry ID
    const storage = await chrome.storage.sync.get(["luminaPantryId"]);
    const rawPantryId = storage.luminaPantryId;

    if (!rawPantryId) {
      notify("Setup Required", "Please click the extension icon and set your Pantry ID.");
      return;
    }
    const pantryId = normalizePantryId(rawPantryId);

    // B. Fetch Definition (Primary + Datamuse fallback)
    const lookedUp = await lookupWordWithFallback(word);
    const now = Date.now();

    // C. Construct Flashcard (Matching interface in types.ts)
    const newCard = {
      id: crypto.randomUUID(),
      word: lookedUp.word,
      ...(lookedUp.phonetic ? { phonetic: lookedUp.phonetic } : {}),
      ...(lookedUp.audio ? { audio: lookedUp.audio } : {}),
      mainDefinition: lookedUp.mainDefinition,
      ...(lookedUp.example ? { example: lookedUp.example } : {}),
      partOfSpeech: lookedUp.partOfSpeech,
      status: "New", // FlashcardStatus.New
      lastReviewed: 0,
      createdAt: now,
      repetition: 0,
      nextReviewDate: now,
      updatedAt: now,
    };

    // D. Fetch Current Deck across all chunks
    const deckRes = await fetch(`${PANTRY_BASE}/${pantryId}/basket/${BASKET_NAME}?t=${now}`);

    let currentCards = [];
    let currentStudyHistory = {};
    let currentLongestStreak = 0;
    let currentDeletedCards = {};
    let currentChunkCount = 1;

    if (deckRes.ok) {
      const data = await deckRes.json();
      currentCards = Array.isArray(data.cards) ? data.cards : [];
      currentStudyHistory = data.studyHistory || {};
      currentLongestStreak = data.longestStreak || 0;
      currentDeletedCards = data.deletedCards || {};
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
      return;
    }

    // E. Save updated deck with 30 KB chunking
    const updatedCards = [newCard, ...currentCards];
    const fullPayload = JSON.stringify({
      cards: updatedCards,
      studyHistory: currentStudyHistory,
      longestStreak: currentLongestStreak,
      deletedCards: currentDeletedCards,
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
  } catch (error) {
    console.error(error);
    notify("Error", error.message || "Failed to save card.");
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
    setRateLimitDelayForTests: (ms) => {
      rateLimitDelayMs = ms;
    },
  };
}
