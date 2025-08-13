// @ts-check

import {
  LLM_PROVIDER_META,
  getLLMProvider,
  SUPPORTED_LLM_PROVIDERS,
  getDisabledLLMProviders,
} from './utils/llmProviders.js';

// Storage key for saved prompts (same as in options_prompts.js)
const PROMPTS_STORAGE_KEY = 'savedPrompts';

/**
 * Check if a URL matches any supported LLM provider
 * @param {string} url
 * @returns {boolean}
 */
function isLLMPage(url) {
  if (!url) return false;
  for (const meta of Object.values(LLM_PROVIDER_META)) {
    if (url.startsWith(meta.url)) {
      return true;
    }
  }
  return false;
}

/**
 * Get provider id from a URL if it is an LLM page.
 * @param {string} url
 * @returns {string|null}
 */
function getLLMProviderFromURL(url) {
  if (!url) return null;
  for (const [providerId, meta] of Object.entries(LLM_PROVIDER_META)) {
    if (url.startsWith(meta.url)) {
      return providerId;
    }
  }
  return null;
}

// Track the currently selected LLM provider
// Track the currently selected LLM provider
let selectedLLMProvider = null;
// Record info about the current active tab so that we can adapt the UI when the
// popup is opened on an LLM page.
/** @type {{ isLLM:boolean, providerId:string|null, tabId:number|null }} */
let activeTabInfo = { isLLM: false, providerId: null, tabId: null };

// Track the currently selected tabs
let selectedTabIds = [];

// Track all available tabs
let allTabs = [];

// Track selected local files
let selectedFiles = [];
// Maximum combined number of selected tabs and local files
const MAX_SELECTION_ITEMS = 10;
// Maximum size per local file in bytes (20 MB)
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

// Track all saved prompts
let slashTriggerPos = null;
let atTriggerPos = null;
let prevSelectedTabIdsSnapshot = null;
let allPrompts = [];
// Track selected prompt index when navigating from search input
let promptsSelectedIndex = 0;
// Track selected tab index when navigating from tabs search input
let tabsSelectedIndex = 0;

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
 * Show a popup menu
 * @param {string} menuId
 */
function showPopup(menuId) {
  // Hide all other popups
  const allPopups = document.querySelectorAll(
    '#ai-popup, #prompts-popup, #tabs-popup',
  );
  allPopups.forEach((menu) => {
    menu.classList.add('translate-y-full', 'opacity-0', 'invisible');
    menu.classList.remove('translate-y-0', 'opacity-100', 'visible');
  });

  // Remove active state from all toolbar buttons
  const allButtons = document.querySelectorAll(
    '#ai-btn, #prompts-btn, #tabs-btn',
  );
  allButtons.forEach((btn) => {
    btn.classList.remove('bg-primary/10', 'text-primary');
  });

  // Show the requested popup
  const popup = document.getElementById(menuId);
  const overlay = document.getElementById('overlay');

  if (popup && overlay) {
    popup.classList.remove('translate-y-full', 'opacity-0', 'invisible');
    popup.classList.add('translate-y-0', 'opacity-100', 'visible');
    overlay.classList.remove('hidden');

    // Add active state to corresponding button
    const buttonId = menuId.replace('-popup', '-btn');
    const button = document.getElementById(buttonId);
    if (button) {
      button.classList.add('bg-primary/10', 'text-primary');
    }

    // Auto-scroll to first selected item for tabs popup
    if (menuId === 'tabs-popup') {
      // Use setTimeout to ensure the popup animation has started
      setTimeout(() => {
        const tabsList = document.getElementById('tabs-list');
        if (tabsList && selectedTabIds.length > 0) {
          // Find the first selected tab element
          const firstSelectedTab = tabsList.querySelector(
            `[data-tab-id="${selectedTabIds[0]}"]`,
          );
          if (firstSelectedTab) {
            firstSelectedTab.scrollIntoView({
              behavior: 'smooth',
              block: 'center',
            });
          }
        }
      }, 100); // Small delay to allow popup to start showing
    }
  }
}

/**
 * Hide all popup menus
 */
function hidePopups() {
  const allPopups = document.querySelectorAll(
    '#ai-popup, #prompts-popup, #tabs-popup',
  );
  allPopups.forEach((menu) => {
    menu.classList.add('translate-y-full', 'opacity-0', 'invisible');
    menu.classList.remove('translate-y-0', 'opacity-100', 'visible');
  });

  const allButtons = document.querySelectorAll(
    '#ai-btn, #prompts-btn, #tabs-btn',
  );
  allButtons.forEach((btn) => {
    btn.classList.remove('bg-primary/10', 'text-primary');
  });

  const overlay = document.getElementById('overlay');
  if (overlay) {
    overlay.classList.add('hidden');
  }

  // Handle @ trigger removal if tabs selection changed
  if (atTriggerPos !== null) {
    const changed =
      JSON.stringify(prevSelectedTabIdsSnapshot) !==
      JSON.stringify(selectedTabIds);
    if (changed) {
      const textarea = /** @type {HTMLTextAreaElement|null} */ (
        document.getElementById('prompt-textarea')
      );
      if (textarea) {
        textarea.value =
          textarea.value.slice(0, atTriggerPos) +
          textarea.value.slice(atTriggerPos + 1);
        textarea.selectionStart = textarea.selectionEnd = atTriggerPos;
      }
    }
    atTriggerPos = null;
  }
}

