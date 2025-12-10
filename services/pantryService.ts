import { Flashcard } from '../types';

const BASE_URL = 'https://getpantry.cloud/apiv1/pantry';
const BASKET_NAME = 'Lumina';

// Standard options to avoid CORS/Referrer issues in sensitive browser environments
const FETCH_OPTIONS: RequestInit = {
    referrerPolicy: 'no-referrer',
    mode: 'cors',
    credentials: 'omit'
};

export const getDetails = async (pantryId: string) => {
  const response = await fetch(`${BASE_URL}/${pantryId}`, {
      ...FETCH_OPTIONS,
      method: 'GET'
  });
  
  if (!response.ok) {
     throw new Error(`Invalid Pantry ID or network error: ${response.status} ${response.statusText}`);
  }
  return await response.json();
};

export const getDeck = async (pantryId: string): Promise<Flashcard[]> => {
  try {
    const response = await fetch(`${BASE_URL}/${pantryId}/basket/${BASKET_NAME}`, {
        ...FETCH_OPTIONS,
        method: 'GET'
    });
    
    if (!response.ok) {
      // If 400/404, it likely means the basket doesn't exist yet, which is fine.
      // We treat it as a new empty deck.
      return [];
    }

    const data = await response.json();
    // Pantry stores key-value pairs. We expect { "cards": [...] }
    return Array.isArray(data.cards) ? data.cards : [];
  } catch (error) {
    console.warn("Could not fetch deck from Pantry (might be new):", error);
    return [];
  }
};

export const updateDeck = async (pantryId: string, cards: Flashcard[]) => {
  const response = await fetch(`${BASE_URL}/${pantryId}/basket/${BASKET_NAME}`, {
    ...FETCH_OPTIONS,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ cards }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`Failed to update Pantry storage: ${errorText}`);
  }
};