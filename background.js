/**
 * FloatAI - Background Service Worker (Manifest V3)
 * Manages extension state, lifecycle, and smart ChatGPT tab discovery.
 */

chrome.runtime.onInstalled.addListener((details) => {
  console.log('[FloatAI] Service worker initialized. Reason:', details.reason);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'FIND_OR_OPEN_CHATGPT') {
    handleFindOrOpenChatGPT(sendResponse);
    return true; // Keep message channel open for async response
  }

  if (message.type === 'LAUNCH_FLOATBOT_WINDOW') {
    handleLaunchFloatBotWindow(sendResponse);
    return true;
  }
});

async function handleLaunchFloatBotWindow(sendResponse) {
  try {
    const targetWidth = 620;
    const targetHeight = 680;
    const launcherUrl = chrome.runtime.getURL('launcher.html?mode=standalone&auto=1');

    const allWindows = await chrome.windows.getAll({ populate: true });
    const existingWindow = allWindows.find((w) =>
      w.tabs && w.tabs.some((t) => t.url && t.url.includes('launcher.html'))
    );

    if (existingWindow) {
      await chrome.windows.update(existingWindow.id, {
        focused: true,
        width: targetWidth,
        height: targetHeight
      }).catch(() => {});
    } else {
      await chrome.windows.create({
        url: launcherUrl,
        type: 'popup',
        width: targetWidth,
        height: targetHeight,
        focused: true
      });
    }

    if (sendResponse) sendResponse({ success: true });
  } catch (err) {
    if (sendResponse) sendResponse({ success: false, error: err.message });
  }
}

async function handleFindOrOpenChatGPT(sendResponse) {
  try {
    // 1. Check all open tabs across all browser windows for ChatGPT
    const allTabs = await chrome.tabs.query({});
    const chatTabs = allTabs.filter((t) => {
      if (!t.url) return false;
      return t.url.includes('chatgpt.com') || t.url.includes('chat.openai.com');
    });

    if (chatTabs && chatTabs.length > 0) {
      // Prioritize active tab, then non-login/auth tabs, then any tab
      let targetTab = chatTabs.find((t) => t.active && !t.url.includes('/auth') && !t.url.includes('/login'));
      if (!targetTab) {
        targetTab = chatTabs.find((t) => !t.url.includes('/auth') && !t.url.includes('/login'));
      }
      if (!targetTab) {
        targetTab = chatTabs[0];
      }

      sendResponse({ success: true, tab: targetTab, created: false });
    } else {
      // 2. No ChatGPT tab found, open a new one
      const newTab = await chrome.tabs.create({
        url: 'https://chatgpt.com',
        active: false
      });

      const checkListener = (tabId, changeInfo) => {
        if (tabId === newTab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(checkListener);
          sendResponse({ success: true, tab: newTab, created: true });
        }
      };
      chrome.tabs.onUpdated.addListener(checkListener);

      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(checkListener);
        sendResponse({ success: true, tab: newTab, created: true });
      }, 7000);
    }
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}
