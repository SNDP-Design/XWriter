const preview = !globalThis.chrome?.runtime?.sendMessage;
const MODEL = "gpt-4.1-mini";
const KEY = "openaiApiKey";

const SAMPLE_REPLIES = [
  "The line people repeat is the one that can stand alone.",
  "The remembered sentence is usually the one that needed no paragraph.",
  "Which of your own lines do you now wish you had cut?",
  "The quoted line is sometimes weaker than the one they skipped.",
  "Write the sentence you would underline, then leave the rest out.",
];

const REPLY_RULES =
  'Write exactly five replies to a post on X. Return JSON {"replies":[string, string, string, string, string]} in this order: a sharp observation, a short agreement that adds a new point, a genuine question, a respectful disagreement, and a concise witty line. Use the same language as the post. Every reply must be 10, 11, or 12 words. Count the words and do not return a reply outside that range. No hashtags. Do not repeat the post. Sound like a person.';

const els = {
  pageLabel: document.querySelector("#pageLabel"),
  refreshBtn: document.querySelector("#refreshBtn"),
  settingsBtn: document.querySelector("#settingsBtn"),
  settings: document.querySelector("#settings"),
  apiKey: document.querySelector("#apiKey"),
  keyStatus: document.querySelector("#keyStatus"),
  saveKeyBtn: document.querySelector("#saveKeyBtn"),
  clearKeyBtn: document.querySelector("#clearKeyBtn"),
  banner: document.querySelector("#banner"),
  status: document.querySelector("#status"),
  answers: document.querySelector("#answers"),
  empty: document.querySelector("#empty"),
  emptyTitle: document.querySelector("#emptyTitle"),
  emptyText: document.querySelector("#emptyText"),
  toast: document.querySelector("#toast"),
};

const state = {
  post: null,
  signature: null,
  gaveUp: false,
  replies: [],
  apiKey: "",
  onX: false,
  refreshing: false,
  writing: false,
  busy: false,
};

let toastTimer = 0;
let requestSerial = 0;

function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, 2400);
}

function setStatus(message) {
  els.status.hidden = !message;
  els.status.textContent = message || "";
}

function setBanner(message) {
  els.banner.hidden = !message;
  els.banner.textContent = message || "";
}

function showEmpty(title, text) {
  els.empty.hidden = false;
  els.emptyTitle.textContent = title;
  els.emptyText.textContent = text;
  els.answers.replaceChildren();
  state.replies = [];
}

function hideEmpty() {
  els.empty.hidden = true;
}

function signatureFor(post) {
  if (!post) return "";
  return [post.statusId, post.handle, post.text, post.quoted?.text || ""].join("|");
}

function hasText(post) {
  return Boolean(post?.text?.trim() || post?.quoted?.text?.trim());
}

async function storageGet(keys) {
  if (!chrome?.storage?.local) return {};
  return chrome.storage.local.get(keys);
}

async function storageSet(values) {
  if (!chrome?.storage?.local) return;
  await chrome.storage.local.set(values);
}

async function storageRemove(keys) {
  if (!chrome?.storage?.local) return;
  await chrome.storage.local.remove(keys);
}

function keyStatusText() {
  return state.apiKey ? "A key is saved on this computer." : "Paste a key, then save it.";
}

function renderAnswers(replies) {
  state.replies = replies;
  els.answers.replaceChildren();
  hideEmpty();
  setStatus("");
  els.pageLabel.textContent = "Tap a reply";

  replies.forEach((text, index) => {
    const item = document.createElement("li");
    const card = document.createElement("button");
    card.type = "button";
    card.className = "answer";
    card.dataset.index = String(index);

    const body = document.createElement("p");
    body.textContent = text;

    card.append(body);
    item.append(card);
    els.answers.appendChild(item);
  });
}

