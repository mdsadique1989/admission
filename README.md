# UMV Chochahi Chhapra — Online Admission System

A self-contained online admission system for **UMV Chochahi Chhapra, Paroo, Muzaffarpur** (UDISE: 10140301702), built entirely on free Google infrastructure — Google Sheets as the database, Google Drive for file storage, and Google Apps Script as the backend. No paid hosting, no external database, no API keys required for the core system.

The project has three parts:

| File | Role |
|---|---|
| `Code.gs` | Backend — Google Apps Script Web App (API, data storage, auth, email) |
| `index.html` | Public admission form — apply, edit, download/print an application |
| `admin.html` | Staff dashboard — search, view, edit, delete, export applications |

For deployment steps, see **[SETUP_GUIDE.md](./SETUP_GUIDE.md)**.
For how the pieces fit together, see **[ARCHITECTURE.md](./ARCHITECTURE.md)**.

---

## Features

### For applicants (`index.html`)
- **Apply** — a full admission form: class/roll no./stream/subjects, identity numbers (PEN, APAAR, Aadhaar, e-Shiksha, OTR), personal and family details, address, bank details (for scholarship transfer), and photo/signature upload with live preview. **Roll No** is optional — useful for applicants who already have one assigned by the school, but doesn't block submission if left blank.
- **Class XI/XII subject selection matches the official BSEB code sheet exactly** — picking a stream (Arts/Science/Commerce) populates dropdowns for Compulsory Group-1, Compulsory Group-2, three Electives, and an optional Additional subject, each showing the board's own numerical code (e.g. "Hindi — 306"). The dropdowns enforce the board's own rules automatically: Group-2 can't repeat whatever was picked in Group-1, the three Electives can't repeat each other, and Additional can't repeat anything already chosen — so there's no way to end up with an invalid combination, and nobody has to type a subject name (or its code) by hand.
- **Preview before submitting** — a modal shows exactly what will be sent.
- **Edit a submitted application** — re-verify with Aadhaar + mobile number, then load and update the original record (an edit updates the existing row rather than creating a duplicate).
- **Download / print an application** — generates a printable, styled copy in a new window (usable as "Print to PDF").
- **Self-lookup with masked preview** — search by class + DOB + (Application ID or PEN) without logging in; the result is a **masked preview** (most digits of Aadhaar/mobile/bank details hidden, no photo/signature link) that the applicant must confirm before the **full** record is released. Confirming also requires typing the applicant's own 12-digit Aadhaar number — a stronger check than the lookup fields alone, since those are things a classmate or relative could plausibly know or guess.
- **One application per Aadhaar** — duplicate submissions on the same identity number are rejected (edit is offered instead).
- **Lightweight arithmetic CAPTCHA** on the edit-lookup and search actions, as basic bot friction on top of server-side rate limiting.
- **Confirmation email** — sent only if the applicant filled in the optional email field, containing the same details as the owner notification below: serial number, Application ID, student name, class, and roll no.

### For staff (`admin.html`)
- **Username/password login** with signed, expiring session tokens (raw password is never resent after login).
- **Search & filter** applications by class and free text (name, Application ID, PEN, mobile, Aadhaar), paginated server-side.
- **View full record** in a modal. Photo and signature are fetched on demand the moment the modal opens — not preloaded with the record list — since the underlying files are private and only released to an authenticated admin session.
- **Edit** any record's plain data fields directly (fixing a student's typo in their name, mobile, address, class, etc.) without going through the public Aadhaar+mobile edit flow — every logged-in admin account can do this, not just `admin`. The Application ID itself can't be changed this way. **Replacing the photo or signature is restricted to the `admin` account specifically** — every other admin account can edit everything else but doesn't see those upload fields at all, and is refused server-side if it tries anyway.
- **Delete** a record (with a confirmation prompt and a stale-row safety check).
- **CSV export** of the full filtered result set (not just the currently loaded page) — restricted to the account literally named **"admin"**. Every other admin account can search, view, and delete exactly as before, but doesn't see the export button and is refused server-side if it tries anyway.
- **Session auto-expiry handling** — any API call that reports an invalid/expired session bounces the dashboard back to the sign-in screen.
- **Header shows the dashboard's own version string and who's logged in** (e.g. "Version: v1-2026-10-08 · Logged in as: admin") — purely informational, useful for confirming a browser is running the latest `admin.html` after an update.

