# UI Recorder — Installation Guide (manual install)

Use this guide if you received **ui-recorder-<version>.zip** directly, not from the Chrome Web Store.
It works in **Google Chrome** and **Microsoft Edge** on Windows, macOS and Linux.

## Before you start

- Use Chrome or Edge, version 120 or newer.
- Chrome and Edge only let you install an extension from the store by default. For a manual install you turn on **Developer mode**
  once. This is safe; it only changes the extension page.
- Keep the extracted folder somewhere permanent (for example `C:\UI-Recorder\`). **Do not** install from the Downloads folder or from inside the zip,
  and do not delete the folder afterwards: the browser reads the extension from it.

## 1. Extract the zip

1. Right-click **ui-recorder-<version>.zip** and choose **Extract All…** (Windows) or double-click it (macOS).
2. Move the extracted **ui-recorder** folder to a permanent location, for example `C:\UI-Recorder\`.
3. Open that folder. It must contain **manifest.json** directly inside it, next to **popup**, **content** and **icons**.

## 2. Turn on Developer mode and load the extension

**Google Chrome**

1. Type `chrome://extensions` in the address bar and press Enter.
2. Turn on **Developer mode** (switch at the top right).
3. Click **Load unpacked**.
4. Select the **ui-recorder** folder (the one that contains manifest.json) and click **Select Folder**.

**Microsoft Edge**

1. Type `edge://extensions` in the address bar and press Enter.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select the **ui-recorder** folder and click **Select Folder**.

You should now see **UI Recorder** in the list, with the version number.

## 3. Pin the icon

1. Click the puzzle-piece icon (Extensions) in the toolbar.
2. Find **UI Recorder** and click the pin icon next to it.

The UI Recorder icon now stays visible. Click it to open the menu.

## 4. Check that it works

1. Open any normal website, for example https://example.com.
2. Click the UI Recorder icon, then **Start Step-by-Step Capture**.
3. Click something on the page. A small Pause/Stop control appears at the top right of the page.
4. Click **Stop** on the page. A review page opens with a screenshot of your click.
5. Click **Generate guide**. The files are saved to **Downloads → recordings → steps-<date>**.

Video recording: click **Start Recording**, choose **Chrome Tab** (or Window / Entire Screen), then **Share**. Stop it with the **Stop** control.

## Updating to a new version

1. Close the browser.
2. Replace the contents of the **ui-recorder** folder with the files from the new zip. Keep the same folder location.
3. Open `chrome://extensions` (or `edge://extensions`) and click the **reload** icon (↻) on the UI Recorder card.

## Uninstalling

1. Open `chrome://extensions` (or `edge://extensions`).
2. Click **Remove** on the UI Recorder card and confirm.
3. Optionally delete the **ui-recorder** folder.

Your recordings and guides in the Downloads folder are not removed.

## Privacy

UI Recorder does not send anything to the developer or any third party. Recordings, screenshots and guides stay on your computer.
Full details are in the privacy policy: <PRIVACY POLICY URL>.

## Troubleshooting

| Problem | What to do |
|---|---|
| "Load unpacked" is not visible | Developer mode is still off. Turn it on (step 2). |
| The error **"Manifest file is missing or unreadable"** appears | You selected the wrong folder. Select the folder that directly contains **manifest.json**. |
| The browser warns about developer-mode extensions at startup | This is normal for manually installed extensions. Choose the option that keeps the extension enabled. If it gets switched off anyway, turn it back on from the extensions page. |
| UI Recorder disappeared after a restart | Check the folder was not moved or deleted; if it was, use **Load unpacked** again with the new location. |
| Step capture does nothing on a page | Chrome does not allow extensions on `chrome://` pages, other extensions' pages or the Chrome Web Store. Use a normal website. |
| Steps are missing | Wait for each page to finish loading after a click before clicking again. |

## Support

Contact: <YOUR SUPPORT EMAIL>
