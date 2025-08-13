(function () {
  /**
   * Return true if current page is a Reddit post page.
   */
  function isReddit() {
    return /(?:www\.)?reddit\.com$/.test(location.hostname);
  }

  /**
   * Parse WebVTT text into plain text by removing indices, timestamps, and tags.
   * Also deduplicate globally while preserving order.
   * @param {string} vtt
   * @returns {string}
   */
  function parseVttToPlainText(vtt) {
    if (!vtt || typeof vtt !== 'string') return '';
    const text = vtt.replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/);

    /** @type {string[]} */
    const collected = [];
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i].trim();
      if (!line) continue;
      if (i === 0 && /^WEBVTT/i.test(line)) continue;
      if (/^NOTE(?:\s|$)/i.test(line)) continue;
      if (/^STYLE(?:\s|$)/i.test(line)) continue;
      if (/^\d+$/.test(line)) continue;
      if (/^(\d{1,2}:)?\d{2}:\d{2}\.\d{3}\s+-->/i.test(line)) continue;

      // Strip HTML-like tags and normalize whitespace
      const stripped = line
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!stripped) continue;
      collected.push(stripped);
    }

    // Global de-duplication while preserving first-seen order
    /** @type {Set<string>} */
    const seen = new Set();
    /** @type {string[]} */
    const deduped = [];
    for (const item of collected) {
      if (seen.has(item)) continue;
      seen.add(item);
      deduped.push(item);
    }

    return deduped.join('\n');
  }

  /**
   * Get the content of a Reddit post page, including video captions when available.
   * @returns {Promise<string|null>}
   */
  async function getRedditPageContent() {
    if (!isReddit()) return null;
    /**
     * Build Markdown from sanitized page HTML
     */
    // Clone the document so we can mutate it freely
    const clone = /** @type {Document} */ (document.cloneNode(true));

    // Remove things that are useless in Markdown
    clone
      .querySelectorAll(
        `script, style, noscript, iframe, svg, canvas, img, video, header, footer, nav, aside, [hidden], [aria-hidden="true"]`,
      )
      .forEach((el) => el.remove());

    const html = clone.body.innerHTML;

    /**
     * TurndownService is a constructor for creating a new Turndown service instance.
     * @class
     * @see {@link https://github.com/mixmark-io/turndown}
     * @see {@link https://unpkg.com/turndown@7.2.0/dist/turndown.js}
     * @ts-ignore
     */
    // @ts-ignore
    const turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
      emDelimiter: '*',
      strongDelimiter: '**',
      hr: '---',
      br: '\n',
      linkStyle: 'inlined',
      linkReferenceStyle: 'full',
    });

    // @ts-ignore
    turndownService.use(turndownPluginGfm.gfm);

    turndownService.addRule('dropEmpty', {
      filter: (node) =>
        node.nodeName === 'P' &&
        !node.textContent.trim() &&
        !node.querySelector('img'),
      replacement: () => '',
    });

    const markdown = turndownService.turndown(html);

    // Fetch Reddit video captions when available
    let redditCaptions = '';
    try {
      const player = /** @type {HTMLElement|null} */ (
        document.querySelector('shreddit-player-2')
      );
      const captionUrl = player?.getAttribute('caption-url');
      if (captionUrl) {
        const res = await fetch(captionUrl);
        if (res.ok) {
          const vtt = await res.text();
          redditCaptions = parseVttToPlainText(vtt).trim();
        }
      }
    } catch (_) {
      // ignore caption failures
    }

    const finalContent = redditCaptions
      ? `Video caption:\n${redditCaptions}\n\n${markdown}`
      : markdown;

    return finalContent;
  }

  // Register content getter function for the shared collector
  window['getContent'] = getRedditPageContent;
})();
