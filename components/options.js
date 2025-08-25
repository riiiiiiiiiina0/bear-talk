// Storage key for saved prompts
const PROMPTS_STORAGE_KEY = 'savedPrompts';

// DOM elements
const promptsContainer = document.getElementById('prompts-container');
const noPromptsState = document.getElementById('no-prompts-state');
const noResultsState = document.getElementById('no-results-state');
const searchInput = /** @type {HTMLInputElement} */ (
  document.getElementById('search-input')
);
const addPromptBtn = document.getElementById('add-prompt-btn');
const emptyStateAddBtn = document.getElementById('empty-state-add-btn');
const clearSearchBtn = document.getElementById('clear-search-btn');

// Import/Export elements
const exportPromptsBtn = document.getElementById('export-prompts-btn');
const importPromptsBtn = /** @type {HTMLButtonElement} */ (
  document.getElementById('import-prompts-btn')
);
const importFileInput = /** @type {HTMLInputElement} */ (
  document.getElementById('import-file-input')
);

// Modal elements
const promptModal = document.getElementById('prompt-modal');
const modalTitle = document.getElementById('modal-title');
const promptNameInput = /** @type {HTMLInputElement} */ (
  document.getElementById('prompt-name')
);
const promptContentInput = /** @type {HTMLTextAreaElement} */ (
  document.getElementById('prompt-content')
);
const savePromptBtn = document.getElementById('save-prompt-btn');
const cancelBtn = document.getElementById('cancel-btn');
// modalBackdrop removed - integrated into modal container
const promptRequireSearchInput = /** @type {HTMLInputElement} */ (
  document.getElementById('prompt-require-search')
);

// Delete modal elements
const deleteModal = document.getElementById('delete-modal');
const deletePromptName = document.getElementById('delete-prompt-name');
const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
const cancelDeleteBtn = document.getElementById('cancel-delete-btn');
// deleteModalBackdrop removed - integrated into modal container

// Current state
let prompts = [];
let editingPromptId = null;
let deletingPromptId = null;
let filteredPrompts = [];
let currentSearchTerm = '';
let draggedPromptId = null;

/**
 * Generate a unique ID for a prompt
 * @returns {string}
 */
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/**
 * Get all saved prompts from Chrome sync storage
 * @returns {Promise<Array>}
 */
async function getPrompts() {
  try {
    const result = await chrome.storage.sync.get([PROMPTS_STORAGE_KEY]);
    return result[PROMPTS_STORAGE_KEY] || [];
  } catch (error) {
    console.error('Error getting prompts:', error);
    return [];
  }
}

/**
 * Save prompts to Chrome sync storage
 * @param {Array} promptsArray
 * @returns {Promise<void>}
 */
async function savePrompts(promptsArray) {
  try {
    await chrome.storage.sync.set({ [PROMPTS_STORAGE_KEY]: promptsArray });
  } catch (error) {
    console.error('Error saving prompts:', error);
    throw error;
  }
}

/**
 * Create a new prompt
 * @param {string} name
 * @param {string} content
 * @returns {Promise<void>}
 */
