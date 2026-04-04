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

5. The extension icon appears in your toolbar — done

---

## How to Use

1. **Enable for a site** — Click the extension icon and toggle it **ON** for the current domain (e.g. youtube.com). The extension remembers this per site.

2. **Press `G`** on any page with a video. The frame grid appears below the video player.

3. **Click any thumbnail** to seek the video to that exact timestamp. It auto-plays from there.

4. **Press `G` again** to dismiss the grid.

### Changing the Interval

Open the extension popup and use the scroll wheel picker to set your preferred interval:

- **Left wheel** — number (1–60)
- **Right wheel** — unit (sec / min / hrs)

For example: `30 sec` captures a frame every 30 seconds, `5 min` captures every 5 minutes.

After changing the interval, click **Recalibrate Grid** to regenerate with the new setting.

### Grid Controls

- **✕** — close the grid
- **−** — minimize to header bar only (click **+** to expand)

---

## Compatibility

| Video Type | Works? | Notes |
|---|---|---|
| Standard `<video>` elements | ✅ | Full support |
| Blob URLs | ✅ | Common streaming method |
| HLS / DASH (no DRM) | ✅ | Still a `<video>` under the hood |
| YouTube | ✅ | SPA navigation detection included |
| Vimeo | ✅ | Works out of the box |
| DRM-protected (Netflix, Disney+, Prime, Hulu) | ❌ | Browser blocks canvas capture by design |

| Browser | Install Method |
|---|---|
| Firefox | [Mozilla Add-ons](https://addons.mozilla.org/en-US/firefox/addon/video-frame-grid/) |
| Chrome | Load unpacked → `chrome/` folder |
| Edge | Load unpacked → `chrome/` folder |

---

## Project Structure

```
video-frame-grid-browser-extension/
├── chrome/                # Chrome / Edge build (clean MV3, no warnings)
│   ├── manifest.json
│   ├── background.js
│   ├── content.js
│   ├── popup.html
│   ├── popup.js
│   ├── popup.css
│   └── icons/
│
├── firefox/               # Firefox build (with gecko ID + data collection declaration)
│   ├── manifest.json
│   ├── background.js
│   ├── content.js
│   ├── popup.html
│   ├── popup.js
│   ├── popup.css
│   └── icons/
│
├── LICENSE
└── README.md
```

The only difference between the two folders is `manifest.json`. Chrome's manifest is pure MV3. Firefox's includes `browser_specific_settings` with the gecko extension ID and data collection permissions that Mozilla requires.

---

## Privacy

- **No data collection** — everything runs locally
- **No network requests** — zero external calls
- **No analytics or tracking**
- **Stores only preferences** — enabled domains and interval, in local browser storage

---

## How It Works

1. Press `G` → extension finds the largest `<video>` element on the page
2. Calculates frame count from video duration ÷ your interval setting
3. Uses HTML5 Canvas to seek and capture each frame
4. Renders the grid directly into the page DOM below the video (not as a floating overlay)
5. Click a frame → sets `video.currentTime` and plays
6. Your original playback position is restored after capture

---

## License

[MIT](LICENSE)
