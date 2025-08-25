(function () {
  /**
   * Get the content of a general page.
   * @returns {Promise<string|null>}
   */
  async function getGeneralPageContent() {
    const url = document.location.href.toLowerCase();

    // Handle image pages
    if (url.endsWith('.jpeg') || url.endsWith('.jpg') || url.endsWith('.png')) {
      if (
        document.body &&
        document.body.children.length === 1 &&
        document.body.children[0].tagName === 'IMG'
      ) {
        const img = /** @type {HTMLImageElement} */ (
          document.body.children[0]
        );
        return `IMAGE:${img.src}`;
      }
      return `IMAGE:${document.location.href}`;
    }

    // Handle PDF pages
    if (
      url.endsWith('.pdf') ||
      (document.body &&
        document.body.children.length === 1 &&
        document.body.children[0].tagName === 'EMBED' &&
        /** @type {HTMLEmbedElement} */ (document.body.children[0]).type ===
          'application/pdf')
    ) {
      return `PDF:${document.location.href}`;
    }

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
      headingStyle: 'atx', // # H1
      codeBlockStyle: 'fenced', // ```js
      bulletListMarker: '-', // - list item
      emDelimiter: '*', // *italic*
      strongDelimiter: '**', // **bold**
      hr: '---', // horizontal rule
      br: '\n', // line-break handling
      linkStyle: 'inlined', // [text](url) instead of ref links
      linkReferenceStyle: 'full',
    });

    // @ts-ignore
    turndownService.use(turndownPluginGfm.gfm);

    // Add a rule to drop empty paragraphs, tracking pixels, etc.
    turndownService.addRule('dropEmpty', {
      filter: (node) =>
        node.nodeName === 'P' &&
        !node.textContent.trim() &&
        !node.querySelector('img'),
      replacement: () => '',
    });

    const markdown = turndownService.turndown(html);

    console.log('markdown:\n', markdown);

    return markdown;
  }

  // Register content getter function for the shared collector
  window['getContent'] = getGeneralPageContent;
})();