/**
 * Focus the first tab item for keyboard navigation
 */
function focusFirstTabItem() {
  const tabsPopup = document.getElementById('tabs-popup');
  const firstItem = tabsPopup?.querySelector('[data-tab-id]');
  if (firstItem) {
    /** @type {HTMLElement} */ (firstItem).focus();
  }
}

/**
 * Focus the tabs search input so user can start typing to filter
 */
function focusTabsSearchInput() {
  const input = /** @type {HTMLInputElement|null} */ (
    document.getElementById('tabs-search')
  );
  if (input) {
    input.focus();
    input.select();
  }
}

/**
 * Apply visual highlight to the currently selected tab index
 */
function applyTabSelectionHighlight() {
  const tabsList = document.querySelectorAll('#tabs-list [data-tab-id]');
  tabsList.forEach((el, idx) => {
    el.classList.toggle('bg-base-200', idx === tabsSelectedIndex);
  });
  const selectedEl = /** @type {HTMLElement|null} */ (
    tabsList[tabsSelectedIndex]
  );
  if (selectedEl) {
    selectedEl.scrollIntoView({ block: 'nearest' });
  }
}

/**
 * Initialize tabs popup: clear search, render full, focus search, reset highlight
 */
function initTabsPopup() {
  tabsSelectedIndex = 0;
  const input = /** @type {HTMLInputElement|null} */ (
    document.getElementById('tabs-search')
  );
  if (input) input.value = '';
  renderTabs(allTabs);
  focusTabsSearchInput();
  applyTabSelectionHighlight();
}

/**
 * Focus the first prompt item and set up keyboard navigation (up/down/enter)
 */
function focusFirstPromptItem() {
  const promptsPopup = document.getElementById('prompts-popup');
  const firstItem = promptsPopup?.querySelector('[data-prompt-id]');
  if (firstItem) {
    /** @type {HTMLElement} */ (firstItem).focus();
  }
}

/**
 * Focus the prompts search input so user can start typing to filter
 */
function focusPromptsSearchInput() {
  const input = /** @type {HTMLInputElement|null} */ (
    document.getElementById('prompts-search')
  );
  if (input) {
    input.focus();
    input.select();
  }
}

/**
 * Apply visual highlight to the currently selected prompt index
 */
function applyPromptSelectionHighlight() {
  const promptsList = document.querySelectorAll(
    '#prompts-list [data-prompt-id]',
  );
  promptsList.forEach((el, idx) => {
    el.classList.toggle('bg-base-200', idx === promptsSelectedIndex);
  });
  const selectedEl = /** @type {HTMLElement|null} */ (
    promptsList[promptsSelectedIndex]
  );
  if (selectedEl) {
    selectedEl.scrollIntoView({ block: 'nearest' });
  }
}

/**
 * Initialize prompts popup: focus search and reset selection
 */
function initPromptsPopup() {
  promptsSelectedIndex = 0;
  const input = /** @type {HTMLInputElement|null} */ (
    document.getElementById('prompts-search')
  );
  if (input) {
    input.value = '';
  }
  // Re-render full list when opening
  renderPrompts(allPrompts);
  focusPromptsSearchInput();
  applyPromptSelectionHighlight();
}

/**
 * Handle keyboard navigation inside prompts list (up/down/enter)
 */
