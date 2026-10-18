{
  globalThis.__xwriter = true;

  const ARTICLE = 'article[data-testid="tweet"], article[role="article"]';

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function column() {
    return document.querySelector('[data-testid="primaryColumn"]') || document.body;
  }

  function articles() {
    return [...column().querySelectorAll(ARTICLE)];
  }

  function isNested(article) {
    return !!article.parentElement?.closest(ARTICLE);
  }

  function outerArticle(article) {
    return article.parentElement?.closest(ARTICLE) || article;
  }

  function statusIdFromPath() {
    const match = location.pathname.match(/\/status\/(\d+)/);
    return match ? match[1] : "";
  }

  function absoluteUrl(href) {
    try {
      return new URL(href, location.origin).href;
    } catch {
      return "";
    }
  }

  function findQuote(root) {
    const mainName = root.querySelector('[data-testid="User-Name"]');
    const candidates = [
      ...root.querySelectorAll(ARTICLE),
      ...[...root.querySelectorAll('[data-testid="quoteTweet"]')].filter((el) =>
        el.querySelector('[data-testid="tweetText"]')
      ),
      ...[...root.querySelectorAll('div[role="link"]')].filter(
        (el) =>
          el.querySelector('[data-testid="tweetText"]') &&
          el.querySelector('[data-testid="User-Name"]')
      ),
    ];

    return (
      candidates.find((el) => el !== root && (!mainName || !el.contains(mainName))) ||
      null
    );
  }

  function owned(root, quote, selector) {
    return [...root.querySelectorAll(selector)].filter(
      (node) => !quote || !quote.contains(node)
    );
  }

  function readAuthor(scope, excluded) {
    const box = owned(scope, excluded, '[data-testid="User-Name"]')[0];
    if (!box) return { name: "", handle: "" };

    let name = "";
    let handle = "";
    for (const link of box.querySelectorAll('a[href^="/"]')) {
      const href = link.getAttribute("href") || "";
      if (!/^\/[^/?#]+$/.test(href)) continue;
      const text = (link.innerText || "").trim();
      if (!text) continue;
      if (text.startsWith("@")) handle = text.split(/\s/)[0];
      else if (!name) name = text.split("\n")[0].trim();
    }

    if (!handle) {
      const found = (box.innerText || "").match(/@[A-Za-z0-9_]+/);
      if (found) handle = found[0];
    }

    return { name, handle };
  }

  function readText(root, quote) {
    const nodes = owned(root, quote, '[data-testid="tweetText"]');
    return nodes
      .map((node) => (node.innerText || "").trim())
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  function readReplyingTo(root, quote) {
    const handles = [];
    for (const link of owned(root, quote, 'a[href^="/"]')) {
      const parent = link.parentElement;
      if (!parent) continue;
      const text = parent.textContent || "";
      if (!/replying to/i.test(text)) continue;
      if (parent.closest('[data-testid="tweetText"]')) continue;
      for (const item of parent.querySelectorAll("a")) {
        const value = (item.textContent || "").trim();
        if (value.startsWith("@") && !handles.includes(value)) handles.push(value);
      }
    }
    return handles;
  }

  function readMedia(root, quote) {
    const photos = owned(root, quote, '[data-testid="tweetPhoto"] img').map((img) => {
      const alt = (img.alt || "").trim();
      return { alt: alt && alt.toLowerCase() !== "image" ? alt : "Photo" };
    });
    const video = owned(root, quote, '[data-testid="videoPlayer"]');
    return { photos, hasVideo: video.length > 0 };
  }

  function readCard(root, quote) {
    const card = owned(root, quote, '[data-testid="card.wrapper"]')[0];
    if (!card) return "";
    return (card.innerText || "")
      .replace(/\n{2,}/g, "\n")
      .trim()
      .split("\n")
      .slice(0, 3)
      .join("\n")
      .slice(0, 280);
  }

  function readPermalink(root, quote) {
    const time = owned(root, quote, 'a[href*="/status/"] time')[0];
    const link = time?.closest("a");
    const href = link?.getAttribute("href") || "";
    const permalink = href ? absoluteUrl(href) : "";
    const statusId = (permalink.match(/status\/(\d+)/) || [])[1] || "";
    return {
      permalink,
      statusId,
      datetime: time?.getAttribute("datetime") || "",
      timeText: (time?.textContent || "").trim(),
    };
  }

  function articleForStatus(id) {
    if (!id) return null;
    for (const article of articles()) {
      if (isNested(article)) continue;
      if (article.closest('[data-testid="placementTracking"]')) continue;
      const time = article.querySelector('a[href*="/status/"] time');
      const href = time?.closest("a")?.getAttribute("href") || "";
      if (href.includes(`/status/${id}`)) return article;
    }
    return null;
  }

  function articleFromSelection() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.anchorNode) return null;
    const node = selection.anchorNode;
    const element = node.nodeType === 1 ? node : node.parentElement;
    if (!element?.closest) return null;
    if (element.closest('[data-testid^="tweetTextarea_"]')) return null;
    const article = element.closest(ARTICLE);
    if (!article || !column().contains(article)) return null;
    return outerArticle(article);
  }

  function articleInDialog() {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return null;
    const article = dialog.querySelector(ARTICLE);
    return article ? outerArticle(article) : null;
  }

  function articleInView() {
    const list = articles().filter(
      (article) => !isNested(article) && !article.closest('[data-testid="placementTracking"]')
    );
    const viewHeight = window.innerHeight || 800;
    let best = null;
    let bestScore = Infinity;

    for (const article of list) {
      const rect = article.getBoundingClientRect();
      if (rect.bottom < 70 || rect.top > viewHeight - 20) continue;
      const visible = Math.min(rect.bottom, viewHeight) - Math.max(rect.top, 0);
      const distance = Math.abs((rect.top + rect.bottom) / 2 - viewHeight * 0.38);
      const score = distance - visible * 0.12;
      if (score < bestScore) {
        bestScore = score;
        best = article;
      }
    }

    return best || list[0] || null;
  }

  function locate() {
    const selected = articleFromSelection();
    if (selected) return { root: selected, source: "selection" };

    const dialog = articleInDialog();
    if (dialog) return { root: dialog, source: "dialog" };

    const permalink = articleForStatus(statusIdFromPath());
    if (permalink) return { root: permalink, source: "permalink" };

    const visible = articleInView();
    if (visible) return { root: visible, source: "viewport" };

    return { root: null, source: "" };
  }

  function clip(value, max) {
    const text = (value || "").trim();
    if (text.length <= max) return text;
    return text.slice(0, max - 1).trimEnd() + "…";
  }

  function extract(root, source) {
    const quote = findQuote(root);
    const author = readAuthor(root, quote);
    const quotedAuthor = quote ? readAuthor(quote, null) : { name: "", handle: "" };
    const quotedText = quote ? readText(quote, null) : "";
    const meta = readPermalink(root, quote);
    const media = readMedia(root, quote);
    const social = owned(root, quote, '[data-testid="socialContext"]')
      .map((node) => (node.innerText || "").trim())
      .filter(Boolean);

    let thread = [];
    if (source === "permalink") {
      const list = articles().filter(
        (article) => !isNested(article) && !article.closest('[data-testid="placementTracking"]')
      );
      const index = list.indexOf(root);
      if (index > 0) {
        thread = list
          .slice(Math.max(0, index - 2), index)
          .map((article) => {
            const earlierQuote = findQuote(article);
            const earlierAuthor = readAuthor(article, earlierQuote);
            const text = readText(article, earlierQuote);
            if (!text && !earlierAuthor.handle) return null;
            return {
              name: earlierAuthor.name,
              handle: earlierAuthor.handle,
              text: clip(text, 180),
            };
          })
          .filter(Boolean);
      }
    }

    return {
      source,
      name: author.name,
      handle: author.handle,
      text: readText(root, quote),
      replyingTo: readReplyingTo(root, quote),
      social,
      datetime: meta.datetime,
      timeText: meta.timeText,
      permalink: meta.permalink,
      statusId: meta.statusId,
      photos: media.photos.slice(0, 4),
      hasVideo: media.hasVideo,
      card: readCard(root, quote),
      quoted:
        quote && (quotedText || quotedAuthor.handle || quotedAuthor.name)
          ? {
              name: quotedAuthor.name,
              handle: quotedAuthor.handle,
              text: quotedText,
            }
          : null,
      thread,
      pageUrl: location.href,
    };
  }

  let lastRoot = null;

  function mark(root) {
    document.querySelectorAll("[data-xwriter-target]").forEach((node) => {
      delete node.dataset.xwriterTarget;
    });
    if (root) root.dataset.xwriterTarget = "1";
    lastRoot = root;
  }

  async function expandShowMore(root) {
    if (root.dataset.xwriterExpanded === "1") return;
    const quote = findQuote(root);
    const known = owned(root, quote, '[data-testid="tweet-text-show-more-link"]')[0];
    const fallback = owned(root, quote, "button, span[role='button']").find(
      (node) => (node.textContent || "").trim() === "Show more"
    );
    const control = known || fallback;
    root.dataset.xwriterExpanded = "1";
    if (!control || control.tagName === "A") return;
    control.click();
    await sleep(180);
  }

  async function readPost() {
    const id = statusIdFromPath();
    const root = id ? await waitFor(() => articleForStatus(id), 20) : null;
    if (!root) {
      mark(null);
      return null;
    }
    try {
      await expandShowMore(root);
    } catch {
      /* Reading the collapsed text is still useful. */
    }
    mark(root);
    return extract(root, "permalink");
  }

  function ensureHighlightStyle() {
    if (document.getElementById("xwriter-style")) return;
    const style = document.createElement("style");
    style.id = "xwriter-style";
    style.textContent =
      ".xwriter-focus{outline:2px solid #3ecf8e !important;outline-offset:4px !important;border-radius:12px;}";
    document.documentElement.appendChild(style);
  }

  function showPost() {
    const root =
      document.querySelector("[data-xwriter-target='1']") || locate().root;
    if (!root) return { ok: false, error: "No post to show yet." };
    ensureHighlightStyle();
    root.scrollIntoView({ behavior: "smooth", block: "center" });
    root.classList.add("xwriter-focus");
    setTimeout(() => root.classList.remove("xwriter-focus"), 1800);
    return { ok: true };
  }

  function editableOf(node) {
    if (!node) return null;
    if (node.getAttribute("contenteditable") === "true") return node;
    return node.querySelector('[contenteditable="true"]');
  }

  function composerText(node) {
    return (node?.innerText || "").replace(/\u200b/g, "").trim();
  }

  function replyComposer() {
    const dialog = editableOf(
      document.querySelector('[role="dialog"] [data-testid="tweetTextarea_0"]')
    );
    if (dialog) return dialog;
    return editableOf(
      document.querySelector('[data-testid="primaryColumn"] [data-testid="tweetTextarea_0"]')
    );
  }

  function placeCaret(node) {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function landed(before, after, text) {
    const needle = text.replace(/^\n+/, "").trim();
    if (!needle) return after !== before;
    return after.split(needle).length > before.split(needle).length;
  }

  async function textLanded(node, before, text) {
    for (let i = 0; i < 6; i += 1) {
      if (landed(before, composerText(node), text)) return true;
      await sleep(40);
    }
    return false;
  }

  function pasteInto(node, text) {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    node.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      })
    );
  }

  async function typeInto(node, text) {
    node.focus();
    placeCaret(node);
    const before = composerText(node);
    const input = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      composed: true,
      inputType: "insertText",
      data: text,
    });
    node.dispatchEvent(input);
    if (input.defaultPrevented || (await textLanded(node, before, text))) return true;

    pasteInto(node, text);
    return textLanded(node, before, text);
  }

  async function waitFor(finder, attempts = 25) {
    for (let i = 0; i < attempts; i += 1) {
      const found = finder();
      if (found) return found;
      await sleep(120);
    }
    return null;
  }

  async function ensureReplyComposer() {
    const existing = replyComposer();
    if (existing) return existing;

    const root = document.querySelector("[data-xwriter-target='1']") || locate().root;
    const button = root?.querySelector('[data-testid="reply"], button[aria-label*="Reply"]');
    if (!button) {
      throw new Error("Could not find the reply button on this post.");
    }
    button.click();
    const box = await waitFor(replyComposer);
    if (!box) throw new Error("The reply box did not open.");
    return box;
  }

  async function ensurePostComposer() {
    const openDialog = editableOf(
      document.querySelector('[role="dialog"] [data-testid="tweetTextarea_0"]')
    );
    if (openDialog) return openDialog;

    const button = document.querySelector(
      '[data-testid="SideNav_NewTweet_Button"], a[href="/compose/post"]'
    );
    if (button) button.click();

    const dialogBox = await waitFor(() =>
      editableOf(document.querySelector('[role="dialog"] [data-testid="tweetTextarea_0"]'))
    );
    if (dialogBox) return dialogBox;

    const inline = editableOf(document.querySelector('[data-testid="tweetTextarea_0"]'));
    if (inline) return inline;
    throw new Error("The post composer did not open.");
  }

  async function insertDraft(text, mode) {
    const clean = (text || "").replace(/\r\n/g, "\n");
    if (!clean.trim()) return { ok: false, error: "Write a draft first." };
    if (globalThis.__xwriterInserting) return { ok: true, message: "Added to the reply box." };
    globalThis.__xwriterInserting = true;

    try {
      const box = mode === "post" ? await ensurePostComposer() : await ensureReplyComposer();
      const existing = composerText(box);
      const payload = existing ? `\n\n${clean}` : clean;
      box.scrollIntoView({ behavior: "smooth", block: "center" });
      const typed = await typeInto(box, payload);
      if (!typed) {
        return {
          ok: false,
          error: "Could not type into the composer. Click the reply box, then try again.",
        };
      }

      return {
        ok: true,
        message: existing
          ? "Added to the end of the composer."
          : mode === "post"
            ? "Added to the new post."
            : "Added to the reply box.",
      };
    } finally {
      globalThis.__xwriterInserting = false;
    }
  }

  function onMessage(message, _sender, sendResponse) {
    if (message?.type === "XWRITER_READ") {
      readPost()
        .then((post) => sendResponse({ ok: true, post }))
        .catch((error) => sendResponse({ ok: false, error: error?.message || "Could not read the post." }));
      return true;
    }

    if (message?.type === "XWRITER_SHOW") {
      sendResponse(showPost());
      return false;
    }

    if (message?.type === "XWRITER_INSERT_V2") {
      insertDraft(message.text, message.mode === "post" ? "post" : "reply")
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error?.message || "Could not insert the draft." }));
      return true;
    }

    return false;
  }

  if (globalThis.__xwriterOnMessage) {
    chrome.runtime.onMessage.removeListener(globalThis.__xwriterOnMessage);
  }
  globalThis.__xwriterOnMessage = onMessage;
  chrome.runtime.onMessage.addListener(onMessage);
}
