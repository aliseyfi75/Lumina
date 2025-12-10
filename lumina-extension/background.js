// Constants matching your App structure
const DICT_API = "https://api.dictionaryapi.dev/api/v2/entries/en";
const PANTRY_BASE = "https://getpantry.cloud/apiv1/pantry";
const BASKET_NAME = "Lumina"; // Must match the basket name in pantryService.ts

// 1. Create Context Menu on Install
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "addToLumina",
    title: "Add '%s' to Lumina Deck",
    contexts: ["selection"]
  });
});

// 2. Handle the Click Event
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "addToLumina" && info.selectionText) {
    handleAddToLumina(info.selectionText.trim());
  }
});

async function handleAddToLumina(word) {
  try {
    // A. Retrieve Pantry ID
    const storage = await chrome.storage.sync.get(['luminaPantryId']);
    const pantryId = storage.luminaPantryId;

    if (!pantryId) {
      notify("Setup Required", "Please click the extension icon and set your Pantry ID.");
      return;
    }

    // B. Fetch Definition (Logic ported from dictionaryService.ts)
    const dictRes = await fetch(`${DICT_API}/${encodeURIComponent(word)}`);
    if (!dictRes.ok) throw new Error("Word not found in dictionary.");
    
    const dictData = await dictRes.json();
    if (!Array.isArray(dictData) || dictData.length === 0) throw new Error("No definition found.");

    const entry = dictData[0];
    const firstMeaning = entry.meanings[0];
    const firstDef = firstMeaning.definitions[0];

    // C. Construct Flashcard (Matching interface in types.ts)
    const newCard = {
      id: crypto.randomUUID(),
      word: entry.word,
      phonetic: entry.phonetic || (entry.phonetics?.find(p => p.text)?.text),
      mainDefinition: firstDef.definition,
      example: firstDef.example || "",
      partOfSpeech: firstMeaning.partOfSpeech,
      status: "New", // FlashcardStatus.New
      lastReviewed: 0,
      createdAt: Date.now()
    };

    // D. Fetch Current Deck & Append (Logic ported from pantryService.ts)
    // Pantry is a KV store, so we must Read -> Append -> Write
    const deckRes = await fetch(`${PANTRY_BASE}/${pantryId}/basket/${BASKET_NAME}`);
    
    let currentCards = [];
    if (deckRes.ok) {
        const data = await deckRes.json();
        currentCards = data.cards || [];
    }

    // Check for duplicates
    if (currentCards.some(c => c.word.toLowerCase() === newCard.word.toLowerCase())) {
        notify("Duplicate", `"${newCard.word}" is already in your deck.`);
        return;
    }

    // E. Save updated deck
    const updatedCards = [newCard, ...currentCards];
    
    await fetch(`${PANTRY_BASE}/${pantryId}/basket/${BASKET_NAME}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cards: updatedCards }),
    });

    notify("Success", `Added "${newCard.word}" to Lumina!`);

  } catch (error) {
    console.error(error);
    notify("Error", error.message || "Failed to save card.");
  }
}

// Helper for Chrome Notifications
function notify(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icon.png',
    title: `Lumina: ${title}`,
    message: message
  });
}
