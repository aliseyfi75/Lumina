import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Routes, Route, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { Flashcard, WordEntry, FlashcardStatus, FileSystemFileHandle, CloudConfig, LocalizedTranslations, MeaningLanguagePreference } from './types';
import { Dashboard } from './components/Dashboard';
import { Dictionary } from './components/Dictionary';
import { Flashcards, CustomCardFormData } from './components/Flashcards';
import { StudySession } from './components/StudySession';
import { Statistics } from './components/Statistics';
import { DataManagerModal } from './components/DataManagerModal';
import { SettingsModal } from './components/SettingsModal';
import { AnkiImportModal } from './components/AnkiImportModal';
import { PwaInstallBanner } from './components/PwaInstallBanner';
import { generateJSON, parseFileContent, downloadJSON, saveToLocalFile } from './services/fileService';
import { getDetails, getDeck, updateDeck, keepAlivePantry, getKnownChunkCount, getPendingCloudSyncPlan, CloudSyncProgress, ChunkProgressInfo } from './services/pantryService';
import { findOrCreateLuminaGist, getGistDeck, updateGistDeck, hasPendingGistSyncChanges, normalizeGistId } from './services/gistService';
import { saveFileHandleToIDB, loadFileHandleFromIDB, clearFileHandleFromIDB, saveAppDataToIDB, loadAppDataFromIDB, requestPersistentStorage, checkPersistentStorage, getStorageEstimate } from './services/idbService';
import { initializeTracking, trackEvent, setTrackingUserId, trackPageView, PAGE_TITLES, TRACKING_CATEGORY, TRACKING_ACTION } from './services/trackingService';
import { getLocalDateString, calculateCurrentStreak, getDueCards } from './utils/studyUtils';
import { installDeviceRootScaleListeners } from './utils/deviceScale';
import {
  loadLanguagePreferenceFromStorage,
  saveLanguagePreferenceToStorage,
  isValidLanguagePreference,
  sanitizeTranslations,
  mergeTranslations,
  cardNeedsPersianBackfill,
  LANGUAGE_PREFERENCE_OPTIONS,
} from './utils/languageUtils';
import { mergeFlashcardDecks, MergeDeckOptions } from './utils/cardMerge';
import { translateCardMeaningToPersian } from './services/translationService';
import { Book, Layers, Database, Save, Cloud, BarChart2, Home, Sun, Moon, RefreshCw, Settings } from 'lucide-react';
import Confetti from 'react-confetti';
import { useWindowSize } from 'react-use';
import { SessionConfigModal, SessionMode } from './components/SessionConfigModal';
import { BookExtractedWord } from './services/bookService';

const LOCAL_STORAGE_KEY = 'lumina_cards_v1';
const CLOUD_CONFIG_KEY = 'lumina_cloud_config';
const THEME_STORAGE_KEY = 'lumina_theme';

const isGistCloud = (cfg?: CloudConfig | null): boolean =>
  Boolean(cfg && (cfg.provider === 'gist' || (cfg.gistToken && cfg.gistId)));

