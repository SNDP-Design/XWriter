const preview = !globalThis.chrome?.runtime?.sendMessage;

const OPENERS = [
  {
    label: "Follow-up",
    build: (post) =>
      post?.handle ? `Curious what you make of this, ${post.handle} — ` : "Curious what you make of this — ",
  },
  { label: "Add on", build: () => "One thing I would add: " },
  { label: "Disagree", build: () => "I see it differently. " },
  {
    label: "Thanks",
    build: (post) => (post?.handle ? `Useful note, ${post.handle}. ` : "Useful note. "),
  },
];

const SOURCE_LABELS = {
  selection: "Selected post",
  dialog: "Post in the reply window",
  permalink: "Open post",
  viewport: "Post in view",
};

const els = {
  pageLabel: document.querySelector("#pageLabel"),
  readBtn: document.querySelector("#readBtn"),
  banner: document.querySelector("#banner"),
  postCard: document.querySelector("#postCard"),
  postKind: document.querySelector("#postKind"),
  showBtn: document.querySelector("#showBtn"),
  avatar: document.querySelector("#avatar"),
  authorName: document.querySelector("#authorName"),
  authorHandle: document.querySelector("#authorHandle"),
  postTime: document.querySelector("#postTime"),
  replyingTo: document.querySelector("#replyingTo"),
  postText: document.querySelector("#postText"),
  mediaList: document.querySelector("#mediaList"),
  quote: document.querySelector("#quote"),
  quoteAuthor: document.querySelector("#quoteAuthor"),
  quoteText: document.querySelector("#quoteText"),
  cardPreview: document.querySelector("#cardPreview"),
  thread: document.querySelector("#thread"),
  empty: document.querySelector("#empty"),
  modes: [...document.querySelectorAll(".mode")],
  draftLabel: document.querySelector("#draftLabel"),
  draft: document.querySelector("#draft"),
  meterFill: document.querySelector("#meterFill"),
  count: document.querySelector("#count"),
  countLine: document.querySelector(".count-line"),
  fitBtn: document.querySelector("#fitBtn"),
  clearBtn: document.querySelector("#clearBtn"),
  copyBtn: document.querySelector("#copyBtn"),
  insertBtn: document.querySelector("#insertBtn"),
  starterRow: document.querySelector("#starterRow"),
  follow: document.querySelector("#follow"),
  toast: document.querySelector("#toast"),
};

const state = {
  post: null,
  mode: "reply",
  draftKey: "",
  signature: "",
  onX: false,
  hydrating: false,
  refreshing: false,
  busy: false,
};

let toastTimer = 0;
let saveTimer = 0;
let pollTimer = 0;

function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, 2400);
}

function initials(name, handle) {
  const source = (name || handle || "?").replace("@", "").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 1).toUpperCase() || "?";
}

function pageName(url) {
  if (!url) return "X";
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return (parsed.hostname + path).slice(0, 42);
  } catch {
    return "X";
  }
}

function formatWhen(iso, fallback) {
  if (!iso) return fallback || "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return fallback || "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function draftKeyFor(post) {
  if (!post) return "";
  if (post.statusId) return `draft:${post.statusId}`;
  if (post.permalink) return `draft:${post.permalink}`;
  return `draft:${post.handle}:${(post.text || "").slice(0, 48)}`;
}

function signatureFor(post) {
  if (!post) return "";
  return [post.statusId, post.source, post.handle, post.text, post.quoted?.text || ""].join("|");
}

function setMode(mode) {
  state.mode = mode === "post" ? "post" : "reply";
  for (const button of els.modes) {
    const on = button.dataset.mode === state.mode;
    button.classList.toggle("is-on", on);
    button.setAttribute("aria-selected", on ? "true" : "false");
  }
  els.draftLabel.textContent = state.mode === "reply" ? "Reply" : "New post";
  els.insertBtn.textContent = state.mode === "reply" ? "Put reply on X" : "Put post on X";
  const handle = state.post?.handle;
  els.draft.placeholder =
    state.mode === "reply"
      ? handle
        ? `Reply to ${handle}`
        : "Write a reply…"
      : "Write a new post…";
}

function updateCount() {
  const length = els.draft.value.length;
  const over = length > 280;
  els.count.textContent = String(length);
  els.countLine.classList.toggle("is-over", over);
  els.meterFill.style.width = `${Math.min(100, (length / 280) * 100)}%`;
  els.meterFill.classList.toggle("is-over", over);
  els.fitBtn.hidden = !over;
  els.clearBtn.hidden = length === 0;
}

function fit280(text) {
  if (text.length <= 280) return text;
  const cut = text.slice(0, 279);
  const sentence = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  if (sentence > 80) return cut.slice(0, sentence + 1).trim();
  const word = cut.lastIndexOf(" ");
  const base = (word > 40 ? cut.slice(0, word) : cut).trimEnd();
  return `${base}…`;
}

function insertSnippet(snippet) {
  const box = els.draft;
  const start = box.selectionStart ?? box.value.length;
  const end = box.selectionEnd ?? box.value.length;
  box.value = box.value.slice(0, start) + snippet + box.value.slice(end);
  const caret = start + snippet.length;
  box.focus();
  box.setSelectionRange(caret, caret);
  box.dispatchEvent(new Event("input"));
}

function renderStarters() {
  els.starterRow.replaceChildren();
  for (const opener of OPENERS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip";
    button.textContent = opener.label;
    button.addEventListener("click", () => insertSnippet(opener.build(state.post)));
    els.starterRow.appendChild(button);
  }
}

function setText(node, value, hideWhenEmpty = false) {
  const text = value || "";
  node.textContent = text;
  if (hideWhenEmpty) node.hidden = !text;
}

function renderThread(items) {
  els.thread.replaceChildren();
  if (!items?.length) {
    els.thread.hidden = true;
    return;
  }
  els.thread.hidden = false;
  const title = document.createElement("div");
  title.className = "thread-title";
  title.textContent = "Earlier in the thread";
  els.thread.appendChild(title);
  for (const item of items) {
    const line = document.createElement("p");
    const who = document.createElement("strong");
    who.textContent = item.handle || item.name || "Post";
    line.append(who, ` ${item.text || ""}`);
    els.thread.appendChild(line);
  }
}

function renderMedia(post) {
  els.mediaList.replaceChildren();
  const items = [...(post.photos || [])];
  if (post.hasVideo) items.push({ alt: "Video" });
  if (!items.length) {
    els.mediaList.hidden = true;
    return;
  }
  els.mediaList.hidden = false;
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = item.alt || "Photo";
    els.mediaList.appendChild(li);
  }
}

