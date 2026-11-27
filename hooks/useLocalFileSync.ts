import React, { useState, useEffect, useCallback } from 'react';
import {
  FileSystemFileHandle,
  Flashcard,
  MeaningLanguagePreference,
} from '../types';
import { parseFileContent, saveToLocalFile } from '../services/fileService';
import {
  saveFileHandleToIDB,
  clearFileHandleFromIDB,
} from '../services/idbService';
import {
  trackEvent,
  TRACKING_ACTION,
  TRACKING_CATEGORY,
} from '../services/trackingService';
import { MergeDeckOptions } from '../utils/cardMerge';

interface UseLocalFileSyncParams {
  cards: Flashcard[];
  studyHistory: Record<string, number>;
  studyHistoryRef: React.MutableRefObject<Record<string, number>>;
  setStudyHistory: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  longestStreak: number;
  setLongestStreak: React.Dispatch<React.SetStateAction<number>>;
  deletedCards: Map<string, number>;
  prunedDeletedCards: () => Record<string, number>;
  languagePreference: MeaningLanguagePreference;
  languagePreferenceUpdatedAt: number;
  isDataLoaded: boolean;
  performMerge: (
    incoming: Flashcard[],
    incomingDeletedCards?: Record<string, number>,
    options?: MergeDeckOptions
  ) => void;
  mergeHistoryRecords: (
    ...histories: (Record<string, number> | undefined)[]
  ) => Record<string, number>;
  applyIncomingLanguagePreference: (
    pref?: MeaningLanguagePreference,
    updatedAt?: number
  ) => void;
}

export const useLocalFileSync = ({
  cards,
  studyHistory,
  studyHistoryRef,
  setStudyHistory,
  longestStreak,
  setLongestStreak,
  deletedCards,
  prunedDeletedCards,
  languagePreference,
  languagePreferenceUpdatedAt,
  isDataLoaded,
  performMerge,
  mergeHistoryRecords,
  applyIncomingLanguagePreference,
}: UseLocalFileSyncParams) => {
  const [fileHandle, setFileHandle] = useState<FileSystemFileHandle | null>(null);
  const [pendingHandle, setPendingHandle] = useState<FileSystemFileHandle | null>(null);
  const [isFileSaving, setIsFileSaving] = useState(false);

  // Auto-Save to Local File
  useEffect(() => {
    if (!isDataLoaded || !fileHandle) return;
    const timeoutId = setTimeout(async () => {
      setIsFileSaving(true);
      try {
        await saveToLocalFile(fileHandle, {
          cards,
          studyHistory,
          longestStreak,
          deletedCards: prunedDeletedCards(),
          languagePreference,
          languagePreferenceUpdatedAt,
        });
      } catch (error) {
        console.error('Auto-save file failed:', error);
      } finally {
        setIsFileSaving(false);
      }
    }, 1000);
    return () => clearTimeout(timeoutId);
  }, [
    cards,
    studyHistory,
    longestStreak,
    deletedCards,
    languagePreference,
    languagePreferenceUpdatedAt,
    fileHandle,
    isDataLoaded,
    prunedDeletedCards,
  ]);

  const pickAndConnectFile = useCallback(async (): Promise<boolean> => {
    // @ts-ignore
    if (!window.showOpenFilePicker) {
      alert('Your browser does not support the File System Access API.');
      return false;
    }
    try {
      // @ts-ignore
      const [handle] = await window.showOpenFilePicker({
        types: [
          { description: 'Lumina JSON Data', accept: { 'application/json': ['.json'] } },
          { description: 'CSV Backup', accept: { 'text/csv': ['.csv'] } },
        ],
        multiple: false,
      });
      if (handle) {
        const file = await handle.getFile();
        const text = await file.text();
        const loadedData = parseFileContent(text);
        if (loadedData.languagePreference) {
          applyIncomingLanguagePreference(
            loadedData.languagePreference,
            loadedData.languagePreferenceUpdatedAt
          );
        }
        if (loadedData.cards.length > 0) {
          performMerge(loadedData.cards, loadedData.deletedCards ?? {});
        }
        if (loadedData.studyHistory) {
          const mergedHist = mergeHistoryRecords(studyHistoryRef.current, loadedData.studyHistory);
          studyHistoryRef.current = mergedHist;
          setStudyHistory(mergedHist);
        }
        if (loadedData.longestStreak) {
          setLongestStreak((prev) => Math.max(prev, loadedData.longestStreak!));
        }
        setFileHandle(handle);
        setPendingHandle(null);
        await saveFileHandleToIDB(handle);
        return true;
      }
    } catch (err: any) {
      if (err.name === 'SecurityError' || err.message?.includes('Cross origin')) {
        alert('Direct file syncing is disabled in this preview environment.');
      } else if (err.name !== 'AbortError') {
        alert('Failed to connect to file.');
      }
    }
    return false;
  }, [
    applyIncomingLanguagePreference,
    mergeHistoryRecords,
    performMerge,
    setLongestStreak,
    setStudyHistory,
    studyHistoryRef,
  ]);

  const handleDisconnectFile = useCallback(async () => {
    setFileHandle(null);
    setPendingHandle(null);
    await clearFileHandleFromIDB();
  }, []);

  const handleReGrantPermission = useCallback(async () => {
    if (!pendingHandle) return;
    try {
      // @ts-ignore
      const perm = await pendingHandle.requestPermission({ mode: 'readwrite' });
      if (perm === 'granted') {
        setFileHandle(pendingHandle);
        setPendingHandle(null);
      }
    } catch (e) {
      console.warn('Permission denied for file handle', e);
      setPendingHandle(null);
    }
  }, [pendingHandle]);

  const handleManualFileSave = useCallback(async () => {
    if (!fileHandle) return;
    setIsFileSaving(true);
    try {
      await saveToLocalFile(fileHandle, {
        cards,
        studyHistory,
        longestStreak,
        deletedCards: prunedDeletedCards(),
        languagePreference,
        languagePreferenceUpdatedAt,
      });
      trackEvent(TRACKING_ACTION.MANUAL_SAVE, TRACKING_CATEGORY.DATA);
    } finally {
      setIsFileSaving(false);
    }
  }, [
    cards,
    fileHandle,
    languagePreference,
    languagePreferenceUpdatedAt,
    longestStreak,
    prunedDeletedCards,
    studyHistory,
  ]);

  return {
    fileHandle,
    setFileHandle,
    pendingHandle,
    setPendingHandle,
    isFileSaving,
    setIsFileSaving,
    handleConnectFile: pickAndConnectFile,
    handleChangeFile: pickAndConnectFile,
    handleDisconnectFile,
    handleReGrantPermission,
    handleManualFileSave,
  };
};
