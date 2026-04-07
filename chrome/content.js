/* content.js — Video Frame Grid v1.1.1 */

(() => {
  'use strict';

  const ext = globalThis.chrome || globalThis.browser;

  // ============================================
  // State
  // ============================================
  let isEnabled = false;
  let captureInterval = 30;
  let currentView = 'side'; // 'side' | 'below'
  let activeGrid = null;
  let cachedFrames = null; // { frames, video, interval } — survives view switches
  let autoTriggered = false;

  // ============================================
  // Init
  // ============================================
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

    try {
      const res = await ext.runtime.sendMessage({ type: 'GET_DOMAIN_VIEW', domain });
      currentView = res.view || 'side';
    } catch {}

    ext.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'DOMAIN_ENABLED') {
        isEnabled = true;
      }
      if (msg.type === 'DOMAIN_DISABLED') {
        isEnabled = false;
        if (activeGrid) destroyGrid();
        cachedFrames = null;
      }
      if (msg.type === 'REGENERATE_GRID') {
        regenerateNow();
      }
      if (msg.type === 'INTERVAL_CHANGED') {
        captureInterval = msg.interval;
      }
      if (msg.type === 'RECALIBRATE') {
        regenerateNow();
      }
    });

    if (isEnabled) {
      autoTriggerWhenReady();
    }

    watchUrlChanges();
  }

  async function regenerateNow() {
    if (activeGrid) destroyGrid();
    cachedFrames = null;
    const video = await waitForVideo(8000);
    if (video) generateGrid(video);
  }

  // ============================================
  // Auto-trigger
  // ============================================
  async function autoTriggerWhenReady() {
    if (autoTriggered) return;
    const video = await waitForVideo();
    if (!video) return;
    autoTriggered = true;
    generateGrid(video);
  }

  function waitForVideo(timeoutMs = 15000) {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        const v = findBestVideo();
        if (v && v.readyState >= 1 && v.duration && isFinite(v.duration) && v.duration > 0) {
          return resolve(v);
        }
        if (Date.now() - start > timeoutMs) return resolve(null);
        setTimeout(check, 300);
      };
      check();
    });
  }

  function watchUrlChanges() {
    let lastUrl = location.href;
    setInterval(async () => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        autoTriggered = false;
        if (activeGrid) destroyGrid();
        cachedFrames = null;
        // If extension is enabled on this domain, auto-regenerate for the new video
        if (isEnabled) {
          // Small delay to let the page transition settle
          setTimeout(() => autoTriggerWhenReady(), 800);
        }
      }
    }, 800);
  }

  function findBestVideo() {
    const videos = Array.from(document.querySelectorAll('video'));
    if (!videos.length) return null;
    let best = null;
    let bestArea = 0;
    for (const v of videos) {
      if (v.readyState < 1) continue;
      const rect = v.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > bestArea) { bestArea = area; best = v; }
    }
    return best || videos[0];
  }

  // ============================================
  // Insertion points
  // ============================================
  // For BELOW view: insert directly after video container in main column
  function findBelowInsertionPoint(video) {
    const hostname = location.hostname;

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
        if (el && el.parentElement) return { parent: el.parentElement, after: el };
      }
    }

    if (hostname.includes('vimeo.com')) {
      const pw = video.closest('.player_area, .player-area, [data-player]');
      if (pw && pw.parentElement) return { parent: pw.parentElement, after: pw };
    }

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
    const fp = video.parentElement;
    return { parent: fp?.parentElement || document.body, after: fp || video };
  }

  // For SIDE view: insert at top of the secondary/sidebar column so it pushes recommendations down
  function findSideInsertionPoint(video) {
    const hostname = location.hostname;

    if (hostname.includes('youtube.com')) {
      // YouTube secondary column
      const secondary = document.querySelector('#secondary-inner, #secondary, ytd-watch-next-secondary-results-renderer');
      if (secondary) {
        return { parent: secondary, prepend: true };
      }
    }

    // Generic: find sibling to the right of the video at a high enough level
    let candidate = video;
    for (let i = 0; i < 6; i++) {
      const parent = candidate.parentElement;
      if (!parent || parent === document.body) break;
      // Look for siblings that might be the sidebar
      const siblings = Array.from(parent.children).filter(c => c !== candidate);
      for (const sib of siblings) {
        const rect = sib.getBoundingClientRect();
        const vidRect = video.getBoundingClientRect();
        if (rect.left >= vidRect.right - 10 && rect.width > 200) {
          return { parent: sib, prepend: true };
        }
      }
      candidate = parent;
    }

    // Fallback: insert below
    return null;
  }

  // ============================================
  // Generate Grid (capture frames + render)
  // ============================================
  async function generateGrid(video) {
    if (!video || !video.duration || video.duration === Infinity) return;

    const duration = video.duration;
    const interval = captureInterval;
    const frameCount = Math.max(1, Math.floor(duration / interval));
    const maxFrames = Math.min(frameCount, 200);

    // Build the wrapper FIRST so user sees loading state
    const wrapper = buildWrapper(maxFrames, interval);
    await insertWrapper(video, wrapper);
    activeGrid = { video, wrapper, shadow: wrapper.shadowRoot, minimized: false };

    const grid = wrapper.shadowRoot.querySelector('.vfg-grid');
    const loading = wrapper.shadowRoot.querySelector('.vfg-loading');

    // Capture frames
    const frames = await captureFrames(video, loading, maxFrames, interval, duration);
    if (!activeGrid) return; // user closed during capture

    cachedFrames = { frames, video, interval };
    renderFrames(grid, frames, video);

    watchVideoSource(video);
    watchVideoResize(video, wrapper);
  }

  // Render-only path (no capture) — used by view switch
  async function renderFromCache(video) {
    if (!cachedFrames) return false;

    const { frames, interval } = cachedFrames;
    const wrapper = buildWrapper(frames.length, interval);
    await insertWrapper(video, wrapper);
    activeGrid = { video, wrapper, shadow: wrapper.shadowRoot, minimized: false };

    const grid = wrapper.shadowRoot.querySelector('.vfg-grid');
    const loading = wrapper.shadowRoot.querySelector('.vfg-loading');
    if (loading) loading.remove();

    renderFrames(grid, frames, video);
    watchVideoResize(video, wrapper);
    return true;
  }

  // ============================================
  // Build wrapper DOM
  // ============================================
  function buildWrapper(maxFrames, interval) {
    const wrapper = document.createElement('div');
    wrapper.id = 'vfg-wrapper';
    wrapper.dataset.view = currentView;

    const shadow = wrapper.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = getGridCSS();
    shadow.appendChild(style);

    const container = document.createElement('div');
    container.className = `vfg-container vfg-view-${currentView}`;
    shadow.appendChild(container);

    // Header
    const header = document.createElement('div');
    header.className = 'vfg-header';

    const title = document.createElement('span');
    title.className = 'vfg-title';
    title.textContent = `${maxFrames} frames @ ${formatTime(interval)}`;

    const controls = document.createElement('div');
    controls.className = 'vfg-controls';

    const viewBtn = document.createElement('button');
    viewBtn.className = 'vfg-btn vfg-view-toggle';
    viewBtn.title = currentView === 'side' ? 'Switch to below view' : 'Switch to side view';
    viewBtn.innerHTML = currentView === 'side' ? viewIconBelow() : viewIconSide();
    viewBtn.addEventListener('click', () => switchView());

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

    controls.appendChild(viewBtn);
    controls.appendChild(minimizeBtn);
    controls.appendChild(closeBtn);
    header.appendChild(title);
    header.appendChild(controls);
    container.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'vfg-grid';
    container.appendChild(grid);

    const loading = document.createElement('div');
    loading.className = 'vfg-loading';
    loading.textContent = 'Capturing frames...';
    grid.appendChild(loading);

    return wrapper;
  }

  // ============================================
  // Insert wrapper into the page
  // ============================================
  async function insertWrapper(video, wrapper) {
    if (currentView === 'side') {
      // Wait for sidebar to exist (YouTube renders it lazily on SPA navs)
      const sideInsertion = await waitForSideInsertion(video, 5000);
      if (sideInsertion) {
        if (sideInsertion.prepend) {
          sideInsertion.parent.insertBefore(wrapper, sideInsertion.parent.firstChild);
        } else {
          sideInsertion.parent.appendChild(wrapper);
        }
        applyVideoHeight(video, wrapper);
        return;
      }
      // Fallback: insert below
    }

    const belowInsertion = findBelowInsertionPoint(video);
    if (belowInsertion.after.nextSibling) {
      belowInsertion.parent.insertBefore(wrapper, belowInsertion.after.nextSibling);
    } else {
      belowInsertion.parent.appendChild(wrapper);
    }
  }

  function waitForSideInsertion(video, timeoutMs = 5000) {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        const found = findSideInsertionPoint(video);
        if (found) return resolve(found);
        if (Date.now() - start > timeoutMs) return resolve(null);
        setTimeout(check, 200);
      };
      check();
    });
  }

  // Match the side wrapper height to the video height
  function applyVideoHeight(video, wrapper) {
    if (currentView !== 'side') return;
    const rect = video.getBoundingClientRect();
    const h = Math.max(200, Math.round(rect.height));
    wrapper.style.setProperty('--vfg-side-max-height', `${h}px`);
    // Also set directly on the shadow DOM container for reliability
    const container = wrapper.shadowRoot?.querySelector('.vfg-container');
    if (container) {
      container.style.setProperty('--vfg-side-max-height', `${h}px`);
      container.style.height = `${h}px`;
      container.style.maxHeight = `${h}px`;
    }
  }

  // Track resizing of the video element so the side panel resizes with it
  let videoResizeObserver = null;
  function watchVideoResize(video, wrapper) {
    if (videoResizeObserver) {
      videoResizeObserver.disconnect();
      videoResizeObserver = null;
    }
    if (currentView !== 'side' || typeof ResizeObserver === 'undefined') return;
    videoResizeObserver = new ResizeObserver(() => {
      applyVideoHeight(video, wrapper);
    });
    videoResizeObserver.observe(video);
  }

  // ============================================
  // Render frames into grid
  // ============================================
  function renderFrames(grid, frames, video) {
    // Clear loading if still there
    const loading = grid.querySelector('.vfg-loading');
    if (loading) loading.remove();
    // Clear any existing cells
    grid.querySelectorAll('.vfg-cell').forEach(c => c.remove());

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
        const ph = document.createElement('div');
        ph.className = 'vfg-thumb-error';
        ph.textContent = '⚠';
        cell.appendChild(ph);
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

  // ============================================
  // Switch view — uses cache, no recapture
  // ============================================
  async function switchView() {
    if (!activeGrid) return;
    const video = activeGrid.video;

    currentView = currentView === 'side' ? 'below' : 'side';

    try {
      await ext.runtime.sendMessage({
        type: 'SET_DOMAIN_VIEW',
        domain: location.hostname,
        view: currentView
      });
    } catch {}

    // Destroy current grid (DOM only — keep cachedFrames intact)
    if (activeGrid) {
      activeGrid.wrapper.remove();
      activeGrid = null;
    }

    // Re-render from cache
    if (cachedFrames) {
      await renderFromCache(video);
    } else {
      generateGrid(video);
    }
  }

  // ============================================
  // Frame Capture
  // ============================================
  async function captureFrames(video, loading, frameCount, interval, duration) {
    const savedTime = video.currentTime;
    const wasPaused = video.paused;
    if (!wasPaused) { try { video.pause(); } catch {} }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const vw = video.videoWidth || 320;
    const vh = video.videoHeight || 180;
    const thumbWidth = 320;
    const thumbHeight = Math.round((vh / vw) * thumbWidth);
    canvas.width = thumbWidth;
    canvas.height = thumbHeight;

    const frames = [];
    let lastFrameHash = null;

    for (let i = 0; i < frameCount; i++) {
      if (!activeGrid) break;

      const timestamp = Math.min((i + 1) * interval, duration - 0.5);
      if (loading) loading.textContent = `Capturing frame ${i + 1} / ${frameCount}...`;

      try {
        await seekToAccurate(video, timestamp);
        ctx.drawImage(video, 0, 0, thumbWidth, thumbHeight);

        let hash = quickFrameHash(ctx, thumbWidth, thumbHeight);
        if (hash === lastFrameHash) {
          // Frame didn't update — wait and try once more
          await sleep(200);
          await waitForFrame(video);
          ctx.drawImage(video, 0, 0, thumbWidth, thumbHeight);
          hash = quickFrameHash(ctx, thumbWidth, thumbHeight);
        }
        lastFrameHash = hash;

        const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
        frames.push({ timestamp, dataUrl });
      } catch {
        frames.push({ timestamp, dataUrl: null });
      }
    }

    try {
      await seekToAccurate(video, savedTime);
      if (!wasPaused) video.play();
    } catch {}

    return frames;
  }

  function seekToAccurate(video, time) {
    return new Promise((resolve) => {
      let resolved = false;
      const finish = () => { if (!resolved) { resolved = true; resolve(); } };
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        waitForFrame(video).then(finish);
      };
      video.addEventListener('seeked', onSeeked);
      try { video.currentTime = time; } catch { finish(); }
      setTimeout(finish, 4000);
    });
  }

  function waitForFrame(video) {
    return new Promise((resolve) => {
      if (typeof video.requestVideoFrameCallback === 'function') {
        let done = false;
        video.requestVideoFrameCallback(() => {
          if (done) return;
          done = true;
          resolve();
        });
        setTimeout(() => { if (!done) { done = true; resolve(); } }, 500);
      } else {
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 80)));
      }
    });
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function quickFrameHash(ctx, w, h) {
    try {
      const samples = [];
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const px = ctx.getImageData(
            Math.floor((x + 0.5) * w / 4),
            Math.floor((y + 0.5) * h / 4),
            1, 1
          ).data;
          samples.push(px[0], px[1], px[2]);
        }
      }
      return samples.join(',');
    } catch {
      return Math.random().toString();
    }
  }

  // ============================================
  // Minimize / Destroy
  // ============================================
  function toggleMinimize() {
    if (!activeGrid) return;
    const grid = activeGrid.shadow.querySelector('.vfg-grid');
    const btn = activeGrid.shadow.querySelector('.vfg-minimize');
    if (!grid || !btn) return;

    activeGrid.minimized = !activeGrid.minimized;
    if (activeGrid.minimized) {
      grid.style.display = 'none';
      btn.textContent = '+';
    } else {
      grid.style.display = '';
      btn.textContent = '−';
    }
  }

  function destroyGrid() {
    if (!activeGrid) return;
    activeGrid.wrapper.remove();
    activeGrid = null;
    if (sourceObserver) {
      sourceObserver.disconnect();
      sourceObserver = null;
    }
    if (videoResizeObserver) {
      videoResizeObserver.disconnect();
      videoResizeObserver = null;
    }
  }

  // ============================================
  // Source watcher — auto-regenerate on source change
  // ============================================
  let sourceObserver = null;
  let lastWatchedSrc = null;
  let regenDebounce = null;

  function watchVideoSource(video) {
    if (sourceObserver) sourceObserver.disconnect();
    lastWatchedSrc = video.currentSrc || video.src;

    const onSrcChange = () => {
      const newSrc = video.currentSrc || video.src;
      if (!newSrc || newSrc === lastWatchedSrc) return;
      lastWatchedSrc = newSrc;

      // Debounce — multiple mutations may fire as the player swaps streams
      clearTimeout(regenDebounce);
      regenDebounce = setTimeout(async () => {
        if (!isEnabled) return;
        // Wait until the new video is actually ready
        const v = await waitForVideoReady(video, 10000);
        if (!v) return;
        if (activeGrid) destroyGrid();
        cachedFrames = null;
        autoTriggered = true;
        generateGrid(v);
      }, 600);
    };

    sourceObserver = new MutationObserver(onSrcChange);
    sourceObserver.observe(video, { attributes: true, attributeFilter: ['src'] });

    // Also listen for loadedmetadata in case attributes don't change but the stream does
    video.addEventListener('loadedmetadata', onSrcChange);
  }

  // Wait for an existing video element to become ready (after a source swap)
  function waitForVideoReady(video, timeoutMs = 10000) {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        if (video.readyState >= 1 && video.duration && isFinite(video.duration) && video.duration > 0) {
          return resolve(video);
        }
        if (Date.now() - start > timeoutMs) return resolve(null);
        setTimeout(check, 250);
      };
      check();
    });
  }

  // ============================================
  // Helpers
  // ============================================
  function formatTime(seconds) {
    const s = Math.floor(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
    return `${m}:${String(sec).padStart(2,'0')}`;
  }

  function viewIconSide() {
    return `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
      <rect x="1" y="2" width="9" height="12" rx="1"/>
      <rect x="11.5" y="2" width="3.5" height="12" rx="0.5"/>
    </svg>`;
  }

  function viewIconBelow() {
    return `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
      <rect x="2" y="1" width="12" height="8" rx="1"/>
      <rect x="2" y="10.5" width="12" height="4.5" rx="0.5"/>
    </svg>`;
  }

  function getGridCSS() {
    return `
      :host {
        all: initial;
        display: block !important;
        width: 100% !important;
      }

      .vfg-container {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: #111;
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 10px;
        overflow: hidden;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      }

      .vfg-container.vfg-view-side {
        display: flex;
        flex-direction: column;
        height: var(--vfg-side-max-height, 80vh);
        max-height: var(--vfg-side-max-height, 80vh);
      }

      .vfg-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        background: #1a1a2e;
        border-bottom: 1px solid rgba(255,255,255,0.06);
        user-select: none;
        flex-shrink: 0;
      }

      .vfg-title {
        color: #999;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.03em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .vfg-controls {
        display: flex;
        gap: 5px;
        flex-shrink: 0;
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
        transition: background 0.15s, color 0.15s;
        padding: 0;
        background: rgba(255,255,255,0.08);
        color: #aaa;
      }
      .vfg-btn:hover { background: rgba(255,255,255,0.18); color: #fff; }
      .vfg-view-toggle:hover { background: rgba(108, 92, 231, 0.3); color: #a29bfe; }
      .vfg-close { background: rgba(255, 70, 70, 0.15); color: #ff6b6b; }
      .vfg-close:hover { background: rgba(255, 70, 70, 0.3); color: #fff; }

      /* SIDE VIEW: 1 col, scrollable */
      .vfg-view-side .vfg-grid {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 8px;
        background: #0a0a0a;
        overflow-y: auto;
        flex: 1;
        min-height: 0;
      }
      .vfg-view-side .vfg-grid::-webkit-scrollbar { width: 8px; }
      .vfg-view-side .vfg-grid::-webkit-scrollbar-track { background: rgba(255,255,255,0.03); }
      .vfg-view-side .vfg-grid::-webkit-scrollbar-thumb {
        background: rgba(255,255,255,0.18);
        border-radius: 4px;
      }
      .vfg-view-side .vfg-grid::-webkit-scrollbar-thumb:hover {
        background: rgba(255,255,255,0.28);
      }

      .vfg-view-side .vfg-cell {
        flex-shrink: 0;
      }

      /* BELOW VIEW: 3 cols */
      .vfg-view-below .vfg-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 4px;
        padding: 6px;
        background: #0a0a0a;
      }

      .vfg-cell {
        position: relative;
        overflow: hidden;
        cursor: pointer;
        background: #1a1a1a;
        border-radius: 4px;
        transition: outline 0.1s;
      }
      .vfg-cell:hover {
        outline: 2px solid rgba(108, 92, 231, 0.7);
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
        font-size: 14px;
        font-weight: 700;
      }

      .vfg-timestamp {
        position: absolute;
        bottom: 4px;
        left: 4px;
        background: rgba(0,0,0,0.85);
        color: #fff;
        font-size: 10px;
        font-weight: 700;
        padding: 2px 6px;
        border-radius: 3px;
        font-variant-numeric: tabular-nums;
        pointer-events: none;
      }

      .vfg-loading {
        text-align: center;
        padding: 30px 12px;
        color: #555;
        font-size: 12px;
        grid-column: 1 / -1;
      }
    `;
  }

  init();
})();
