const preview = !globalThis.chrome?.runtime?.sendMessage;
const MODEL = "gpt-6-luna";
const KEY = "openaiApiKey";
const VOICE_KEY = "userVoice";
const REPLY_COUNT = 6;
const CANDIDATE_COUNT = 10;
const MAX_WORDS = 22;
const MAX_VOICE_CHARS = 2500;

const SAMPLE_REPLIES = [
  "ok so what is the hard part then",
  "hitting post when three people from work follow you. that's the hard part",
  "felt this",
  "disagree a little, I've deleted way more drafts over the take than the wording",
  "Rewriting the first line nine times before anyone sees it",
  "the opinion takes 5 minutes, the courage takes a week",
];

const REPLY_RULES = `You write replies to a post on X for the user. Each reply should read like a real person typed it on their phone in a few seconds.

Return JSON {"replies": [string, ...]} with exactly ${CANDIDATE_COUNT} replies.

What to say:
- Every reply reacts to one specific thing in the post: a word, a claim, a number, a name, or what is in the photo or link. A reply that would fit under any other post is wrong.
- Mix the angles. For example: a quick joke, pushing back on one part, a real question you want answered, a short personal take or experience, an extra fact or example, plain agreement with a reason. Do not label the angles and do not force every one.
- Have a point of view. Do not praise the post and do not sum it up.
- Every reply must say something different from the others.

How to write:
- Plain everyday English, the way people text. Short common words.
- Vary the length. At least two replies under 6 words and at least two between 14 and 20 words. Nothing over 20 words.
- Fragments are fine. Use contractions. Some replies can start in lowercase. Some can leave off the final period.
- At most one emoji across all replies, unless the user's own replies use more.
- If the user's own replies are given, match their tone, length, casing, punctuation, and emoji use. Do not copy their lines or their topics.

Never:
- Hashtags, em dashes, en dashes, or semicolons.
- Lists of three things.
- "It's not X, it's Y" or "X isn't just Y" sentences.
- Opening with praise, or with "Honestly", "Absolutely", "Great point", "Love this", "So true", or "This is so true".
- These words and phrases: resonate, game changer, delve, testament, crucial, journey, navigate, landscape, elevate, unpack, powerful reminder, couldn't agree more, well said, nailed it, spot on, hits different, 100%.
- Repeating or restating the post.
- Questions only meant to get engagement, like "What do you think?" or "Who else agrees?"`;

const BANNED_OPENERS = [
  "honestly",
  "absolutely",
  "great point",
  "great post",
  "love this",
  "so true",
  "this is so true",
  "this is spot on",
  "wow",
  "yes!",
  "this!",
];

const BANNED_PHRASES = [
  "resonate",
  "game changer",
  "game-changer",
  "delve",
  "testament",
  "crucial",
  "journey",
  "navigate",
  "navigating",
  "landscape",
  "elevate",
  "unpack",
  "powerful reminder",
  "couldn't agree more",
  "could not agree more",
  "well said",
  "nailed it",
  "spot on",
  "hits different",
  "100%",
  "what do you think",
  "who else",
  "thoughts?",
  "food for thought",
  "this is everything",
  "so much this",
  "the power of",
  "at the end of the day",
];

