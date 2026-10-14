/**
 * FloatAI - Document Picture-in-Picture Controller & Floating Assistant Shell
 * Manifest V3, Chrome 116+ Document PiP API.
 */

let pipWindowInstance = null;
let resizeDebounceTimer = null;
let currentAttachment = null;
let isMinimized = false;
let preMinimizeWidth = 430;
let preMinimizeHeight = 640;
let cachedPipWidth = 430;
let cachedPipHeight = 640;

// Pre-cache dimensions synchronously from local storage for zero-await PiP requests
chrome.storage.local.get(['pipWidth', 'pipHeight'], (stored) => {
  if (stored) {
    if (stored.pipWidth) cachedPipWidth = stored.pipWidth;
    if (stored.pipHeight) cachedPipHeight = stored.pipHeight;
  }
});

const urlParams = new URLSearchParams(window.location.search);
const isStandalone = urlParams.get('mode') === 'standalone';
const isPipMode = urlParams.get('mode') === 'pip';

// DOM Elements - Companion Hub & Station
const assistantShell = document.getElementById('assistant-ui-root');
const btnFocusFloatingBot = document.getElementById('btn-focus-floating-bot');
const btnMinimizeAnchorWin = document.getElementById('btn-minimize-anchor-win');

// DOM Elements - Floating Shell
const btnPipPopout = document.getElementById('btn-pip-popout');
const btnMinimizePip = document.getElementById('btn-minimize-pip');
const minimizedCircleBtn = document.getElementById('minimized-circle-btn');
const btnThemeToggle = document.getElementById('btn-theme-toggle');
const btnClosePip = document.getElementById('btn-close-pip');
const chatMessages = document.getElementById('chat-messages');
const welcomeCard = document.getElementById('welcome-card');
const typingIndicator = document.getElementById('typing-indicator');

// Attachment Staging Elements
const attachmentStaging = document.getElementById('attachment-staging');
const stagingImage = document.getElementById('staging-image');
const stagingDocIcon = document.getElementById('staging-doc-icon');
const stagingFilename = document.getElementById('staging-filename');
const stagingBadge = document.getElementById('staging-badge');
const btnDownloadScreenshot = document.getElementById('btn-download-screenshot');
const btnCopyScreenshot = document.getElementById('btn-copy-screenshot');
const btnRemoveScreenshot = document.getElementById('btn-remove-screenshot');

// Composer Elements
const promptInput = document.getElementById('prompt-input');
const btnSendMessage = document.getElementById('btn-send-message');
const btnCaptureScreen = document.getElementById('btn-capture-screen');
const btnAttachDoc = document.getElementById('btn-attach-doc');
const fileInputDoc = document.getElementById('file-input-doc');
const btnChatgptHandoff = document.getElementById('btn-chatgpt-handoff');
const btnClearChat = document.getElementById('btn-clear-chat');
const floatToast = document.getElementById('float-toast');
const dragDropOverlay = document.getElementById('drag-drop-overlay');

// Verify Document Picture-in-Picture Support
if (!('documentPictureInPicture' in window)) {
  console.warn('[FloatBot AI] Document Picture-in-Picture is not supported in this Chrome version. Chrome 116+ required.');
}

// =========================================================================
// 1. Document Picture-in-Picture Window Lifecycle
// =========================================================================

function openDocumentPip() {
  if (!('documentPictureInPicture' in window)) {
    alert('Document Picture-in-Picture is not supported in this Chrome version. Chrome 116+ required.');
    return;
  }

  if (pipWindowInstance && !pipWindowInstance.closed) {
    try { pipWindowInstance.focus(); } catch (e) {}
    return;
  }

  try {
    // CRITICAL: Call requestWindow SYNCHRONOUSLY without any preceding await to preserve user activation
    const pipPromise = window.documentPictureInPicture.requestWindow({
      width: cachedPipWidth,
      height: cachedPipHeight,
      disallowReturnToOpener: false
    });

    pipPromise.then((pipWindow) => {
      pipWindowInstance = pipWindow;
      copyStylesheetsToPip(pipWindow);

      // Transfer assistant shell into the PiP window body
      pipWindow.document.body.appendChild(assistantShell);
      pipWindow.document.documentElement.classList.toggle('light-theme', currentTheme === 'light');
      pipWindow.document.body.classList.toggle('light-theme', currentTheme === 'light');

      if (btnPipPopout) btnPipPopout.style.display = 'none';

      // Reveal the Companion Hub Dashboard in the anchor window with full instructions & warning
      const anchorPanel = document.getElementById('anchor-control-panel');
      if (anchorPanel) {
        anchorPanel.style.display = 'flex';
      }

      // Resize the companion window safely within visible screen bounds
      if (isStandalone && typeof chrome !== 'undefined' && chrome.windows) {
        try {
          chrome.windows.getCurrent((currWin) => {
            if (chrome.runtime.lastError || !currWin || !currWin.id) return;
            const screenW = (window.screen && window.screen.availWidth) || 1920;
            const screenH = (window.screen && window.screen.availHeight) || 1080;
            const targetW = Math.min(620, Math.floor(screenW * 0.9));
            const targetH = Math.min(680, Math.floor(screenH * 0.9));

            const updateInfo = {
              width: targetW,
              height: targetH,
              focused: false
            };

            if (currWin.left !== undefined && currWin.left !== null) {
              if (currWin.left + targetW > screenW) {
                updateInfo.left = Math.max(10, screenW - targetW - 20);
              }
            }
            if (currWin.top !== undefined && currWin.top !== null) {
              if (currWin.top + targetH > screenH) {
                updateInfo.top = Math.max(10, screenH - targetH - 20);
              }
            }

            chrome.windows.update(currWin.id, updateInfo).catch(() => {});
          });
        } catch (e) {}
      }

      // Focus input field inside PiP
      setTimeout(() => {
        if (promptInput) promptInput.focus();
      }, 150);

      // Persist resize (only when expanded, so minimized circle size doesn't overwrite preferences)
      pipWindow.addEventListener('resize', () => {
        clearTimeout(resizeDebounceTimer);
        resizeDebounceTimer = setTimeout(() => {
          if (!isMinimized && pipWindow.innerWidth > 220 && pipWindow.innerHeight > 260) {
            cachedPipWidth = pipWindow.innerWidth;
            cachedPipHeight = pipWindow.innerHeight;
            chrome.storage.local.set({
              pipWidth: pipWindow.innerWidth,
              pipHeight: pipWindow.innerHeight
            });
          }
        }, 350);
      });

      // Handle PiP Window Close (Clean exit or dock back)
      pipWindow.addEventListener('pagehide', () => {
        if (isStandalone) {
          // Cleanly close the standalone launcher window when PiP is closed
          window.close();
        } else {
          document.querySelector('.launcher-shell').appendChild(assistantShell);
          pipWindowInstance = null;
          if (isMinimized) {
            restoreAssistant();
          }
        }
      });
    }).catch(() => {
      // Quietly ignore if gesture is required
    });

  } catch (err) {
    // Quietly ignore
  }
}

