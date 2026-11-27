// Lumina Collector 2.0 — Lightweight Inline Lookup & Context Capture Tooltip
(() => {
  if (window.location.href.includes('aliseyfi75.github.io/Lumina')) return;

  const HOST_ID = 'lumina-inline-tooltip-host';
  const WORD_PATTERN = /^[A-Za-z][A-Za-z'-]{1,28}$/;

  let inlineEnabled = true;
  let hostEl = null;
  let shadowRoot = null;
  let activeWord = '';
  let activeContext = '';

  if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
    chrome.storage.sync.get(['luminaInlineLookupEnabled'], (res) => {
      if (typeof res?.luminaInlineLookupEnabled === 'boolean') {
        inlineEnabled = res.luminaInlineLookupEnabled;
      }
    });
    chrome.storage.onChanged?.addListener((changes, area) => {
      if (area === 'sync' && changes.luminaInlineLookupEnabled) {
        inlineEnabled = changes.luminaInlineLookupEnabled.newValue !== false;
        if (!inlineEnabled) removeTooltip();
      }
    });
  }

  function isEditableTarget(target) {
    if (!target || !(target instanceof Element)) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
  }

  function extractContextSentence(selection, selectedWord) {
    try {
      const anchor = selection.anchorNode;
      if (!anchor) return '';
      const container =
        anchor.nodeType === Node.TEXT_NODE ? anchor.parentElement : anchor;
      const fullText = (container?.textContent || '').replace(/\s+/g, ' ').trim();
      if (!fullText) return '';
      const sentences = fullText.split(/(?<=[.!?])\s+/);
      const lowerWord = selectedWord.toLowerCase();
      const matching = sentences.find((s) => s.toLowerCase().includes(lowerWord));
      const candidate = (matching || fullText).trim();
      return candidate.length > 240 ? `${candidate.slice(0, 237).trim()}...` : candidate;
    } catch {
      return '';
    }
  }

  function removeTooltip() {
    if (hostEl && hostEl.parentNode) {
      hostEl.parentNode.removeChild(hostEl);
    }
    hostEl = null;
    shadowRoot = null;
    activeWord = '';
    activeContext = '';
  }

  function createTooltipHost(rect) {
    removeTooltip();
    hostEl = document.createElement('div');
    hostEl.id = HOST_ID;
    const top = Math.min(window.innerHeight - 16, rect.bottom + 8);
    const left = Math.max(12, Math.min(window.innerWidth - 312, rect.left));
    hostEl.style.position = 'fixed';
    hostEl.style.top = `${top}px`;
    hostEl.style.left = `${left}px`;
    hostEl.style.zIndex = '2147483647';
    shadowRoot = hostEl.attachShadow({ mode: 'open' });
    document.body.appendChild(hostEl);
    return shadowRoot;
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderCard(state) {
    if (!shadowRoot) return;
    const styles = `
      <style>
        .card {
          width: 296px;
          background: #0f172a;
          color: #f8fafc;
          border: 1px solid rgba(34, 197, 94, 0.35);
          border-radius: 14px;
          box-shadow: 0 18px 40px rgba(2, 6, 23, 0.45);
          padding: 12px 14px;
          font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif;
          font-size: 13px;
          line-height: 1.45;
          box-sizing: border-box;
        }
        .header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
        .word { font-weight: 700; font-size: 15px; color: #ffffff; }
        .pos { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #4ade80; font-weight: 700; margin-left: 6px; }
        .close { background: transparent; border: none; color: #94a3b8; cursor: pointer; font-size: 15px; padding: 2px 4px; }
        .close:hover { color: #ffffff; }
        .phonetic { font-size: 11px; color: #94a3b8; font-family: monospace; margin-bottom: 6px; }
        .def { color: #e2e8f0; margin-bottom: 10px; }
        .context { font-size: 11px; color: #94a3b8; font-style: italic; border-left: 2px solid #22c55e; padding-left: 8px; margin-bottom: 10px; }
        .actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .save-btn {
          flex: 1;
          background: #16a34a;
          color: #ffffff;
          border: none;
          border-radius: 9px;
          padding: 7px 10px;
          font-weight: 600;
          font-size: 12px;
          cursor: pointer;
        }
        .save-btn:hover:not(:disabled) { background: #15803d; }
        .save-btn:disabled { opacity: 0.7; cursor: default; }
        .brand { font-size: 10px; color: #64748b; font-weight: 600; }
      </style>
    `;

    if (state.loading) {
      shadowRoot.innerHTML = `${styles}<div class="card"><div class="header"><span class="word">${escapeHtml(state.word)}</span><button class="close" aria-label="Close">×</button></div><div class="def">Looking up in Lumina...</div></div>`;
    } else if (state.error) {
      shadowRoot.innerHTML = `${styles}<div class="card"><div class="header"><span class="word">${escapeHtml(state.word)}</span><button class="close" aria-label="Close">×</button></div><div class="def">${escapeHtml(state.error)}</div></div>`;
    } else {
      const entry = state.entry;
      const btnText = state.saved
        ? 'Saved to Lumina ✓'
        : state.saving
          ? 'Saving...'
          : 'Save to Lumina';
      shadowRoot.innerHTML = `${styles}
        <div class="card">
          <div class="header">
            <div>
              <span class="word">${escapeHtml(entry.word)}</span>
              ${entry.partOfSpeech ? `<span class="pos">${escapeHtml(entry.partOfSpeech)}</span>` : ''}
            </div>
            <button class="close" aria-label="Close">×</button>
          </div>
          ${entry.phonetic ? `<div class="phonetic">${escapeHtml(entry.phonetic)}</div>` : ''}
          <div class="def">${escapeHtml(entry.mainDefinition)}</div>
          ${activeContext ? `<div class="context">“${escapeHtml(activeContext)}”</div>` : ''}
          <div class="actions">
            <button class="save-btn" ${state.saving || state.saved ? 'disabled' : ''}>${btnText}</button>
            <span class="brand">Lumina</span>
          </div>
        </div>
      `;

      const saveBtn = shadowRoot.querySelector('.save-btn');
      if (saveBtn && !state.saving && !state.saved) {
        saveBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          renderCard({ ...state, saving: true });
          chrome.runtime.sendMessage(
            {
              type: 'LUMINA_ADD_WORD',
              word: entry.word,
              contextSentence: activeContext,
              sourceDomain: window.location.hostname,
            },
            (res) => {
              if (res?.ok) {
                renderCard({ ...state, saving: false, saved: true });
                setTimeout(removeTooltip, 1400);
              } else {
                renderCard({ ...state, saving: false, error: res?.error || 'Could not save word.' });
              }
            }
          );
        });
      }
    }

    const closeBtn = shadowRoot.querySelector('.close');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeTooltip();
      });
    }
  }

  document.addEventListener('dblclick', (event) => {
    if (!inlineEnabled || isEditableTarget(event.target)) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const text = selection.toString().trim();
    if (!WORD_PATTERN.test(text)) return;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return;

    activeWord = text;
    activeContext = extractContextSentence(selection, text);
    createTooltipHost(rect);
    renderCard({ loading: true, word: text });

    chrome.runtime.sendMessage({ type: 'LUMINA_LOOKUP', word: text }, (res) => {
      if (activeWord !== text) return;
      if (res?.ok && res.entry) {
        renderCard({ entry: res.entry, saving: false, saved: false });
      } else {
        renderCard({ word: text, error: res?.error || 'Definition not found.' });
      }
    });
  });

  document.addEventListener('mousedown', (event) => {
    if (!hostEl) return;
    if (event.target === hostEl) return;
    removeTooltip();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && hostEl) {
      removeTooltip();
    }
  });
})();
