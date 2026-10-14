/**
 * FloatAI - Popup Logic
 * Opens or focuses the launcher anchor tab.
 */

const btnOpenLauncher = document.getElementById('btn-open-launcher');
const statusMessage = document.getElementById('status-message');

btnOpenLauncher.addEventListener('click', async () => {
  btnOpenLauncher.disabled = true;
  showMessage('Launching FloatBot AI Always-on-Top...');

  try {
    const screenW = (window.screen && window.screen.availWidth) || 1920;
    const screenH = (window.screen && window.screen.availHeight) || 1080;
    const targetWidth = Math.min(620, Math.floor(screenW * 0.9));
    const targetHeight = Math.min(680, Math.floor(screenH * 0.9));
    const left = Math.max(20, Math.round((screenW - targetWidth) / 2));
    const top = Math.max(20, Math.round((screenH - targetHeight) / 2));

    const launcherUrl = chrome.runtime.getURL('launcher.html?mode=standalone&auto=1');

    const allWindows = await chrome.windows.getAll({ populate: true });
    const existingWindow = allWindows.find((w) =>
      w.tabs && w.tabs.some((t) => t.url && t.url.includes('launcher.html'))
    );

    if (existingWindow) {
      await chrome.windows.update(existingWindow.id, {
        focused: true,
        width: targetWidth,
        height: targetHeight,
        left: left,
        top: top
      }).catch(() => {});
    } else {
      await chrome.windows.create({
        url: launcherUrl,
        type: 'popup',
        width: targetWidth,
        height: targetHeight,
        left: left,
        top: top,
        focused: true
      });
    }

    setTimeout(() => {
      window.close();
    }, 120);
  } catch (err) {
    showMessage('Error: ' + err.message);
    btnOpenLauncher.disabled = false;
  }
});

function showMessage(text) {
  statusMessage.style.display = 'block';
  statusMessage.textContent = text;
}