function postBrief(post) {
  return {
    author: post.name || "",
    handle: post.handle || "",
    text: post.text || "",
    replyingTo: post.replyingTo || [],
    quoted: post.quoted
      ? {
          author: post.quoted.name || "",
          handle: post.quoted.handle || "",
          text: post.quoted.text || "",
        }
      : null,
    earlier: (post.thread || []).map((item) => ({
      handle: item.handle || "",
      text: item.text || "",
    })),
  };
}

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function withinWordLimit(replies) {
  return replies.length === 5 && replies.every((text) => {
    const count = wordCount(text);
    return count >= 10 && count <= 12;
  });
}

function readReplies(data) {
  const content = data?.choices?.[0]?.message?.content || "";
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("OpenAI returned a reply list that could not be read.");
  }

  return (parsed.replies || parsed.comments || parsed.answers || [])
    .map((item) => (typeof item === "string" ? item : item?.text || ""))
    .map((text) => text.trim())
    .filter(Boolean)
    .slice(0, 5);
}

async function askForReplies(post, apiKey, correction) {
  const messages = [
    { role: "system", content: REPLY_RULES },
    { role: "user", content: JSON.stringify(postBrief(post)) },
  ];
  if (correction) messages.push({ role: "user", content: correction });

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.7,
      max_tokens: 500,
      response_format: { type: "json_object" },
      messages,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("That OpenAI key was rejected. Paste a new one in Settings.");
    }
    throw new Error(data?.error?.message || "OpenAI could not write the replies.");
  }

  const replies = readReplies(data);
  if (replies.length < 5) throw new Error("OpenAI did not return five replies.");
  return replies;
}

async function requestReplies(post, apiKey) {
  let replies = await askForReplies(post, apiKey);
  if (withinWordLimit(replies)) return replies;

  const report = replies.map((text) => `${wordCount(text)} words: ${text}`).join("\n");
  replies = await askForReplies(
    post,
    apiKey,
    `Rewrite all five replies. Each one must be 10, 11, or 12 words.\n${report}`
  );
  if (!withinWordLimit(replies)) {
    throw new Error("The replies were not 10 to 12 words. Tap New five to try again.");
  }
  return replies;
}

async function writeFive(post, { force = false } = {}) {
  const signature = signatureFor(post);
  const settled = state.replies.length === 5 || state.gaveUp || !hasText(post);
  if (!force && signature === state.signature && settled) return;

  state.post = post;
  state.signature = signature;
  state.gaveUp = false;

  if (!post) {
    setBanner("");
    setStatus("");
    els.pageLabel.textContent = state.onX ? "No text post in view" : "Not on X";
    showEmpty("No replies yet", state.onX ? "Open a text post on X." : "Open x.com to write replies.");
    return;
  }

  if (!hasText(post)) {
    setBanner("");
    setStatus("");
    els.pageLabel.textContent = "No text to answer";
    showEmpty("No text to answer", "This post has no text, so there is nothing to reply to.");
    return;
  }

  if (!state.apiKey && !preview) {
    setStatus("");
    state.gaveUp = true;
    els.pageLabel.textContent = "Add an API key";
    showEmpty("Add an OpenAI key", "Open Settings and paste your key to write five replies.");
    return;
  }

  const serial = ++requestSerial;
  state.writing = true;
  els.refreshBtn.disabled = true;
  setBanner("");
  els.pageLabel.textContent = "Writing replies";
  setStatus("Writing five replies, 10 to 12 words each…");
  if (!state.replies.length) showEmpty("Writing five replies", "This takes a moment.");

  try {
    const replies = preview ? SAMPLE_REPLIES : await requestReplies(post, state.apiKey);
    if (serial !== requestSerial) return;
    renderAnswers(replies);
  } catch (error) {
    if (serial !== requestSerial) return;
    state.gaveUp = true;
    state.replies = [];
    els.answers.replaceChildren();
    setStatus("");
    els.pageLabel.textContent = "Could not write replies";
    setBanner(error?.message || "Could not write replies.");
    showEmpty("No replies yet", "Try New five, or check the key in Settings.");
  } finally {
    if (serial === requestSerial) {
      state.writing = false;
      els.refreshBtn.disabled = false;
    }
  }
}