async function createPrompt(name, content) {
  const newPrompt = {
    id: generateId(),
    name: name.trim(),
    content: content.trim(),
    requireSearch: Boolean(promptRequireSearchInput?.checked),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Add to the beginning so it appears at the top of the list
  prompts.unshift(newPrompt);
  await savePrompts(prompts);
}

/**
 * Update an existing prompt
 * @param {string} id
 * @param {string} name
 * @param {string} content
 * @returns {Promise<void>}
 */
async function updatePrompt(id, name, content) {
  const promptIndex = prompts.findIndex((p) => p.id === id);
  if (promptIndex === -1) {
    throw new Error('Prompt not found');
  }

  const updatedPrompt = {
    ...prompts[promptIndex],
    name: name.trim(),
    content: content.trim(),
    requireSearch: Boolean(promptRequireSearchInput?.checked),
    updatedAt: new Date().toISOString(),
  };
  // Remove old entry and move updated one to the top
  prompts.splice(promptIndex, 1);
  prompts.unshift(updatedPrompt);

  await savePrompts(prompts);
}

/**
 * Delete a prompt
 * @param {string} id
 * @returns {Promise<void>}
 */
async function deletePrompt(id) {
  prompts = prompts.filter((p) => p.id !== id);
  await savePrompts(prompts);
}

/**
 * Filter prompts based on search term
 * @param {string} searchTerm
 */
function filterPrompts(searchTerm) {
  currentSearchTerm = searchTerm;
  if (!searchTerm.trim()) {
    filteredPrompts = [...prompts];
  } else {
    const term = searchTerm.toLowerCase();
    filteredPrompts = prompts.filter(
      (prompt) =>
        prompt.name.toLowerCase().includes(term) ||
        prompt.content.toLowerCase().includes(term),
    );
  }
  renderPrompts();
}

/**
 * Create HTML for a single prompt table row
 * @param {Object} prompt
 * @returns {string}
 */
function createPromptCard(prompt) {
  const maxLength = 100;
  const truncatedContent =
    prompt.content.length > maxLength
      ? prompt.content.substring(0, maxLength) + '...'
      : prompt.content;

  // Use highlighting if there's a search term, otherwise just escape HTML
  const highlightedName = highlightText(prompt.name, currentSearchTerm);
  const highlightedContent = highlightText(truncatedContent, currentSearchTerm);

  return `
    <tr class="group hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-move" draggable="true" data-prompt-id="${
      prompt.id
    }">
      <td class="w-1/3 whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900 dark:text-white">
        <div class="flex flex-row items-center gap-1">
          ${highlightedName}
          ${
            prompt.requireSearch
              ? '<span class="badge badge-xs badge-primary align-middle">Search</span>'
              : ''
          }
        </div>
      </td>
      <td class="w-2/3 max-w-lg truncate px-6 py-4 text-sm text-gray-500 dark:text-gray-400">${highlightedContent}</td>
      <td class="whitespace-nowrap px-6 py-4 text-right text-sm font-medium">
        <div class="flex items-center justify-end gap-x-4">
          <button class="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 edit-prompt-btn cursor-pointer p-1 transition-colors" data-prompt-id="${
            prompt.id
          }" title="Edit prompt">
            <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg">
              <path d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" stroke-linecap="round" stroke-linejoin="round"></path>
            </svg>
          </button>
          <button class="text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400 delete-prompt-btn cursor-pointer p-1 transition-colors" data-prompt-id="${
            prompt.id
          }" title="Delete prompt">
            <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg">
              <path d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" stroke-linecap="round" stroke-linejoin="round"></path>
            </svg>
          </button>
        </div>
      </td>
    </tr>
  `;
}

/**
 * Drag & Drop handlers for reordering prompts
 */
function handleDragStart(e) {
  const row = /** @type {HTMLElement} */ (e.currentTarget);
  draggedPromptId = row.getAttribute('data-prompt-id');
  row.classList.add('opacity-50');
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    try {
      // Required for Firefox
      e.dataTransfer.setData('text/plain', draggedPromptId || '');
    } catch (_) {
      /* no-op */
    }
  }
}

function handleDragOver(e) {
  e.preventDefault();
  const row = /** @type {HTMLElement} */ (e.currentTarget);
  row.classList.add('ring', 'ring-blue-400');
}

function handleDragLeave(e) {
  const row = /** @type {HTMLElement} */ (e.currentTarget);
  row.classList.remove('ring', 'ring-blue-400');
}

function handleDrop(e) {
  e.preventDefault();
  const row = /** @type {HTMLElement} */ (e.currentTarget);
  row.classList.remove('ring', 'ring-blue-400');
  const targetPromptId = row.getAttribute('data-prompt-id');
  if (
    !draggedPromptId ||
    !targetPromptId ||
    draggedPromptId === targetPromptId
  ) {
    return;
  }

  const srcIndex = prompts.findIndex((p) => p.id === draggedPromptId);
  const destIndex = prompts.findIndex((p) => p.id === targetPromptId);
  if (srcIndex === -1 || destIndex === -1) return;

  const [moved] = prompts.splice(srcIndex, 1);
  prompts.splice(destIndex, 0, moved);

  // Persist new order and re-render
  savePrompts(prompts)
    .then(() => {
      filterPrompts(currentSearchTerm);
    })
    .catch((error) => {
      console.error('Error saving reordered prompts:', error);
      showStatus('Error saving prompt order. Please try again.', true);
    });
}

