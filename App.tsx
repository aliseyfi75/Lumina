import React, { useState, useEffect, useCallback } from 'react';
import { ViewState, Flashcard, WordEntry, FlashcardStatus, FileSystemFileHandle, CloudConfig } from './types';
import { Dictionary } from './components/Dictionary';
import { Flashcards } from './components/Flashcards';
import { StudySession } from './components/StudySession';
import { DataManagerModal } from './components/DataManagerModal';
import { generateCSV, parseCSV, downloadCSV, saveToLocalFile } from './services/csvService';
import { getDetails, getDeck, updateDeck } from './services/pantryService';
import { initializeTracking, trackEvent, setTrackingUserId, TRACKING_CATEGORY, TRACKING_ACTION } from './services/trackingService';
import { Book, Layers, Database, Save, Cloud } from 'lucide-react';

const LOCAL_STORAGE_KEY = 'lumina_cards_v1';
const CLOUD_CONFIG_KEY = 'lumina_cloud_config';

const App: React.FC = () => {
  const [view, setView] = useState<ViewState>('dictionary');
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [isDataModalOpen, setIsDataModalOpen] = useState(false);
  
  // File System State
  const [fileHandle, setFileHandle] = useState<FileSystemFileHandle | null>(null);
  const [isFileSaving, setIsFileSaving] = useState(false);

  // Cloud Sync State
  const [cloudConfig, setCloudConfig] = useState<CloudConfig | null>(null);
  const [isCloudSaving, setIsCloudSaving] = useState(false);

  // Helper: Merge incoming cards with existing state
  const performMerge = useCallback((incoming: Flashcard[]) => {
    setCards(prev => {
        const cardMap = new Map<string, Flashcard>();
        prev.forEach(c => cardMap.set(c.id, c));
        
        incoming.forEach(c => {
            // Check for duplicate by content (Word + Def) to prevent duplicates if IDs differ
            // (e.g. from different devices creating same word)
            const duplicateId = Array.from(cardMap.keys()).find(key => {
                const existing = cardMap.get(key)!;
                return existing.word.toLowerCase() === c.word.toLowerCase() && 
                       existing.mainDefinition === c.mainDefinition;
            });

            if (duplicateId) {
                const existing = cardMap.get(duplicateId)!;
                // Merge strategy: Incoming data overwrites fields, but we keep the ID of the matched card
                // unless we want to strictly enforce the incoming ID. 
                // Here we merge properties onto the existing card.
                cardMap.set(duplicateId, { ...existing, ...c, id: duplicateId });
            } else {
                // If ID exists directly (UUID match), overwrite. Else add new.
                cardMap.set(c.id, c);
            }
        });
        return Array.from(cardMap.values()).sort((a, b) => b.createdAt - a.createdAt);
    });
  }, []);

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

      // Step B: Load Default CSV if Local is empty
      if (initialCards.length === 0) {
        try {
          const response = await fetch('./database/cards.csv');
          if (response.ok) {
            const text = await response.text();
            const defaultCards = parseCSV(text);
            if (defaultCards.length > 0) {
              initialCards = defaultCards;
            }
          }
        } catch (e) {
          console.warn("No default CSV database found.", e);
        }
      }

      // Set what we have locally so far
      setCards(initialCards);

      // Step C: Check Cloud Config and Merge
      const savedCloudConfig = localStorage.getItem(CLOUD_CONFIG_KEY);
      if (savedCloudConfig) {
          try {
              const config = JSON.parse(savedCloudConfig);
              if (config.pantryId) {
                  // Fetch latest from cloud
                  const cloudCards = await getDeck(config.pantryId);
                  
                  if (cloudCards && cloudCards.length > 0) {
                     // Merge cloud data into our local/default data
                     performMerge(cloudCards);
                  }
                  
                  // Only set config (enabling auto-save) after we've attempted the fetch
                  setCloudConfig(config);

                  // Initialize tracking with the pantry ID as User ID
                  initializeTracking(config.pantryId);
              } else {
                  initializeTracking();
              }
          } catch(e) { 
              console.error("Failed to load cloud backup on init", e);
              // Retry loading config even if fetch failed, so user can try again later
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

  // 2. Persist to Local Storage (Always backup locally)
  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(cards));
  }, [cards]);

  // 3. Auto-Save to Local File
  useEffect(() => {
    if (!fileHandle) return;
    const timeoutId = setTimeout(async () => {
      setIsFileSaving(true);
      try {
        await saveToLocalFile(fileHandle, cards);
      } catch (error) {
        console.error("Auto-save file failed:", error);
      } finally {
        setIsFileSaving(false);
      }
    }, 1000);
    return () => clearTimeout(timeoutId);
  }, [cards, fileHandle]);

  // 4. Auto-Save to Cloud
  useEffect(() => {
    // Only auto-save if we have a config and data.
    if (!cloudConfig || !cards.length) return;
    
    const timeoutId = setTimeout(async () => {
      setIsCloudSaving(true);
      try {
        await updateDeck(cloudConfig.pantryId, cards);
      } catch (error) {
        console.error("Auto-save cloud failed:", error);
      } finally {
        setIsCloudSaving(false);
      }
    }, 2000); // 2s debounce for cloud to save API calls
    return () => clearTimeout(timeoutId);
  }, [cards, cloudConfig]);


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
        types: [{ description: 'CSV File', accept: { 'text/csv': ['.csv'] } }],
        multiple: false
      });
      if (handle) {
        const file = await handle.getFile();
        const text = await file.text();
        const loadedCards = parseCSV(text);
        if (loadedCards.length > 0) {
            performMerge(loadedCards);
        }
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
    await saveToLocalFile(fileHandle, cards);
    setIsFileSaving(false);
    trackEvent(TRACKING_ACTION.MANUAL_SAVE, TRACKING_CATEGORY.DATA);
  };

  const handleExportCSV = () => {
    const csvContent = generateCSV(cards);
    const date = new Date().toISOString().split('T')[0];
    downloadCSV(csvContent, `lumina_backup_${date}.csv`);
    trackEvent(TRACKING_ACTION.EXPORT_CSV, TRACKING_CATEGORY.DATA);
  };

  const handleImportCSV = async (file: File) => {
    const text = await file.text();
    const importedCards = parseCSV(text);
    if (importedCards.length === 0) throw new Error("No valid cards found");
    performMerge(importedCards);
    trackEvent(TRACKING_ACTION.IMPORT_CSV, TRACKING_CATEGORY.DATA, 'card_count', importedCards.length);
  };

  // --- Cloud Handlers ---

  const handleConnectCloud = async (pantryId: string) => {
    // 1. Validate ID
    await getDetails(pantryId);
    
    // 2. Fetch existing data (Merge)
    const cloudCards = await getDeck(pantryId);
    if (cloudCards.length > 0) {
        performMerge(cloudCards);
    } 
    // If cloud is empty but we have local cards, we will push them via auto-save momentarily.

    const config = { pantryId };
    setCloudConfig(config);
    localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify(config));

    // Update tracking user ID
    setTrackingUserId(pantryId);
    trackEvent(TRACKING_ACTION.CONNECT_CLOUD, TRACKING_CATEGORY.CLOUD);
  };

  const handleDisconnectCloud = () => {
    setCloudConfig(null);
    localStorage.removeItem(CLOUD_CONFIG_KEY);
    trackEvent(TRACKING_ACTION.DISCONNECT_CLOUD, TRACKING_CATEGORY.CLOUD);
    // Note: We don't unset the user ID in tracking to keep the session continuity,
    // or we could revert to anonymous ID if needed, but usually better to keep linking if possible during session.
  };

  const handleCloudPull = async () => {
    if (!cloudConfig) return;
    const cloudCards = await getDeck(cloudConfig.pantryId);
    if (cloudCards.length > 0) {
        performMerge(cloudCards);
    }
    trackEvent(TRACKING_ACTION.CLOUD_PULL, TRACKING_CATEGORY.CLOUD);
  };

  const handleCloudPush = async () => {
    if (!cloudConfig) return;
    await updateDeck(cloudConfig.pantryId, cards);
    trackEvent(TRACKING_ACTION.CLOUD_PUSH, TRACKING_CATEGORY.CLOUD);
  };

  // --- App Logic ---

  const handleAddCard = (entry: WordEntry, definition: string, example: string, partOfSpeech: string) => {
    const newCard: Flashcard = {
      id: crypto.randomUUID(),
      word: entry.word,
      phonetic: entry.phonetic,
      mainDefinition: definition,
      example: example,
      partOfSpeech: partOfSpeech,
      status: FlashcardStatus.New,
      lastReviewed: 0,
      createdAt: Date.now(),
    };
    setCards(prev => [newCard, ...prev]);
    trackEvent(TRACKING_ACTION.ADD_CARD, TRACKING_CATEGORY.FLASHCARDS, entry.word);
  };

  const handleUpdateStatus = (id: string, status: FlashcardStatus) => {
    setCards(prev => prev.map(card => 
      card.id === id ? { ...card, status, lastReviewed: Date.now() } : card
    ));
    trackEvent(TRACKING_ACTION.UPDATE_STATUS, TRACKING_CATEGORY.FLASHCARDS, status);
  };

  const handleDeleteCard = (id: string) => {
    setCards(prev => prev.filter(c => c.id !== id));
    trackEvent(TRACKING_ACTION.DELETE_CARD, TRACKING_CATEGORY.FLASHCARDS);
  };

  // Track View Changes
  useEffect(() => {
    trackEvent(TRACKING_ACTION.VIEW_TAB, TRACKING_CATEGORY.ENGAGEMENT, view);
  }, [view]);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-800 font-sans">
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => setView('dictionary')}>
            <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center text-white font-serif font-bold text-xl shadow-lg shadow-brand-500/30">
              L
            </div>
            <span className="font-bold text-xl tracking-tight text-slate-900 hidden sm:block">Lumina</span>
          </div>

          <div className="flex items-center gap-2">
            <nav className="flex items-center gap-1 bg-slate-100/50 p-1 rounded-xl mr-2">
                <button onClick={() => setView('dictionary')} className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${view === 'dictionary' ? 'bg-white text-brand-600 shadow-sm' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}>
                    <Book className="h-4 w-4" />
                    <span className="hidden sm:inline">Dictionary</span>
                </button>
                <button onClick={() => setView('flashcards')} className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${view === 'flashcards' || view === 'study' ? 'bg-white text-brand-600 shadow-sm' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}>
                    <Layers className="h-4 w-4" />
                    <span className="hidden sm:inline">Flashcards</span>
                    {cards.length > 0 && <span className="bg-slate-200 text-slate-600 text-[10px] px-1.5 py-0.5 rounded-full min-w-[20px] text-center">{cards.length}</span>}
                </button>
            </nav>
            
            <button
                onClick={() => setIsDataModalOpen(true)}
                className={`p-2.5 rounded-xl transition-all hover:bg-slate-200 ${fileHandle || cloudConfig ? 'bg-brand-50 text-brand-600 border border-brand-200' : 'bg-slate-100 text-slate-500 hover:text-brand-600'}`}
                title="Manage Data"
            >
                {cloudConfig ? <Cloud className="h-5 w-5" /> : (fileHandle ? <Save className="h-5 w-5" /> : <Database className="h-5 w-5" />)}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-8">
        {view === 'dictionary' && <Dictionary onAddCard={handleAddCard} existingCards={cards} />}
        {view === 'flashcards' && <Flashcards cards={cards} onStartStudy={() => setView('study')} onDeleteCard={handleDeleteCard} onUpdateStatus={handleUpdateStatus} onOpenImport={() => setIsDataModalOpen(true)} />}
        {view === 'study' && <StudySession cards={cards} onUpdateStatus={handleUpdateStatus} onExit={() => setView('flashcards')} />}
      </main>

      {/* Auto-Save Indicators */}
      {(isFileSaving || isCloudSaving) && (
        <div className="fixed bottom-4 right-4 bg-slate-900 text-white text-xs px-3 py-1.5 rounded-full shadow-lg animate-pulse flex items-center gap-2 z-50">
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