/* popup.js — Video Frame Grid v1.1.1 */

const ext = globalThis.chrome || globalThis.browser;

const domainNameEl = document.getElementById('domainName');
const domainToggle = document.getElementById('domainToggle');
const statusText = document.getElementById('statusText');
const regenerateBtn = document.getElementById('regenerateBtn');
const recalibrateBtn = document.getElementById('recalibrateBtn');
const scrollNumber = document.getElementById('scrollNumber');
const scrollUnit = document.getElementById('scrollUnit');
const pickerNumber = document.getElementById('pickerNumber');
const pickerUnit = document.getElementById('pickerUnit');
const shortcutDisplay = document.getElementById('shortcutDisplay');
const shortcutEditBtn = document.getElementById('shortcutEditBtn');

let currentDomain = null;
let initialInterval = null;
let isEnabled = false;

const ITEM_HEIGHT = 30;
const numbers = [];
for (let i = 1; i <= 60; i++) numbers.push(i);
const units = [
  { label: 'sec', multiplier: 1 },
  { label: 'min', multiplier: 60 },
  { label: 'hrs', multiplier: 3600 }
];

let selectedNumber = 30;
let selectedUnitIndex = 0;

// =============================================
// Picker
// =============================================
function buildColumn(scrollEl, items, labelFn) {
  scrollEl.innerHTML = '';
  for (let i = 0; i < items.length; i++) {
    const div = document.createElement('div');
    div.className = 'picker-item';
    div.textContent = labelFn(items[i]);
    div.dataset.index = i;
    div.addEventListener('click', () => scrollToIndex(scrollEl.parentElement, i));
    scrollEl.appendChild(div);
  }
}

function scrollToIndex(columnEl, index, smooth = true) {
  columnEl.scrollTo({ top: index * ITEM_HEIGHT, behavior: smooth ? 'smooth' : 'instant' });
}

function getCenteredIndex(columnEl, itemCount) {
  return Math.max(0, Math.min(Math.round(columnEl.scrollTop / ITEM_HEIGHT), itemCount - 1));
}

function updateSelection(columnEl, scrollContainer, itemCount) {
  const idx = getCenteredIndex(columnEl, itemCount);
  scrollContainer.querySelectorAll('.picker-item').forEach((el, i) => {
    el.classList.toggle('selected', i === idx);
  });
  return idx;
}

function createScrollHandler(columnEl, scrollContainer, items, onSelect) {
  let timeout = null;
  columnEl.addEventListener('scroll', () => {
    const idx = updateSelection(columnEl, scrollContainer, items.length);
    onSelect(idx);
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      const snap = getCenteredIndex(columnEl, items.length);
      scrollToIndex(columnEl, snap);
      onSelect(updateSelection(columnEl, scrollContainer, items.length));
    }, 80);
  });
}

function getIntervalSeconds() {
  return selectedNumber * units[selectedUnitIndex].multiplier;
}

async function saveInterval() {
  const interval = getIntervalSeconds();
  await ext.runtime.sendMessage({ type: 'SET_INTERVAL', interval });
  if (interval !== initialInterval) recalibrateBtn.classList.remove('hidden');
  else recalibrateBtn.classList.add('hidden');
}

function secondsToPickerValues(s) {
  if (s >= 3600 && s % 3600 === 0) {
    const n = s / 3600;
    if (n >= 1 && n <= 60) return { number: n, unitIndex: 2 };
  }
  if (s >= 60 && s % 60 === 0) {
    const n = s / 60;
    if (n >= 1 && n <= 60) return { number: n, unitIndex: 1 };
  }
  return { number: Math.max(1, Math.min(60, s)), unitIndex: 0 };
}

// =============================================
// UI state
// =============================================
function setEnabledUI(enabled) {
  isEnabled = enabled;
  if (enabled) {
    domainToggle.classList.add('active');
    regenerateBtn.classList.remove('hidden');
    statusText.textContent = 'Active on this site';
    statusText.classList.add('success');
  } else {
    domainToggle.classList.remove('active');
    regenerateBtn.classList.add('hidden');
    statusText.textContent = 'Click to enable';
    statusText.classList.remove('success');
  }
}

// =============================================
// Domain toggle
// =============================================
domainToggle.addEventListener('click', async () => {
  if (!currentDomain) return;
  const newState = !isEnabled;

  await ext.runtime.sendMessage({
    type: 'SET_DOMAIN_STATUS',
    domain: currentDomain,
    enabled: newState
  });

  setEnabledUI(newState);

  if (newState) {
    statusText.textContent = 'Reloading page...';
    setTimeout(() => window.close(), 1200);
  }
});

// =============================================
// Regenerate grid
// =============================================
regenerateBtn.addEventListener('click', async () => {
  await ext.runtime.sendMessage({ type: 'REGENERATE_GRID' });
  window.close();
});

// =============================================
// Recalibrate
// =============================================
recalibrateBtn.addEventListener('click', async () => {
  await ext.runtime.sendMessage({ type: 'RECALIBRATE' });
  initialInterval = getIntervalSeconds();
  recalibrateBtn.classList.add('hidden');
  window.close();
});

// =============================================
// Shortcut
// =============================================
async function loadShortcut() {
  try {
    const commands = await ext.commands.getAll();
    const cmd = commands.find(c => c.name === 'trigger-grid');
    if (cmd && cmd.shortcut) {
      shortcutDisplay.textContent = cmd.shortcut;
    } else {
      shortcutDisplay.textContent = 'Not set';
    }
  } catch {
    shortcutDisplay.textContent = 'Not set';
  }
}

shortcutEditBtn.addEventListener('click', () => {
  // Detect Firefox vs Chrome
  const isFirefox = typeof browser !== 'undefined' && navigator.userAgent.includes('Firefox');
  const url = isFirefox
    ? 'about:addons'
    : 'chrome://extensions/shortcuts';
  ext.tabs.create({ url });
  window.close();
});

// =============================================
// Init
// =============================================
async function init() {
  // Get current tab domain
  const tabs = await ext.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]?.url) {
    try {
      currentDomain = new URL(tabs[0].url).hostname;
      domainNameEl.textContent = currentDomain;
    } catch {
      domainNameEl.textContent = 'N/A';
    }
  }

  // Get domain status
  if (currentDomain) {
    const res = await ext.runtime.sendMessage({ type: 'GET_DOMAIN_STATUS', domain: currentDomain });
    setEnabledUI(res.enabled);
  }

  // Load interval
  const intRes = await ext.runtime.sendMessage({ type: 'GET_INTERVAL' });
  const interval = intRes.interval || 30;
  initialInterval = interval;

  const vals = secondsToPickerValues(interval);
  selectedNumber = vals.number;
  selectedUnitIndex = vals.unitIndex;

  buildColumn(scrollNumber, numbers, n => n);
  buildColumn(scrollUnit, units, u => u.label);

  scrollToIndex(pickerNumber, numbers.indexOf(selectedNumber) || 29, false);
  scrollToIndex(pickerUnit, selectedUnitIndex, false);

  requestAnimationFrame(() => {
    updateSelection(pickerNumber, scrollNumber, numbers.length);
    updateSelection(pickerUnit, scrollUnit, units.length);
  });

  createScrollHandler(pickerNumber, scrollNumber, numbers, (idx) => {
    selectedNumber = numbers[idx];
    saveInterval();
  });
  createScrollHandler(pickerUnit, scrollUnit, units, (idx) => {
    selectedUnitIndex = idx;
    saveInterval();
  });

  loadShortcut();
}

init();