async function applyReadResult(result, { force = false } = {}) {
  if (!result) {
    toast("Could not read this tab.");
    return;
  }

  state.onX = !!result.onX;
  if (!result.onX) {
    state.post = null;
    state.signature = "off-x";
    state.gaveUp = false;
    setStatus("");
    els.pageLabel.textContent = "Not on X";
    setBanner("Open x.com to write replies.");
    showEmpty("Not on X", "Open a text post, then come back to this panel.");
    return;
  }

  if (result.ok === false) {
    setBanner(result.error || "Could not read this page.");
    return;
  }

  setBanner("");
  await writeFive(result.post || null, { force });
}

async function refresh({ force = false } = {}) {
  if (state.refreshing) return;
  state.refreshing = true;
  try {
    if (preview) {
      await applyReadResult(
        {
          ok: true,
          onX: true,
          post: {
            statusId: "1",
            handle: "@averachen",
            text: "The hard part of writing in public is not the opinion.",
            quoted: null,
          },
        },
        { force }
      );
      return;
    }
    const result = await chrome.runtime.sendMessage({ type: "XWRITER_READ_ACTIVE" });
    await applyReadResult(result, { force });
  } catch (error) {
    toast(error?.message || "Could not read this tab.");
  } finally {
    state.refreshing = false;
  }
}

async function useReply(text) {
  if (!text) return;
  if (preview) {
    toast("Load the extension to put this on X");
    return;
  }
  if (!state.onX) {
    toast("Open X first");
    return;
  }
  if (state.busy) return;
  state.busy = true;
  try {
    const result = await chrome.runtime.sendMessage({
      type: "XWRITER_INSERT_ACTIVE",
      text,
      mode: "reply",
    });
    toast(result?.ok ? result.message || "Added to the reply" : result?.error || "Could not insert");
  } catch (error) {
    toast(error?.message || "Could not insert");
  } finally {
    state.busy = false;
  }
}

function toggleSettings() {
  const open = els.settings.hidden;
  els.settings.hidden = !open;
  els.settingsBtn.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) els.apiKey.focus();
}

async function saveKey() {
  const value = els.apiKey.value.trim();
  if (!value) {
    toast("Paste a key first");
    return;
  }
  state.apiKey = value;
  await storageSet({ [KEY]: value });
  els.apiKey.value = "";
  els.keyStatus.textContent = keyStatusText();
  toast("Key saved on this computer");
  if (state.post && hasText(state.post)) {
    state.signature = "";
    writeFive(state.post, { force: true });
  }
}

async function clearKey() {
  state.apiKey = "";
  await storageRemove(KEY);
  els.apiKey.value = "";
  els.keyStatus.textContent = keyStatusText();
  toast("Key removed");
}

async function init() {
  const saved = await storageGet(KEY);
  state.apiKey = typeof saved[KEY] === "string" ? saved[KEY] : "";
  els.keyStatus.textContent = keyStatusText();

  els.settingsBtn.addEventListener("click", toggleSettings);
  els.saveKeyBtn.addEventListener("click", saveKey);
  els.clearKeyBtn.addEventListener("click", clearKey);
  els.apiKey.addEventListener("keydown", (event) => {
    if (event.key === "Enter") saveKey();
  });

  els.refreshBtn.addEventListener("click", () => {
    state.signature = "";
    refresh({ force: true });
  });

  els.answers.addEventListener("click", (event) => {
    const card = event.target.closest(".answer");
    if (!card) return;
    for (const node of els.answers.querySelectorAll(".answer.is-selected")) {
      node.classList.remove("is-selected");
    }
    card.classList.add("is-selected");
    useReply(state.replies[Number(card.dataset.index)]);
  });

  if (!preview && chrome.tabs?.onActivated) {
    chrome.tabs.onActivated.addListener(() => {
      if (!document.hidden) refresh();
    });
    chrome.tabs.onUpdated.addListener((tabId, info) => {
      if (document.hidden || !(info.url || info.status === "complete")) return;
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id === tabId) refresh();
      });
    });
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
  });

  refresh();
}

init();