(function setupPromptKeyboardNavigation() {
  document.addEventListener('keydown', (e) => {
    // Handle Escape to hide open menus without closing the popup
    if (e.key === 'Escape') {
      const promptsPopupEl = document.getElementById('prompts-popup');
      const tabsPopupEl = document.getElementById('tabs-popup');
      const isPromptsOpen =
        promptsPopupEl && !promptsPopupEl.classList.contains('invisible');
      const isTabsOpen =
        tabsPopupEl && !tabsPopupEl.classList.contains('invisible');
      if (isPromptsOpen || isTabsOpen) {
        e.preventDefault();
        e.stopPropagation();
        hidePopups();
        const textarea = /** @type {HTMLTextAreaElement|null} */ (
          document.getElementById('prompt-textarea')
        );
        if (textarea && !activeTabInfo.isLLM) textarea.focus();
        return;
      }
    }

    // Tabs popup navigation
    const tabsPopup = document.getElementById('tabs-popup');
    if (tabsPopup && !tabsPopup.classList.contains('invisible')) {
      const tabItems = tabsPopup.querySelectorAll('[data-tab-id]');
      if (tabItems.length) {
        const activeEl = document.activeElement;
        if (tabsPopup.contains(activeEl)) {
          const tabsSearchInput = /** @type {HTMLElement|null} */ (
            document.getElementById('tabs-search')
          );
          const isInTabsSearch = activeEl === tabsSearchInput;

          if (e.key === 'ArrowDown') {
            e.preventDefault();
            let idx = Array.from(tabItems).indexOf(
              /** @type {Element} */ (activeEl),
            );
            idx = isInTabsSearch ? 0 : (idx + 1) % tabItems.length;
            tabsSelectedIndex = idx;
            /** @type {HTMLElement} */ (tabItems[idx]).focus();
            applyTabSelectionHighlight();
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            let idx = Array.from(tabItems).indexOf(
              /** @type {Element} */ (activeEl),
            );
            idx = isInTabsSearch
              ? tabItems.length - 1
              : (idx - 1 + tabItems.length) % tabItems.length;
            tabsSelectedIndex = idx;
            /** @type {HTMLElement} */ (tabItems[idx]).focus();
            applyTabSelectionHighlight();
          } else if (e.key === 'Enter') {
            e.preventDefault();
            // Toggle selection on focused item; if focus is in search, use current index
            if (
              activeEl &&
              /** @type {HTMLElement} */ (activeEl).hasAttribute?.(
                'data-tab-id',
              )
            ) {
              /** @type {HTMLElement} */ (activeEl).click();
            } else {
              const idx = Math.min(
                Math.max(tabsSelectedIndex, 0),
                tabItems.length - 1,
              );
              const el = /** @type {HTMLElement} */ (tabItems[idx]);
              if (el) el.click();
            }
          } else if (e.key === ' ') {
            e.preventDefault();
            // toggle selection via click
            if (activeEl) /** @type {HTMLElement} */ (activeEl).click();
          }
        }
      }
    }

    // Prompts popup navigation
    const promptsPopup = document.getElementById('prompts-popup');
    if (!promptsPopup || promptsPopup.classList.contains('invisible')) return;
    const promptsList = promptsPopup.querySelectorAll('[data-prompt-id]');
    if (promptsList.length === 0) return;

    const activeEl = document.activeElement;
    if (!promptsPopup.contains(activeEl)) return;

    const searchInput = /** @type {HTMLElement|null} */ (
      document.getElementById('prompts-search')
    );
    const isInSearchInput = activeEl === searchInput;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      let idx = Array.from(promptsList).indexOf(
        /** @type {Element} */ (activeEl),
      );
      idx = isInSearchInput ? 0 : (idx + 1) % promptsList.length;
      promptsSelectedIndex = idx;
      /** @type {HTMLElement} */ (promptsList[idx]).focus();
      applyPromptSelectionHighlight();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      let idx = Array.from(promptsList).indexOf(
        /** @type {Element} */ (activeEl),
      );
      idx = isInSearchInput
        ? promptsList.length - 1
        : (idx - 1 + promptsList.length) % promptsList.length;
      promptsSelectedIndex = idx;
      /** @type {HTMLElement} */ (promptsList[idx]).focus();
      applyPromptSelectionHighlight();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Insert selected prompt: if focus is on a prompt item, click it;
      // if focus is in search input, click currently selected index (default 0)
      if (
        activeEl &&
        /** @type {HTMLElement} */ (activeEl).hasAttribute?.('data-prompt-id')
      ) {
        /** @type {HTMLElement} */ (activeEl).click();
      } else {
        const idx = Math.min(
          Math.max(promptsSelectedIndex, 0),
          promptsList.length - 1,
        );
        const el = /** @type {HTMLElement} */ (promptsList[idx]);
        if (el) el.click();
      }
    }
  });
})();

/**
 * Escape HTML special characters
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Highlight query inside text with <mark>
 */
function highlightQuery(text, query) {
  if (!query) return escapeHtml(text);
  const regex = new RegExp(
    `(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`,
    'ig',
  );
  return escapeHtml(text).replace(regex, '<mark>$1</mark>');
}

/**
 * Update the selected tabs display
 */
function updateSelectedTabsDisplay() {
  const selectedTabsContainer = document.getElementById('selected-tabs');
  if (!selectedTabsContainer) return;

  if (selectedTabIds.length === 0) {
    // Hide the container if no tabs selected
    selectedTabsContainer.classList.add('hidden');
    return;
  }

  // Show the container
  selectedTabsContainer.classList.remove('hidden');

  // Get the actual tab objects for selected IDs
  const selectedTabs = allTabs.filter((tab) => selectedTabIds.includes(tab.id));

  if (selectedTabs.length === 1) {
    // Single tab: show favicon and title
    const tab = selectedTabs[0];
    const favicon = tab.favIconUrl || '';
    const title = tab.title || '(No title)';

    selectedTabsContainer.innerHTML = `
      <div class="flex items-center gap-2 max-w-full">
        ${
          favicon
            ? `<img src="${favicon}" class="w-4 h-4 rounded" alt="Tab favicon">`
            : ''
        }
        <span class="text-sm font-medium truncate">${title}</span>
      </div>
    `;
  } else {
    // Multiple tabs: show favicon stack horizontally
    const faviconStack = selectedTabs
      .map((tab) => {
        if (tab.favIconUrl) {
          return `<img src="${
            tab.favIconUrl
          }" class="w-6 h-6 p-1 rounded border border-base-content/20 bg-base-100 drop-shadow-sm" alt="${
            tab.title || 'Tab'
          }" title="${tab.title || '(No title)'}">`;
        }
        return '';
      })
      .filter(Boolean) // Remove empty strings
      .join('');

    selectedTabsContainer.innerHTML = `
      <div class="flex items-center gap-1">
        <div class="flex -space-x-1">
          ${faviconStack}
        </div>
        <span class="text-sm font-medium ml-2">${selectedTabs.length} tabs selected</span>
      </div>
    `;
  }
}

