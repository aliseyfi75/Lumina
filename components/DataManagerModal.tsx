import React, { useRef, useState, useEffect } from 'react';
import { X, Database, Download, Upload, CheckCircle, AlertCircle, RefreshCw, Save, AlertTriangle, Cloud, ExternalLink, HardDrive, ShieldCheck, ShieldAlert } from 'lucide-react';
import { CloudConfig } from '../types';

interface DataManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: () => void;
  onImport: (file: File) => Promise<void>;
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
  onConnectCloud: (pantryId: string) => Promise<void>;
  onDisconnectCloud: () => void;
  onCloudPull: () => Promise<void>;
  onCloudPush: () => Promise<void>;
}

export const DataManagerModal: React.FC<DataManagerModalProps> = ({
  isOpen,
  onClose,
  onExport,
  onImport,
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
  onDisconnectCloud,
  onCloudPull,
  onCloudPush
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  useEffect(() => {
    setIsIframe(window.self !== window.top);
    if (isOpen && cloudConfig) {
      setPantryIdInput(cloudConfig.pantryId);
    }
  }, [isOpen, cloudConfig]);

  // @ts-ignore
  const browserSupportsApi = typeof window !== 'undefined' && 'showOpenFilePicker' in window;
  const isFileSystemAvailable = browserSupportsApi && !isIframe;

  if (!isOpen) return null;

  const showMessage = (type: 'success' | 'error', msg: string) => {
    setStatus({ type, msg });
    if (type === 'success') {
      setTimeout(() => setStatus({ type: 'idle', msg: '' }), 3000);
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

  const handleCloudConnectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pantryIdInput.trim()) return showMessage('error', 'Pantry ID is required');

    setIsProcessing(true);
    try {
      await onConnectCloud(pantryIdInput.trim());
      showMessage('success', 'Connected to Pantry!');
    } catch (error: any) {
      showMessage('error', error.message || 'Failed to connect to Pantry');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCloudAction = async (action: 'pull' | 'push') => {
    setIsProcessing(true);
    try {
      if (action === 'pull') {
        await onCloudPull();
        showMessage('success', 'Flashcards loaded from Cloud!');
      } else {
        await onCloudPush();
        showMessage('success', 'Flashcards saved to Cloud!');
      }
    } catch (error: any) {
      showMessage('error', error.message || `Failed to ${action} cloud data`);
    } finally {
      setIsProcessing(false);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-6 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/30 shrink-0">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-brand-100 dark:bg-brand-900/40 text-brand-600 dark:text-brand-400 rounded-lg">
              <Database className="h-5 w-5" />
            </div>
            <h2 className="text-xl font-serif font-bold text-slate-900 dark:text-white">Data Manager</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto custom-scrollbar">

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



          {/* Cloud Sync Section */}
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
                    placeholder="Your Pantry ID"
                    value={pantryIdInput}
                    onChange={(e) => setPantryIdInput(e.target.value)}
                    className="w-full text-sm px-3 py-2 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                  />
                  <div className="mt-2 text-[10px] text-slate-500 flex flex-wrap gap-1">
                    <span>Don't have one?</span>
                    <a href="https://getpantry.cloud/" target="_blank" rel="noreferrer" className="text-sky-600 hover:underline flex items-center gap-1 font-medium">
                      Create Pantry ID <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={isProcessing}
                  className="w-full py-2 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-medium rounded-lg hover:bg-slate-800 dark:hover:bg-white disabled:opacity-50 transition-colors"
                >
                  {isProcessing ? 'Connecting...' : 'Connect Storage'}
                </button>
              </form>
            ) : (
              <div className="space-y-4">
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
                <div className="flex items-center justify-between pt-3 border-t border-sky-200/50">
                  <div className="text-xs text-sky-700 dark:text-sky-400 flex items-center gap-1.5">
                    <RefreshCw className="h-3 w-3 animate-spin" style={{ animationDuration: '3s' }} />
                    Auto-sync enabled
                  </div>
                  <button onClick={onDisconnectCloud} className="text-xs text-red-500 hover:underline">
                    Disconnect
                  </button>
                </div>
              </div>
            )}
          </div>


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