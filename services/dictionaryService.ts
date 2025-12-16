import { WordEntry, Meaning } from "../types";

const PRIMARY_API_URL = "https://api.dictionaryapi.dev/api/v2/entries/en";
const DATAMUSE_API_URL = "https://api.datamuse.com/words";

interface DatamuseEntry {
  word: string;
  score: number;
  defs?: string[];
  tags?: string[];
}

const lookupPrimary = async (word: string): Promise<WordEntry | null> => {
  const response = await fetch(`${PRIMARY_API_URL}/${encodeURIComponent(word)}`);

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error("Failed to fetch definition");
  }

  const data = await response.json();
  
  if (!Array.isArray(data) || data.length === 0) return null;

  const entry = data[0];

  const wordEntry: WordEntry = {
    word: entry.word,
    phonetic: entry.phonetic || entry.phonetics?.find((p: any) => p.text)?.text,
    meanings: entry.meanings.map((m: any) => ({
      partOfSpeech: m.partOfSpeech,
      definitions: m.definitions.map((d: any) => ({
        definition: d.definition,
        example: d.example
      }))
    }))
  };

  return wordEntry;
};

const lookupDatamuse = async (word: string): Promise<WordEntry | null> => {
  // md=d (definitions), md=r (pronunciation), ipa=1 (IPA pronunciation), md=p (parts of speech - already in defs but good to have)
  const response = await fetch(`${DATAMUSE_API_URL}?sp=${encodeURIComponent(word)}&md=dr&ipa=1&max=1`);

  if (!response.ok) return null;

  const data: DatamuseEntry[] = await response.json();
  
  if (!Array.isArray(data) || data.length === 0 || !data[0].defs) return null;

  const entry = data[0];
  
  // Extract phonetic from tags (e.g., "pron:/ˈæpəl/")
  let phonetic: string | undefined;
  if (entry.tags) {
    const pronTag = entry.tags.find(t => t.startsWith('pron:'));
    if (pronTag) {
      phonetic = pronTag.replace('pron:', '').trim();
    }
  }

  // Group definitions by part of speech
  const meaningsMap = new Map<string, { definition: string; example?: string }[]>();

  entry.defs.forEach(defStr => {
    // Format: "n\tDefinition text"
    const tabIndex = defStr.indexOf('\t');
    if (tabIndex === -1) return;

    const posCode = defStr.substring(0, tabIndex);
    const definition = defStr.substring(tabIndex + 1);
    
    // Map Datamuse POS codes to full names if necessary, or just use them
    // Datamuse uses: n, v, adj, adv, u (unknown)
    let partOfSpeech = posCode;
    switch(posCode) {
      case 'n': partOfSpeech = 'noun'; break;
      case 'v': partOfSpeech = 'verb'; break;
      case 'adj': partOfSpeech = 'adjective'; break;
      case 'adv': partOfSpeech = 'adverb'; break;
      // 'u' remains 'u' or we can map to 'unknown'
    }

    if (!meaningsMap.has(partOfSpeech)) {
      meaningsMap.set(partOfSpeech, []);
    }
    
    meaningsMap.get(partOfSpeech)?.push({ definition });
  });

  const meanings: Meaning[] = Array.from(meaningsMap.entries()).map(([partOfSpeech, definitions]) => ({
    partOfSpeech,
    definitions
  }));

  if (meanings.length === 0) return null;

  return {
    word: entry.word,
    phonetic,
    meanings
  };
};

export const lookupWord = async (word: string): Promise<WordEntry | null> => {
  try {
    // Try Primary API first
    const primaryResult = await lookupPrimary(word);
    if (primaryResult) return primaryResult;

    // Try Fallback API (Datamuse)
    console.log("Primary API failed, trying fallback...");
    const fallbackResult = await lookupDatamuse(word);
    return fallbackResult;

  } catch (error) {
    console.error("Error fetching definition:", error);
    // If primary failed with network error, try fallback
    try {
        return await lookupDatamuse(word);
    } catch (e) {
        return null;
    }
  }
};

export const getSpellingSuggestions = async (word: string): Promise<string[]> => {
  try {
    // sp = spelled like (handles typos)
    const response = await fetch(`${DATAMUSE_API_URL}?sp=${encodeURIComponent(word)}&max=5`);
    
    if (!response.ok) return [];
    
    const data: DatamuseEntry[] = await response.json();
    
    // Filter out the word itself if it appears (though if we are here, it likely has no definition)
    // But sometimes a word exists but has no definition in the dictionary.
    return data
      .map(entry => entry.word)
      .filter(w => w.toLowerCase() !== word.toLowerCase());
      
  } catch (error) {
    console.error("Error fetching spelling suggestions:", error);
    return [];
  }
};
