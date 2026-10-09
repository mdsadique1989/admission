# Setup Guide

This guide takes you from a blank Google account to a fully working, deployed admission system. It assumes no prior Apps Script experience.

---

## 0. What you'll need

- A Google account (this will be the "owner" account — it receives all submission notifications by default, and its quota/limits apply to Sheets, Drive, and email sending).
- About 20–30 minutes for the first-time setup.

---

## 1. Create the Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new blank spreadsheet.
2. Name it something recognizable, e.g. `UMV Chochahi Chhapra — Admissions`.
3. **Leave it empty** — `Code.gs` creates the `data`, `admins`, and `auditLog` tabs automatically the first time it runs.
4. Copy the **Sheet ID** from the URL:
   ```
   https://docs.google.com/spreadsheets/d/  1AbCdEfGhIjKlMnOpQrStUvWxYz...  /edit
                                             └──────────── this part ────────────┘
   ```
   Keep this value handy — you'll paste it into a Script Property in step 4.

---

## 2. Create the Google Drive folder

1. Go to [drive.google.com](https://drive.google.com) and create a new folder, e.g. `UMV Admission Photos`.
2. Open the folder and copy its **Folder ID** from the URL the same way:
   ```
   https://drive.google.com/drive/folders/  1XyZ...  
                                             └── this part ──┘
   ```
3. This folder will hold every applicant's photo and signature file. **These files stay private** — the script never sets any public sharing on them. You don't need to touch sharing settings here at all; access is only ever brokered through the deployed script itself (see [ARCHITECTURE.md](./ARCHITECTURE.md#photosignature-storage--access-model)).

---

## 3. Create the Apps Script project

1. From inside the Sheet you created in step 1, go to **Extensions → Apps Script**. This links the script project to that Sheet's project (recommended — simplest permission model).
2. Delete any placeholder code in the editor.
3. Copy the entire contents of `Code.gs` from this project into the editor.
4. Click the save icon (or `Ctrl/Cmd + S`).
5. Rename the project (top-left, "Untitled project") to something like `UMV Admissions Backend`.

---

## 4. Set Script Properties

Script Properties store configuration without hard-coding it into the source.

1. In the Apps Script editor, go to **Project Settings** (the gear icon on the left sidebar).
2. Scroll to **Script Properties** → **Add script property**.
3. Add the following:

| Property | Value | Required? |
|---|---|---|
| `SHEET_ID` | The Sheet ID from step 1 | **Yes** |
| `DRIVE_FOLDER_ID` | The Folder ID from step 2 | **Yes** |
| `ADMIN_PASSWORD` | A password of your choice, e.g. `ChangeMe123!` | Yes, unless you set up the `admins` sheet tab (see [step 9](#9-optional-set-up-per-user-admin-accounts)) |
| `OWNER_NOTIFY_EMAIL` | An email address to receive owner notifications | No — omit to default to whichever Google account owns this deployment |

> `ADMIN_TOKEN_SECRET` is **not** something you set — the script generates and stores it itself the first time any admin logs in.

4. Save.

---

## 5. Deploy as a Web App

1. In the Apps Script editor, click **Deploy → New deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Fill in:
   - **Description:** anything, e.g. `v1`
   - **Execute as:** **Me** (your account) — this is what lets the script read/write the Sheet and Drive folder without visitors needing their own Google account.
   - **Who has access:** **Anyone** — the public form and dashboard both need to reach this URL without being logged into Google.
4. Click **Deploy**.
5. The first time you deploy, Google will ask you to **authorize the app** — click through, choose your account, click "Advanced" → "Go to [project name] (unsafe)" if warned (this warning appears because the app isn't published/verified by Google, which is expected for a private script you wrote yourself), and **Allow** the requested permissions (Sheets, Drive, Gmail).
6. Copy the **Web app URL** shown after deployment. It looks like:
   ```
   https://script.google.com/macros/s/AKfycb.../exec
   ```

> ⚠️ **This URL is version-pinned.** If you edit `Code.gs` later, the live URL keeps serving the *old* code until you explicitly redeploy — see [Updating the backend later](#updating-the-backend-later) below.

---

## 6. Point the frontend files at your deployment

1. Open `index.html` in a text editor. Find:
   ```js
   var CONFIG = {
     WEB_APP_URL: 'https://script.google.com/macros/s/.../exec',
     ...
   };
   ```
2. Replace the URL with the one you copied in step 5.
3. Open `admin.html` and do the same — it has its own `CONFIG.WEB_APP_URL`.
4. Save both files.

---

## 7. Host (or open) the frontend files

You have a few options, roughly in order of how public you want this to be:

- **Just testing locally:** double-click `index.html` / `admin.html` to open them directly in a browser. This works fine for `fetch` calls to the Apps Script URL (no local server needed).
- **A real deployment for applicants to use:** upload `index.html` (and separately, `admin.html` on a non-public or password-aware path) to any static file host — GitHub Pages, Netlify, Google Sites (as an embedded HTML block), or your school's existing web hosting.
- **Keep the admin dashboard private:** since `admin.html` has its own login screen, hosting it at a slightly obscure URL (e.g. `/staff-only/admin.html`) adds a thin extra layer on top of the password, though the password protection is what actually matters — don't rely on URL obscurity alone.

---

## 8. Test end-to-end

1. Open `index.html` and submit a test application for **Class XI or XII**, picking a stream (Arts/Science/Commerce) — confirm the six subject dropdowns populate with the board's own codes (e.g. "Hindi — 306"), that Compulsory Group-2 won't let you re-pick whatever you chose in Group-1, and that the three Electives won't let you pick the same subject twice. Fill in a Roll No (optional — leave it blank once to confirm that's allowed too), a real photo and signature file, and your own email address so you can check the confirmation email in step 4. Confirm you get an Application ID back.
2. Check the Sheet — a new row should appear in the `data` tab, including your Roll No and the `"SubjectName (Code)"` values in the six subject columns.
3. Check your inbox — you should receive the owner notification email (sent to `OWNER_NOTIFY_EMAIL` or your own account), with serial number, Application ID, student name, class, and roll no.
4. Check the applicant email too, at the address you entered — it carries the same set of details as the owner email (serial no., Application ID, name, class, roll no.), not just a bare Application ID.
5. Open `admin.html`, log in with username `admin` and the `ADMIN_PASSWORD` you set in step 4, and confirm the test application appears in the dashboard, with the header showing "Version: ... · Logged in as: admin". Click **"देखें" (View)** on it and confirm the photo/signature load — they're fetched on demand through the `getImage` action rather than being preloaded, so this is the one step that actually exercises that path.
6. Still in `admin.html`, click **"संपादित करें" (Edit)** on the same record. Change a plain field (e.g. the mobile number) and save — confirm the dashboard reflects the change immediately. Since you're logged in as `admin`, you should also see photo/signature upload fields in this modal; try replacing the photo and confirm it updates. If you set up a second, non-`admin` account (step 9), log in as that account instead and confirm its Edit modal has no photo/signature upload fields at all, and that its Export button is simply not present.
7. In `index.html`, try the "आवेदन डाउनलोड करें" (Download Application) tab with the class, DOB, and Application ID/PEN you used — confirm the masked preview appears with **no** photo/signature shown, that it asks for the applicant's 12-digit Aadhaar number before revealing anything (and rejects a wrong one), and that confirming it with the correct Aadhaar produces a full printable copy **with** the photo/signature now visible.
8. Try editing the same test application (via "आवेदन संशोधित करें") **without** touching the photo/signature inputs, and save. Confirm it updates the existing row rather than creating a new one, that the previously-selected stream/subjects reappear correctly in the dropdowns, and that the photo/signature still display correctly afterward — this exercises the "reuse the existing file, don't re-upload" path.

---

## 9. (Optional) Set up per-user admin accounts

By default, all staff share one password (`ADMIN_PASSWORD`). To give individual staff members their own login instead:

1. Open the Sheet and go to the `admins` tab (created automatically the first time anyone logs in, or manually add it with headers `username`, `passwordHash`, `displayName`).
2. For each staff member, you need their password as a **SHA-256 hash, base64-encoded** — matching `hashPassword_()` in `Code.gs`. The easiest way is the bundled **`hash-generator.html`**: open it in any browser (it runs entirely offline — nothing is sent anywhere), enter the username, password, and display name, click **Generate Hash**, then click **Copy Row**. That copies a tab-separated `username / hash / displayName` row ready to paste straight into the `admins` tab.

   *Alternative, if you'd rather not use the tool:* temporarily add and run this function from the Apps Script editor, then copy the value it logs (delete the function afterward):
   ```js
   function generateHash() {
     Logger.log(hashPassword_('the-password-you-want'));
   }
   ```
3. Paste the row into the `admins` tab (or, if you used the Apps Script route, add it by hand): `username` (e.g. `principal`), `passwordHash` (the generated value — never the plain password), `displayName` (e.g. `Principal Sir`).
4. Repeat for each staff account.
5. **Once the `admins` tab has any rows at all, the legacy shared `ADMIN_PASSWORD` stops being used** — every login now requires a matching row in `admins`.
6. **Only the account whose `username` is literally `admin` (case-insensitive) can export data to CSV, or replace a photo/signature when editing a record** — every other account can search, view, edit (text fields), and delete applications exactly the same, but won't see the Export button or the photo/signature upload fields, and is refused server-side if it tries anyway. If you want a particular staff member to have those two abilities, give their row the username `admin` specifically; any other username (e.g. `principal`, `clerk1`) never gets either, regardless of what's in `displayName`.

---

## 10. (Optional) Enable SMS notifications

SMS is disabled by default (`SMS_ENABLED = false` in `Code.gs`) because it requires a paid third-party gateway account this project doesn't include credentials for.

1. Sign up with an SMS API provider (e.g. MSG91, Fast2SMS, Twilio).
2. In `Code.gs`, find `sendSmsNotification_()` and fill in the commented-out `UrlFetchApp.fetch()` call with your provider's real endpoint, auth key, and message format.
3. Store the API key as a Script Property (e.g. `SMS_API_KEY`) rather than hard-coding it.
4. Set `SMS_ENABLED = true` at the top of `Code.gs`.
5. Redeploy (see below).

---

## 11. (Optional) Re-lock photo/signature files from before this system used private storage

Skip this section entirely if this is a fresh setup with no prior applications — there's nothing to re-lock.

If you're updating an existing deployment that used to share photo/signature files publicly ("anyone with the link can view"), that change to private storage only affects **new** uploads going forward. Every file already sitting in your Drive folder from before the update keeps its original public sharing setting — nobody revokes that automatically, since doing so silently could break something without warning. If you want to close that gap for files that already exist, run this once from the Apps Script editor:

1. In the Apps Script editor, add a temporary function (you can delete it afterward):
   ```js
   function relockExistingImages_() {
     var folder = getFolder_();
     var files = folder.getFiles();
     var relocked = 0, alreadyPrivate = 0;
     while (files.hasNext()) {
       var file = files.next();
       try {
         file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
         relocked++;
       } catch (err) {
         alreadyPrivate++;
       }
     }
     Logger.log('Re-locked: ' + relocked + ', already private/skipped: ' + alreadyPrivate);
   }
   ```
2. Select `relockExistingImages_` in the function dropdown and click **Run**.
3. Check **Executions** (left sidebar) for the count.
4. Every file in your Drive folder is now private, including ones from applications submitted before the update. Because `resolveFileId_()` in `Code.gs` already knows how to pull a file ID out of an old public-link column, applicants can still view/edit those older applications exactly as before — the only thing that changed is that the raw Drive link itself no longer works if pasted directly into a browser; it now has to go through the script, same as every new upload.
5. Delete the temporary function once you've confirmed it ran (optional cleanup).

---

## Updating the backend later

Whenever you edit `Code.gs` after the initial deployment:

1. Save your changes in the Apps Script editor.
2. Go to **Deploy → Manage deployments**.
3. Click the pencil/edit icon next to your active Web app deployment.
4. Under **Version**, choose **New version**.
5. Click **Deploy**.

The `/exec` URL stays the same — you do **not** need to update `CONFIG.WEB_APP_URL` in the HTML files after this. Creating a brand-new deployment (instead of a new version of the existing one) *would* generate a different URL, so avoid that unless you specifically want to run two versions side by side.

If the change you made was to `admin.html` itself (rather than `Code.gs`), there's no Apps Script redeployment step at all — just replace the hosted file. It's worth manually bumping the `ADMIN_UI_VERSION` constant near the top of `admin.html`'s script whenever you do this, since that's what the dashboard's header displays next to the logged-in username — a quick way to confirm, at a glance, that a particular browser is actually running your latest copy rather than a cached or stale one.

---

## Migrating data from an older spreadsheet-based version

If you previously ran an older, differently-structured version of this system and have applications sitting in another spreadsheet:

1. Open `Code.gs` and find `importLegacyData_()` near the bottom.
2. Fill in `LEGACY_SHEET_ID` and `LEGACY_SHEET_NAME` with your old spreadsheet's ID and tab name.
3. Fill in `COLUMN_MAP`, mapping each new field name (as used in `HEADERS`) to your old sheet's exact column header text. Leave out any field your old sheet never had — it will just come in blank.
4. **If your old sheet stored photo/signature as Drive links or bare file IDs**, map those under the special `photoUrl` / `signatureUrl` keys in `COLUMN_MAP` — not under `photoFileId`/`signatureFileId` directly. Each one triggers `migrateLegacyImage_()`, which makes a **fresh, private copy** of that file in this deployment's own Drive folder and uses the new copy's ID. The original old file is left completely untouched — if it was public, it stays exactly as public as before; only the new copy is private. This is what makes a migrated application's photo/signature genuinely private going forward, rather than just carrying over a link to a still-exposed original. Skip this step entirely (leave `photoUrl`/`signatureUrl` out of `COLUMN_MAP`) if you'd rather handle photos/signatures separately or not at all.
5. In the Apps Script editor's function dropdown (top toolbar), select `importLegacyData_` and click **Run**.
6. Check **Executions** (left sidebar) for a summary log: how many rows were imported, skipped as duplicates, skipped for having no Application ID, and — if you mapped photo/signature — how many image copies failed (a bad/stale link, or a file the deploying account can't read; that row still imports, just with that one field blank, and the specific failure is logged individually above the summary line).
7. Check the `data` tab to confirm it looks right. If you migrated images, open a row in the admin dashboard and confirm the photo/signature actually display via "View."
8. This function is **not** wired to `doGet`/`doPost`, so nobody can trigger it remotely — it only runs when you manually select and run it from the editor. Re-running it is safe for the row data itself; rows whose `applicationId` already exists are skipped, so you won't get duplicates or a second image copy made for a row that already imported successfully.
9. Once you've confirmed the import, you can delete the `importLegacyData_` and `migrateLegacyImage_` blocks (optional cleanup).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `"Server Configuration Error: SHEET_ID is not set"` | Script Property missing | Add `SHEET_ID` in Project Settings → Script Properties |
| `"Unknown action"` on login/submit | The live deployment is running **older code** than what's in the editor | Deploy → Manage deployments → edit → **New version** → Deploy |
| Login always fails even with the right password | `ADMIN_PASSWORD` property not set, or `admins` tab has rows but none match | Check Script Properties, or check your `admins` tab entries |
| Login works but every action after says "Unauthorized"/"session expired" | Token expired (`TOKEN_TTL_MINUTES`, default 60 min) | Log in again |
| "बहुत अधिक प्रयास" (too many attempts) errors | Rate limiter / lockout tripped from repeated testing | Wait out `LOGIN_LOCKOUT_MINUTES` or `SEARCH_WINDOW_MINUTES`, or use a different browser/incognito window to reset the client-visible state (server-side counters are keyed by username/search value, not IP) |
| Photo/signature upload rejected | Unsupported format | Only JPEG, PNG, and WebP are accepted |
| Photo/signature shows a broken image or "चित्र लोड नहीं हो सका" in the admin dashboard | `getImage` call failed — expired admin session, or the underlying Drive file was deleted/moved out of `DRIVE_FOLDER_ID` | Log in again; if that doesn't fix it, check the file still exists in the configured Drive folder |
| Editing an application re-uploads the photo/signature as a brand-new file every time, even when untouched | The client didn't receive/keep a proper `photoFileId`/`signatureFileId` from the edit-load response — usually means the deployed code is stale (see "Unknown action" row above) | Redeploy a new version, then retest the edit flow |
| Pasting an old photo/signature Drive link directly into a browser shows "You need access" | Expected once files are private (or after running the optional re-lock script in step 11) — this is the point of the change, not a bug | View the image through the admin dashboard's "View" button, or the applicant's own edit/download flow, instead of a bare Drive link |
| No owner notification email arriving | `OWNER_NOTIFY_ENABLED` is off, wrong `OWNER_NOTIFY_EMAIL`, or the owner account's daily Gmail sending quota is exhausted | Check the Script Property, check Apps Script **Executions** log for the specific error, check the owner account's Gmail sent folder/quota |
| Applicant never gets a confirmation email | They left the email field blank (this is by design — email is optional) | No action needed; the owner notification email always fires regardless |
| CSV export button is missing entirely | Expected if logged in as any account other than `admin` — export is restricted to that one username (see [step 9](#9-optional-set-up-per-user-admin-accounts)) | Log in as `admin` if you need to export |
| CSV export button does nothing / errors | Session expired mid-session | Refresh and log in again |
| Edit modal has no photo/signature upload fields | Expected if logged in as any account other than `admin` — photo/signature replacement is restricted the same way export is | Log in as `admin` if you need to replace a photo/signature |
| `"Row changed, please refresh and try again"` on delete | Someone else changed the sheet between page load and the delete click | Click 🔄 Refresh, then retry the delete |