### Backend (`Code.gs`)
- **Google Sheet as database** — a `data` tab holds every application; columns are looked up by header name everywhere, so new fields can be appended to `HEADERS` and old sheets migrate automatically (existing data is never disturbed).
- **Google Drive for files, kept private** — photos and signatures are decoded from base64, validated (JPEG/PNG/WebP only), and stored as separate files. Files are **not** publicly shared; nobody can view one just by having a link. Bytes are only ever handed out embedded directly in an API response at the exact moment the requester has already earned the right to see them — a successful submission, a matching Aadhaar+mobile edit-lookup, a confirmed search reveal, or an authenticated admin viewing a record — never as a standalone URL. See [ARCHITECTURE.md](./ARCHITECTURE.md) for exactly how.
- **Admin accounts** — an optional `admins` sheet tab (username / SHA-256 password hash / display name) with automatic fallback to a single legacy shared password (`ADMIN_PASSWORD` script property) if that tab is empty.
- **Brute-force protection** — exponential backoff per failed login attempt, temporary lockout after repeated failures, and a sliding-window rate limit on the public search/edit-lookup endpoints.
- **Append-only audit log** — a separate `auditLog` tab records logins, failed logins, exports, and deletions.
- **Owner/staff notification email** — sent on *every* submission and *every* edit, unconditionally (not dependent on the applicant supplying an email address), including a running serial number, Application ID, student name, class, and roll no.
- **SMS notifications** — stubbed out and disabled by default; ready to wire up to a provider (MSG91, Fast2SMS, Twilio, etc.) if needed.
- **One-off legacy data importer** — a function (not wired to any endpoint, so it can't be triggered remotely) for migrating rows from an older spreadsheet-based version of this system.

---

## Tech stack

- **Backend:** Google Apps Script (`doGet` / `doPost` Web App)
- **Database:** Google Sheets
- **File storage:** Google Drive
- **Email:** Apps Script `MailApp` (built-in, no external service)
- **Frontend:** Plain HTML/CSS/vanilla JavaScript — no build step, no frameworks, no dependencies
- **Fonts:** Google Fonts (Noto Sans Devanagari + Inter), loaded via CDN link

---

## Project structure

```
.
├── Code.gs               # Apps Script backend — deploy as a Web App
├── index.html            # Public admission form (apply / edit / download)
├── admin.html            # Staff admin dashboard
├── hash-generator.html   # Optional offline utility — generates admins-sheet password hashes
│                         #   without touching the Apps Script editor; see SETUP_GUIDE.md step 9
├── README.md
├── ARCHITECTURE.md
└── SETUP_GUIDE.md
```

---

## Quick start

1. Read **[SETUP_GUIDE.md](./SETUP_GUIDE.md)** and follow it end to end — it covers creating the Sheet and Drive folder, setting Script Properties, deploying the Web App, and pointing both HTML files at the deployed URL.
2. Open `index.html` in a browser to test the public form.
3. Open `admin.html` and log in to test the dashboard.
4. (Optional) If you want individual staff logins instead of one shared password, open `hash-generator.html` — it runs entirely offline in your browser and produces a ready-to-paste row for the Sheet's `admins` tab. See [SETUP_GUIDE.md, step 9](./SETUP_GUIDE.md#9-optional-set-up-per-user-admin-accounts).

---

## Data privacy notes

- Aadhaar, bank account, and mobile fields are **masked** in the unauthenticated public search preview; the full record — including the photo and signature — is only released after a second confirmation step: a short-lived signed token plus the applicant typing their own 12-digit Aadhaar number.
- **Photo/signature files on Drive are private**, not "anyone with the link." There is no standalone URL for these files at all — bytes are only ever embedded directly into a response the requester has already earned (a successful submission, a matching Aadhaar+mobile edit-lookup, a confirmed search reveal, or an authenticated admin session), or fetched by an admin on demand via a token-checked API call. See [ARCHITECTURE.md](./ARCHITECTURE.md#photosignature-storage--access-model) for the exact mechanism.
  - **Applications submitted before this model was introduced** keep working automatically — the backend recognizes the old-style public link stored on those rows, extracts the underlying file ID from it, and serves the image the same private way from then on. If such an application is ever edited, its row is silently upgraded to the current private-storage fields. There's no manual migration step, **but** the *original* public-link files themselves stay exactly as publicly linkable as they always were unless someone deliberately re-locks them — see the note in `ARCHITECTURE.md` about this being a going-forward change, not a retroactive one.
  - Because photo/signature files no longer have a working public link, a CSV export's photo/signature columns are no longer clickable — they now hold a private Drive file ID, useful only through the admin dashboard's own "View" button.

---

## License

Internal use for UMV Chochahi Chhapra. Adapt freely for your own school's admission process.
