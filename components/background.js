import './common/actionButtonBehavior.js';
import './common/managerYouTube.js';
import { showLoadingBadge, clearLoadingBadge } from './common/actionButton.js';
import {
  LLM_PROVIDER_META,
  getSelectedLLMProviders,
  setSelectedLLMProviders,
  getDisabledLLMProviders,
  addDisabledLLMProvider,
} from './utils/llmProviders.js';
import {
  getReplyLanguage,
  REPLY_LANG_DEFAULT,
  REPLY_LANG_CUSTOM,
  REPLY_LANGUAGE_META,
} from './utils/replyLanguage.js';
import {
  collectPageContent,
  injectScriptToPasteFilesAsAttachments,
} from './common/pageContent.js';
import { waitForTabReady } from './utils/tab.js';

let collectedContents = [];

// Store the selected prompt content for injection
let selectedPromptContent = null;
// Store local files selected from popup (serialized as {name,type,dataUrl})
let selectedLocalFiles = [];

// Add a global variable to track the currently selected LLM provider so we can
// pass provider-specific meta data (e.g. the send-button selector) to content
// scripts later.
let selectedLLMProviderIds = [];

// Flag to indicate we are in the middle of collecting page contents / waiting for paste to complete
let isProcessing = false;

// Track the LLM provider tab that we inject the paste script into so that we
// can clear the loading badge if the tab is closed before the paste completes.
let llmTabIds = [];

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
 * Collect page content from the given tabs one by one.
 * @param {(number|undefined)[]} tabsToProcess
 * @returns {Promise<(import('./common/pageContent.js').CollectedTabInfo | null)[]>}
 */
async function collectPageContentOneByOne(tabsToProcess) {
  // Mark processing so subsequent action clicks are ignored until we finish and clear the badge
  isProcessing = true;
  // Show a loading badge while we process the tabs and until the content is pasted into the LLM page.
  await showLoadingBadge();

  const results = [];
  try {
    for (const tab of tabsToProcess) {
      const content = await collectPageContent(tab);
      results.push(content);
    }

    // In case of fail to collect content from page or timeout, make sure the badge is cleared.
    if (results.some((r) => r === null || r.content === '')) {
      await clearLoadingBadge();
      isProcessing = false;
    }

    return results;
  } catch (err) {
    // Clear the badge if something goes wrong so we don't leave it stuck.
    await clearLoadingBadge();
    isProcessing = false;
    throw err;
  }
}

/**
 * Download collected content as markdown files.
 * @param {(import('./common/pageContent.js').CollectedTabInfo | null)[]} contents
 */