/**
 * Update the AI button icon to show the selected provider
 * @param {string} providerId - The ID of the selected provider
 */
function updateAIButtonIcon(providerId) {
  const aiButtonIcon = /** @type {HTMLImageElement|null} */ (
    document.getElementById('ai-btn-icon')
  );
  if (!aiButtonIcon) return;

  const isChatGPT = providerId === 'chatgpt';
  let providerUrl = LLM_PROVIDER_META[providerId].url || '';

  if (providerUrl) {
    // Use favicon service to get the provider icon
    aiButtonIcon.src = `https://www.google.com/s2/favicons?domain=${providerUrl}&sz=32`;
    aiButtonIcon.alt = `${providerId} icon`;
    aiButtonIcon.classList.toggle('dark:invert', isChatGPT);
  }
}

/**
 * Create AI providers menu
 */
async function createAIMenu() {
  const aiList = document.getElementById('ai-list');
  if (!aiList) return;

  // If we are already on an LLM page, lock the provider and hide the menu
  if (activeTabInfo.isLLM && activeTabInfo.providerId) {
    selectedLLMProvider = activeTabInfo.providerId;
    updateAIButtonIcon(activeTabInfo.providerId);
    aiList.innerHTML =
      '<div class="p-4 text-sm text-center text-base-content/60">Provider locked to current tab</div>';
    return;
  }

  // Load disabled providers
  const disabledProviders = new Set(await getDisabledLLMProviders());

  // Get the default LLM provider
  let defaultProvider = await getLLMProvider();
  if (disabledProviders.has(defaultProvider)) {
    // Fall back to first enabled provider
    const firstEnabled = SUPPORTED_LLM_PROVIDERS.find(
      (p) => !disabledProviders.has(p),
    );
    if (firstEnabled) defaultProvider = firstEnabled;
  }
  selectedLLMProvider = defaultProvider;

  // Update AI button icon to show the default provider
  updateAIButtonIcon(defaultProvider);

  // All providers are in supported providers list, no need to add additional providers
  const allProviders = SUPPORTED_LLM_PROVIDERS.map((provider) => ({
    id: provider,
    name: LLM_PROVIDER_META[provider].name,
    url: LLM_PROVIDER_META[provider].url,
  }));

  // If any providers are disabled, show a small notice
  if (Array.from(disabledProviders).length > 0) {
    const notice = document.createElement('div');
    notice.className = 'px-3 py-2 text-xs text-warning';
    notice.textContent =
      'Some providers are disabled due to browser restrictions.';
    aiList.appendChild(notice);
  }

  allProviders.forEach((provider) => {
    const isChatGPT = provider.id === 'chatgpt';
    const menuItem = document.createElement('div');
    const isSelected = provider.id === defaultProvider;
    const isDisabled = disabledProviders.has(provider.id);
    menuItem.className = `flex items-center gap-3 p-3 rounded-lg ${
      isDisabled
        ? 'opacity-40 cursor-not-allowed'
        : 'cursor-pointer transition-colors duration-200 ' +
          (isSelected
            ? 'bg-primary/10 hover:bg-primary/20'
            : 'hover:bg-base-200')
    }`;
    menuItem.dataset.provider = provider.id;

    const icon = document.createElement('img');
    icon.src = `https://www.google.com/s2/favicons?domain=${provider.url}&sz=32`;
    icon.alt = provider.name;
    icon.className = 'w-6 h-6 rounded' + (isChatGPT ? ' dark:invert' : '');
    icon.onerror = function () {
      this.style.display = 'none';
    };

    const content = document.createElement('div');
    content.className = 'flex-1 min-w-0';
    content.innerHTML = `<div class="font-medium leading-tight">${provider.name}</div>`;

    menuItem.appendChild(icon);
    menuItem.appendChild(content);

    if (!isDisabled) {
      // Add click handler
      menuItem.addEventListener('click', () => {
        // Remove selection from all items and update hover classes
        aiList.querySelectorAll('[data-provider]').forEach((item) => {
          item.classList.remove('bg-primary/10', 'hover:bg-primary/20');
          item.classList.add('hover:bg-base-200');
        });

        // Add selection to clicked item and update hover class
        menuItem.classList.remove('hover:bg-base-200');
        menuItem.classList.add('bg-primary/10', 'hover:bg-primary/20');

        // Update selected provider
        selectedLLMProvider = provider.id;

        // Update AI button icon to show the selected provider
        updateAIButtonIcon(provider.id);

        // Hide popup
        hidePopups();
      });
    }

    aiList.appendChild(menuItem);
  });
}

/**
 * Create prompts menu
 */
async function createPromptsMenu() {
  allPrompts = await getPrompts();
  renderPrompts(allPrompts);

  // Add search functionality
  const searchInput = document.getElementById('prompts-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const target = /** @type {HTMLInputElement} */ (e.target);
      const searchTerm = target.value.toLowerCase();
      const filteredPrompts = allPrompts.filter(
        (prompt) =>
          prompt.name.toLowerCase().includes(searchTerm) ||
          prompt.content.toLowerCase().includes(searchTerm),
      );
      promptsSelectedIndex = 0;
      renderPrompts(filteredPrompts);
      applyPromptSelectionHighlight();
    });
  }
}

