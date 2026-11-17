# UI Recorder and Documentation

MV3 Chrome extension with two capture modes:

- **Start Recording** — records a tab, window, or the whole screen to a
  `.webm` video file.
- **Start Step-by-Step Capture** — screenshots the active tab on every click
  (highlighting what was clicked) and exports a numbered HTML walkthrough,
  Scribe/Guidde-style.

## Load it

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Click the extension icon, then either:
   - **Start Recording** → pick Tab / Window / Entire Screen in Chrome's
     native picker, or
   - **Start Step-by-Step Capture** → click through the flow you want to
     document in the current tab, then press Stop. A **review page** opens
     (see below) where you check, reorder and delete the screenshots before
     the guide is generated.

Video goes to `Downloads/recordings/recording-<timestamp>.webm`.
Step guides go to `Downloads/recordings/steps-<timestamp>/` as
`index.html` + `step-01.png`, `step-02.png`, … — but only after you press
**Generate guide** on the review page.

### Reviewing a step capture before generating the guide

Stopping a step capture does not export anything. It opens a review page
(`review/review.html`, a tab of the extension) with every captured screenshot
as a card:

- **Reorder** — drag a card to a new position (a blue bar shows where it will
  land), or use the ◀ ▶ buttons on the card. Step numbers update as you move.
- **Delete** — the ✕ button removes a step; an **Undo** appears for 8 seconds.
- **Preview** — click a screenshot to see it full size (Esc or click to close).
- **Generate guide** writes `index.html` + `step-NN.png` in the order and with
  the numbering shown on the page, saves locally and (if turned on) uploads to
  Google Drive. **Discard all** throws the capture away.

Your edits are saved as you make them, so closing the review tab does not lose
anything: the popup then shows **Review captured steps (N)**, which reopens
it. A new step capture can't be started while steps are still waiting for
review — generate or discard them first. Video recordings are unaffected (they
save as soon as you stop).

Both are **also** uploaded to Google Drive, into a folder named "UI Recorder
Recordings" (video files loose in that folder, step guides in their own
`steps-<timestamp>` subfolder) — controlled by the **"Also save to Google
Drive"** checkbox in the popup (on by default once set up; see below). The
popup also shows Drive's status: not set up yet, set up but not signed in, or
connected. A desktop notification confirms upload success/failure — either
way, the local copy is already saved regardless of Drive's state.