function renderPost(post) {
  state.post = post;
  if (!post) {
    els.postCard.hidden = true;
    els.empty.hidden = !state.onX;
    setMode(state.mode);
    return;
  }

  els.empty.hidden = true;
  els.postCard.hidden = false;
  const social = (post.social || []).join(" ");
  const kind = /repost/i.test(social) ? "Repost" : SOURCE_LABELS[post.source] || "Post";
  els.postKind.textContent = kind;
  els.avatar.textContent = initials(post.name, post.handle);
  setText(els.authorName, post.name || "Post");
  setText(els.authorHandle, post.handle || "");
  const when = post.timeText || formatWhen(post.datetime, "");
  els.postTime.textContent = when;
  els.postTime.dateTime = post.datetime || "";
  els.postTime.title = formatWhen(post.datetime, post.permalink || "");

  const replyLine = post.replyingTo?.length ? `Replying to ${post.replyingTo.join(" ")}` : "";
  setText(els.replyingTo, replyLine, true);

  if (post.text) {
    els.postText.textContent = post.text;
    els.postText.classList.remove("is-muted");
  } else {
    els.postText.textContent = post.hasVideo ? "Video post" : post.photos?.length ? "Image post" : "No text in this post";
    els.postText.classList.add("is-muted");
  }

  renderMedia(post);

  if (post.quoted) {
    els.quote.hidden = false;
    const who = [post.quoted.name, post.quoted.handle].filter(Boolean).join(" ");
    setText(els.quoteAuthor, who || "Quoted post");
    setText(els.quoteText, post.quoted.text || "Quoted post");
  } else {
    els.quote.hidden = true;
  }

  setText(els.cardPreview, post.card || "", true);
  renderThread(post.thread);
  setMode(state.mode);
}

async function storageGet(keys) {
  if (!chrome?.storage?.local) return {};
  return chrome.storage.local.get(keys);
}

async function storageSet(values) {
  if (!chrome?.storage?.local) return;
  await chrome.storage.local.set(values);
}

function saveDraft(key) {
  if (!key || state.hydrating) return;
  storageSet({
    [key]: {
      value: els.draft.value,
      mode: state.mode,
      at: Date.now(),
    },
  });
}

async function loadDraft(key, keepCurrent) {
  state.hydrating = true;
  try {
    if (!key) {
      if (!keepCurrent) {
        els.draft.value = "";
        setMode("reply");
      }
      updateCount();
      return;
    }
    const data = await storageGet(key);
    const saved = data[key];
    if (keepCurrent && els.draft.value && !saved?.value) {
      updateCount();
      state.hydrating = false;
      saveDraft(key);
      return;
    }
    els.draft.value = saved?.value || "";
    setMode(saved?.mode || state.mode || "reply");
    updateCount();
  } finally {
    state.hydrating = false;
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveDraft(state.draftKey), 250);
}

