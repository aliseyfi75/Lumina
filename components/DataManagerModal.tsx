import React, { useRef, useState, useEffect } from 'react';
import { X, Database, Download, Upload, CheckCircle, AlertCircle, RefreshCw, Save, AlertTriangle, Cloud, ExternalLink, HardDrive, ShieldCheck, ShieldAlert, Zap } from 'lucide-react';
import { CloudConfig } from '../types';
import { CloudSyncProgress } from '../services/pantryService';

interface DataManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: () => void;
  onImport: (file: File) => Promise<void>;
  onAnkiFileSelected: (file: File) => void;
  onConnectFile?: () => Promise<boolean>;
  onChangeFile?: () => Promise<boolean>;
  onDisconnectFile?: () => Promise<void>;
  onManualSave?: () => Promise<void>;
  isFileConnected: boolean;
  connectedFileName?: string;
  cardCount: number;

  // Storage metadata
  persistenceStatus: 'granted' | 'denied' | 'prompt' | 'unsupported';
  storageEstimate: { usage: number; quota: number } | null;
  onRequestPersistence: () => Promise<boolean>;
  lastSavedAt: number | null;

  // Cloud Props
  cloudConfig: CloudConfig | null;
  onConnectCloud: (
    pantryId: string,
    onProgress?: (progress: CloudSyncProgress) => void
  ) => Promise<void>;
  onMigrateCloud?: (
    newPantryId: string,
    oldPantryId?: string,
    onProgress?: (progress: CloudSyncProgress) => void
  ) => Promise<{ cardCount: number; localCount: number; cloudCount: number; historyDays: number }>;
  onConnectGist?: (
    gistToken: string,
    gistId?: string,
    oldPantryId?: string,
    onProgress?: (progress: CloudSyncProgress) => void
  ) => Promise<{
    gistId: string;
    createdNewGist: boolean;
    cardCount: number;
    localCount: number;
    pantryCount: number;
    gistCount: number;
    historyDays: number;
  }>;
  onDisconnectCloud: () => void;
  onCloudPull: (onProgress?: (progress: CloudSyncProgress) => void) => Promise<void>;
  onCloudPush: (onProgress?: (progress: CloudSyncProgress) => void) => Promise<void>;
}