async function downloadContentsAsMarkdown(contents) {
  try {
    const validContents = contents.filter((content) => content !== null);

    if (validContents.length === 0) {
      console.log('[background] no valid content to download');
      return;
    }

    let downloadStartedNotified = false;
    for (let i = 0; i < validContents.length; i++) {
      const content = validContents[i];

      // Generate a safe filename
      const safeTitle =
        content.title
          .replace(/[<>:"/\\|?*]/g, '-') // Replace invalid filename characters with '-'
          .substring(0, 100) // Limit length
          .trim() || 'page';

      const now = new Date();
      const pad = (n) => n.toString().padStart(2, '0');
      const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(
        now.getDate(),
      )}-${pad(now.getHours())}${pad(now.getMinutes())}`;
      const filename =
        validContents.length > 1
          ? `${safeTitle}_${i + 1}_${timestamp}.md`
          : `${safeTitle}_${timestamp}.md`;

      // Format the content as markdown
      const markdownContent = `# ${content.title}\n\n**URL:** ${
        content.url
      }\n\n**Extracted:** ${new Date().toISOString()}\n\n---\n\n${
        content.content
      }`;

      // Create data URL for download (service workers don't support URL.createObjectURL)
      const dataUrl =
        'data:text/markdown;charset=utf-8,' +
        encodeURIComponent(markdownContent);

      const downloadId = await chrome.downloads.download({
        url: dataUrl,
        filename: filename,
        saveAs: false,
      });
      if (!downloadStartedNotified && typeof downloadId === 'number') {
        downloadStartedNotified = true;
        try {
          chrome.runtime.sendMessage({ type: 'download-started', downloadId });
        } catch (e) {
          // ignore send errors
        }
      }
    }

    console.log(
      `[background] downloaded ${validContents.length} markdown file(s)`,
    );
  } catch (err) {
    console.error('[background] download error:', err);
  } finally {
    await clearLoadingBadge();
    isProcessing = false;
  }
}

/**
 * Disable a provider, notify the user, and optionally fall back to another provider.
 * @param {string} providerId
 */
async function disableProviderAndNotify(providerId) {
  try {
    await addDisabledLLMProvider(providerId);

    // Notification to the user
    const providerName = LLM_PROVIDER_META[providerId]?.name || providerId;
    try {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon-128x128.png'),
        title: 'Provider disabled',
        message: `${providerName} cannot be scripted in this browser. It has been disabled in Bear Talk.`,
        silent: false,
        requireInteraction: true,
      });
    } catch (e) {
      console.warn('Notification failed:', e);
    }

    // If the currently selected provider is the disabled one, switch to a fallback.
    const current = await getSelectedLLMProviders();
    if (current.includes(providerId)) {
      const disabled = new Set(await getDisabledLLMProviders());
      const newSelection = current.filter(p => p !== providerId);
      if (newSelection.length > 0) {
        await setSelectedLLMProviders(newSelection);
      } else {
        const candidates = Object.keys(LLM_PROVIDER_META).filter(
          (p) => !disabled.has(p),
        );
        if (candidates.length > 0) {
          await setSelectedLLMProviders([candidates[0]]);
        }
      }
    }
  } catch (err) {
    console.error('Failed to disable provider', providerId, err);
  }
}

/**
 * Handle the runtime message.
 * The collect-page-content message is sent from popup page after user selected tabs from the list.
 * @param {any} message
 * @param {chrome.runtime.MessageSender} sender
 * @param {Function} sendResponse
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  // Open prompt editor request from content script
  if (message.type === 'open-prompts-editor' && message.id) {
    const url = chrome.runtime.getURL(
      `components/options_prompts.html?edit=${message.id}`,
    );
    chrome.tabs.create({ url });
    return;
  }

  // keep the current tab id first, we might need to jump back to it
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length === 0) return;
    const tabId = tabs[0].id;
    if (!tabId) return;

    if (
      message.type === 'collect-page-content' &&
      Array.isArray(message.tabIds)
    ) {
      showLoadingBadge();

      collectPageContentOneByOne(message.tabIds).then(async (contents) => {
        collectedContents = contents;
        // Store the prompt content for later injection
        selectedPromptContent = message.promptContent || null;
        selectedLocalFiles = Array.isArray(message.localFiles)
          ? message.localFiles
          : [];
        // Append language instruction if user has specified a reply language
        try {
          const replyLang = await getReplyLanguage();
          if (
            replyLang &&
            replyLang !== REPLY_LANG_DEFAULT &&
            replyLang !== REPLY_LANG_CUSTOM
          ) {
            const langName = REPLY_LANGUAGE_META[replyLang]?.name || replyLang;
            const instruction = `Please reply in ${langName}.`;
            if (selectedPromptContent) {
              selectedPromptContent = `${selectedPromptContent}${
                selectedPromptContent.endsWith('.') ? '' : '.'
              }\n\n${instruction}`;
            } else {
              selectedPromptContent = instruction;
            }
          }
        } catch (langErr) {
          console.error(
            '[background] Unable to append language instruction',
            langErr,
          );
        }

        // Get current tab to check if it's an LLM page
        const currentTab = tabs[0];
        const selectedLLMProviders =
          message.llmProviders || (await getSelectedLLMProviders());
        selectedLLMProviderIds = selectedLLMProviders;

        // If only the current active tab is selected and it's not an LLM page,
        // capture a screenshot of the visible area and include it as an attachment
        try {
          if (
            Array.isArray(message.tabIds) &&
            message.tabIds.length === 1 &&
            message.tabIds[0] === tabId &&
            !isLLMPage(currentTab?.url || '')
          ) {
            const dataUrl = await chrome.tabs.captureVisibleTab(
              currentTab.windowId,
              { format: 'jpeg', quality: 80 },
            );
            if (dataUrl) {
              selectedLocalFiles.unshift({
                name: 'screenshot.jpg',
                type: 'image/jpeg',
                dataUrl,
              });
            }
          }
        } catch (screenshotErr) {
          console.error(
            '[background] screenshot capture failed:',
            screenshotErr,
          );
        }

        const providersToOpen = [...selectedLLMProviders];
        // Check if current tab can be reused
        if (currentTab.url && isLLMPage(currentTab.url)) {
            for (const providerId of selectedLLMProviders) {
                if (currentTab.url.startsWith(LLM_PROVIDER_META[providerId].url)) {
                    // Found a match, reuse this tab
                    const index = providersToOpen.indexOf(providerId);
                    if (index > -1) {
                        providersToOpen.splice(index, 1);
                    }
                    // Inject into the current tab
                    const ok = await injectScriptToPasteFilesAsAttachments(currentTab.id);
                    if (ok) {
                        llmTabIds.push(currentTab.id);
                        await waitForTabReady(currentTab.id);
                        chrome.tabs.sendMessage(currentTab.id, {
                            type: 'inject-data',
                            tabs: collectedContents,
                            promptContent: selectedPromptContent,
                            files: selectedLocalFiles,
                            sendButtonSelector: LLM_PROVIDER_META[providerId]?.sendButtonSelector || null,
                        });
                    } else {
                        await disableProviderAndNotify(providerId);
                    }
                    break;
                }
            }
        }

        for (const providerId of providersToOpen) {
            const meta = LLM_PROVIDER_META[providerId];
            if (!meta) {
                console.error('[background] llm provider not supported:', providerId);
                continue;
            }

            const newTab = await chrome.tabs.create({
                url: meta.url,
                active: true,
            });

            if (newTab.id) {
                const ok = await injectScriptToPasteFilesAsAttachments(newTab.id);
                if (ok) {
                    llmTabIds.push(newTab.id);
                    await waitForTabReady(newTab.id);
                    chrome.tabs.sendMessage(newTab.id, {
                        type: 'inject-data',
                        tabs: collectedContents,
                        promptContent: selectedPromptContent,
                        files: selectedLocalFiles,
                        sendButtonSelector: LLM_PROVIDER_META[providerId]?.sendButtonSelector || null,
                    });
                } else {
                    await disableProviderAndNotify(providerId);
                }
            }
        }
        if (llmTabIds.length === 0) {
            await clearLoadingBadge();
            isProcessing = false;
        }
      });
    } else if (message.type === 'markdown-paste-complete') {
      llmTabIds = llmTabIds.filter(id => id !== sender.tab?.id);
      if (llmTabIds.length === 0) {
        clearLoadingBadge();
        isProcessing = false;
        selectedLLMProviderIds = [];
      }
    } else if (
      message.type === 'download-markdown' &&
      Array.isArray(message.tabIds)
    ) {
      // Handle markdown download request from popup
      if (!isProcessing) {
        showLoadingBadge();
        collectPageContentOneByOne(message.tabIds).then((contents) => {
          downloadContentsAsMarkdown(contents);
        });
      }
    }
  });

  return true;
});

// If the LLM tab is closed before we receive the "markdown-paste-complete"
// message, make sure we clear the loading badge so it doesn't remain stuck.
chrome.tabs.onRemoved.addListener((removedTabId) => {
  if (llmTabIds.includes(removedTabId) && isProcessing) {
    llmTabIds = llmTabIds.filter(id => id !== removedTabId);
    if (llmTabIds.length === 0) {
      clearLoadingBadge();
      isProcessing = false;
    }
  }
});
