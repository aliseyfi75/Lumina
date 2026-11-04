interface DatamuseResult {
  word: string;
  score: number;
}

const SUGGESTION_API_URL = "https://api.datamuse.com/sug";
const SUGGESTION_TIMEOUT_MS = 2500;
const suggestionCache = new Map<string, string[]>();

export const getWordSuggestions = async (text: string): Promise<string[]> => {
  const normalized = text?.trim().toLowerCase() ?? "";
  if (normalized.length < 2) return [];

  const cached = suggestionCache.get(normalized);
  if (cached) return cached;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SUGGESTION_TIMEOUT_MS);

  try {
    const response = await fetch(`${SUGGESTION_API_URL}?s=${encodeURIComponent(normalized)}`, {
      signal: controller.signal,
    });
    if (!response.ok) return [];

    const data: DatamuseResult[] = await response.json();

    // Return top 5 suggestions
    const words = data.slice(0, 5).map(item => item.word);
    suggestionCache.set(normalized, words);
    return words;
  } catch (error) {
    console.error("Error fetching suggestions:", error);
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
};