/**
 * Render prompts list
 * @param {Array} prompts
 */
function renderPrompts(prompts) {
  const promptsList = document.getElementById('prompts-list');
  if (!promptsList) return;

  promptsList.innerHTML = '';

  if (prompts.length === 0) {
    promptsList.innerHTML =
      '<div class="text-center text-gray-500 p-4">No prompts found</div>';
    return;
  }

  prompts.forEach((prompt) => {
    const menuItem = document.createElement('div');
    menuItem.className =
      'flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors duration-200 hover:bg-base-200';
    menuItem.tabIndex = 0; // make focusable for keyboard navigation
    menuItem.dataset.promptId = prompt.id;

    const content = document.createElement('div');
    content.className = 'flex-1 min-w-0';
    const searchInput = /** @type {HTMLInputElement|null} */ (
      document.getElementById('prompts-search')
    );
    const query = searchInput ? searchInput.value.trim() : '';
    const snippet = prompt.content.substring(0, 100);
    content.innerHTML = `
        <div class="font-medium leading-tight">${highlightQuery(
          prompt.name,
          query,
        )}</div>
        <div class="text-xs text-base-content/60 leading-tight mt-0.5">${highlightQuery(
          snippet,
          query,
        )}${prompt.content.length > 100 ? '...' : ''}</div>
      `;

    menuItem.appendChild(content);

    // Add click handler
    menuItem.addEventListener('click', () => {
      // Fill textarea with prompt content
      const textarea = /** @type {HTMLTextAreaElement} */ (
        document.getElementById('prompt-textarea')
      );
      if (textarea) {
        if (slashTriggerPos !== null) {
          const before = textarea.value.slice(0, slashTriggerPos);
          const after = textarea.value.slice(slashTriggerPos + 1); // remove '/'
          textarea.value = before + prompt.content + after;
          // Move caret to end of inserted prompt
          textarea.selectionStart = textarea.selectionEnd =
            before.length + prompt.content.length;
          slashTriggerPos = null;
        } else {
          textarea.value += prompt.content;
        }
        textarea.focus();
      }

      // Hide popup
      hidePopups();
    });

    promptsList.appendChild(menuItem);
  });

  // Re-apply selection highlight after rendering
  if (prompts.length > 0) {
    if (promptsSelectedIndex >= prompts.length) {
      promptsSelectedIndex = 0;
    }
    applyPromptSelectionHighlight();
  }
}

/**
 * Create tabs menu
 */
async function createTabsMenu() {
  // Get all tabs
  chrome.tabs.query({ currentWindow: true }, (tabs) => {
    allTabs = tabs.filter((tab) => tab.url && tab.url.startsWith('http'));

    // Get highlighted tabs to determine default selection
    chrome.tabs.query(
      { currentWindow: true, highlighted: true },
      (highlightedTabs) => {
        const activeTab = allTabs.find((tab) => tab.active);

        // Determine which tabs should be pre-selected
        let tabsToPreSelect =
          highlightedTabs.length > 1
            ? highlightedTabs
            : activeTab
            ? [activeTab]
            : [];

        // Filter out LLM pages from pre-selected tabs
        tabsToPreSelect = tabsToPreSelect.filter(
          (tab) => tab.url && !isLLMPage(tab.url),
        );
        selectedTabIds = tabsToPreSelect.map((tab) => tab.id);

        renderTabs(allTabs);

        // Update the selected tabs display with initial selection
        updateSelectedTabsDisplay();
      },
    );
  });

  // Add search functionality
  const searchInput = document.getElementById('tabs-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const target = /** @type {HTMLInputElement} */ (e.target);
      const searchTerm = target.value.toLowerCase();
      const filteredTabs = allTabs.filter(
        (tab) =>
          (tab.title && tab.title.toLowerCase().includes(searchTerm)) ||
          (tab.url && tab.url.toLowerCase().includes(searchTerm)),
      );
      tabsSelectedIndex = 0;
      renderTabs(filteredTabs);
      applyTabSelectionHighlight();

      // Update the selected tabs display (not affected by search filter)
      updateSelectedTabsDisplay();
    });
  }
}

/**
 * Render tabs list
 * @param {Array} tabs
 */
