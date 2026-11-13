// Data models for the dictionary and flashcards

export enum FlashcardStatus {
  New = 'New',
  Learning = 'Learning',
  Mastered = 'Mastered',
}

export type SupportedLanguageCode = 'en' | 'fa';
export type TranslationLanguageCode = Exclude<SupportedLanguageCode, 'en'>;
export type MeaningLanguagePreference = 'en' | 'fa' | 'both';
export type LocalizedTranslations = Partial<Record<TranslationLanguageCode, string>>;

export interface Definition {
  definition: string;
  example?: string;
  synonyms?: string[];
  antonyms?: string[];
  tags?: string[];
  translations?: LocalizedTranslations;
}

export interface Meaning {
  partOfSpeech: string;
  definitions: Definition[];
  synonyms?: string[];
  antonyms?: string[];
}

export interface WordEntry {
  word: string;
  phonetic?: string;
  audio?: string;
  image?: string;
  origin?: string;
  meanings: Meaning[];
  wordTranslations?: Partial<Record<TranslationLanguageCode, string[]>>;
}

export type WordComplexityLevel = 'beginner' | 'intermediate' | 'advanced';

export interface Flashcard {
  id: string;
  word: string;
  phonetic?: string;
  audio?: string;
  image?: string;
  mainDefinition: string;
  translations?: LocalizedTranslations;
  example?: string;
  partOfSpeech: string;
  tags?: string[];
  synonyms?: string[];
  antonyms?: string[];
  status: FlashcardStatus;
  lastReviewed: number;
  createdAt: number;

  // Book / Word Complexity Metadata
  complexityLevel?: WordComplexityLevel;
  complexityScore?: number;
  bookChapter?: string;

  // SM-2 Algorithm Properties
  interval?: number;
  repetition?: number;
  easinessFactor?: number;
  nextReviewDate?: number;
  lastQuality?: number;
  updatedAt?: number;
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
export type CloudProvider = 'gist' | 'pantry';

export interface CloudConfig {
  provider?: CloudProvider;
  pantryId: string;
  gistToken?: string;
  gistId?: string;
}

export interface CloudData {
  cards: Flashcard[];
  studyHistory?: Record<string, number>;
  longestStreak?: number;
  /** id → Unix-ms when the card was deleted. Tombstones are pruned after 30 days. */
  deletedCards?: Record<string, number>;
  /** User's selected translation display preference ('en' | 'fa' | 'both') */
  languagePreference?: MeaningLanguagePreference;
  /** Timestamp when languagePreference was last changed, used for conflict-free cloud merge */
  languagePreferenceUpdatedAt?: number;
  /** Persisted Pantry connection config in IndexedDB so refresh never loses connection */
  cloudConfig?: CloudConfig | null;
  chunkCount?: number;
  basketExists?: boolean;
  lastAccessedAt?: number;
}