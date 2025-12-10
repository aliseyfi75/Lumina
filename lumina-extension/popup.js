document.addEventListener('DOMContentLoaded', () => {
  // Load existing ID from storage
  chrome.storage.sync.get(['luminaPantryId'], (result) => {
    if (result.luminaPantryId) {
      document.getElementById('pantryId').value = result.luminaPantryId;
    }
  });

  // Save new ID
  document.getElementById('saveBtn').addEventListener('click', () => {
    const pantryId = document.getElementById('pantryId').value.trim();
    if (pantryId) {
      chrome.storage.sync.set({ luminaPantryId: pantryId }, () => {
        const status = document.getElementById('status');
        status.style.display = 'block';
        setTimeout(() => status.style.display = 'none', 2000);
      });
    }
  });
});
