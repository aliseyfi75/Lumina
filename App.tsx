import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Routes, Route, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { Flashcard, WordEntry, FlashcardStatus, FileSystemFileHandle, CloudConfig } from './types';
import { Dashboard } from './components/Dashboard';
import { Dictionary } from './components/Dictionary';
import { Flashcards } from './components/Flashcards';
import { StudySession } from './components/StudySession';
import { Statistics } from './components/Statistics';
import { DataManagerModal } from './components/DataManagerModal';
import { generateJSON, parseFileContent, downloadJSON, saveToLocalFile } from './services/fileService';
import { getDetails, getDeck, updateDeck } from './services/pantryService';
import { initializeTracking, trackEvent, setTrackingUserId, trackPageView, PAGE_TITLES, TRACKING_CATEGORY, TRACKING_ACTION } from './services/trackingService';
import { Book, Layers, Database, Save, Cloud, BarChart2, Home, Sun, Moon } from 'lucide-react';
import Confetti from 'react-confetti';
import { useWindowSize } from 'react-use';

const LOCAL_STORAGE_KEY = 'lumina_cards_v1';
const CLOUD_CONFIG_KEY = 'lumina_cloud_config';

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

  // Dark Mode — follow device theme in real-time
  const [isDark, setIsDark] = useState(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  // Keep in sync whenever the OS switches light/dark
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Keep ref in sync so performMerge always sees the latest tombstone map
  useEffect(() => {
    deletedCardsRef.current = deletedCards;
  }, [deletedCards]);

  const [isDataModalOpen, setIsDataModalOpen] = useState(false);

  // File System State
  const [fileHandle, setFileHandle] = useState<FileSystemFileHandle | null>(null);
  const [isFileSaving, setIsFileSaving] = useState(false);

  // Cloud Sync State
  const [cloudConfig, setCloudConfig] = useState<CloudConfig | null>(null);
  const [isCloudSaving, setIsCloudSaving] = useState(false);

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

    setCards(prev => {
      // Read from ref — always current, no stale closure, no dep-array entry
      const liveMap = deletedCardsRef.current;
      const isDeleted = (id: string) =>
        liveMap.has(id) || Object.prototype.hasOwnProperty.call(incomingDeletedCards, id);

      const cardMap = new Map<string, Flashcard>();
      // Only keep existing cards that haven't been tombstoned
      prev.forEach(c => {
        if (!isDeleted(c.id)) cardMap.set(c.id, c);
      });

      // Filter incoming by tombstones, then merge
      incoming
        .filter(c => !isDeleted(c.id))
        .forEach(c => {
          const duplicateId = Array.from(cardMap.keys()).find(key => {
            const existing = cardMap.get(key)!;
            return existing.word.toLowerCase() === c.word.toLowerCase() &&
              existing.mainDefinition === c.mainDefinition;
          });

          if (duplicateId) {
            const existing = cardMap.get(duplicateId)!;
            cardMap.set(duplicateId, { ...existing, ...c, id: duplicateId });
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
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — reads tombstones via ref, not closure

  // 1. Initial Load: Local Storage -> Fallback to CSV DB -> Merge Cloud
  useEffect(() => {
    const initData = async () => {
      let initialCards: Flashcard[] = [];

      // Step A: Load Local Storage
      const savedCards = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (savedCards) {
        try {
          const parsed = JSON.parse(savedCards);
          if (Array.isArray(parsed)) {
            initialCards = parsed;
          }
        } catch (e) {
          console.error("Failed to parse saved cards", e);
        }
      }

      // Step B: Load Default JSON if Local is empty
      if (initialCards.length === 0) {
        try {
          const response = await fetch('./database/data.json');
          if (response.ok) {
            const text = await response.text();
            const defaultData = parseFileContent(text);
            if (defaultData.cards.length > 0) {
              initialCards = defaultData.cards;
            }
            if (Object.keys(studyHistory).length === 0 && defaultData.studyHistory) {
              setStudyHistory(defaultData.studyHistory);
            }
            if (longestStreak === 0 && defaultData.longestStreak) {
              setLongestStreak(defaultData.longestStreak);
            }
          }
        } catch (e) {
          console.warn("No default database found.", e);
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

      // Step C: Check Cloud Config and Merge
      const savedCloudConfig = localStorage.getItem(CLOUD_CONFIG_KEY);
      if (savedCloudConfig) {
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

            setCloudConfig(config);
            initializeTracking(config.pantryId);
          } else {
            initializeTracking();
          }
        } catch (e) {
          console.error("Failed to load cloud backup on init", e);
          if (savedCloudConfig) setCloudConfig(JSON.parse(savedCloudConfig));
          initializeTracking();
        }
      } else {
        initializeTracking();
      }
    };

    initData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [performMerge]);

  // 2. Persist to Local Storage
  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(cards));
  }, [cards]);

  // 3. Auto-Save to Local File
  useEffect(() => {
    if (!fileHandle) return;
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
  }, [cards, studyHistory, longestStreak, fileHandle]);

  // 4. Auto-Save to Cloud
  useEffect(() => {
    if (!cloudConfig || !cards.length) return;
    const timeoutId = setTimeout(async () => {
      setIsCloudSaving(true);
      try {
        await updateDeck(cloudConfig.pantryId, { cards, studyHistory, longestStreak, deletedCards: prunedDeletedCards() });
      } catch (error) {
        console.error("Auto-save cloud failed:", error);
      } finally {
        setIsCloudSaving(false);
      }
    }, 2000);
    return () => clearTimeout(timeoutId);
  }, [cards, studyHistory, longestStreak, cloudConfig]);

  // --- File Handlers ---

  const handleConnectFile = async () => {
    // @ts-ignore
    if (!window.showOpenFilePicker) {
      alert("Your browser does not support the File System Access API.");
      return;
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
      }
    } catch (err: any) {
      if (err.name === 'SecurityError' || err.message?.includes('Cross origin')) {
        alert("Direct file syncing is disabled in this preview environment.");
      } else if (err.name !== 'AbortError') {
        alert("Failed to connect to file.");
      }
    }
  };

  const handleManualFileSave = async () => {
    if (!fileHandle) return;
    setIsFileSaving(true);
    await saveToLocalFile(fileHandle, { cards, studyHistory, longestStreak, deletedCards: prunedDeletedCards() });
    setIsFileSaving(false);
    trackEvent(TRACKING_ACTION.MANUAL_SAVE, TRACKING_CATEGORY.DATA);
  };

  const handleExportCSV = () => {
    const jsonContent = generateJSON({ cards, studyHistory, longestStreak, deletedCards: prunedDeletedCards() });
    const date = new Date().toISOString().split('T')[0];
    downloadJSON(jsonContent, `lumina_backup_${date}.json`);
    trackEvent(TRACKING_ACTION.EXPORT_CSV, TRACKING_CATEGORY.DATA);
  };

  const handleImportCSV = async (file: File) => {
    const text = await file.text();
    const importedData = parseFileContent(text);
    if (importedData.cards.length === 0) throw new Error("No valid data found");
    performMerge(importedData.cards, importedData.deletedCards ?? {});
    if (importedData.studyHistory) setStudyHistory(prev => ({ ...prev, ...importedData.studyHistory }));
    if (importedData.longestStreak) setLongestStreak(prev => Math.max(prev, importedData.longestStreak!));
    trackEvent(TRACKING_ACTION.IMPORT_CSV, TRACKING_CATEGORY.DATA, 'card_count', importedData.cards.length);
  };

  // --- Cloud Handlers ---

  const handleConnectCloud = async (pantryId: string) => {
    await getDetails(pantryId);
    const cloudData = await getDeck(pantryId);
    if (cloudData.cards && cloudData.cards.length > 0) {
      performMerge(cloudData.cards, cloudData.deletedCards ?? {});
    }
    if (cloudData.studyHistory) setStudyHistory(prev => ({ ...prev, ...cloudData.studyHistory }));
    if (cloudData.longestStreak) setLongestStreak(prev => Math.max(prev, cloudData.longestStreak!));

    const config = { pantryId };
    setCloudConfig(config);
    localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify(config));
    setTrackingUserId(pantryId);
    trackEvent(TRACKING_ACTION.CONNECT_CLOUD, TRACKING_CATEGORY.CLOUD);
  };

  const handleDisconnectCloud = () => {
    setCloudConfig(null);
    localStorage.removeItem(CLOUD_CONFIG_KEY);
    trackEvent(TRACKING_ACTION.DISCONNECT_CLOUD, TRACKING_CATEGORY.CLOUD);
  };

  const handleCloudPull = async () => {
    if (!cloudConfig) return;
    const cloudData = await getDeck(cloudConfig.pantryId);
    if (cloudData.cards && cloudData.cards.length > 0) {
      performMerge(cloudData.cards, cloudData.deletedCards ?? {});
    }
    if (cloudData.studyHistory) setStudyHistory(prev => ({ ...prev, ...cloudData.studyHistory }));
    if (cloudData.longestStreak) setLongestStreak(prev => Math.max(prev, cloudData.longestStreak!));
    trackEvent(TRACKING_ACTION.CLOUD_PULL, TRACKING_CATEGORY.CLOUD);
  };

  const handleCloudPush = async () => {
    if (!cloudConfig) return;
    await updateDeck(cloudConfig.pantryId, { cards, studyHistory, longestStreak, deletedCards: prunedDeletedCards() });
    trackEvent(TRACKING_ACTION.CLOUD_PUSH, TRACKING_CATEGORY.CLOUD);
  };

  // --- App Logic ---

  const handleAddCard = (entry: WordEntry, definition: string, example: string, partOfSpeech: string) => {
    const newCard: Flashcard = {
      id: crypto.randomUUID(),
      word: entry.word,
      phonetic: entry.phonetic,
      audio: entry.audio,
      image: entry.image,
      mainDefinition: definition,
      example: example,
      partOfSpeech: partOfSpeech,
      status: FlashcardStatus.New,
      lastReviewed: 0,
      createdAt: Date.now(),
      repetition: 0,
      nextReviewDate: Date.now(),
    };
    setCards(prev => [newCard, ...prev]);
    recordActivity();
    trackEvent(TRACKING_ACTION.ADD_CARD, TRACKING_CATEGORY.FLASHCARDS, entry.word);
  };

  const handleUpdateStatus = (id: string, status: FlashcardStatus) => {
    setCards(prev => prev.map(card =>
      card.id === id ? { ...card, status, lastReviewed: Date.now() } : card
    ));
    recordActivity();
    trackEvent(TRACKING_ACTION.UPDATE_STATUS, TRACKING_CATEGORY.FLASHCARDS, status);
  };

  const getLocalDateString = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const calculateCurrentStreak = (history: Record<string, number>) => {
    let streak = 0;
    let currentDate = new Date();
    const todayStr = getLocalDateString(currentDate);

    if (!history[todayStr] || history[todayStr] === 0) {
      currentDate.setDate(currentDate.getDate() - 1);
      const yesterdayStr = getLocalDateString(currentDate);
      if (!history[yesterdayStr] || history[yesterdayStr] === 0) {
        return 0;
      }
    }

    while (history[getLocalDateString(currentDate)] > 0) {
      streak++;
      currentDate.setDate(currentDate.getDate() - 1);
    }
    return streak;
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
        lastReviewed: Date.now()
      };
    }));
    recordActivity();
    trackEvent(TRACKING_ACTION.UPDATE_STATUS, TRACKING_CATEGORY.FLASHCARDS, `quality_${quality}`);
  };

  const handleDeleteCard = (id: string) => {
    setCards(prev => prev.filter(c => c.id !== id));
    setDeletedCards(prev => new Map(prev).set(id, Date.now()));
    trackEvent(TRACKING_ACTION.DELETE_CARD, TRACKING_CATEGORY.FLASHCARDS);
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
              onClick={() => setIsDark(d => !d)}
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
                onNavigate={(view) => navigate(`/${view === 'dashboard' ? '' : view}`)}
                onQuickSearch={handleQuickSearch}
              />
            }
          />
          <Route
            path="/dictionary"
            element={
              <Dictionary
                onAddCard={handleAddCard}
                onRemoveCard={handleDeleteCard}
                existingCards={cards}
              />
            }
          />
          <Route
            path="/flashcards"
            element={
              <Flashcards
                cards={cards}
                onStartStudy={() => navigate('/study')}
                onDeleteCard={handleDeleteCard}
                onReviewCard={handleReviewCard}
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
          <Route path="*" element={<Dashboard cards={cards} studyHistory={studyHistory} longestStreak={longestStreak} onNavigate={(view) => navigate(`/${view === 'dashboard' ? '' : view}`)} onQuickSearch={handleQuickSearch} />} />
        </Routes>
      </main>

      {/* Auto-Save Indicators */}
      {(isFileSaving || isCloudSaving) && (
        <div className="fixed bottom-4 right-4 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs px-3 py-1.5 rounded-full shadow-lg animate-pulse flex items-center gap-2 z-50">
          {isCloudSaving ? <Cloud className="h-3 w-3" /> : <Save className="h-3 w-3" />}
          {isCloudSaving ? 'Syncing to Cloud...' : 'Saving to File...'}
        </div>
      )}

      <DataManagerModal
        isOpen={isDataModalOpen}
        onClose={() => setIsDataModalOpen(false)}
        onExport={handleExportCSV}
        onImport={handleImportCSV}
        onConnectFile={handleConnectFile}
        onManualSave={handleManualFileSave}
        isFileConnected={!!fileHandle}
        connectedFileName={fileHandle?.name}
        cardCount={cards.length}
        cloudConfig={cloudConfig}
        onConnectCloud={handleConnectCloud}
        onDisconnectCloud={handleDisconnectCloud}
        onCloudPull={handleCloudPull}
        onCloudPush={handleCloudPush}
      />
    </div>
  );
};

export default App;