function handleDragEnd() {
  document
    .querySelectorAll('tr[data-prompt-id]')
    .forEach((r) => r.classList.remove('opacity-50', 'ring', 'ring-blue-400'));
  draggedPromptId = null;
}

/**
 * Escape HTML to prevent XSS
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Highlight matching text in a string
 * @param {string} text - The text to highlight
 * @param {string} searchTerm - The search term to highlight
 * @returns {string} - HTML string with highlighted matches
 */
function highlightText(text, searchTerm) {
  if (!searchTerm.trim()) {
    return escapeHtml(text);
  }

  // Escape HTML first to prevent XSS
  const escapedText = escapeHtml(text);
  const escapedSearchTerm = escapeHtml(searchTerm);

  // Create case-insensitive regex with global flag
  const regex = new RegExp(
    `(${escapedSearchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`,
    'gi',
  );

  // Replace matches with highlighted version
  return escapedText.replace(regex, '<mark>$1</mark>');
}

/**
 * Render all prompts to the DOM
 */
function renderPrompts() {
  const tableContainer = document.querySelector('.overflow-hidden.rounded-lg');
  const tableElement = /** @type {HTMLElement|null} */ (
    tableContainer?.querySelector('.overflow-x-auto')
  );

  if (filteredPrompts.length === 0) {
    if (promptsContainer) promptsContainer.innerHTML = '';
    if (tableElement) tableElement.style.display = 'none';

    // Show appropriate empty state based on context
    if (prompts.length === 0) {
      // No prompts created at all
      if (noPromptsState) noPromptsState.classList.remove('hidden');
      if (noResultsState) noResultsState.classList.add('hidden');
    } else {
      // Prompts exist but search returned no results
      if (noResultsState) noResultsState.classList.remove('hidden');
      if (noPromptsState) noPromptsState.classList.add('hidden');
    }
  } else {
    // Hide both empty states when there are results
    if (noPromptsState) noPromptsState.classList.add('hidden');
    if (noResultsState) noResultsState.classList.add('hidden');
    if (tableElement) tableElement.style.display = 'block';
    if (promptsContainer) {
      promptsContainer.innerHTML = filteredPrompts
        .map(createPromptCard)
        .join('');
    }

    // Add event listeners to edit and delete buttons
    addPromptCardEventListeners();
  }
}

/**
 * Add event listeners to prompt card buttons
 */
function addPromptCardEventListeners() {
  // Edit buttons
  document.querySelectorAll('.edit-prompt-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const promptId = btn.getAttribute('data-prompt-id');
      if (promptId) openEditModal(promptId);
    });
  });

  // Delete buttons
  document.querySelectorAll('.delete-prompt-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const promptId = btn.getAttribute('data-prompt-id');
      if (promptId) openDeleteModal(promptId);
    });
  });

  // Drag & Drop rows
  document.querySelectorAll('tr[data-prompt-id]').forEach((row) => {
    row.addEventListener('dragstart', handleDragStart);
    row.addEventListener('dragover', handleDragOver);
    row.addEventListener('dragleave', handleDragLeave);
    row.addEventListener('drop', handleDrop);
    row.addEventListener('dragend', handleDragEnd);
  });
}

/**
 * Open the add/edit modal
 * @param {string|null} promptId
 */
function openEditModal(promptId = null) {
  editingPromptId = promptId;

  if (promptId) {
    // Edit mode
    const prompt = prompts.find((p) => p.id === promptId);
    if (!prompt) return;

    if (modalTitle) modalTitle.textContent = 'Edit Prompt';
    if (promptNameInput) promptNameInput.value = prompt.name;
    if (promptContentInput) promptContentInput.value = prompt.content;
    if (savePromptBtn) savePromptBtn.textContent = 'Update Prompt';
    if (promptRequireSearchInput)
      promptRequireSearchInput.checked = Boolean(prompt.requireSearch);
  } else {
    // Add mode
    if (modalTitle) modalTitle.textContent = 'Add New Prompt';
    if (promptNameInput) promptNameInput.value = '';
    if (promptContentInput) promptContentInput.value = '';
    if (savePromptBtn) savePromptBtn.textContent = 'Save Prompt';
    if (promptRequireSearchInput) promptRequireSearchInput.checked = false;
  }

  if (promptModal) promptModal.classList.remove('hidden');
  if (promptNameInput) promptNameInput.focus();
}