function copyStylesheetsToPip(pipWindow) {
  // Directly attach extension stylesheet link
  const extLink = pipWindow.document.createElement('link');
  extLink.rel = 'stylesheet';
  extLink.href = chrome.runtime.getURL('launcher.css');
  pipWindow.document.head.appendChild(extLink);

  [...document.styleSheets].forEach((styleSheet) => {
    try {
      const cssRules = [...styleSheet.cssRules].map((rule) => rule.cssText).join('');
      const style = pipWindow.document.createElement('style');
      style.textContent = cssRules;
      pipWindow.document.head.appendChild(style);
    } catch {
      if (styleSheet.href) {
        const link = pipWindow.document.createElement('link');
        link.rel = 'stylesheet';
        link.type = styleSheet.type || 'text/css';
        link.media = styleSheet.media?.mediaText || 'all';
        link.href = styleSheet.href;
        pipWindow.document.head.appendChild(link);
      }
    }
  });

  pipWindow.document.title = 'FloatBot AI';
}

function getActiveTargetWindow() {
  if (pipWindowInstance && !pipWindowInstance.closed) {
    return pipWindowInstance;
  }
  return window;
}

function closeOrDockPip() {
  if (pipWindowInstance && !pipWindowInstance.closed) {
    try { pipWindowInstance.close(); } catch (e) {}
  } else {
    try { window.close(); } catch (e) {}
  }
}

// =========================================================================
// 2. Minimized Floating Circle Widget Controller
// =========================================================================

function minimizeAssistant() {
  isMinimized = true;
  const targetWin = getActiveTargetWindow();

  try {
    const curW = targetWin.innerWidth || window.innerWidth || 430;
    const curH = targetWin.innerHeight || window.innerHeight || 640;
    if (curW > 220 && curH > 260) {
      preMinimizeWidth = curW;
      preMinimizeHeight = curH;
    }
  } catch (e) {
    preMinimizeWidth = 430;
    preMinimizeHeight = 640;
  }

  try {
    targetWin.resizeTo(120, 120);
  } catch (e) {}

  assistantShell.classList.add('minimized-mode');
  if (minimizedCircleBtn) minimizedCircleBtn.style.display = 'flex';
  showToast('Minimized to floating circle');
}

function restoreAssistant() {
  isMinimized = false;
  assistantShell.classList.remove('minimized-mode');
  if (minimizedCircleBtn) minimizedCircleBtn.style.display = 'none';

  const targetW = preMinimizeWidth >= 320 ? preMinimizeWidth : 430;
  const targetH = preMinimizeHeight >= 450 ? preMinimizeHeight : 640;

  const targetWin = getActiveTargetWindow();

  try {
    targetWin.resizeTo(targetW, targetH);
  } catch (e) {}

  showToast('FloatBot AI restored');
  setTimeout(() => {
    if (promptInput) promptInput.focus();
  }, 150);
}

// =========================================================================
// 2b. Light / Dark Theme Controller
// =========================================================================

let currentTheme = 'dark';

const THEME_ICONS = {
  sun: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="5"></circle>
    <line x1="12" y1="1" x2="12" y2="3"></line>
    <line x1="12" y1="21" x2="12" y2="23"></line>
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
    <line x1="1" y1="12" x2="3" y2="12"></line>
    <line x1="21" y1="12" x2="23" y2="12"></line>
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
  </svg>`,
  moon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
  </svg>`
};

