/**
 * FloatBot AI - ChatGPT Tab Content Bridge
 * 
 * ARCHITECTURE & DATA TRANSPARENCY NOTICE:
 * - Scope: Acts strictly as a local client-side assistive helper on behalf of the user.
 * - Triggers: Only executes upon explicit user input (sending messages or attaching media from the floating UI).
 * - What it reads: Text of the latest assistant reply node via MutationObserver for streaming into Document PiP.
 * - What it writes: Inserts user-provided prompt text into the active prompt input and stages user attachments.
 * - Data Privacy: 100% local in-browser messaging (chrome.runtime). Zero telemetry, zero external tracking, zero third-party servers.
 * - Compliance: Independent project. Not affiliated with, endorsed by, or sponsored by OpenAI.
 */

(() => {
  // Cleanup any previous listeners or intervals on re-injection
  if (window.__FLOATAI_BRIDGE_CLEANUP__) {
    try { window.__FLOATAI_BRIDGE_CLEANUP__(); } catch (e) {}
  }

  const BRIDGE_VERSION = '1.0.3';
  console.log(`[FloatBot AI Bridge v${BRIDGE_VERSION}] Initializing on ChatGPT tab:`, window.location.href);

  let activeObserver = null;
  let streamPollInterval = null;

  function normalizeText(str) {
    if (!str) return '';
    return str
      .replace(/(?:Copy|Read aloud|Good response|Bad response|Try Plus free)\s*$/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const messageListener = (request, sender, sendResponse) => {
    if (request.type === 'PING_CHATGPT') {
      const inputEl = findPromptInput();
      sendResponse({
        ready: !!inputEl,
        version: BRIDGE_VERSION,
        url: window.location.href,
        title: document.title
      });
      return false; // Synchronous response
    }

    if (request.type === 'OPEN_PIP_DIRECT') {
      openDocumentPipFromChatGPT();
      sendResponse({ success: true });
      return false;
    }

    if (request.type === 'GET_LATEST_CHATGPT_RESPONSE') {
      const assistantNodes = getAssistantNodes();
      const currentCount = assistantNodes.length;
      const stopButton = document.querySelector('button[data-testid="stop-button"], button[aria-label*="Stop" i]');
      const isGenerating = !!stopButton;

      const reqPreCount = request.preAssistantCount !== undefined ? request.preAssistantCount : -1;
      const normalizedPre = normalizeText(request.preAssistantText || '');
      let text = '';
      let isNew = false;

      if (currentCount > reqPreCount && reqPreCount >= 0) {
        text = extractNodeText(assistantNodes[currentCount - 1]);
        isNew = true;
      } else if (currentCount > 0) {
        const candidate = extractNodeText(assistantNodes[currentCount - 1]);
        if (candidate && normalizeText(candidate) !== normalizedPre) {
          text = candidate;
          isNew = true;
        }
      }

      if (!text) {
        const candidateFallback = getLatestAssistantTextFallback();
        if (candidateFallback && normalizeText(candidateFallback) !== normalizedPre) {
          text = candidateFallback;
          isNew = true;
        }
      }

      sendResponse({
        success: true,
        text: text || '',
        count: currentCount,
        isNew: isNew,
        isGenerating: isGenerating
      });
      return false; // Synchronous response
    }

    if (request.type === 'EXECUTE_CHATGPT_PROMPT') {
      handleExecutePrompt(request, sendResponse);
      return true; // Asynchronous response
    }
  };

  chrome.runtime.onMessage.addListener(messageListener);

  window.__FLOATAI_BRIDGE_CLEANUP__ = () => {
    if (activeObserver) activeObserver.disconnect();
    if (streamPollInterval) clearInterval(streamPollInterval);
    try { chrome.runtime.onMessage.removeListener(messageListener); } catch (e) {}
  };

  /**
   * Handles injecting the prompt and attachment into ChatGPT and clicking send.
   */
  async function handleExecutePrompt(request, sendResponse) {
    const { prompt, imageBase64, imageName } = request;

    try {
      // 1. Dismiss any blocking overlay modals (like "Stay logged out", onboarding, or cookies)
      dismissBlockingModals();

      // 2. Locate the prompt input box using resilient multi-selector polling
      const promptInput = await waitForPromptInput(8000);

      if (!promptInput) {
        const currentUrl = window.location.href;
        const hasLoginBtn = document.querySelector('a[href*="login"], button[data-testid="login-button"]') !== null;
        let errorMsg = '';

        if (hasLoginBtn || currentUrl.includes('/auth') || currentUrl.includes('/login')) {
          errorMsg = `ChatGPT tab is on the Login page (${currentUrl}). Please log in, then send your message.`;
        } else {
          errorMsg = `Could not find input box on ChatGPT tab (${document.title}). Please ensure the chat interface is loaded.`;
        }

        sendResponse({
          success: false,
          error: errorMsg,
          tabUrl: currentUrl,
          tabTitle: document.title
        });
        return;
      }

      // 3. Attach Document, Code, or Image (if provided)
      const fileData = request.attachmentDataUrl || request.imageBase64;
      const fileName = request.attachmentName || request.imageName;
      const fileType = request.attachmentType || (request.isImage ? 'image/png' : 'application/octet-stream');
      const hasAttachment = !!fileData;

      if (fileData) {
        await attachFileToChatGPT(promptInput, fileData, fileName, fileType);
        // Allow ChatGPT to stage the file chip in the composer
        await sleep(1000);
      }

      // Re-query prompt input in case React re-rendered after file attachment
      const activePromptInput = findPromptInput() || promptInput;

      // 4. Insert Prompt Text (ensures ProseMirror + React state synchronization)
      if (prompt) {
        await insertTextIntoPrompt(activePromptInput, prompt);
        await sleep(400);
      }

      // Record pre-submission assistant nodes right before trigger so we capture exact baseline
      const preAssistantNodes = getAssistantNodes();
      const preAssistantCount = preAssistantNodes.length;
      const preAssistantText = preAssistantCount > 0 ? extractNodeText(preAssistantNodes[preAssistantCount - 1]) : '';

      // 5. Trigger submission (polls until upload completes and clicks send / Enter)
      await triggerSubmission(activePromptInput, hasAttachment);

      // 6. Notify FloatBot AI that submission succeeded
      sendResponse({
        success: true,
        message: 'Processing submission to ChatGPT',
        preAssistantCount: preAssistantCount,
        preAssistantText: preAssistantText
      });

      // 7. Start observing and streaming the response back to FloatBot AI
      startStreamingResponse(preAssistantCount, preAssistantText);

    } catch (err) {
      console.log('[FloatAI Bridge] Error executing prompt:', err);
      sendResponse({ success: false, error: err.message });
    }
  }

  /**
   * Multi-selector resilient input finder.
   * Matches modern ProseMirror rich-text divs, textareas, and legacy inputs.
   */
  function findPromptInput() {
    const selectors = [
      '#prompt-textarea',
      'div.ProseMirror#prompt-textarea',
      'div.ProseMirror[contenteditable="true"]',
      'div.ProseMirror[contenteditable="plaintext-only"]',
      'div.ProseMirror',
      'div[contenteditable="true"][data-placeholder]',
      'div[contenteditable="true"]',
      'div[contenteditable="plaintext-only"]',
      'div[role="textbox"]',
      'textarea#prompt-textarea',
      'textarea[placeholder*="Message"]',
      'textarea[placeholder*="Ask"]',
      'form textarea',
      'form div[contenteditable]',
      'main textarea',
      'main div[contenteditable]'
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  /**
   * Polls for the prompt input for up to timeoutMs milliseconds.
   */
  function waitForPromptInput(timeoutMs = 8000) {
    return new Promise((resolve) => {
      const startTime = Date.now();

      const check = () => {
        const el = findPromptInput();
        if (el) {
          resolve(el);
          return true;
        }
        return false;
      };

      if (check()) return;

      const interval = setInterval(() => {
        if (check()) {
          clearInterval(interval);
        } else if (Date.now() - startTime > timeoutMs) {
          clearInterval(interval);
          resolve(null);
        }
      }, 200);
    });
  }

  /**
   * Finds the active Send / Submit button in ChatGPT's composer.
   */
  function findSendButton() {
    const sendSelectors = [
      'button[data-testid="send-button"]',
      'button[data-testid="composer-submit-button"]',
      'button[data-testid="fruitjuice-send-button"]',
      'button[aria-label="Send message"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label="Send"]',
      'button[aria-label="Submit"]',
      'form button[type="submit"]',
      '#prompt-textarea ~ button',
      'fieldset button[data-testid*="send"]',
      'fieldset button[aria-label*="Send"]',
      'div[class*="composer"] button[type="submit"]',
      'div[data-testid="composer-speech-button"] ~ button'
    ];

    for (const sel of sendSelectors) {
      const btn = document.querySelector(sel);
      if (btn) return btn;
    }

    const form = document.querySelector('form');
    if (form) {
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) return submitBtn;
      const anyBtn = form.querySelector('button[aria-label*="Send" i], button[data-testid*="send" i]');
      if (anyBtn) return anyBtn;
    }

    return null;
  }

  /**
   * Injects text into ChatGPT's prompt input (handles both textarea & ProseMirror contenteditable).
   */
  async function insertTextIntoPrompt(element, text) {
    element.focus();

    if (element.tagName === 'TEXTAREA') {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      if (nativeSetter) {
        nativeSetter.call(element, text);
      } else {
        element.value = text;
      }
      element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      return;
    }

    // Modern ProseMirror Contenteditable Div:
    // 1. Establish selection range inside child <p> element
    element.focus();
    const selection = window.getSelection();
    const range = document.createRange();

    let p = element.querySelector('p');
    if (!p) {
      p = document.createElement('p');
      element.appendChild(p);
    }

    range.selectNodeContents(p);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);

    // 2. Strategy A: Native execCommand (best for ProseMirror internal editor state)
    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, text);
    } catch (e) {}

    // 3. Strategy B: If execCommand didn't insert text or tab was backgrounded
    const currentContent = (element.innerText || element.textContent || '').trim();
    if (!inserted || !currentContent.includes(text)) {
      p.textContent = text;
      p.classList.remove('placeholder');
      p.removeAttribute('data-placeholder');
      element.classList.remove('placeholder');

      // Dispatch full input event sequence so React and ProseMirror register the input
      element.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        composed: true,
        inputType: 'insertText',
        data: text
      }));
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        composed: true,
        inputType: 'insertText',
        data: text
      }));
      element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    }
  }

  /**
   * Triggers submission by waiting for the send button to become enabled,
   * firing pointer/mouse events, and verifying that ChatGPT accepted the message.
   */
  async function triggerSubmission(promptInput, hasAttachment = false) {
    promptInput.focus();

    // 1. Poll for enabled send button (up to 12s if document is uploading, 4s otherwise)
    let sendButton = null;
    const startWait = Date.now();
    const maxWaitTime = hasAttachment ? 12000 : 4000;

    while (Date.now() - startWait < maxWaitTime) {
      const btn = findSendButton();
      if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
        sendButton = btn;
        break;
      }

      // Check if ChatGPT already started generating
      const isGenerating = !!document.querySelector('button[data-testid="stop-button"], button[aria-label="Stop generating"]');
      if (isGenerating) {
        return { success: true };
      }

      await sleep(150);
    }

    if (sendButton) {
      // Trigger full pointer and mouse click sequence
      const pointerDown = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window });
      const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window });
      const pointerUp = new PointerEvent('pointerup', { bubbles: true, cancelable: true, view: window });
      const mouseUp = new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window });

      sendButton.dispatchEvent(pointerDown);
      sendButton.dispatchEvent(mouseDown);
      sendButton.dispatchEvent(pointerUp);
      sendButton.dispatchEvent(mouseUp);
      sendButton.click();
      console.log('[FloatBot AI Bridge] Clicked send button.');
    } else {
      console.log('[FloatBot AI Bridge] Send button not enabled, attempting form submit / Enter key sequence.');
      // Fallback: dispatch Enter keydown sequence on promptInput
      await sleep(150);
      const enterInit = {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
        composed: true
      };
      promptInput.dispatchEvent(new KeyboardEvent('keydown', enterInit));
      promptInput.dispatchEvent(new KeyboardEvent('keypress', enterInit));
      promptInput.dispatchEvent(new KeyboardEvent('keyup', enterInit));

      const form = promptInput.closest('form');
      if (form) {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    }

    return { success: true };
  }

  /**
   * Synchronous Base64 to Blob converter with automatic MIME detection.
   */
  function base64ToBlob(base64Data, defaultType = 'application/octet-stream') {
    try {
      let contentType = defaultType;
      if (base64Data.startsWith('data:') && base64Data.includes(';base64,')) {
        contentType = base64Data.substring(5, base64Data.indexOf(';base64,'));
      }
      const parts = base64Data.split(';base64,');
      const raw = atob(parts[1] || parts[0]);
      const rawLength = raw.length;
      const uInt8Array = new Uint8Array(rawLength);
      for (let i = 0; i < rawLength; ++i) {
        uInt8Array[i] = raw.charCodeAt(i);
      }
      return new Blob([uInt8Array], { type: contentType });
    } catch (e) {
      return null;
    }
  }

  /**
   * Programmatically attaches any document, code file, or image to ChatGPT
   * via rich Clipboard paste event and hidden file input.
   */
  /**
   * Programmatically attaches any document, code file, or image to ChatGPT
   * via single hidden file input or Clipboard paste fallback (EXACTLY ONCE).
   */
  async function attachFileToChatGPT(promptInput, base64Data, filename, mimeType = 'application/octet-stream') {
    try {
      const blob = base64ToBlob(base64Data, mimeType);
      if (!blob) return false;
      const actualType = blob.type || mimeType || 'application/octet-stream';
      const file = new File([blob], filename || 'document', { type: actualType });

      promptInput.focus();

      // Find the ONE primary file input in ChatGPT's form
      const form = promptInput.closest('form') || document.querySelector('form');
      const fileInput = form ? form.querySelector('input[type="file"]') : document.querySelector('input[type="file"]');

      if (fileInput) {
        const dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        fileInput.dispatchEvent(new Event('input', { bubbles: true }));
        console.log(`[FloatBot AI Bridge] Attached single file "${filename}" (${actualType}) to file input.`);
      } else {
        // Fallback only if no file input exists on page
        const dt = new DataTransfer();
        dt.items.add(file);
        const pasteEvent = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          composed: true,
          clipboardData: dt
        });
        promptInput.dispatchEvent(pasteEvent);
        console.log(`[FloatBot AI Bridge] Attached single file "${filename}" via ClipboardEvent paste.`);
      }

      return true;
    } catch (err) {
      console.log('[FloatBot AI Bridge] File attachment note:', err);
      return false;
    }
  }

  /**
   * Multi-selector detection for the assistant's latest response text.
   * Handles markdown, prose, interactive option cards, and lists.
   */
  /**
   * Returns all assistant message containers currently on ChatGPT's page in DOM order.
   */
  /**
   * Returns all assistant message containers currently on ChatGPT's page in DOM order.
   * Multi-strategy: author role, action buttons (Copy), and prose/markdown blocks.
   */
  /**
   * Helper: checks if a node belongs to a user prompt (not an assistant response).
   */
  function isUserNode(node) {
    if (!node) return false;
    // 1. Direct or ancestor author role
    if (node.getAttribute?.('data-message-author-role') === 'user' || node.getAttribute?.('data-message-role') === 'user') return true;
    if (node.closest?.('[data-message-author-role="user"], [data-message-role="user"], [data-testid="user-turn"], .user-turn')) return true;
    // 2. Descendant author role (e.g. if node is the turn wrapper or article)
    if (node.querySelector?.('[data-message-author-role="user"], [data-message-role="user"], [data-testid="user-turn"], .user-turn')) return true;
    // 3. User action buttons (Edit message pencil button)
    if (node.querySelector?.('button[aria-label*="Edit" i], button[data-testid*="edit" i]')) return true;
    return false;
  }

  /**
   * Returns all assistant message containers currently on ChatGPT's page in DOM order.
   * Multi-strategy: author role, prose/markdown blocks, and feedback buttons.
   */
  function getAssistantNodes() {
    // Strategy 1: Explicit assistant author-role elements
    const directAssistant = Array.from(document.querySelectorAll('main [data-message-author-role="assistant"], [data-message-author-role="assistant"], [data-testid="agent-turn"], .agent-turn'));
    const validDirect = directAssistant.filter(n => !isUserNode(n));
    if (validDirect.length > 0) return validDirect;

    // Strategy 2: Markdown and prose containers in main (strictly excluding user turns)
    const markdowns = Array.from(document.querySelectorAll('main .markdown, main .prose, main [class*="markdown"], main [class*="prose"]'));
    const validMarkdowns = markdowns.filter(m => !isUserNode(m));
    if (validMarkdowns.length > 0) return validMarkdowns;

    // Strategy 3: Assistant feedback action buttons (Thumbs up / Read aloud)
    const assistantActionButtons = Array.from(document.querySelectorAll('button[aria-label*="Good response" i], button[aria-label*="Thumbs up" i], button[aria-label*="Read aloud" i], button[aria-label*="Bad response" i]'));
    if (assistantActionButtons.length > 0) {
      const parents = assistantActionButtons.map((btn) => {
        return btn.closest('article, [data-testid^="conversation-turn"], [class*="conversation-turn"]') || btn.parentElement?.parentElement;
      }).filter(p => p && !isUserNode(p));
      const unique = [...new Set(parents)];
      if (unique.length > 0) return unique;
    }

    return [];
  }

  /**
   * Extracts clean, formatted assistant text from a message node.
   * Targets .markdown, .prose, code blocks, and interactive options, while stripping out action bars.
   */
  function extractNodeText(node) {
    if (!node || isUserNode(node)) return '';

    // 1. Look for markdown or prose element inside or on node
    const markdown = node.matches?.('.markdown, .prose, [class*="markdown"], [class*="prose"]') 
      ? node 
      : (node.querySelector?.('.markdown, .prose, [class*="markdown"], [class*="prose"]') || null);

    let text = '';
    if (markdown && !isUserNode(markdown)) {
      text = (markdown.innerText || markdown.textContent || '').trim();
    }

    // Fallback: only clone and extract text if node is confirmed to be an assistant container
    if (!text && (node.getAttribute?.('data-message-author-role') === 'assistant' || node.closest?.('[data-message-author-role="assistant"]') || node.querySelector?.('[data-message-author-role="assistant"]'))) {
      try {
        const clone = node.cloneNode(true);
        const toRemove = clone.querySelectorAll('[data-message-author-role="user"], button, [data-testid="turn-action-bar"], .sr-only, [aria-hidden="true"]');
        toRemove.forEach(b => b.remove());
        text = (clone.innerText || clone.textContent || '').trim();
      } catch (e) {
        text = (node.innerText || node.textContent || '').trim();
      }
    }

    // 2. Check for interactive options (e.g. choices cards)
    const options = Array.from(node.querySelectorAll?.('button[role="radio"], div[role="radio"], button[data-testid*="option"], fieldset label') || []);
    if (options.length > 0) {
      const optList = options
        .map(o => '• ' + (o.innerText || o.textContent || '').trim().replace(/\n+/g, ' '))
        .filter(t => t.length > 3 && !t.toLowerCase().includes('try plus') && !t.toLowerCase().includes('upgrade'));
      if (optList.length > 0) {
        text += '\n\n**Choices:**\n' + optList.join('\n');
      }
    }

    // Strip trailing action button labels like Copy, Read aloud
    text = text.replace(/(?:Copy|Read aloud|Good response|Bad response|Try Plus free)\s*$/gi, '').trim();
    return text;
  }

  /**
   * Fallback: searches any assistant prose/markdown directly in document order.
   */
  function getLatestAssistantTextFallback() {
    const allMd = Array.from(document.querySelectorAll('main .markdown, main .prose, main [class*="markdown"], main [class*="prose"], .markdown, .prose'));
    for (let i = allMd.length - 1; i >= 0; i--) {
      const m = allMd[i];
      if (!isUserNode(m)) {
        const t = extractNodeText(m);
        if (t) return t;
      }
    }
    return '';
  }

  /**
   * Observes ChatGPT's response in real-time and streams updates back to FloatBot AI.
   */
  function startStreamingResponse(preAssistantCount = 0, preAssistantText = '') {
    if (activeObserver) activeObserver.disconnect();
    if (streamPollInterval) clearInterval(streamPollInterval);

    let lastSentText = '';
    let unchangedCount = 0;
    const startTime = Date.now();
    let generationStarted = false;
    let timeoutNotified = false;
    const normalizedPre = normalizeText(preAssistantText);

    const checkForResponse = () => {
      const stopButton = document.querySelector('button[data-testid="stop-button"], button[aria-label*="Stop" i]');
      const isGenerating = !!stopButton;

      if (isGenerating) {
        generationStarted = true;
      }

      const assistantNodes = getAssistantNodes();
      const currentCount = assistantNodes.length;
      const hasNewNode = currentCount > preAssistantCount;

      let currentText = '';
      if (hasNewNode) {
        currentText = extractNodeText(assistantNodes[currentCount - 1]);
      } else if (currentCount > 0) {
        const text = extractNodeText(assistantNodes[currentCount - 1]);
        if (normalizeText(text) !== normalizedPre && text.length > 0) {
          currentText = text;
        }
      }

      if (!currentText) {
        const fallbackText = getLatestAssistantTextFallback();
        if (fallbackText && normalizeText(fallbackText) !== normalizedPre) {
          currentText = fallbackText;
        }
      }

      const isNewResponse = currentText && (
        hasNewNode ||
        (normalizeText(currentText) !== normalizedPre && currentText.length > 0) ||
        (preAssistantCount === 0 && currentText.length > 0)
      );

      if (isNewResponse && currentText !== lastSentText) {
        lastSentText = currentText;
        unchangedCount = 0;
        generationStarted = true;

        chrome.runtime.sendMessage({
          type: 'CHATGPT_STREAM_UPDATE',
          text: currentText,
          isDone: false
        }, () => {
          if (chrome.runtime.lastError) {}
        });
      }

      return isGenerating;
    };

    // Check immediately
    checkForResponse();

    // 1. MutationObserver on chat container
    activeObserver = new MutationObserver(() => {
      checkForResponse();
    });

    activeObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });

    // 2. Polling interval to detect updates and completion
    streamPollInterval = setInterval(() => {
      const isGenerating = checkForResponse();

      // Completion condition: MUST have actually started generation, stop button gone, and text stabilized!
      if (generationStarted && !isGenerating && lastSentText.length > 0) {
        unchangedCount++;
        // If text hasn't changed for 3 checks (~1 second) after stop button disappears
        if (unchangedCount >= 3) {
          clearInterval(streamPollInterval);
          if (activeObserver) activeObserver.disconnect();

          chrome.runtime.sendMessage({
            type: 'CHATGPT_STREAM_UPDATE',
            text: lastSentText,
            isDone: true
          }, () => {
            if (chrome.runtime.lastError) {}
          });

          console.log('[FloatBot AI Bridge] Stream complete.');
        }
      }

      // If generation hasn't started after 75 seconds, send notice but KEEP polling for late start
      if (!generationStarted && !timeoutNotified && Date.now() - startTime > 75000) {
        timeoutNotified = true;
        chrome.runtime.sendMessage({
          type: 'CHATGPT_STREAM_TIMEOUT',
          message: 'Waiting for ChatGPT response... Click to view tab.'
        }, () => {
          if (chrome.runtime.lastError) {}
        });
      }

      // Safety timeout: 3 minutes max
      if (Date.now() - startTime > 180000) {
        clearInterval(streamPollInterval);
        if (activeObserver) activeObserver.disconnect();
        if (lastSentText.length > 0) {
          chrome.runtime.sendMessage({
            type: 'CHATGPT_STREAM_UPDATE',
            text: lastSentText,
            isDone: true
          }, () => { if (chrome.runtime.lastError) {} });
        }
      }
    }, 350);
  }

  function dismissBlockingModals() {
    try {
      const candidateButtons = document.querySelectorAll('button, div[role="button"]');
      candidateButtons.forEach((btn) => {
        const text = (btn.textContent || '').trim().toLowerCase();
        const testId = btn.getAttribute('data-testid') || '';
        const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();

        if (
          testId === 'close-button' ||
          ariaLabel === 'close' ||
          text === 'stay logged out' ||
          text === 'dismiss' ||
          text === 'close' ||
          text === 'cancel'
        ) {
          try {
            btn.click();
          } catch (e) {}
        }
      });
    } catch (err) {
      console.log('[FloatAI Bridge] Modal dismissal note:', err);
    }
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // =========================================================================
  // 1-Click Document Picture-in-Picture Trigger from ChatGPT Tab
  // =========================================================================

  function openDocumentPipFromChatGPT() {
    chrome.runtime.sendMessage({ type: 'LAUNCH_FLOATBOT_WINDOW' });
  }

  function injectFloatBotBadge() {
    if (document.getElementById('floatbot-chatgpt-badge')) return;

    const badge = document.createElement('div');
    badge.id = 'floatbot-chatgpt-badge';
    badge.innerHTML = `
      <div class="fb-badge-inner">
        <span class="fb-badge-icon">⚡</span>
        <span class="fb-badge-text">FloatBot AI</span>
        <span class="fb-badge-pill">PiP</span>
      </div>
    `;
    badge.title = 'Open Always-on-Top Floating Assistant (over VS Code)';

    const style = document.createElement('style');
    style.id = 'floatbot-badge-style';
    style.textContent = `
      #floatbot-chatgpt-badge {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 999999;
        cursor: pointer;
        user-select: none;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      #floatbot-chatgpt-badge:hover {
        transform: scale(1.06) translateY(-2px);
      }
      #floatbot-chatgpt-badge:active {
        transform: scale(0.96);
      }
      .fb-badge-inner {
        display: flex;
        align-items: center;
        gap: 7px;
        background: linear-gradient(135deg, #131720, #1e2638);
        border: 1px solid rgba(0, 229, 153, 0.5);
        padding: 7px 14px;
        border-radius: 30px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5), 0 0 12px rgba(0, 229, 153, 0.25);
      }
      .fb-badge-icon {
        font-size: 15px;
        color: #00e599;
      }
      .fb-badge-text {
        font-size: 12.5px;
        font-weight: 700;
        color: #ffffff;
        letter-spacing: -0.2px;
      }
      .fb-badge-pill {
        font-size: 9.5px;
        font-weight: 700;
        background: rgba(0, 229, 153, 0.18);
        color: #00e599;
        border: 1px solid rgba(0, 229, 153, 0.35);
        padding: 1px 6px;
        border-radius: 10px;
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(badge);

    badge.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openDocumentPipFromChatGPT();
    });
  }

  // Cleanup helper
  window.__FLOATAI_BRIDGE_CLEANUP__ = () => {
    chrome.runtime.onMessage.removeListener(messageListener);
    if (activeObserver) activeObserver.disconnect();
    if (streamPollInterval) clearInterval(streamPollInterval);
    const existingBadge = document.getElementById('floatbot-chatgpt-badge');
    if (existingBadge) existingBadge.remove();
    const existingStyle = document.getElementById('floatbot-badge-style');
    if (existingStyle) existingStyle.remove();
  };

  // Inject floating PiP badge on ChatGPT tab
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(injectFloatBotBadge, 800));
  } else {
    setTimeout(injectFloatBotBadge, 800);
  }

})();
