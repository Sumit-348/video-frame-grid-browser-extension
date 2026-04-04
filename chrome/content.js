/* content.js — Video Frame Grid — Main content script */

(() => {
  'use strict';

  const ext = globalThis.chrome || globalThis.browser;

  // --- State ---
  let isEnabled = false;
  let captureInterval = 30;
  let activeGrid = null;

  // --- Init ---
  async function init() {
    const domain = location.hostname;
    try {
      const res = await ext.runtime.sendMessage({ type: 'GET_DOMAIN_STATUS', domain });
      isEnabled = res.enabled;
    } catch { isEnabled = false; }

    try {
      const res = await ext.runtime.sendMessage({ type: 'GET_INTERVAL' });
      captureInterval = res.interval || 30;
    } catch {}

    document.addEventListener('keydown', onKeyDown);

    ext.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'DOMAIN_STATUS_CHANGED') {
        isEnabled = msg.enabled;
        if (!isEnabled && activeGrid) destroyGrid();
      }
      if (msg.type === 'INTERVAL_CHANGED') {
        captureInterval = msg.interval;
      }
      if (msg.type === 'RECALIBRATE') {
        if (activeGrid) {
          const video = activeGrid.video;
          destroyGrid();
          generateGrid(video);
        }
      }
    });
  }

  // --- Keyboard Trigger ---
  function onKeyDown(e) {
    if (!isEnabled) return;
    if (e.key !== 'g' && e.key !== 'G') return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;

    e.preventDefault();

    if (activeGrid) {
      destroyGrid();
      return;
    }

    const video = findBestVideo();
    if (!video) return;

    generateGrid(video);
  }

  // --- Find the most prominent video ---
  function findBestVideo() {
    const videos = Array.from(document.querySelectorAll('video'));
    if (videos.length === 0) return null;

    let best = null;
    let bestArea = 0;
    for (const v of videos) {
      if (v.readyState < 1) continue;
      const rect = v.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > bestArea) {
        bestArea = area;
        best = v;
      }
    }
    return best || videos[0];
  }

  // --- Find insertion point: insert INTO page flow, below the video's container ---
  function findInsertionPoint(video) {
    const hostname = location.hostname;

    // YouTube-specific: insert below the player
    if (hostname.includes('youtube.com')) {
      const targets = [
        '#player-container-outer',
        '#player-container-inner',
        '#player',
        'ytd-player',
        '#movie_player'
      ];
      for (const sel of targets) {
        const el = document.querySelector(sel);
        if (el && el.parentElement) {
          return { parent: el.parentElement, after: el };
        }
      }
    }

    // Vimeo
    if (hostname.includes('vimeo.com')) {
      const pw = video.closest('.player_area, .player-area, [data-player]');
      if (pw && pw.parentElement) {
        return { parent: pw.parentElement, after: pw };
      }
    }

    // Generic: walk up from video to find a wide block container
    let candidate = video;
    for (let i = 0; i < 8; i++) {
      const parent = candidate.parentElement;
      if (!parent || parent === document.body) break;

      const width = parent.getBoundingClientRect().width;
      const display = getComputedStyle(parent).display;

      if (width >= 400 && (display === 'block' || display === 'flex' || display === 'grid')) {
        return { parent: parent.parentElement || document.body, after: parent };
      }
      candidate = parent;
    }

    // Fallback
    const fp = video.parentElement;
    return { parent: fp?.parentElement || document.body, after: fp || video };
  }

  // --- Calculate column count based on total frames ---
  function calculateColumns(frameCount) {
    if (frameCount <= 3) return frameCount;
    if (frameCount <= 6) return 3;
    if (frameCount <= 12) return 4;
    if (frameCount <= 20) return 5;
    if (frameCount <= 35) return 6;
    if (frameCount <= 56) return 7;
    return 8;
  }

  // --- Generate Grid ---
  async function generateGrid(video) {
    if (!video || !video.duration || video.duration === Infinity) return;

    const duration = video.duration;
    const interval = captureInterval;
    const frameCount = Math.max(1, Math.floor(duration / interval));
    const maxFrames = Math.min(frameCount, 200);
    const cols = calculateColumns(maxFrames);

    // Wrapper inserted into page flow
    const wrapper = document.createElement('div');
    wrapper.id = 'vfg-wrapper';

    const shadow = wrapper.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = getGridCSS(cols);
    shadow.appendChild(style);

    const container = document.createElement('div');
    container.className = 'vfg-container';
    shadow.appendChild(container);

    // Header
    const header = document.createElement('div');
    header.className = 'vfg-header';

    const title = document.createElement('span');
    title.className = 'vfg-title';
    title.textContent = `Frame Grid — ${maxFrames} frames @ ${formatTime(interval)} interval`;

    const controls = document.createElement('div');
    controls.className = 'vfg-controls';

    const minimizeBtn = document.createElement('button');
    minimizeBtn.className = 'vfg-btn vfg-minimize';
    minimizeBtn.textContent = '−';
    minimizeBtn.title = 'Minimize';
    minimizeBtn.addEventListener('click', () => toggleMinimize());

    const closeBtn = document.createElement('button');
    closeBtn.className = 'vfg-btn vfg-close';
    closeBtn.textContent = '✕';
    closeBtn.title = 'Close';
    closeBtn.addEventListener('click', () => destroyGrid());

    controls.appendChild(minimizeBtn);
    controls.appendChild(closeBtn);
    header.appendChild(title);
    header.appendChild(controls);
    container.appendChild(header);

    // Grid
    const grid = document.createElement('div');
    grid.className = 'vfg-grid';
    container.appendChild(grid);

    // Loading
    const loading = document.createElement('div');
    loading.className = 'vfg-loading';
    loading.textContent = 'Capturing frames...';
    grid.appendChild(loading);

    // Insert into page flow (below video container, pushing content down)
    const insertion = findInsertionPoint(video);
    if (insertion.after.nextSibling) {
      insertion.parent.insertBefore(wrapper, insertion.after.nextSibling);
    } else {
      insertion.parent.appendChild(wrapper);
    }

    activeGrid = { video, wrapper, shadow, minimized: false };

    // Capture frames
    await captureFrames(video, grid, loading, maxFrames, interval, duration);

    // Watch for source changes
    watchVideoSource(video);
  }

  // --- Frame Capture ---
  async function captureFrames(video, grid, loading, frameCount, interval, duration) {
    const savedTime = video.currentTime;
    const wasPaused = video.paused;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    const vw = video.videoWidth || video.clientWidth || 320;
    const vh = video.videoHeight || video.clientHeight || 180;
    const thumbWidth = 320;
    const thumbHeight = Math.round((vh / vw) * thumbWidth);
    canvas.width = thumbWidth;
    canvas.height = thumbHeight;

    const frames = [];

    for (let i = 0; i < frameCount; i++) {
      if (!activeGrid) break;

      const timestamp = Math.min((i + 1) * interval, duration - 0.1);
      loading.textContent = `Capturing frame ${i + 1} / ${frameCount}...`;

      try {
        await seekTo(video, timestamp);
        ctx.drawImage(video, 0, 0, thumbWidth, thumbHeight);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        frames.push({ timestamp, dataUrl });
      } catch {
        frames.push({ timestamp, dataUrl: null });
      }
    }

    // Restore
    try {
      await seekTo(video, savedTime);
      if (!wasPaused) video.play();
    } catch {}

    loading.remove();

    // Render thumbnails
    for (const frame of frames) {
      const cell = document.createElement('div');
      cell.className = 'vfg-cell';

      if (frame.dataUrl) {
        const img = document.createElement('img');
        img.src = frame.dataUrl;
        img.className = 'vfg-thumb';
        img.draggable = false;
        cell.appendChild(img);
      } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'vfg-thumb-error';
        placeholder.textContent = '⚠ DRM';
        cell.appendChild(placeholder);
      }

      const label = document.createElement('span');
      label.className = 'vfg-timestamp';
      label.textContent = formatTime(frame.timestamp);
      cell.appendChild(label);

      cell.addEventListener('click', () => {
        video.currentTime = frame.timestamp;
        video.play();
        video.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });

      grid.appendChild(cell);
    }
  }

  function seekTo(video, time) {
    return new Promise((resolve) => {
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        setTimeout(resolve, 50);
      };
      video.addEventListener('seeked', onSeeked);
      video.currentTime = time;
      setTimeout(() => {
        video.removeEventListener('seeked', onSeeked);
        resolve();
      }, 3000);
    });
  }

  // --- Minimize / Restore ---
  function toggleMinimize() {
    if (!activeGrid) return;
    const grid = activeGrid.shadow.querySelector('.vfg-grid');
    const btn = activeGrid.shadow.querySelector('.vfg-minimize');
    if (!grid || !btn) return;

    activeGrid.minimized = !activeGrid.minimized;
    if (activeGrid.minimized) {
      grid.style.display = 'none';
      btn.textContent = '+';
      btn.title = 'Expand';
    } else {
      grid.style.display = '';
      btn.textContent = '−';
      btn.title = 'Minimize';
    }
  }

  // --- Destroy ---
  function destroyGrid() {
    if (!activeGrid) return;
    activeGrid.wrapper.remove();
    activeGrid = null;
    if (sourceObserver) {
      sourceObserver.disconnect();
      sourceObserver = null;
    }
  }

  // --- Video Source Change Detection ---
  let sourceObserver = null;

  function watchVideoSource(video) {
    if (sourceObserver) sourceObserver.disconnect();

    let lastSrc = video.currentSrc || video.src;

    sourceObserver = new MutationObserver(() => {
      const newSrc = video.currentSrc || video.src;
      if (newSrc && newSrc !== lastSrc) {
        lastSrc = newSrc;
        const onLoaded = () => {
          video.removeEventListener('loadedmetadata', onLoaded);
          if (activeGrid) {
            destroyGrid();
            generateGrid(video);
          }
        };
        video.addEventListener('loadedmetadata', onLoaded);
      }
    });

    sourceObserver.observe(video, { attributes: true, attributeFilter: ['src'] });

    for (const source of video.querySelectorAll('source')) {
      sourceObserver.observe(source, { attributes: true, attributeFilter: ['src'] });
    }

    // SPA navigation (YouTube)
    let lastUrl = location.href;
    const urlCheck = setInterval(() => {
      if (!activeGrid) { clearInterval(urlCheck); return; }
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        setTimeout(() => {
          const newVideo = findBestVideo();
          if (newVideo && newVideo !== activeGrid?.video) {
            destroyGrid();
            if (newVideo.readyState >= 1) {
              generateGrid(newVideo);
            } else {
              newVideo.addEventListener('loadedmetadata', () => generateGrid(newVideo), { once: true });
            }
          }
        }, 1500);
      }
    }, 1000);
  }

  // --- Helpers ---
  function formatTime(seconds) {
    const s = Math.floor(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  // --- CSS (columns are passed in dynamically) ---
  function getGridCSS(cols) {
    return `
      :host {
        all: initial;
        display: block !important;
        width: 100% !important;
        margin: 16px 0 !important;
      }

      .vfg-container {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        background: #111;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        overflow: hidden;
      }

      .vfg-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 14px;
        background: #1a1a2e;
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        user-select: none;
      }

      .vfg-title {
        color: #999;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.04em;
      }

      .vfg-controls {
        display: flex;
        gap: 6px;
      }

      .vfg-btn {
        width: 24px;
        height: 24px;
        border: none;
        border-radius: 5px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.15s;
        padding: 0;
      }

      .vfg-minimize {
        background: rgba(255, 255, 255, 0.08);
        color: #aaa;
      }
      .vfg-minimize:hover { background: rgba(255, 255, 255, 0.15); }

      .vfg-close {
        background: rgba(255, 70, 70, 0.15);
        color: #ff6b6b;
      }
      .vfg-close:hover { background: rgba(255, 70, 70, 0.3); }

      .vfg-grid {
        display: grid;
        grid-template-columns: repeat(${cols}, 1fr);
        gap: 3px;
        padding: 6px;
        background: #0a0a0a;
      }

      .vfg-cell {
        position: relative;
        overflow: hidden;
        cursor: pointer;
        background: #1a1a1a;
        border-radius: 3px;
        transition: outline 0.1s;
      }
      .vfg-cell:hover {
        outline: 2px solid rgba(108, 92, 231, 0.6);
        outline-offset: -1px;
        z-index: 2;
      }

      .vfg-thumb {
        width: 100%;
        display: block;
        aspect-ratio: 16 / 9;
        object-fit: cover;
      }

      .vfg-thumb-error {
        width: 100%;
        aspect-ratio: 16 / 9;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #2a1a1a;
        color: #ff6b6b;
        font-size: 10px;
        font-weight: 600;
      }

      .vfg-timestamp {
        position: absolute;
        bottom: 2px;
        left: 2px;
        background: rgba(0, 0, 0, 0.8);
        color: #fff;
        font-size: 9px;
        font-weight: 700;
        padding: 1px 4px;
        border-radius: 2px;
        font-variant-numeric: tabular-nums;
        pointer-events: none;
        letter-spacing: 0.02em;
      }

      .vfg-loading {
        grid-column: 1 / -1;
        text-align: center;
        padding: 40px 16px;
        color: #555;
        font-size: 13px;
      }
    `;
  }

  // --- Boot ---
  init();
})();
