import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Routes, Route, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { Flashcard, WordEntry, FlashcardStatus, FileSystemFileHandle, CloudConfig } from './types';
import { Dashboard } from './components/Dashboard';
import { Dictionary } from './components/Dictionary';
import { Flashcards } from './components/Flashcards';
import { StudySession } from './components/StudySession';
import { Statistics } from './components/Statistics';
import { DataManagerModal } from './components/DataManagerModal';
import { AnkiImportModal } from './components/AnkiImportModal';
import { PwaInstallBanner } from './components/PwaInstallBanner';
import { generateJSON, parseFileContent, downloadJSON, saveToLocalFile } from './services/fileService';
import { getDetails, getDeck, updateDeck, keepAlivePantry, getKnownChunkCount, CloudSyncProgress } from './services/pantryService';
import { saveFileHandleToIDB, loadFileHandleFromIDB, clearFileHandleFromIDB, saveAppDataToIDB, loadAppDataFromIDB, requestPersistentStorage, checkPersistentStorage, getStorageEstimate } from './services/idbService';
import { initializeTracking, trackEvent, setTrackingUserId, trackPageView, PAGE_TITLES, TRACKING_CATEGORY, TRACKING_ACTION } from './services/trackingService';
import { getLocalDateString, calculateCurrentStreak, getDueCards } from './utils/studyUtils';
import { Book, Layers, Database, Save, Cloud, BarChart2, Home, Sun, Moon, RefreshCw } from 'lucide-react';
import Confetti from 'react-confetti';
import { useWindowSize } from 'react-use';
import { SessionConfigModal, SessionMode } from './components/SessionConfigModal';
import { BookExtractedWord } from './services/bookService';

const LOCAL_STORAGE_KEY = 'lumina_cards_v1';
const CLOUD_CONFIG_KEY = 'lumina_cloud_config';
const THEME_STORAGE_KEY = 'lumina_theme';

// ── RouteTracker ────────────────────────────────────────────────────────────
// Fires a GA page_view event every time the hash route changes.
const RouteTracker: React.FC = () => {
  const location = useLocation();

  useEffect(() => {
    const title = PAGE_TITLES[location.pathname] ?? 'Lumina';
    document.title = `Lumina – ${title}`;
    trackPageView(location.pathname, title);
  }, [location.pathname]);

  return null;
};

