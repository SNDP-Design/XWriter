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

function enableSidePanel() {
  if (!chrome.sidePanel?.setPanelBehavior) return;
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

chrome.runtime.onInstalled.addListener(enableSidePanel);
chrome.runtime.onStartup.addListener(enableSidePanel);
enableSidePanel();

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function deliver(tabId, message) {
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
        type: "XWRITER_INSERT",
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
