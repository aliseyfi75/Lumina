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
  meanings: Meaning[];
}

export interface Flashcard {
  id: string;
  word: string;
  phonetic?: string;
  mainDefinition: string;
  example?: string;
  partOfSpeech: string;
  status: FlashcardStatus;
  lastReviewed: number;
  createdAt: number;
}

export type ViewState = 'dictionary' | 'flashcards' | 'study';

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