# XWriter

XWriter is a Chrome extension that writes six short replies to the X (Twitter) post you are reading. Tap a reply and XWriter types it into X's reply box for you.

It runs in Chrome's side panel, uses your own OpenAI API key, and only opens on the tab where you started it.

## Features

- **Sounds like a person, not an AI.** Every reply reacts to a specific detail in the post. Lengths vary from a few words to about 20, in plain everyday English. Fragments, lowercase starts, and missing full stops are allowed.
- **Writes in your voice.** Paste a few replies you have written under **Your voice** in Settings and XWriter copies your tone, length, casing, and punctuation.
- **Filters out AI phrases.** XWriter writes about ten candidates, throws out any with typical AI tells (em dashes, hashtags, "resonates", "Great point", "It's not X, it's Y", and similar), asks for replacements if too many fail, and keeps the six most different.
- **Reads the right post.** XWriter picks the post you selected, the post in an open reply dialog, the post on a post's own page, or the post nearest the middle of the screen. It also reads quoted posts and up to two earlier posts in a thread for context.
- **One tap to reply.** Tapping a card opens the reply box if needed and types the reply in. Nothing is posted until you press Reply on X.
- **Stays on its tab.** The side panel only shows on tabs where you opened it, so it does not follow you around.
- **New six.** Get a fresh set of replies for the same post at any time.

## Install

XWriter is not in the Chrome Web Store. Load it from this repository:

1. Clone the repository:
   ```bash
   git clone https://github.com/SNDP-Design/XWriter.git
   ```
2. Open `chrome://extensions` in Chrome (version 116 or newer).
3. Turn on **Developer mode** in the top right.
4. Click **Load unpacked** and choose the `XWriter` folder.
5. Pin XWriter to the toolbar if you like.

## Usage

1. Open a post on [x.com](https://x.com).
2. Click the XWriter icon, or press **Cmd+Shift+Y** on Mac (**Ctrl+Shift+Y** on Windows and Linux).
3. The first time, click **Settings**, paste your OpenAI API key, and click **Save key**.
4. Optional but recommended: under **Your voice**, paste 5 to 10 replies you have written on X, one per line, and click **Save voice**.
5. Wait a few seconds for six replies to appear.
6. Tap a reply to put it in X's reply box, edit it if you want, then post it on X.

Scroll to another post or open a new one and XWriter writes replies for that post.

## Privacy

- Your OpenAI API key and your voice examples are saved in Chrome's local extension storage on your computer. They are sent only to OpenAI.
- The post text, author handle, image descriptions, link preview text, any quoted post, and up to two earlier thread posts are sent to OpenAI to write the replies.
- XWriter has no server of its own and collects no analytics.

## Project structure

| File | Purpose |
| --- | --- |
| `manifest.json` | Chrome extension manifest (Manifest V3). |
| `background.js` | Service worker. Opens the side panel on one tab and passes messages between the panel and X. |
| `content.js` | Runs on X. Finds and reads the current post and types a reply into the composer. |
| `sidepanel.html`, `sidepanel.css`, `sidepanel.js` | The side panel UI, settings, and OpenAI request. |
| `icons/` | Toolbar and store icons. |
| `tools/make_icons.py` | Draws the icons in `icons/` with plain Python. |

## Development

There is no build step. Edit the files, then click the reload button on XWriter's card in `chrome://extensions` and refresh the X tab.

You can open `sidepanel.html` directly in a browser to preview the panel. Outside the extension it shows sample replies instead of calling OpenAI.

To redraw the icons:

```bash
python3 tools/make_icons.py
```

The model, reply rules, and AI-phrase filters are set at the top of `sidepanel.js` (`MODEL`, `REPLY_RULES`, `BANNED_OPENERS`, and `BANNED_PHRASES`).
