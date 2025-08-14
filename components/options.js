// Status message container for immediate save feedback
let statusTimeoutId = null;

/**
 * Update the value of the Icon Style option input element.
 * @param {string} style
 * @param {boolean} checked
 */
function updateIconStyleOptionValue(style, checked) {
  const input = document.querySelector(
    `input[name="icon-style-option"][value="${style}"]`,
  );
  if (input) /** @type {HTMLInputElement} */ (input).checked = checked;
}

/**
 * Show a temporary status message
 * @param {string} text
 * @param {boolean} isError
 */
function showStatus(text, isError = false) {
  // Clear any existing status message
  if (statusTimeoutId) {
    clearTimeout(statusTimeoutId);
  }

  // Remove any existing status message
  const existingStatus = document.querySelector('.status-message');
  if (existingStatus) {
    existingStatus.remove();
  }

  // Create new status message
  const statusDiv = document.createElement('div');
  statusDiv.className = `status-message alert ${
    isError ? 'alert-error' : 'alert-success'
  } fixed top-4 right-4 z-50 max-w-sm shadow-lg`;
  statusDiv.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${
        isError
          ? 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z'
          : 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'
      }" />
    </svg>
    <span>${text}</span>
  `;

  document.body.appendChild(statusDiv);

  // Auto-remove after 2 seconds
  statusTimeoutId = setTimeout(() => {
    statusDiv.remove();
    statusTimeoutId = null;
  }, 2000);
}

/**
 * Updates the theme icon based on the current system theme
 * @param {string} style
 */
function updateThemeIcon(style) {
  const icon = /** @type {HTMLImageElement|null} */ (
    document.getElementById('theme-icon')
  );
  if (icon) {
    icon.src = `../icons/${style}/icon-128x128.png`;
  }
}

/**
 * Update data-* src attributes of the header icon based on selected style.
 * @param {string} style
 */
function setHeaderIconForStyle(style) {
  const icon = /** @type {HTMLImageElement|null} */ (
    document.getElementById('theme-icon')
  );
  if (!icon) return;
  const lightSrc = `../icons/${style}/icon-128x128.png`;
  const darkSrc = `../icons/${style}-dark/icon-128x128.png`;
  icon.dataset.lightSrc = lightSrc;
  icon.dataset.darkSrc = darkSrc;
}

/**
 * Update data-* href attributes of the favicon link based on selected style.
 * @param {string} style
 */
function setFaviconForStyle(style) {
  let favicon = /** @type {HTMLLinkElement|null} */ (
    document.getElementById('favicon')
  );
  if (!favicon) {
    favicon = /** @type {HTMLLinkElement} */ (document.createElement('link'));
    favicon.id = 'favicon';
    favicon.rel = 'icon';
    favicon.type = 'image/png';
    document.head.appendChild(favicon);
  }
  favicon.href = `../icons/${style}/icon-32x32.png`;
}

async function init() {}

init();
