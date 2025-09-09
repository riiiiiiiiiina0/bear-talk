// This script injects selected tab contents as Markdown file attachments into ChatGPT.
// It now waits for ChatGPT's prompt editor to exist before attempting to paste.

(async () => {
  /**
   * Get the LLM provider from the given URL.
   * @param {string} url
   * @returns {string|null}
   */
  function getLLMProviderFromURL(url) {
    if (url.startsWith('https://www.perplexity.ai/discover/')) {
      return null;
    }
    if (url.startsWith('https://www.perplexity.ai')) {
      return 'perplexity';
    }
    return null;
  }

  /**
   * Auto trigger send message once all the context files are pasted and prompt content is not empty.
   */
  async function autoTriggerSend(selector) {
    if (!selector) return;

    const provider = getLLMProviderFromURL(window.location.href);

    if (provider === 'perplexity') {
      // Wait for file loading to complete
      await waitForElementToDisappear('[data-testid="file-loading-icon"]');
    }

    const sendButton = await waitForElement(selector, 10_000);
    if (sendButton) {
      sendButton.click();
    }
  }

  /**
   * Waits for a DOM element matching the selector to appear, or resolves null after timeout.
   * @param {string} selector
   * @param {number} timeoutMs
   * @returns {Promise<HTMLElement|null>}
   */
  function waitForElement(selector, timeoutMs = 10000) {
    return new Promise((resolve) => {
      const start = Date.now();
      function tryFind() {
        const el = /** @type {HTMLElement|null} */ (
          document.querySelector(selector)
        );
        if (el) {
          resolve(el);
        } else if (Date.now() - start >= timeoutMs) {
          resolve(null);
        } else {
          setTimeout(tryFind, 1000);
        }
      }
      setTimeout(tryFind, 1000);
    });
  }

  /**
   * Waits for a DOM element matching the selector to disappear.
   * @param {string} selector
   * @param {number} timeoutMs
   * @returns {Promise<void>}
   */
  function waitForElementToDisappear(selector, timeoutMs = 10000) {
    return new Promise((resolve) => {
      const start = Date.now();
      function tryCheck() {
        const el = document.querySelector(selector);
        if (!el) {
          resolve();
        } else if (Date.now() - start >= timeoutMs) {
          resolve(); // Resolve anyway after timeout
        } else {
          setTimeout(tryCheck, 500);
        }
      }
      tryCheck();
    });
  }

  /**
   * Inject prompt content into the editor using execCommand
   * @param {HTMLElement} editor - The contenteditable editor element
   * @param {string} promptText - The prompt text to inject
   * @returns {boolean} True if successful, false otherwise
   */
  function injectPromptContentViaExecCommand(editor, promptText) {
    try {
      if (document.execCommand) {
        // Clear existing content
        document.execCommand('selectAll', false);
        document.execCommand('delete', false);

        // Insert prompt text
        document.execCommand('insertText', false, promptText);

        console.log(
          '[parseFilesAsAttachments] Content injected via execCommand',
        );
        return true;
      } else {
        console.log('[parseFilesAsAttachments] execCommand not available');
      }
    } catch (error) {
      console.log('[parseFilesAsAttachments] execCommand failed', error);
    }
    return false;
  }

  /**
   * Inject prompt content into the editor using Selection API
   * @param {HTMLElement} editor - The contenteditable editor element
   * @param {string} promptText - The prompt text to inject
   * @returns {boolean} True if successful, false otherwise
   */
  function injectPromptContentViaSelectionAPI(editor, promptText) {
    // Method 2: Use Selection API with manual DOM manipulation + events
    try {
      // Clear content
      editor.innerHTML = '';

      // Create text node and insert
      const textNode = document.createTextNode(promptText);
      editor.appendChild(textNode);

      // Position cursor at the end
      const range = document.createRange();
      const selection = window.getSelection();
      range.setStartAfter(textNode);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);

      // Trigger events to notify the framework
      const inputEvent = new Event('input', { bubbles: true });
      const changeEvent = new Event('change', { bubbles: true });
      editor.dispatchEvent(inputEvent);
      editor.dispatchEvent(changeEvent);

      console.log(
        '[parseFilesAsAttachments] Content injected via Selection API + events',
      );
      return true;
    } catch (error) {
      console.log(
        '[parseFilesAsAttachments] Selection API failed, trying textContent:',
        error,
      );
    }
    return false;
  }

  /**
   * Inject prompt content into the editor using textContent
   * @param {HTMLElement} editor - The contenteditable editor element
   * @param {string} promptText - The prompt text to inject
   * @returns {boolean} True if successful, false otherwise
   */
  function injectPromptContentViaTextContent(editor, promptText) {
    // Method 3: Simple textContent approach
    editor.textContent = promptText;

    // Trigger events
    const inputEvent = new Event('input', { bubbles: true });
    editor.dispatchEvent(inputEvent);

    console.log('[parseFilesAsAttachments] Content injected via textContent');
    return true;
  }

  /**
   * Inject prompt content into the editor using framework events
   * @param {HTMLElement} editor - The contenteditable editor element
   * @param {string} promptText - The prompt text to inject
   * @returns {boolean} True if successful, false otherwise
   */
  function injectPromptContentViaFrameworkEvents(editor, promptText) {
    // Additional approach: Try to trigger React/Vue change detection
    try {
      // Trigger common framework events
      ['input', 'change', 'keyup', 'keydown'].forEach((eventType) => {
        const event = new Event(eventType, {
          bubbles: true,
          cancelable: true,
        });
        editor.dispatchEvent(event);
      });

      // Also try with InputEvent for modern frameworks
      const inputEvent = new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: promptText,
      });
      editor.dispatchEvent(inputEvent);

      console.log('[parseFilesAsAttachments] Framework events triggered');
      return true;
    } catch (eventError) {
      console.log(
        '[parseFilesAsAttachments] Event triggering failed:',
        eventError,
      );
    }
    return false;
  }

  /**
   * Inject prompt content into the editor using multiple fallback methods
   * @param {HTMLElement} editor - The contenteditable editor element
   * @param {string} promptText - The prompt text to inject
   */
  function injectPromptContent(editor, promptText) {
    console.log(
      '[parseFilesAsAttachments] Injecting prompt content:',
      promptText,
    );

    // Focus the editor first
    editor.focus();
    console.log('[parseFilesAsAttachments] Editor focused:', editor);

    const methods = [
      injectPromptContentViaExecCommand,
      injectPromptContentViaSelectionAPI,
      injectPromptContentViaTextContent,
      injectPromptContentViaFrameworkEvents,
    ];

    for (const method of methods) {
      if (method(editor, promptText)) {
        return;
      }
    }
  }

  chrome.runtime.onMessage.addListener(async (message) => {
    if (message.type === 'inject-data') {
        const { tabs, promptContent, files, sendButtonSelector } = message;

        if (tabs.length === 0 && files.length === 0) {
            console.warn('[pasteFilesAsAttachments] No data to paste.');
            return;
        }

        const editor = await waitForElement('[contenteditable="true"]');
        if (!editor) {
            console.warn('[pasteFilesAsAttachments] Timed out waiting for prompt editor.');
            return;
        }

        // Attach local files
        for (const f of files) {
            try {
                const blob = await (await fetch(f.dataUrl)).blob();
                const file = new File([blob], f.name, { type: f.type || blob.type });
                const dt = new DataTransfer();
                dt.items.add(file);
                const pasteEvt = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
                editor.dispatchEvent(pasteEvt);
            } catch (err) {
                console.error('[pasteFilesAsAttachments] Failed to attach local file', f, err);
            }
        }

        // Attach tab contents
        tabs.forEach((tab, idx) => {
            const { title, url, content } = tab;
            if (!content) return;

            const fileContent = `Please treat this as the content of a web page titled "${title || `Tab ${idx + 1}`}" (URL: ${url}). If a <selectedText> section is present, please pay special attention to it and consider it higher priority than the rest of the content.\n\n---\n\n${content || '<no content>'}`;
            const fileName = `${(title || `tab-${idx + 1}`).replace(/[^a-z0-9\-_]+/gi, '_')}.md`;
            const file = new File([fileContent], fileName, { type: 'text/markdown', lastModified: Date.now() });
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            const pasteEvent = new ClipboardEvent('paste', { clipboardData: dataTransfer, bubbles: true, cancelable: true });
            editor.dispatchEvent(pasteEvent);
        });

        if (files.length > 0 || tabs.length > 0) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        if (promptContent) {
            const normalizedPrompt = promptContent.replace(/[\r\n]+/g, ' ');
            injectPromptContent(editor, normalizedPrompt);
            if (sendButtonSelector) {
                await autoTriggerSend(sendButtonSelector);
            }
        }

        chrome.runtime.sendMessage({ type: 'markdown-paste-complete' });
    }
  });
})();
