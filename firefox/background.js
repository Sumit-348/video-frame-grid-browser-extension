/* background.js — Video Frame Grid v1.1.1 */

const ext = globalThis.chrome || globalThis.browser;

// =============================================
// Storage helpers
// =============================================

async function getEnabledDomains() {
  const r = await ext.storage.local.get('enabledDomains');
  return r.enabledDomains || {};
}

async function isDomainEnabled(domain) {
  const domains = await getEnabledDomains();
  return !!domains[domain];
}

async function setDomainEnabled(domain, enabled) {
  const domains = await getEnabledDomains();
  if (enabled) domains[domain] = true;
  else delete domains[domain];
  await ext.storage.local.set({ enabledDomains: domains });
}

async function getInterval() {
  const r = await ext.storage.local.get('captureInterval');
  return r.captureInterval || 30;
}

async function setIntervalValue(seconds) {
  await ext.storage.local.set({ captureInterval: seconds });
}

// =============================================
// Icon state
// =============================================

async function updateIconForTab(tabId, url) {
  let enabled = false;
  try {
    const domain = new URL(url).hostname;
    enabled = await isDomainEnabled(domain);
  } catch {}

  const path = enabled
    ? { 16: 'icons/icon16.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' }
    : { 16: 'icons/icon16-disabled.png', 48: 'icons/icon48-disabled.png', 128: 'icons/icon128-disabled.png' };

  try {
    await ext.action.setIcon({ tabId, path });
  } catch {}
}

ext.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if ((changeInfo.status === 'loading' || changeInfo.url) && tab.url) {
    updateIconForTab(tabId, tab.url);
  }
});

ext.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await ext.tabs.get(tabId);
    if (tab.url) updateIconForTab(tabId, tab.url);
  } catch {}
});

// Init icon for all current tabs on startup
ext.runtime.onInstalled.addListener(async () => {
  const tabs = await ext.tabs.query({});
  for (const tab of tabs) {
    if (tab.url) updateIconForTab(tab.id, tab.url);
  }
});

// =============================================
// Keyboard command — trigger/regenerate grid
// =============================================

ext.commands.onCommand.addListener(async (command) => {
  if (command !== 'trigger-grid') return;
  const tabs = await ext.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]) return;

  let domain;
  try { domain = new URL(tabs[0].url).hostname; } catch { return; }
  if (!(await isDomainEnabled(domain))) return;

  try {
    await ext.tabs.sendMessage(tabs[0].id, { type: 'REGENERATE_GRID' });
  } catch {}
});

// =============================================
// Message handler
// =============================================

ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_DOMAIN_STATUS') {
    isDomainEnabled(message.domain).then((enabled) => sendResponse({ enabled }));
    return true;
  }

  if (message.type === 'SET_DOMAIN_STATUS') {
    setDomainEnabled(message.domain, message.enabled).then(async () => {
      sendResponse({ success: true });
      // Update icon on all tabs of this domain
      const tabs = await ext.tabs.query({});
      for (const tab of tabs) {
        try {
          if (tab.url && new URL(tab.url).hostname === message.domain) {
            await updateIconForTab(tab.id, tab.url);
            // Notify content script
            ext.tabs.sendMessage(tab.id, {
              type: message.enabled ? 'DOMAIN_ENABLED' : 'DOMAIN_DISABLED',
              willReload: message.enabled
            }).catch(() => {});
          }
        } catch {}
      }
      // If just enabled, reload the active tab after delay
      if (message.enabled) {
        const activeTabs = await ext.tabs.query({ active: true, currentWindow: true });
        if (activeTabs[0]) {
          setTimeout(() => {
            ext.tabs.reload(activeTabs[0].id).catch(() => {});
          }, 1500);
        }
      }
    });
    return true;
  }

  if (message.type === 'GET_INTERVAL') {
    getInterval().then((interval) => sendResponse({ interval }));
    return true;
  }

  if (message.type === 'SET_INTERVAL') {
    setIntervalValue(message.interval).then(() => {
      sendResponse({ success: true });
      ext.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
          ext.tabs.sendMessage(tab.id, { type: 'INTERVAL_CHANGED', interval: message.interval }).catch(() => {});
        }
      });
    });
    return true;
  }

  if (message.type === 'REGENERATE_GRID') {
    ext.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) ext.tabs.sendMessage(tabs[0].id, { type: 'REGENERATE_GRID' }).catch(() => {});
    });
    sendResponse({ success: true });
    return false;
  }

  if (message.type === 'SET_VIEW') {
    ext.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        ext.tabs.sendMessage(tabs[0].id, { type: 'SET_VIEW', view: message.view }).catch(() => {});
      }
    });
    sendResponse({ success: true });
    return false;
  }

  if (message.type === 'GET_CURRENT_VIEW') {
    ext.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs[0]) {
        sendResponse({ view: null, hasGrid: false });
        return;
      }
      try {
        const res = await ext.tabs.sendMessage(tabs[0].id, { type: 'GET_CURRENT_VIEW' });
        sendResponse(res || { view: null, hasGrid: false });
      } catch {
        sendResponse({ view: null, hasGrid: false });
      }
    });
    return true;
  }

  if (message.type === 'RECALIBRATE') {
    ext.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) ext.tabs.sendMessage(tabs[0].id, { type: 'RECALIBRATE' }).catch(() => {});
    });
    sendResponse({ success: true });
    return false;
  }

  if (message.type === 'OPEN_SHORTCUTS') {
    // Chrome only — Firefox handles this differently
    const url = 'chrome://extensions/shortcuts';
    ext.tabs.create({ url });
    sendResponse({ success: true });
    return false;
  }
});
