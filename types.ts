// Data models for the dictionary and flashcards

export enum FlashcardStatus {
  New = 'New',
  Learning = 'Learning',
  Mastered = 'Mastered',
}

export interface Definition {
  definition: string;
  example?: string;
}

export interface Meaning {
  partOfSpeech: string;
  definitions: Definition[];
}

export interface WordEntry {
  word: string;
  phonetic?: string;
  audio?: string;
  image?: string;
  meanings: Meaning[];
}

export interface Flashcard {
  id: string;
  word: string;
  phonetic?: string;
  audio?: string;
  image?: string;
  mainDefinition: string;
  example?: string;
  partOfSpeech: string;
  status: FlashcardStatus;
  lastReviewed: number;
  createdAt: number;

  // SM-2 Algorithm Properties
  interval?: number;
  repetition?: number;
  easinessFactor?: number;
  nextReviewDate?: number;
  lastQuality?: number;
}

export type ViewState = 'dashboard' | 'dictionary' | 'flashcards' | 'study' | 'statistics';

// File System Access API Types
export interface FileSystemFileHandle {
  kind: 'file';
  name: string;
  getFile: () => Promise<File>;
  createWritable: () => Promise<FileSystemWritableFileStream>;
}

export interface FileSystemWritableFileStream extends WritableStream {
  write: (data: string) => Promise<void>;
  close: () => Promise<void>;
}

// Cloud Sync Types
export interface CloudConfig {
  pantryId: string;
}

export interface CloudData {
  cards: Flashcard[];
  studyHistory?: Record<string, number>;
  longestStreak?: number;
  /** id → Unix-ms when the card was deleted. Tombstones are pruned after 30 days. */
  deletedCards?: Record<string, number>;
}