# XWriter

XWriter is a Chrome extension that writes six short replies to the X (Twitter) post you are reading. Tap a reply and XWriter types it into X's reply box for you.

It runs in Chrome's side panel, uses your own OpenAI API key, and only opens on the tab where you started it.

## Features

- **Six replies, six tones.** Every set has a sharp observation, an agreement that adds a point, a genuine question, a respectful disagreement, a witty line, and a warm supportive line.
- **Short and plain.** Each reply is 10 to 12 words in simple everyday English, with no hashtags. If the model misses the length, XWriter asks it once more to fix the replies.
- **Works on a single post page.** Replies are only written when a post is open on its own page (`x.com/<user>/status/<id>`). On the home feed, search, or profiles, XWriter waits until you open a post. It reads that post, any quoted post, and up to two earlier posts in the thread for context.
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

1. On [x.com](https://x.com), click a post so it opens on its own page.
2. Click the XWriter icon, or press **Cmd+Shift+Y** on Mac (**Ctrl+Shift+Y** on Windows and Linux).
3. The first time, click **Settings**, paste your OpenAI API key, and click **Save key**.
4. Wait a few seconds for six replies to appear.
5. Tap a reply to put it in X's reply box, edit it if you want, then post it on X.

Open another post and XWriter writes replies for that post.

## Privacy

- Your OpenAI API key is saved in Chrome's local extension storage on your computer. It is sent only to OpenAI.
- The post text, author handle, any quoted post, and up to two earlier thread posts are sent to OpenAI to write the replies.
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

The model and reply rules are set at the top of `sidepanel.js` (`MODEL` and `REPLY_RULES`).
