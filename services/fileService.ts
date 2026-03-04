import { Flashcard, FlashcardStatus, FileSystemFileHandle, CloudData } from '../types';

export const generateJSON = (data: CloudData): string => {
  return JSON.stringify(data, null, 2);
};

export const generateCSV = (cards: Flashcard[]): string => {
  if (!cards || !Array.isArray(cards)) return '';

  const headers = [
    'ID',
    'Word',
    'Phonetic',
    'Definition',
    'Example',
    'Part of Speech',
    'Status',
    'Last Reviewed',
    'Created At'
  ];

  const escapeField = (field: string | undefined | number) => {
    if (field === undefined || field === null) return '';
    const stringField = String(field);
    // Escape quotes by doubling them, and wrap in quotes if it contains comma, quote, or newline
    if (stringField.includes('"') || stringField.includes(',') || stringField.includes('\n')) {
      return `"${stringField.replace(/"/g, '""')}"`;
    }
    return stringField;
  };

  const rows = cards.map(card => [
    card.id,
    card.word,
    card.phonetic,
    card.mainDefinition,
    card.example,
    card.partOfSpeech,
    card.status,
    card.lastReviewed,
    card.createdAt,
  ].map(escapeField).join(','));

  return [headers.join(','), ...rows].join('\n');
};

export const parseFileContent = (text: string): CloudData => {
  if (!text) return { cards: [] };

  try {
    // Attempt to parse as JSON first (new format)
    const data = JSON.parse(text);
    if (data.cards || data.studyHistory || data.longestStreak !== undefined) {
      // Support legacy deletedCardIds (string[]) by upgrading to the new map format
      let deletedCards: Record<string, number> = {};
      if (data.deletedCards && typeof data.deletedCards === 'object' && !Array.isArray(data.deletedCards)) {
        deletedCards = data.deletedCards;
      } else if (Array.isArray(data.deletedCardIds)) {
        // Upgrade: assign a placeholder timestamp so they can expire naturally
        const now = Date.now();
        (data.deletedCardIds as string[]).forEach((id: string) => { deletedCards[id] = now; });
      }
      return {
        cards: Array.isArray(data.cards) ? data.cards : [],
        studyHistory: data.studyHistory || {},
        longestStreak: data.longestStreak || 0,
        deletedCards,
      };
    }
  } catch (e) {
    // Fallback to CSV format parsing (old legacy format)
    return { cards: parseCSV(text) };
  }

  return { cards: [] };
};

export const parseCSV = (csvText: string): Flashcard[] => {
  if (!csvText) return [];
  const lines = csvText.split(/\r?\n/);
  if (lines.length < 2) return []; // Only header or empty

  const cards: Flashcard[] = [];

  // Skip header (index 0)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Simplified parser for browser environment:
    const values: string[] = [];
    let currentVal = '';
    let inQuote = false;

    for (let charIndex = 0; charIndex < line.length; charIndex++) {
      const char = line[charIndex];
      const nextChar = line[charIndex + 1];

      if (char === '"') {
        if (inQuote && nextChar === '"') {
          currentVal += '"';
          charIndex++; // skip next quote
        } else {
          inQuote = !inQuote;
        }
      } else if (char === ',' && !inQuote) {
        values.push(currentVal);
        currentVal = '';
      } else {
        currentVal += char;
      }
    }
    values.push(currentVal); // Push last value

    if (values.length < 7) continue; // Malformed row

    // Clean up IDs to ensure they are unique if importing legacy data, 
    // but prefer keeping existing ID to prevent duplicates on merge
    const id = values[0] || crypto.randomUUID();

    cards.push({
      id: id,
      word: values[1],
      phonetic: values[2],
      mainDefinition: values[3],
      example: values[4],
      partOfSpeech: values[5],
      status: (values[6] as FlashcardStatus) || FlashcardStatus.New,
      lastReviewed: parseInt(values[7] || '0', 10),
      createdAt: parseInt(values[8] || Date.now().toString(), 10),
    });
  }

  return cards;
};

export const downloadJSON = (content: string, filename: string) => {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8;' });
  const link = document.createElement('a');
  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
};

export const saveToLocalFile = async (handle: FileSystemFileHandle, data: CloudData) => {
  if (!handle) return;
  const content = generateJSON(data);
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
};