/**
 * Close the add/edit modal
 */
function closeEditModal() {
  if (promptModal) promptModal.classList.add('hidden');
  editingPromptId = null;
  if (promptNameInput) promptNameInput.value = '';
  if (promptContentInput) promptContentInput.value = '';
}

/**
 * Open the delete confirmation modal
 * @param {string} promptId
 */
function openDeleteModal(promptId) {
  const prompt = prompts.find((p) => p.id === promptId);
  if (!prompt) return;

  deletingPromptId = promptId;
  if (deletePromptName) deletePromptName.textContent = prompt.name;
  if (deleteModal) deleteModal.classList.remove('hidden');
}

/**
 * Close the delete confirmation modal
 */
function closeDeleteModal() {
  if (deleteModal) deleteModal.classList.add('hidden');
  deletingPromptId = null;
}

/**
 * Show a temporary status message
 * @param {string} message
 * @param {boolean} isError
 */
function showStatus(message, isError = false) {
  // Create a modern toast notification
  const toast = document.createElement('div');
  toast.className = `fixed top-4 right-4 z-50 max-w-sm rounded-lg shadow-lg p-4 transform transition-all duration-300 ${
    isError
      ? 'bg-red-50 border border-red-200 text-red-800'
      : 'bg-green-50 border border-green-200 text-green-800'
  }`;

  toast.innerHTML = `
    <div class="flex items-center">
      <div class="flex-shrink-0">
        <svg class="h-5 w-5 ${
          isError ? 'text-red-400' : 'text-green-400'
        }" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${
            isError
              ? 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z'
              : 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'
          }" />
        </svg>
      </div>
      <div class="ml-3 flex-1">
        <p class="text-sm font-medium">${message}</p>
      </div>
      <div class="ml-4 flex-shrink-0 flex">
        <button class="inline-flex text-gray-400 hover:text-gray-600 focus:outline-none" onclick="this.closest('div[class*=fixed]').remove()">
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  `;

  // Add slide-in animation
  toast.style.transform = 'translateX(100%)';
  document.body.appendChild(toast);

  // Trigger animation
  setTimeout(() => {
    toast.style.transform = 'translateX(0)';
  }, 10);

  // Auto-remove after 4 seconds
  setTimeout(() => {
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => {
      if (toast.parentNode) {
        toast.remove();
      }
    }, 300);
  }, 4000);
}

/**
 * Validate prompt input
 * @param {string} name
 * @param {string} content
 * @returns {string|null} Error message or null if valid
 */
function validatePrompt(name, content) {
  if (!name.trim()) {
    return 'Prompt name is required';
  }
  if (name.trim().length > 50) {
    return 'Prompt name must be 50 characters or less';
  }
  if (!content.trim()) {
    return 'Prompt content is required';
  }
  if (content.trim().length > 2000) {
    return 'Prompt content must be 2000 characters or less';
  }

  // Check for duplicate names (excluding current prompt when editing)
  const existingPrompt = prompts.find(
    (p) =>
      p.name.toLowerCase() === name.trim().toLowerCase() &&
      p.id !== editingPromptId,
  );
  if (existingPrompt) {
    return 'A prompt with this name already exists';
  }

  return null;
}

