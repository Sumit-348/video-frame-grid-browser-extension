/* content.js — Video Frame Grid v1.2.0 */

(() => {
  'use strict';

  const ext = globalThis.chrome || globalThis.browser;

  // ============================================
  // State
  // ============================================
  let isEnabled = false;
  let captureInterval = 30;
  let currentView = 'side'; // 'side' | 'below' | 'float' — session-only, not persisted
  let activeGrid = null;
  let cachedFrames = null;
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

    // View is no longer persisted per-domain. Always start with 'side'.
    currentView = 'side';

    ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
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
      if (msg.type === 'SET_VIEW') {
        setView(msg.view);
      }
      if (msg.type === 'GET_CURRENT_VIEW') {
        sendResponse({ view: activeGrid ? currentView : null, hasGrid: !!activeGrid });
        return false;
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
    currentView = 'side'; // reset to default each generation
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
        if (v && isUsableVideo(v)) {
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
        if (isEnabled) {
          setTimeout(() => autoTriggerWhenReady(), 800);
        }
      }
    }, 800);
  }

  // ============================================
  // Video detection — smarter
  // ============================================
  function isVideoVisible(v) {
    if (!v) return false;
    const cs = getComputedStyle(v);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) {
      return false;
    }
    const rect = v.getBoundingClientRect();
    if (rect.width < 100 || rect.height < 60) return false;
    return true;
  }

  function isUsableVideo(v) {
    if (!v) return false;
    if (!isVideoVisible(v)) return false;
    if (v.readyState < 1) return false;
    if (!v.duration || !isFinite(v.duration) || v.duration <= 0) return false;
    return true;
  }

  function findBestVideo() {
    const videos = Array.from(document.querySelectorAll('video'));
    if (!videos.length) return null;

    // Filter to visible videos with metadata loaded
    const candidates = videos.filter(v => isVideoVisible(v) && v.readyState >= 1);
    if (candidates.length === 0) {
      // Nothing usable yet — return null so caller can keep waiting
      return null;
    }

    // Pick the largest visible one
    let best = null;
    let bestArea = 0;
    for (const v of candidates) {
      const rect = v.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > bestArea) { bestArea = area; best = v; }
    }
    return best;
  }

  // ============================================
  // Insertion strategy
  // ============================================

  // Try to find a sidebar (an element to the right of the video)
  // Returns { container, insertionMode } or null
  function findSidebar(video) {
    const hostname = location.hostname;
    const videoRect = video.getBoundingClientRect();
    const viewportW = document.documentElement.clientWidth;

    // Hard requirement: video must not span full width
    // If video right edge is within 50px of viewport, no room for sidebar
    if (viewportW - videoRect.right < 200) return null;

    // YouTube — explicit
    if (hostname.includes('youtube.com')) {
      const yt = document.querySelector('#secondary-inner, #secondary, ytd-watch-next-secondary-results-renderer');
      if (yt && yt.getBoundingClientRect().width > 200) {
        return { container: yt, mode: 'prepend' };
      }
    }

    // Generic: walk up from the video and look for sibling elements that are
    // (a) to the right of the video, (b) wide enough to host a sidebar
    let cur = video;
    for (let depth = 0; depth < 14; depth++) {
      const parent = cur.parentElement;
      if (!parent || parent === document.body || parent === document.documentElement) break;

      const siblings = Array.from(parent.children);
      for (const sib of siblings) {
        if (sib === cur) continue;
        if (sib.contains(video)) continue;

        const r = sib.getBoundingClientRect();
        // Must be visibly to the right and have real dimensions
        if (r.left >= videoRect.right - 30 && r.width >= 200 && r.height >= 200) {
          // Check it's actually visible
          const cs = getComputedStyle(sib);
          if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          return { container: sib, mode: 'prepend' };
        }
      }
      cur = parent;
    }

    return null;
  }

  // Try to find a "below" insertion point — somewhere we can insert
  // between the video container and the next content block
  function findBelowInsertionPoint(video) {
    const hostname = location.hostname;

    // YouTube — explicit
    if (hostname.includes('youtube.com')) {
      const targets = ['#player-container-outer', '#player-container-inner', '#player', 'ytd-player', '#movie_player'];
      for (const sel of targets) {
        const el = document.querySelector(sel);
        if (el && el.parentElement) return { parent: el.parentElement, after: el };
      }
    }

    // Vimeo — explicit
    if (hostname.includes('vimeo.com')) {
      const pw = video.closest('.player_area, .player-area, [data-player]');
      if (pw && pw.parentElement) return { parent: pw.parentElement, after: pw };
    }

    // Generic: walk up the ancestor chain. The KEY insight is that the player
    // wrapper has both WIDTH and HEIGHT close to the video. We exit the player
    // wrapper when EITHER:
    //   (a) width grows substantially (>1.3x) — multi-column layouts
    //   (b) height grows substantially (>2.5x) — single-column layouts
    const videoRect = video.getBoundingClientRect();
    const videoWidth = videoRect.width;
    const videoHeight = videoRect.height;
    let cur = video;
    let topPlayerWrapper = null;

    for (let depth = 0; depth < 14; depth++) {
      const parent = cur.parentElement;
      if (!parent || parent === document.body || parent === document.documentElement) break;

      const r = parent.getBoundingClientRect();
      const cs = getComputedStyle(parent);

      // Skip degenerate parents
      if (r.width < 100 || r.height < 60) {
        cur = parent;
        continue;
      }
      if (cs.display === 'none' || cs.visibility === 'hidden') {
        cur = parent;
        continue;
      }

      // Skip absolutely positioned wrappers — they're not in normal flow
      if (cs.position === 'absolute' || cs.position === 'fixed') {
        cur = parent;
        continue;
      }

      const widerThanVideo = r.width > videoWidth * 1.3;
      const muchTallerThanVideo = r.height > videoHeight * 2.5;

      // Exit condition: this parent is clearly page content, not the player wrapper
      if (widerThanVideo || muchTallerThanVideo) {
        if (topPlayerWrapper && topPlayerWrapper.parentElement) {
          return { parent: topPlayerWrapper.parentElement, after: topPlayerWrapper };
        }
        // No player wrapper tracked yet — insert after the current child of this parent
        return { parent: parent, after: cur };
      }

      // Still inside the player area
      topPlayerWrapper = parent;
      cur = parent;
    }

    // Walked all the way up without finding a clear page-content boundary.
    // Insert after the deepest player wrapper we found.
    if (topPlayerWrapper && topPlayerWrapper.parentElement) {
      return { parent: topPlayerWrapper.parentElement, after: topPlayerWrapper };
    }

    // Last resort: video's immediate parent
    const fp = video.parentElement;
    if (fp && fp.parentElement) {
      return { parent: fp.parentElement, after: fp };
    }
    return null;
  }

  // ============================================
  // Generate Grid
  // ============================================
  async function generateGrid(video) {
    if (!video || !video.duration || video.duration === Infinity) return;

    const duration = video.duration;
    const interval = captureInterval;
    const frameCount = Math.max(1, Math.floor(duration / interval));
    const maxFrames = Math.min(frameCount, 200);

    // Determine which view to use BEFORE building the wrapper
    currentView = pickInitialView(video);

    const wrapper = buildWrapper(maxFrames, interval);
    await insertWrapper(video, wrapper);
    activeGrid = { video, wrapper, shadow: wrapper.shadowRoot, minimized: false };

    const grid = wrapper.shadowRoot.querySelector('.vfg-grid');
    const loading = wrapper.shadowRoot.querySelector('.vfg-loading');

    const frames = await captureFrames(video, loading, maxFrames, interval, duration);
    if (!activeGrid) return;

    cachedFrames = { frames, video, interval };
    renderFrames(grid, frames, video);

    watchVideoSource(video);
    if (currentView === 'side') watchVideoResize(video, wrapper);
  }

  // Decide which view to use based on what's actually possible on this page
  function pickInitialView(video) {
    const sidebar = findSidebar(video);
    if (sidebar) return 'side';

    const below = findBelowInsertionPoint(video);
    if (below) return 'below';

    return 'float';
  }

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
    if (currentView === 'side') watchVideoResize(video, wrapper);
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
    viewBtn.title = 'Switch view';
    viewBtn.appendChild(buildViewIcon(currentView));
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

    // Make floating mode draggable via header
    if (currentView === 'float') {
      makeDraggable(wrapper, header);
    }

    return wrapper;
  }

  // ============================================
  // Drag-to-move support for floating mode
  // ============================================
  function makeDraggable(wrapper, dragHandle) {
    let dragging = false;
    let startX = 0, startY = 0;
    let origLeft = 0, origTop = 0;

    dragHandle.style.cursor = 'move';

    dragHandle.addEventListener('mousedown', (e) => {
      // Don't start drag if clicking a button
      if (e.target.closest('.vfg-btn')) return;
      dragging = true;
      const r = wrapper.getBoundingClientRect();
      origLeft = r.left;
      origTop = r.top;
      startX = e.clientX;
      startY = e.clientY;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const newLeft = Math.max(0, Math.min(window.innerWidth - 100, origLeft + dx));
      const newTop = Math.max(0, Math.min(window.innerHeight - 50, origTop + dy));
      wrapper.style.left = newLeft + 'px';
      wrapper.style.top = newTop + 'px';
      wrapper.style.right = 'auto';
      wrapper.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => {
      dragging = false;
    });
  }

  // ============================================
  // Insert wrapper
  // ============================================
  async function insertWrapper(video, wrapper) {
    if (currentView === 'side') {
      // Wait briefly for sidebar to materialize (some sites lazy-load)
      const sidebar = await waitForSidebar(video, 3000);
      if (sidebar) {
        if (sidebar.mode === 'prepend') {
          sidebar.container.insertBefore(wrapper, sidebar.container.firstChild);
        } else {
          sidebar.container.appendChild(wrapper);
        }
        applyVideoHeight(video, wrapper);
        return;
      }
      // Sidebar disappeared between pickInitialView and now — fall back
      currentView = 'below';
      updateContainerView(wrapper);
    }

    if (currentView === 'below') {
      const insertion = findBelowInsertionPoint(video);
      if (insertion && insertion.parent) {
        if (insertion.after && insertion.after.nextSibling) {
          insertion.parent.insertBefore(wrapper, insertion.after.nextSibling);
        } else {
          insertion.parent.appendChild(wrapper);
        }
        return;
      }
      // Fall through to float
      currentView = 'float';
      updateContainerView(wrapper);
    }

    // Float mode: append to body with fixed positioning
    document.body.appendChild(wrapper);
    // Default position: top-right
    wrapper.style.top = '60px';
    wrapper.style.right = '20px';
    wrapper.style.left = 'auto';
  }

  function updateContainerView(wrapper) {
    const container = wrapper.shadowRoot?.querySelector('.vfg-container');
    if (!container) return;
    container.classList.remove('vfg-view-side', 'vfg-view-below', 'vfg-view-float');
    container.classList.add(`vfg-view-${currentView}`);
    wrapper.dataset.view = currentView;
  }

  function waitForSidebar(video, timeoutMs = 3000) {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        const found = findSidebar(video);
        if (found) return resolve(found);
        if (Date.now() - start > timeoutMs) return resolve(null);
        setTimeout(check, 200);
      };
      check();
    });
  }

  function applyVideoHeight(video, wrapper) {
    if (currentView !== 'side') return;
    const rect = video.getBoundingClientRect();
    const h = Math.max(200, Math.round(rect.height));
    wrapper.style.setProperty('--vfg-side-max-height', `${h}px`);
    const container = wrapper.shadowRoot?.querySelector('.vfg-container');
    if (container) {
      container.style.setProperty('--vfg-side-max-height', `${h}px`);
      container.style.height = `${h}px`;
      container.style.maxHeight = `${h}px`;
    }
  }

  let videoResizeObserver = null;
  function watchVideoResize(video, wrapper) {
    if (videoResizeObserver) {
      videoResizeObserver.disconnect();
      videoResizeObserver = null;
    }
    if (currentView !== 'side' || typeof ResizeObserver === 'undefined') return;
    videoResizeObserver = new ResizeObserver(() => applyVideoHeight(video, wrapper));
    videoResizeObserver.observe(video);
  }

  // ============================================
  // Render frames
  // ============================================
  function renderFrames(grid, frames, video) {
    const loading = grid.querySelector('.vfg-loading');
    if (loading) loading.remove();
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
  // Switch view — cycles through all three views
  // ============================================
  async function switchView() {
    if (!activeGrid) return;
    const video = activeGrid.video;

    // Cycle: side -> below -> float -> side
    const next = { side: 'below', below: 'float', float: 'side' };
    currentView = next[currentView] || 'side';

    // Tear down current
    if (videoResizeObserver) {
      videoResizeObserver.disconnect();
      videoResizeObserver = null;
    }
    activeGrid.wrapper.remove();
    activeGrid = null;

    if (cachedFrames) {
      await renderFromCache(video);
    } else {
      generateGrid(video);
    }
  }

  // ============================================
  // Set view to specific value (from popup)
  // ============================================
  async function setView(view) {
    if (!activeGrid) return;
    if (view !== 'side' && view !== 'below' && view !== 'float') return;
    if (view === currentView) return;

    const video = activeGrid.video;
    currentView = view;

    if (videoResizeObserver) {
      videoResizeObserver.disconnect();
      videoResizeObserver = null;
    }
    activeGrid.wrapper.remove();
    activeGrid = null;

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
  // Source watcher
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

      clearTimeout(regenDebounce);
      regenDebounce = setTimeout(async () => {
        if (!isEnabled) return;
        const v = await waitForVideoReady(video, 10000);
        if (!v) return;
        if (activeGrid) destroyGrid();
        cachedFrames = null;
        autoTriggered = true;
        currentView = 'side';
        generateGrid(v);
      }, 600);
    };

    sourceObserver = new MutationObserver(onSrcChange);
    sourceObserver.observe(video, { attributes: true, attributeFilter: ['src'] });
    video.addEventListener('loadedmetadata', onSrcChange);
  }

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

  function makeSvgEl(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  function buildViewIcon(view) {
    const svg = makeSvgEl('svg', {
      width: '14', height: '14', viewBox: '0 0 16 16',
      fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5'
    });
    if (view === 'side') {
      svg.appendChild(makeSvgEl('rect', { x: '2', y: '1', width: '12', height: '8', rx: '1' }));
      svg.appendChild(makeSvgEl('rect', { x: '2', y: '10.5', width: '12', height: '4.5', rx: '0.5' }));
    } else if (view === 'below') {
      // Show a "float" preview icon — a small detached box
      svg.appendChild(makeSvgEl('rect', { x: '4', y: '4', width: '10', height: '8', rx: '1' }));
      svg.appendChild(makeSvgEl('circle', { cx: '6', cy: '6', r: '0.5', fill: 'currentColor' }));
    } else {
      // Float view — show side icon (next will be 'side')
      svg.appendChild(makeSvgEl('rect', { x: '1', y: '2', width: '9', height: '12', rx: '1' }));
      svg.appendChild(makeSvgEl('rect', { x: '11.5', y: '2', width: '3.5', height: '12', rx: '0.5' }));
    }
    return svg;
  }

  function getGridCSS() {
    return `
      :host {
        all: initial;
        display: block !important;
        width: 100% !important;
      }

      :host([data-view="float"]) {
        position: fixed !important;
        z-index: 2147483646 !important;
        width: 360px !important;
        max-width: 90vw !important;
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

      .vfg-container.vfg-view-float {
        display: flex;
        flex-direction: column;
        max-height: 75vh;
        box-shadow: 0 8px 32px rgba(0,0,0,0.6);
        border-color: rgba(108, 92, 231, 0.3);
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

      /* SIDE view */
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
      .vfg-view-side .vfg-cell { flex-shrink: 0; }

      /* BELOW view */
      .vfg-view-below .vfg-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 4px;
        padding: 6px;
        background: #0a0a0a;
      }

      /* FLOAT view */
      .vfg-view-float .vfg-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 4px;
        padding: 6px;
        background: #0a0a0a;
        overflow-y: auto;
        flex: 1;
        min-height: 0;
      }
      .vfg-view-float .vfg-grid::-webkit-scrollbar { width: 8px; }
      .vfg-view-float .vfg-grid::-webkit-scrollbar-thumb {
        background: rgba(255,255,255,0.18);
        border-radius: 4px;
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
