import { WordEntry } from "../types";

const API_URL = "https://api.dictionaryapi.dev/api/v2/entries/en";

export const lookupWord = async (word: string): Promise<WordEntry | null> => {
  try {
    const response = await fetch(`${API_URL}/${encodeURIComponent(word)}`);

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error("Failed to fetch definition");
    }

    const data = await response.json();
    
    // The API returns an array of entries. We usually take the first one.
    if (!Array.isArray(data) || data.length === 0) return null;

    const entry = data[0];

    // Map the API response to our internal WordEntry format
    const wordEntry: WordEntry = {
      word: entry.word,
      // Phonetic might be at top level or inside phonetics array
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
  } catch (error) {
    console.error("Error fetching definition:", error);
    return null;
  }
};