function applyTheme(theme, save = true) {
  currentTheme = theme === 'light' ? 'light' : 'dark';
  const isLight = currentTheme === 'light';

  document.documentElement.classList.toggle('light-theme', isLight);
  document.body.classList.toggle('light-theme', isLight);
  if (assistantShell) {
    assistantShell.classList.toggle('light-theme', isLight);
  }

  if (pipWindowInstance && !pipWindowInstance.closed) {
    try {
      pipWindowInstance.document.documentElement.classList.toggle('light-theme', isLight);
      pipWindowInstance.document.body.classList.toggle('light-theme', isLight);
    } catch (e) {}
  }

  if (btnThemeToggle) {
    btnThemeToggle.title = isLight ? 'Switch to Dark Mode' : 'Switch to Light Mode';
    btnThemeToggle.innerHTML = isLight ? THEME_ICONS.moon : THEME_ICONS.sun;
  }

  if (save) {
    chrome.storage.local.set({ appTheme: currentTheme });
    showToast(isLight ? '☀️ Light theme activated' : '🌙 Dark theme activated');
  }
}

function toggleTheme() {
  applyTheme(currentTheme === 'light' ? 'dark' : 'light', true);
}

// Load saved theme on startup
chrome.storage.local.get(['appTheme'], (stored) => {
  if (stored && stored.appTheme) {
    applyTheme(stored.appTheme, false);
  } else {
    applyTheme('dark', false);
  }
});

// =========================================================================
// 3. Screen Capture: Desktop Window / VS Code (getDisplayMedia API)
// =========================================================================

async function captureScreenMedia() {
  btnCaptureScreen.disabled = true;
  showToast('Select window or screen to capture...');

  try {
    // 1. Determine active mediaDevices context (prefer active PiP window if attached)
    let mediaDevices = null;
    if (pipWindowInstance && !pipWindowInstance.closed && pipWindowInstance.navigator?.mediaDevices?.getDisplayMedia) {
      mediaDevices = pipWindowInstance.navigator.mediaDevices;
    } else if (window.navigator?.mediaDevices?.getDisplayMedia) {
      mediaDevices = window.navigator.mediaDevices;
    } else if (navigator?.mediaDevices?.getDisplayMedia) {
      mediaDevices = navigator.mediaDevices;
    }

    if (!mediaDevices || typeof mediaDevices.getDisplayMedia !== 'function') {
      throw new Error('Screen capture is not supported in this window.');
    }

    const stream = await mediaDevices.getDisplayMedia({
      video: { cursor: 'always' },
      audio: false,
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include'
    });

    const track = stream.getVideoTracks()[0];
    if (!track) {
      throw new Error('No video track returned from screen capture.');
    }

    let bitmap = null;

    // Strategy A: ImageCapture grabFrame
    if (typeof ImageCapture !== 'undefined') {
      try {
        const imageCapture = new ImageCapture(track);
        bitmap = await imageCapture.grabFrame();
      } catch (grabErr) {
        console.log('[FloatBot] ImageCapture grabFrame note, using video fallback:', grabErr);
      }
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (bitmap) {
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      ctx.drawImage(bitmap, 0, 0);
      track.stop();
      stream.getTracks().forEach((t) => t.stop());
    } else {
      // Strategy B: 100% reliable <video> frame extraction fallback
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();

      await new Promise((resolve) => {
        if (video.videoWidth > 0 && video.videoHeight > 0) return resolve();
        video.onloadedmetadata = () => resolve();
        setTimeout(resolve, 350);
      });

      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      track.stop();
      stream.getTracks().forEach((t) => t.stop());
    }

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const dataUrl = canvas.toDataURL('image/png');
    const filename = `screen-${Date.now()}.png`;

    stageAttachment({
      dataUrl: dataUrl,
      blob: blob,
      name: filename,
      badge: 'Screen Capture',
      title: 'Desktop Window',
      isImage: true
    });

    // Copy to clipboard
    if (navigator.clipboard && navigator.clipboard.write) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob })
        ]);
        showToast('📸 Screen captured & copied to clipboard!');
      } catch {
        showToast('📸 Screen captured! (Click Copy in preview)');
      }
    } else {
      showToast('📸 Screen captured!');
    }

  } catch (err) {
    console.warn('[FloatBot] Screen capture error:', err);
    const msg = (err.message || '').toLowerCase();
    if (err.name === 'NotAllowedError' && (msg.includes('permission denied') || msg.includes('user denied') || msg.includes('cancelled') || msg.length === 0)) {
      showToast('Screen capture cancelled');
    } else {
      showToast('Capture notice: ' + (err.message || err.name));
    }
  } finally {
    btnCaptureScreen.disabled = false;
  }
}

// =========================================================================
// 4. Attachment Management
// =========================================================================