export const DataManagerModal: React.FC<DataManagerModalProps> = ({
  isOpen,
  onClose,
  onExport,
  onImport,
  onAnkiFileSelected,
  onConnectFile,
  onChangeFile,
  onDisconnectFile,
  onManualSave,
  isFileConnected,
  connectedFileName,
  cardCount,
  persistenceStatus,
  storageEstimate,
  onRequestPersistence,
  lastSavedAt,
  cloudConfig,
  onConnectCloud,
  onMigrateCloud,
  onConnectGist,
  onDisconnectCloud,
  onCloudPull,
  onCloudPush
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ankiFileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<{ type: 'idle' | 'success' | 'error', msg: string }>({ type: 'idle', msg: '' });
  const [isProcessing, setIsProcessing] = useState(false);
  const [isIframe, setIsIframe] = useState(false);

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatLastSaved = (ts: number | null): string => {
    if (!ts) return 'Not yet saved';
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 5) return 'Just now';
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return new Date(ts).toLocaleTimeString();
  };

  // Cloud Form State
  const [pantryIdInput, setPantryIdInput] = useState('');
  const [isMigratingCloud, setIsMigratingCloud] = useState(false);
  const [newPantryIdInput, setNewPantryIdInput] = useState('');
  const [oldPantryIdInput, setOldPantryIdInput] = useState('');
  const [cloudProgress, setCloudProgress] = useState<CloudSyncProgress | null>(null);

  // GitHub Gist Form State
  const [gistTokenInput, setGistTokenInput] = useState('');
  const [gistIdInput, setGistIdInput] = useState('');
  const [gistOldPantryIdInput, setGistOldPantryIdInput] = useState('');
  const [showGistMigrateFromPantry, setShowGistMigrateFromPantry] = useState(false);
  const [isMigratingPantryToGist, setIsMigratingPantryToGist] = useState(false);

  const isGistConnected = cloudConfig?.provider === 'gist' && !!cloudConfig?.gistId;

  useEffect(() => {
    setIsIframe(window.self !== window.top);
    if (isOpen && cloudConfig) {
      if (cloudConfig.provider === 'gist') {
        setGistTokenInput(cloudConfig.gistToken || '');
        setGistIdInput(cloudConfig.gistId || cloudConfig.pantryId || '');
      } else {
        setPantryIdInput(cloudConfig.pantryId);
        setGistOldPantryIdInput(cloudConfig.pantryId);
      }
    }
    if (!cloudConfig) {
      setPantryIdInput('');
      setOldPantryIdInput('');
      setGistTokenInput('');
      setGistIdInput('');
      setGistOldPantryIdInput('');
    }
    if (!isOpen) {
      setIsMigratingCloud(false);
      setIsMigratingPantryToGist(false);
      setShowGistMigrateFromPantry(false);
      setNewPantryIdInput('');
      setOldPantryIdInput('');
      setCloudProgress(null);
    }
  }, [isOpen, cloudConfig]);

  // @ts-ignore
  const browserSupportsApi = typeof window !== 'undefined' && 'showOpenFilePicker' in window;
  const isFileSystemAvailable = browserSupportsApi && !isIframe;

  if (!isOpen) return null;

  const showMessage = (type: 'success' | 'error', msg: string) => {
    setStatus({ type, msg });
    if (type === 'success') {
      setTimeout(() => setStatus({ type: 'idle', msg: '' }), 4000);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      await onImport(file);
      showMessage('success', 'Deck successfully updated from JSON!');
    } catch (err) {
      showMessage('error', 'Failed to parse JSON file.');
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleAnkiFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    onAnkiFileSelected(file);
    if (ankiFileInputRef.current) ankiFileInputRef.current.value = '';
  };

  const handleConnectLocal = async () => {
    if (onConnectFile) {
      const connected = await onConnectFile();
      if (connected) showMessage('success', 'File linked! Auto-save enabled.');
      // If cancelled (returns false), show nothing — user chose not to pick a file
    }
  };

  const handleChangeLocalFile = async () => {
    if (onChangeFile) {
      const changed = await onChangeFile();
      if (changed) showMessage('success', 'Sync file updated!');
    }
  };

  const handleDisconnectLocalFile = async () => {
    if (onDisconnectFile) {
      setIsProcessing(true);
      try {
        await onDisconnectFile();
        showMessage('success', 'Local file disconnected.');
      } catch (e) {
        showMessage('error', 'Failed to disconnect.');
      } finally {
        setIsProcessing(false);
      }
    }
  };

  const handleManualLocalSave = async () => {
    if (onManualSave) {
      setIsProcessing(true);
      try {
        await onManualSave();
        showMessage('success', 'Changes saved to local file!');
      } catch (e) {
        showMessage('error', 'Failed to save changes.');
      } finally {
        setIsProcessing(false);
      }
    }
  };

  const handleGistConnectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = gistTokenInput.trim();
    if (!token) {
      return showMessage('error', 'GitHub Personal Access Token is required');
    }
    if (!onConnectGist) {
      return showMessage('error', 'GitHub Gist sync is not available');
    }

    const sourcePantryId =
      cloudConfig && cloudConfig.provider !== 'gist'
        ? (gistOldPantryIdInput.trim() || cloudConfig.pantryId)
        : showGistMigrateFromPantry
          ? gistOldPantryIdInput.trim() || undefined
          : undefined;

    setIsProcessing(true);
    setCloudProgress({
      percent: 10,
      step: sourcePantryId
        ? 'Migrating data from Pantry & connecting to GitHub Gist...'
        : 'Connecting to GitHub Gist...',
      estimatedRemainingSec: sourcePantryId ? 4 : 1,
    });
    try {
      const res = await onConnectGist(
        token,
        gistIdInput.trim() || undefined,
        sourcePantryId,
        setCloudProgress
      );
      let summary: string;
      if (res.pantryCount > 0) {
        summary = `Migrated to GitHub Gist! Merged ${res.localCount} local + ${res.pantryCount} Pantry${res.gistCount > 0 ? ` + ${res.gistCount} Gist` : ''} cards → ${res.cardCount} total (${res.historyDays} study days).`;
      } else if (res.gistCount > 0) {
        summary = `Connected to GitHub Gist! Merged ${res.localCount} local + ${res.gistCount} Gist cards → ${res.cardCount} total (${res.historyDays} study days).`;
      } else {
        summary = `Connected to GitHub Gist & synced ${res.cardCount} cards (${res.historyDays} study days) in 1 request!`;
      }
      showMessage('success', summary);
      setIsMigratingCloud(false);
      setIsMigratingPantryToGist(false);
      setShowGistMigrateFromPantry(false);
    } catch (error: any) {
      showMessage('error', error.message || 'Failed to connect to GitHub Gist');
    } finally {
      setIsProcessing(false);
      setCloudProgress(null);
    }
  };

  const handleCloudConnectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pantryIdInput.trim()) return showMessage('error', 'Pantry ID is required');

    setIsProcessing(true);
    setCloudProgress({ percent: 8, step: 'Connecting to Pantry...' });
    try {
      if (onMigrateCloud) {
        const explicitOldId = isMigratingCloud ? oldPantryIdInput.trim() || undefined : undefined;
        const res = await onMigrateCloud(pantryIdInput.trim(), explicitOldId, setCloudProgress);
        const summary =
          res.cloudCount > 0
            ? `Connected & merged ${res.localCount} local + ${res.cloudCount} cloud cards → ${res.cardCount} total (${res.historyDays} study days)!`
            : `Connected & synced ${res.cardCount} cards (${res.historyDays} study days) to Pantry!`;
        showMessage('success', summary);
      } else {
        await onConnectCloud(pantryIdInput.trim(), setCloudProgress);
        showMessage('success', 'Connected to Pantry!');
      }
      setIsMigratingCloud(false);
      setNewPantryIdInput('');
      setOldPantryIdInput('');
    } catch (error: any) {
      showMessage('error', error.message || 'Failed to connect to Pantry');
    } finally {
      setIsProcessing(false);
      setCloudProgress(null);
    }
  };

  const handleCloudMigrateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetId = newPantryIdInput.trim();
    if (!targetId) return showMessage('error', 'New Pantry ID is required');
    if (cloudConfig && targetId === cloudConfig.pantryId) {
      return showMessage('error', 'Please enter a different Pantry ID to migrate to');
    }

    setIsProcessing(true);
    setCloudProgress({ percent: 8, step: 'Starting migration to new Pantry ID...' });
    try {
      if (onMigrateCloud) {
        const res = await onMigrateCloud(targetId, oldPantryIdInput.trim() || undefined, setCloudProgress);
        const summary =
          res.cloudCount > 0
            ? `Merged ${res.localCount} local + ${res.cloudCount} cloud cards → ${res.cardCount} total (${res.historyDays} study days)!`
            : `Migrated ${res.cardCount} cards & ${res.historyDays} study days to new Pantry ID!`;
        showMessage('success', summary);
      } else {
        await onConnectCloud(targetId, setCloudProgress);
        showMessage('success', 'Migrated to new Pantry ID!');
      }
      setIsMigratingCloud(false);
      setNewPantryIdInput('');
      setOldPantryIdInput('');
    } catch (error: any) {
      showMessage('error', error.message || 'Failed to migrate to new Pantry ID');
    } finally {
      setIsProcessing(false);
      setCloudProgress(null);
    }
  };

  const handleCloudAction = async (action: 'pull' | 'push') => {
    setIsProcessing(true);
    setCloudProgress({
      percent: 12,
      step:
        action === 'pull'
          ? isGistConnected
            ? 'Loading flashcards from GitHub Gist...'
            : 'Loading flashcards from Cloud...'
          : isGistConnected
            ? `Uploading ${cardCount} flashcards to GitHub Gist...`
            : `Uploading ${cardCount} flashcards to Cloud...`,
      estimatedRemainingSec: isGistConnected ? 1 : Math.max(2, Math.ceil(cardCount / 65) * 2),
    });
    try {
      if (action === 'pull') {
        await onCloudPull(setCloudProgress);
        showMessage('success', 'Flashcards loaded from Cloud! Latest study statuses synced.');
      } else {
        await onCloudPush(setCloudProgress);
        showMessage('success', 'Flashcards saved to Cloud! Latest study statuses synced.');
      }
    } catch (error: any) {
      const msg = error.message || `Failed to ${action} cloud data`;
      showMessage('error', msg);
      if (msg.toLowerCase().includes('not found') && !isGistConnected) {
        setIsMigratingCloud(true);
      }
    } finally {
      setIsProcessing(false);
      setCloudProgress(null);
    }
  };

  const handleRequestPersistence = async () => {
    setIsProcessing(true);
    try {
      const granted = await onRequestPersistence();
      if (granted) {
        showMessage('success', 'Persistent storage granted!');
      } else {
        showMessage('error',
          'Not granted. Chrome silently decides based on engagement (bookmarks, PWA install, etc.). Try installing the app.');
      }
    } catch {
      showMessage('error', 'Persistent storage is not supported in this browser.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center modal-safe-overlay bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col modal-safe-panel">
        {/* Header */}
        <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/30 shrink-0">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-brand-100 dark:bg-brand-900/40 text-brand-600 dark:text-brand-400 rounded-lg">
              <Database className="h-5 w-5" />
            </div>
            <h2 className="text-lg sm:text-xl font-serif font-bold text-slate-900 dark:text-white">Data Manager</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 sm:p-6 space-y-5 overflow-y-auto custom-scrollbar">

          {/* ── Local Storage (merged) ──────────────────────────────────── */}
          {(() => {
            const isStorageConnected = persistenceStatus === 'granted' || isFileConnected;
            const storageAddress = isFileConnected ? connectedFileName : 'Browser Database (IndexedDB)';
            const isIdbOnly = isStorageConnected && !isFileConnected;
            const borderClass = isStorageConnected
              ? 'border-green-100 dark:border-green-800/40 bg-green-50/40 dark:bg-green-900/10'
              : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/30';

            return (
              <div className={`p-4 rounded-xl border space-y-3 ${borderClass}`}>

                {/* Header row: title + persistence badge */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <HardDrive className={`h-4 w-4 ${isStorageConnected ? 'text-green-600' : 'text-slate-400'}`} />
                    <span className="text-sm font-semibold text-slate-800 dark:text-white">Local Storage</span>
                  </div>
                  {/* Persistence badge — green if IDB is persistent OR a file is linked */}
                  {persistenceStatus === 'granted' || isFileConnected ? (
                    <span className="flex items-center gap-1 px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold rounded-full uppercase tracking-wider">
                      <ShieldCheck className="h-3 w-3" /> Persistent
                    </span>
                  ) : persistenceStatus === 'denied' || persistenceStatus === 'prompt' ? (
                    <span className="flex items-center gap-1 px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-[10px] font-bold rounded-full uppercase tracking-wider">
                      <ShieldAlert className="h-3 w-3" /> Standard
                    </span>
                  ) : null}
                </div>

                {/* Stats row: type · used · last saved */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-white dark:bg-slate-800 rounded-lg p-2 border border-slate-100 dark:border-slate-700">
                    <p className="text-[10px] text-slate-400">Type</p>
                    <p className="text-xs font-semibold text-slate-800 dark:text-white mt-0.5">
                      {isFileConnected ? 'Local File' : 'Browser Data'}
                    </p>
                  </div>
                  <div className="bg-white dark:bg-slate-800 rounded-lg p-2 border border-slate-100 dark:border-slate-700">
                    <p className="text-[10px] text-slate-400">Used</p>
                    <p className="text-xs font-semibold text-slate-800 dark:text-white mt-0.5">
                      {storageEstimate ? formatBytes(storageEstimate.usage) : '–'}
                    </p>
                  </div>
                  <div className="bg-white dark:bg-slate-800 rounded-lg p-2 border border-slate-100 dark:border-slate-700">
                    <p className="text-[10px] text-slate-400">Last saved</p>
                    <p className="text-xs font-semibold text-slate-800 dark:text-white mt-0.5">{formatLastSaved(lastSavedAt)}</p>
                  </div>
                </div>

                {/* Export / Import */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={onExport}
                    disabled={cardCount === 0 || isProcessing}
                    className="flex items-center justify-center gap-1.5 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-brand-600 dark:hover:text-brand-400 transition-colors disabled:opacity-40"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Export JSON
                  </button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isProcessing}
                    className="flex items-center justify-center gap-1.5 py-2 bg-brand-600 text-white text-xs font-medium rounded-lg hover:bg-brand-700 transition-colors shadow-sm shadow-brand-500/20 disabled:opacity-40"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Import JSON
                  </button>
                </div>

                {/* File link sub-row */}
                <div className={`flex items-center justify-between pt-2 border-t ${isStorageConnected
                  ? 'border-green-200/60 dark:border-green-800/40'
                  : 'border-slate-100 dark:border-slate-700'
                  }`}>
                  <div className={`text-xs flex items-center gap-1.5 ${isFileConnected ? 'text-green-700 dark:text-green-400' : 'text-slate-400'
                    }`}>
                    {isFileConnected
                      ? <><RefreshCw className="h-3 w-3 animate-spin" style={{ animationDuration: '3s' }} /><span className="font-mono truncate max-w-[140px]" title={connectedFileName}>{connectedFileName}</span></>
                      : isIdbOnly
                        ? <><RefreshCw className="h-3 w-3 animate-spin" style={{ animationDuration: '3s' }} /><span>Auto-saving to database</span></>
                        : <span className="flex items-center gap-1 px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-[10px] font-bold rounded-full uppercase tracking-wider"><ShieldAlert className="h-3 w-3" /> No file linked</span>
                    }
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {isFileConnected && (
                      <button
                        onClick={handleManualLocalSave}
                        disabled={isProcessing}
                        className="px-2 py-1 bg-green-600 text-white text-[10px] font-medium rounded hover:bg-green-700 disabled:opacity-50"
                      >
                        Save Now
                      </button>
                    )}
                    {isFileConnected && isFileSystemAvailable && (
                      <button
                        onClick={handleChangeLocalFile}
                        disabled={isProcessing}
                        className="text-xs text-slate-500 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
                      >
                        Change
                      </button>
                    )}
                    {isFileConnected && (
                      <>
                        <span className="text-slate-300 dark:text-slate-600">·</span>
                        <button
                          onClick={handleDisconnectLocalFile}
                          disabled={isProcessing}
                          className="text-xs text-red-500 hover:underline"
                        >
                          Unlink
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Request Persistent Storage — hidden when file is linked (file IS the persistent location) */}
                {persistenceStatus !== 'granted' && !isFileConnected && persistenceStatus !== 'unsupported' && (
                  <button
                    onClick={handleRequestPersistence}
                    disabled={isProcessing}
                    className="w-full py-2 text-xs font-medium border border-dashed border-emerald-400 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Request Persistent Storage
                  </button>
                )}

                {/* Link a File — always available when no physical file linked; label adapts based on whether IDB is already persistent */}
                {isFileSystemAvailable && !isFileConnected && (
                  <button
                    onClick={handleConnectLocal}
                    disabled={isProcessing}
                    className="w-full py-2 text-xs font-medium border border-dashed border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700/50 hover:border-brand-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    <Save className="h-3.5 w-3.5" />
                    {persistenceStatus === 'granted'
                      ? 'Choose a Different Storage Location'
                      : 'Link a File for Auto-Save'}
                  </button>
                )}

              </div>
            );
          })()}

          {/* ── Anki Import ─────────────────────────────────────────────── */}
          <div className="p-4 rounded-xl border border-orange-100 dark:border-orange-800/40 bg-orange-50/40 dark:bg-orange-900/10 space-y-3">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-orange-500" />
              <span className="text-sm font-semibold text-slate-800 dark:text-white">Import from Anki</span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Upload an <strong>.apkg</strong> file exported from Anki. You'll be able to map fields before importing.
            </p>
            <button
              onClick={() => ankiFileInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-orange-500 text-white text-sm font-medium rounded-xl hover:bg-orange-600 transition-colors shadow-sm shadow-orange-500/20"
            >
              <Upload className="h-4 w-4" />
              Choose Anki Deck (.apkg)
            </button>
            <input
              type="file"
              ref={ankiFileInputRef}
              accept=".apkg"
              className="hidden"
              onChange={handleAnkiFileChange}
            />
          </div>


          {/* ── Cloud Sync (GitHub Gist — Instant 1-Request Sync) ───────── */}
          {(!cloudConfig || isGistConnected) && (
            <div
              data-testid="gist-cloud-section"
              className={`p-5 rounded-xl border transition-colors ${
                isGistConnected
                  ? 'bg-emerald-50/50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800/50'
                  : 'bg-indigo-50/40 dark:bg-indigo-900/15 border-indigo-200/80 dark:border-indigo-800/50'
              }`}
            >
              <div className="flex items-start justify-between mb-4 gap-2">
                <div>
                  <h3 className="text-slate-900 dark:text-white font-semibold flex items-center gap-2">
                    <Cloud className={`h-5 w-5 ${isGistConnected ? 'text-emerald-600 dark:text-emerald-400' : 'text-indigo-600 dark:text-indigo-400'}`} />
                    Cloud Sync (GitHub Gist)
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Instant 1-request sync (&lt;1s) to a private Secret Gist on your GitHub account. Never expires.
                  </p>
                </div>
                {isGistConnected ? (
                  <span
                    data-testid="gist-active-badge"
                    className="px-2 py-1 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-xs font-bold rounded-md uppercase tracking-wider shrink-0"
                  >
                    Active · Instant
                  </span>
                ) : (
                  <span className="px-2 py-1 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold rounded-md uppercase tracking-wider shrink-0">
                    Recommended
                  </span>
                )}
              </div>

              {!isGistConnected ? (
                <form onSubmit={handleGistConnectSubmit} className="space-y-3" data-testid="gist-connect-form">
                  <div className="space-y-2">
                    <input
                      type="password"
                      data-testid="gist-token-input"
                      placeholder="GitHub Personal Access Token (ghp_...)"
                      value={gistTokenInput}
                      onChange={(e) => setGistTokenInput(e.target.value)}
                      className="w-full text-sm px-3 py-2 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    />
                    <input
                      type="text"
                      data-testid="gist-id-input"
                      placeholder="Existing Gist ID (optional — blank to auto-detect/create)"
                      value={gistIdInput}
                      onChange={(e) => setGistIdInput(e.target.value)}
                      className="w-full text-xs px-3 py-1.5 border border-slate-200 dark:border-slate-600 bg-white/80 dark:bg-slate-700/80 text-slate-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent font-mono"
                    />
                    <div className="flex items-center justify-between text-[10px] text-slate-500 flex-wrap gap-1 pt-0.5">
                      <div className="flex items-center gap-1">
                        <span>Need a token?</span>
                        <a
                          href="https://github.com/settings/tokens/new?description=Lumina+Flashcards+Sync&scopes=gist"
                          target="_blank"
                          rel="noreferrer"
                          className="text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 font-medium"
                        >
                          Generate Token (&apos;gist&apos; scope) <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                      <button
                        type="button"
                        data-testid="toggle-gist-pantry-migration"
                        onClick={() => setShowGistMigrateFromPantry((v) => !v)}
                        className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium"
                      >
                        {showGistMigrateFromPantry ? 'Hide Pantry migration' : 'Migrating from Pantry?'}
                      </button>
                    </div>
                  </div>

                  {showGistMigrateFromPantry && (
                    <div className="p-3 rounded-lg bg-indigo-50/90 dark:bg-indigo-900/25 border border-indigo-200 dark:border-indigo-800/60 space-y-2">
                      <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                        All {cardCount} local flashcards, study history, and streaks are automatically synced. Enter your previous Pantry ID below to also pull and merge all flashcards from Pantry into your new GitHub Gist without losing any data:
                      </p>
                      <input
                        type="text"
                        data-testid="gist-migrate-pantry-input"
                        placeholder="Paste Pantry ID to migrate from (optional)"
                        value={gistOldPantryIdInput}
                        onChange={(e) => setGistOldPantryIdInput(e.target.value)}
                        className="w-full text-xs px-2.5 py-1.5 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                      />
                    </div>
                  )}

                  {cloudProgress && (
                    <div
                      data-testid="gist-progress-bar"
                      className="p-3 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800/60 space-y-2"
                    >
                      <div className="flex items-center justify-between text-xs font-medium text-indigo-900 dark:text-indigo-200">
                        <span className="flex items-center gap-1.5">
                          <RefreshCw className="h-3.5 w-3.5 animate-spin text-indigo-600 dark:text-indigo-400 shrink-0" />
                          <span>{cloudProgress.step}</span>
                        </span>
                        <span className="font-mono font-bold text-indigo-700 dark:text-indigo-300">
                          {cloudProgress.percent}%
                        </span>
                      </div>
                      <div
                        role="progressbar"
                        aria-label="GitHub Gist sync progress"
                        aria-valuenow={cloudProgress.percent}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        className="w-full h-2 bg-indigo-200/70 dark:bg-slate-700 rounded-full overflow-hidden"
                      >
                        <div
                          className="h-full bg-indigo-600 dark:bg-indigo-400 rounded-full transition-all duration-300 ease-out"
                          style={{ width: `${Math.max(5, Math.min(100, cloudProgress.percent))}%` }}
                        />
                      </div>
                    </div>
                  )}

                  <button
                    type="submit"
                    data-testid="connect-gist-btn"
                    disabled={isProcessing}
                    className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors shadow-sm shadow-indigo-500/20"
                  >
                    {isProcessing
                      ? 'Syncing with GitHub Gist...'
                      : showGistMigrateFromPantry && gistOldPantryIdInput.trim()
                        ? 'Migrate from Pantry & Connect GitHub Gist'
                        : 'Connect & Sync with GitHub Gist'}
                  </button>
                </form>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-xs bg-white/80 dark:bg-slate-800/80 px-3 py-2 rounded-lg border border-emerald-200/70 dark:border-emerald-800/40">
                    <span className="text-slate-500 dark:text-slate-400">Secret Gist ID:</span>
                    <a
                      href={`https://gist.github.com/${cloudConfig?.gistId || cloudConfig?.pantryId}`}
                      target="_blank"
                      rel="noreferrer"
                      data-testid="connected-gist-id"
                      className="font-mono text-emerald-700 dark:text-emerald-300 hover:underline flex items-center gap-1 truncate max-w-[230px]"
                      title={cloudConfig?.gistId || cloudConfig?.pantryId}
                    >
                      <span>{cloudConfig?.gistId || cloudConfig?.pantryId}</span>
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => handleCloudAction('pull')}
                      disabled={isProcessing}
                      className="flex flex-col items-center justify-center gap-1 p-3 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg hover:border-emerald-400 hover:text-emerald-600 dark:text-slate-200 dark:hover:text-emerald-400 transition-colors"
                    >
                      <Download className="h-4 w-4" />
                      <span className="text-xs font-medium">Load from Cloud</span>
                    </button>
                    <button
                      onClick={() => handleCloudAction('push')}
                      disabled={isProcessing}
                      className="flex flex-col items-center justify-center gap-1 p-3 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg hover:border-emerald-400 hover:text-emerald-600 dark:text-slate-200 dark:hover:text-emerald-400 transition-colors"
                    >
                      <Upload className="h-4 w-4" />
                      <span className="text-xs font-medium">Save to Cloud</span>
                    </button>
                  </div>

                  {cloudProgress && !isMigratingCloud && (
                    <div
                      data-testid="pantry-progress-bar"
                      className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/60 space-y-2"
                    >
                      <div className="flex items-center justify-between text-xs font-medium text-emerald-900 dark:text-emerald-200">
                        <span className="flex items-center gap-1.5">
                          <RefreshCw className="h-3.5 w-3.5 animate-spin text-emerald-600 dark:text-emerald-400 shrink-0" />
                          <span>{cloudProgress.step}</span>
                        </span>
                        <span className="font-mono font-bold text-emerald-700 dark:text-emerald-300">
                          {cloudProgress.percent}%
                        </span>
                      </div>
                      <div
                        role="progressbar"
                        aria-label="Pantry sync progress"
                        aria-valuenow={cloudProgress.percent}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        className="w-full h-2 bg-emerald-200/70 dark:bg-slate-700 rounded-full overflow-hidden"
                      >
                        <div
                          className="h-full bg-emerald-600 dark:bg-emerald-400 rounded-full transition-all duration-300 ease-out"
                          style={{ width: `${Math.max(5, Math.min(100, cloudProgress.percent))}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {isMigratingCloud && (
                    <form onSubmit={handleGistConnectSubmit} className="p-3.5 rounded-xl bg-white dark:bg-slate-800 border border-emerald-200 dark:border-emerald-700 space-y-3 animate-in fade-in duration-200">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                          Update GitHub Token / Gist ID
                        </span>
                        <button
                          type="button"
                          onClick={() => setIsMigratingCloud(false)}
                          className="text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                        >
                          Cancel
                        </button>
                      </div>
                      <input
                        type="password"
                        placeholder="GitHub Personal Access Token (ghp_...)"
                        value={gistTokenInput}
                        onChange={(e) => setGistTokenInput(e.target.value)}
                        className="w-full text-xs px-3 py-2 border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                      <input
                        type="text"
                        placeholder="Gist ID (leave blank to auto-detect/create)"
                        value={gistIdInput}
                        onChange={(e) => setGistIdInput(e.target.value)}
                        className="w-full text-xs px-3 py-1.5 border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                      />
                      <div className="flex items-center justify-end">
                        <button
                          type="submit"
                          disabled={isProcessing || !gistTokenInput.trim()}
                          className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg disabled:opacity-50 transition-colors"
                        >
                          {isProcessing ? 'Syncing...' : 'Save & Sync Gist'}
                        </button>
                      </div>
                    </form>
                  )}

                  <div className="flex items-center justify-between pt-3 border-t border-emerald-200/50 dark:border-emerald-800/40">
                    <div className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                      <RefreshCw className="h-3 w-3 animate-spin" style={{ animationDuration: '3s' }} />
                      Auto-sync enabled (1-request Gist)
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setIsMigratingCloud((v) => !v)}
                        className="text-xs text-emerald-700 dark:text-emerald-400 font-medium hover:underline"
                      >
                        {isMigratingCloud ? 'Close' : 'Change Token / Gist'}
                      </button>
                      <span className="text-slate-300 dark:text-slate-600">·</span>
                      <button onClick={onDisconnectCloud} className="text-xs text-red-500 hover:underline">
                        Disconnect
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Cloud Sync (Pantry) — Shown when disconnected or connected to Pantry ── */}
          {!isGistConnected && (
            <div className={`p-5 rounded-xl border transition-colors ${cloudConfig ? 'bg-sky-50/50 dark:bg-sky-900/10 border-sky-100 dark:border-sky-800/40' : 'bg-slate-50 dark:bg-slate-900/30 border-slate-200 dark:border-slate-700'}`}>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-slate-900 dark:text-white font-semibold flex items-center gap-2">
                    <Cloud className={`h-5 w-5 ${cloudConfig ? 'text-sky-500' : 'text-slate-400'}`} />
                    Cloud Sync (Pantry)
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Free unlimited storage for your flashcards.
                  </p>
                </div>
                {cloudConfig && (
                  <span className="px-2 py-1 bg-sky-100 text-sky-700 text-xs font-bold rounded-md uppercase tracking-wider">
                    Active
                  </span>
                )}
              </div>

              {!cloudConfig ? (
                <form onSubmit={handleCloudConnectSubmit} className="space-y-3">
                  <div>
                    <input
                      type="text"
                      placeholder="New or Existing Pantry ID"
                      value={pantryIdInput}
                      onChange={(e) => setPantryIdInput(e.target.value)}
                      className="w-full text-sm px-3 py-2 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                    />
                    <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500 flex-wrap gap-1">
                      <div className="flex items-center gap-1">
                        <span>Don't have one?</span>
                        <a href="https://getpantry.cloud/" target="_blank" rel="noreferrer" className="text-sky-600 hover:underline flex items-center gap-1 font-medium">
                          Create Pantry ID <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsMigratingCloud((v) => !v)}
                        className="text-sky-600 dark:text-sky-400 hover:underline font-medium"
                      >
                        {isMigratingCloud ? 'Hide migration options' : 'Migrating from an old ID?'}
                      </button>
                    </div>
                  </div>

                  {isMigratingCloud && (
                    <div className="p-3 rounded-lg bg-sky-50/80 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800/50 space-y-2">
                      <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                        All local flashcards ({cardCount}), study history, and streaks are automatically migrated to your new Pantry ID. If your previous Pantry ID is still active, enter it below to also merge its cloud data:
                      </p>
                      <input
                        type="text"
                        placeholder="Previous Pantry ID (optional)"
                        value={oldPantryIdInput}
                        onChange={(e) => setOldPantryIdInput(e.target.value)}
                        className="w-full text-xs px-2.5 py-1.5 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white rounded-md focus:outline-none focus:ring-2 focus:ring-sky-500"
                      />
                    </div>
                  )}

                  {cloudProgress && (
                    <div
                      data-testid="pantry-progress-bar"
                      className="p-3 rounded-xl bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800/60 space-y-2"
                    >
                      <div className="flex items-center justify-between text-xs font-medium text-sky-900 dark:text-sky-200">
                        <span className="flex items-center gap-1.5">
                          <RefreshCw className="h-3.5 w-3.5 animate-spin text-sky-600 dark:text-sky-400 shrink-0" />
                          <span>{cloudProgress.step}</span>
                        </span>
                        <span className="flex items-center gap-2 shrink-0">
                          {typeof cloudProgress.estimatedRemainingSec === 'number' && cloudProgress.estimatedRemainingSec > 0 && (
                            <span className="font-mono text-[10px] text-sky-600/80 dark:text-sky-400/80">
                              ~{cloudProgress.estimatedRemainingSec}s remaining
                            </span>
                          )}
                          <span className="font-mono font-bold text-sky-700 dark:text-sky-300">
                            {cloudProgress.percent}%
                          </span>
                        </span>
                      </div>
                      <div
                        role="progressbar"
                        aria-label="Pantry sync progress"
                        aria-valuenow={cloudProgress.percent}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        className="w-full h-2 bg-sky-200/70 dark:bg-slate-700 rounded-full overflow-hidden"
                      >
                        <div
                          className="h-full bg-sky-600 dark:bg-sky-400 rounded-full transition-all duration-300 ease-out"
                          style={{ width: `${Math.max(5, Math.min(100, cloudProgress.percent))}%` }}
                        />
                      </div>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isProcessing}
                    className="w-full py-2 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-medium rounded-lg hover:bg-slate-800 dark:hover:bg-white disabled:opacity-50 transition-colors"
                  >
                    {isProcessing ? 'Migrating & Connecting...' : isMigratingCloud ? 'Migrate All Data & Connect' : 'Connect & Sync Storage'}
                  </button>
                </form>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-xs bg-white/80 dark:bg-slate-800/80 px-3 py-2 rounded-lg border border-sky-100 dark:border-sky-800/40">
                    <span className="text-slate-500 dark:text-slate-400">Connected ID:</span>
                    <span className="font-mono text-slate-700 dark:text-slate-200 truncate max-w-[220px]" title={cloudConfig.pantryId}>
                      {cloudConfig.pantryId}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => handleCloudAction('pull')}
                      disabled={isProcessing}
                      className="flex flex-col items-center justify-center gap-1 p-3 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg hover:border-sky-300 hover:text-sky-600 dark:text-slate-200 dark:hover:text-sky-400 transition-colors"
                    >
                      <Download className="h-4 w-4" />
                      <span className="text-xs font-medium">Load from Cloud</span>
                    </button>
                    <button
                      onClick={() => handleCloudAction('push')}
                      disabled={isProcessing}
                      className="flex flex-col items-center justify-center gap-1 p-3 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg hover:border-sky-300 hover:text-sky-600 dark:text-slate-200 dark:hover:text-sky-400 transition-colors"
                    >
                      <Upload className="h-4 w-4" />
                      <span className="text-xs font-medium">Save to Cloud</span>
                    </button>
                  </div>

                  {/* One-click Pantry -> GitHub Gist Migration Callout & Form */}
                  <div className="p-3 rounded-xl bg-indigo-50/80 dark:bg-indigo-900/20 border border-indigo-200/80 dark:border-indigo-800/50 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-indigo-950 dark:text-indigo-200">
                          Switch to GitHub Gist (Instant &lt;1s Sync)
                        </p>
                        <p className="text-[11px] text-indigo-800/80 dark:text-indigo-300/80">
                          Migrate all local &amp; Pantry flashcards to a private Secret Gist with zero data loss.
                        </p>
                      </div>
                      <button
                        type="button"
                        data-testid="open-pantry-to-gist-migration"
                        onClick={() => {
                          setIsMigratingPantryToGist((v) => !v);
                          setIsMigratingCloud(false);
                        }}
                        className="shrink-0 px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors"
                      >
                        {isMigratingPantryToGist ? 'Close' : 'Migrate to Gist'}
                      </button>
                    </div>

                    {isMigratingPantryToGist && (
                      <form onSubmit={handleGistConnectSubmit} className="pt-2 border-t border-indigo-200/60 dark:border-indigo-800/50 space-y-2.5 animate-in fade-in duration-200">
                        <input
                          type="password"
                          data-testid="pantry-to-gist-token-input"
                          placeholder="Paste GitHub Personal Access Token (ghp_...)"
                          value={gistTokenInput}
                          onChange={(e) => setGistTokenInput(e.target.value)}
                          className="w-full text-xs px-3 py-2 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                        <input
                          type="text"
                          data-testid="pantry-to-gist-id-input"
                          placeholder="Existing Gist ID (optional — blank to auto-create Secret Gist)"
                          value={gistIdInput}
                          onChange={(e) => setGistIdInput(e.target.value)}
                          className="w-full text-xs px-3 py-1.5 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                        />
                        <div className="flex items-center justify-between gap-2 pt-0.5">
                          <a
                            href="https://github.com/settings/tokens/new?description=Lumina+Flashcards+Sync&scopes=gist"
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 font-medium"
                          >
                            Generate Token (&apos;gist&apos; scope) <ExternalLink className="h-3 w-3" />
                          </a>
                          <button
                            type="submit"
                            data-testid="confirm-pantry-to-gist-btn"
                            disabled={isProcessing || !gistTokenInput.trim()}
                            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg disabled:opacity-50 transition-colors"
                          >
                            {isProcessing ? 'Migrating...' : 'Migrate Pantry to GitHub Gist'}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>

                  {cloudProgress && !isMigratingCloud && (
                    <div
                      data-testid="pantry-progress-bar"
                      className="p-3 rounded-xl bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800/60 space-y-2"
                    >
                      <div className="flex items-center justify-between text-xs font-medium text-sky-900 dark:text-sky-200">
                        <span className="flex items-center gap-1.5">
                          <RefreshCw className="h-3.5 w-3.5 animate-spin text-sky-600 dark:text-sky-400 shrink-0" />
                          <span>{cloudProgress.step}</span>
                        </span>
                        <span className="flex items-center gap-2 shrink-0">
                          {typeof cloudProgress.estimatedRemainingSec === 'number' && cloudProgress.estimatedRemainingSec > 0 && (
                            <span className="font-mono text-[10px] text-sky-600/80 dark:text-sky-400/80">
                              ~{cloudProgress.estimatedRemainingSec}s remaining
                            </span>
                          )}
                          <span className="font-mono font-bold text-sky-700 dark:text-sky-300">
                            {cloudProgress.percent}%
                          </span>
                        </span>
                      </div>
                      <div
                        role="progressbar"
                        aria-label="Pantry sync progress"
                        aria-valuenow={cloudProgress.percent}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        className="w-full h-2 bg-sky-200/70 dark:bg-slate-700 rounded-full overflow-hidden"
                      >
                        <div
                          className="h-full bg-sky-600 dark:bg-sky-400 rounded-full transition-all duration-300 ease-out"
                          style={{ width: `${Math.max(5, Math.min(100, cloudProgress.percent))}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {isMigratingCloud && (
                    <form onSubmit={handleCloudMigrateSubmit} className="p-3.5 rounded-xl bg-white dark:bg-slate-800 border border-sky-200 dark:border-sky-700 space-y-3 animate-in fade-in duration-200">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                          Migrate to New Pantry ID
                        </span>
                        <button
                          type="button"
                          onClick={() => setIsMigratingCloud(false)}
                          className="text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                        >
                          Cancel
                        </button>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                        Enter a new or existing Pantry ID below. All {cardCount} local flashcards, study history, and streaks will be merged with any cards already in that Pantry so nothing is lost.
                      </p>
                      <input
                        type="text"
                        placeholder="Paste new Pantry ID"
                        value={newPantryIdInput}
                        onChange={(e) => setNewPantryIdInput(e.target.value)}
                        className="w-full text-sm px-3 py-2 border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                      />
                      {cloudProgress && (
                        <div
                          data-testid="pantry-progress-bar"
                          className="p-3 rounded-xl bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800/60 space-y-2"
                        >
                          <div className="flex items-center justify-between text-xs font-medium text-sky-900 dark:text-sky-200">
                            <span className="flex items-center gap-1.5">
                              <RefreshCw className="h-3.5 w-3.5 animate-spin text-sky-600 dark:text-sky-400 shrink-0" />
                              <span>{cloudProgress.step}</span>
                            </span>
                            <span className="flex items-center gap-2 shrink-0">
                              {typeof cloudProgress.estimatedRemainingSec === 'number' && cloudProgress.estimatedRemainingSec > 0 && (
                                <span className="font-mono text-[10px] text-sky-600/80 dark:text-sky-400/80">
                                  ~{cloudProgress.estimatedRemainingSec}s remaining
                                </span>
                              )}
                              <span className="font-mono font-bold text-sky-700 dark:text-sky-300">
                                {cloudProgress.percent}%
                              </span>
                            </span>
                          </div>
                          <div
                            role="progressbar"
                            aria-label="Pantry sync progress"
                            aria-valuenow={cloudProgress.percent}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            className="w-full h-2 bg-sky-200/70 dark:bg-slate-700 rounded-full overflow-hidden"
                          >
                            <div
                              className="h-full bg-sky-600 dark:bg-sky-400 rounded-full transition-all duration-300 ease-out"
                              style={{ width: `${Math.max(5, Math.min(100, cloudProgress.percent))}%` }}
                            />
                          </div>
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-2">
                        <a
                          href="https://getpantry.cloud/"
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] text-sky-600 hover:underline flex items-center gap-1 font-medium"
                        >
                          Create New Pantry ID <ExternalLink className="h-3 w-3" />
                        </a>
                        <button
                          type="submit"
                          disabled={isProcessing || !newPantryIdInput.trim()}
                          className="px-3.5 py-1.5 bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold rounded-lg disabled:opacity-50 transition-colors"
                        >
                          {isProcessing ? 'Migrating...' : 'Migrate All Data'}
                        </button>
                      </div>
                    </form>
                  )}

                  <div className="flex items-center justify-between pt-3 border-t border-sky-200/50">
                    <div className="text-xs text-sky-700 dark:text-sky-400 flex items-center gap-1.5">
                      <RefreshCw className="h-3 w-3 animate-spin" style={{ animationDuration: '3s' }} />
                      Auto-sync enabled
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setIsMigratingCloud((v) => !v)}
                        className="text-xs text-sky-600 dark:text-sky-400 font-medium hover:underline"
                      >
                        {isMigratingCloud ? 'Close Migrate' : 'Migrate / Change ID'}
                      </button>
                      <span className="text-slate-300 dark:text-slate-600">·</span>
                      <button onClick={onDisconnectCloud} className="text-xs text-red-500 hover:underline">
                        Disconnect
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}


          {/* Hidden file input for Import — triggered by inline Import button above */}
          <input
            type="file"
            ref={fileInputRef}
            accept=".json,.csv"
            className="hidden"
            onChange={handleFileChange}
          />

          {/* Status Messages */}
          {status.type !== 'idle' && (
            <div className={`flex items-center gap-3 p-3 rounded-xl text-sm font-medium animate-in fade-in slide-in-from-bottom-2
                ${status.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
              {status.type === 'success' ? <CheckCircle className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
              {status.msg}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};