function renderTabs(tabs) {
  const tabsList = document.getElementById('tabs-list');
  if (!tabsList) return;

  tabsList.innerHTML = '';

  if (tabs.length === 0) {
    tabsList.innerHTML =
      '<div class="text-center text-gray-500 p-4">No tabs found</div>';
    return;
  }

  tabs.forEach((tab) => {
    const menuItem = document.createElement('div');
    const isSelected = selectedTabIds.includes(tab.id);
    const isDisabled = activeTabInfo.isLLM && tab.id === activeTabInfo.tabId;
    menuItem.className = `flex items-center gap-3 mb-1 p-2 rounded-lg transition-colors duration-200 ${
      isDisabled
        ? 'opacity-40 cursor-not-allowed'
        : isSelected
        ? 'bg-blue-200 hover:bg-blue-300 text-black cursor-pointer'
        : 'hover:bg-base-200 cursor-pointer'
    }`;
    menuItem.dataset.tabId = tab.id;
    menuItem.tabIndex = 0;

    // If this is the current active LLM tab, do not allow selection.
    if (isDisabled) {
      tabsList.appendChild(menuItem);
      return;
    }

    const isSleeping = tab.discarded || tab.frozen;

    const icon = document.createElement('img');
    if (tab.favIconUrl) {
      icon.src = tab.favIconUrl;
      icon.className = 'w-4 h-4 rounded';
      icon.onerror = function () {
        this.style.display = 'none';
      };
    } else {
      icon.style.display = 'none';
    }

    const content = document.createElement('div');
    content.className = 'flex-1 min-w-0';
    const searchInput = /** @type {HTMLInputElement|null} */ (
      document.getElementById('tabs-search')
    );
    const query = searchInput ? searchInput.value.trim() : '';
    const titleHtml = highlightQuery(tab.title || '(No title)', query);
    const urlHtml = highlightQuery(tab.url || '', query);
    const textClass = isSelected ? 'text-black' : '';
    content.innerHTML = `
        <div class="font-medium leading-tight truncate ${textClass} ${
      isSleeping ? 'opacity-50' : ''
    }">${titleHtml}${isSleeping ? ' 💤' : ''}</div>
        <div class="text-xs text-base-content/60 leading-tight mt-0.5 truncate ${textClass}">${urlHtml}</div>
      `;

    menuItem.appendChild(icon);
    menuItem.appendChild(content);

    // Add click handler
    menuItem.addEventListener('click', () => {
      const tabId = parseInt(tab.id);

      if (selectedTabIds.includes(tabId)) {
        // Remove from selection and update hover class
        selectedTabIds = selectedTabIds.filter((id) => id !== tabId);
        menuItem.classList.remove(
          'bg-blue-200',
          'hover:bg-blue-300',
          'text-black',
        );
        menuItem.classList.add('hover:bg-base-200');
      } else {
        // Add to selection only if under combined limit
        if (
          selectedTabIds.length + selectedFiles.length >=
          MAX_SELECTION_ITEMS
        ) {
          alert(
            `You can select up to ${MAX_SELECTION_ITEMS} tabs and files combined.`,
          );
          return;
        }
        selectedTabIds.push(tabId);
        menuItem.classList.remove('hover:bg-base-200');
        menuItem.classList.add(
          'bg-blue-200',
          'hover:bg-blue-300',
          'text-black',
        );
      }

      // Update the selected tabs display
      updateSelectedTabsDisplay();
    });

    tabsList.appendChild(menuItem);
  });

  // Re-apply selection highlight after rendering for keyboard nav
  const tabsItems = tabsList.querySelectorAll('[data-tab-id]');
  if (tabsItems.length > 0) {
    if (tabsSelectedIndex >= tabsItems.length) tabsSelectedIndex = 0;
    applyTabSelectionHighlight();
  }
}

/**
 * Send prompt to LLM
 */
async function sendPromptToLLM() {
  const textarea = /** @type {HTMLTextAreaElement} */ (
    document.getElementById('prompt-textarea')
  );
  const promptText = textarea ? textarea.value.trim() : '';
  // Serialize selected local files to data URLs
  const serializedFiles = await Promise.all(
    selectedFiles.map(
      (file) =>
        new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            resolve({
              name: file.name,
              type: file.type,
              dataUrl: reader.result,
            });
          };
          reader.readAsDataURL(file);
        }),
    ),
  );

  if (
    !promptText &&
    selectedTabIds.length === 0 &&
    serializedFiles.length === 0
  ) {
    window.close();
    return;
  }

  // Ask the background service-worker to collect the context and process it
  chrome.runtime.sendMessage({
    type: 'collect-page-content',
    tabIds: selectedTabIds,
    llmProvider: selectedLLMProvider,
    promptContent: promptText,
    localFiles: serializedFiles,
  });

  // Close the popup
  window.close();
}

// Automatically set DaisyUI theme based on system preference
(function autoTheme() {
  const applyTheme = () => {
    const prefersDark = window.matchMedia(
      '(prefers-color-scheme: dark)',
    ).matches;
    document.documentElement.setAttribute(
      'data-theme',
      prefersDark ? 'dark' : 'light',
    );
  };
  applyTheme();
  // Update theme if the system preference changes
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', applyTheme);
})();