// ── Main App ────────────────────────────────────────────────────────────────
const App: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const [cards, setCards] = useState<Flashcard[]>([]);
  // Tombstone map: id → Unix-ms when deleted. Entries are pruned after 30 days.
  const [deletedCards, setDeletedCards] = useState<Map<string, number>>(new Map());
  // Ref mirrors the map so performMerge can always read current tombstones
  // without needing the map in its useCallback deps (which would re-trigger initData).
  const deletedCardsRef = useRef<Map<string, number>>(new Map());
  const [studyHistory, setStudyHistory] = useState<Record<string, number>>({});
  const [longestStreak, setLongestStreak] = useState(0);

  // Dark Mode — respect persisted user preference or follow device theme
  const [isDark, setIsDark] = useState(() => {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    if (savedTheme === 'dark') return true;
    if (savedTheme === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  // Keep in sync whenever the OS switches light/dark (unless user set a manual override)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      if (!localStorage.getItem(THEME_STORAGE_KEY)) {
        setIsDark(e.matches);
      }
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const handleToggleDark = () => {
    setIsDark(prev => {
      const next = !prev;
      localStorage.setItem(THEME_STORAGE_KEY, next ? 'dark' : 'light');
      return next;
    });
  };

  // Keep ref in sync so performMerge always sees the latest tombstone map
  useEffect(() => {
    deletedCardsRef.current = deletedCards;
  }, [deletedCards]);

  const [isDataModalOpen, setIsDataModalOpen] = useState(false);
  const [ankiImportFile, setAnkiImportFile] = useState<File | null>(null);

  // File System State
  const [fileHandle, setFileHandle] = useState<FileSystemFileHandle | null>(null);
  const [pendingHandle, setPendingHandle] = useState<FileSystemFileHandle | null>(null); // needs permission re-grant
  const [isFileSaving, setIsFileSaving] = useState(false);

  // Cloud Sync State
  const [cloudConfig, setCloudConfig] = useState<CloudConfig | null>(null);
  const [isCloudSaving, setIsCloudSaving] = useState(false);
  const [isSyncingOffline, setIsSyncingOffline] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCloudSync, setPendingCloudSync] = useState(false);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const skipNextCloudAutoSaveRef = useRef(false);
  const hasInitializedCloudRef = useRef(false);
  const isMigratingCloudRef = useRef(false);
  const lastKeepAliveRef = useRef<number>(0);

  // Storage metadata
  const [persistenceStatus, setPersistenceStatus] = useState<'granted' | 'denied' | 'prompt' | 'unsupported'>('prompt');
  const [storageEstimate, setStorageEstimate] = useState<{ usage: number; quota: number } | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  const [isSessionConfigOpen, setIsSessionConfigOpen] = useState(false);
  const [sessionInitialTag, setSessionInitialTag] = useState<string | undefined>(undefined);

  // Confetti State
  const { width, height } = useWindowSize();
  const [showConfetti, setShowConfetti] = useState(false);
  const [prevMasteredCount, setPrevMasteredCount] = useState(0);

  // Prune tombstones older than 30 days and return a plain Record for serialisation
  const TOMBSTONE_TTL = 30 * 24 * 60 * 60 * 1000;
  const prunedDeletedCards = (): Record<string, number> => {
    const cutoff = Date.now() - TOMBSTONE_TTL;
    const result: Record<string, number> = {};
    deletedCardsRef.current.forEach((deletedAt, id) => {
      if (deletedAt >= cutoff) result[id] = deletedAt;
    });
    return result;
  };

  // Pure helper: merge two card arrays while honoring tombstones (unless ignoreTombstones is set)
  const mergeCardArrays = (
    baseCards: Flashcard[],
    incoming: Flashcard[],
    tombstones: Record<string, number>,
    options?: { ignoreTombstones?: boolean }
  ): Flashcard[] => {
    const ignoreTombstones = options?.ignoreTombstones ?? false;
    const liveMap = deletedCardsRef.current;
    const isDeleted = (card: Flashcard) => {
      if (ignoreTombstones) return false;
      const deletedAt = Math.max(liveMap.get(card.id) ?? 0, tombstones[card.id] ?? 0);
      if (!deletedAt) return false;
      const cardTs = Math.max(card.updatedAt ?? 0, card.lastReviewed ?? 0, card.createdAt ?? 0);
      return deletedAt >= cardTs;
    };

    const statusRank: Record<FlashcardStatus, number> = {
      [FlashcardStatus.New]: 0,
      [FlashcardStatus.Learning]: 1,
      [FlashcardStatus.Mastered]: 2,
    };

    const mergeTwoCards = (existing: Flashcard, inc: Flashcard, targetId: string): Flashcard => {
      const incTs = inc.updatedAt ?? inc.lastReviewed ?? 0;
      const extTs = existing.updatedAt ?? existing.lastReviewed ?? 0;
      const incProgress = (inc.repetition ?? 0) * 10 + (statusRank[inc.status] ?? 0);
      const extProgress = (existing.repetition ?? 0) * 10 + (statusRank[existing.status] ?? 0);

      const useIncoming =
        incTs > extTs || (incTs === extTs && incProgress > extProgress);
      const winner = useIncoming ? inc : existing;
      const fallback = useIncoming ? existing : inc;

      return {
        ...fallback,
        ...winner,
        id: targetId,
        word: winner.word || fallback.word,
        mainDefinition:
          winner.mainDefinition && winner.mainDefinition !== '—'
            ? winner.mainDefinition
            : fallback.mainDefinition || winner.mainDefinition,
        partOfSpeech: winner.partOfSpeech || fallback.partOfSpeech || '',
        phonetic: winner.phonetic || fallback.phonetic,
        audio: winner.audio || fallback.audio,
        image: winner.image || fallback.image,
        example: winner.example || fallback.example,
        tags:
          winner.tags && winner.tags.length > 0
            ? winner.tags
            : fallback.tags && fallback.tags.length > 0
              ? fallback.tags
              : undefined,
        synonyms:
          winner.synonyms && winner.synonyms.length > 0
            ? winner.synonyms
            : fallback.synonyms && fallback.synonyms.length > 0
              ? fallback.synonyms
              : undefined,
        antonyms:
          winner.antonyms && winner.antonyms.length > 0
            ? winner.antonyms
            : fallback.antonyms && fallback.antonyms.length > 0
              ? fallback.antonyms
              : undefined,
        createdAt: Math.min(
          existing.createdAt || Date.now(),
          inc.createdAt || Date.now()
        ),
        lastReviewed: Math.max(existing.lastReviewed || 0, inc.lastReviewed || 0),
        updatedAt: Math.max(
          incTs,
          extTs,
          existing.createdAt || 0,
          inc.createdAt || 0
        ),
      };
    };

    const cardMap = new Map<string, Flashcard>();
    baseCards.forEach(c => {
      if (!isDeleted(c)) cardMap.set(c.id, c);
    });

    incoming
      .filter(c => !isDeleted(c))
      .forEach(c => {
        const normWord = c.word.trim().toLowerCase();
        const normDef = c.mainDefinition.trim().toLowerCase();

        const duplicateId = cardMap.has(c.id)
          ? c.id
          : Array.from(cardMap.keys()).find(key => {
              const existing = cardMap.get(key)!;
              return (
                existing.word.trim().toLowerCase() === normWord &&
                existing.mainDefinition.trim().toLowerCase() === normDef
              );
            });

        if (duplicateId) {
          const existing = cardMap.get(duplicateId)!;
          cardMap.set(duplicateId, mergeTwoCards(existing, c, duplicateId));
        } else {
          cardMap.set(c.id, c);
        }
      });

    const now = Date.now();
    return Array.from(cardMap.values()).map(c => {
      if (c.status === FlashcardStatus.Learning && c.nextReviewDate && c.nextReviewDate < now) {
        return { ...c, nextReviewDate: now };
      }
      return c;
    }).sort((a, b) => b.createdAt - a.createdAt);
  };

  const mergeHistoryRecords = (
    ...histories: (Record<string, number> | undefined)[]
  ): Record<string, number> => {
    const merged: Record<string, number> = {};
    for (const h of histories) {
      if (!h) continue;
      for (const [date, count] of Object.entries(h)) {
        merged[date] = Math.max(merged[date] || 0, count);
      }
    }
    return merged;
  };

  // Helper: Merge incoming cards with existing state, honouring the tombstone map
  const performMerge = useCallback((
    incoming: Flashcard[],
    incomingDeletedCards: Record<string, number> = {}
  ) => {
    // Union the incoming tombstones (pruning expired ones first)
    setDeletedCards(prev => {
      const cutoff = Date.now() - TOMBSTONE_TTL;
      const merged = new Map(prev);
      Object.entries(incomingDeletedCards).forEach(([id, deletedAt]) => {
        if (deletedAt >= cutoff) merged.set(id, deletedAt);
      });
      return merged;
    });

    setCards(prev => mergeCardArrays(prev, incoming, incomingDeletedCards));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — reads tombstones via ref, not closure

  // 1. Initial Load: IDB -> localStorage migration -> Fallback CSV DB -> Cloud -> Restore file handle
  useEffect(() => {
    const initData = async () => {
      let initialCards: Flashcard[] = [];
      let initialStudyHistory: Record<string, number> = {};
      let initialLongestStreak = 0;
      let initialDeletedCards: Record<string, number> = {};
      let hasExistingUserStore = false;

      // Step A: Try IndexedDB first (primary store)
      const idbData = await loadAppDataFromIDB();
      if (
        idbData &&
        Array.isArray(idbData.cards) &&
        (idbData.cards.length > 0 ||
          Object.keys(idbData.deletedCards ?? {}).length > 0 ||
          Object.keys(idbData.studyHistory ?? {}).length > 0)
      ) {
        initialCards = idbData.cards;
        initialStudyHistory = idbData.studyHistory ?? {};
        initialLongestStreak = idbData.longestStreak ?? 0;
        initialDeletedCards = idbData.deletedCards ?? {};
        hasExistingUserStore = true;
      } else {
        // Step A-fallback: migrate from localStorage (existing users)
        const savedCards = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (savedCards) {
          try {
            const parsed = JSON.parse(savedCards);
            if (Array.isArray(parsed)) {
              initialCards = parsed;
              hasExistingUserStore = true;
              // Migrate immediately so next load hits IDB
              try {
                await saveAppDataToIDB({ cards: parsed, studyHistory: {}, longestStreak: 0, deletedCards: {} });
                localStorage.removeItem(LOCAL_STORAGE_KEY);
              } catch { /* migration best-effort */ }
            }
          } catch (e) {
            console.error('Failed to parse saved cards from localStorage', e);
          }
        }
      }

      // Restore tombstones into state early so performMerge honours them
      if (Object.keys(initialDeletedCards).length > 0) {
        const cutoff = Date.now() - TOMBSTONE_TTL;
        const map = new Map<string, number>();
        Object.entries(initialDeletedCards).forEach(([id, ts]) => { if (ts >= cutoff) map.set(id, ts); });
        setDeletedCards(map);
      }

      if (initialStudyHistory && Object.keys(initialStudyHistory).length > 0) {
        setStudyHistory(initialStudyHistory);
      }
      if (initialLongestStreak > 0) {
        setLongestStreak(initialLongestStreak);
      }

      // Step B: Load Default JSON only on a brand-new install (not when user intentionally deleted all cards)
      if (initialCards.length === 0 && !hasExistingUserStore) {
        try {
          const response = await fetch('./database/data.json');
          if (response.ok) {
            const text = await response.text();
            const defaultData = parseFileContent(text);
            if (defaultData.cards.length > 0) {
              initialCards = defaultData.cards;
            }
            if (Object.keys(initialStudyHistory).length === 0 && defaultData.studyHistory) {
              setStudyHistory(defaultData.studyHistory);
            }
            if (initialLongestStreak === 0 && defaultData.longestStreak) {
              setLongestStreak(defaultData.longestStreak);
            }
          }
        } catch (e) {
          console.warn('No default database found.', e);
        }
      }

      const now = Date.now();
      initialCards = initialCards.map(c => {
        if (c.status === FlashcardStatus.Learning && c.nextReviewDate && c.nextReviewDate < now) {
          return { ...c, nextReviewDate: now };
        }
        return c;
      });

      setCards(initialCards);

      // Step C: Check Cloud Config, Merge, and Send Keep-Alive Ping so Pantry never expires
      const savedCloudConfig = localStorage.getItem(CLOUD_CONFIG_KEY);
      if (savedCloudConfig && !hasInitializedCloudRef.current) {
        hasInitializedCloudRef.current = true;
        try {
          const config = JSON.parse(savedCloudConfig);
          if (config.pantryId) {
            const cloudData = await getDeck(config.pantryId);

            if (cloudData.cards && cloudData.cards.length > 0) {
              performMerge(cloudData.cards, cloudData.deletedCards ?? {});
            }

            if (cloudData.studyHistory) {
              setStudyHistory(prev => {
                const merged = { ...prev };
                for (const [date, count] of Object.entries(cloudData.studyHistory!)) {
                  merged[date] = Math.max(merged[date] || 0, count);
                }
                return merged;
              });
            }

            if (cloudData.longestStreak) {
              setLongestStreak(prev => Math.max(prev, cloudData.longestStreak!));
            }

            skipNextCloudAutoSaveRef.current = true;
            setCloudConfig(config);
            initializeTracking(config.pantryId);

            // Always send a keep-alive write to Pantry when the user opens the app
            // so the Pantry ID and baskets refresh their 30-day TTL even if no card status changes.
            if (navigator.onLine) {
              lastKeepAliveRef.current = Date.now();
              void keepAlivePantry(config.pantryId, cloudData.chunkCount ?? 1);
            }
          } else {
            initializeTracking();
          }
        } catch (e) {
          console.error('Failed to load cloud backup on init', e);
          if (savedCloudConfig) {
            skipNextCloudAutoSaveRef.current = true;
            setCloudConfig(JSON.parse(savedCloudConfig));
          }
          initializeTracking();
        }
      } else if (!savedCloudConfig) {
        initializeTracking();
      }

      // Step D: Restore FileSystemFileHandle from IndexedDB
      try {
        const storedHandle = await loadFileHandleFromIDB();
        if (storedHandle) {
          // @ts-ignore – queryPermission is on FileSystemHandle
          const perm = await storedHandle.queryPermission({ mode: 'readwrite' });
          if (perm === 'granted') {
            setFileHandle(storedHandle);
          } else {
            setPendingHandle(storedHandle);
          }
        }
      } catch (e) {
        console.warn('Could not restore file handle from IDB', e);
      }

      // Step E: Request persistent storage + refresh usage estimate
      try {
        const already = await checkPersistentStorage();
        if (already) {
          setPersistenceStatus('granted');
        } else {
          const granted = await requestPersistentStorage();
          setPersistenceStatus(granted ? 'granted' : 'denied');
        }
      } catch {
        setPersistenceStatus('unsupported');
      }

      const est = await getStorageEstimate();
      if (est) setStorageEstimate(est);
      setIsDataLoaded(true);
    };

    initData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [performMerge]);

  // 2. Persist to IndexedDB (primary store) and keep localStorage in sync for safety
  useEffect(() => {
    if (!isDataLoaded) return; // don't overwrite IDB before initial load finishes
    const data = { cards, studyHistory, longestStreak, deletedCards: prunedDeletedCards() };
    saveAppDataToIDB(data)
      .then(() => {
        setLastSavedAt(Date.now());
        // Refresh usage estimate periodically (cheap call)
        getStorageEstimate().then(est => { if (est) setStorageEstimate(est); });
      })
      .catch(console.error);
    // Keep localStorage as a secondary safety net (small overhead)
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(cards));
  }, [cards, studyHistory, longestStreak, deletedCards, isDataLoaded]);

  // Track online / offline status
  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // 3. Auto-Save to Local File
  useEffect(() => {
    if (!isDataLoaded || !fileHandle) return;
    const timeoutId = setTimeout(async () => {
      setIsFileSaving(true);
      try {
        await saveToLocalFile(fileHandle, { cards, studyHistory, longestStreak, deletedCards: prunedDeletedCards() });
      } catch (error) {
        console.error("Auto-save file failed:", error);
      } finally {
        setIsFileSaving(false);
      }
    }, 1000);
    return () => clearTimeout(timeoutId);
  }, [cards, studyHistory, longestStreak, deletedCards, fileHandle, isDataLoaded]);

  // 4. Auto-Save to Cloud
  useEffect(() => {
    if (!isDataLoaded || !cloudConfig || isMigratingCloudRef.current) return;

    if (skipNextCloudAutoSaveRef.current) {
      skipNextCloudAutoSaveRef.current = false;
      return;
    }

    if (!isOnline) {
      // Mark dirty so we sync the moment connectivity returns
      setPendingCloudSync(true);
      return;
    }

    const timeoutId = setTimeout(async () => {
      if (isMigratingCloudRef.current) return;
      setIsCloudSaving(true);
      try {
        await updateDeck(cloudConfig.pantryId, { cards, studyHistory, longestStreak, deletedCards: prunedDeletedCards() });
        lastKeepAliveRef.current = Date.now();
        setPendingCloudSync(false);
      } catch (error) {
        console.error('Auto-save cloud failed:', error);
        if (!navigator.onLine) {
          setPendingCloudSync(true); // will retry when online
        }
      } finally {
        setIsCloudSaving(false);
      }
    }, 2000);
    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, studyHistory, longestStreak, deletedCards, cloudConfig, isDataLoaded]);

  // 4b. Keep Pantry alive when user re-opens / focuses an already-open tab or PWA window
  useEffect(() => {
    if (!cloudConfig?.pantryId) return;
    const KEEP_ALIVE_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine || isMigratingCloudRef.current) {
        return;
      }
      const now = Date.now();
      if (now - lastKeepAliveRef.current >= KEEP_ALIVE_INTERVAL_MS) {
        lastKeepAliveRef.current = now;
        void keepAlivePantry(cloudConfig.pantryId, getKnownChunkCount(cloudConfig.pantryId));
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
    };
  }, [cloudConfig]);

  // 5. Flush pending sync when coming back online (or cloud config is restored)
  useEffect(() => {
    if (!isDataLoaded || !isOnline || !cloudConfig || !pendingCloudSync) return;
    let cancelled = false;
    const flush = async () => {
      setIsSyncingOffline(true);
      try {
        await updateDeck(cloudConfig.pantryId, { cards, studyHistory, longestStreak, deletedCards: prunedDeletedCards() });
      } catch (e) {
        console.error('Pending sync flush failed:', e);
      } finally {
        if (!cancelled) {
          setPendingCloudSync(false);
          setIsSyncingOffline(false);
        }
      }
    };
    flush();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, cloudConfig]);

  // --- File Handlers ---

  const pickAndConnectFile = async (): Promise<boolean> => {
    // @ts-ignore
    if (!window.showOpenFilePicker) {
      alert("Your browser does not support the File System Access API.");
      return false;
    }
    try {
      // @ts-ignore
      const [handle] = await window.showOpenFilePicker({
        types: [
          { description: 'Lumina JSON Data', accept: { 'application/json': ['.json'] } },
          { description: 'CSV Backup', accept: { 'text/csv': ['.csv'] } }
        ],
        multiple: false
      });
      if (handle) {
        const file = await handle.getFile();
        const text = await file.text();
        const loadedData = parseFileContent(text);
        if (loadedData.cards.length > 0) {
          performMerge(loadedData.cards, loadedData.deletedCards ?? {});
        }
        if (loadedData.studyHistory) setStudyHistory(prev => ({ ...prev, ...loadedData.studyHistory }));
        if (loadedData.longestStreak) setLongestStreak(prev => Math.max(prev, loadedData.longestStreak!));
        setFileHandle(handle);
        setPendingHandle(null);
        await saveFileHandleToIDB(handle);
        return true;
      }
    } catch (err: any) {
      if (err.name === 'SecurityError' || err.message?.includes('Cross origin')) {
        alert("Direct file syncing is disabled in this preview environment.");
      } else if (err.name !== 'AbortError') {
        alert("Failed to connect to file.");
      }
    }
    return false;
  };

  const handleConnectFile = () => pickAndConnectFile();

  // "Change File": same as connect but replaces an existing handle
  const handleChangeFile = () => pickAndConnectFile();

  // Disconnect: remove from IDB so it won't be restored next time
  const handleDisconnectFile = async () => {
    setFileHandle(null);
    setPendingHandle(null);
    await clearFileHandleFromIDB();
  };

  // Re-grant permission for a handle that was restored from IDB
  const handleReGrantPermission = async () => {
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
  };

  const handleManualFileSave = async () => {
    if (!fileHandle) return;
    setIsFileSaving(true);
    await saveToLocalFile(fileHandle, { cards, studyHistory, longestStreak, deletedCards: prunedDeletedCards() });
    setIsFileSaving(false);
    trackEvent(TRACKING_ACTION.MANUAL_SAVE, TRACKING_CATEGORY.DATA);
  };

  const handleExportData = () => {
    const jsonContent = generateJSON({ cards, studyHistory, longestStreak, deletedCards: prunedDeletedCards() });
    const date = new Date().toISOString().split('T')[0];
    downloadJSON(jsonContent, `lumina_backup_${date}.json`);
    trackEvent(TRACKING_ACTION.EXPORT_CSV, TRACKING_CATEGORY.DATA);
  };

  const handleImportData = async (file: File) => {
    const text = await file.text();
    const importedData = parseFileContent(text);
    if (importedData.cards.length === 0) throw new Error("No valid data found");
    performMerge(importedData.cards, importedData.deletedCards ?? {});
    if (importedData.studyHistory) setStudyHistory(prev => ({ ...prev, ...importedData.studyHistory }));
    if (importedData.longestStreak) setLongestStreak(prev => Math.max(prev, importedData.longestStreak!));
    trackEvent(TRACKING_ACTION.IMPORT_CSV, TRACKING_CATEGORY.DATA, 'card_count', importedData.cards.length);
  };

  const handleAnkiFileSelected = (file: File) => {
    setIsDataModalOpen(false);
    setAnkiImportFile(file);
  };

  const handleAnkiImport = (cards: Flashcard[]) => {
    performMerge(cards);
    setAnkiImportFile(null);
    trackEvent(TRACKING_ACTION.IMPORT_CSV, TRACKING_CATEGORY.DATA, 'anki_card_count', cards.length);
  };

  // --- Cloud Handlers ---

  const handleMigrateCloud = async (
    newPantryId: string,
    oldPantryId?: string,
    onProgress?: (progress: CloudSyncProgress) => void
  ): Promise<{ cardCount: number; localCount: number; cloudCount: number; historyDays: number }> => {
    const cleanNewId = newPantryId.trim();
    const cleanOldId = (oldPantryId ?? '').trim();

    isMigratingCloudRef.current = true;
    try {
      // 1. Validate that the new Pantry ID exists on Pantry's servers
      onProgress?.({ percent: 12, step: 'Verifying Pantry ID on server...' });
      const details = await getDetails(cleanNewId);

      // 2. Best-effort pull from an explicitly specified old Pantry ID
      // Skip if cleanOldId is already the active cloudConfig.pantryId (its data is already in local state)
      let oldCloudData = {
        cards: [] as Flashcard[],
        studyHistory: {} as Record<string, number>,
        longestStreak: 0,
        deletedCards: {} as Record<string, number>,
      };
      if (
        cleanOldId &&
        cleanOldId !== cleanNewId &&
        (cleanOldId !== cloudConfig?.pantryId || cards.length === 0)
      ) {
        onProgress?.({ percent: 24, step: 'Fetching flashcards from previous Pantry ID...' });
        try {
          const fetchedOld = await getDeck(cleanOldId, undefined, {
            retries: 0,
            onProgress: ({ currentChunk, totalChunks }) => {
              const pct = Math.min(36, 24 + Math.round((currentChunk / Math.max(1, totalChunks)) * 12));
              onProgress?.({
                percent: pct,
                step:
                  totalChunks > 1
                    ? `Loading previous Pantry chunk ${currentChunk} of ${totalChunks}...`
                    : 'Fetching flashcards from previous Pantry ID...',
              });
            },
          });
          oldCloudData = {
            cards: fetchedOld.cards ?? [],
            studyHistory: fetchedOld.studyHistory ?? {},
            longestStreak: fetchedOld.longestStreak ?? 0,
            deletedCards: fetchedOld.deletedCards ?? {},
          };
        } catch {
          // Old Pantry ID may have expired; local state already holds cached history
        }
      }

      // 3. Strictly pull any existing data on the target Pantry ID so we never lose cards already in Pantry
      onProgress?.({ percent: 40, step: 'Checking target Pantry for existing flashcards...' });
      const newCloudData = await getDeck(cleanNewId, details.baskets, {
        strict: true,
        onProgress: ({ currentChunk, totalChunks }) => {
          const pct = Math.min(58, 40 + Math.round((currentChunk / Math.max(1, totalChunks)) * 18));
          onProgress?.({
            percent: pct,
            step:
              totalChunks > 1
                ? `Loading cloud chunk ${currentChunk} of ${totalChunks}...`
                : 'Loading existing flashcards from Pantry...',
          });
        },
      });

      // 4. Merge cards across local + old Pantry + target Pantry WITHOUT dropping active cards via tombstones
      onProgress?.({ percent: 64, step: 'Merging local and cloud flashcards & study history...' });
      const afterOldCards = mergeCardArrays(cards, oldCloudData.cards, {}, { ignoreTombstones: true });
      const mergedCards = mergeCardArrays(
        afterOldCards,
        newCloudData.cards ?? [],
        {},
        { ignoreTombstones: true }
      );
      const mergedHistory = mergeHistoryRecords(
        studyHistory,
        oldCloudData.studyHistory,
        newCloudData.studyHistory
      );
      const mergedStreak = Math.max(
        longestStreak,
        oldCloudData.longestStreak || 0,
        newCloudData.longestStreak || 0,
        calculateCurrentStreak(mergedHistory)
      );

      // 5. Merge tombstones, excluding any card ID that is present in our merged active deck
      const activeIds = new Set(mergedCards.map(c => c.id));
      const cutoff = Date.now() - TOMBSTONE_TTL;
      const mergedDeletedRecord: Record<string, number> = {};
      for (const src of [
        prunedDeletedCards(),
        oldCloudData.deletedCards,
        newCloudData.deletedCards ?? {},
      ]) {
        for (const [id, deletedAt] of Object.entries(src)) {
          if (deletedAt >= cutoff && !activeIds.has(id)) {
            mergedDeletedRecord[id] = Math.max(mergedDeletedRecord[id] || 0, deletedAt);
          }
        }
      }

      // 6. Push complete merged dataset to the target Pantry ID immediately
      onProgress?.({ percent: 72, step: `Uploading ${mergedCards.length} flashcards to Pantry...` });
      await updateDeck(
        cleanNewId,
        {
          cards: mergedCards,
          studyHistory: mergedHistory,
          longestStreak: mergedStreak,
          deletedCards: mergedDeletedRecord,
        },
        {
          onProgress: ({ currentChunk, totalChunks }) => {
            const pct = Math.min(95, 72 + Math.round(((currentChunk - 0.3) / Math.max(1, totalChunks)) * 23));
            onProgress?.({
              percent: pct,
              step:
                totalChunks > 1
                  ? `Uploading deck chunk ${currentChunk} of ${totalChunks} to Pantry...`
                  : `Uploading ${mergedCards.length} flashcards to Pantry...`,
            });
          },
        }
      );

      const localCount = cards.length;
      const cloudCount = (newCloudData.cards?.length ?? 0) + (oldCloudData.cards?.length ?? 0);

      // 7. Update local state & persistence
      onProgress?.({ percent: 100, step: 'Sync complete!' });
      setDeletedCards(new Map(Object.entries(mergedDeletedRecord)));
      setCards(mergedCards);
      setStudyHistory(mergedHistory);
      setLongestStreak(mergedStreak);
      setPendingCloudSync(false);
      lastKeepAliveRef.current = Date.now();

      skipNextCloudAutoSaveRef.current = true;
      const config = { pantryId: cleanNewId };
      setCloudConfig(config);
      localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify(config));
      setTrackingUserId(cleanNewId);
      trackEvent(TRACKING_ACTION.CONNECT_CLOUD, TRACKING_CATEGORY.CLOUD);

      if (fileHandle) {
        saveToLocalFile(fileHandle, {
          cards: mergedCards,
          studyHistory: mergedHistory,
          longestStreak: mergedStreak,
          deletedCards: mergedDeletedRecord,
        }).catch(() => {});
      }

      return {
        cardCount: mergedCards.length,
        localCount,
        cloudCount,
        historyDays: Object.keys(mergedHistory).length,
      };
    } finally {
      isMigratingCloudRef.current = false;
    }
  };

  const handleConnectCloud = async (
    pantryId: string,
    onProgress?: (progress: CloudSyncProgress) => void
  ) => {
    await handleMigrateCloud(pantryId, undefined, onProgress);
  };

  const handleDisconnectCloud = () => {
    setCloudConfig(null);
    setPendingCloudSync(false);
    setIsCloudSaving(false);
    setIsSyncingOffline(false);
    localStorage.removeItem(CLOUD_CONFIG_KEY);
    trackEvent(TRACKING_ACTION.DISCONNECT_CLOUD, TRACKING_CATEGORY.CLOUD);
  };

  const handleRequestPersistence = async (): Promise<boolean> => {
    try {
      const granted = await requestPersistentStorage();
      setPersistenceStatus(granted ? 'granted' : 'denied');
      return granted;
    } catch {
      setPersistenceStatus('unsupported');
      return false;
    }
  };

  const handleCloudPull = async () => {
    if (!cloudConfig) return;
    const cloudData = await getDeck(cloudConfig.pantryId, undefined, { strict: true });
    if (cloudData.cards && cloudData.cards.length > 0) {
      performMerge(cloudData.cards, cloudData.deletedCards ?? {});
    }
    if (cloudData.studyHistory) {
      setStudyHistory(prev => mergeHistoryRecords(prev, cloudData.studyHistory));
    }
    if (cloudData.longestStreak) setLongestStreak(prev => Math.max(prev, cloudData.longestStreak!));
    trackEvent(TRACKING_ACTION.CLOUD_PULL, TRACKING_CATEGORY.CLOUD);
    // Immediately flush to local file so both are in sync
    if (fileHandle) {
      try {
        await saveToLocalFile(fileHandle, { cards, studyHistory, longestStreak, deletedCards: prunedDeletedCards() });
      } catch (e) {
        console.warn('Could not flush cloud pull to local file', e);
      }
    }
  };

  const handleCloudPush = async () => {
    if (!cloudConfig) return;
    await updateDeck(cloudConfig.pantryId, { cards, studyHistory, longestStreak, deletedCards: prunedDeletedCards() });
    setPendingCloudSync(false);
    trackEvent(TRACKING_ACTION.CLOUD_PUSH, TRACKING_CATEGORY.CLOUD);
  };

  // --- App Logic ---

  const handleAddCard = (entry: WordEntry, definition: string, example: string, partOfSpeech: string, tags?: string[]) => {
    const matchingMeaning = entry.meanings?.find(m => m.partOfSpeech === partOfSpeech) || entry.meanings?.[0];
    const synonyms = matchingMeaning?.synonyms?.slice(0, 6);
    const antonyms = matchingMeaning?.antonyms?.slice(0, 6);
    const cleanedTags = tags
      ? Array.from(new Set(tags.map(t => t.trim()).filter(Boolean)))
      : [];
    const newCard: Flashcard = {
      id: crypto.randomUUID(),
      word: entry.word,
      phonetic: entry.phonetic,
      audio: entry.audio,
      image: entry.image,
      mainDefinition: definition,
      example: example,
      partOfSpeech: partOfSpeech,
      synonyms: synonyms && synonyms.length > 0 ? synonyms : undefined,
      antonyms: antonyms && antonyms.length > 0 ? antonyms : undefined,
      tags: cleanedTags.length > 0 ? cleanedTags : undefined,
      status: FlashcardStatus.New,
      lastReviewed: 0,
      createdAt: Date.now(),
      repetition: 0,
      nextReviewDate: Date.now(),
      updatedAt: Date.now(),
    };
    setCards(prev => [newCard, ...prev]);
    recordActivity();
    trackEvent(TRACKING_ACTION.ADD_CARD, TRACKING_CATEGORY.FLASHCARDS, entry.word);
  };

  const recordActivity = () => {
    const today = getLocalDateString(new Date());
    setStudyHistory(prev => {
      const updatedHistory = {
        ...prev,
        [today]: (prev[today] || 0) + 1
      };
      const newCurrentStreak = calculateCurrentStreak(updatedHistory);
      setLongestStreak(prevStreak => Math.max(prevStreak, newCurrentStreak));
      return updatedHistory;
    });
  };

  const handleSessionComplete = () => {
    recordActivity();
  };

  const handleStartStudySession = (initialTag?: string) => {
    setSessionInitialTag(initialTag);
    setIsSessionConfigOpen(true);
  };

  const handleSessionStart = (config: { mode: SessionMode; count?: number; tag?: string }) => {
    navigate('/study', { state: { sessionConfig: config } });
  };

  // Navigate from Dashboard search → Dictionary, passing query via router state
  const handleQuickSearch = (word: string) => {
    navigate('/dictionary', { state: { query: word } });
  };

  const handleReviewCard = (id: string, quality: number) => {
    setCards(prev => prev.map(card => {
      if (card.id !== id) return card;

      let { repetition = 0 } = card;
      let nextReviewDate = Date.now();
      let status = FlashcardStatus.Learning;

      if (quality === 1) { // Again
        repetition = 0;
        nextReviewDate = Date.now();
        status = FlashcardStatus.Learning;
      } else if (quality === 3) { // Learned
        repetition += 1;
        status = FlashcardStatus.Learning;

        const now = Date.now();
        const ONE_DAY = 24 * 60 * 60 * 1000;

        if (repetition === 1) {
          nextReviewDate = now + ONE_DAY;
        } else if (repetition === 2) {
          nextReviewDate = now + ONE_DAY * 7;
        } else if (repetition === 3) {
          nextReviewDate = now + ONE_DAY * 14;
        } else if (repetition === 4) {
          nextReviewDate = now + ONE_DAY * 30;
        } else {
          status = FlashcardStatus.Mastered;
          nextReviewDate = now + ONE_DAY * 365;
        }
      } else if (quality === 5) { // Mastered
        status = FlashcardStatus.Mastered;
      }

      return {
        ...card,
        repetition,
        nextReviewDate,
        status,
        lastQuality: quality,
        lastReviewed: Date.now(),
        updatedAt: Date.now()
      };
    }));
    recordActivity();
    trackEvent(TRACKING_ACTION.UPDATE_STATUS, TRACKING_CATEGORY.FLASHCARDS, `quality_${quality}`);
  };

  const handleRestoreCard = (previousCard: Flashcard) => {
    setCards(prev =>
      prev.map(card =>
        card.id === previousCard.id
          ? { ...previousCard, updatedAt: Date.now() }
          : card
      )
    );
  };

  const handleCreateCustomCard = (data: {
    word: string;
    partOfSpeech: string;
    phonetic?: string;
    mainDefinition: string;
    example?: string;
    image?: string;
    tags?: string[];
  }) => {
    const now = Date.now();
    const cleanedTags = data.tags
      ? Array.from(new Set(data.tags.map(t => t.trim()).filter(Boolean)))
      : [];
    const newCard: Flashcard = {
      id: crypto.randomUUID(),
      word: data.word.trim(),
      partOfSpeech: data.partOfSpeech.trim() || 'noun',
      phonetic: data.phonetic?.trim() || undefined,
      mainDefinition: data.mainDefinition.trim(),
      example: data.example?.trim() || undefined,
      image: data.image?.trim() || undefined,
      tags: cleanedTags.length > 0 ? cleanedTags : undefined,
      status: FlashcardStatus.New,
      lastReviewed: 0,
      createdAt: now,
      repetition: 0,
      nextReviewDate: now,
      updatedAt: now,
    };
    setCards(prev => [newCard, ...prev]);
    recordActivity();
    trackEvent(TRACKING_ACTION.ADD_CARD, TRACKING_CATEGORY.FLASHCARDS, newCard.word);
  };

  const handleUpdateCard = (
    id: string,
    updates: {
      word?: string;
      partOfSpeech?: string;
      phonetic?: string;
      mainDefinition?: string;
      example?: string;
      image?: string;
      tags?: string[];
    }
  ) => {
    setCards(prev =>
      prev.map(card => {
        if (card.id !== id) return card;
        const cleanedTags = updates.tags !== undefined
          ? Array.from(new Set(updates.tags.map(t => t.trim()).filter(Boolean)))
          : card.tags;
        return {
          ...card,
          word: updates.word !== undefined ? updates.word.trim() : card.word,
          partOfSpeech: updates.partOfSpeech !== undefined ? updates.partOfSpeech.trim() : card.partOfSpeech,
          phonetic: updates.phonetic !== undefined ? (updates.phonetic.trim() || undefined) : card.phonetic,
          mainDefinition: updates.mainDefinition !== undefined ? updates.mainDefinition.trim() : card.mainDefinition,
          example: updates.example !== undefined ? (updates.example.trim() || undefined) : card.example,
          image: updates.image !== undefined ? (updates.image.trim() || undefined) : card.image,
          tags: cleanedTags && cleanedTags.length > 0 ? cleanedTags : undefined,
          updatedAt: Date.now(),
        };
      })
    );
  };

  const handleImportBookWords = (bookTitle: string, words: BookExtractedWord[]) => {
    const cleanTitle = bookTitle.trim() || 'Untitled Book';
    const bookTag = `Book: ${cleanTitle}`;
    const now = Date.now();

    const newBookCards: Flashcard[] = words.map((w, idx) => ({
      id: crypto.randomUUID(),
      word: w.word.trim(),
      partOfSpeech: w.partOfSpeech.trim() || 'noun',
      phonetic: w.phonetic?.trim() || undefined,
      audio: w.audio,
      mainDefinition: w.mainDefinition.trim(),
      example: w.bookSentence?.trim() || undefined,
      synonyms: w.synonyms && w.synonyms.length > 0 ? w.synonyms : undefined,
      antonyms: w.antonyms && w.antonyms.length > 0 ? w.antonyms : undefined,
      tags: [bookTag],
      status: FlashcardStatus.New,
      lastReviewed: 0,
      createdAt: now + idx,
      repetition: 0,
      nextReviewDate: now,
      updatedAt: now + idx,
    }));

    performMerge(newBookCards);
    recordActivity();
    trackEvent(TRACKING_ACTION.ADD_CARD, TRACKING_CATEGORY.FLASHCARDS, `book_${cleanTitle}`);
  };

  const handleDeleteCard = (id: string) => {
    setCards(prev => prev.filter(c => c.id !== id));
    setDeletedCards(prev => new Map(prev).set(id, Date.now()));
    trackEvent(TRACKING_ACTION.DELETE_CARD, TRACKING_CATEGORY.FLASHCARDS);
  };

  const handleDeleteBook = (bookTag: string) => {
    const cleanTag = bookTag.trim();
    if (!cleanTag) return;
    const now = Date.now();
    const removedIds: string[] = [];

    setCards(prev =>
      prev.filter(c => {
        const belongsToBook = c.tags?.some(t => t.trim() === cleanTag);
        if (belongsToBook) {
          removedIds.push(c.id);
          return false;
        }
        return true;
      })
    );

    if (removedIds.length > 0) {
      setDeletedCards(prev => {
        const next = new Map(prev);
        removedIds.forEach(id => next.set(id, now));
        return next;
      });
    }
    trackEvent(TRACKING_ACTION.DELETE_CARD, TRACKING_CATEGORY.FLASHCARDS, `book_${cleanTag}`);
  };

  // Milestone Confetti Logic
  useEffect(() => {
    const masteredCount = cards.filter(c => c.status === FlashcardStatus.Mastered).length;

    if (masteredCount > 0 &&
      masteredCount % 100 === 0 &&
      masteredCount > prevMasteredCount) {

      setShowConfetti(true);
      setTimeout(() => {
        setShowConfetti(false);
      }, 5000);

      trackEvent('milestone_reached', TRACKING_CATEGORY.ENGAGEMENT, `mastered_${masteredCount}`);
    }

    setPrevMasteredCount(masteredCount);
  }, [cards, prevMasteredCount]);

  // Nav link active class helper
  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${isActive
      ? 'bg-white dark:bg-slate-700 text-brand-600 dark:text-brand-400 shadow-sm'
      : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-700/50'
    }`;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 font-sans">
      {/* GA page-view tracker — fires on every route change */}
      <RouteTracker />

      {/* PWA Install Banner */}
      <PwaInstallBanner />

      {/* Re-grant permission banner */}
      {pendingHandle && !fileHandle && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-md">
          <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-xl shadow-lg px-4 py-3 flex items-center gap-3">
            <RefreshCw className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <p className="text-xs text-amber-800 dark:text-amber-200 flex-1">
              Reconnect to <strong className="font-semibold">{pendingHandle.name}</strong>?
            </p>
            <button
              onClick={handleReGrantPermission}
              className="shrink-0 px-3 py-1 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold rounded-lg transition-colors"
            >
              Reconnect
            </button>
            <button
              onClick={() => setPendingHandle(null)}
              className="shrink-0 text-amber-500 hover:text-amber-700 dark:hover:text-amber-300 text-xs"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {showConfetti && (
        <div className="fixed inset-0 z-[100] pointer-events-none">
          <Confetti
            width={width}
            height={height}
            recycle={true}
            numberOfPieces={500}
            gravity={0.15}
          />
        </div>
      )}

      <header className="sticky top-0 z-50 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-700">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <NavLink to="/" className="flex items-center gap-2 cursor-pointer">
            <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center text-white font-serif font-bold text-xl shadow-lg shadow-brand-500/30">
              L
            </div>
            <span className="font-bold text-xl tracking-tight text-slate-900 dark:text-white hidden sm:block">Lumina</span>
          </NavLink>

          <div className="flex items-center gap-2">
            <nav className="flex items-center gap-1 bg-slate-100/50 dark:bg-slate-800/80 p-1 rounded-xl mr-2">
              <NavLink to="/" end className={navLinkClass}>
                <Home className="h-4 w-4" />
                <span className="hidden sm:inline">Home</span>
              </NavLink>
              <NavLink to="/dictionary" className={navLinkClass}>
                <Book className="h-4 w-4" />
                <span className="hidden sm:inline">Dictionary</span>
              </NavLink>
              <NavLink
                to="/flashcards"
                className={({ isActive }) =>
                  navLinkClass({ isActive: isActive || location.pathname === '/study' })
                }
              >
                <Layers className="h-4 w-4" />
                <span className="hidden sm:inline">Flashcards</span>
                {cards.length > 0 && (
                  <span className="bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10px] px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                    {cards.length}
                  </span>
                )}
              </NavLink>
              <NavLink to="/statistics" className={navLinkClass}>
                <BarChart2 className="h-4 w-4" />
                <span className="hidden sm:inline">Statistics</span>
              </NavLink>
            </nav>

            <button
              onClick={handleToggleDark}
              className="p-2.5 rounded-xl transition-all bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200 mr-1"
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label="Toggle dark mode"
            >
              {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
            <button
              onClick={() => setIsDataModalOpen(true)}
              className={`p-2.5 rounded-xl transition-all hover:bg-slate-200 dark:hover:bg-slate-700 ${fileHandle || cloudConfig ? 'bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 border border-brand-200 dark:border-brand-800' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400'}`}
              title="Manage Data"
            >
              {cloudConfig ? <Cloud className="h-5 w-5" /> : (fileHandle ? <Save className="h-5 w-5" /> : <Database className="h-5 w-5" />)}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-8">
        <Routes>
          <Route
            path="/"
            element={
              <Dashboard
                cards={cards}
                studyHistory={studyHistory}
                longestStreak={longestStreak}
                onNavigate={(view) => {
                  if (view === 'study') {
                    handleStartStudySession();
                  } else {
                    navigate(`/${view === 'dashboard' ? '' : view}`);
                  }
                }}
                onQuickSearch={handleQuickSearch}
                onStartStudy={handleStartStudySession}
                onImportBookWords={handleImportBookWords}
                onDeleteBook={handleDeleteBook}
              />
            }
          />
          <Route
            path="/dictionary"
            element={
              <Dictionary
                onAddCard={handleAddCard}
                onRemoveCard={handleDeleteCard}
                onUpdateCard={handleUpdateCard}
                existingCards={cards}
              />
            }
          />
          <Route
            path="/flashcards"
            element={
              <Flashcards
                cards={cards}
                onStartStudy={handleStartStudySession}
                onDeleteCard={handleDeleteCard}
                onDeleteBook={handleDeleteBook}
                onReviewCard={handleReviewCard}
                onCreateCard={handleCreateCustomCard}
                onUpdateCard={handleUpdateCard}
                onImportBookWords={handleImportBookWords}
                onOpenImport={() => setIsDataModalOpen(true)}
              />
            }
          />
          <Route
            path="/study"
            element={
              <StudySession
                cards={cards}
                onReviewCard={handleReviewCard}
                onRestoreCard={handleRestoreCard}
                onSessionComplete={handleSessionComplete}
                onExit={() => navigate('/flashcards')}
              />
            }
          />
          <Route
            path="/statistics"
            element={
              <Statistics
                cards={cards}
                studyHistory={studyHistory}
                longestStreak={longestStreak}
              />
            }
          />
          {/* Catch-all — redirect unknown hashes to home */}
          <Route
            path="*"
            element={
              <Dashboard
                cards={cards}
                studyHistory={studyHistory}
                longestStreak={longestStreak}
                onNavigate={(view) => {
                  if (view === 'study') {
                    handleStartStudySession();
                  } else {
                    navigate(`/${view === 'dashboard' ? '' : view}`);
                  }
                }}
                onQuickSearch={handleQuickSearch}
                onStartStudy={handleStartStudySession}
                onImportBookWords={handleImportBookWords}
                onDeleteBook={handleDeleteBook}
              />
            }
          />
        </Routes>
      </main>

      {/* Auto-Save Indicators */}
      {(isFileSaving || isCloudSaving || isSyncingOffline || (!isOnline && cloudConfig)) && (
        <div className="fixed bottom-4 right-4 flex flex-col gap-2 items-end z-50">
          {(isFileSaving || isCloudSaving) && !isSyncingOffline && (
            <div className="bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs px-3 py-1.5 rounded-full shadow-lg animate-pulse flex items-center gap-2">
              {isCloudSaving ? <Cloud className="h-3 w-3" /> : <Save className="h-3 w-3" />}
              {isCloudSaving ? 'Syncing to Cloud...' : 'Saving to File...'}
            </div>
          )}
          {!isOnline && cloudConfig && !isCloudSaving && !isSyncingOffline && (
            <div className="bg-amber-500 text-white text-xs px-3 py-1.5 rounded-full shadow-lg flex items-center gap-2">
              <RefreshCw className="h-3 w-3" />
              Offline — changes will sync when connected
            </div>
          )}
          {isOnline && isSyncingOffline && (
            <div className="bg-brand-600 text-white text-xs px-3 py-1.5 rounded-full shadow-lg animate-pulse flex items-center gap-2">
              <RefreshCw className="h-3 w-3 animate-spin" />
              Syncing offline changes...
            </div>
          )}
        </div>
      )}

      <DataManagerModal
        isOpen={isDataModalOpen}
        onClose={() => setIsDataModalOpen(false)}
        onExport={handleExportData}
        onImport={handleImportData}
        onAnkiFileSelected={handleAnkiFileSelected}
        onConnectFile={handleConnectFile}
        onChangeFile={handleChangeFile}
        onDisconnectFile={handleDisconnectFile}
        onManualSave={handleManualFileSave}
        isFileConnected={!!fileHandle}
        connectedFileName={fileHandle?.name}
        cardCount={cards.length}
        persistenceStatus={persistenceStatus}
        storageEstimate={storageEstimate}
        onRequestPersistence={handleRequestPersistence}
        lastSavedAt={lastSavedAt}
        cloudConfig={cloudConfig}
        onConnectCloud={handleConnectCloud}
        onMigrateCloud={handleMigrateCloud}
        onDisconnectCloud={handleDisconnectCloud}
        onCloudPull={handleCloudPull}
        onCloudPush={handleCloudPush}
      />

      <AnkiImportModal
        file={ankiImportFile}
        onClose={() => setAnkiImportFile(null)}
        onImport={handleAnkiImport}
      />

      <SessionConfigModal
        isOpen={isSessionConfigOpen}
        onClose={() => setIsSessionConfigOpen(false)}
        onStart={handleSessionStart}
        dueCount={getDueCards(cards).length}
        cards={cards}
        initialTag={sessionInitialTag}
      />
    </div>
  );
};

export default App;