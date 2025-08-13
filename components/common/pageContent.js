import { waitForTabReady } from '../utils/tab.js';
import { getCachedCaption } from './managerYouTube.js';

const sharedScripts = [
  'components/contentScripts/shared/pageContentCollector.js',
];

const generalScripts = [
  'libs/turndown.7.2.0.js',
  'libs/turndown-plugin-gfm.1.0.2.js',
  'components/contentScripts/general/getContent.js',
  ...sharedScripts,
];

const youtubeScripts = [
  'components/contentScripts/youtube/getContent.js',
  ...sharedScripts,
];

const redditScripts = [
  'libs/turndown.7.2.0.js',
  'libs/turndown-plugin-gfm.1.0.2.js',
  'components/contentScripts/reddit/getContent.js',
  ...sharedScripts,
];

const notionScripts = [
  'components/contentScripts/notion/getContent.js',
  ...sharedScripts,
];

/**
 * Collected tab info
 * @typedef {Object} CollectedTabInfo
 * @property {number} tabId
 * @property {string} title
 * @property {string} url
 * @property {string} content
 */

/**
 * Inject the given files into the given tab.
 * Resolves to true on success, false on failure.
 * @param {number} tabId
 * @param {string[]} files
 * @returns {Promise<boolean>}
 */
export function injectContentScripts(tabId, files) {
  return new Promise((resolve) => {
    const inject = () => {
      chrome.scripting.executeScript(
        {
          target: { tabId },
          files,
        },
        () => {
          if (chrome.runtime.lastError) {
            resolve(false);
          } else {
            resolve(true);
          }
        },
      );
    };

    waitForTabReady(tabId).then(inject);
  });
}

/**
 * Reload the tab if it is discarded/frozen and inject the extraction scripts.
 * @param {number} tabId
 * @returns {Promise<void>}
 */
export function injectScriptToGetPageContent(tabId) {
  /*
   * For YouTube video pages, some DOM features (e.g., transcript loading) only
   * initialize when the tab is active/visible. Activate the tab first, then
   * proceed with the normal injection chain.
   */
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        injectContentScripts(tabId, generalScripts).then(() => resolve());
        return;
      }

      const tabUrl = tab.url || '';
      let scripts = [];
      let activateTabFirst = false;

      if (/^https?:\/\/(?:www\.)?youtube\.com\/watch/.test(tabUrl)) {
        scripts = youtubeScripts;
        const videoId = new URL(tabUrl).searchParams.get('v');
        if (videoId && !getCachedCaption(videoId)) {
          activateTabFirst = true;
        }
      } else if (/^https?:\/\/(?:www\.)?reddit\.com\//.test(tabUrl)) {
        scripts = redditScripts;
      } else if (/^https?:\/\/(?:www\.)?notion\.so/.test(tabUrl)) {
        scripts = notionScripts;
      } else {
        scripts = generalScripts;
      }

      const doInject = () =>
        injectContentScripts(tabId, scripts).then(() => resolve());

      if (activateTabFirst) {
        chrome.tabs.update(tabId, { active: true }, () => doInject());
      } else {
        doInject();
      }
    });
  });
}

/**
 * Inject the pasteFilesAsAttachments script into the given tab.
 * Resolves to true on success, false on failure.
 * @param {number} tabId
 * @returns {Promise<boolean>}
 */
export function injectScriptToPasteFilesAsAttachments(tabId) {
  return injectContentScripts(tabId, [
    'components/contentScripts/llm/pasteFilesAsAttachments.js',
  ]);
}

/**
 * Collect the Markdown representation of the given tab's page.
 * Resolves to an object containing title, url, and content (or `null` on timeout).
 * @param {number|undefined} tabId
 * @param {number} [timeout=5000]
 * @returns {Promise<CollectedTabInfo|null>}
 */
export async function collectPageContent(tabId, timeout = 10_000) {
  return new Promise((resolve) => {
    if (typeof tabId !== 'number') {
      resolve(null);
      return;
    }

    /**
     * Handle the message coming back from the content script.
     * @param {any} message
     * @param {chrome.runtime.MessageSender} sender
     */
    const onMessage = (message, sender) => {
      if (sender?.tab?.id !== tabId) return;
      if (!message || typeof message.content !== 'string') return;

      clearTimeout(timeoutId);
      chrome.runtime.onMessage.removeListener(onMessage);

      const result = {
        tabId,
        title: message.title || '',
        url: message.url || '',
        content: message.content,
      };

      resolve(result);
    };

    chrome.runtime.onMessage.addListener(onMessage);

    // Fallback timeout – resolve with null if no response within 7 s
    const timeoutId = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(onMessage);
      resolve(null);
    }, timeout);

    // Start extraction chain
    injectScriptToGetPageContent(tabId);
  });
}