function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function handleFileSelected(file) {
  if (!file) return;

  const isImage = file.type.startsWith('image/');
  const reader = new FileReader();

  reader.onload = (e) => {
    const dataUrl = e.target.result;
    const sizeStr = formatFileSize(file.size);
    const ext = file.name.split('.').pop().toLowerCase();
    let badge = 'Document';
    let icon = '📄';

    if (ext === 'pdf') {
      badge = 'PDF Document';
      icon = '📕';
    } else if (['doc', 'docx'].includes(ext)) {
      badge = 'Word Doc';
      icon = '📘';
    } else if (['csv', 'xlsx', 'xls'].includes(ext)) {
      badge = 'Spreadsheet';
      icon = '📊';
    } else if (['py', 'js', 'ts', 'jsx', 'tsx', 'html', 'css', 'json', 'yaml', 'yml', 'xml', 'sql', 'sh', 'java', 'cpp', 'c', 'cs'].includes(ext)) {
      badge = 'Code / Data';
      icon = '💻';
    } else if (isImage) {
      badge = 'Image File';
      icon = '🖼️';
    }

    stageAttachment({
      dataUrl: dataUrl,
      blob: file,
      name: file.name,
      sizeStr: sizeStr,
      badge: badge,
      icon: icon,
      isImage: isImage,
      mimeType: file.type || 'application/octet-stream'
    });

    showToast(`📎 Attached: ${file.name} (${sizeStr})`);
  };

  reader.readAsDataURL(file);
}

function stageAttachment(attachment) {
  currentAttachment = attachment;

  if (attachment.isImage) {
    stagingImage.style.display = 'block';
    stagingImage.src = attachment.dataUrl;
    if (stagingDocIcon) stagingDocIcon.style.display = 'none';
  } else {
    stagingImage.style.display = 'none';
    if (stagingDocIcon) {
      stagingDocIcon.style.display = 'flex';
      stagingDocIcon.textContent = attachment.icon || '📄';
    }
  }

  stagingFilename.textContent = attachment.name;
  stagingBadge.textContent = attachment.badge || (attachment.isImage ? 'Screen Capture' : 'Document');
  attachmentStaging.style.display = 'block';
  updateSendButtonState();
}

function removeAttachment() {
  currentAttachment = null;
  stagingImage.src = '';
  if (stagingDocIcon) stagingDocIcon.style.display = 'none';
  attachmentStaging.style.display = 'none';
  updateSendButtonState();
  showToast('Attachment removed');
}

function downloadAttachment() {
  if (!currentAttachment) return;
  const link = document.createElement('a');
  link.download = currentAttachment.name;
  link.href = currentAttachment.dataUrl;
  link.click();
  showToast(`💾 Saved ${currentAttachment.name} to Downloads`);
}

async function copyAttachmentToClipboard() {
  if (!currentAttachment) return;
  if (currentAttachment.blob && currentAttachment.isImage) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': currentAttachment.blob })
      ]);
      showToast('📋 Image copied to clipboard!');
    } catch (err) {
      showToast('Failed to copy image: ' + err.message);
    }
  } else {
    await navigator.clipboard.writeText(currentAttachment.name);
    showToast(`📋 Copied filename: ${currentAttachment.name}`);
  }
}

// =========================================================================
// 5. ChatGPT Tab Handoff / Navigation
// =========================================================================

async function handoffToChatGPT() {
  const promptText = promptInput.value.trim();
  if (promptText) {
    await navigator.clipboard.writeText(promptText);
  }

  chrome.runtime.sendMessage({ type: 'FIND_OR_OPEN_CHATGPT' }, async (response) => {
    if (response && response.tab) {
      await chrome.tabs.update(response.tab.id, { active: true });
      await chrome.windows.update(response.tab.windowId, { focused: true });
      showToast('Switched to open ChatGPT tab');
    } else {
      chrome.tabs.create({ url: 'https://chatgpt.com', active: true });
      showToast('Opening ChatGPT in new tab...');
    }
  });
}

// =========================================================================
// 6. Conversation Stream & Live ChatGPT Bridge Interaction
// =========================================================================

let currentStreamingBubble = null;
let currentStreamingText = '';
let activeResponsePollInterval = null;

function normalizeText(str) {
  if (!str) return '';
  return str
    .replace(/(?:Copy|Read aloud|Good response|Bad response|Try Plus free)\s*$/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getActiveStreamingBubble() {
  if (currentStreamingBubble && currentStreamingBubble.isConnected) {
    return currentStreamingBubble;
  }
  const assistantBubbles = chatMessages.querySelectorAll('.message-row.assistant .message-bubble');
  if (assistantBubbles.length > 0) {
    return assistantBubbles[assistantBubbles.length - 1];
  }
  return null;
}

function updateAssistantBubble(bubble, text) {
  if (!bubble || !text) return;
  // Completely overwrite bubble content with rendered markdown
  bubble.innerHTML = renderMarkdownToHtml(text);
  // Ensure any leftover timeout or placeholder elements are removed
  const remnants = bubble.querySelectorAll('.streaming-placeholder, #btn-stream-timeout-goto, #btn-stream-fallback-goto');
  remnants.forEach((el) => el.remove());
}

// Listen for real-time streaming chunks from chatgpt-bridge.js
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'CHATGPT_STREAM_UPDATE') {
    const bubble = getActiveStreamingBubble();
    if (bubble) {
      currentStreamingText = message.text;
      updateAssistantBubble(bubble, message.text);
      chatMessages.scrollTop = chatMessages.scrollHeight;

      if (message.isDone) {
        if (activeResponsePollInterval) {
          clearInterval(activeResponsePollInterval);
          activeResponsePollInterval = null;
        }
        typingIndicator.style.display = 'none';
        currentStreamingBubble = null;
        showToast('ChatGPT response complete');
      }
    }
  }

  if (message.type === 'CHATGPT_STREAM_TIMEOUT') {
    const bubble = getActiveStreamingBubble();
    if (bubble && !currentStreamingText) {
      if (typingIndicator) {
        const textEl = typingIndicator.querySelector('.typing-text');
        if (textEl) textEl.textContent = 'ChatGPT is taking a moment to write...';
      }
      const placeholder = bubble.querySelector('.streaming-placeholder');
      if (placeholder && !placeholder.querySelector('#btn-stream-timeout-goto')) {
        placeholder.innerHTML = `
          <em>ChatGPT is taking longer than usual to generate response...</em>
          <div style="margin-top: 8px;">
            <button class="staging-action-btn" id="btn-stream-timeout-goto" style="font-size: 11px; padding: 4px 10px;">👉 Switch to ChatGPT Tab</button>
          </div>
        `;
        const gotoBtn = bubble.querySelector('#btn-stream-timeout-goto');
        if (gotoBtn) {
          gotoBtn.addEventListener('click', () => {
            handoffToChatGPT();
          });
        }
      }
    }
  }
});

