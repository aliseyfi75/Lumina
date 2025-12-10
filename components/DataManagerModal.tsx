import React, { useRef, useState, useEffect } from 'react';
import { X, Database, Download, Upload, CheckCircle, AlertCircle, RefreshCw, Save, AlertTriangle, Cloud, ExternalLink } from 'lucide-react';
import { CloudConfig } from '../types';

interface DataManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: () => void;
  onImport: (file: File) => Promise<void>;
  onConnectFile?: () => Promise<void>;
  onManualSave?: () => Promise<void>;
  isFileConnected: boolean;
  connectedFileName?: string;
  cardCount: number;
  
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
  onManualSave,
  isFileConnected,
  connectedFileName,
  cardCount,
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
      showMessage('success', 'Deck successfully updated from CSV!');
    } catch (err) {
      showMessage('error', 'Failed to parse CSV file.');
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleConnectLocal = async () => {
    if (onConnectFile) {
        try {
            await onConnectFile();
            showMessage('success', 'File connected! Auto-save enabled.');
        } catch (e) { /* Cancelled */ }
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 shrink-0">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-brand-100 text-brand-600 rounded-lg">
              <Database className="h-5 w-5" />
            </div>
            <h2 className="text-xl font-serif font-bold text-slate-900">Data Manager</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar">
          
          {/* Cloud Sync Section */}
          <div className={`p-5 rounded-xl border transition-colors ${cloudConfig ? 'bg-sky-50/50 border-sky-100' : 'bg-slate-50 border-slate-200'}`}>
            <div className="flex items-start justify-between mb-4">
                 <div>
                    <h3 className="text-slate-900 font-semibold flex items-center gap-2">
                        <Cloud className={`h-5 w-5 ${cloudConfig ? 'text-sky-500' : 'text-slate-400'}`} />
                        Cloud Sync (Pantry)
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">
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
                            className="w-full text-sm px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
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
                        className="w-full py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors"
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
                            className="flex flex-col items-center justify-center gap-1 p-3 bg-white border border-slate-200 rounded-lg hover:border-sky-300 hover:text-sky-600 transition-colors"
                        >
                            <Download className="h-4 w-4" />
                            <span className="text-xs font-medium">Load from Cloud</span>
                        </button>
                        <button
                            onClick={() => handleCloudAction('push')}
                            disabled={isProcessing}
                            className="flex flex-col items-center justify-center gap-1 p-3 bg-white border border-slate-200 rounded-lg hover:border-sky-300 hover:text-sky-600 transition-colors"
                        >
                            <Upload className="h-4 w-4" />
                            <span className="text-xs font-medium">Save to Cloud</span>
                        </button>
                    </div>
                    <div className="flex items-center justify-between pt-3 border-t border-sky-200/50">
                        <div className="text-xs text-sky-700 flex items-center gap-1.5">
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

          <div className="h-px bg-slate-100"></div>

          {/* Local File Sync Section */}
          <div className={`p-4 rounded-xl border ${isFileConnected ? 'border-green-100 bg-green-50/50' : 'border-slate-200 bg-slate-50'}`}>
             {isFileSystemAvailable ? (
                <div className="flex items-center justify-between gap-4">
                    <div className="flex-1">
                        <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                           <Save className="h-4 w-4" />
                           {isFileConnected ? 'Local CSV Connected' : 'Local CSV Auto-Save'}
                        </h3>
                        {isFileConnected && (
                           <p className="text-xs text-green-700 mt-1 truncate max-w-[200px]" title={connectedFileName}>
                              Using: {connectedFileName}
                           </p>
                        )}
                    </div>
                    {isFileConnected ? (
                        <button
                            onClick={handleManualLocalSave}
                            disabled={isProcessing}
                            className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 shadow-sm"
                        >
                            Save Now
                        </button>
                    ) : (
                        <button 
                            onClick={handleConnectLocal}
                            className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50"
                        >
                            Connect File
                        </button>
                    )}
                </div>
             ) : (
                <div className="flex items-start gap-3 opacity-70">
                    <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
                    <p className="text-xs text-slate-500">
                        Local file auto-save unavailable in this browser. Use Cloud Sync or Export below.
                    </p>
                </div>
             )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={onExport}
              disabled={cardCount === 0}
              className="py-2.5 bg-white border border-slate-200 text-slate-700 text-sm font-medium rounded-xl hover:bg-slate-50 hover:text-brand-600 hover:border-brand-200 transition-colors shadow-sm disabled:opacity-50"
            >
              Export CSV
            </button>
            
            <div className="relative">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full py-2.5 bg-brand-600 text-white text-sm font-medium rounded-xl hover:bg-brand-700 transition-colors shadow-sm shadow-brand-500/30"
                >
                  Import CSV
                </button>
                <input 
                    type="file" 
                    ref={fileInputRef}
                    accept=".csv"
                    className="hidden"
                    onChange={handleFileChange}
                />
            </div>
          </div>

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