// Event Listeners
document.addEventListener('DOMContentLoaded', async () => {
  // Load prompts
  prompts = await getPrompts();
  filteredPrompts = [...prompts];
  renderPrompts();

  // Check for ?edit=<id> search param to auto-open editor
  const params = new URLSearchParams(location.search);
  const editId = params.get('edit');
  if (editId) {
    // Delay open until next tick to ensure DOM built
    setTimeout(() => openEditModal(editId), 0);
  }

  // Search input
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const target = e.target;
      if (target && 'value' in target) {
        filterPrompts(/** @type {string} */ (target.value));
      }
    });
  }

  // Add prompt buttons
  if (addPromptBtn)
    addPromptBtn.addEventListener('click', () => openEditModal());
  if (emptyStateAddBtn)
    emptyStateAddBtn.addEventListener('click', () => openEditModal());

  // Clear search button
  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
      if (searchInput) {
        searchInput.value = '';
        filterPrompts('');
      }
    });
  }

  // Export prompts button
  if (exportPromptsBtn) {
    exportPromptsBtn.addEventListener('click', () => {
      if (prompts.length === 0) {
        showStatus('No prompts to export.', true);
        return;
      }
      const now = new Date();
      const pad = (n) => n.toString().padStart(2, '0');
      const filename = `beartalk-prompts-${now.getFullYear()}${pad(
        now.getMonth() + 1,
      )}${pad(now.getDate())}-${pad(now.getHours())}${pad(
        now.getMinutes(),
      )}.json`;
      const jsonStr = JSON.stringify(prompts, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      showStatus('Prompts exported successfully!');
    });
  }

  // Import prompts button
  if (importPromptsBtn && importFileInput) {
    importPromptsBtn.addEventListener('click', () => {
      importFileInput.value = '';
      importFileInput.click();
    });

    importFileInput.addEventListener('change', async () => {
      const file = importFileInput.files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const imported = JSON.parse(text);
        if (!Array.isArray(imported)) {
          throw new Error('Invalid file format');
        }

        const validImports = imported.filter(
          (p) =>
            p && typeof p.name === 'string' && typeof p.content === 'string',
        );

        if (validImports.length === 0) {
          showStatus('No valid prompts found in file.', true);
          return;
        }

        const existingNames = new Set(prompts.map((p) => p.name.toLowerCase()));
        const newPrompts = validImports
          .filter((p) => !existingNames.has(p.name.toLowerCase()))
          .map((p) => ({
            id: p.id || generateId(),
            name: p.name.trim(),
            content: p.content.trim(),
            requireSearch: Boolean(p.requireSearch),
            createdAt: p.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }));

        if (newPrompts.length === 0) {
          showStatus('All prompts in file already exist.', true);
          return;
        }

        prompts = [...prompts, ...newPrompts];
        await savePrompts(prompts);
        filterPrompts(searchInput?.value || '');
        showStatus(`${newPrompts.length} prompts imported successfully!`);
      } catch (error) {
        console.error('Error importing prompts', error);
        showStatus(
          'Error importing prompts. Please ensure the file is a valid JSON export.',
          true,
        );
      }
    });
  }

  // Modal close buttons
  if (cancelBtn) cancelBtn.addEventListener('click', closeEditModal);
  if (promptModal) {
    promptModal.addEventListener('click', (e) => {
      if (e.target === promptModal) {
        closeEditModal();
      }
    });
  }

  // Delete modal close buttons
  if (cancelDeleteBtn)
    cancelDeleteBtn.addEventListener('click', closeDeleteModal);
  if (deleteModal) {
    deleteModal.addEventListener('click', (e) => {
      if (e.target === deleteModal) {
        closeDeleteModal();
      }
    });
  }

  // Save prompt button
  if (savePromptBtn) {
    savePromptBtn.addEventListener('click', async () => {
      const name = promptNameInput?.value || '';
      const content = promptContentInput?.value || '';

      const validationError = validatePrompt(name, content);
      if (validationError) {
        showStatus(validationError, true);
        return;
      }

      try {
        if (editingPromptId) {
          await updatePrompt(editingPromptId, name, content);
          showStatus('Prompt updated successfully!');
        } else {
          await createPrompt(name, content);
          showStatus('Prompt saved successfully!');
        }

        prompts = await getPrompts();
        filterPrompts(searchInput?.value || '');
        closeEditModal();
      } catch (error) {
        console.error('Error saving prompt:', error);
        showStatus('Error saving prompt. Please try again.', true);
      }
    });
  }

  // Confirm delete button
  if (confirmDeleteBtn) {
    confirmDeleteBtn.addEventListener('click', async () => {
      if (!deletingPromptId) return;

      try {
        await deletePrompt(deletingPromptId);
        prompts = await getPrompts();
        filterPrompts(searchInput?.value || '');
        closeDeleteModal();
        showStatus('Prompt deleted successfully!');
      } catch (error) {
        console.error('Error deleting prompt:', error);
        showStatus('Error deleting prompt. Please try again.', true);
      }
    });
  }

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Escape key closes modals
    if (e.key === 'Escape') {
      if (promptModal && !promptModal.classList.contains('hidden')) {
        closeEditModal();
      } else if (deleteModal && !deleteModal.classList.contains('hidden')) {
        closeDeleteModal();
      }
    }

    // Ctrl/Cmd + N to add new prompt
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
      e.preventDefault();
      openEditModal();
    }
  });
});