function updateSendButtonState() {
  if (!promptInput || !btnSendMessage) return;
  const hasText = promptInput.value.trim().length > 0;
  const hasAttachment = currentAttachment !== null;
  btnSendMessage.disabled = !(hasText || hasAttachment);
}

function autoResizeInput() {
  if (!promptInput) return;
  promptInput.style.height = 'auto';
  promptInput.style.height = Math.min(promptInput.scrollHeight, 120) + 'px';
  updateSendButtonState();
}

function appendMessage({ role, text, attachment, codeSnippet, lang = 'javascript' }) {
  if (welcomeCard && welcomeCard.parentNode) {
    welcomeCard.remove();
  }

  const row = document.createElement('div');
  row.className = `message-row ${role}`;

  const meta = document.createElement('div');
  meta.className = 'message-meta';
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  meta.textContent = role === 'user' ? `You • ${timeStr}` : `ChatGPT • ${timeStr}`;

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';

  // Include attached screenshot preview or document card in bubble
  if (attachment) {
    if (attachment.isImage) {
      const thumbContainer = document.createElement('div');
      thumbContainer.className = 'bubble-screenshot-thumb';
      const img = document.createElement('img');
      img.src = attachment.dataUrl;
      img.alt = attachment.name || 'Attached screenshot';
      img.title = 'Click to open image full-size';
      img.addEventListener('click', () => {
        window.open(attachment.dataUrl, '_blank');
      });
      thumbContainer.appendChild(img);
      bubble.appendChild(thumbContainer);
    } else {
      const docCard = document.createElement('div');
      docCard.className = 'bubble-doc-card';
      docCard.title = 'Click to download attached file';
      docCard.innerHTML = `
        <span class="bubble-doc-icon">${attachment.icon || '📄'}</span>
        <div class="bubble-doc-info">
          <span class="bubble-doc-name">${attachment.name}</span>
          <span class="bubble-doc-meta">${attachment.sizeStr || 'Document'} • ${attachment.badge || 'File'}</span>
        </div>
      `;
      docCard.addEventListener('click', () => {
        const link = document.createElement('a');
        link.download = attachment.name;
        link.href = attachment.dataUrl;
        link.click();
      });
      bubble.appendChild(docCard);
    }
  }

  // Render text
  if (text) {
    bubble.innerHTML += renderMarkdownToHtml(text);
  }

  // Render code block if provided
  if (codeSnippet) {
    const codeContainer = document.createElement('div');
    codeContainer.className = 'code-block-container';

    const codeHeader = document.createElement('div');
    codeHeader.className = 'code-block-header';
    codeHeader.innerHTML = `<span>${lang}</span><button class="code-copy-btn">Copy</button>`;

    const pre = document.createElement('pre');
    pre.textContent = codeSnippet;

    const copyBtn = codeHeader.querySelector('.code-copy-btn');
    copyBtn.addEventListener('click', async () => {
      await navigator.clipboard.writeText(codeSnippet);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => (copyBtn.textContent = 'Copy'), 2000);
    });

    codeContainer.appendChild(codeHeader);
    codeContainer.appendChild(pre);
    bubble.appendChild(codeContainer);
  }

  // Add Copy message action for assistant
  if (role === 'assistant') {
    const actionRow = document.createElement('div');
    actionRow.className = 'msg-action-row';

    const copyMsgBtn = document.createElement('button');
    copyMsgBtn.className = 'msg-action-btn';
    copyMsgBtn.innerHTML = '<span>📋</span><span>Copy</span>';
    copyMsgBtn.addEventListener('click', async () => {
      const fullText = (text || '') + (codeSnippet ? '\n\n' + codeSnippet : '');
      await navigator.clipboard.writeText(fullText);
      showToast('Response copied to clipboard!');
    });

    actionRow.appendChild(copyMsgBtn);
    bubble.appendChild(actionRow);
  }

  row.appendChild(meta);
  row.appendChild(bubble);
  chatMessages.appendChild(row);

  // Auto-scroll to bottom
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function handleSendMessage() {
  const text = promptInput.value.trim();
  const attachment = currentAttachment;

  if (!text && !attachment) return;

  // Append user message
  appendMessage({
    role: 'user',
    text: text,
    attachment: attachment
  });

  // Reset inputs
  promptInput.value = '';
  promptInput.style.height = 'auto';
  removeAttachment();
  updateSendButtonState();

  // Show typing indicator
  typingIndicator.style.display = 'flex';
  typingIndicator.querySelector('.typing-text').textContent = 'Connecting to open ChatGPT tab...';
  chatMessages.scrollTop = chatMessages.scrollHeight;

  // Create an assistant message placeholder that will stream ChatGPT's response live
  const assistantRow = document.createElement('div');
  assistantRow.className = 'message-row assistant';

  const meta = document.createElement('div');
  meta.className = 'message-meta';
  const now = new Date();
  meta.textContent = `ChatGPT • ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.innerHTML = '<p class="streaming-placeholder"><em>Connecting to your open ChatGPT tab...</em></p>';

  const actionRow = document.createElement('div');
  actionRow.className = 'msg-action-row';
  const copyBtn = document.createElement('button');
  copyBtn.className = 'msg-action-btn';
  copyBtn.innerHTML = '<span>📋</span><span>Copy</span>';
  copyBtn.addEventListener('click', async () => {
    if (bubble.innerText) {
      await navigator.clipboard.writeText(bubble.innerText);
      showToast('Response copied to clipboard!');
    }
  });
  actionRow.appendChild(copyBtn);

  assistantRow.appendChild(meta);
  assistantRow.appendChild(bubble);
  assistantRow.appendChild(actionRow);
  chatMessages.appendChild(assistantRow);

  currentStreamingBubble = bubble;
  currentStreamingText = '';
  chatMessages.scrollTop = chatMessages.scrollHeight;

  // Reset active response poll interval if running from previous message
  if (activeResponsePollInterval) {
    clearInterval(activeResponsePollInterval);
    activeResponsePollInterval = null;
  }

  // Step 1: Find or open the ChatGPT tab
  chrome.runtime.sendMessage({ type: 'FIND_OR_OPEN_CHATGPT' }, async (response) => {
    if (!response || !response.success || !response.tab) {
      bubble.innerHTML = `<p style="color: #ff5c5c;">✕ Failed to locate ChatGPT tab: ${response?.error || 'Unknown error'}</p>`;
      typingIndicator.style.display = 'none';
      return;
    }

    const chatTab = response.tab;
    typingIndicator.querySelector('.typing-text').textContent = response.created
      ? 'Opening ChatGPT tab, waiting for it to load...'
      : 'Connecting to ChatGPT tab...';

    // Activate the tab in its window so Chrome provides full focus and doesn't throttle background timers
    try {
      await chrome.tabs.update(chatTab.id, { active: true });
    } catch (e) {}

    // Wait if tab was just opened
    if (response.created) {
      await sleep(3500);
    }

    // Step 2: Ensure content script is ready and current
    chrome.tabs.sendMessage(chatTab.id, { type: 'PING_CHATGPT' }, async (pingRes) => {
      if (chrome.runtime.lastError || !pingRes || pingRes.version !== '1.0.2') {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: chatTab.id },
            files: ['chatgpt-bridge.js']
          });
          await sleep(250);
        } catch (e) {
          console.log('Script injection note:', e);
        }
      }

      // Step 3: Send prompt and attachments to ChatGPT content script
      chrome.tabs.sendMessage(chatTab.id, {
        type: 'EXECUTE_CHATGPT_PROMPT',
        prompt: text,
        attachmentDataUrl: attachment?.dataUrl,
        attachmentName: attachment?.name,
        attachmentType: attachment?.mimeType,
        isImage: attachment?.isImage,
        imageBase64: attachment?.dataUrl,
        imageName: attachment?.name
      }, (execResponse) => {
        if (chrome.runtime.lastError || !execResponse?.success) {
          const err = chrome.runtime.lastError?.message || execResponse?.error || 'Could not communicate with ChatGPT tab';
          bubble.innerHTML = `
            <p style="color: #ff5c5c; margin-bottom: 6px;">⚠️ Notice: ${err}</p>
            <p style="color: var(--text-dim); font-size: 11.5px; margin-bottom: 8px;">Target tab: <code>${chatTab.url || 'https://chatgpt.com'}</code></p>
            <button class="staging-action-btn" id="btn-goto-chatgpt-tab" style="padding: 4px 10px; font-weight: 600;">👉 Open / Refresh ChatGPT Tab</button>
          `;
          const gotoBtn = bubble.querySelector('#btn-goto-chatgpt-tab');
          if (gotoBtn) {
            gotoBtn.addEventListener('click', () => {
              chrome.tabs.update(chatTab.id, { active: true });
              chrome.windows.update(chatTab.windowId, { focused: true });
            });
          }
          typingIndicator.style.display = 'none';
          return;
        }

        const preAssistantCount = execResponse?.preAssistantCount !== undefined ? execResponse.preAssistantCount : -1;
        const preResponseText = execResponse?.preAssistantText || '';
        typingIndicator.querySelector('.typing-text').textContent = 'ChatGPT is thinking & writing...';

        // Step 4: Active Dual-Layer Sync: Poll ChatGPT tab every 1200ms to pull response
        let consecutiveUnchangedCount = 0;
        let lastPolledText = '';
        const pollStartTime = Date.now();

        activeResponsePollInterval = setInterval(() => {
          const targetBubble = getActiveStreamingBubble();
          if (!targetBubble) {
            clearInterval(activeResponsePollInterval);
            activeResponsePollInterval = null;
            return;
          }

          chrome.tabs.sendMessage(chatTab.id, {
            type: 'GET_LATEST_CHATGPT_RESPONSE',
            preAssistantCount: preAssistantCount,
            preAssistantText: preResponseText
          }, (res) => {
            if (chrome.runtime.lastError || !res || !res.success) return;

            const pulledText = (res.text || '').trim();
            const normalizedPulled = normalizeText(pulledText);
            const normalizedPre = normalizeText(preResponseText);
            const hasTextChanged = normalizedPre ? (normalizedPulled !== normalizedPre) : (normalizedPulled.length > 0);
            const isFreshResponse = pulledText && hasTextChanged && (
              res.isNew ||
              res.isGenerating ||
              (res.count !== undefined && res.count > preAssistantCount && preAssistantCount >= 0) ||
              preAssistantCount <= 0
            );

            if (isFreshResponse) {
              currentStreamingText = pulledText;
              updateAssistantBubble(targetBubble, pulledText);
              chatMessages.scrollTop = chatMessages.scrollHeight;

              // Check if generation finished and text is stable
              if (!res.isGenerating) {
                if (pulledText === lastPolledText) {
                  consecutiveUnchangedCount++;
                  if (consecutiveUnchangedCount >= 2) {
                    clearInterval(activeResponsePollInterval);
                    activeResponsePollInterval = null;
                    typingIndicator.style.display = 'none';
                    currentStreamingBubble = null;
                    showToast('ChatGPT response complete');
                  }
                } else {
                  consecutiveUnchangedCount = 0;
                  lastPolledText = pulledText;
                }
              }
            }
          });

          // 3-minute poll safety cutoff
          if (Date.now() - pollStartTime > 180000) {
            clearInterval(activeResponsePollInterval);
            activeResponsePollInterval = null;
          }
        }, 1200);

        // 75-second local fallback timer (gives plenty of time for document analysis)
        setTimeout(() => {
          const targetBubble = getActiveStreamingBubble();
          if (targetBubble && !currentStreamingText) {
            // Attempt direct pull check before showing fallback UI
            chrome.tabs.sendMessage(chatTab.id, {
              type: 'GET_LATEST_CHATGPT_RESPONSE',
              preAssistantCount: preAssistantCount,
              preAssistantText: preResponseText
            }, (finalRes) => {
              if (finalRes && finalRes.text && finalRes.text.trim()) {
                currentStreamingText = finalRes.text.trim();
                updateAssistantBubble(targetBubble, currentStreamingText);
                typingIndicator.style.display = 'none';
                return;
              }
              if (typingIndicator) {
                const textEl = typingIndicator.querySelector('.typing-text');
                if (textEl) textEl.textContent = 'ChatGPT is taking a moment to write...';
              }
              const placeholder = targetBubble.querySelector('.streaming-placeholder');
              if (placeholder && !placeholder.querySelector('#btn-stream-fallback-goto')) {
                placeholder.innerHTML = `
                  <em>ChatGPT is taking longer than usual to generate response...</em>
                  <div style="margin-top: 8px;">
                    <button class="staging-action-btn" id="btn-stream-fallback-goto" style="font-size: 11px; padding: 4px 10px;">👉 Switch to ChatGPT Tab</button>
                  </div>
                `;
                const fallbackBtn = targetBubble.querySelector('#btn-stream-fallback-goto');
                if (fallbackBtn) {
                  fallbackBtn.addEventListener('click', () => {
                    chrome.tabs.update(chatTab.id, { active: true });
                    chrome.windows.update(chatTab.windowId, { focused: true });
                  });
                }
              }
            });
          }
        }, 75000);
      });
    });
  });
}

function renderMarkdownToHtml(markdown) {
  if (!markdown) return '';

  let html = markdown
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks: ```lang ... ```
  html = html.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
    const language = lang || 'code';
    const escapedCode = code.trim();
    return `
      <div class="code-block-container">
        <div class="code-block-header">
          <span>${language}</span>
          <button class="code-copy-btn" onclick="navigator.clipboard.writeText(this.closest('.code-block-container').querySelector('pre').innerText); this.innerText='Copied!'; setTimeout(()=>this.innerText='Copy', 2000);">Copy</button>
        </div>
        <pre>${escapedCode}</pre>
      </div>
    `;
  });

  // Inline code: `code`
  html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

  // Bold: **text**
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Italics: *text*
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Lists: lines starting with "- " or "* "
  html = html.replace(/(?:^|\n)[-*]\s+([^\n]+)/g, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/g, '<ul>$1</ul>');

  // Paragraphs
  html = html
    .split(/\n\n+/)
    .map((p) => {
      p = p.trim();
      if (!p) return '';
      if (p.startsWith('<div class="code-block-container">') || p.startsWith('<ul>')) return p;
      return `<p>${p.replace(/\n/g, '<br>')}</p>`;
    })
    .join('');

  return html;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function clearChat() {
  chatMessages.innerHTML = `
    <div class="welcome-card" id="welcome-card">
      <div class="welcome-icon">👋</div>
      <h3>Welcome to FloatBot AI</h3>
      <p>Your interactive AI companion that stays on top while you code, study, and browse.</p>
      <div class="quick-tips">
        <div class="tip-item">
          <span class="tip-icon">🪟</span>
          <span>Stays visible even when switching to <strong>VS Code</strong>.</span>
        </div>
        <div class="tip-item">
          <span class="tip-icon">🖥️</span>
          <span>Click <strong>Screen</strong> to snap your code or any window.</span>
        </div>
        <div class="tip-item">
          <span class="tip-icon">📎</span>
          <span>Click <strong>Attach File</strong> or drop documents & code.</span>
        </div>
      </div>
    </div>
  `;
  showToast('Chat history cleared');
}

// =========================================================================
// 7. Notifications / Toasts
// =========================================================================

let toastTimeout = null;
function showToast(message) {
  if (!floatToast) return;
  floatToast.textContent = message;
  floatToast.style.display = 'block';

  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    if (floatToast) floatToast.style.display = 'none';
  }, 3200);
}

// =========================================================================
// 8. Event Listeners Initialization
// =========================================================================

if (btnClosePip) btnClosePip.addEventListener('click', closeOrDockPip);
if (btnPipPopout) btnPipPopout.addEventListener('click', openDocumentPip);
if (btnMinimizePip) btnMinimizePip.addEventListener('click', minimizeAssistant);
if (minimizedCircleBtn) minimizedCircleBtn.addEventListener('click', restoreAssistant);

if (btnFocusFloatingBot) {
  btnFocusFloatingBot.addEventListener('click', () => {
    if (pipWindowInstance && !pipWindowInstance.closed) {
      if (isMinimized) {
        restoreAssistant();
      }
      try { pipWindowInstance.focus(); } catch (e) {}
    } else {
      openDocumentPip();
    }
  });
}

if (btnMinimizeAnchorWin) {
  btnMinimizeAnchorWin.addEventListener('click', () => {
    try {
      chrome.windows.getCurrent((currWin) => {
        if (chrome.runtime.lastError || !currWin || !currWin.id) return;
        chrome.windows.update(currWin.id, { state: 'minimized' }).catch(() => {});
      });
    } catch (e) {}
  });
}

if (btnThemeToggle) {
  btnThemeToggle.addEventListener('click', toggleTheme);
}

if (btnCaptureScreen) btnCaptureScreen.addEventListener('click', captureScreenMedia);
if (btnAttachDoc && fileInputDoc) {
  btnAttachDoc.addEventListener('click', () => fileInputDoc.click());
  fileInputDoc.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelected(e.target.files[0]);
    }
    e.target.value = '';
  });
}

// Drag and drop document attachment support
window.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (dragDropOverlay) dragDropOverlay.style.display = 'flex';
});

window.addEventListener('dragleave', (e) => {
  if (e.relatedTarget === null && dragDropOverlay) {
    dragDropOverlay.style.display = 'none';
  }
});

window.addEventListener('drop', (e) => {
  e.preventDefault();
  if (dragDropOverlay) dragDropOverlay.style.display = 'none';
  if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
    handleFileSelected(e.dataTransfer.files[0]);
  }
});

if (btnChatgptHandoff) btnChatgptHandoff.addEventListener('click', handoffToChatGPT);
if (btnClearChat) btnClearChat.addEventListener('click', clearChat);

if (btnDownloadScreenshot) btnDownloadScreenshot.addEventListener('click', downloadAttachment);
if (btnCopyScreenshot) btnCopyScreenshot.addEventListener('click', copyAttachmentToClipboard);
if (btnRemoveScreenshot) btnRemoveScreenshot.addEventListener('click', removeAttachment);

if (promptInput) {
  promptInput.addEventListener('input', autoResizeInput);
  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  });
}
if (btnSendMessage) btnSendMessage.addEventListener('click', handleSendMessage);

// Standalone Window or Direct PiP initialization
let hasAutoElevatedToPip = false;

function setupAutoElevate() {
  if (!isStandalone) return;

  const handleActivation = (e) => {
    if (pipWindowInstance && !pipWindowInstance.closed) return;

    // Don't auto-elevate if user is clicking close or minimize buttons
    if (e.target && (e.target.closest('#btn-close-pip') || e.target.closest('#btn-minimize-pip'))) {
      return;
    }

    // Call openDocumentPip SYNCHRONOUSLY within this gesture
    openDocumentPip();
  };

  window.addEventListener('pointerdown', handleActivation, true);
  window.addEventListener('keydown', handleActivation, true);
}

if (isPipMode) {
  document.body.classList.add('pip-mode');
  if (btnPipPopout) btnPipPopout.style.display = 'none';
  const anchorPanel = document.getElementById('anchor-control-panel');
  if (anchorPanel) anchorPanel.style.display = 'none';
} else if (isStandalone) {
  document.body.classList.add('standalone-mode');
  // Never show manual popout button - elevation is automated
  if (btnPipPopout) btnPipPopout.style.display = 'none';
  const anchorPanel = document.getElementById('anchor-control-panel');
  if (anchorPanel) anchorPanel.style.display = 'none';

  // Automatically elevate to Always-on-Top PiP
  setupAutoElevate();

  if (urlParams.get('auto') === '1') {
    try {
      openDocumentPip();
    } catch (e) {}
  }
}