async function applyReadResult(result, { silent }) {
  if (!result) {
    if (!silent) toast("Could not read this tab.");
    return;
  }

  state.onX = !!result.onX;
  els.pageLabel.textContent = result.onX ? pageName(result.url) : "Not on X";
  els.insertBtn.disabled = !result.onX;
  els.showBtn.disabled = !result.onX;

  if (!result.onX) {
    els.banner.hidden = false;
    els.banner.textContent = "Open x.com to read a post. You can keep drafting here, then copy it over.";
    els.postCard.hidden = true;
    els.empty.hidden = true;
    return;
  }

  if (result.ok === false) {
    els.banner.hidden = false;
    els.banner.textContent = result.error || "Could not read this page.";
    return;
  }

  els.banner.hidden = true;
  const post = result.post || null;
  const nextKey = draftKeyFor(post);
  const nextSignature = signatureFor(post);

  if (nextKey !== state.draftKey) {
    clearTimeout(saveTimer);
    const keepCurrent = !state.draftKey && !!els.draft.value.trim();
    saveDraft(state.draftKey);
    state.draftKey = nextKey;
    await loadDraft(nextKey, keepCurrent);
  }

  if (nextSignature !== state.signature) {
    state.signature = nextSignature;
    renderPost(post);
  } else if (!post) {
    renderPost(null);
  }

  if (!silent) {
    toast(post ? "Post updated" : "No post in view");
  }
}

async function refresh({ silent = false } = {}) {
  if (state.refreshing) return;
  state.refreshing = true;
  if (!silent) els.readBtn.disabled = true;
  try {
    if (preview) {
      await applyReadResult(
        {
          ok: true,
          onX: true,
          url: "https://x.com/example/status/1",
          post: samplePost(),
        },
        { silent }
      );
      return;
    }
    const result = await chrome.runtime.sendMessage({ type: "XWRITER_READ_ACTIVE" });
    await applyReadResult(result, { silent });
  } catch (error) {
    if (!silent) toast(error?.message || "Could not read this tab.");
  } finally {
    state.refreshing = false;
    els.readBtn.disabled = false;
  }
}

async function copyDraft() {
  const text = els.draft.value;
  if (!text.trim()) {
    toast("Nothing to copy");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    els.draft.focus();
    els.draft.select();
    document.execCommand("copy");
  }
  toast("Copied");
}

async function insertDraft() {
  const text = els.draft.value;
  if (!text.trim()) {
    toast("Write a draft first");
    els.draft.focus();
    return;
  }
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
  els.insertBtn.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({
      type: "XWRITER_INSERT_ACTIVE",
      text,
      mode: state.mode,
    });
    toast(result?.ok ? result.message || "Added on X" : result?.error || "Could not insert");
  } catch (error) {
    toast(error?.message || "Could not insert");
  } finally {
    state.busy = false;
    els.insertBtn.disabled = !state.onX;
  }
}

function samplePost() {
  return {
    source: "permalink",
    name: "Avery Chen",
    handle: "@averachen",
    text: "The hard part of writing in public is not the opinion. It is knowing which sentence the reader will quote back to you.",
    replyingTo: [],
    social: [],
    datetime: "2026-10-15T09:30:00.000Z",
    timeText: "Oct 15",
    permalink: "https://x.com/averachen/status/1",
    statusId: "1",
    photos: [],
    hasVideo: false,
    card: "",
    quoted: null,
    thread: [
      {
        name: "Avery Chen",
        handle: "@averachen",
        text: "Started a thread on drafting replies that sound like you.",
      },
    ],
  };
}

function schedulePoll() {
  clearInterval(pollTimer);
  if (!els.follow.checked) return;
  pollTimer = setInterval(() => {
    if (!document.hidden) refresh({ silent: true });
  }, 2000);
}

async function init() {
  renderStarters();
  updateCount();
  setMode("reply");

  const saved = await storageGet("xwriter:follow");
  if (typeof saved["xwriter:follow"] === "boolean") {
    els.follow.checked = saved["xwriter:follow"];
  }

  els.readBtn.addEventListener("click", () => refresh());
  els.follow.addEventListener("change", () => {
    storageSet({ "xwriter:follow": els.follow.checked });
    schedulePoll();
    if (els.follow.checked) refresh({ silent: true });
  });

  for (const button of els.modes) {
    button.addEventListener("click", () => {
      setMode(button.dataset.mode);
      scheduleSave();
    });
  }

  els.draft.addEventListener("input", () => {
    updateCount();
    if (!state.hydrating) scheduleSave();
  });

  els.draft.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      insertDraft();
    }
  });

  els.fitBtn.addEventListener("click", () => {
    els.draft.value = fit280(els.draft.value);
    updateCount();
    scheduleSave();
    els.draft.focus();
  });

  els.clearBtn.addEventListener("click", () => {
    els.draft.value = "";
    updateCount();
    scheduleSave();
    els.draft.focus();
  });

  els.copyBtn.addEventListener("click", copyDraft);
  els.insertBtn.addEventListener("click", insertDraft);
  els.showBtn.addEventListener("click", async () => {
    if (preview) {
      toast("Load the extension to jump to the post");
      return;
    }
    const result = await chrome.runtime.sendMessage({ type: "XWRITER_SHOW_ACTIVE" });
    if (!result?.ok) toast(result?.error || "Could not show the post");
  });

  if (!preview && chrome.tabs?.onActivated) {
    chrome.tabs.onActivated.addListener(() => refresh({ silent: true }));
    chrome.tabs.onUpdated.addListener((tabId, info) => {
      if (!(info.url || info.status === "complete")) return;
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id === tabId) refresh({ silent: true });
      });
    });
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh({ silent: true });
  });

  schedulePoll();
  refresh({ silent: true });
}

init();
