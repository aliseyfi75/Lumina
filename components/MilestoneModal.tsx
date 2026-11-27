import React, { useRef } from 'react';
import { X, Trophy, Download, Flame, Layers, Sparkles } from 'lucide-react';
import { useAccessibleModal } from '../hooks/useAccessibleModal';

export const MILESTONE_THRESHOLDS = [25, 50, 100, 200, 300, 500, 1000] as const;

interface MilestoneModalProps {
  isOpen: boolean;
  milestoneCount: number;
  totalCards: number;
  currentStreak: number;
  onClose: () => void;
}

export const MilestoneModal: React.FC<MilestoneModalProps> = ({
  isOpen,
  milestoneCount,
  totalCards,
  currentStreak,
  onClose,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  useAccessibleModal(isOpen, onClose, modalRef);

  if (!isOpen) return null;

  const handleDownloadShareCard = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 630;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Background gradient
    const bg = ctx.createLinearGradient(0, 0, 1200, 630);
    bg.addColorStop(0, '#0f172a');
    bg.addColorStop(0.55, '#052e16');
    bg.addColorStop(1, '#0f172a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 1200, 630);

    // Subtle accent glow
    const glow = ctx.createRadialGradient(920, 140, 20, 920, 140, 360);
    glow.addColorStop(0, 'rgba(34, 197, 94, 0.25)');
    glow.addColorStop(1, 'rgba(34, 197, 94, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 1200, 630);

    // Border frame
    ctx.strokeStyle = 'rgba(74, 222, 128, 0.35)';
    ctx.lineWidth = 3;
    ctx.strokeRect(36, 36, 1128, 558);

    // Brand badge
    ctx.fillStyle = '#16a34a';
    ctx.fillRect(80, 76, 56, 56);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 34px Georgia, serif';
    ctx.fillText('L', 97, 116);

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 30px system-ui, sans-serif';
    ctx.fillText('Lumina', 152, 114);

    // Milestone headline
    ctx.fillStyle = '#4ade80';
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.fillText('VOCABULARY MILESTONE UNLOCKED', 80, 210);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 84px Georgia, serif';
    ctx.fillText(`${milestoneCount} Words Mastered`, 80, 310);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '26px system-ui, sans-serif';
    ctx.fillText('Illuminate your vocabulary with smart spaced repetition.', 80, 370);

    // Stat pills
    const stats = [
      { label: 'MASTERED', value: `${milestoneCount}` },
      { label: 'DECK SIZE', value: `${totalCards}` },
      { label: 'STREAK', value: `${currentStreak} ${currentStreak === 1 ? 'Day' : 'Days'}` },
    ];
    stats.forEach((stat, idx) => {
      const x = 80 + idx * 340;
      const y = 435;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.fillRect(x, y, 300, 110);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, 300, 110);

      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 16px system-ui, sans-serif';
      ctx.fillText(stat.label, x + 24, y + 38);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 38px system-ui, sans-serif';
      ctx.fillText(stat.value, x + 24, y + 86);
    });

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lumina-milestone-${milestoneCount}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  };

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center modal-safe-overlay bg-black/65 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="milestone-modal-title"
        data-testid="milestone-modal"
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md bg-gradient-to-br from-slate-900 via-brand-950 to-slate-900 text-white rounded-3xl shadow-2xl border border-brand-500/30 p-6 sm:p-7 text-center space-y-5 overflow-hidden animate-in zoom-in duration-200"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close milestone celebration"
          className="absolute top-4 right-4 p-2 rounded-full text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="mx-auto w-16 h-16 rounded-2xl bg-brand-500/20 border border-brand-400/40 flex items-center justify-center text-brand-300 shadow-lg shadow-brand-500/20">
          <Trophy className="h-8 w-8" />
        </div>

        <div className="space-y-2">
          <p className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-brand-300">
            <Sparkles className="h-3.5 w-3.5" />
            Milestone Unlocked
          </p>
          <h2 id="milestone-modal-title" className="text-3xl font-serif font-bold tracking-tight">
            {milestoneCount} Words Mastered!
          </h2>
          <p className="text-sm text-slate-300">
            Your consistency is paying off — those words are now locked into your long-term memory.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 text-left">
          <div className="p-3.5 rounded-2xl bg-white/10 border border-white/15">
            <p className="text-[11px] uppercase tracking-wider text-slate-300 font-semibold flex items-center gap-1">
              <Layers className="h-3.5 w-3.5 text-brand-300" />
              Total Deck
            </p>
            <p className="text-2xl font-bold mt-1">{totalCards}</p>
          </div>
          <div className="p-3.5 rounded-2xl bg-white/10 border border-white/15">
            <p className="text-[11px] uppercase tracking-wider text-slate-300 font-semibold flex items-center gap-1">
              <Flame className="h-3.5 w-3.5 text-orange-400" />
              Streak
            </p>
            <p className="text-2xl font-bold mt-1">
              {currentStreak} <span className="text-sm font-medium text-slate-300">{currentStreak === 1 ? 'day' : 'days'}</span>
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5 pt-2">
          <button
            type="button"
            data-testid="download-milestone-card-btn"
            onClick={handleDownloadShareCard}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold shadow-lg shadow-brand-500/30 transition-colors"
          >
            <Download className="h-4 w-4" />
            Download Share Card
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-sm font-semibold transition-colors"
          >
            Keep Going
          </button>
        </div>
      </div>
    </div>
  );
};
