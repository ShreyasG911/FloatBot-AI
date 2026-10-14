# Chrome Web Store Listing — FloatBot AI

> Last Updated: 2026-10-15
> Release Version: 1.0.0

---

## Store Listing

**Extension Name** [REQUIRED]
FloatBot AI

**Short Description** [REQUIRED]
Always-on-top Picture-in-Picture AI assistant that floats over VS Code & desktop apps, connected to ChatGPT.
*(111 / 132 characters)*

**Detailed Description** [REQUIRED]
FloatBot AI is an interactive AI coding and productivity companion that stays permanently visible above your entire desktop workspace using Chrome Document Picture-in-Picture.

FLOAT OVER ANY APPLICATION
Work in VS Code, terminal windows, full-screen editors, or any desktop app without losing your AI assistant. FloatBot AI utilizes native OS-level window elevation (WS_EX_TOPMOST) so it never gets hidden when you click away.

ONE-CLICK SCREEN CAPTURE
Click the Screen button inside FloatBot AI to snap your current code editor, browser window, or error stack trace. Send visual context straight into ChatGPT with zero manual file saving or screenshot pasting.

DOCUMENT & CODE FILE ANALYSIS
Drag and drop or attach documents, source code files, PDFs, spreadsheets, and markdown notes directly into your chat. Instant file parsing lets you ask questions and get insights immediately.

MINIMIZE TO FLOATING CIRCLE
Need maximum screen real estate while coding? Click the minimize button to shrink FloatBot AI into a tiny, movable neon circle widget. Click it at any time to restore your full assistant.

SEAMLESS CHATGPT INTEGRATION
FloatBot AI connects directly to your existing, logged-in ChatGPT browser tab. Enjoy full GPT-4o capabilities, your custom instructions, and ChatGPT history without needing extra API keys or third-party subscriptions.

HOW TO USE IT:
1. Open ChatGPT in any Chrome tab and log in.
2. Click the FloatBot AI extension icon in your Chrome toolbar and click "Launch Floating Assistant".
3. FloatBot AI elevates into a floating window over your screen.
4. Snap your screen, drop code files, or type your prompt to get real-time answers while you work!

PRIVACY & SECURITY:
FloatBot AI is 100% private. Your prompts, code, and files communicate strictly between your local browser and your authenticated ChatGPT session. No telemetry, no third-party servers, and no tracking.

SUPPORT:
Questions, feedback, or bug reports? Reach out via our GitHub repository issues page.

**Category** [REQUIRED]
Productivity (Secondary: Developer Tools)

**Single Purpose** [REQUIRED]
Provides a persistent always-on-top Picture-in-Picture assistant interface for ChatGPT that remains visible over desktop applications and code editors.

**Primary Language** [REQUIRED]
English

---

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|---|---|---|---|
| Extension Icon (Toolbar) | 16×16 PNG | ✅ Ready | `icons/icon-16.png` |
| Extension Icon (Retina) | 32×32 PNG | ✅ Ready | `icons/icon-32.png` |
| Extension Icon (Management) | 48×48 PNG | ✅ Ready | `icons/icon-48.png` |
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | `icons/icon-128.png` |
| Hi-Res Icon (Promo/Web) | 512×512 PNG | ✅ Ready | `icons/icon-512.png` |
| Screenshot 1 [REQUIRED] | 1280×800 PNG | 🟡 Recommended | Floating over VS Code editor with active chat |
| Screenshot 2 [RECOMMENDED] | 1280×800 PNG | 🟡 Recommended | Screen capture & code inspection in action |
| Screenshot 3 [RECOMMENDED] | 1280×800 PNG | 🟡 Recommended | Document and code file attachment staging |
| Screenshot 4 | 1280×800 PNG | 🟡 Recommended | Minimized floating circle widget mode |
| Small Promo Tile [RECOMMENDED] | 440×280 PNG | ⬜ Optional | Neon branding with tagline |
| Marquee Promo Tile | 1400×560 PNG | ⬜ Optional | Wide banner showcasing floating UI |

---

## Permissions Justification

| Permission | Type | Justification |
|---|---|---|
| `tabs` | permissions | Used to locate your existing ChatGPT browser tab to send prompts and receive streamed answers, and to identify tabs when capturing screen media. |
| `storage` | permissions | Used locally on your machine to save your assistant window size preferences (width/height) and your light/dark theme preference. |
| `clipboardWrite` | permissions | Allows you to click 'Copy' on generated code blocks and assistant responses to quickly paste snippets into your editor. |
| `scripting` | permissions | Injects the lightweight ChatGPT bridge script into your active ChatGPT tab to automate sending prompts and reading streamed replies. |
| `https://chatgpt.com/*` | host_permissions | Allows direct communication with ChatGPT web pages to pass user prompts and retrieve streamed responses into the floating assistant. |
| `https://chat.openai.com/*` | host_permissions | Supports legacy ChatGPT domain URLs to ensure uninterrupted communication regardless of which domain the user has open. |

---

## Privacy & Data Use

### Data Collection
- **Personally Identifiable Information**: None collected.
- **Health / Financial Information**: None collected.
- **Authentication Information**: None collected. FloatBot AI relies on your existing browser login session; it never accesses, reads, or stores passwords or authentication cookies.
- **Personal Communications**: Transferred only between the user's browser and ChatGPT per user instruction; never stored or sent to any external server.
- **User Activity / Analytics**: Zero tracking, zero telemetry, zero analytics scripts.
- **Website Content**: Only reads responses from ChatGPT tabs to display them inside the floating assistant.

### Privacy Policy

```markdown
# Privacy Policy for FloatBot AI
Last Updated: 2026-10-15

FloatBot AI ("the Extension") is committed to protecting your privacy.

1. Information We Do Not Collect
FloatBot AI does not collect, transmit, sell, or store any personal information, browsing history, telemetry, or analytics data.

2. How Your Data Is Processed
- All prompts, screen captures, and document attachments are processed entirely locally on your device.
- Communication occurs strictly between your browser extension and your existing, authenticated ChatGPT session at chatgpt.com.
- No intermediary proxy servers, third-party databases, or external analytics services are used.

3. Local Storage Usage
The Extension uses Chrome's local storage API exclusively to store client-side user preferences (such as window size dimensions and light/dark theme toggle). This data never leaves your device.

4. Contact
For inquiries regarding this privacy policy, please open an issue on the official project repository.
```

---

## Version History

| Version | Date | Changes Summary |
|---|---|---|
| 1.0.0 | 2026-10-15 | **Official Production Release**: Complete Document Picture-in-Picture assistant with screen capture, document analysis, minimize widget, companion hub dashboard, light/dark themes, and official icon suite. |
| 0.8.0 | 2026-10-14 | Initial beta testing, Chromium Document PiP elevation, and ChatGPT content bridge streaming. |
