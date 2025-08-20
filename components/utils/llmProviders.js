export const LLM_PROVIDER_CHATGPT = 'chatgpt';
export const LLM_PROVIDER_CHATGPT_SEARCH = 'chatgpt_search';
export const LLM_PROVIDER_GEMINI = 'gemini';
export const LLM_PROVIDER_PERPLEXITY = 'perplexity';
export const LLM_PROVIDER_CLAUDE = 'claude';
export const LLM_PROVIDER_DEFAULT = LLM_PROVIDER_CHATGPT;
export const SUPPORTED_LLM_PROVIDERS = [
  LLM_PROVIDER_CHATGPT,
  LLM_PROVIDER_CHATGPT_SEARCH,
  LLM_PROVIDER_GEMINI,
  LLM_PROVIDER_PERPLEXITY,
  LLM_PROVIDER_CLAUDE,
];

export const LLM_PROVIDER_META = {
  [LLM_PROVIDER_CHATGPT]: {
    name: 'ChatGPT',
    url: 'https://chatgpt.com',
    sendButtonSelector: 'button#composer-submit-button:not([disabled])',
  },
  [LLM_PROVIDER_CHATGPT_SEARCH]: {
    name: 'ChatGPT with Search',
    url: 'https://chatgpt.com?hints=search',
    sendButtonSelector: 'button#composer-submit-button:not([disabled])',
  },
  [LLM_PROVIDER_GEMINI]: {
    name: 'Gemini',
    url: 'https://gemini.google.com',
    sendButtonSelector: 'button.send-button:not([aria-disabled="true”])',
  },
  [LLM_PROVIDER_PERPLEXITY]: {
    name: 'Perplexity',
    url: 'https://www.perplexity.ai',
    sendButtonSelector: 'button[data-testid="submit-button"]:not([disabled])',
  },
  [LLM_PROVIDER_CLAUDE]: {
    name: 'Claude',
    url: 'https://claude.ai',
    sendButtonSelector: 'button[aria-label="Send message"]:not([disabled])',
  },
};

// Storage key for disabled providers
const DISABLED_LLM_PROVIDERS_KEY = 'disabledLLMProviders';

/**
 * @returns {Promise<string>} Resolves to the selected LLM provider.
 */
export function getLLMProvider() {
  return new Promise((resolve) => {
    if (!chrome || !chrome.storage || !chrome.storage.sync) {
      resolve(LLM_PROVIDER_CHATGPT);
      return;
    }
    chrome.storage.sync.get(['selectedLLM'], (result) => {
      const value = result.selectedLLM || LLM_PROVIDER_DEFAULT;
      resolve(value);
    });
  });
}

/**
 * @param {string} value - The LLM value to set ('chatgpt', 'gemini', 'perplexity', or 'claude').
 * @returns {Promise<void>} Resolves when the value is set.
 */
export function setLLMProvider(value) {
  return new Promise((resolve, reject) => {
    if (!SUPPORTED_LLM_PROVIDERS.includes(value)) {
      reject(
        new Error(
          `Invalid LLM value. Must be one of: ${SUPPORTED_LLM_PROVIDERS.join(
            ', ',
          )}.`,
        ),
      );
      return;
    }
    if (!chrome || !chrome.storage || !chrome.storage.sync) {
      reject(new Error('Chrome storage API not available.'));
      return;
    }
    chrome.storage.sync.set({ selectedLLM: value }, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Get the list of disabled LLM providers.
 * @returns {Promise<string[]>}
 */
export function getDisabledLLMProviders() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get([DISABLED_LLM_PROVIDERS_KEY], (result) => {
        const list = Array.isArray(result[DISABLED_LLM_PROVIDERS_KEY])
          ? result[DISABLED_LLM_PROVIDERS_KEY]
          : [];
        resolve(list);
      });
    } catch {
      resolve([]);
    }
  });
}

/**
 * Add a provider to the disabled list.
 * @param {string} provider
 * @returns {Promise<void>}
 */
export async function addDisabledLLMProvider(provider) {
  const list = await getDisabledLLMProviders();
  if (!list.includes(provider)) {
    const updated = [...list, provider];
    await /** @type {Promise<void>} */ (
      new Promise((resolve) =>
        chrome.storage.local.set(
          { [DISABLED_LLM_PROVIDERS_KEY]: updated },
          () => resolve(),
        ),
      )
    );
  }
}

/**
 * Remove a provider from the disabled list.
 * @param {string} provider
 * @returns {Promise<void>}
 */
export async function removeDisabledLLMProvider(provider) {
  const list = await getDisabledLLMProviders();
  if (list.includes(provider)) {
    const updated = list.filter((p) => p !== provider);
    await /** @type {Promise<void>} */ (
      new Promise((resolve) =>
        chrome.storage.local.set(
          { [DISABLED_LLM_PROVIDERS_KEY]: updated },
          () => resolve(),
        ),
      )
    );
  }
}

/**
 * Check if a provider is disabled.
 * @param {string} provider
 * @returns {Promise<boolean>}
 */
export async function isLLMProviderDisabled(provider) {
  const list = await getDisabledLLMProviders();
  return list.includes(provider);
}

/**
 * Get the LLM provider from the given URL.
 * @param {string} url
 * @returns {string|null}
 */
export function getLLMProviderFromURL(url) {
  for (const [provider, meta] of Object.entries(LLM_PROVIDER_META)) {
    if (url.startsWith(meta.url)) {
      return provider;
    }
  }
  return null;
}
