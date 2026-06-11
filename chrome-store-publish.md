# Publishing to the Chrome Web Store

This guide explains how to package and publish the **Showdown Codex Autopilot** extension to the Chrome Web Store.

## 1. Prepare and Package the Extension

The extension files are located in the `extension/` directory. To upload it, you must compress it into a `.zip` archive.

### Command Line (macOS / Linux)
Run this command from the root of the repository:
```bash
zip -r showdown-codex-autopilot.zip extension
```

### Manual Method
1. Open your file finder/explorer.
2. Locate the `extension` folder inside the repository.
3. Right-click the `extension` folder and choose **Compress "extension"** (macOS) or **Send to > Compressed (zipped) folder** (Windows).
4. Rename the resulting zip file to `showdown-codex-autopilot.zip`.

---

## 2. Register as a Chrome Web Store Developer

To publish extensions, you need a Google Chrome Developer account:
1. Go to the [Chrome Developer Dashboard](https://developer.chrome.com/dashboard).
2. Sign in with your Google Account.
3. Accept the developer agreement and pay the one-time developer registration fee (currently $5 USD).

---

## 3. Upload the Extension Zip

1. In the Chrome Developer Dashboard, click **New Item** in the top right.
2. Upload the `showdown-codex-autopilot.zip` file you created in Step 1.
3. Once uploaded, the dashboard will parse your `manifest.json` and create a draft store listing.

---

## 4. Fill in Store Listing Details

You must complete the following sections before submitting the draft:

### Product Details
*   **Name:** Showdown Codex Autopilot (populated from `manifest.json`).
*   **Summary:** Plays Pokemon Showdown autonomously using local codex app-server inference.
*   **Description:**
    ```text
    Showdown Codex Autopilot is a Chrome extension that integrates with your local Codex app-server to play Pokemon Showdown battles autonomously.

    Key Features:
    - Zero-dependency, lightweight Backbone client integration.
    - Token-efficient state parsing and system instructions.
    - Interactive config popup to select models (e.g. gpt-5.4-codex, gpt-5.5) and reasoning efforts.
    - Persistent winrate logging and smooth chat/banter capability.
    
    Setup requires running a local Codex app-server and the included origin proxy to handle websocket communication. Detailed setup and developer instructions can be found in the project's source repository.
    ```
*   **Category:** Developer Tools or Productivity.

### Graphic Assets
You will need to upload:
*   **Store Icon:** A `128x128` pixel PNG image (you can use standard extension icons).
*   **Screenshots:** At least one screenshot of the extension (e.g., showing the popup active on a Pokemon Showdown battle room). Size must be `1280x800` or `640x400` pixels.

---

## 5. Configure Privacy and Permissions

Because the extension requests the `storage` permission and runs content scripts on `play.pokemonshowdown.com`, you must justify these requests in the **Privacy** tab:

1.  **Single Purpose:** Declare that the extension's sole purpose is to "play Pokemon Showdown battles autonomously using local Codex app-server inference".
2.  **Permission Justification:**
    *   `storage`: Used to persist user configuration (enabled state, chosen model, reasoning effort, allowed chat settings) and win/loss statistics across browser sessions.
3.  **Data Usage:**
    *   Certify that the extension does not collect or transmit user data. All API traffic goes directly to the user's local address (`ws://127.0.0.1:8124`) and is not stored or shared by the extension.
    *   Confirm compliance with the Chrome Web Store Developer Terms.

---

## 6. Submit for Review

1. Once all required sections (Store Listing, Privacy, Distribution) are complete, click **Submit for Review**.
2. The Chrome Web Store team will review your extension. Reviews typically take between 24 hours to a few days.
3. Once approved, the extension status will change to **Published**, and it will be available to install from the Chrome Web Store.
