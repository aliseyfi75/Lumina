document.addEventListener('DOMContentLoaded', () => {
  // Element References
  const viewSection = document.getElementById('viewSection');
  const editSection = document.getElementById('editSection');
  const displayId = document.getElementById('displayId');
  const pantryIdInput = document.getElementById('pantryIdInput');
  const saveBtn = document.getElementById('saveBtn');
  const editBtn = document.getElementById('editBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  const statusEl = document.getElementById('status');

  // 1. Initial Load: Check if we have an ID
  chrome.storage.sync.get(['luminaPantryId'], (result) => {
    if (result.luminaPantryId) {
      showViewMode(result.luminaPantryId);
    } else {
      showEditMode(false); // false = don't show cancel button (force setup)
    }
  });

  // 2. Save Button Click
  saveBtn.addEventListener('click', () => {
    const newId = pantryIdInput.value.trim(); // Fixed typo here
    if (!newId) {
      showStatus('Please enter a valid ID.', 'error');
      return;
    }

    // Save to Chrome Sync Storage
    chrome.storage.sync.set({ luminaPantryId: newId }, () => {
      showStatus('Connected successfully!', 'success');
      showViewMode(newId);
    });
  });

  // 3. Edit Button Click
  editBtn.addEventListener('click', () => {
    showEditMode(true); // true = allow canceling
  });

  // 4. Cancel Button Click
  cancelBtn.addEventListener('click', () => {
    // Re-fetch existing ID and go back to view mode
    chrome.storage.sync.get(['luminaPantryId'], (result) => {
      if (result.luminaPantryId) {
        showViewMode(result.luminaPantryId);
      }
    });
  });

  // --- Helper Functions ---

  function showViewMode(id) {
    viewSection.classList.remove('hidden');
    editSection.classList.add('hidden');
    displayId.textContent = id;
    statusEl.textContent = ''; // Clear status
  }

  function showEditMode(canCancel) {
    viewSection.classList.add('hidden');
    editSection.classList.remove('hidden');
    
    // Pre-fill input with current displayed ID if available
    pantryIdInput.value = displayId.textContent || '';
    
    // Toggle Cancel button visibility based on context
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
      setTimeout(() => statusEl.textContent = '', 2000);
    }
  }
});
