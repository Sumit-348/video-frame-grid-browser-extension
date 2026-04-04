/* popup.js — Extension popup with iOS scroll-wheel interval picker */

const ext = globalThis.chrome || globalThis.browser;

const domainNameEl = document.getElementById('domainName');
const domainToggle = document.getElementById('domainToggle');
const recalibrateBtn = document.getElementById('recalibrateBtn');

const scrollNumber = document.getElementById('scrollNumber');
const scrollUnit = document.getElementById('scrollUnit');
const pickerNumber = document.getElementById('pickerNumber');
const pickerUnit = document.getElementById('pickerUnit');

let currentDomain = null;
let initialInterval = null; // in seconds

// --- Picker Data ---
const ITEM_HEIGHT = 30;
const VISIBLE_ITEMS = 5; // how many rows visible (150px / 30px)

const numbers = [];
for (let i = 1; i <= 60; i++) numbers.push(i);

const units = [
  { label: 'sec', multiplier: 1 },
  { label: 'min', multiplier: 60 },
  { label: 'hrs', multiplier: 3600 }
];

let selectedNumber = 30;
let selectedUnitIndex = 0; // 0=sec, 1=min, 2=hrs

// --- Build Picker Items ---
function buildColumn(scrollEl, items, labelFn) {
  scrollEl.innerHTML = '';
  for (let i = 0; i < items.length; i++) {
    const div = document.createElement('div');
    div.className = 'picker-item';
    div.textContent = labelFn(items[i]);
    div.dataset.index = i;
    div.addEventListener('click', () => {
      scrollToIndex(scrollEl.parentElement, i);
    });
    scrollEl.appendChild(div);
  }
}

function buildPicker() {
  buildColumn(scrollNumber, numbers, n => n);
  buildColumn(scrollUnit, units, u => u.label);
}

// --- Scroll to a specific index (centered) ---
function scrollToIndex(columnEl, index, smooth = true) {
  const targetY = index * ITEM_HEIGHT;
  columnEl.scrollTo({
    top: targetY,
    behavior: smooth ? 'smooth' : 'instant'
  });
}

// --- Get the currently centered index from scroll position ---
function getCenteredIndex(columnEl, itemCount) {
  const scrollTop = columnEl.scrollTop;
  let index = Math.round(scrollTop / ITEM_HEIGHT);
  return Math.max(0, Math.min(index, itemCount - 1));
}

// --- Update visual selection state ---
function updateSelection(columnEl, scrollContainer, itemCount) {
  const index = getCenteredIndex(columnEl, itemCount);
  const items = scrollContainer.querySelectorAll('.picker-item');
  items.forEach((el, i) => {
    el.classList.toggle('selected', i === index);
  });
  return index;
}

// --- Debounced scroll handler ---
function createScrollHandler(columnEl, scrollContainer, items, onSelect) {
  let scrollTimeout = null;

  columnEl.addEventListener('scroll', () => {
    const index = updateSelection(columnEl, scrollContainer, items.length);
    onSelect(index);

    // Snap after scroll stops
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      const snappedIndex = getCenteredIndex(columnEl, items.length);
      scrollToIndex(columnEl, snappedIndex);
      const finalIndex = updateSelection(columnEl, scrollContainer, items.length);
      onSelect(finalIndex);
    }, 80);
  });
}

// --- Compute interval in seconds from picker state ---
function getIntervalSeconds() {
  return selectedNumber * units[selectedUnitIndex].multiplier;
}

// --- Save interval ---
async function saveInterval() {
  const interval = getIntervalSeconds();
  await ext.runtime.sendMessage({ type: 'SET_INTERVAL', interval });

  if (interval !== initialInterval) {
    recalibrateBtn.classList.remove('hidden');
  } else {
    recalibrateBtn.classList.add('hidden');
  }
}

// --- Convert seconds back to picker values ---
function secondsToPickerValues(totalSeconds) {
  // Try hrs first, then min, then sec
  if (totalSeconds >= 3600 && totalSeconds % 3600 === 0) {
    const n = totalSeconds / 3600;
    if (n >= 1 && n <= 60) return { number: n, unitIndex: 2 };
  }
  if (totalSeconds >= 60 && totalSeconds % 60 === 0) {
    const n = totalSeconds / 60;
    if (n >= 1 && n <= 60) return { number: n, unitIndex: 1 };
  }
  // Fallback: seconds
  const n = Math.max(1, Math.min(60, totalSeconds));
  return { number: n, unitIndex: 0 };
}

// --- Init ---
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

  // Load domain status
  if (currentDomain) {
    const res = await ext.runtime.sendMessage({ type: 'GET_DOMAIN_STATUS', domain: currentDomain });
    if (res.enabled) domainToggle.classList.add('active');
  }

  // Load interval
  const intervalRes = await ext.runtime.sendMessage({ type: 'GET_INTERVAL' });
  const interval = intervalRes.interval || 30;
  initialInterval = interval;

  const vals = secondsToPickerValues(interval);
  selectedNumber = vals.number;
  selectedUnitIndex = vals.unitIndex;

  // Build picker
  buildPicker();

  // Set initial scroll positions (instant, no animation)
  const numberIndex = numbers.indexOf(selectedNumber);
  scrollToIndex(pickerNumber, numberIndex >= 0 ? numberIndex : 29, false);
  scrollToIndex(pickerUnit, selectedUnitIndex, false);

  // Mark initial selection after a tick (scroll needs to settle)
  requestAnimationFrame(() => {
    updateSelection(pickerNumber, scrollNumber, numbers.length);
    updateSelection(pickerUnit, scrollUnit, units.length);
  });

  // Scroll handlers
  createScrollHandler(pickerNumber, scrollNumber, numbers, (index) => {
    selectedNumber = numbers[index];
    saveInterval();
  });

  createScrollHandler(pickerUnit, scrollUnit, units, (index) => {
    selectedUnitIndex = index;
    saveInterval();
  });
}

// --- Domain Toggle ---
domainToggle.addEventListener('click', async () => {
  if (!currentDomain) return;
  const isActive = domainToggle.classList.toggle('active');
  await ext.runtime.sendMessage({
    type: 'SET_DOMAIN_STATUS',
    domain: currentDomain,
    enabled: isActive
  });
});

// --- Recalibrate ---
recalibrateBtn.addEventListener('click', async () => {
  await ext.runtime.sendMessage({ type: 'RECALIBRATE' });
  initialInterval = getIntervalSeconds();
  recalibrateBtn.classList.add('hidden');
});

init();
