# Video Frame Grid

A browser extension that generates a **visual contact sheet** from any video on a webpage. Instantly preview an entire video as a grid of evenly-spaced frame thumbnails — click any frame to jump straight to that moment.

No more scrubbing through hours of content to find what you're looking for.

---

## Install

### Firefox

Install directly from Mozilla Add-ons:

**[→ Get Video Frame Grid on Firefox](https://addons.mozilla.org/en-US/firefox/addon/video-frame-grid/)**

### Chrome / Edge

1. **Download this repo**
   ```
   git clone https://github.com/Sumit-348/video-frame-grid-browser-extension.git
   ```
   Or click **Code → Download ZIP** and extract it.

2. **Open the extensions page**
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`

3. **Enable Developer Mode** (toggle in the top-right corner)

4. **Click "Load unpacked"** and select the **`chrome`** folder inside the repo

5. **Pin the extension** — click the puzzle piece in your toolbar and pin Video Frame Grid

---

## How to Use

### First time on a site

1. **Click the extension icon** to open the popup, then toggle the switch **on**. The icon turns purple to show it's active for this site.
2. The page **auto-reloads**.
3. The frame grid appears automatically next to the video.

### On enabled sites

Once enabled, the grid is fully automatic:

- **Navigating to a new video** — the grid regenerates automatically
- **Auto-play next video** — the grid regenerates automatically
- **Reloading the page** — the grid regenerates automatically

You don't need to click anything. The extension watches for video source changes and SPA navigations, then rebuilds the grid for the new video on its own.

If for some reason the grid doesn't appear (a slow-loading player, an unusual site layout), you can manually trigger it via:

- The **"Generate / Refresh Grid"** button in the popup
- The **keyboard shortcut** (default: `Alt+G`)

### Disabling for a site

Click the icon when it's purple to turn it off. The icon returns to grayscale.

---

## Two Views

The grid has two layouts. Use the **view toggle button** in the grid header (left of the minimize button) to switch between them. Your preference is remembered per site.

### Side view (default)
The grid sits to the **right of the video**, matching its height. Frames are stacked vertically, one per row, scrollable. Pushes the recommended videos sidebar down.

### Below view
The grid sits **directly below the video**, matching its width. Frames are arranged in **3 columns**. Pushes the title and description down.

---

## Settings

Right-click the extension icon and choose **Options** to access settings:

- **Frame interval** — iOS-style scroll wheel picker. Set any combination of 1–60 sec/min/hrs.
- **Recalibrate Grid** — appears after changing the interval; regenerates the grid with the new value.
- **Keyboard shortcut** — view your current shortcut and customize it.

### Customizing the keyboard shortcut

Click **Customize shortcut** in the Options panel. This opens your browser's extension shortcut settings page.

> **Important:** Avoid common video player shortcuts like `K`, `M`, `J`, `L`, `space`, `F`, `C`, or arrow keys. Browser extensions claim shortcuts globally, so binding any of these will hijack the player's controls. Use modifier combos like `Alt+G`, `Ctrl+Shift+V`, etc.

---

## Compatibility

| Video Type | Works? | Notes |
|---|---|---|
| Standard `<video>` elements | ✅ | Full support |
| Blob URLs | ✅ | Common streaming method |
| HLS / DASH (no DRM) | ✅ | Still a `<video>` under the hood |
| YouTube | ✅ | SPA navigation handled |
| Vimeo | ✅ | Works out of the box |
| DRM-protected (Netflix, Disney+, Prime, Hulu) | ❌ | Browser blocks canvas capture by design |

| Browser | Install Method |
|---|---|
| Firefox | [Mozilla Add-ons](https://addons.mozilla.org/en-US/firefox/addon/video-frame-grid/) |
| Chrome | Load unpacked → `chrome/` folder |
| Edge | Load unpacked → `chrome/` folder |

---

## What's New in 1.1.0

- **Click-to-toggle popup** — pin the extension and click the icon to open a popup with a clean toggle, interval picker, generate button, and shortcut display
- **Auto-trigger on enable** — page reloads and the grid generates automatically
- **Automatic grid regeneration** — when a new video starts playing (SPA navigation, autoplay next, or reload), the grid rebuilds automatically with no user interaction
- **Customizable keyboard shortcut** — replace the old hardcoded `G` key with anything you want (default `Alt+G`)
- **Two view modes** — side view (next to the video) or below view (3-column grid under the video), per-domain memory
- **Side view properly sized** — matches video height with scrollable frame list
- **More accurate frame capture** — uses `requestVideoFrameCallback` and duplicate detection to fix the "same frame repeating" bug
- **Cached frames across view switches** — toggling between side and below view no longer recaptures frames
- **Cleaner background service worker** — better state management across tabs

---

## Project Structure

```
video-frame-grid-browser-extension/
├── chrome/                # Chrome / Edge build
│   ├── manifest.json
│   ├── background.js
│   ├── content.js
│   ├── options.html
│   ├── options.js
│   ├── options.css
│   └── icons/             # Colored + grayscale variants
│
├── firefox/               # Firefox build (with gecko ID + data declaration)
│   └── (same files)
│
├── LICENSE
└── README.md
```

The only differences between the two folders are in `manifest.json`. Chrome's is pure MV3. Firefox's includes `browser_specific_settings` with the gecko extension ID and data collection permissions that Mozilla requires.

---

## Privacy

- **No data collection** — everything runs locally
- **No network requests** — zero external calls
- **No analytics or tracking**
- **Stores only preferences** — enabled domains, view preferences, and interval, in local browser storage

---

## How It Works

1. Click the icon → toggle on → background script saves the domain as enabled and reloads the tab
2. On reload, content script detects the saved domain → finds the largest `<video>` element on the page
3. Once the video has metadata, calculates frame count from duration ÷ your interval setting
4. Pauses video, uses HTML5 Canvas + `requestVideoFrameCallback` to seek and capture each frame accurately
5. Detects duplicate frames and re-captures if necessary
6. Renders the grid in either side view or below view based on your per-domain preference
7. Click a frame → sets `video.currentTime` and plays
8. Original playback position is restored after capture
9. **Watches for video source changes** — when you navigate to a new video, the grid auto-regenerates without any user action

---

## License

[MIT](LICENSE)