While a capture is running, the floating control on the page is a
translucent stop button (50% opacity, full opacity on hover) — hover it to
see recording/step-count details as a tooltip, click it or press Esc to stop.
**Video recording** also gets a second, blue Pause button next to it on the
page overlay (there's no Pause in the popup — only on-page, beside Stop) —
pauses/resumes the same in-progress recording via
`MediaRecorder.pause()`/`.resume()`, so you can stop capturing while you get
the right window/tab set up on screen, without that setup being in the final
video. It's the same recording resumed, not a new source pick — Chrome's
native screen-share indicator stays active the whole time since the
underlying capture never actually stops. The popup still shows "Paused" as
status text while it's paused, just with no button for it there.

**Step-by-step capture** gets the same blue Pause button beside Stop.
Pausing there stops listening for clicks (so browsing around to find the
right spot doesn't get documented as steps) without ending the session — the
step count, and everything captured so far, is untouched. Resuming picks the
click listener back up. This state (paused or not, and the running count)
survives navigating to a new page mid-session, same as the rest of step
capture's multi-page support.

## One-time setup: Google Drive upload

Cloud upload needs a Google OAuth client ID, which only you can create (it's
tied to your Google Cloud account):

1. In the [Google Cloud Console](https://console.cloud.google.com/), create
   or pick a project, then enable the **Google Drive API** for it
   (APIs & Services → Library).
2. **APIs & Services → OAuth consent screen** — configure it (External is
   fine for personal/team use), add the scope
   `https://www.googleapis.com/auth/drive.file`, and add yourself (and any
   teammates) as test users if it stays in "Testing" mode.
3. Load this extension unpacked (`chrome://extensions` → Developer mode →
   Load unpacked), then copy its **ID** from the extensions page.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**,
   type **Chrome Extension**, paste that ID into "Application ID".
5. Copy the resulting client ID into `oauth2.client_id` in
   [manifest.json](manifest.json) (replacing `YOUR_OAUTH_CLIENT_ID...`), then
   reload the extension.

The extension only ever requests the `drive.file` scope — it can see and
manage *only the files it creates*, never your existing Drive contents. The
first upload after this setup will pop Chrome's native Google sign-in/consent
screen; later uploads reuse the cached token silently.

## How it works

- `background.js` — service worker; orchestrates state for both modes,
  creates/closes the offscreen document, throttles screenshot capture,
  triggers downloads.
- `offscreen.js` (`offscreen.html`) — the only place that can hold a
  `MediaStream`. Calls `getDisplayMedia()` (shows Chrome's native
  screen/window/tab picker) and runs `MediaRecorder`. Used only in video mode.
- `content/overlay.js` + `overlay.css` — injected into the tab that was active
  when video recording started; floating "Stop" pill + Esc-to-stop.
- `content/step-recorder.js` + `step-recorder.css` — injected during step
  capture. Listens for clicks (capture phase), briefly outlines the clicked
  element, then asks the background page to screenshot the tab
  (`chrome.tabs.captureVisibleTab`) and records a plain-English description
  ("Clicked button \"Submit\"") for it. Same floating pill + Esc-to-stop as
  video mode, with a live step counter.
- `popup/` — toolbar popup with both Start buttons, Stop, and live status.
- Step capture uses `chrome.scripting.registerContentScripts()` (needs
  `<all_urls>`) to re-inject `content/step-recorder.js` on every page load
  while a session is active, so it survives navigating through a multi-page
  flow. On each load it asks the background page "is my tab the one being
  tracked?" via a `step-recorder-ready` message — a `false`/no answer means
  it does nothing at all, so it's a no-op on every tab except the one you
  started capturing on. Registration is torn down on Stop (and automatically
  if the tracked tab is closed mid-session).
- `drive-upload.js` — shared Drive upload helper (plain `fetch`, no
  `chrome.*` calls), loaded by both `background.js` (`importScripts`) and
  `offscreen.html` (`<script>` tag). Uploads via `uploadType=media` then a
  `PATCH` to set the filename and folder — simpler than a full resumable
  session, at the cost of no automatic resume on network failure for very
  large files.
- Video upload happens **inside the offscreen document**, using the same
  `Blob` `MediaRecorder` already produced (avoids moving a potentially huge
  blob into the service worker). `background.js` only fetches the OAuth
  token and Drive folder ID and hands them over. Step-guide upload happens
  entirely in `background.js`, since the screenshots already live there as
  data URLs.

## Stopping a capture

Three ways, all equivalent:
- Click **Stop** on the floating overlay, or press **Esc**, while that tab has
  focus.
- For video: click Chrome's own native "Stop sharing" control (the infobar
  for a shared tab, or the system-wide bar for a shared window/screen) — this
  is real Chrome UI, always on top, and works regardless of which app has
  focus.
- Open the extension popup and click **Stop**. (For a step capture, Stop
  opens the review page rather than saving straight away.)

## Known limitations (by design, for v1)

- **Esc is not a true global hotkey.** A Chrome extension cannot listen for
  keystrokes while a *different* application has OS focus. If you're
  recording your whole screen and alt-tab into another app, Esc won't reach
  the extension — use Chrome's native "Stop sharing" bar instead, which stays
  on top regardless of focus.
- **The floating overlay only targets the tab that was active when you
  clicked Start.** For video, `getDisplayMedia()` doesn't tell the extension
  which surface the user actually picked (tab/window/screen) or which tab, by
  design (privacy) — if you pick a different tab in the picker, that tab
  won't get the overlay, but you'll still have Chrome's native stop control.
- **Step capture is single-tab, but now survives navigation.** It uses
  `chrome.tabs.captureVisibleTab`, which only works on the browser tab you're
  actively interacting with (not other windows/apps). It *does* survive
  clicking through a multi-page flow: the extension holds `<all_urls>`
  permission and re-injects itself on every page load in the tracked tab
  specifically (every other tab is untouched — the injected script checks
  with the background page and is a silent no-op anywhere else).
- **Clicks inside iframes are recorded too.** Chat widgets (Intercom, Drift,
  Crisp, Tidio, …), embedded popups and frame-based sites live in iframes, so
  the page script runs in **every frame** of the tracked tab (same- and
  cross-origin, including `about:blank`/`srcdoc` ones that appear later). The
  top frame owns the floating Pause/Stop buttons; the other frames only
  listen, and Pause/Resume/Stop apply to all of them. The page-reaction watch
  (see below) also runs in every frame, because a click in a chat window is
  often answered by the *parent* page (hiding the chat iframe): the parent
  starts watching the moment focus moves into an iframe (its window blurs),
  and the background reads the latest change time from all frames. Clicking a
  cross-origin iframe's content is still recorded as that frame's own click —
  its contents can't be read across origins, so the description comes from the
  element hit inside the frame.
- **Step capture screenshots can lag fast clicks slightly.** Each screenshot
  is throttled and retried (up to 4 attempts with backoff) to stay under
  Chrome's `captureVisibleTab` quota.
- **A click that loads something is recorded only after it has finished
  loading.** A step is not stored or counted at the click if that click
  starts loading something — a click on a real link, or, within ~0.8s of the
  real click time (taken in the page, so fast clicks queued behind another
  screenshot aren't judged late), any navigation, iframe, lazy route chunk or
  XHR/fetch, or a spinner on screen, or requests still in flight. (Single-page
  apps, including ones that render their screens inside an `<iframe>`, never
  fire a page-load event, so the tab's loading flag can't be used.) While it
  waits, the floating button pulses amber ("Waiting for the page to finish
  loading…"). The extension watches that tab's network requests (all frames,
  via `chrome.webRequest`, observe-only, only for the tracked tab and only
  while a step session is running), waits until nothing is in flight and
  nothing finished for 0.5s — counting only requests to the page's own site
  that the click started, so analytics/ads/chat traffic and the page's
  background polling never hold a step up — then until no spinner is showing (Element
  UI/Plus `v-loading`, Ant Design, `aria-busy`, or any small element whose
  class contains loading/spinner/skeleton/loader) and the DOM has stopped
  changing in every frame — it keeps waiting while a spinner is up — and only
  then takes the screenshot and records the step (up to 12s per click;
  requests open longer than 6s are treated as long-polls and ignored). Clicks
  that load nothing are recorded about 0.8s after the click, with the click
  highlight still on it. If the page reacts to the click without downloading
  anything — a dialog or dropdown opens, a tab switches — that animation isn't
  on screen yet at the click, so the page watches its DOM for a moment after
  each click (class/style/visibility/child changes, ignoring the extension's
  own button) and, once the changes have stopped (0.3s quiet, at most 2.5s),
  the step is re-shot to include the dialog; a click that changes nothing keeps
  the screenshot taken at the click. This watch also follows **shadow DOMs**
  (open ones, including ones created while watching): popup tools such as
  Wisepops and Claspo render the whole popup inside one, and a page-level
  observer can't see in there. So all three popup moments are recorded after
  they have happened — a click on the page that makes a popup appear, a click
  inside the popup (e.g. an option moving it to its next screen), and closing
  the popup (the "X", "Not now", or the backdrop). An icon-only close button
  is described as `Clicked button "Close"`.
- **What counts as one click.** Only real user clicks become steps: clicks a
  page fires itself (`element.click()`, `dispatchEvent`) are ignored, and a
  double click, or one physical click that reaches the page as several events
  (a `<label>` and its input, a button and its icon), is one step — repeats
  within 0.4s on the same spot or the same control are dropped. Only one copy
  of the page script is ever active on a page (a stale or doubled-up copy
  steps aside), and the background drops a second report of the same click.
  Clicks inside a shadow-DOM widget (many site popups) are described and
  highlighted using the element actually hit, not the widget's host element.
  A click that opens a **new tab or window** (`window.open`, `target=_blank`)
  makes that tab the active one, and a screenshot always shows the active tab,
  so any later (re-)shot is skipped if the tracked tab is no longer on screen
  and the screenshot taken at the click is kept instead. Clicks made inside
  that new tab/window are not recorded (only the tab you started in is
  tracked).
- Steps are always
  ordered by when they were clicked, even if an earlier click is still waiting
  on a slow page. **Waiting never costs a step**: it is only a refinement of
  the screenshot taken at the click. As soon as you click again, or press Stop,
  every step that is still waiting is finished at once with the screenshot it
  already has (so Stop is instant, and clicking quickly through many pages
  records every page). A click that could not be captured at all (the browser
  refused every screenshot attempt) is counted and the review page says how
  many are missing. If waiting fails for any reason, the screenshot taken at
  the click is used. A service-worker keepalive ping from
  the tracked page keeps the network watch alive while you read a page.
- If a screenshot still fails after
  retries, the floating overlay shows "Capture failed — …" for a few seconds
  instead of silently skipping that step — check the browser's own DevTools
  console on the page (F12) for a `[UI Recorder]` log line with the exact
  reason if this keeps happening.
- **Cloud upload requires the one-time Google Cloud setup above.** Until
  `oauth2.client_id` is filled in, Drive uploads fail (with a notification)
  but local saving is unaffected.
- **No resumable upload.** Very large/long recordings are sent in a single
  request; a dropped connection partway through means a failed upload (retry
  by re-running the export isn't currently wired up — the local file is your
  fallback).
- **No upload progress UI.** Video uploads start in parallel with the local
  save; step-guide uploads start once all local screenshot downloads have
  been kicked off. Either way, the popup shows nothing while it's in
  flight — only a completion/failure notification at the end, which can take
  a few seconds to tens of seconds for larger videos.
