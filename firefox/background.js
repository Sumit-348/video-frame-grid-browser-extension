/* background.js — Service worker for Video Frame Grid */

const ext = globalThis.chrome || globalThis.browser;

// --- Domain Memory ---

async function isDomainEnabled(domain) {
  const result = await ext.storage.local.get('enabledDomains');
  const domains = result.enabledDomains || {};
  return !!domains[domain];
}

async function setDomainEnabled(domain, enabled) {
  const result = await ext.storage.local.get('enabledDomains');
  const domains = result.enabledDomains || {};
  if (enabled) {
    domains[domain] = true;
  } else {
    delete domains[domain];
  }
  await ext.storage.local.set({ enabledDomains: domains });
}

// --- Interval Storage ---

async function getInterval() {
  const result = await ext.storage.local.get('captureInterval');
  return result.captureInterval || 30; // default 30 seconds
}

async function setInterval(seconds) {
  await ext.storage.local.set({ captureInterval: seconds });
}

// --- Message Handler ---

ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_DOMAIN_STATUS') {
    isDomainEnabled(message.domain).then(enabled => {
      sendResponse({ enabled });
    });
    return true; // async
  }

  if (message.type === 'SET_DOMAIN_STATUS') {
    setDomainEnabled(message.domain, message.enabled).then(() => {
      sendResponse({ success: true });
      // Notify all tabs on this domain
      ext.tabs.query({}, tabs => {
        for (const tab of tabs) {
          try {
            const url = new URL(tab.url);
            if (url.hostname === message.domain) {
              ext.tabs.sendMessage(tab.id, {
                type: 'DOMAIN_STATUS_CHANGED',
                enabled: message.enabled
              }).catch(() => {});
            }
          } catch (e) {}
        }
      });
    });
    return true;
  }

  if (message.type === 'GET_INTERVAL') {
    getInterval().then(interval => {
      sendResponse({ interval });
    });
    return true;
  }

  if (message.type === 'SET_INTERVAL') {
    setInterval(message.interval).then(() => {
      sendResponse({ success: true });
      // Notify all tabs
      ext.tabs.query({}, tabs => {
        for (const tab of tabs) {
          ext.tabs.sendMessage(tab.id, {
            type: 'INTERVAL_CHANGED',
            interval: message.interval
          }).catch(() => {});
        }
      });
    });
    return true;
  }

  if (message.type === 'RECALIBRATE') {
    // Forward to the active tab
    ext.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (tabs[0]) {
        ext.tabs.sendMessage(tabs[0].id, { type: 'RECALIBRATE' }).catch(() => {});
      }
    });
    sendResponse({ success: true });
    return false;
  }
});