// ================================================================
// New init logic that adapts the popup when opened on LLM pages
// ================================================================
(function init() {
  // Determine if the current active tab is an LLM page first.
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length > 0) {
      const tab = tabs[0];
      activeTabInfo.tabId = tab.id || null;
      activeTabInfo.providerId = getLLMProviderFromURL(tab.url || '');
      activeTabInfo.isLLM = Boolean(activeTabInfo.providerId);
    }

    // If we are on an LLM page lock the provider to the detected one.
    if (activeTabInfo.isLLM && activeTabInfo.providerId) {
      selectedLLMProvider = activeTabInfo.providerId;
      updateAIButtonIcon(activeTabInfo.providerId);
    }

    // Build menus with the context we now have.
    createAIMenu();
    createPromptsMenu();
    createTabsMenu();

    // Cache DOM references
    const aiBtn = document.getElementById('ai-btn');
    const promptsBtn = document.getElementById('prompts-btn');
    const tabsBtn = document.getElementById('tabs-btn');
    const sendBtn = document.getElementById('send-btn');
    const downloadBtn = document.getElementById('download-btn');
    const filesBtn = document.getElementById('files-btn');
    const filesInput = /** @type {HTMLInputElement|null} */ (
      document.getElementById('files-input')
    );
    const filesCountSpan = document.getElementById('files-count');
    const loadingOverlay = document.getElementById('loading-overlay');
    const overlay = document.getElementById('overlay');
    const textarea = /** @type {HTMLTextAreaElement|null} */ (
      document.getElementById('prompt-textarea')
    );

    if (
      !aiBtn ||
      !promptsBtn ||
      !tabsBtn ||
      !sendBtn ||
      !filesBtn ||
      !downloadBtn ||
      !filesInput ||
      !overlay
    ) {
      console.error('Popup elements not found');
      return;
    }

    // === Apply restrictions when on an LLM page ===
    if (activeTabInfo.isLLM) {
      // Disable AI provider selection (button still shows icon)
      aiBtn.classList.add('pointer-events-none', 'opacity-50');

      // Disable saved prompts selector
      promptsBtn.classList.add('pointer-events-none', 'opacity-50');

      // Disable textarea
      if (textarea) {
        textarea.setAttribute('disabled', 'true');
        textarea.placeholder = 'Prompt disabled on LLM page';
        textarea.classList.add('opacity-50');
      }
    } else {
      // AI button click (only when selection allowed)
      aiBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isActive = aiBtn.classList.contains('bg-primary/10');
        if (isActive) {
          hidePopups();
        } else {
          showPopup('ai-popup');
        }
      });

      // Prompts button click
      promptsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isActive = promptsBtn.classList.contains('bg-primary/10');
        if (isActive) {
          hidePopups();
        } else {
          showPopup('prompts-popup');
          // When opened via button, focus the search field
          setTimeout(() => initPromptsPopup(), 50);
        }
      });
    }

    // Tabs button is always active
    tabsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isActive = tabsBtn.classList.contains('bg-primary/10');
      if (isActive) {
        hidePopups();
      } else {
        showPopup('tabs-popup');
        setTimeout(() => initTabsPopup(), 50);
      }
    });

    // Send
    sendBtn.addEventListener('click', () => sendPromptToLLM());

    // Download
    downloadBtn.addEventListener('click', () => {
      if (selectedTabIds.length === 0) return;
      if (loadingOverlay) {
        loadingOverlay.classList.remove('hidden');
      }
      // Listen once for download-started, then close popup
      const onDownloadStarted = (message) => {
        if (message && message.type === 'download-started') {
          chrome.runtime.onMessage.removeListener(onDownloadStarted);
          window.close();
        }
      };
      chrome.runtime.onMessage.addListener(onDownloadStarted);
      chrome.runtime.sendMessage({
        type: 'download-markdown',
        tabIds: selectedTabIds,
      });
      // Safety timeout: close after 3s even if no event (edge cases)
      setTimeout(() => {
        try {
          chrome.runtime.onMessage.removeListener(onDownloadStarted);
        } catch (e) {}
        window.close();
      }, 3000);
    });

    // Overlay close
    overlay.addEventListener('click', hidePopups);

    // Files
    filesBtn.addEventListener('click', () => filesInput.click());
    filesInput.addEventListener('change', () => {
      let files = Array.from(filesInput.files || []);

      const oversizedFiles = files.filter(
        (file) => file.size > MAX_FILE_SIZE_BYTES,
      );
      if (oversizedFiles.length) {
        alert(
          `The following files exceed the 20MB limit and were skipped: ${oversizedFiles
            .map((f) => f.name)
            .join(', ')}`,
        );
      }
      files = files.filter((file) => file.size <= MAX_FILE_SIZE_BYTES);

      const availableSlots = MAX_SELECTION_ITEMS - selectedTabIds.length;
      if (availableSlots <= 0) {
        alert(
          `You have already selected ${selectedTabIds.length} tabs. You can't add more files (max ${MAX_SELECTION_ITEMS} combined).`,
        );
        files = [];
      } else if (files.length > availableSlots) {
        alert(
          `You can only add ${availableSlots} more file${
            availableSlots === 1 ? '' : 's'
          } (max ${MAX_SELECTION_ITEMS} tabs and files combined).`,
        );
        files = files.slice(0, availableSlots);
      }
      selectedFiles = files;
      if (filesCountSpan) {
        filesCountSpan.textContent = selectedFiles.length
          ? String(selectedFiles.length)
          : '';
      }
    });

    // Hide popups when clicking outside
    document.addEventListener('click', (e) => {
      const target = /** @type {Element} */ (e.target);
      if (
        !target.closest('#ai-popup, #prompts-popup, #tabs-popup') &&
        !target.closest('#ai-btn, #prompts-btn, #tabs-btn')
      ) {
        hidePopups();
      }
    });

    // Enable textarea shortcuts only when textarea enabled
    if (textarea && !activeTabInfo.isLLM) {
      textarea.focus();

      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          if (e.shiftKey) {
            return;
          }
          e.preventDefault();
          sendPromptToLLM();
        } else if (e.key === '/') {
          slashTriggerPos = textarea.selectionStart;
          showPopup('prompts-popup');
          setTimeout(() => initPromptsPopup(), 50);
        } else if (e.key === '@') {
          atTriggerPos = textarea.selectionStart;
          prevSelectedTabIdsSnapshot = [...selectedTabIds];
          showPopup('tabs-popup');
          setTimeout(() => initTabsPopup(), 50);
        }
      });
    }
  });
})();

