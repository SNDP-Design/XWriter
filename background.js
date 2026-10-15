const X_HOSTS = new Set([
  "x.com",
  "twitter.com",
  "mobile.x.com",
  "mobile.twitter.com",
]);

function isXUrl(url) {
  if (!url) return false;
  try {
    return X_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

const OPEN_TABS = "xwriterOpenTabs";
const openTabs = new Set();

function configurePanel() {
  if (!chrome.sidePanel?.setPanelBehavior) return;
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
}

async function hydrateOpenTabs() {
  const stored = await chrome.storage.session.get(OPEN_TABS);
  for (const id of stored[OPEN_TABS] || []) openTabs.add(id);
}

function saveOpenTabs() {
  chrome.storage.session.set({ [OPEN_TABS]: [...openTabs] });
}

async function setTabPanel(tabId, enabled) {
  await chrome.sidePanel.setOptions({
    tabId,
    path: "sidepanel.html",
    enabled,
  });
}

async function pinOpenTabs() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs
      .filter((tab) => tab.id)
      .map((tab) => setTabPanel(tab.id, openTabs.has(tab.id)))
  );
}

chrome.runtime.onInstalled.addListener(configurePanel);
chrome.runtime.onStartup.addListener(() => {
  configurePanel();
  hydrateOpenTabs();
});
configurePanel();
hydrateOpenTabs();

chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;
  openTabs.add(tab.id);
  saveOpenTabs();
  // open() has to run in this click, before any await, or Chrome rejects it.
  chrome.sidePanel.open({ tabId: tab.id }).catch((error) => console.error(error));
  pinOpenTabs().catch((error) => console.error(error));
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  if (openTabs.size === 0) await hydrateOpenTabs();
  if (openTabs.size === 0) return;
  try {
    await setTabPanel(tabId, openTabs.has(tabId));
  } catch {
    /* The tab can close before the panel options are applied. */
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  if (!tab.id || openTabs.size === 0) return;
  setTabPanel(tab.id, false).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (!openTabs.delete(tabId)) return;
  saveOpenTabs();
});

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function deliver(tabId, message) {
  if (message.type === "XWRITER_INSERT_V2") {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
      });
    } catch {
      return {
        ok: false,
        error: "Refresh the X tab, then tap the reply again.",
      };
    }
  }

  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
      });
      return await chrome.tabs.sendMessage(tabId, message);
    } catch {
      return {
        ok: false,
        error: "Refresh the X tab, then read the post again.",
      };
    }
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message?.type?.startsWith("XWRITER_")) return false;

  (async () => {
    const tab = await activeTab();
    if (!tab?.id) {
      sendResponse({ ok: false, onX: false, error: "No active tab." });
      return;
    }

    const onX = isXUrl(tab.url);
    if (!onX) {
      sendResponse({ ok: true, onX: false, url: tab.url || "", title: tab.title || "" });
      return;
    }

    if (message.type === "XWRITER_READ_ACTIVE") {
      const result = await deliver(tab.id, { type: "XWRITER_READ" });
      sendResponse({
        ok: result?.ok !== false,
        onX: true,
        url: tab.url,
        title: tab.title || "",
        post: result?.post || null,
        error: result?.error,
      });
      return;
    }

    if (message.type === "XWRITER_INSERT_ACTIVE") {
      const result = await deliver(tab.id, {
        type: "XWRITER_INSERT_V2",
        text: message.text || "",
        mode: message.mode === "post" ? "post" : "reply",
      });
      sendResponse(result || { ok: false, error: "X did not respond." });
      return;
    }

    if (message.type === "XWRITER_SHOW_ACTIVE") {
      const result = await deliver(tab.id, { type: "XWRITER_SHOW" });
      sendResponse(result || { ok: false, error: "X did not respond." });
      return;
    }

    sendResponse({ ok: false, error: "Unknown request." });
  })().catch((error) => {
    sendResponse({ ok: false, error: error?.message || "Something went wrong." });
  });

  return true;
});
