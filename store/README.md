# store/ — Chrome Web Store material

| File / folder | What it is |
|---|---|
| [PRODUCT_INTRODUCTION.md](PRODUCT_INTRODUCTION.md) | Store name, short + detailed description (paste-ready), features, audience, FAQ, screenshot captions |
| [USER_GUIDE.md](USER_GUIDE.md) | End-user guide in Markdown with screenshots (host it, or link it from the listing's support URL) |
| [manual/UI-Recorder-User-Manual.html](manual/UI-Recorder-User-Manual.html) and [.pdf](manual/UI-Recorder-User-Manual.pdf) | The same guide as a printable manual: one self-contained HTML file (screenshots embedded) and a 12-page PDF. Rebuild with `python store/manual/build_manual.py` |
| [PRIVACY_POLICY.md](PRIVACY_POLICY.md) | Privacy policy with a "with Drive" and a "without Drive" version — fill the placeholders and host it |
| [STORE_SUBMISSION.md](STORE_SUBMISSION.md) | Dashboard field-by-field answers, permission justifications, reviewer test steps, pre-submit checklist |
| `screenshots/` | 5 store screenshots (1280×800), small promo tile (440×280), marquee (1400×560) |
| `guide-images/` | The 8 images used by the user guide |
| `package-extension.ps1` | Builds `dist/ui-recorder-<version>.zip` containing only runtime files |
| `tools/` | Scripts that drive the real extension in a real browser to test it and regenerate the images |

## Build the upload package

```powershell
powershell -ExecutionPolicy Bypass -File store\package-extension.ps1
```

## Regenerate the screenshots after changing the UI

Needs Node 22+ and Microsoft Edge (Chrome 137+ no longer loads unpacked extensions from the command line).

```bash
node store/tools/make-store-assets.mjs
```

This starts a demo site, runs the 22-check end-to-end test (`tools/e2e.mjs`) against the real extension, and only if
everything passes re-renders the images into `screenshots/` and `guide-images/`.

To run only the tests: `node store/tools/servers.mjs` in one terminal, then `node store/tools/e2e.mjs`
(set `EXT_PATH` to a folder to test an unzipped package instead of the source).

`tools/video-test.mjs` exercises start → pause → resume → stop of the video recorder. Its test switch may record
your whole desktop rather than the tab, so treat the resulting `.webm` as private and don't publish it.
