# Chrome Web Store — Submission Pack

Everything you need to fill in the Chrome Web Store Developer Dashboard, in the order the dashboard asks.
Dashboard: <https://chrome.google.com/webstore/devconsole> (one-time US$5 developer registration fee).

---

## 0. Fix these BEFORE you upload

| # | Blocker | What to do |
|---|---|---|
| 1 | `manifest.json` has a **placeholder** `oauth2.client_id` | **Recommended for v1.0: ship without Google Drive.** Delete the whole `"oauth2"` block and remove `"identity"` from `permissions`. The Drive UI hides itself when Drive isn't configured. This also removes a permission warning and speeds up review. *To ship with Drive instead:* create an OAuth client of type **Chrome Extension** in Google Cloud Console, bound to your published extension ID, put the ID in the manifest, and complete Google's OAuth verification (`drive.file` is a non-sensitive scope, which keeps it light) |
| 2 | Version is `0.1.0` | Change to `1.0.0` (`"version"` in `manifest.json`) |
| 3 | **Privacy policy URL** is mandatory | Fill in and host `PRIVACY_POLICY.md` (Version A if no Drive), paste the URL in the *Privacy* tab |
| 4 | **Support contact** | Use your email in the dashboard; replace `<YOUR SUPPORT EMAIL>` in the docs |
| 5 | Never upload `sample/` | It holds saved pages with access tokens. `store/package-extension.ps1` excludes it, `.gitignore` ignores it. Don't zip the project folder by hand |
| 6 | Smoke-test in **Chrome stable** | See §7. Automated tests ran in Microsoft Edge (Chrome 137+ ignores command-line extension loading) |
| 7 | Optional: make the store name longer | Change `"name"` to `UI Recorder: Screen & Step Guide Maker` |

Build the package:

```powershell
powershell -ExecutionPolicy Bypass -File store\package-extension.ps1
```

It writes `dist\ui-recorder-<version>.zip`, lists the contents, and warns about items 1, 2 and the description length.
Upload that zip — nothing else.

---

## 1. Package

Upload `dist/ui-recorder-<version>.zip` (≈ 40 KB).

## 2. Store listing tab

| Field | Value |
|---|---|
| Name | from manifest (see item 7 above) |
| Summary | `Record your screen as video, or click through any workflow and get a step-by-step guide with screenshots.` |
| Description | the block in `PRODUCT_INTRODUCTION.md` |
| Category | Productivity |
| Language | English |
| Icon (128×128) | auto-read from the package |
| Screenshots | the five files in `store/screenshots/screenshot_*.png` (1280×800) |
| Small promo tile | `store/screenshots/promo_tile_small_440x280.png` |
| Marquee promo tile | `store/screenshots/promo_marquee_1400x560.png` |
| Website / support URL | your site or a GitHub repo page (optional but recommended) |

## 3. Privacy tab

### Single purpose (paste)

```
UI Recorder has a single purpose: to capture what you do in the browser as a video recording or as a step-by-step, screenshot-based guide, and save it to your computer.
```

### Permission justifications (paste each into its field)

**offscreen**
```
Chrome requires screen/tab/window video recording (getDisplayMedia and MediaRecorder) to run in an offscreen document, because a Manifest V3 service worker has no DOM or media APIs. It is used only while the user is recording a video.
```

**downloads**
```
Saves the user's finished video recording, and the screenshots and index.html of a generated step guide, into the Downloads folder (Downloads/recordings/). Files are only written when the user stops a recording or clicks "Generate guide".
```

**scripting**
```
Injects the on-page Pause/Stop control and the click recorder into the tab the user chose to capture, and into its frames (so pop-ups, dialogs and chat widgets that live in iframes can be documented). Scripts are injected only after the user clicks Start.
```

**storage**
```
Keeps the capture state (recording / paused) and the steps captured so far so that nothing is lost if the user closes the review page or the browser pauses the extension's background worker.
```

**unlimitedStorage**
```
A step-by-step capture holds one PNG screenshot per click until the user reviews and generates the guide. A long capture can exceed the default extension storage quota, so unlimited storage prevents captured steps from being lost.
```

**notifications**
```
Shows a desktop notification when a recording or guide has been saved, or when a capture could not be completed (for example, if the page cannot be captured), so the user is not left guessing when the toolbar menu is closed.
```

**webRequest**
```
Used in observe-only mode (no blocking, no modification, no reading of request or response bodies or headers) to learn when a click has finished loading its page, so the screenshot for that step is taken after the page has loaded rather than while it is blank. Only request timing is used; nothing is stored or transmitted.
```

**Host permission (<all_urls>)**
```
The user can document a workflow on any website. The extension needs to run its on-page Pause/Stop control and click recorder, and capture a screenshot of the tab, on whichever site the user chooses. It acts only after the user presses Start, only in the tab they started it in, and it does not read or transmit page content.
```