const els = {
  pageLabel: document.querySelector("#pageLabel"),
  refreshBtn: document.querySelector("#refreshBtn"),
  settingsBtn: document.querySelector("#settingsBtn"),
  settings: document.querySelector("#settings"),
  apiKey: document.querySelector("#apiKey"),
  keyStatus: document.querySelector("#keyStatus"),
  saveKeyBtn: document.querySelector("#saveKeyBtn"),
  clearKeyBtn: document.querySelector("#clearKeyBtn"),
  voice: document.querySelector("#voice"),
  voiceStatus: document.querySelector("#voiceStatus"),
  saveVoiceBtn: document.querySelector("#saveVoiceBtn"),
  clearVoiceBtn: document.querySelector("#clearVoiceBtn"),
  banner: document.querySelector("#banner"),
  status: document.querySelector("#status"),
  answers: document.querySelector("#answers"),
  progress: document.querySelector("#progress"),
  progressTitle: document.querySelector("#progressTitle"),
  progressText: document.querySelector("#progressText"),
  progressBar: document.querySelector("#progressBar"),
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
  voice: "",
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

function showProgress(title) {
  els.progressTitle.textContent = title;
  els.progressBar.classList.remove("is-waiting");
  els.progressBar.style.width = "0%";
  els.progress.hidden = false;
}

function setProgress(text, percent, { waiting = false } = {}) {
  els.progressText.textContent = text;
  els.progressBar.classList.toggle("is-waiting", waiting);
  // Let the bar paint at its old width first so the transition runs.
  requestAnimationFrame(() => {
    els.progressBar.style.width = `${percent}%`;
  });
}

function hideProgress() {
  els.progress.hidden = true;
}

function showEmpty(title, text) {
  hideProgress();
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

function voiceStatusText() {
  if (!state.voice) return "Replies will copy the way you write.";
  const lines = state.voice.split("\n").filter((line) => line.trim()).length;
  return `${lines} example ${lines === 1 ? "reply" : "replies"} saved. Replies will copy your style.`;
}

function renderAnswers(replies) {
  state.replies = replies;
  els.answers.replaceChildren();
  hideEmpty();
  hideProgress();
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
    photos: (post.photos || []).map((photo) => photo.alt).filter((alt) => alt && alt !== "Photo"),
    hasPhoto: (post.photos || []).length > 0,
    hasVideo: !!post.hasVideo,
    link: post.card || "",
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

function cleanReply(text) {
  return text
    .replace(/\s+/g, " ")
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .trim();
}

function problemWith(text) {
  const lower = text.toLowerCase();
  const words = wordCount(text);
  if (words < 1) return "empty";
  if (words > MAX_WORDS) return "too long";
  if (/[—–]/.test(text)) return "uses a long dash";
  if (text.includes(";")) return "uses a semicolon";
  if (/(^|\s)#[\p{L}\d_]/u.test(text)) return "uses a hashtag";
  const opener = BANNED_OPENERS.find((start) => lower.startsWith(start));
  if (opener) return `opens with "${opener}"`;
  const phrase = BANNED_PHRASES.find((item) => lower.includes(item));
  if (phrase) return `uses "${phrase}"`;
  if (
    /\b(it'?s|this is|that'?s|it was) not\b[^.!?]{1,40}?,\s*(it'?s|this is|that'?s|it was)\b/i.test(text) ||
    /\b(isn'?t|is not|wasn'?t|was not) (just|only|merely) /i.test(text)
  ) {
    return `uses an "it's not X, it's Y" sentence`;
  }
  return "";
}

function review(replies) {
  const good = [];
  const rejected = [];
  const seen = new Set();
  for (const raw of replies) {
    const text = cleanReply(raw);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    const problem = problemWith(text);
    if (problem) rejected.push({ text, problem });
    else good.push(text);
  }
  return { good, rejected };
}

function wordSet(text) {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\d\s']/gu, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2)
  );
}

function similarity(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared);
}

function pickDistinct(replies, count) {
  const pool = replies.map((text) => ({ text, words: wordSet(text) }));
  const chosen = pool.splice(0, 1);
  while (chosen.length < count && pool.length) {
    let bestIndex = 0;
    let bestScore = Infinity;
    pool.forEach((item, index) => {
      const score = Math.max(...chosen.map((pick) => similarity(item.words, pick.words)));
      if (score < bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    chosen.push(...pool.splice(bestIndex, 1));
  }
  return chosen.map((item) => item.text);
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
    .filter(Boolean);
}

async function askForReplies(post, apiKey, voice, correction) {
  const messages = [{ role: "system", content: REPLY_RULES }];
  if (voice) {
    messages.push({
      role: "user",
      content: `Replies I have written on X, one per line. Write the way I write:\n${voice.slice(0, MAX_VOICE_CHARS)}`,
    });
  }
  messages.push({ role: "user", content: `The post to reply to:\n${JSON.stringify(postBrief(post))}` });
  if (correction) messages.push({ role: "user", content: correction });

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      reasoning_effort: "low",
      // Reasoning tokens count toward this cap, so it needs room beyond the six replies.
      max_completion_tokens: 3000,
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

  return readReplies(data);
}

async function requestReplies(post, apiKey, voice, onStep = () => {}) {
  onStep("write");
  const first = review(await askForReplies(post, apiKey, voice));
  onStep("check");
  let good = first.good;

  if (good.length < REPLY_COUNT) {
    onStep("fix");
    const report = first.rejected.map((item) => `- "${item.text}" (${item.problem})`).join("\n");
    const correction = report
      ? `These replies broke the rules and were thrown out:\n${report}\nWrite ${CANDIDATE_COUNT} new replies to the same post. Follow every rule.`
      : `You returned too few replies. Write ${CANDIDATE_COUNT} new replies to the same post. Follow every rule.`;
    const second = review(await askForReplies(post, apiKey, voice, correction));
    const known = new Set(good.map((text) => text.toLowerCase()));
    good = [...good, ...second.good.filter((text) => !known.has(text.toLowerCase()))];
  }

  if (!good.length) {
    throw new Error("Every reply sounded too much like AI. Tap New six to try again.");
  }
  return pickDistinct(good, REPLY_COUNT);
}

async function writeReplies(post, { force = false } = {}) {
  const signature = signatureFor(post);
  const settled = state.replies.length > 0 || state.gaveUp || !hasText(post);
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
    showEmpty("Add an OpenAI key", "Open Settings and paste your key to write six replies.");
    return;
  }

  const serial = ++requestSerial;
  const rewriting = state.replies.length > 0;
  state.writing = true;
  els.refreshBtn.disabled = true;
  setBanner("");
  setStatus("");
  hideEmpty();
  els.answers.replaceChildren();
  state.replies = [];
  els.pageLabel.textContent = rewriting ? "Rewriting replies" : "Writing replies";
  showProgress(rewriting ? "Rewriting six replies" : "Writing six replies");
  setProgress("Reading the post…", 10);

  const onStep = (step) => {
    if (serial !== requestSerial) return;
    if (step === "write") {
      setProgress(
        state.voice ? "Writing replies in your voice…" : "Writing replies…",
        70,
        { waiting: true }
      );
    } else if (step === "check") {
      setProgress("Throwing out replies that sound like AI…", 80);
    } else if (step === "fix") {
      setProgress("Replacing the ones that sounded fake…", 92, { waiting: true });
    }
  };

  try {
    let replies;
    if (preview) {
      onStep("write");
      await new Promise((resolve) => setTimeout(resolve, 1200));
      onStep("check");
      replies = SAMPLE_REPLIES;
    } else {
      replies = await requestReplies(post, state.apiKey, state.voice, onStep);
    }
    if (serial !== requestSerial) return;
    renderAnswers(replies);
  } catch (error) {
    if (serial !== requestSerial) return;
    state.gaveUp = true;
    state.replies = [];
    els.answers.replaceChildren();
    hideProgress();
    setStatus("");
    els.pageLabel.textContent = "Could not write replies";
    setBanner(error?.message || "Could not write replies.");
    showEmpty("No replies yet", "Try New six, or check the key in Settings.");
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
  await writeReplies(result.post || null, { force });
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
  rewriteCurrentPost();
}

async function clearKey() {
  state.apiKey = "";
  await storageRemove(KEY);
  els.apiKey.value = "";
  els.keyStatus.textContent = keyStatusText();
  toast("Key removed");
}

function rewriteCurrentPost() {
  if (state.apiKey && state.post && hasText(state.post)) {
    state.signature = "";
    writeReplies(state.post, { force: true });
  }
}

async function saveVoice() {
  const value = els.voice.value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
  if (!value) {
    toast("Paste a few of your replies first");
    return;
  }
  state.voice = value;
  els.voice.value = value;
  await storageSet({ [VOICE_KEY]: value });
  els.voiceStatus.textContent = voiceStatusText();
  toast("Voice saved");
  rewriteCurrentPost();
}

async function clearVoice() {
  state.voice = "";
  els.voice.value = "";
  await storageRemove(VOICE_KEY);
  els.voiceStatus.textContent = voiceStatusText();
  toast("Voice removed");
}

async function init() {
  const saved = await storageGet([KEY, VOICE_KEY]);
  state.apiKey = typeof saved[KEY] === "string" ? saved[KEY] : "";
  state.voice = typeof saved[VOICE_KEY] === "string" ? saved[VOICE_KEY] : "";
  els.keyStatus.textContent = keyStatusText();
  els.voice.value = state.voice;
  els.voiceStatus.textContent = voiceStatusText();

  els.settingsBtn.addEventListener("click", toggleSettings);
  els.saveKeyBtn.addEventListener("click", saveKey);
  els.clearKeyBtn.addEventListener("click", clearKey);
  els.saveVoiceBtn.addEventListener("click", saveVoice);
  els.clearVoiceBtn.addEventListener("click", clearVoice);
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
