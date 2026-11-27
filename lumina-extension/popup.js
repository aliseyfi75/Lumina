document.addEventListener('DOMContentLoaded', () => {
  const viewSection = document.getElementById('viewSection');
  const editSection = document.getElementById('editSection');
  const providerBadge = document.getElementById('providerBadge');
  const displayId = document.getElementById('displayId');

  const tabGist = document.getElementById('tabGist');
  const tabPantry = document.getElementById('tabPantry');
  const gistFields = document.getElementById('gistFields');
  const pantryFields = document.getElementById('pantryFields');

  const gistTokenInput = document.getElementById('gistTokenInput');
  const gistIdInput = document.getElementById('gistIdInput');
  const pantryIdInput = document.getElementById('pantryIdInput');

  const inlineToggleView = document.getElementById('inlineToggleView');
  const inlineToggleEdit = document.getElementById('inlineToggleEdit');

  const saveBtn = document.getElementById('saveBtn');
  const openAppBtn = document.getElementById('openAppBtn');
  const editBtn = document.getElementById('editBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  const statusEl = document.getElementById('status');

  const PANTRY_API_BASE = 'https://getpantry.cloud/apiv1/pantry';
  const GIST_API_BASE = 'https://api.github.com/gists';

  let activeProvider = 'gist';
  let currentConfig = {};

  function normalizeGistId(raw) {
    const trimmed = String(raw || '').trim();
    const urlMatch = trimmed.match(/gist\.github\.com\/(?:[^/]+\/)?([0-9a-f]{8,64})/i);
    if (urlMatch) return urlMatch[1];
    return trimmed;
  }

  function setProviderTab(provider) {
    activeProvider = provider;
    if (provider === 'gist') {
      tabGist.classList.add('active');
      tabPantry.classList.remove('active');
      gistFields.classList.remove('hidden');
      pantryFields.classList.add('hidden');
    } else {
      tabPantry.classList.add('active');
      tabGist.classList.remove('active');
      pantryFields.classList.remove('hidden');
      gistFields.classList.add('hidden');
    }
    statusEl.textContent = '';
  }

  tabGist.addEventListener('click', () => setProviderTab('gist'));
  tabPantry.addEventListener('click', () => setProviderTab('pantry'));

  // Keep inline lookup preference synced across view/edit toggles
  function syncInlineToggle(enabled) {
    inlineToggleView.checked = enabled;
    inlineToggleEdit.checked = enabled;
    chrome.storage.sync.set({ luminaInlineLookupEnabled: enabled });
  }
  inlineToggleView.addEventListener('change', () => syncInlineToggle(inlineToggleView.checked));
  inlineToggleEdit.addEventListener('change', () => syncInlineToggle(inlineToggleEdit.checked));

  // Initial Load
  chrome.storage.sync.get(
    [
      'luminaSyncProvider',
      'luminaGistToken',
      'luminaGistId',
      'luminaPantryId',
      'luminaInlineLookupEnabled',
    ],
    (result) => {
      currentConfig = result || {};
      const inlineEnabled = result.luminaInlineLookupEnabled !== false;
      inlineToggleView.checked = inlineEnabled;
      inlineToggleEdit.checked = inlineEnabled;

      const hasGist = Boolean(result.luminaGistToken && result.luminaGistId);
      const hasPantry = Boolean(result.luminaPantryId);
      const provider =
        result.luminaSyncProvider || (hasGist ? 'gist' : hasPantry ? 'pantry' : 'gist');

      if ((provider === 'gist' && hasGist) || (provider === 'pantry' && hasPantry)) {
        showViewMode(provider, result);
      } else {
        setProviderTab(provider);
        showEditMode(false);
      }
    }
  );

  // Save Button Click (Validates GitHub Gist or Pantry)
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Verifying...';
    showStatus('', '');

    try {
      const inlineEnabled = inlineToggleEdit.checked;
      if (activeProvider === 'gist') {
        const token = gistTokenInput.value.trim();
        const gistId = normalizeGistId(gistIdInput.value);
        if (!token || !gistId) {
          throw new Error('Please enter both your GitHub token and Gist ID.');
        }

        const res = await fetch(`${GIST_API_BASE}/${encodeURIComponent(gistId)}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
          },
        });
        if (!res.ok) {
          throw new Error(`Could not verify Gist (${res.status}). Check your token and Gist ID.`);
        }

        const nextConfig = {
          luminaSyncProvider: 'gist',
          luminaGistToken: token,
          luminaGistId: gistId,
          luminaInlineLookupEnabled: inlineEnabled,
        };
        chrome.storage.sync.set(nextConfig, () => {
          currentConfig = { ...currentConfig, ...nextConfig };
          showStatus('Verified & Connected to GitHub Gist!', 'success');
          showViewMode('gist', currentConfig);
        });
      } else {
        const newId = pantryIdInput.value.trim();
        if (!newId) {
          throw new Error('Please enter a Pantry ID.');
        }
        const isValid = await validatePantryId(newId);
        if (!isValid) {
          throw new Error('Invalid Pantry ID. Please check and try again.');
        }

        const nextConfig = {
          luminaSyncProvider: 'pantry',
          luminaPantryId: newId,
          luminaInlineLookupEnabled: inlineEnabled,
        };
        chrome.storage.sync.set(nextConfig, () => {
          currentConfig = { ...currentConfig, ...nextConfig };
          showStatus('Verified & Connected to Pantry!', 'success');
          showViewMode('pantry', currentConfig);
        });
      }
    } catch (error) {
      showStatus(error.message, 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Connect Extension';
    }
  });

  openAppBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://aliseyfi75.github.io/Lumina/' });
  });

  editBtn.addEventListener('click', () => {
    showEditMode(true);
  });

  cancelBtn.addEventListener('click', () => {
    const provider = currentConfig.luminaSyncProvider || (currentConfig.luminaGistId ? 'gist' : 'pantry');
    showViewMode(provider, currentConfig);
  });

  async function validatePantryId(pantryId) {
    try {
      const response = await fetch(`${PANTRY_API_BASE}/${pantryId}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  function showViewMode(provider, cfg) {
    viewSection.classList.remove('hidden');
    editSection.classList.add('hidden');
    if (provider === 'gist') {
      providerBadge.textContent = 'GitHub Gist (Instant)';
      displayId.textContent = cfg.luminaGistId || '';
    } else {
      providerBadge.textContent = 'Pantry Cloud';
      displayId.textContent = cfg.luminaPantryId || '';
    }
  }

  function showEditMode(canCancel) {
    viewSection.classList.add('hidden');
    editSection.classList.remove('hidden');

    const provider = currentConfig.luminaSyncProvider || (currentConfig.luminaGistId ? 'gist' : 'pantry');
    setProviderTab(provider);

    gistTokenInput.value = currentConfig.luminaGistToken || '';
    gistIdInput.value = currentConfig.luminaGistId || '';
    pantryIdInput.value = currentConfig.luminaPantryId || '';

    if (canCancel) {
      cancelBtn.classList.remove('hidden');
    } else {
      cancelBtn.classList.add('hidden');
    }
    statusEl.textContent = '';
  }

  function showStatus(msg, type) {
    statusEl.textContent = msg;
    statusEl.className = `status ${type}`;
    if (type === 'success') {
      setTimeout(() => {
        statusEl.textContent = '';
      }, 2500);
    }
  }
});