**identity** *(only if shipping with Drive)*
```
Used only for the optional "Also save to Google Drive" feature, to sign in with the user's Google account and upload their own recordings and guides to their own Drive using the narrow drive.file scope. Off by default.
```

**Remote code**
```
No. The extension does not load or execute remotely hosted code. All JavaScript is included in the package.
```

### Data usage disclosure (checkboxes)

Be accurate — the disclosure must match the privacy policy.

| Question | Answer for this extension |
|---|---|
| Personally identifiable information | **No** |
| Health information | No |
| Financial and payment information | No |
| Authentication information | No (no passwords or tokens are collected; Drive sign-in is handled by Chrome) |
| Personal communications | No |
| Location | No |
| Web history | No (page addresses are not stored) |
| User activity (clicks, mouse position, scroll, keystrokes) | **Yes — clicks only** when the user captures steps; they stay on the device. Tick this to be safe, and note in the justification that it is processed locally and never transmitted |
| Website content (text, images, video) | **Yes** — screenshots/video of pages the user chooses to record; they stay on the device. Tick this to be safe |

Then tick all three certifications:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes unrelated to the item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

### Privacy policy URL
`https://<your-host>/privacy` (the hosted `PRIVACY_POLICY.md`)

## 4. Distribution tab

| Field | Suggestion |
|---|---|
| Visibility | **Public** (or *Unlisted* for a soft launch to a few people first) |
| Regions | All regions |
| Pricing | Free |

## 5. Test instructions for the reviewer (paste into "Test instructions" in the *Account* / *Additional info* section)

```
No sign-in or account is needed.

Step-by-step capture:
1. Open any website, for example https://example.com or https://www.wikipedia.org.
2. Click the UI Recorder toolbar icon, then "Start Step-by-Step Capture".
3. A small translucent Pause/Stop control appears at the top-right of the page.
4. Click a few links or buttons on the page and any page it opens.
5. Click the Stop button on the page (or press Esc). A review page opens showing one screenshot per click.
6. Drag/reorder or delete some steps, then click "Generate guide". The guide (index.html and step-NN.png files) is saved to Downloads/recordings/steps-<timestamp>/.

Video recording:
1. Click the toolbar icon, then "Start Recording".
2. Chrome's native "choose what to share" dialog appears; pick "Chrome Tab" and a tab, then Share.
3. A Pause/Stop control appears on the page. Click Pause then Resume, then Stop.
4. The video is saved to Downloads/recordings/recording-<timestamp>.webm.

The extension makes no network requests of its own and has no backend.
```

## 6. Submit and what to expect

1. **Save draft**, then **Submit for review**.
2. Review usually takes from a few hours to a few days. Extensions that request broad host access (`<all_urls>`) and
   `webRequest` can take longer or be asked for justification — the text above is written for that.
3. Choose **Publish automatically** after approval, or **Defer publishing** if you want to time the launch.
4. After approval your listing URL is `https://chromewebstore.google.com/detail/<extension-id>`. Use that URL in
   your own docs and add it to the OAuth client if you ship Drive.

Common rejection reasons to avoid:
- Description or screenshots that don't match the extension → the assets here were produced from the real extension
- Missing or placeholder privacy policy URL
- Permissions requested but not used → every permission above is used; `identity` goes away if you ship without Drive
- Keyword stuffing in the description → the supplied text avoids it
- Name containing a trademark you don't own

## 7. Manual smoke test in Chrome stable (15 minutes, do this before submitting)

Load the **package** (unzip `dist/ui-recorder-<version>.zip` to a new folder and *Load unpacked*) in your normal Chrome:

- [ ] Toolbar icon opens the menu with Start Recording, Start Step-by-Step Capture
- [ ] **Video:** Start Recording → pick *Chrome Tab* → Pause → Resume → Stop → `.webm` appears in Downloads/recordings and **plays**, with sound if you ticked audio
- [ ] **Video:** repeat with *Window* and *Entire Screen*; press Esc to stop once
- [ ] **Steps:** on a normal multi-page site, 5+ clicks including a link to another page → Stop → review shows every click in order
- [ ] **Steps:** a site with a pop-up/dialog and a chat widget → both appear in the guide
- [ ] **Steps:** Pause during capture, click something, Resume → paused click not in the guide
- [ ] Review page: reorder, delete, undo, zoom, Generate → open `index.html`, images load
- [ ] Close the review tab before generating → toolbar shows **Review captured steps**, reopens with edits intact
- [ ] Capturing on `chrome://extensions` shows a clear message rather than failing silently
- [ ] No errors in `chrome://extensions` → UI Recorder → *Errors*

## 8. Updating later

Increase `"version"`, run the packaging script, then *Package → Upload new package* in the dashboard.
Updates are reviewed again; changes to permissions pause auto-updates until users accept the new permission.
