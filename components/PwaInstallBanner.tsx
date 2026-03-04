import React, { useState, useEffect } from 'react';
import { X, Download } from 'lucide-react';

const DISMISS_KEY = 'lumina_pwa_install_dismissed';

export const PwaInstallBanner: React.FC = () => {
    const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
    const [show, setShow] = useState(false);

    useEffect(() => {
        // Don't show if user already dismissed
        if (localStorage.getItem(DISMISS_KEY) === 'true') return;

        // Don't show if already installed (standalone / fullscreen)
        const isInstalled =
            window.matchMedia('(display-mode: standalone)').matches ||
            (window.navigator as any).standalone === true;
        if (isInstalled) return;

        const handler = (e: Event) => {
            e.preventDefault();
            setDeferredPrompt(e);
            setShow(true);
        };

        window.addEventListener('beforeinstallprompt', handler);
        return () => window.removeEventListener('beforeinstallprompt', handler);
    }, []);

    const handleInstall = async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            setShow(false);
        }
        setDeferredPrompt(null);
    };

    const handleDismiss = () => {
        localStorage.setItem(DISMISS_KEY, 'true');
        setShow(false);
    };

    if (!show) return null;

    return (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-md animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl shadow-slate-900/10 dark:shadow-slate-900/50 flex items-center gap-4 p-4">
                <div className="w-10 h-10 bg-brand-600 rounded-xl flex items-center justify-center text-white font-serif font-bold text-xl shrink-0 shadow-md shadow-brand-500/30">
                    L
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">Add Lumina to Home Screen</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Use it offline, like a native app.</p>
                </div>
                <button
                    onClick={handleInstall}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold rounded-lg transition-colors shadow-sm shadow-brand-500/30"
                >
                    <Download className="h-3.5 w-3.5" />
                    Install
                </button>
                <button
                    onClick={handleDismiss}
                    className="shrink-0 p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
                    aria-label="Dismiss install banner"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>
        </div>
    );
};