const parseSavedCloudConfig = (raw: any): CloudConfig | null => {
  if (!raw || typeof raw !== 'object') return null;
  if (
    (raw.provider === 'gist' || raw.gistToken) &&
    typeof raw.gistToken === 'string' &&
    raw.gistToken.trim() &&
    typeof raw.gistId === 'string' &&
    raw.gistId.trim()
  ) {
    const cleanGistId = normalizeGistId(raw.gistId);
    return {
      provider: 'gist',
      gistToken: raw.gistToken.trim(),
      gistId: cleanGistId,
      pantryId: cleanGistId,
    };
  }
  if (typeof raw.pantryId === 'string' && raw.pantryId.trim()) {
    return {
      provider: 'pantry',
      pantryId: raw.pantryId.trim(),
    };
  }
  return null;
};

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
  const cardsRef = useRef<Flashcard[]>([]);
  // Tombstone map: id → Unix-ms when deleted. Entries are pruned after 30 days.
  const [deletedCards, setDeletedCards] = useState<Map<string, number>>(new Map());
  // Ref mirrors the map so performMerge can always read current tombstones
  // without needing the map in its useCallback deps (which would re-trigger initData).
  const deletedCardsRef = useRef<Map<string, number>>(new Map());
  const [studyHistory, setStudyHistory] = useState<Record<string, number>>({});
  const studyHistoryRef = useRef<Record<string, number>>({});
  const [longestStreak, setLongestStreak] = useState(0);
  const longestStreakRef = useRef<number>(0);

  // Keep root typography & spacing calibrated to the active device viewport
  useEffect(() => {
    return installDeviceRootScaleListeners();
  }, []);

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

  // Keep refs in sync so performMerge and deletion handlers always see the latest state
  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);

  useEffect(() => {
    deletedCardsRef.current = deletedCards;
  }, [deletedCards]);

  useEffect(() => {
    studyHistoryRef.current = studyHistory;
  }, [studyHistory]);

  useEffect(() => {
    longestStreakRef.current = longestStreak;
  }, [longestStreak]);

  // Language Preference & Settings Modal State
  const [languagePreference, setLanguagePreference] = useState<MeaningLanguagePreference>(
    () => loadLanguagePreferenceFromStorage().preference
  );
  const [languagePreferenceUpdatedAt, setLanguagePreferenceUpdatedAt] = useState<number>(
    () => loadLanguagePreferenceFromStorage().updatedAt
  );
  const languagePreferenceRef = useRef<MeaningLanguagePreference>(languagePreference);
  const languagePreferenceUpdatedAtRef = useRef<number>(languagePreferenceUpdatedAt);

  useEffect(() => {
    languagePreferenceRef.current = languagePreference;
  }, [languagePreference]);

  useEffect(() => {
    languagePreferenceUpdatedAtRef.current = languagePreferenceUpdatedAt;
  }, [languagePreferenceUpdatedAt]);

  const handleChangeLanguagePreference = useCallback((nextPref: MeaningLanguagePreference) => {
    const now = Date.now();
    languagePreferenceRef.current = nextPref;
    languagePreferenceUpdatedAtRef.current = now;
    setLanguagePreference(nextPref);
    setLanguagePreferenceUpdatedAt(now);
    saveLanguagePreferenceToStorage(nextPref, now);
  }, []);

  const applyIncomingLanguagePreference = useCallback(
    (incomingPref?: MeaningLanguagePreference, incomingUpdatedAt?: number) => {
      if (!isValidLanguagePreference(incomingPref)) return;
      const incTs =
        typeof incomingUpdatedAt === 'number' && Number.isFinite(incomingUpdatedAt)
          ? incomingUpdatedAt
          : 0;
      const curTs = languagePreferenceUpdatedAtRef.current;
      const shouldAdopt =
        (curTs === 0 && (incTs > 0 || incomingPref !== 'en')) ||
        (incTs > 0 && incTs > curTs);
      if (shouldAdopt) {
        const resolvedTs = Math.max(incTs, curTs);
        languagePreferenceRef.current = incomingPref;
        languagePreferenceUpdatedAtRef.current = resolvedTs;
        setLanguagePreference(incomingPref);
        setLanguagePreferenceUpdatedAt(resolvedTs);
        saveLanguagePreferenceToStorage(incomingPref, resolvedTs);
      }
    },
    []
  );

  const resolveMergedLanguagePreference = (
    ...sources: Array<{
      languagePreference?: MeaningLanguagePreference;
      languagePreferenceUpdatedAt?: number;
    } | undefined>
  ): { preference: MeaningLanguagePreference; updatedAt: number } => {
    let bestPref = languagePreferenceRef.current;
    let bestTs = languagePreferenceUpdatedAtRef.current;
    for (const src of sources) {
      if (!src || !isValidLanguagePreference(src.languagePreference)) continue;
      const ts =
        typeof src.languagePreferenceUpdatedAt === 'number' &&
        Number.isFinite(src.languagePreferenceUpdatedAt)
          ? src.languagePreferenceUpdatedAt
          : 0;
      if ((bestTs === 0 && (ts > 0 || src.languagePreference !== 'en')) || (ts > 0 && ts > bestTs)) {
        bestPref = src.languagePreference;
        bestTs = Math.max(ts, bestTs);
      }
    }
    return { preference: bestPref, updatedAt: bestTs };
  };

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isBackfillingTranslations, setIsBackfillingTranslations] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState<{ completed: number; total: number } | null>(null);
  const isBackfillingRef = useRef(false);
  const autoAttemptedBackfillIdsRef = useRef<Set<string>>(new Set());

  const [isDataModalOpen, setIsDataModalOpen] = useState(false);
  const [ankiImportFile, setAnkiImportFile] = useState<File | null>(null);

  // File System State
  const [fileHandle, setFileHandle] = useState<FileSystemFileHandle | null>(null);
  const [pendingHandle, setPendingHandle] = useState<FileSystemFileHandle | null>(null); // needs permission re-grant
  const [isFileSaving, setIsFileSaving] = useState(false);

  // Cloud Sync State — initialize synchronously from localStorage so page refresh never shows as disconnected
  const [cloudConfig, setCloudConfig] = useState<CloudConfig | null>(() => {
    try {
      const saved = localStorage.getItem(CLOUD_CONFIG_KEY);
      if (saved) {
        return parseSavedCloudConfig(JSON.parse(saved));
      }
    } catch {
      // ignore parse errors
    }
    return null;
  });
  const cloudConfigRef = useRef<CloudConfig | null>(cloudConfig);
  useEffect(() => {
    cloudConfigRef.current = cloudConfig;
  }, [cloudConfig]);

  const persistCloudConfigToLocalStorage = (config: CloudConfig | null) => {
    try {
      if (!config) {
        localStorage.removeItem(CLOUD_CONFIG_KEY);
      } else {
        localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify(config));
      }
    } catch {
      // If localStorage quota was exhausted by large lumina_cards_v1 backup, free it (IDB holds full deck) and retry
      try {
        localStorage.removeItem(LOCAL_STORAGE_KEY);
        if (config) {
          localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify(config));
        }
      } catch (retryErr) {
        console.warn('Could not persist cloudConfig to localStorage:', retryErr);
      }
    }
  };

  const persistCardsToLocalStorageSafe = (cardsToSave: Flashcard[]) => {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(cardsToSave));
    } catch {
      // Deck exceeds 5 MB localStorage quota — IndexedDB is the primary store, keep CLOUD_CONFIG_KEY intact
      try {
        localStorage.removeItem(LOCAL_STORAGE_KEY);
        if (cloudConfigRef.current) {
          localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify(cloudConfigRef.current));
        }
      } catch {
        // ignore
      }
    }
  };
  const [isCloudSaving, setIsCloudSaving] = useState(false);
  const isCloudSavingRef = useRef(false);
  useEffect(() => {
    isCloudSavingRef.current = isCloudSaving;
  }, [isCloudSaving]);
  const [isSyncingOffline, setIsSyncingOffline] = useState(false);
  const [cloudSyncProgress, setCloudSyncProgress] = useState<{
    percent: number;
    step: string;
    estimatedRemainingSec: number;
    completedSteps: number;
    totalSteps: number;
    stepStartedAt: number;
  } | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCloudSync, setPendingCloudSync] = useState(false);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const skipNextCloudAutoSaveRef = useRef(false);
  const hasInitializedCloudRef = useRef(false);
  const hasSyncedInitialCloudPullRef = useRef(false);
  const lastCloudPullAtRef = useRef<number>(0);
  const isMigratingCloudRef = useRef(false);
  const lastKeepAliveRef = useRef<number>(0);

  // Storage metadata
  const [persistenceStatus, setPersistenceStatus] = useState<'granted' | 'denied' | 'prompt' | 'unsupported'>('prompt');
  const [storageEstimate, setStorageEstimate] = useState<{ usage: number; quota: number } | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  const [isSessionConfigOpen, setIsSessionConfigOpen] = useState(false);
  const [sessionInitialTag, setSessionInitialTag] = useState<string | undefined>(undefined);
  const [sessionInitialChapters, setSessionInitialChapters] = useState<string[] | undefined>(undefined);

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

  // Pure helper: merge two card arrays while honoring tombstones and decoupling SRS status from content updatedAt
  const mergeCardArrays = (
    baseCards: Flashcard[],
    incoming: Flashcard[],
    tombstones: Record<string, number>,
    options?: MergeDeckOptions
  ): Flashcard[] =>
    mergeFlashcardDecks(baseCards, incoming, tombstones, {
      ...options,
      liveDeletedMap: deletedCardsRef.current,
    });

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
    incomingDeletedCards: Record<string, number> = {},
    options?: MergeDeckOptions
  ) => {
    // Union the incoming tombstones synchronously on the ref first so mergeCardArrays sees them immediately
    const cutoff = Date.now() - TOMBSTONE_TTL;
    const mergedTombstones = new Map(deletedCardsRef.current);
    Object.entries(incomingDeletedCards).forEach(([id, deletedAt]) => {
      if (deletedAt >= cutoff) {
        mergedTombstones.set(id, Math.max(mergedTombstones.get(id) ?? 0, deletedAt));
      }
    });
    deletedCardsRef.current = mergedTombstones;
    setDeletedCards(mergedTombstones);

    const next = mergeCardArrays(cardsRef.current, incoming, incomingDeletedCards, options);
    cardsRef.current = next;
    setCards(prev => {
      const mergedFromPrev =
        prev === cardsRef.current
          ? next
          : mergeCardArrays(prev, incoming, incomingDeletedCards, options);
      cardsRef.current = mergedFromPrev;
      return mergedFromPrev;
    });
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
      if (idbData?.languagePreference) {
        applyIncomingLanguagePreference(idbData.languagePreference, idbData.languagePreferenceUpdatedAt);
      }
      if (
        idbData &&
        Array.isArray(idbData.cards) &&
        (idbData.cards.length > 0 ||
          Object.keys(idbData.deletedCards ?? {}).length > 0 ||
          Object.keys(idbData.studyHistory ?? {}).length > 0 ||
          !!idbData.cloudConfig?.pantryId)
      ) {
        initialCards = idbData.cards;
        initialStudyHistory = idbData.studyHistory ?? {};
        initialLongestStreak = idbData.longestStreak ?? 0;
        initialDeletedCards = idbData.deletedCards ?? {};
        hasExistingUserStore =
          idbData.cards.length > 0 ||
          Object.keys(idbData.deletedCards ?? {}).length > 0 ||
          Object.keys(idbData.studyHistory ?? {}).length > 0;
      } else {
        // Step A-fallback: migrate from localStorage (existing users)
        const savedCards = localStorage.getItem(LOCAL_STORAGE_KEY);
        const savedHistoryRaw = localStorage.getItem('lumina_study_history');
        const savedStreakRaw = localStorage.getItem('lumina_longest_streak');
        if (savedHistoryRaw) {
          try {
            const parsedHistory = JSON.parse(savedHistoryRaw);
            if (parsedHistory && typeof parsedHistory === 'object') {
              initialStudyHistory = parsedHistory;
            }
          } catch { /* ignore */ }
        }
        if (savedStreakRaw) {
          const parsedStreak = Number(savedStreakRaw);
          if (Number.isFinite(parsedStreak) && parsedStreak > 0) {
            initialLongestStreak = parsedStreak;
          }
        }
        if (savedCards) {
          try {
            const parsed = JSON.parse(savedCards);
            if (Array.isArray(parsed)) {
              initialCards = parsed;
              hasExistingUserStore = true;
              // Migrate immediately so next load hits IDB
              try {
                await saveAppDataToIDB({
                  cards: parsed,
                  studyHistory: initialStudyHistory,
                  longestStreak: initialLongestStreak,
                  deletedCards: {},
                  languagePreference: languagePreferenceRef.current,
                  languagePreferenceUpdatedAt: languagePreferenceUpdatedAtRef.current,
                });
                localStorage.removeItem(LOCAL_STORAGE_KEY);
              } catch { /* migration best-effort */ }
            }
          } catch (e) {
            console.error('Failed to parse saved cards from localStorage', e);
          }
        }
      }

      // Restore tombstones into state and ref early so performMerge honours them
      if (Object.keys(initialDeletedCards).length > 0) {
        const cutoff = Date.now() - TOMBSTONE_TTL;
        const map = new Map<string, number>();
        Object.entries(initialDeletedCards).forEach(([id, ts]) => { if (ts >= cutoff) map.set(id, ts); });
        deletedCardsRef.current = map;
        setDeletedCards(map);
      }

      if (initialStudyHistory && Object.keys(initialStudyHistory).length > 0) {
        studyHistoryRef.current = initialStudyHistory;
        setStudyHistory(initialStudyHistory);
      }
      if (initialLongestStreak > 0) {
        longestStreakRef.current = initialLongestStreak;
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
              studyHistoryRef.current = defaultData.studyHistory;
              setStudyHistory(defaultData.studyHistory);
            }
            if (initialLongestStreak === 0 && defaultData.longestStreak) {
              longestStreakRef.current = defaultData.longestStreak;
              setLongestStreak(defaultData.longestStreak);
            }
            if (defaultData.languagePreference) {
              applyIncomingLanguagePreference(
                defaultData.languagePreference,
                defaultData.languagePreferenceUpdatedAt
              );
            }
          }
        } catch (e) {
          console.warn('No default database found.', e);
        }
      }

      cardsRef.current = initialCards;
      setCards(initialCards);

      // Step C: Check Cloud Config (from localStorage OR IndexedDB backup), Merge, and Send Keep-Alive Ping
      let resolvedCloudConfig: CloudConfig | null = null;
      const savedCloudConfig = localStorage.getItem(CLOUD_CONFIG_KEY);
      if (savedCloudConfig) {
        try {
          resolvedCloudConfig = parseSavedCloudConfig(JSON.parse(savedCloudConfig));
        } catch {
          // ignore
        }
      }
      if (!resolvedCloudConfig && idbData?.cloudConfig) {
        resolvedCloudConfig = parseSavedCloudConfig(idbData.cloudConfig);
        if (resolvedCloudConfig) {
          persistCloudConfigToLocalStorage(resolvedCloudConfig);
        }
      }

      if (resolvedCloudConfig && !hasInitializedCloudRef.current) {
        hasInitializedCloudRef.current = true;
        // Set cloudConfig immediately BEFORE awaiting getDeck/getGistDeck so refreshing never shows as disconnected
        cloudConfigRef.current = resolvedCloudConfig;
        setCloudConfig(resolvedCloudConfig);
        initializeTracking(resolvedCloudConfig.pantryId);

        try {
          const usingGistOnInit = isGistCloud(resolvedCloudConfig);
          const cloudData = usingGistOnInit
            ? await getGistDeck(resolvedCloudConfig.gistToken!, resolvedCloudConfig.gistId!)
            : await getDeck(resolvedCloudConfig.pantryId, undefined, {
                localCards: initialCards,
                onPartialCards: (partial) => {
                  if (partial.languagePreference) {
                    applyIncomingLanguagePreference(
                      partial.languagePreference,
                      partial.languagePreferenceUpdatedAt
                    );
                  }
                  if (
                    (partial.cards && partial.cards.length > 0) ||
                    (partial.deletedCards && Object.keys(partial.deletedCards).length > 0)
                  ) {
                    skipNextCloudAutoSaveRef.current = true;
                    performMerge(partial.cards ?? [], partial.deletedCards ?? {});
                  }
                },
              });
          const cloudHadDeletedCards = (cloudData.cards ?? []).some(c => {
            const delAt = deletedCardsRef.current.get(c.id) ?? 0;
            const cardTs = Math.max(
              c.updatedAt ?? 0,
              c.statusUpdatedAt ?? 0,
              c.lastReviewed ?? 0,
              c.createdAt ?? 0
            );
            return delAt > 0 && delAt >= cardTs;
          });

          if (cloudData.languagePreference) {
            applyIncomingLanguagePreference(
              cloudData.languagePreference,
              cloudData.languagePreferenceUpdatedAt
            );
          }

          if (
            (cloudData.cards && cloudData.cards.length > 0) ||
            (cloudData.deletedCards && Object.keys(cloudData.deletedCards).length > 0)
          ) {
            performMerge(cloudData.cards ?? [], cloudData.deletedCards ?? {});
          }

          if (cloudData.studyHistory) {
            const mergedHist = mergeHistoryRecords(studyHistoryRef.current, cloudData.studyHistory);
            studyHistoryRef.current = mergedHist;
            setStudyHistory(mergedHist);
          }

          if (cloudData.longestStreak) {
            const mergedStreakVal = Math.max(longestStreakRef.current, cloudData.longestStreak);
            longestStreakRef.current = mergedStreakVal;
            setLongestStreak(mergedStreakVal);
          }

          hasSyncedInitialCloudPullRef.current = true;
          lastCloudPullAtRef.current = Date.now();

          if (usingGistOnInit) {
            // If local IndexedDB held newer card reviews/edits not yet uploaded to Gist, allow Auto-Save to push the merged delta!
            const hasLocalDeltaAfterPull = hasPendingGistSyncChanges(resolvedCloudConfig.gistId!, {
              cards: cardsRef.current,
              studyHistory: studyHistoryRef.current,
              longestStreak: longestStreakRef.current,
              deletedCards: prunedDeletedCards(),
              languagePreference: languagePreferenceRef.current,
              languagePreferenceUpdatedAt: languagePreferenceUpdatedAtRef.current,
            });
            skipNextCloudAutoSaveRef.current = !hasLocalDeltaAfterPull && !cloudHadDeletedCards;
          } else {
            // Only skip auto-save if cloud did NOT still hold locally-deleted cards
            skipNextCloudAutoSaveRef.current = !cloudHadDeletedCards;
          }

          // Schedule the Pantry keep-alive write 20 seconds after startup (GitHub Gist never expires)
          if (!usingGistOnInit && navigator.onLine && !cloudHadDeletedCards) {
            const startupKeepAliveTargetId = resolvedCloudConfig.pantryId;
            const startupChunkCount = cloudData.chunkCount ?? 1;
            const scheduledAt = Date.now();
            setTimeout(() => {
              if (
                navigator.onLine &&
                !isMigratingCloudRef.current &&
                !isGistCloud(cloudConfigRef.current) &&
                cloudConfigRef.current?.pantryId === startupKeepAliveTargetId &&
                lastKeepAliveRef.current < scheduledAt
              ) {
                lastKeepAliveRef.current = Date.now();
                void keepAlivePantry(startupKeepAliveTargetId, startupChunkCount);
              }
            }, 20_000);
          }
        } catch (e) {
          console.error('Failed to load cloud backup on init', e);
          skipNextCloudAutoSaveRef.current = true;
        }
      } else if (!resolvedCloudConfig) {
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
    const data = {
      cards,
      studyHistory,
      longestStreak,
      deletedCards: prunedDeletedCards(),
      cloudConfig: cloudConfigRef.current,
      languagePreference,
      languagePreferenceUpdatedAt,
    };
    saveAppDataToIDB(data)
      .then(() => {
        setLastSavedAt(Date.now());
        // Refresh usage estimate periodically (cheap call)
        getStorageEstimate().then(est => { if (est) setStorageEstimate(est); });
      })
      .catch(console.error);
    // Keep localStorage as a secondary safety net without starving CLOUD_CONFIG_KEY of quota
    persistCardsToLocalStorageSafe(cards);
  }, [cards, studyHistory, longestStreak, deletedCards, cloudConfig, languagePreference, languagePreferenceUpdatedAt, isDataLoaded]);

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
        await saveToLocalFile(fileHandle, {
          cards,
          studyHistory,
          longestStreak,
          deletedCards: prunedDeletedCards(),
          languagePreference,
          languagePreferenceUpdatedAt,
        });
      } catch (error) {
        console.error("Auto-save file failed:", error);
      } finally {
        setIsFileSaving(false);
      }
    }, 1000);
    return () => clearTimeout(timeoutId);
  }, [cards, studyHistory, longestStreak, deletedCards, languagePreference, languagePreferenceUpdatedAt, fileHandle, isDataLoaded]);

  const applyPulledSnapshotToState = useCallback(
    (
      partialOrFull: {
        cards?: Flashcard[];
        deletedCards?: Record<string, number>;
        studyHistory?: Record<string, number>;
        longestStreak?: number;
        languagePreference?: MeaningLanguagePreference;
        languagePreferenceUpdatedAt?: number;
      },
      mergeOpts?: MergeDeckOptions
    ) => {
      if (partialOrFull.languagePreference) {
        applyIncomingLanguagePreference(
          partialOrFull.languagePreference,
          partialOrFull.languagePreferenceUpdatedAt
        );
      }
      if (
        (partialOrFull.cards && partialOrFull.cards.length > 0) ||
        (partialOrFull.deletedCards && Object.keys(partialOrFull.deletedCards).length > 0)
      ) {
        performMerge(partialOrFull.cards ?? [], partialOrFull.deletedCards ?? {}, mergeOpts);
      }
      if (partialOrFull.studyHistory) {
        const mergedHist = mergeHistoryRecords(studyHistoryRef.current, partialOrFull.studyHistory);
        studyHistoryRef.current = mergedHist;
        setStudyHistory(mergedHist);
      }
      if (partialOrFull.longestStreak) {
        const mergedStreakVal = Math.max(longestStreakRef.current, partialOrFull.longestStreak);
        longestStreakRef.current = mergedStreakVal;
        setLongestStreak(mergedStreakVal);
      }
    },
    [applyIncomingLanguagePreference, performMerge]
  );

  // Safeguard: if this session hasn't successfully pulled from Gist yet (e.g. startup was offline),
  // pull & merge remote Gist BEFORE pushing so we never overwrite another device's study progress!
  const ensureInitialGistPullBeforePush = useCallback(
    async (cfg: CloudConfig) => {
      if (!isGistCloud(cfg) || hasSyncedInitialCloudPullRef.current) return;
      const remoteData = await getGistDeck(cfg.gistToken!, cfg.gistId!, { forceRefresh: true });
      applyPulledSnapshotToState(remoteData);
      hasSyncedInitialCloudPullRef.current = true;
      lastCloudPullAtRef.current = Date.now();
    },
    [applyPulledSnapshotToState]
  );

  const beginCloudSyncProgress = useCallback(
    (cardsToSyncCount: number, mode: 'push' | 'pull' = 'push', dirtyStepsOverride?: number) => {
      const usingGist = isGistCloud(cloudConfigRef.current);
      const knownChunks = usingGist
        ? 1
        : cloudConfigRef.current
          ? getKnownChunkCount(cloudConfigRef.current.pantryId)
          : 1;
      const estimatedChunks = usingGist
        ? 1
        : dirtyStepsOverride !== undefined && dirtyStepsOverride > 0
          ? dirtyStepsOverride
          : Math.max(knownChunks, Math.ceil(cardsToSyncCount / 65), 1);
      setCloudSyncProgress({
        percent: usingGist ? 30 : 12,
        step:
          mode === 'pull'
            ? usingGist
              ? 'Loading flashcards from GitHub Gist...'
              : 'Loading flashcards from Cloud...'
            : usingGist
              ? `Uploading ${cardsToSyncCount} flashcards to GitHub Gist...`
              : estimatedChunks > 1
                ? `Uploading chunk 1 of ${estimatedChunks}...`
                : cardsToSyncCount > 0
                  ? `Uploading ${cardsToSyncCount} flashcards...`
                  : 'Updating cloud storage...',
        estimatedRemainingSec: usingGist ? 1 : Math.max(2, estimatedChunks * 2),
        completedSteps: 0,
        totalSteps: estimatedChunks,
        stepStartedAt: Date.now(),
      });
    },
    []
  );

  const handleBackgroundCloudProgress = useCallback((info: ChunkProgressInfo) => {
    const totalSteps = Math.max(1, info.totalSteps ?? info.totalChunks ?? 1);
    const completedSteps = info.completedSteps ?? Math.max(0, (info.currentChunk ?? 1) - 1);
    const basePercent =
      info.percent ??
      (totalSteps === 1 ? 25 : Math.max(8, Math.round(((completedSteps + 0.4) / totalSteps) * 100)));
    const defaultStep =
      totalSteps > 1
        ? `Uploading chunk ${info.currentChunk} of ${info.totalChunks}...`
        : 'Uploading flashcards to Cloud...';
    setCloudSyncProgress({
      percent: Math.min(96, Math.max(5, basePercent)),
      step: info.step || defaultStep,
      estimatedRemainingSec: info.estimatedRemainingSec ?? Math.max(1, (totalSteps - completedSteps) * 2),
      completedSteps,
      totalSteps,
      stepStartedAt: Date.now(),
    });
  }, []);

  // Smoothly interpolate percentage and count down remaining time while a cloud sync request is in flight
  useEffect(() => {
    if (!isCloudSaving && !isSyncingOffline) return;
    const intervalId = setInterval(() => {
      setCloudSyncProgress(prev => {
        if (!prev) return prev;
        const elapsedInStepSec = (Date.now() - prev.stepStartedAt) / 1000;
        const stepCeiling = Math.min(
          95,
          Math.round(((prev.completedSteps + 0.92) / Math.max(1, prev.totalSteps)) * 100)
        );
        const nextPercent =
          prev.percent < stepCeiling
            ? Math.min(stepCeiling, prev.percent + Math.max(1, Math.round((stepCeiling - prev.percent) * 0.22)))
            : prev.percent;

        const remainingAfterStep = Math.max(0, prev.totalSteps - (prev.completedSteps + 1)) * 2;
        const currentStepRemaining = Math.max(1, Math.ceil(2.2 - elapsedInStepSec));
        const nextRemainingSec = Math.max(1, remainingAfterStep + currentStepRemaining);

        if (nextPercent === prev.percent && nextRemainingSec >= prev.estimatedRemainingSec) {
          return prev;
        }
        return {
          ...prev,
          percent: nextPercent,
          estimatedRemainingSec: Math.min(prev.estimatedRemainingSec, nextRemainingSec),
        };
      });
    }, 350);
    return () => clearInterval(intervalId);
  }, [isCloudSaving, isSyncingOffline]);

  // 4. Auto-Save to Cloud (Delta-aware for both GitHub Gist and Pantry)
  useEffect(() => {
    if (!isDataLoaded || !cloudConfig || isMigratingCloudRef.current) return;

    if (skipNextCloudAutoSaveRef.current) {
      skipNextCloudAutoSaveRef.current = false;
      return;
    }

    const currentDeleted = prunedDeletedCards();
    const usingGist = isGistCloud(cloudConfig);
    const hasChanges = usingGist
      ? hasPendingGistSyncChanges(cloudConfig.gistId!, {
          cards,
          studyHistory,
          longestStreak,
          deletedCards: currentDeleted,
          languagePreference,
          languagePreferenceUpdatedAt,
        })
      : getPendingCloudSyncPlan(cloudConfig.pantryId, {
          cards,
          studyHistory,
          longestStreak,
          deletedCards: currentDeleted,
          languagePreference,
          languagePreferenceUpdatedAt,
        }).hasChanges;

    if (!hasChanges) {
      setPendingCloudSync(false);
      return;
    }

    if (!isOnline) {
      // Mark dirty so we sync the moment connectivity returns
      setPendingCloudSync(true);
      return;
    }

    const debounceMs = usingGist ? 1000 : 2000;
    const timeoutId = setTimeout(async () => {
      if (isMigratingCloudRef.current) return;
      const latestDeleted = prunedDeletedCards();
      const latestPref = languagePreferenceRef.current;
      const latestPrefTs = languagePreferenceUpdatedAtRef.current;
      if (usingGist) {
        if (
          !hasPendingGistSyncChanges(cloudConfig.gistId!, {
            cards: cardsRef.current,
            studyHistory: studyHistoryRef.current,
            longestStreak: longestStreakRef.current,
            deletedCards: latestDeleted,
            languagePreference: latestPref,
            languagePreferenceUpdatedAt: latestPrefTs,
          })
        ) {
          setPendingCloudSync(false);
          return;
        }
        beginCloudSyncProgress(cardsRef.current.length, 'push', 1);
        setIsCloudSaving(true);
        try {
          await ensureInitialGistPullBeforePush(cloudConfig);
          await updateGistDeck(
            cloudConfig.gistToken!,
            cloudConfig.gistId!,
            {
              cards: cardsRef.current,
              studyHistory: studyHistoryRef.current,
              longestStreak: longestStreakRef.current,
              deletedCards: prunedDeletedCards(),
              languagePreference: languagePreferenceRef.current,
              languagePreferenceUpdatedAt: languagePreferenceUpdatedAtRef.current,
            },
            { onProgress: handleBackgroundCloudProgress }
          );
          setPendingCloudSync(false);
        } catch (error) {
          console.error('Auto-save Gist failed:', error);
          if (!navigator.onLine) {
            setPendingCloudSync(true);
          }
        } finally {
          setIsCloudSaving(false);
          setCloudSyncProgress(null);
        }
        return;
      }

      const latestPlan = getPendingCloudSyncPlan(cloudConfig.pantryId, {
        cards,
        studyHistory,
        longestStreak,
        deletedCards: latestDeleted,
        languagePreference: latestPref,
        languagePreferenceUpdatedAt: latestPrefTs,
      });
      if (!latestPlan.hasChanges) {
        setPendingCloudSync(false);
        return;
      }

      beginCloudSyncProgress(
        cards.length,
        'push',
        latestPlan.isMetadataOnly ? 1 : Math.max(1, latestPlan.dirtyChunkCount)
      );
      setIsCloudSaving(true);
      try {
        await updateDeck(
          cloudConfig.pantryId,
          {
            cards,
            studyHistory,
            longestStreak,
            deletedCards: latestDeleted,
            languagePreference: latestPref,
            languagePreferenceUpdatedAt: latestPrefTs,
          },
          { onProgress: handleBackgroundCloudProgress }
        );
        lastKeepAliveRef.current = Date.now();
        setPendingCloudSync(false);
      } catch (error) {
        console.error('Auto-save cloud failed:', error);
        if (!navigator.onLine) {
          setPendingCloudSync(true); // will retry when online
        }
      } finally {
        setIsCloudSaving(false);
        setCloudSyncProgress(null);
      }
    }, debounceMs);
    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, studyHistory, longestStreak, deletedCards, languagePreference, languagePreferenceUpdatedAt, cloudConfig, isDataLoaded]);

  // 4b. Auto-pull latest card statuses when returning to an already-open tab / installed iOS PWA
  // (plus keep Pantry's 30-day TTL alive when Pantry is the active provider)
  useEffect(() => {
    if (!isDataLoaded || !cloudConfig) return;
    const GIST_FOCUS_PULL_THROTTLE_MS = 15 * 1000; // 15 seconds (uses fast 304 ETag conditional GET)
    const PANTRY_FOCUS_PULL_THROTTLE_MS = 2 * 60 * 1000; // 2 minutes
    const KEEP_ALIVE_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
    let isAutoPullingOnFocus = false;

    const handleVisibilityOrFocus = async () => {
      if (
        document.visibilityState !== 'visible' ||
        !navigator.onLine ||
        isMigratingCloudRef.current ||
        isCloudSavingRef.current ||
        isAutoPullingOnFocus
      ) {
        return;
      }

      const activeCfg = cloudConfigRef.current;
      if (!activeCfg) return;
      const now = Date.now();

      if (isGistCloud(activeCfg)) {
        if (
          hasSyncedInitialCloudPullRef.current &&
          now - lastCloudPullAtRef.current < GIST_FOCUS_PULL_THROTTLE_MS
        ) {
          return;
        }
        isAutoPullingOnFocus = true;
        try {
          const remoteData = await getGistDeck(activeCfg.gistToken!, activeCfg.gistId!);
          applyPulledSnapshotToState(remoteData);
          hasSyncedInitialCloudPullRef.current = true;
          lastCloudPullAtRef.current = Date.now();
        } catch (err) {
          console.warn('Background Gist sync on focus failed:', err);
        } finally {
          isAutoPullingOnFocus = false;
        }
        return;
      }

      if (now - lastKeepAliveRef.current >= KEEP_ALIVE_INTERVAL_MS) {
        lastKeepAliveRef.current = now;
        void keepAlivePantry(activeCfg.pantryId, getKnownChunkCount(activeCfg.pantryId));
      }

      if (
        !hasSyncedInitialCloudPullRef.current ||
        now - lastCloudPullAtRef.current >= PANTRY_FOCUS_PULL_THROTTLE_MS
      ) {
        isAutoPullingOnFocus = true;
        try {
          const remoteData = await getDeck(activeCfg.pantryId, undefined, {
            localCards: cardsRef.current,
          });
          skipNextCloudAutoSaveRef.current = true;
          applyPulledSnapshotToState(remoteData);
          hasSyncedInitialCloudPullRef.current = true;
          lastCloudPullAtRef.current = Date.now();
        } catch (err) {
          console.warn('Background Pantry sync on focus failed:', err);
        } finally {
          isAutoPullingOnFocus = false;
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
    };
  }, [cloudConfig, isDataLoaded, applyPulledSnapshotToState]);

  // 5. Flush pending sync when coming back online (or cloud config is restored)
  useEffect(() => {
    if (!isDataLoaded || !isOnline || !cloudConfig || !pendingCloudSync) return;
    let cancelled = false;
    const flush = async () => {
      const latestDeleted = prunedDeletedCards();
      const latestPref = languagePreferenceRef.current;
      const latestPrefTs = languagePreferenceUpdatedAtRef.current;
      const usingGist = isGistCloud(cloudConfig);
      if (usingGist) {
        if (
          !hasPendingGistSyncChanges(cloudConfig.gistId!, {
            cards: cardsRef.current,
            studyHistory: studyHistoryRef.current,
            longestStreak: longestStreakRef.current,
            deletedCards: latestDeleted,
            languagePreference: latestPref,
            languagePreferenceUpdatedAt: latestPrefTs,
          })
        ) {
          if (!cancelled) setPendingCloudSync(false);
          return;
        }
        beginCloudSyncProgress(cardsRef.current.length, 'push', 1);
        setIsSyncingOffline(true);
        try {
          await ensureInitialGistPullBeforePush(cloudConfig);
          await updateGistDeck(
            cloudConfig.gistToken!,
            cloudConfig.gistId!,
            {
              cards: cardsRef.current,
              studyHistory: studyHistoryRef.current,
              longestStreak: longestStreakRef.current,
              deletedCards: prunedDeletedCards(),
              languagePreference: languagePreferenceRef.current,
              languagePreferenceUpdatedAt: languagePreferenceUpdatedAtRef.current,
            },
            { onProgress: handleBackgroundCloudProgress }
          );
        } catch (e) {
          console.error('Pending Gist sync flush failed:', e);
        } finally {
          if (!cancelled) {
            setPendingCloudSync(false);
            setIsSyncingOffline(false);
            setCloudSyncProgress(null);
          }
        }
        return;
      }

      const plan = getPendingCloudSyncPlan(cloudConfig.pantryId, {
        cards,
        studyHistory,
        longestStreak,
        deletedCards: latestDeleted,
        languagePreference: latestPref,
        languagePreferenceUpdatedAt: latestPrefTs,
      });
      if (!plan.hasChanges) {
        if (!cancelled) setPendingCloudSync(false);
        return;
      }
      beginCloudSyncProgress(
        cards.length,
        'push',
        plan.isMetadataOnly ? 1 : Math.max(1, plan.dirtyChunkCount)
      );
      setIsSyncingOffline(true);
      try {
        await updateDeck(
          cloudConfig.pantryId,
          {
            cards,
            studyHistory,
            longestStreak,
            deletedCards: latestDeleted,
            languagePreference: latestPref,
            languagePreferenceUpdatedAt: latestPrefTs,
          },
          { onProgress: handleBackgroundCloudProgress }
        );
      } catch (e) {
        console.error('Pending sync flush failed:', e);
      } finally {
        if (!cancelled) {
          setPendingCloudSync(false);
          setIsSyncingOffline(false);
          setCloudSyncProgress(null);
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
        if (loadedData.languagePreference) {
          applyIncomingLanguagePreference(
            loadedData.languagePreference,
            loadedData.languagePreferenceUpdatedAt
          );
        }
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
    await saveToLocalFile(fileHandle, {
      cards,
      studyHistory,
      longestStreak,
      deletedCards: prunedDeletedCards(),
      languagePreference,
      languagePreferenceUpdatedAt,
    });
    setIsFileSaving(false);
    trackEvent(TRACKING_ACTION.MANUAL_SAVE, TRACKING_CATEGORY.DATA);
  };

  const handleExportData = () => {
    const jsonContent = generateJSON({
      cards,
      studyHistory,
      longestStreak,
      deletedCards: prunedDeletedCards(),
      languagePreference,
      languagePreferenceUpdatedAt,
    });
    const date = new Date().toISOString().split('T')[0];
    downloadJSON(jsonContent, `lumina_backup_${date}.json`);
    trackEvent(TRACKING_ACTION.EXPORT_CSV, TRACKING_CATEGORY.DATA);
  };

  const handleImportData = async (file: File) => {
    const text = await file.text();
    const importedData = parseFileContent(text);
    if (importedData.cards.length === 0) throw new Error("No valid data found");
    if (importedData.languagePreference) {
      applyIncomingLanguagePreference(
        importedData.languagePreference,
        importedData.languagePreferenceUpdatedAt
      );
    }
    const importNow = Date.now();
    const stampedCards = importedData.cards.map(c => ({
      ...c,
      updatedAt: Math.max(c.updatedAt ?? 0, importNow),
    }));
    performMerge(stampedCards, importedData.deletedCards ?? {}, { preferIncomingContent: true });
    if (importedData.studyHistory) {
      const mergedHist = mergeHistoryRecords(studyHistoryRef.current, importedData.studyHistory);
      studyHistoryRef.current = mergedHist;
      setStudyHistory(mergedHist);
    }
    if (importedData.longestStreak) {
      const mergedStreakVal = Math.max(longestStreakRef.current, importedData.longestStreak);
      longestStreakRef.current = mergedStreakVal;
      setLongestStreak(mergedStreakVal);
    }
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
        languagePreference: undefined as MeaningLanguagePreference | undefined,
        languagePreferenceUpdatedAt: undefined as number | undefined,
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
            languagePreference: fetchedOld.languagePreference,
            languagePreferenceUpdatedAt: fetchedOld.languagePreferenceUpdatedAt,
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
      const mergedLangPref = resolveMergedLanguagePreference(oldCloudData, newCloudData);

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
      onProgress?.({
        percent: 72,
        step: `Uploading ${mergedCards.length} flashcards to Pantry...`,
        estimatedRemainingSec: Math.max(2, Math.ceil(mergedCards.length / 65) * 2),
      });
      await updateDeck(
        cleanNewId,
        {
          cards: mergedCards,
          studyHistory: mergedHistory,
          longestStreak: mergedStreak,
          deletedCards: mergedDeletedRecord,
          languagePreference: mergedLangPref.preference,
          languagePreferenceUpdatedAt: mergedLangPref.updatedAt,
        },
        {
          onProgress: ({ currentChunk, totalChunks, estimatedRemainingSec }) => {
            const pct = Math.min(95, 72 + Math.round(((currentChunk - 0.3) / Math.max(1, totalChunks)) * 23));
            onProgress?.({
              percent: pct,
              step:
                totalChunks > 1
                  ? `Uploading deck chunk ${currentChunk} of ${totalChunks} to Pantry...`
                  : `Uploading ${mergedCards.length} flashcards to Pantry...`,
              estimatedRemainingSec: estimatedRemainingSec ?? Math.max(1, (totalChunks - currentChunk + 1) * 2),
            });
          },
        }
      );

      const localCount = cards.length;
      const cloudCount = (newCloudData.cards?.length ?? 0) + (oldCloudData.cards?.length ?? 0);

      // 7. Update local state & persistence
      onProgress?.({ percent: 100, step: 'Sync complete!' });
      languagePreferenceRef.current = mergedLangPref.preference;
      languagePreferenceUpdatedAtRef.current = mergedLangPref.updatedAt;
      setLanguagePreference(mergedLangPref.preference);
      setLanguagePreferenceUpdatedAt(mergedLangPref.updatedAt);
      saveLanguagePreferenceToStorage(mergedLangPref.preference, mergedLangPref.updatedAt);
      const nextDeletedMap = new Map(Object.entries(mergedDeletedRecord));
      deletedCardsRef.current = nextDeletedMap;
      cardsRef.current = mergedCards;
      studyHistoryRef.current = mergedHistory;
      longestStreakRef.current = mergedStreak;
      setDeletedCards(nextDeletedMap);
      setCards(mergedCards);
      setStudyHistory(mergedHistory);
      setLongestStreak(mergedStreak);
      setPendingCloudSync(false);
      const completedAt = Date.now();
      lastKeepAliveRef.current = completedAt;
      hasSyncedInitialCloudPullRef.current = true;
      lastCloudPullAtRef.current = completedAt;

      skipNextCloudAutoSaveRef.current = true;
      const config = { pantryId: cleanNewId };
      cloudConfigRef.current = config;
      setCloudConfig(config);
      persistCloudConfigToLocalStorage(config);
      saveAppDataToIDB({
        cards: mergedCards,
        studyHistory: mergedHistory,
        longestStreak: mergedStreak,
        deletedCards: mergedDeletedRecord,
        cloudConfig: config,
        languagePreference: mergedLangPref.preference,
        languagePreferenceUpdatedAt: mergedLangPref.updatedAt,
      }).catch(console.error);
      setTrackingUserId(cleanNewId);
      trackEvent(TRACKING_ACTION.CONNECT_CLOUD, TRACKING_CATEGORY.CLOUD);

      if (fileHandle) {
        saveToLocalFile(fileHandle, {
          cards: mergedCards,
          studyHistory: mergedHistory,
          longestStreak: mergedStreak,
          deletedCards: mergedDeletedRecord,
          languagePreference: mergedLangPref.preference,
          languagePreferenceUpdatedAt: mergedLangPref.updatedAt,
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

  const handleConnectGist = async (
    token: string,
    options?: {
      gistId?: string;
      migrateFromPantryId?: string;
      onProgress?: (progress: CloudSyncProgress) => void;
    }
  ): Promise<{
    gistId: string;
    cardCount: number;
    localCount: number;
    cloudCount: number;
    pantryMigratedCount: number;
    historyDays: number;
  }> => {
    const cleanToken = token.trim();
    const cleanGistIdInput = normalizeGistId(options?.gistId);
    const cleanPantryId = (
      options?.migrateFromPantryId?.trim() ||
      (!isGistCloud(cloudConfig) && cloudConfig?.pantryId ? cloudConfig.pantryId.trim() : '')
    );

    isMigratingCloudRef.current = true;
    try {
      const onProgress = options?.onProgress;

      // 1. Best-effort pull from Pantry if migrating from an existing or specified Pantry ID
      let pantryCloudData = {
        cards: [] as Flashcard[],
        studyHistory: {} as Record<string, number>,
        longestStreak: 0,
        deletedCards: {} as Record<string, number>,
        languagePreference: undefined as MeaningLanguagePreference | undefined,
        languagePreferenceUpdatedAt: undefined as number | undefined,
      };

      if (cleanPantryId) {
        onProgress?.({
          percent: 14,
          step: 'Fetching flashcards from Pantry before migrating to GitHub Gist...',
          estimatedRemainingSec: 2,
        });
        try {
          const fetchedPantry = await getDeck(cleanPantryId, undefined, {
            retries: 1,
            localCards: cardsRef.current,
            onProgress: ({ currentChunk, totalChunks }) => {
              const pct = Math.min(35, 14 + Math.round((currentChunk / Math.max(1, totalChunks)) * 20));
              onProgress?.({
                percent: pct,
                step:
                  totalChunks > 1
                    ? `Loading Pantry chunk ${currentChunk} of ${totalChunks} for migration...`
                    : 'Fetching flashcards from Pantry...',
                estimatedRemainingSec: Math.max(1, totalChunks - currentChunk + 1),
              });
            },
          });
          pantryCloudData = {
            cards: fetchedPantry.cards ?? [],
            studyHistory: fetchedPantry.studyHistory ?? {},
            longestStreak: fetchedPantry.longestStreak ?? 0,
            deletedCards: fetchedPantry.deletedCards ?? {},
            languagePreference: fetchedPantry.languagePreference,
            languagePreferenceUpdatedAt: fetchedPantry.languagePreferenceUpdatedAt,
          };
        } catch (err) {
          console.warn('Best-effort Pantry pull during Gist migration failed (using local deck):', err);
        }
      }

      // 2. Find or create the target GitHub Secret Gist and fetch any flashcards already stored in it
      onProgress?.({
        percent: 40,
        step: cleanGistIdInput
          ? 'Verifying GitHub Gist...'
          : 'Finding or creating Secret Gist on GitHub...',
        estimatedRemainingSec: 1,
      });
      const { gistId, createdNewGist, existingData: gistCloudData } = await findOrCreateLuminaGist(
        cleanToken,
        cleanGistIdInput || undefined,
        (info) => {
          onProgress?.({
            percent: info.percent ?? 48,
            step: info.step || 'Connecting to GitHub Gist...',
            estimatedRemainingSec: info.estimatedRemainingSec ?? 1,
          });
        }
      );

      // 3. Lossless 3-way merge: Local cards + Pantry cards + Existing Gist cards
      onProgress?.({
        percent: 65,
        step: 'Merging local, Pantry, and GitHub Gist flashcards & study history...',
        estimatedRemainingSec: 1,
      });
      const localSnapshot = cardsRef.current;
      const afterPantryCards = mergeCardArrays(
        localSnapshot,
        pantryCloudData.cards,
        {},
        { ignoreTombstones: true }
      );
      const mergedCards = mergeCardArrays(
        afterPantryCards,
        gistCloudData?.cards ?? [],
        {},
        { ignoreTombstones: true }
      );
      const mergedHistory = mergeHistoryRecords(
        studyHistory,
        pantryCloudData.studyHistory,
        gistCloudData?.studyHistory
      );
      const mergedStreak = Math.max(
        longestStreak,
        pantryCloudData.longestStreak || 0,
        gistCloudData?.longestStreak || 0,
        calculateCurrentStreak(mergedHistory)
      );
      const mergedLangPref = resolveMergedLanguagePreference(pantryCloudData, gistCloudData);

      const activeIds = new Set(mergedCards.map(c => c.id));
      const cutoff = Date.now() - TOMBSTONE_TTL;
      const mergedDeletedRecord: Record<string, number> = {};
      for (const src of [
        prunedDeletedCards(),
        pantryCloudData.deletedCards,
        gistCloudData?.deletedCards ?? {},
      ]) {
        for (const [id, deletedAt] of Object.entries(src)) {
          if (deletedAt >= cutoff && !activeIds.has(id)) {
            mergedDeletedRecord[id] = Math.max(mergedDeletedRecord[id] || 0, deletedAt);
          }
        }
      }

      // 4. Upload the complete merged deck to GitHub Gist in a single PATCH request
      onProgress?.({
        percent: 80,
        step: `Saving ${mergedCards.length} flashcards to GitHub Gist...`,
        estimatedRemainingSec: 1,
      });
      await updateGistDeck(
        cleanToken,
        gistId,
        {
          cards: mergedCards,
          studyHistory: mergedHistory,
          longestStreak: mergedStreak,
          deletedCards: mergedDeletedRecord,
          languagePreference: mergedLangPref.preference,
          languagePreferenceUpdatedAt: mergedLangPref.updatedAt,
        },
        {
          force: true,
          onProgress: (info) => {
            onProgress?.({
              percent: info.percent ?? 90,
              step: info.step || `Saving ${mergedCards.length} flashcards to GitHub Gist...`,
              estimatedRemainingSec: info.estimatedRemainingSec ?? 1,
            });
          },
        }
      );

      const localCount = localSnapshot.length;
      const pantryMigratedCount = pantryCloudData.cards.length;
      const gistCount = gistCloudData?.cards?.length ?? 0;
      const cloudCount = gistCount + pantryMigratedCount;

      // 5. Update local state & persistence to use GitHub Gist
      onProgress?.({ percent: 100, step: 'Synced to GitHub Gist!' });
      languagePreferenceRef.current = mergedLangPref.preference;
      languagePreferenceUpdatedAtRef.current = mergedLangPref.updatedAt;
      setLanguagePreference(mergedLangPref.preference);
      setLanguagePreferenceUpdatedAt(mergedLangPref.updatedAt);
      saveLanguagePreferenceToStorage(mergedLangPref.preference, mergedLangPref.updatedAt);
      const nextDeletedMap = new Map(Object.entries(mergedDeletedRecord));
      deletedCardsRef.current = nextDeletedMap;
      cardsRef.current = mergedCards;
      studyHistoryRef.current = mergedHistory;
      longestStreakRef.current = mergedStreak;
      setDeletedCards(nextDeletedMap);
      setCards(mergedCards);
      setStudyHistory(mergedHistory);
      setLongestStreak(mergedStreak);
      setPendingCloudSync(false);
      hasSyncedInitialCloudPullRef.current = true;
      lastCloudPullAtRef.current = Date.now();

      skipNextCloudAutoSaveRef.current = true;
      const config: CloudConfig = {
        provider: 'gist',
        gistToken: cleanToken,
        gistId,
        pantryId: gistId,
      };
      cloudConfigRef.current = config;
      setCloudConfig(config);
      persistCloudConfigToLocalStorage(config);
      saveAppDataToIDB({
        cards: mergedCards,
        studyHistory: mergedHistory,
        longestStreak: mergedStreak,
        deletedCards: mergedDeletedRecord,
        cloudConfig: config,
        languagePreference: mergedLangPref.preference,
        languagePreferenceUpdatedAt: mergedLangPref.updatedAt,
      }).catch(console.error);
      setTrackingUserId(gistId);
      trackEvent(TRACKING_ACTION.CONNECT_CLOUD, TRACKING_CATEGORY.CLOUD, 'github_gist');

      if (fileHandle) {
        saveToLocalFile(fileHandle, {
          cards: mergedCards,
          studyHistory: mergedHistory,
          longestStreak: mergedStreak,
          deletedCards: mergedDeletedRecord,
          languagePreference: mergedLangPref.preference,
          languagePreferenceUpdatedAt: mergedLangPref.updatedAt,
        }).catch(() => {});
      }

      return {
        gistId,
        createdNewGist: !!createdNewGist,
        cardCount: mergedCards.length,
        localCount,
        pantryCount: pantryMigratedCount,
        gistCount,
        cloudCount,
        pantryMigratedCount,
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
    cloudConfigRef.current = null;
    hasSyncedInitialCloudPullRef.current = false;
    lastCloudPullAtRef.current = 0;
    setCloudConfig(null);
    setPendingCloudSync(false);
    setIsCloudSaving(false);
    setIsSyncingOffline(false);
    persistCloudConfigToLocalStorage(null);
    saveAppDataToIDB({
      cards: cardsRef.current,
      studyHistory: studyHistoryRef.current,
      longestStreak: longestStreakRef.current,
      deletedCards: prunedDeletedCards(),
      cloudConfig: null,
      languagePreference: languagePreferenceRef.current,
      languagePreferenceUpdatedAt: languagePreferenceUpdatedAtRef.current,
    }).catch(console.error);
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

  const handleCloudPull = async (onProgress?: (progress: CloudSyncProgress) => void) => {
    if (!cloudConfig) return;
    beginCloudSyncProgress(cardsRef.current.length, 'pull');
    setIsCloudSaving(true);
    try {
      const usingGist = isGistCloud(cloudConfig);
      const applyPulledCloudData = (partialOrFull: {
        cards?: Flashcard[];
        deletedCards?: Record<string, number>;
        studyHistory?: Record<string, number>;
        longestStreak?: number;
        languagePreference?: MeaningLanguagePreference;
        languagePreferenceUpdatedAt?: number;
      }) => {
        skipNextCloudAutoSaveRef.current = true;
        applyPulledSnapshotToState(partialOrFull, { preferIncomingContent: true });
      };

      const cloudData = usingGist
        ? await getGistDeck(cloudConfig.gistToken!, cloudConfig.gistId!, {
            forceRefresh: true,
            onProgress: (info) => {
              handleBackgroundCloudProgress(info);
              onProgress?.({
                percent: info.percent ?? 50,
                step: info.step || 'Loading flashcards from GitHub Gist...',
                estimatedRemainingSec: info.estimatedRemainingSec ?? 1,
              });
            },
          })
        : await getDeck(cloudConfig.pantryId, undefined, {
            strict: true,
            localCards: cardsRef.current,
            onPartialCards: (partial) => {
              applyPulledCloudData(partial);
            },
            onProgress: (info) => {
              handleBackgroundCloudProgress(info);
              onProgress?.({
                percent: info.percent ?? Math.min(95, Math.round(((info.currentChunk ?? 1) / Math.max(1, info.totalChunks ?? 1)) * 100)),
                step: info.step || 'Loading flashcards from Cloud...',
                estimatedRemainingSec: info.estimatedRemainingSec,
              });
            },
          });
      applyPulledCloudData(cloudData);
      const pulledAt = Date.now();
      hasSyncedInitialCloudPullRef.current = true;
      lastCloudPullAtRef.current = pulledAt;
      lastKeepAliveRef.current = pulledAt;

      if (usingGist) {
        const hasLocalDeltaAfterPull = hasPendingGistSyncChanges(cloudConfig.gistId!, {
          cards: cardsRef.current,
          studyHistory: studyHistoryRef.current,
          longestStreak: longestStreakRef.current,
          deletedCards: prunedDeletedCards(),
          languagePreference: languagePreferenceRef.current,
          languagePreferenceUpdatedAt: languagePreferenceUpdatedAtRef.current,
        });
        skipNextCloudAutoSaveRef.current = !hasLocalDeltaAfterPull;
      }

      trackEvent(TRACKING_ACTION.CLOUD_PULL, TRACKING_CATEGORY.CLOUD);
      // Immediately flush to local file so both are in sync
      if (fileHandle) {
        try {
          await saveToLocalFile(fileHandle, {
            cards: cardsRef.current,
            studyHistory: studyHistoryRef.current,
            longestStreak: longestStreakRef.current,
            deletedCards: prunedDeletedCards(),
            languagePreference: languagePreferenceRef.current,
            languagePreferenceUpdatedAt: languagePreferenceUpdatedAtRef.current,
          });
        } catch (e) {
          console.warn('Could not flush cloud pull to local file', e);
        }
      }
    } finally {
      setIsCloudSaving(false);
      setCloudSyncProgress(null);
    }
  };

  const handleCloudPush = async (onProgress?: (progress: CloudSyncProgress) => void) => {
    if (!cloudConfig) return;
    beginCloudSyncProgress(cardsRef.current.length, 'push');
    setIsCloudSaving(true);
    try {
      if (isGistCloud(cloudConfig)) {
        await ensureInitialGistPullBeforePush(cloudConfig);
        await updateGistDeck(
          cloudConfig.gistToken!,
          cloudConfig.gistId!,
          {
            cards: cardsRef.current,
            studyHistory: studyHistoryRef.current,
            longestStreak: longestStreakRef.current,
            deletedCards: prunedDeletedCards(),
            languagePreference: languagePreferenceRef.current,
            languagePreferenceUpdatedAt: languagePreferenceUpdatedAtRef.current,
          },
          {
            force: true,
            onProgress: (info) => {
              handleBackgroundCloudProgress(info);
              onProgress?.({
                percent: info.percent ?? 50,
                step: info.step || 'Saving flashcards to GitHub Gist...',
                estimatedRemainingSec: info.estimatedRemainingSec ?? 1,
              });
            },
          }
        );
      } else {
        await updateDeck(
          cloudConfig.pantryId,
          {
            cards: cardsRef.current,
            studyHistory: studyHistoryRef.current,
            longestStreak: longestStreakRef.current,
            deletedCards: prunedDeletedCards(),
            languagePreference: languagePreferenceRef.current,
            languagePreferenceUpdatedAt: languagePreferenceUpdatedAtRef.current,
          },
          {
            onProgress: (info) => {
              handleBackgroundCloudProgress(info);
              onProgress?.({
                percent: info.percent ?? 25,
                step: info.step || 'Uploading flashcards to Cloud...',
                estimatedRemainingSec: info.estimatedRemainingSec,
              });
            },
          }
        );
      }
      setPendingCloudSync(false);
      trackEvent(TRACKING_ACTION.CLOUD_PUSH, TRACKING_CATEGORY.CLOUD);
    } finally {
      setIsCloudSaving(false);
      setCloudSyncProgress(null);
    }
  };

  // --- App Logic ---

  // Helper to attach an asynchronous Persian translation onto a specific card once resolved
  // NOTE: Do NOT mutate `updatedAt` on automatic background translation enrichment so we never
  // overshadow user edits or cross-device study timestamps; cloud hash functions hash `translations` directly.
  const populateSingleCardTranslationAsync = useCallback(
    (cardId: string, word: string, mainDefinition: string, partOfSpeech?: string) => {
      if (!word.trim() || !mainDefinition.trim()) return;
      translateCardMeaningToPersian({ word, mainDefinition, partOfSpeech })
        .then(resolved => {
          if (!resolved?.fa) return;
          setCards(prev => {
            let changed = false;
            const next = prev.map(c => {
              if (c.id !== cardId) return c;
              const merged = mergeTranslations(c.translations, resolved, false);
              if (merged?.fa === c.translations?.fa) return c;
              changed = true;
              return {
                ...c,
                translations: merged,
              };
            });
            if (changed) {
              cardsRef.current = next;
            }
            return changed ? next : prev;
          });
        })
        .catch(() => {
          // Non-fatal: background backfill or manual retry can translate later
        });
    },
    []
  );

  // Batch backfill missing Persian translations for pre-existing cards
  const runPersianBackfill = useCallback(async (forceRetryAll = false) => {
    if (isBackfillingRef.current) return;

    const candidates = cardsRef.current.filter(
      c =>
        cardNeedsPersianBackfill(c) &&
        (forceRetryAll || !autoAttemptedBackfillIdsRef.current.has(c.id))
    );
    if (candidates.length === 0) return;

    isBackfillingRef.current = true;
    setIsBackfillingTranslations(true);
    setBackfillProgress({ completed: 0, total: candidates.length });

    try {
      const BATCH_SIZE = 4;
      for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
        const batch = candidates.slice(i, i + BATCH_SIZE);
        batch.forEach(c => autoAttemptedBackfillIdsRef.current.add(c.id));

        const results = await Promise.all(
          batch.map(async card => {
            try {
              const resolved = await translateCardMeaningToPersian({
                word: card.word,
                mainDefinition: card.mainDefinition,
                partOfSpeech: card.partOfSpeech,
                existingTranslations: card.translations,
              });
              return { id: card.id, resolved };
            } catch {
              return { id: card.id, resolved: undefined };
            }
          })
        );

        const resolvedMap = new Map<string, LocalizedTranslations>();
        for (const r of results) {
          if (r.resolved?.fa) {
            resolvedMap.set(r.id, r.resolved);
          }
        }

        if (resolvedMap.size > 0) {
          setCards(prev => {
            let changed = false;
            const next = prev.map(card => {
              const incoming = resolvedMap.get(card.id);
              if (!incoming) return card;
              const merged = mergeTranslations(card.translations, incoming, false);
              if (merged?.fa === card.translations?.fa) return card;
              changed = true;
              return {
                ...card,
                translations: merged,
              };
            });
            if (changed) {
              cardsRef.current = next;
            }
            return changed ? next : prev;
          });
        }

        setBackfillProgress({
          completed: Math.min(i + batch.length, candidates.length),
          total: candidates.length,
        });
      }
    } finally {
      isBackfillingRef.current = false;
      setIsBackfillingTranslations(false);
      setBackfillProgress(null);
    }
  }, []);

  // Automatically backfill legacy cards in the background when user selects Persian or Both
  useEffect(() => {
    if (!isDataLoaded) return;
    if (languagePreference !== 'fa' && languagePreference !== 'both') return;
    if (isBackfillingRef.current) return;

    const hasUntriedMissing = cards.some(
      c => cardNeedsPersianBackfill(c) && !autoAttemptedBackfillIdsRef.current.has(c.id)
    );
    if (!hasUntriedMissing) return;

    const timer = setTimeout(() => {
      void runPersianBackfill(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [isDataLoaded, languagePreference, cards, runPersianBackfill]);

  const handleAddCard = (
    entry: WordEntry,
    definition: string,
    example: string,
    partOfSpeech: string,
    tags?: string[],
    translations?: LocalizedTranslations
  ) => {
    const matchingMeaning = entry.meanings?.find(m => m.partOfSpeech === partOfSpeech) || entry.meanings?.[0];
    const synonyms = matchingMeaning?.synonyms?.slice(0, 6);
    const antonyms = matchingMeaning?.antonyms?.slice(0, 6);
    const cleanedTags = tags
      ? Array.from(new Set(tags.map(t => t.trim()).filter(Boolean)))
      : [];
    const cleanTranslations = sanitizeTranslations(translations);
    const cardId = crypto.randomUUID();
    const newCard: Flashcard = {
      id: cardId,
      word: entry.word,
      phonetic: entry.phonetic,
      audio: entry.audio,
      image: entry.image,
      mainDefinition: definition,
      translations: cleanTranslations,
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
    setCards(prev => {
      const next = [newCard, ...prev];
      cardsRef.current = next;
      return next;
    });
    if (!cleanTranslations?.fa) {
      populateSingleCardTranslationAsync(cardId, entry.word, definition, partOfSpeech);
    }
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
      studyHistoryRef.current = updatedHistory;
      const newCurrentStreak = calculateCurrentStreak(updatedHistory);
      setLongestStreak(prevStreak => {
        const nextStreak = Math.max(prevStreak, newCurrentStreak);
        longestStreakRef.current = nextStreak;
        return nextStreak;
      });
      return updatedHistory;
    });
  };

  const handleSessionComplete = () => {
    recordActivity();
  };

  const handleStartStudySession = (initialTag?: string, initialChapters?: string[]) => {
    setSessionInitialTag(initialTag);
    setSessionInitialChapters(initialChapters);
    setIsSessionConfigOpen(true);
  };

  const handleSessionStart = (config: { mode: SessionMode; count?: number; tag?: string; chapters?: string[] }) => {
    navigate('/study', { state: { sessionConfig: config } });
  };

  // Navigate from Dashboard search → Dictionary, passing query via router state
  const handleQuickSearch = (word: string) => {
    navigate('/dictionary', { state: { query: word } });
  };

  const handleReviewCard = (id: string, quality: number) => {
    const now = Date.now();
    setCards(prev => {
      const next = prev.map(card => {
        if (card.id !== id) return card;

        let { repetition = 0 } = card;
        let nextReviewDate = now;
        let status = FlashcardStatus.Learning;

        if (quality === 1) { // Again
          repetition = 0;
          nextReviewDate = now;
          status = FlashcardStatus.Learning;
        } else if (quality === 3) { // Learned
          repetition += 1;
          status = FlashcardStatus.Learning;

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
          lastReviewed: now,
          statusUpdatedAt: now,
          updatedAt: now
        };
      });
      cardsRef.current = next;
      return next;
    });
    recordActivity();
    trackEvent(TRACKING_ACTION.UPDATE_STATUS, TRACKING_CATEGORY.FLASHCARDS, `quality_${quality}`);
  };

  const handleRestoreCard = (previousCard: Flashcard) => {
    const now = Date.now();
    setCards(prev => {
      const next = prev.map(card =>
        card.id === previousCard.id
          ? { ...previousCard, statusUpdatedAt: now, updatedAt: now }
          : card
      );
      cardsRef.current = next;
      return next;
    });
  };

  const handleCreateCustomCard = (data: CustomCardFormData) => {
    const now = Date.now();
    const cleanedTags = data.tags
      ? Array.from(new Set(data.tags.map(t => t.trim()).filter(Boolean)))
      : [];
    const cleanTranslations = sanitizeTranslations(data.translations);
    const cardId = crypto.randomUUID();
    const newCard: Flashcard = {
      id: cardId,
      word: data.word.trim(),
      partOfSpeech: data.partOfSpeech.trim() || 'noun',
      phonetic: data.phonetic?.trim() || undefined,
      mainDefinition: data.mainDefinition.trim(),
      translations: cleanTranslations,
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
    if (!cleanTranslations?.fa) {
      populateSingleCardTranslationAsync(cardId, newCard.word, newCard.mainDefinition, newCard.partOfSpeech);
    }
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
      translations?: LocalizedTranslations;
      example?: string;
      image?: string;
      tags?: string[];
    }
  ) => {
    let shouldReTranslate = false;
    let targetWord = '';
    let targetDef = '';
    let targetPos = '';

    setCards(prev =>
      prev.map(card => {
        if (card.id !== id) return card;
        const cleanedTags = updates.tags !== undefined
          ? Array.from(new Set(updates.tags.map(t => t.trim()).filter(Boolean)))
          : card.tags;
        const nextWord = updates.word !== undefined ? updates.word.trim() : card.word;
        const nextPos = updates.partOfSpeech !== undefined ? updates.partOfSpeech.trim() : card.partOfSpeech;
        const nextDef = updates.mainDefinition !== undefined ? updates.mainDefinition.trim() : card.mainDefinition;
        const defChanged = nextDef !== card.mainDefinition;

        let nextTranslations = card.translations;
        if (updates.translations !== undefined) {
          const explicitClean = sanitizeTranslations(updates.translations);
          if (explicitClean?.fa) {
            nextTranslations = explicitClean;
          } else {
            nextTranslations = undefined;
            shouldReTranslate = true;
          }
        } else if (defChanged) {
          nextTranslations = undefined;
          shouldReTranslate = true;
        }

        if (shouldReTranslate) {
          targetWord = nextWord;
          targetDef = nextDef;
          targetPos = nextPos;
        }

        return {
          ...card,
          word: nextWord,
          partOfSpeech: nextPos,
          phonetic: updates.phonetic !== undefined ? (updates.phonetic.trim() || undefined) : card.phonetic,
          mainDefinition: nextDef,
          translations: nextTranslations,
          example: updates.example !== undefined ? (updates.example.trim() || undefined) : card.example,
          image: updates.image !== undefined ? (updates.image.trim() || undefined) : card.image,
          tags: cleanedTags && cleanedTags.length > 0 ? cleanedTags : undefined,
          updatedAt: Date.now(),
        };
      })
    );

    if (shouldReTranslate && targetWord && targetDef) {
      populateSingleCardTranslationAsync(id, targetWord, targetDef, targetPos);
    }
  };

  const handleImportBookWords = (bookTitle: string, words: BookExtractedWord[]) => {
    const cleanTitle = bookTitle.trim() || 'Untitled Book';
    const bookTag = `Book: ${cleanTitle}`;
    const bookTagLower = bookTag.toLowerCase();
    const now = Date.now();
    const cardsNeedingAsyncTranslation: Array<{ id: string; word: string; def: string; pos?: string }> = [];

    // Map incoming words by normalized lowercase word
    const incomingByWord = new Map<string, { wordObj: BookExtractedWord; idx: number }>();
    words.forEach((w, idx) => {
      const key = w.word.trim().toLowerCase();
      if (key && !incomingByWord.has(key)) {
        incomingByWord.set(key, { wordObj: w, idx });
      }
    });

    setCards(prev => {
      const matchedKeys = new Set<string>();

      const updatedExisting = prev.map(existing => {
        const key = existing.word.trim().toLowerCase();
        const match = incomingByWord.get(key);
        if (!match || matchedKeys.has(key)) {
          return existing;
        }
        matchedKeys.add(key);

        const { wordObj: w, idx } = match;
        const cleanChapter = w.chapter?.trim();
        const newBookTags = cleanChapter
          ? [bookTag, `${bookTag} / ${cleanChapter}`]
          : [bookTag];

        // Preserve all existing tags from other books or custom tags, replacing only tags for this same book
        const retainedTags = (existing.tags || []).filter(t => {
          const lower = t.trim().toLowerCase();
          return lower !== bookTagLower && !lower.startsWith(`${bookTagLower} /`);
        });
        const mergedTags = [...retainedTags];
        for (const nt of newBookTags) {
          if (!mergedTags.some(t => t.trim().toLowerCase() === nt.toLowerCase())) {
            mergedTags.push(nt);
          }
        }

        const mergedTrans = mergeTranslations(existing.translations, w.translations, false);
        if (!mergedTrans?.fa) {
          cardsNeedingAsyncTranslation.push({
            id: existing.id,
            word: existing.word,
            def: existing.mainDefinition,
            pos: existing.partOfSpeech,
          });
        }

        return {
          ...existing,
          // Keep existing status, repetition, review schedule, and core definition intact;
          // only fill in missing optional metadata and append the new book tags
          phonetic: existing.phonetic || w.phonetic?.trim() || undefined,
          audio: existing.audio || w.audio,
          translations: mergedTrans,
          example: existing.example || w.bookSentence?.trim() || undefined,
          synonyms:
            existing.synonyms && existing.synonyms.length > 0
              ? existing.synonyms
              : w.synonyms && w.synonyms.length > 0
              ? w.synonyms
              : undefined,
          antonyms:
            existing.antonyms && existing.antonyms.length > 0
              ? existing.antonyms
              : w.antonyms && w.antonyms.length > 0
              ? w.antonyms
              : undefined,
          complexityLevel: existing.complexityLevel ?? w.complexityLevel,
          complexityScore: existing.complexityScore ?? w.complexityScore,
          bookChapter: existing.bookChapter || cleanChapter || undefined,
          tags: mergedTags,
          updatedAt: now + idx,
        };
      });

      const newBookCards: Flashcard[] = [];
      for (const [key, { wordObj: w, idx }] of incomingByWord.entries()) {
        if (matchedKeys.has(key)) continue;
        const cleanChapter = w.chapter?.trim();
        const cardTags = cleanChapter
          ? [bookTag, `${bookTag} / ${cleanChapter}`]
          : [bookTag];
        const cardId = crypto.randomUUID();
        const cleanTrans = sanitizeTranslations(w.translations);
        if (!cleanTrans?.fa) {
          cardsNeedingAsyncTranslation.push({
            id: cardId,
            word: w.word.trim(),
            def: w.mainDefinition.trim(),
            pos: w.partOfSpeech.trim() || 'noun',
          });
        }
        newBookCards.push({
          id: cardId,
          word: w.word.trim(),
          partOfSpeech: w.partOfSpeech.trim() || 'noun',
          phonetic: w.phonetic?.trim() || undefined,
          audio: w.audio,
          mainDefinition: w.mainDefinition.trim(),
          translations: cleanTrans,
          example: w.bookSentence?.trim() || undefined,
          synonyms: w.synonyms && w.synonyms.length > 0 ? w.synonyms : undefined,
          antonyms: w.antonyms && w.antonyms.length > 0 ? w.antonyms : undefined,
          complexityLevel: w.complexityLevel,
          complexityScore: w.complexityScore,
          bookChapter: cleanChapter || undefined,
          tags: cardTags,
          status: FlashcardStatus.New,
          lastReviewed: 0,
          createdAt: now + idx,
          repetition: 0,
          nextReviewDate: now,
          updatedAt: now + idx,
        });
      }

      const next = [...newBookCards, ...updatedExisting];
      cardsRef.current = next;
      return next;
    });

    for (const item of cardsNeedingAsyncTranslation) {
      populateSingleCardTranslationAsync(item.id, item.word, item.def, item.pos);
    }

    recordActivity();
    trackEvent(TRACKING_ACTION.ADD_CARD, TRACKING_CATEGORY.FLASHCARDS, `book_${cleanTitle}`);
  };

  const syncDeletionImmediately = (nextCards: Flashcard[], nextDeletedRecord: Record<string, number>) => {
    // 1. Immediately persist to IndexedDB & localStorage
    persistCardsToLocalStorageSafe(nextCards);
    saveAppDataToIDB({
      cards: nextCards,
      studyHistory,
      longestStreak,
      deletedCards: nextDeletedRecord,
      cloudConfig: cloudConfigRef.current,
      languagePreference: languagePreferenceRef.current,
      languagePreferenceUpdatedAt: languagePreferenceUpdatedAtRef.current,
    })
      .then(() => setLastSavedAt(Date.now()))
      .catch(console.error);

    // 2. Immediately sync to connected local file if any
    if (fileHandle) {
      setIsFileSaving(true);
      saveToLocalFile(fileHandle, {
        cards: nextCards,
        studyHistory,
        longestStreak,
        deletedCards: nextDeletedRecord,
        languagePreference: languagePreferenceRef.current,
        languagePreferenceUpdatedAt: languagePreferenceUpdatedAtRef.current,
      })
        .catch(err => console.error('Immediate file save after deletion failed:', err))
        .finally(() => setIsFileSaving(false));
    }

    // 3. Immediately sync with Cloud (GitHub Gist or Pantry) so deleted flashcards are removed right away
    let activeConfig: CloudConfig | null = cloudConfig || parseSavedCloudConfig(localStorage.getItem(CLOUD_CONFIG_KEY));

    if (activeConfig?.pantryId && !isMigratingCloudRef.current) {
      if (!navigator.onLine) {
        setPendingCloudSync(true);
        return;
      }

      // Skip the 2-second debounced auto-save for this state transition since we are pushing immediately
      skipNextCloudAutoSaveRef.current = true;
      beginCloudSyncProgress(nextCards.length, 'push');
      setIsCloudSaving(true);
      const syncPromise =
        isGistCloud(activeConfig) && activeConfig.gistToken && activeConfig.gistId
          ? updateGistDeck(
              activeConfig.gistToken,
              activeConfig.gistId,
              {
                cards: nextCards,
                studyHistory,
                longestStreak,
                deletedCards: nextDeletedRecord,
                languagePreference: languagePreferenceRef.current,
                languagePreferenceUpdatedAt: languagePreferenceUpdatedAtRef.current,
              },
              { immediate: true, onProgress: handleBackgroundCloudProgress }
            )
          : updateDeck(
              activeConfig.pantryId,
              {
                cards: nextCards,
                studyHistory,
                longestStreak,
                deletedCards: nextDeletedRecord,
                languagePreference: languagePreferenceRef.current,
                languagePreferenceUpdatedAt: languagePreferenceUpdatedAtRef.current,
              },
              { immediate: true, onProgress: handleBackgroundCloudProgress }
            );

      syncPromise
        .then(() => {
          lastKeepAliveRef.current = Date.now();
          setPendingCloudSync(false);
        })
        .catch(err => {
          console.error('Immediate cloud sync after deletion failed:', err);
          setPendingCloudSync(true);
        })
        .finally(() => {
          setIsCloudSaving(false);
          setCloudSyncProgress(null);
        });
    }
  };

  const handleDeleteCard = (id: string) => {
    const now = Date.now();
    const nextCards = cardsRef.current.filter(c => c.id !== id);
    const nextDeletedMap = new Map(deletedCardsRef.current);
    nextDeletedMap.set(id, now);

    cardsRef.current = nextCards;
    deletedCardsRef.current = nextDeletedMap;
    setCards(nextCards);
    setDeletedCards(nextDeletedMap);

    syncDeletionImmediately(nextCards, prunedDeletedCards());
    trackEvent(TRACKING_ACTION.DELETE_CARD, TRACKING_CATEGORY.FLASHCARDS);
  };

  const handleDeleteBook = (bookTag: string) => {
    const cleanTag = bookTag.trim();
    if (!cleanTag) return;
    const now = Date.now();
    const removedIds: string[] = [];

    const cleanTagLower = cleanTag.toLowerCase();
    const nextCards: Flashcard[] = [];

    for (const c of cardsRef.current) {
      const belongsToBook = c.tags?.some(t => {
        const trimmed = t.trim().toLowerCase();
        return trimmed === cleanTagLower || trimmed.startsWith(`${cleanTagLower} /`);
      });
      if (!belongsToBook) {
        nextCards.push(c);
        continue;
      }

      const remainingTags = (c.tags || []).filter(t => {
        const trimmed = t.trim().toLowerCase();
        return trimmed !== cleanTagLower && !trimmed.startsWith(`${cleanTagLower} /`);
      });

      if (remainingTags.length > 0) {
        nextCards.push({
          ...c,
          tags: remainingTags,
          updatedAt: now,
        });
      } else {
        removedIds.push(c.id);
      }
    }

    const nextDeletedMap = new Map(deletedCardsRef.current);
    for (const id of removedIds) {
      nextDeletedMap.set(id, now);
    }

    cardsRef.current = nextCards;
    deletedCardsRef.current = nextDeletedMap;
    setCards(nextCards);
    setDeletedCards(nextDeletedMap);

    syncDeletionImmediately(nextCards, prunedDeletedCards());
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
    `flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-lg text-sm font-medium transition-all duration-200 ${isActive
      ? 'bg-white dark:bg-slate-700 text-brand-600 dark:text-brand-400 shadow-sm'
      : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-700/50'
    }`;

  return (
    <div className="min-h-[100dvh] flex flex-col bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 font-sans overflow-x-clip">
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
        <div className="max-w-5xl mx-auto px-3 sm:px-4 h-14 sm:h-16 flex items-center justify-between gap-2">
          <NavLink to="/" className="flex items-center gap-2 cursor-pointer shrink-0">
            <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center text-white font-serif font-bold text-lg sm:text-xl shadow-lg shadow-brand-500/30">
              L
            </div>
            <span className="font-bold text-xl tracking-tight text-slate-900 dark:text-white hidden sm:block">Lumina</span>
          </NavLink>

          <div className="flex items-center gap-1 sm:gap-2 min-w-0">
            <nav className="flex items-center gap-0.5 sm:gap-1 bg-slate-100/50 dark:bg-slate-800/80 p-1 rounded-xl mr-0.5 sm:mr-2">
              <NavLink to="/" end className={navLinkClass}>
                <Home className="h-4 w-4 shrink-0" />
                <span className="hidden sm:inline">Home</span>
              </NavLink>
              <NavLink to="/dictionary" className={navLinkClass}>
                <Book className="h-4 w-4 shrink-0" />
                <span className="hidden sm:inline">Dictionary</span>
              </NavLink>
              <NavLink
                to="/flashcards"
                className={({ isActive }) =>
                  navLinkClass({ isActive: isActive || location.pathname === '/study' })
                }
              >
                <Layers className="h-4 w-4 shrink-0" />
                <span className="hidden sm:inline">Flashcards</span>
                {cards.length > 0 && (
                  <span className="bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10px] px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                    {cards.length}
                  </span>
                )}
              </NavLink>
              <NavLink to="/statistics" className={navLinkClass}>
                <BarChart2 className="h-4 w-4 shrink-0" />
                <span className="hidden sm:inline">Statistics</span>
              </NavLink>
            </nav>

            <button
              onClick={handleToggleDark}
              className="p-2 sm:p-2.5 rounded-xl transition-all bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200 shrink-0"
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label="Toggle dark mode"
            >
              {isDark ? <Sun className="h-4 w-4 sm:h-5 sm:w-5" /> : <Moon className="h-4 w-4 sm:h-5 sm:w-5" />}
            </button>
            <button
              onClick={() => setIsSettingsOpen(true)}
              data-testid="open-settings-button"
              aria-label="Open settings"
              title="Settings & Language"
              className={`inline-flex items-center gap-1 p-2 sm:px-2.5 sm:py-2 rounded-xl transition-all shrink-0 ${
                languagePreference !== 'en'
                  ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/70 hover:bg-emerald-100 dark:hover:bg-emerald-900/50'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              <Settings className="h-4 w-4 sm:h-5 sm:w-5" />
              {languagePreference !== 'en' && (
                <span className="hidden md:inline text-[10px] font-bold uppercase tracking-wider">
                  {LANGUAGE_PREFERENCE_OPTIONS.find(o => o.value === languagePreference)?.shortBadge}
                </span>
              )}
            </button>
            <button
              onClick={() => setIsDataModalOpen(true)}
              className={`p-2 sm:p-2.5 rounded-xl transition-all hover:bg-slate-200 dark:hover:bg-slate-700 shrink-0 ${fileHandle || cloudConfig ? 'bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 border border-brand-200 dark:border-brand-800' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400'}`}
              title="Manage Data"
            >
              {cloudConfig ? <Cloud className="h-4 w-4 sm:h-5 sm:w-5" /> : (fileHandle ? <Save className="h-4 w-4 sm:h-5 sm:w-5" /> : <Database className="h-4 w-4 sm:h-5 sm:w-5" />)}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-3 sm:px-4 py-4 sm:py-8">
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
                languagePreference={languagePreference}
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
                languagePreference={languagePreference}
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
                languagePreference={languagePreference}
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
                languagePreference={languagePreference}
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
                languagePreference={languagePreference}
              />
            }
          />
        </Routes>
      </main>

      {/* Auto-Save Indicators */}
      {(isFileSaving || isCloudSaving || isSyncingOffline || (!isOnline && cloudConfig)) && (
        <div className="fixed bottom-4 right-4 flex flex-col gap-2 items-end z-50">
          {isFileSaving && !isCloudSaving && !isSyncingOffline && (
            <div className="bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs px-3 py-1.5 rounded-full shadow-lg animate-pulse flex items-center gap-2">
              <Save className="h-3 w-3" />
              Saving to File...
            </div>
          )}
          {(isCloudSaving || isSyncingOffline) && (
            <div
              data-testid="cloud-sync-toast"
              className="bg-slate-900/95 dark:bg-slate-100/95 backdrop-blur-md text-white dark:text-slate-900 text-xs px-4 py-2.5 rounded-2xl shadow-xl border border-slate-700/60 dark:border-slate-300/80 min-w-[260px] max-w-[330px] space-y-1.5 transition-all"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 font-semibold">
                  <Cloud className="h-3.5 w-3.5 text-sky-400 dark:text-sky-600 shrink-0 animate-pulse" />
                  <span>{isSyncingOffline ? 'Syncing offline changes...' : 'Syncing to Cloud...'}</span>
                </div>
                <span
                  data-testid="cloud-sync-percent"
                  className="font-mono font-bold text-sky-400 dark:text-sky-600 shrink-0"
                >
                  {cloudSyncProgress?.percent ?? 15}%
                </span>
              </div>

              <div className="flex items-center justify-between gap-2 text-[11px] text-slate-300 dark:text-slate-600">
                <span data-testid="cloud-sync-step" className="truncate">
                  {cloudSyncProgress?.step || 'Uploading flashcards to Cloud...'}
                </span>
                <span
                  data-testid="cloud-sync-eta"
                  className="shrink-0 font-mono text-[10px] text-slate-400 dark:text-slate-500"
                >
                  {cloudSyncProgress && cloudSyncProgress.estimatedRemainingSec > 0
                    ? `~${cloudSyncProgress.estimatedRemainingSec}s remaining`
                    : 'Almost done...'}
                </span>
              </div>

              <div
                role="progressbar"
                aria-label="Cloud sync progress"
                aria-valuenow={cloudSyncProgress?.percent ?? 15}
                aria-valuemin={0}
                aria-valuemax={100}
                className="w-full h-1.5 bg-slate-700 dark:bg-slate-300 rounded-full overflow-hidden"
              >
                <div
                  className="h-full bg-sky-400 dark:bg-sky-600 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${Math.max(6, Math.min(100, cloudSyncProgress?.percent ?? 15))}%` }}
                />
              </div>
            </div>
          )}
          {!isOnline && cloudConfig && !isCloudSaving && !isSyncingOffline && (
            <div className="bg-amber-500 text-white text-xs px-3 py-1.5 rounded-full shadow-lg flex items-center gap-2">
              <RefreshCw className="h-3 w-3" />
              Offline — changes will sync when connected
            </div>
          )}
        </div>
      )}

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        languagePreference={languagePreference}
        onChangeLanguagePreference={handleChangeLanguagePreference}
        totalCards={cards.length}
        translatedPersianCount={cards.filter(c => Boolean(c.translations?.fa?.trim())).length}
        isBackfilling={isBackfillingTranslations}
        backfillProgress={backfillProgress}
        onTriggerBackfill={() => {
          void runPersianBackfill(true);
        }}
        isDarkMode={isDark}
        onToggleDarkMode={handleToggleDark}
      />

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
        onConnectGist={handleConnectGist}
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
        initialChapters={sessionInitialChapters}
      />
    </div>
  );
};

export default App;