function _legacyInit() {
  // Initialize all menus
  createAIMenu();
  createPromptsMenu();
  createTabsMenu();

  // Get toolbar buttons
  const aiBtn = document.getElementById('ai-btn');
  const promptsBtn = document.getElementById('prompts-btn');
  const tabsBtn = document.getElementById('tabs-btn');
  const sendBtn = document.getElementById('send-btn');
  const filesBtn = document.getElementById('files-btn');
  const filesInput = /** @type {HTMLInputElement|null} */ (
    document.getElementById('files-input')
  );
  const filesCountSpan = document.getElementById('files-count');
  const overlay = document.getElementById('overlay');

  if (
    !aiBtn ||
    !promptsBtn ||
    !tabsBtn ||
    !sendBtn ||
    !filesBtn ||
    !filesInput ||
    !overlay
  ) {
    console.error('Popup elements not found');
    return;
  }

  // Add event listeners for toolbar buttons
  aiBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isActive = aiBtn.classList.contains('bg-primary/10');
    if (isActive) {
      hidePopups();
    } else {
      showPopup('ai-popup');
    }
  });

  promptsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isActive = promptsBtn.classList.contains('bg-primary/10');
    if (isActive) {
      hidePopups();
    } else {
      showPopup('prompts-popup');
    }
  });

  // Send button click
  sendBtn.addEventListener('click', () => {
    sendPromptToLLM();
  });

  tabsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isActive = tabsBtn.classList.contains('bg-primary/10');
    if (isActive) {
      hidePopups();
    } else {
      showPopup('tabs-popup');
    }
  });

  // Hide popups when clicking overlay
  overlay.addEventListener('click', hidePopups);

  // Files button opens file selector
  filesBtn.addEventListener('click', () => filesInput.click());

  // Handle file selection and update badge
  filesInput.addEventListener('change', () => {
    let files = Array.from(filesInput.files || []);

    // Filter out files that exceed the size limit
    const oversizedFiles = files.filter(
      (file) => file.size > MAX_FILE_SIZE_BYTES,
    );
    if (oversizedFiles.length) {
      alert(
        `The following files exceed the 20MB limit and were skipped: ${oversizedFiles
          .map((f) => f.name)
          .join(', ')}`,
      );
    }
    files = files.filter((file) => file.size <= MAX_FILE_SIZE_BYTES);

    const availableSlots = MAX_SELECTION_ITEMS - selectedTabIds.length;
    if (availableSlots <= 0) {
      alert(
        `You have already selected ${selectedTabIds.length} tabs. You can't add more files (max ${MAX_SELECTION_ITEMS} combined).`,
      );
      files = [];
    } else if (files.length > availableSlots) {
      alert(
        `You can only add ${availableSlots} more file${
          availableSlots === 1 ? '' : 's'
        } (max ${MAX_SELECTION_ITEMS} tabs and files combined).`,
      );
      files = files.slice(0, availableSlots);
    }
    selectedFiles = files;
    if (filesCountSpan) {
      filesCountSpan.textContent = selectedFiles.length
        ? String(selectedFiles.length)
        : '';
    }
  });

  // Hide popups when clicking outside
  document.addEventListener('click', (e) => {
    const target = /** @type {Element} */ (e.target);
    if (
      !target.closest('#ai-popup, #prompts-popup, #tabs-popup') &&
      !target.closest('#ai-btn, #prompts-btn, #tabs-btn')
    ) {
      hidePopups();
    }
  });

  // Auto-focus the textarea
  const textarea = /** @type {HTMLTextAreaElement|null} */ (
    document.getElementById('prompt-textarea')
  );
  if (textarea) {
    textarea.focus();

    // Add keyboard handler for Enter vs Shift+Enter
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (e.shiftKey) {
          // Shift+Enter: allow default behavior (insert newline)
          return;
        } else {
          // Enter only: send prompt to LLM
          e.preventDefault();
          sendPromptToLLM();
        }
      } else if (e.key === '/') {
        // Store the position where '/' was typed (before character inserted)
        slashTriggerPos = textarea.selectionStart;
        // Show prompts popup when typing '/'
        showPopup('prompts-popup');
        // Focus first prompt item after a short delay to ensure rendering
        setTimeout(() => {
          focusFirstPromptItem();
        }, 50);
      } else if (e.key === '@') {
        atTriggerPos = textarea.selectionStart;
        prevSelectedTabIdsSnapshot = [...selectedTabIds];
        // Show tabs popup
        showPopup('tabs-popup');
        setTimeout(() => {
          focusFirstTabItem();
        }, 50);
      }
    });
  }
}
