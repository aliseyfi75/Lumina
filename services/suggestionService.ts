interface DatamuseResult {
  word: string;
  score: number;
}

const SUGGESTION_API_URL = "https://api.datamuse.com/sug";

export const getWordSuggestions = async (text: string): Promise<string[]> => {
  if (!text || text.trim().length < 2) return [];

  try {
    const response = await fetch(`${SUGGESTION_API_URL}?s=${encodeURIComponent(text)}`);
    if (!response.ok) return [];

    const data: DatamuseResult[] = await response.json();
    
    // Return top 5 suggestions
    return data.slice(0, 5).map(item => item.word);
  } catch (error) {
    console.error("Error fetching suggestions:", error);
    return [];
  }
};