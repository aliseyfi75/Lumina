import React from 'react';
import { AlertTriangle, RefreshCw, Download } from 'lucide-react';
import { loadAppDataFromIDB } from '../services/idbService';
import { downloadJSON, generateJSON } from '../services/fileService';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
  exportStatus: string | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: '',
      exportStatus: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      errorMessage: error?.message || 'An unexpected error occurred.',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Lumina ErrorBoundary caught an error:', error, info.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleEmergencyExport = async () => {
    try {
      const idbData = await loadAppDataFromIDB();
      if (idbData && Array.isArray(idbData.cards)) {
        downloadJSON(generateJSON(idbData), `lumina_emergency_backup_${Date.now()}.json`);
        this.setState({ exportStatus: `Exported ${idbData.cards.length} cards from browser storage.` });
        return;
      }

      const raw = localStorage.getItem('lumina_cards_v1');
      if (raw) {
        const cards = JSON.parse(raw);
        if (Array.isArray(cards)) {
          downloadJSON(generateJSON({ cards }), `lumina_emergency_backup_${Date.now()}.json`);
          this.setState({ exportStatus: `Exported ${cards.length} cards from local backup.` });
          return;
        }
      }

      this.setState({ exportStatus: 'No saved cards found to export.' });
    } catch {
      this.setState({ exportStatus: 'Could not read local storage for backup.' });
    }
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div
        role="alert"
        className="min-h-[100dvh] bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 flex items-center justify-center p-6"
      >
        <div className="w-full max-w-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl shadow-xl p-6 sm:p-8 text-center space-y-5">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 flex items-center justify-center">
            <AlertTriangle className="h-7 w-7" />
          </div>
          <div className="space-y-2">
            <h1 className="text-xl sm:text-2xl font-serif font-bold">Something went wrong</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
              Your vocabulary deck is safely stored in your browser. Reload Lumina or download an emergency backup below.
            </p>
            {this.state.errorMessage && (
              <p className="text-xs font-mono text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-900/60 px-3 py-2 rounded-xl break-words">
                {this.state.errorMessage}
              </p>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-2.5 justify-center">
            <button
              type="button"
              onClick={this.handleReload}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold shadow-sm transition-colors"
            >
              <RefreshCw className="h-4 w-4" />
              Reload Lumina
            </button>
            <button
              type="button"
              onClick={this.handleEmergencyExport}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-sm font-medium transition-colors"
            >
              <Download className="h-4 w-4" />
              Export Backup
            </button>
          </div>

          {this.state.exportStatus && (
            <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
              {this.state.exportStatus}
            </p>
          )}
        </div>
      </div>
    );
  }
}
