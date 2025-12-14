document.addEventListener('DOMContentLoaded', () => {
  // Element References
  const viewSection = document.getElementById('viewSection');
  const editSection = document.getElementById('editSection');
  const displayId = document.getElementById('displayId');
  const pantryIdInput = document.getElementById('pantryIdInput');
  const saveBtn = document.getElementById('saveBtn');
  const openAppBtn = document.getElementById('openAppBtn');
  const editBtn = document.getElementById('editBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  const statusEl = document.getElementById('status');

  const PANTRY_API_BASE = "https://getpantry.cloud/apiv1/pantry";

  // 1. Initial Load: Check if we have an ID
  chrome.storage.sync.get(['luminaPantryId'], (result) => {
    if (result.luminaPantryId) {
      showViewMode(result.luminaPantryId);
    } else {
      showEditMode(false); // false = don't show cancel button (force setup)
    }
  });

  // 2. Save Button Click (Now with Validation)
  saveBtn.addEventListener('click', async () => {
    const newId = pantryIdInput.value.trim();
    
    if (!newId) {
      showStatus('Please enter an ID.', 'error');
      return;
    }

    // UI Feedback: Show loading state
    saveBtn.disabled = true;
    saveBtn.textContent = 'Verifying...';
    showStatus('', ''); // Clear previous errors

    try {
      // Step A: Validate ID by fetching details
      const isValid = await validatePantryId(newId);

      if (!isValid) {
        throw new Error('Invalid Pantry ID. Please check and try again.');
      }

      // Step B: Save if valid
      chrome.storage.sync.set({ luminaPantryId: newId }, () => {
        showStatus('Verified & Connected!', 'success');
        showViewMode(newId);
      });

    } catch (error) {
      showStatus(error.message, 'error');
    } finally {
      // Reset button state
      saveBtn.disabled = false;
      saveBtn.textContent = 'Connect Extension';
    }
  });

  // 3. Open App Button Click
  openAppBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://aliseyfi75.github.io/Lumina/' });
  });

  // 4. Edit Button Click
  editBtn.addEventListener('click', () => {
    showEditMode(true); // true = allow canceling
  });

  // 5. Cancel Button Click
  cancelBtn.addEventListener('click', () => {
    // Re-fetch existing ID and go back to view mode
    chrome.storage.sync.get(['luminaPantryId'], (result) => {
      if (result.luminaPantryId) {
        showViewMode(result.luminaPantryId);
      }
    });
  });

  // --- Helper Functions ---

  async function validatePantryId(pantryId) {
    try {
      const response = await fetch(`${PANTRY_API_BASE}/${pantryId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      return response.ok; // Returns true if 200-299, false if 400/404/500
    } catch (e) {
      return false; // Network error
    }
  }

  function showViewMode(id) {
    viewSection.classList.remove('hidden');
    editSection.classList.add('hidden');
    displayId.textContent = id;
    statusEl.textContent = ''; 
  }

  function showEditMode(canCancel) {
    viewSection.classList.add('hidden');
    editSection.classList.remove('hidden');
    
    // Pre-fill input
    pantryIdInput.value = displayId.textContent || '';
    pantryIdInput.focus(); // Auto-focus input for better UX
    
    // Toggle Cancel button
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
    // Only auto-clear success messages, keep errors visible
    if (type === 'success') {
      setTimeout(() => statusEl.textContent = '', 2500);
    }
  }
});
