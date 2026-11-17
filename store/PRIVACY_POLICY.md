# Privacy Policy — UI Recorder

**Effective date:** <DATE>
**Developer:** <YOUR NAME OR COMPANY>
**Contact:** <YOUR SUPPORT EMAIL>

> **Before you publish:** fill in the three placeholders above, host this page at a public HTTPS URL (a GitHub
> Pages page, your website, or a public Google Doc all work) and paste that URL into the Chrome Web Store
> dashboard → *Privacy* tab → *Privacy policy URL*. Then choose **Version A** or **Version B** below to match
> what you ship, and delete the other.

---

## Summary

UI Recorder works on your own computer. **We do not collect, receive, store, sell or share any of your data.**
We have no servers, no accounts, no analytics and no advertising.

## What the extension does

UI Recorder lets you (1) record a tab, window or screen as a video, and (2) capture a screenshot of each click
in a browser tab to build a step-by-step guide. It only captures while *you* have started a capture, and only
the tab, window or screen *you* chose.

## What is captured, and where it goes

| Data | Why | Where it is kept |
|---|---|---|
| **Video and audio** of the tab, window or screen you choose to share (audio only if you tick the share-audio box in Chrome's sharing dialog) | To create your video file | Saved as a file in your Downloads folder (`Downloads/recordings/`) |
| **Screenshots** of the active tab, taken when you click while a step capture is running | To build your guide | Held temporarily in the browser's local extension storage until you generate or discard the guide; then saved as PNG files in your Downloads folder |
| **A short caption for each click**, such as "Click Save", built from the clicked element's label, text, placeholder or ID | To describe the step | Same as screenshots; written into the guide's `index.html` |
| **Click time and position of the click on the page** | To order the steps and draw the highlight box | Same as screenshots |
| **Extension settings and state** (whether a capture is running, whether paused) | To make the toolbar menu and on-page buttons work | Browser extension storage on your device |

**What is not captured:** keystrokes; text you type into fields; password fields; clipboard contents; your
browsing history; cookies; the addresses of the pages you visit; your location; personal information about you.
The extension reads the labels of the elements you click only to write the caption, and never reads values
typed into inputs.

Screenshots show whatever is on the page at the time — including anything personal on that page. They stay on
your device. **You** decide what to keep: delete steps on the review page, or discard the whole capture.

## Where your files are saved

Only on your device, in the Downloads folder, using Chrome's standard download feature. You can open, move or
delete them at any time. Uninstalling the extension removes its temporary storage but does not delete files
already in your Downloads folder.

## Network use

The extension observes (it never blocks, changes or reads the contents of) the *timing* of web requests made by
the tab you are capturing, solely so it can tell when a page has finished loading before taking a screenshot.
Request details are used in memory for that decision and are never stored or sent anywhere.

---

## Version A — shipping WITHOUT Google Drive

**No data leaves your device.** UI Recorder makes no network requests of its own and has no connection to the
developer or any third party.

## Version B — shipping WITH the Google Drive option

The extension offers an optional **"Also save to Google Drive"** setting, **off unless you turn it on**.

- If you turn it on, Chrome asks you to sign in to Google and grant UI Recorder access with the narrow
  `drive.file` permission. With it, UI Recorder can see and manage **only the files and folders it creates itself**
  (a folder named "UI Recorder Recordings" and what you save into it). It **cannot** see or access any other file
  in your Drive.
- Your videos, screenshots and guides are uploaded **directly from your browser to your own Google Drive**.
  They do not pass through any server owned by the developer.
- The sign-in token is managed by Chrome. The developer never receives it.
- Switch it off or revoke access at any time at <https://myaccount.google.com/permissions>.
- Google's handling of data stored in Drive is governed by [Google's Privacy Policy](https://policies.google.com/privacy).

**Limited Use disclosure.** UI Recorder's use and transfer of information received from Google APIs adheres to
the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements. Data from Google is used only to provide the Drive-upload feature you
turned on, is not transferred to anyone else, is not used for advertising, and is not read by humans.

---

## Permissions and why they are needed

| Permission | Purpose |
|---|---|
| Site access (`<all_urls>`) | To show the on-page Pause/Stop control, detect your clicks and capture screenshots on whichever website you choose to document |
| `scripting` | To place the on-page controls and click recorder in the tab you are capturing |
| `offscreen` | Chrome requires video recording (screen sharing) to run in a hidden extension page |
| `downloads` | To save your video and guide files into your Downloads folder |
| `storage`, `unlimitedStorage` | To hold your captured steps until you review them (screenshots can exceed the default size limit) |
| `webRequest` | To observe request timing so screenshots are taken after the page has finished loading (observation only) |
| `notifications` | To tell you when a capture is saved or has failed |
| `identity` *(Version B only)* | To sign in to Google for the optional Drive upload |

## Children

UI Recorder is a general-purpose tool and is not directed at children under 13.

## Security

All processing happens locally in your browser. Files are written with Chrome's downloads feature to a location
you control.

## Changes to this policy

If this policy changes, the new version will be published at this URL with an updated effective date. If a
change involves collecting data, the extension's listing will say so and Chrome will ask you to approve any
new permissions.

## Contact

Questions or requests: **<YOUR SUPPORT EMAIL>**
