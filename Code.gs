/**
 * UHS Chochahi Chhapra — Online Admission Backend
 * Secured Configuration, Brute-Force Delay & Enhanced Logic
 */

// ====================== CONFIGURATION ======================
var SHEET_NAME = 'data';
var ADMINS_SHEET_NAME = 'admins';       // optional: username / passwordHash / displayName
var AUDIT_SHEET_NAME = 'auditLog';      // append-only admin action log

var ADMIN_PASSWORD_PROPERTY = 'ADMIN_PASSWORD';     // legacy single-password fallback
var SHEET_ID_PROPERTY = 'SHEET_ID';
var DRIVE_FOLDER_ID_PROPERTY = 'DRIVE_FOLDER_ID';
var TOKEN_SECRET_PROPERTY = 'ADMIN_TOKEN_SECRET';   // auto-generated on first use
var TIMEZONE = 'Asia/Kolkata';

// ---- Admin session / brute-force protection ----
var TOKEN_TTL_MINUTES = 60;         // how long an admin login session stays valid
var MAX_LOGIN_ATTEMPTS = 5;         // failed attempts allowed before lockout
var LOGIN_LOCKOUT_MINUTES = 15;     // lockout duration after MAX_LOGIN_ATTEMPTS is hit
var LOGIN_BASE_DELAY_MS = 1200;     // grows with each failed attempt (throttling)

// ---- Public search endpoint protection ----
var SEARCH_MAX_ATTEMPTS_PER_KEY = 8;   // attempts against one specific record
var SEARCH_WINDOW_MINUTES = 10;
var REVEAL_TOKEN_TTL_MINUTES = 3;      // how long a "masked preview -> full record" token lasts

// ---- Notifications (native Apps Script mail; no external service needed) ----
var EMAIL_NOTIFICATIONS_ENABLED = true;

// ---- Owner/staff notification on every submission ----
// Sent to whoever owns this deployment (the account used in "Execute as: Me"),
// or to a specific address if you set OWNER_NOTIFY_EMAIL as a Script Property.
var OWNER_NOTIFY_ENABLED = true;
var OWNER_NOTIFY_EMAIL_PROPERTY = 'OWNER_NOTIFY_EMAIL'; // optional override

// ---- Optional SMS notifications ----
// Disabled by default: sending SMS requires a paid third-party gateway account
// (e.g. MSG91, Fast2SMS, Twilio) that this project does not include credentials for.
// To enable: set SMS_ENABLED = true and fill in sendSmsNotification_() with your
// provider's UrlFetchApp call (see setup_guide.md).
var SMS_ENABLED = false;

var HEADERS = [
  'applicationId', 'submittedAt', 'updatedAt', 'admClass', 'rollNo', 'stream',
  'langGroup', 'subComp1', 'subComp2', 'subElec1', 'subElec2', 'subElec3', 'subAddl',
  'pen', 'apaar', 'aadhar', 'eshiksha', 'otr',
  'studentName', 'dob', 'gender', 'category', 'religion',
  'motherName', 'fatherName', 'aadharOwner', 'guardianAadhar', 'mobile', 'email',
  'address', 'pincode',
  'distance', 'cwsn', 'income', 'bloodGroup', 'height', 'weight',
  'prevUdise',
  'bankAccount', 'ifsc', 'bankName', 'accHolder', 'accRelation',
  'photoFileId', 'signatureFileId'  // Drive file IDs — files are private; bytes are only ever
    // returned embedded in an authorized response (submit/edit/reveal) or via the admin
    // getImage action, never as a standalone public URL. See ARCHITECTURE.md.
  // deviceInfo / geoLocationName / geoLocationLink (browser-reported device info and
  // consent-based location logging) have been removed by request. Existing rows that
  // already have data under those old column headers are untouched — getSheet_() only
  // ever appends missing columns, never deletes existing ones — this just stops writing
  // anything new into them going forward. See ARCHITECTURE.md.
];
// =============================================================

function getSheetId_() {
  var id = PropertiesService.getScriptProperties().getProperty(SHEET_ID_PROPERTY);
  if (!id) {
    throw new Error('Server Configuration Error: SHEET_ID is not set in Script Properties.');
  }
  return id;
}

function getDriveFolderId_() {
  var id = PropertiesService.getScriptProperties().getProperty(DRIVE_FOLDER_ID_PROPERTY);
  if (!id) {
    throw new Error('Server Configuration Error: DRIVE_FOLDER_ID is not set in Script Properties.');
  }
  return id;
}

function formatDateDMY_(value) {
  if (value === '' || value === null || value === undefined) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, TIMEZONE, 'dd/MM/yyyy');
  }
  var str = String(value).trim();
  var iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[3] + '/' + iso[2] + '/' + iso[1];
  var dmy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmy) {
    var dd = ('0' + dmy[1]).slice(-2);
    var mm = ('0' + dmy[2]).slice(-2);
    return dd + '/' + mm + '/' + dmy[3];
  }
  return str;
}

function getSheet_() {
  var ss = SpreadsheetApp.openById(getSheetId_());
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  } else {
    // IMPORTANT: never overwrite the whole header row in place when new
    // fields are added to HEADERS — the rest of the codebase always looks
    // up columns by name (headers.indexOf(key)), never by fixed position,
    // so any column missing from an existing sheet can simply be APPENDED
    // at the end without disturbing already-stored data in other columns.
    var lastCol = sheet.getLastColumn();
    var currentHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var missing = HEADERS.filter(function (h) { return currentHeaders.indexOf(h) === -1; });
    if (missing.length > 0) {
      sheet.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
    }
  }
  return sheet;
}

function getFolder_() {
  return DriveApp.getFolderById(getDriveFolderId_());
}

function genAppId_() {
  var stamp = Utilities.formatDate(new Date(), TIMEZONE, 'yyMMdd');
  var rand = Math.floor(1000 + Math.random() * 9000);
  return 'UHSK' + stamp + rand;
}

/**
 * Saves an image data URL to Drive as a PRIVATE file (no public sharing).
 * Returns { fileId: string, error: string|null }. On an unsupported/invalid
 * image, fileId is '' and error explains why, instead of silently discarding it.
 *
 * `input` may also already be a bare Drive file ID (not a data: URI) — this
 * happens on the edit path when the applicant didn't touch the photo/signature
 * input, so the previously-saved file is simply reused rather than re-uploaded.
 */
function saveImage_(input, filenamePrefix) {
  if (!input) return { fileId: '', error: null }; // nothing supplied — caller decides if that's required
  var str = String(input);

  // Already a Drive file ID from a previous save (unchanged on edit) — reuse, no re-upload.
  if (str.indexOf('data:') !== 0 && /^[a-zA-Z0-9_-]{10,80}$/.test(str)) {
    return { fileId: str, error: null };
  }

  var match = str.match(/^data:(image\/([a-zA-Z0-9.+-]+));base64,(.+)$/i);
  if (!match) {
    return { fileId: '', error: 'चित्र फाइल पढ़ी नहीं जा सकी। कृपया JPEG, PNG या WebP फोटो अपलोड करें।' };
  }

  var mime = match[1].toLowerCase();
  var allowed = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  if (!allowed.hasOwnProperty(mime)) {
    return { fileId: '', error: 'असमर्थित चित्र प्रारूप (' + mime + ')। केवल JPEG, PNG या WebP स्वीकार्य है।' };
  }
  var ext = allowed[mime];
  var base64 = match[3];

  var bytes;
  try {
    bytes = Utilities.base64Decode(base64);
  } catch (err) {
    return { fileId: '', error: 'चित्र फाइल दूषित है। कृपया दोबारा अपलोड करें।' };
  }

  var blob = Utilities.newBlob(bytes, mime, filenamePrefix + '.' + ext);
  var file = getFolder_().createFile(blob);
  // Deliberately NOT shared publicly (no setSharing call). The file stays
  // private to the owning account; its bytes are only ever handed out
  // embedded as a base64 data URI in a response the caller already earned
  // the right to (submit/edit/reveal), or via the admin getImage action for
  // staff viewing a record on demand. See ARCHITECTURE.md for the rationale.
  return { fileId: file.getId(), error: null };
}

/**
 * Reads a private Drive file and returns it as a base64 data URI, ready to
 * drop straight into an <img src="..."> — the only way this project ever
 * exposes an image's bytes now that files are no longer publicly shared.
 * Returns '' (rather than throwing) if fileId is blank or the file can't be
 * read, so callers can treat a missing photo/signature as "just not shown."
 */
function imageDataUri_(fileId) {
  if (!fileId) return '';
  try {
    var blob = DriveApp.getFileById(fileId).getBlob();
    return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
  } catch (err) {
    return '';
  }
}

/**
 * Returns a usable Drive file ID for an image field, preferring the new
 * `newKey` (photoFileId/signatureFileId) but falling back to extracting the
 * file ID out of an old public thumbnail URL stored under `legacyKey`
 * (photoUrl/signatureUrl) for applications submitted before private storage
 * was introduced. This lets old applications keep working (viewable by
 * staff, editable by the applicant) without any manual migration step —
 * and if an old application IS edited, saveImage_'s reuse check means it
 * gets a proper photoFileId/signatureFileId written back automatically.
 */
function resolveFileId_(record, newKey, legacyKey) {
  if (record[newKey]) return String(record[newKey]);
  var legacyUrl = record[legacyKey];
  if (legacyUrl) {
    var m = String(legacyUrl).match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (m) return m[1];
  }
  return '';
}

// =================================================================
//                    ADMIN AUTH / SESSIONS / AUDIT
// =================================================================

/**
 * Returns (creating if necessary) the HMAC secret used to sign admin session
 * tokens. Auto-generated on first use and stored in Script Properties, so
 * nobody has to invent or paste in a secret manually.
 */
function getTokenSecret_() {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty(TOKEN_SECRET_PROPERTY);
  if (!secret) {
    secret = Utilities.getUuid() + '-' + Utilities.getUuid();
    props.setProperty(TOKEN_SECRET_PROPERTY, secret);
  }
  return secret;
}

function hmac_(text) {
  var raw = Utilities.computeHmacSha256Signature(text, getTokenSecret_());
  return Utilities.base64EncodeWebSafe(raw);
}

function hashPassword_(password) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(password || ''));
  return Utilities.base64Encode(raw);
}

/** Signs `username|expiryEpochMs` into a token the client stores and resends. */
function issueToken_(username) {
  var expiry = Date.now() + TOKEN_TTL_MINUTES * 60 * 1000;
  var payload = username + '|' + expiry;
  var sig = hmac_(payload);
  return Utilities.base64EncodeWebSafe(Utilities.newBlob(payload).getBytes()) + '.' + sig;
}

/** Verifies a token's signature and expiry. Returns {valid, username, error}. */
function verifyToken_(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') === -1) {
    return { valid: false, error: 'Missing or malformed session token.' };
  }
  var parts = token.split('.');
  var payload;
  try {
    payload = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString();
  } catch (e) {
    return { valid: false, error: 'Malformed session token.' };
  }
  var expectedSig = hmac_(payload);
  if (expectedSig !== parts[1]) {
    return { valid: false, error: 'Invalid session token.' };
  }
  var segs = payload.split('|');
  var username = segs[0];
  var expiry = Number(segs[1]);
  if (!expiry || Date.now() > expiry) {
    return { valid: false, error: 'Session expired, please log in again.' };
  }
  return { valid: true, username: username };
}

/** Ensures the `admins` tab exists (username / passwordHash / displayName). Does not seed any rows. */
function getAdminsSheet_() {
  var ss = SpreadsheetApp.openById(getSheetId_());
  var sheet = ss.getSheetByName(ADMINS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(ADMINS_SHEET_NAME);
    sheet.appendRow(['username', 'passwordHash', 'displayName']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function findAdminByUsername_(username) {
  var data = getAdminsSheet_().getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toLowerCase() === String(username).trim().toLowerCase()) {
      return { row: i + 1, username: data[i][0], passwordHash: data[i][1], displayName: data[i][2] || data[i][0] };
    }
  }
  return null;
}

/**
 * Checks CacheService-backed failed-attempt counters for a lockout key
 * (e.g. a username, or "global" for endpoints with no identity concept).
 * Returns { blocked: boolean, waitSeconds: number }.
 */
function isLockedOut_(key) {
  var cache = CacheService.getScriptCache();
  var raw = cache.get('lockout_' + key);
  if (!raw) return { blocked: false, waitSeconds: 0 };
  var info = JSON.parse(raw);
  var remainingMs = info.until - Date.now();
  if (remainingMs > 0) {
    return { blocked: true, waitSeconds: Math.ceil(remainingMs / 1000) };
  }
  return { blocked: false, waitSeconds: 0 };
}

function recordFailedAttempt_(key) {
  var cache = CacheService.getScriptCache();
  var countKey = 'fails_' + key;
  var raw = cache.get(countKey);
  var count = (raw ? parseInt(raw, 10) : 0) + 1;
  cache.put(countKey, String(count), LOGIN_LOCKOUT_MINUTES * 60);

  // Throttle every attempt a little more the more it fails (basic exponential backoff).
  var delay = Math.min(LOGIN_BASE_DELAY_MS * count, 8000);
  Utilities.sleep(delay);

  if (count >= MAX_LOGIN_ATTEMPTS) {
    var until = Date.now() + LOGIN_LOCKOUT_MINUTES * 60 * 1000;
    cache.put('lockout_' + key, JSON.stringify({ until: until }), LOGIN_LOCKOUT_MINUTES * 60);
  }
  return count;
}

function clearFailedAttempts_(key) {
  var cache = CacheService.getScriptCache();
  cache.remove('fails_' + key);
  cache.remove('lockout_' + key);
}

/** Ensures the append-only audit log tab exists. */
function getAuditSheet_() {
  var ss = SpreadsheetApp.openById(getSheetId_());
  var sheet = ss.getSheetByName(AUDIT_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(AUDIT_SHEET_NAME);
    sheet.appendRow(['timestamp', 'username', 'action', 'detail']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function logAudit_(username, action, detail) {
  try {
    var ts = Utilities.formatDate(new Date(), TIMEZONE, 'dd-MM-yyyy HH:mm:ss');
    getAuditSheet_().appendRow([ts, username || '(unknown)', action, detail || '']);
  } catch (e) {
    Logger.log('Audit log failed: ' + e.message);
  }
}

/**
 * Validates admin credentials against the `admins` sheet tab first; if that
 * tab has no rows at all, falls back to the legacy single ADMIN_PASSWORD
 * script property (username defaults to "admin") so existing deployments
 * keep working without any migration step.
 * Returns { ok: boolean, displayName: string|null }.
 */
function verifyAdminCredentials_(username, password) {
  var admins = getAdminsSheet_().getDataRange().getValues();
  var hasAccounts = admins.length > 1;

  if (hasAccounts) {
    var admin = findAdminByUsername_(username);
    if (!admin) return { ok: false };
    var ok = admin.passwordHash === hashPassword_(password);
    return { ok: ok, displayName: admin.displayName };
  }

  // Legacy fallback: single shared password, username is informational only.
  var real = PropertiesService.getScriptProperties().getProperty(ADMIN_PASSWORD_PROPERTY);
  if (!real) return { ok: false };
  var isValid = String(password || '') === real;
  return { ok: isValid, displayName: username || 'admin' };
}

/**
 * POST { action: "adminLogin", username, password } -> { success, token, displayName, expiresAt }
 * Replaces sending the raw password on every subsequent admin call.
 */
function handleAdminLogin_(body) {
  var username = String(body.username || 'admin').trim();
  var lockKey = username.toLowerCase();

  var lock = isLockedOut_(lockKey);
  if (lock.blocked) {
    return jsonOut_({
      success: false,
      error: 'बहुत अधिक गलत प्रयासों के कारण अस्थायी रूप से लॉक। कृपया ' + Math.ceil(lock.waitSeconds / 60) + ' मिनट बाद पुनः प्रयास करें।'
    });
  }

  var result = verifyAdminCredentials_(username, body.password);
  if (!result.ok) {
    recordFailedAttempt_(lockKey);
    logAudit_(username, 'login_failed', '');
    return jsonOut_({ success: false, error: 'उपयोगकर्ता नाम या पासवर्ड गलत है / Incorrect username or password.' });
  }

  clearFailedAttempts_(lockKey);
  var token = issueToken_(username);
  logAudit_(username, 'login_success', '');

  return jsonOut_({
    success: true,
    token: token,
    username: username,
    displayName: result.displayName || username,
    expiresAt: Date.now() + TOKEN_TTL_MINUTES * 60 * 1000
  });
}

/** Verifies a session token for any admin-only action; returns username or throws via caller check. */
function requireAdminToken_(body) {
  return verifyToken_(body.token);
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------------------- POST: router ----------------------
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);

    if (body.action === 'submit') return handleSubmit_(body);
    if (body.action === 'loadForEdit') return handleLoadForEdit_(body);
    if (body.action === 'adminLogin') return handleAdminLogin_(body);
    if (body.action === 'adminList') return handleAdminList_(body);
    if (body.action === 'adminExport') return handleAdminExport_(body);
    if (body.action === 'adminDelete') return handleAdminDelete_(body);
    if (body.action === 'getImage') return handleGetImage_(body);
    if (body.action === 'searchReveal') return handleSearchReveal_(body);

    return jsonOut_({ success: false, error: 'Unknown action' });
  } catch (err) {
    return jsonOut_({ success: false, error: err.message });
  }
}

// ---- Handles both new submissions and updates ----
function handleSubmit_(body) {
  var cleanAadhar = String(body.aadhar || '').replace(/\D/g, '');
  var cleanOtr = String(body.otr || '').replace(/\D/g, '');
  if (cleanOtr && cleanOtr.length !== 14) {
    return jsonOut_({ success: false, error: 'OTR संख्या 14 अंकों की होनी चाहिए।', field: 'otr' });
  }
  var isEdit = Boolean(body.isEdit && body.applicationId);
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);

  try {
    var sheet = getSheet_();
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var aadharCol = headers.indexOf('aadhar');
    var appIdCol = headers.indexOf('applicationId');
    var existingRowIndex = -1;

    // Verify Unique identity number (where entered)
    if (cleanAadhar) {
      for (var i = 1; i < data.length; i++) {
        var rowAadhar = String(data[i][aadharCol] || '').replace(/\D/g, '');
        if (rowAadhar === cleanAadhar) {
          if (isEdit && String(data[i][appIdCol]) === String(body.applicationId)) {
            existingRowIndex = i + 1;
          } else {
            return jsonOut_({ 
              success: false, 
              error: 'इस पहचान संख्या से पहले ही आवेदन भरा जा चुका है (Application ID: ' + data[i][appIdCol] + ')। यदि आप संशोधन करना चाहते हैं तो "आवेदन संशोधित करें" विकल्प का उपयोग करें।'
            });
          }
        }
      }
    }

    if (isEdit && existingRowIndex === -1) {
      for (var j = 1; j < data.length; j++) {
        if (String(data[j][appIdCol]) === String(body.applicationId)) {
          existingRowIndex = j + 1;
          break;
        }
      }
      if (existingRowIndex === -1) {
        return jsonOut_({ success: false, error: 'संशोधन के लिए मूल आवेदन नहीं मिला।' });
      }
    }

    var appId = isEdit ? body.applicationId : genAppId_();

    var photoResult = saveImage_(body.photo, appId + '_photo');
    if (photoResult.error) {
      return jsonOut_({ success: false, error: photoResult.error, field: 'photo' });
    }
    if (!isEdit && !photoResult.fileId) {
      return jsonOut_({ success: false, error: 'छात्र का फोटो अपलोड करें।', field: 'photo' });
    }

    var sigResult = saveImage_(body.signature, appId + '_signature');
    if (sigResult.error) {
      return jsonOut_({ success: false, error: sigResult.error, field: 'signature' });
    }
    if (!isEdit && !sigResult.fileId) {
      return jsonOut_({ success: false, error: 'छात्र का हस्ताक्षर अपलोड करें।', field: 'signature' });
    }

    var photoFileId = photoResult.fileId;
    var signatureFileId = sigResult.fileId;
    var dobFormatted = formatDateDMY_(body.dob);
    var nowTimestamp = Utilities.formatDate(new Date(), TIMEZONE, 'dd-MM-yyyy HH:mm');

    var rowValues = headers.map(function(key) {
      if (key === 'applicationId') return appId;
      if (key === 'submittedAt') return isEdit ? data[existingRowIndex - 1][headers.indexOf('submittedAt')] : nowTimestamp;
      if (key === 'updatedAt') return isEdit ? nowTimestamp : '';
      if (key === 'dob') return dobFormatted;
      if (key === 'aadhar') return cleanAadhar;
      if (key === 'otr') return cleanOtr;
      if (key === 'photoFileId') return photoFileId;
      if (key === 'signatureFileId') return signatureFileId;
      return body[key] !== undefined ? String(body[key]).trim() : '';
    });

    if (isEdit) {
      sheet.getRange(existingRowIndex, 1, 1, headers.length).setValues([rowValues]);
      var dobIdx = headers.indexOf('dob') + 1;
      sheet.getRange(existingRowIndex, dobIdx).setNumberFormat('@').setValue(dobFormatted);
    } else {
      sheet.appendRow(rowValues);
      var lastRow = sheet.getLastRow();
      var dobColIdx = headers.indexOf('dob') + 1;
      sheet.getRange(lastRow, dobColIdx).setNumberFormat('@').setValue(dobFormatted);
    }

    // Total application count = number of data rows right now. Since an edit
    // updates a row in place rather than adding one, this number is
    // effectively "this was the Nth application received" for new
    // submissions, and stays meaningful (current total) for edits too.
    // Computed once here so the applicant's own confirmation email (below)
    // and the owner notification both show the identical serial number.
    var serialNo = sheet.getLastRow() - 1;

    // Best-effort notifications — never let a mail/SMS failure fail the submission itself.
    try {
      if (EMAIL_NOTIFICATIONS_ENABLED && body.email) {
        sendApplicationEmail_(String(body.email).trim(), serialNo, appId, body.studentName, body.admClass, body.rollNo, isEdit);
      }
    } catch (mailErr) {
      Logger.log('Email notification failed: ' + mailErr.message);
    }
    try {
      if (SMS_ENABLED && body.mobile) {
        sendSmsNotification_(cleanMobile_(body.mobile), appId, isEdit);
      }
    } catch (smsErr) {
      Logger.log('SMS notification failed: ' + smsErr.message);
    }
    try {
      if (OWNER_NOTIFY_ENABLED) {
        sendOwnerNotificationEmail_(serialNo, appId, body.studentName, body.admClass, body.rollNo, isEdit);
      }
    } catch (ownerMailErr) {
      Logger.log('Owner notification failed: ' + ownerMailErr.message);
    }

    // Echo back something the browser can display immediately. If the
    // applicant just uploaded a fresh file, `body.photo`/`body.signature`
    // IS already a base64 data URI — reuse it directly rather than paying
    // for an extra Drive read. Only the "unchanged on edit" case (where
    // body.photo is a bare fileId, not new bytes) needs to actually read
    // the file back from Drive.
    var photoDataUri = (String(body.photo || '').indexOf('data:') === 0) ? body.photo : imageDataUri_(photoFileId);
    var signatureDataUri = (String(body.signature || '').indexOf('data:') === 0) ? body.signature : imageDataUri_(signatureFileId);

    return jsonOut_({
      success: true,
      isEdit: isEdit,
      applicationId: appId,
      photoFileId: photoFileId,
      signatureFileId: signatureFileId,
      photoDataUri: photoDataUri,
      signatureDataUri: signatureDataUri
    });

  } finally {
    lock.releaseLock();
  }
}

function cleanMobile_(value) {
  return String(value || '').replace(/\D/g, '');
}

/**
 * Sends a confirmation email to the APPLICANT using Apps Script's built-in
 * MailApp — no external service or API key required. Only fires if the
 * applicant chose to fill in the optional email field; silently does nothing
 * if it's blank or looks invalid. Fires on both a fresh submission and an
 * edit of a previous one (isEdit distinguishes the two).
 *
 * Mirrors the owner notification's content exactly — serial no., Application
 * ID, student name, class, roll no. — rather than a bare Application ID.
 */
function sendApplicationEmail_(toEmail, serialNo, appId, studentName, admClass, rollNo, isEdit) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) return;
  var subject = (isEdit
    ? 'आवेदन संशोधित / Application Updated'
    : 'आवेदन प्राप्त / Application Received') + ' — ' + appId;
  var body =
    (isEdit ? 'आपका आवेदन सफलतापूर्वक संशोधित कर दिया गया है।\nYour application has been updated successfully.\n\n'
            : 'आपका आवेदन सफलतापूर्वक प्राप्त हो गया है।\nYour application has been received successfully.\n\n') +
    'क्रम संख्या / Serial No.: ' + serialNo + '\n' +
    'Application ID: ' + appId + '\n' +
    'विद्यार्थी का नाम / Student Name: ' + (studentName || '—') + '\n' +
    'कक्षा / Class: ' + (admClass || '—') + '\n' +
    'रोल नंबर / Roll No.: ' + (rollNo || '—') + '\n\n' +
    'कृपया इस Application ID को सुरक्षित रखें।\nPlease keep this Application ID safe.';
  MailApp.sendEmail(toEmail, subject, body);
}

/**
 * Returns the email address that should receive owner/staff notifications:
 * an explicit OWNER_NOTIFY_EMAIL Script Property if set, otherwise the
 * Google account that owns this deployment (the "Execute as: Me" account).
 */
function getOwnerEmail_() {
  var override = PropertiesService.getScriptProperties().getProperty(OWNER_NOTIFY_EMAIL_PROPERTY);
  if (override) return override.trim();
  var effective = Session.getEffectiveUser().getEmail();
  return effective || '';
}

/**
 * Notifies the deployment owner (or OWNER_NOTIFY_EMAIL, if set) every time a
 * form is submitted OR edited — regardless of whether the applicant filled
 * in their own optional email field; this owner copy is unconditional.
 * Includes a running serial number (how many applications are on file so
 * far), the Application ID, student name, class, and roll no.
 *
 * Browser-reported device info and consent-based location logging (both
 * previously included here) have been removed by request.
 */
function sendOwnerNotificationEmail_(serialNo, appId, studentName, admClass, rollNo, isEdit) {
  var ownerEmail = getOwnerEmail_();
  if (!ownerEmail) return;

  var subject = (isEdit ? '✏️ आवेदन संशोधित / Application Updated' : '🆕 नया आवेदन / New Application')
    + ' — #' + serialNo + ' — ' + appId;

  var body =
    (isEdit ? 'एक आवेदन संशोधित किया गया है।\nAn application was updated.\n\n'
            : 'एक नया आवेदन प्राप्त हुआ है।\nA new application was received.\n\n') +
    'क्रम संख्या / Serial No.: ' + serialNo + '\n' +
    'Application ID: ' + appId + '\n' +
    'विद्यार्थी का नाम / Student Name: ' + (studentName || '—') + '\n' +
    'कक्षा / Class: ' + (admClass || '—') + '\n' +
    'रोल नंबर / Roll No.: ' + (rollNo || '—') + '\n\n' +
    'पूर्ण विवरण एडमिन डैशबोर्ड में उपलब्ध है।\nFull details are available in the admin dashboard.';

  MailApp.sendEmail(ownerEmail, subject, body);
}

/**
 * Placeholder for SMS notifications. Disabled by default (SMS_ENABLED = false)
 * because it requires a third-party gateway account this project does not
 * include. To enable, sign up with an SMS API provider and fill in the
 * UrlFetchApp call below, then set SMS_ENABLED = true at the top of this file.
 */
function sendSmsNotification_(mobile10Digit, appId, isEdit) {
  if (!mobile10Digit || mobile10Digit.length !== 10) return;
  // Example (MSG91-style) — replace with your provider's real endpoint & auth:
  //
  // var apiKey = PropertiesService.getScriptProperties().getProperty('SMS_API_KEY');
  // var message = (isEdit ? 'Application updated. ' : 'Application received. ') +
  //               'ID: ' + appId + ' - UMV Chochahi Chhapra';
  // UrlFetchApp.fetch('https://api.yourprovider.com/send', {
  //   method: 'post',
  //   payload: { authkey: apiKey, mobiles: '91' + mobile10Digit, message: message, sender: 'UMVCHP' }
  // });
  Logger.log('SMS_ENABLED is true but sendSmsNotification_ has no provider configured yet.');
}

// ---- Validates Identity Number + Mobile to load data for Editing ----
function handleLoadForEdit_(body) {
  var cleanAadhar = String(body.aadhar || '').replace(/\D/g, '');
  var cleanMobile = String(body.mobile || '').replace(/\D/g, '');

  if (!cleanAadhar || cleanAadhar.length !== 12 || !cleanMobile || cleanMobile.length !== 10) {
    return jsonOut_({ success: false, error: 'कृपया मान्य 12 अंकों की पहचान संख्या एवं 10 अंकों का मोबाइल नंबर दर्ज करें।' });
  }

  // Same sliding-window protection as the public search endpoint — this is
  // an unauthenticated identity check (Aadhar + mobile), so it deserves the
  // same brute-force friction.
  var rateKey = 'editlookup_' + cleanAadhar + '|' + cleanMobile;
  if (!checkSearchRateLimit_(rateKey)) {
    return jsonOut_({ success: false, error: 'बहुत अधिक प्रयास। कृपया ' + SEARCH_WINDOW_MINUTES + ' मिनट बाद पुनः प्रयास करें।' });
  }

  var data = getSheet_().getDataRange().getValues();
  var headers = data[0];
  var aadharIdx = headers.indexOf('aadhar');
  var mobileIdx = headers.indexOf('mobile');

  for (var i = data.length - 1; i >= 1; i--) {
    var row = data[i];
    var rowAadhar = String(row[aadharIdx] || '').replace(/\D/g, '');
    var rowMobile = String(row[mobileIdx] || '').replace(/\D/g, '');

    if (rowAadhar === cleanAadhar && rowMobile === cleanMobile) {
      var record = {};
      headers.forEach(function(h, idx) {
        record[h] = (h === 'dob') ? formatDateDMY_(row[idx]) : row[idx];
      });
      // Normalize to a real fileId (falling back to extracting one out of an
      // old public thumbnail URL for pre-private-storage applications), then
      // embed the actual bytes as a data URI for display — this is the one
      // read the applicant's browser needs since it doesn't already hold
      // these bytes in memory the way it does right after submitting.
      record.photoFileId = resolveFileId_(record, 'photoFileId', 'photoUrl');
      record.signatureFileId = resolveFileId_(record, 'signatureFileId', 'signatureUrl');
      record.photoDataUri = imageDataUri_(record.photoFileId);
      record.signatureDataUri = imageDataUri_(record.signatureFileId);
      return jsonOut_({ success: true, record: record });
    }
  }

  return jsonOut_({ success: false, error: 'दिए गए विवरण से कोई रिकॉर्ड नहीं मिला।' });
}

/** Builds the full record list, optionally filtered by class + free-text search, newest first. */
function getFilteredRecords_(search, cls) {
  var data = getSheet_().getDataRange().getValues();
  var headers = data[0];
  var q = String(search || '').trim().toLowerCase();
  var classFilter = String(cls || '').trim();
  var searchCols = ['applicationId', 'studentName', 'pen', 'mobile', 'aadhar'];

  var records = [];
  for (var i = 1; i < data.length; i++) {
    var record = {};
    headers.forEach(function (h, idx) {
      record[h] = (h === 'dob') ? formatDateDMY_(data[i][idx]) : data[i][idx];
    });
    record._row = i + 1;
    // Normalize legacy rows (public-URL era) to a real fileId too, so
    // admin.html's "View" button always has a consistent field to pass to
    // the getImage action, regardless of when the application was submitted.
    record.photoFileId = resolveFileId_(record, 'photoFileId', 'photoUrl');
    record.signatureFileId = resolveFileId_(record, 'signatureFileId', 'signatureUrl');

    if (classFilter && record.admClass !== classFilter) continue;
    if (q) {
      var matches = searchCols.some(function (k) {
        return String(record[k] || '').toLowerCase().indexOf(q) !== -1;
      });
      if (!matches) continue;
    }
    records.push(record);
  }
  records.reverse(); // newest first
  return records;
}

/**
 * POST { action: "adminList", token, search, class, offset, limit }
 * Filters and paginates server-side so the whole sheet is never shipped to
 * the browser at once. Returns { success, records, total, offset, limit }.
 */
function handleAdminList_(body) {
  var auth = requireAdminToken_(body);
  if (!auth.valid) {
    return jsonOut_({ success: false, error: auth.error || 'Unauthorized' });
  }

  var all = getFilteredRecords_(body.search, body.class);
  var offset = Math.max(0, parseInt(body.offset, 10) || 0);
  var limit = Math.min(500, Math.max(1, parseInt(body.limit, 10) || 100));
  var page = all.slice(offset, offset + limit);

  return jsonOut_({
    success: true,
    records: page,
    total: all.length,
    offset: offset,
    limit: limit
  });
}

/**
 * POST { action: "adminExport", token, search, class }
 * Returns EVERY matching record (unpaginated) so CSV export reflects the
 * full filtered result set, not just whatever page happens to be loaded.
 */
/**
 * Only the account literally named "admin" (case-insensitive) may export
 * data — every other authenticated admin account can search, view, and
 * delete records exactly as before, but is refused here. This is also
 * enforced client-side (the Export button is hidden for anyone else in
 * admin.html), but the real boundary is here, server-side, since a hidden
 * button is just a UI nicety, not a security control.
 */
function handleAdminExport_(body) {
  var auth = requireAdminToken_(body);
  if (!auth.valid) {
    return jsonOut_({ success: false, error: auth.error || 'Unauthorized' });
  }
  if (String(auth.username || '').toLowerCase() !== 'admin') {
    return jsonOut_({ success: false, error: 'केवल "admin" उपयोगकर्ता ही डेटा एक्सपोर्ट कर सकता है। / Only the "admin" account can export data.' });
  }
  var all = getFilteredRecords_(body.search, body.class);
  logAudit_(auth.username, 'export', all.length + ' records (search="' + (body.search || '') + '", class="' + (body.class || '') + '")');
  return jsonOut_({ success: true, records: all });
}

function handleAdminDelete_(body) {
  var auth = requireAdminToken_(body);
  if (!auth.valid) {
    return jsonOut_({ success: false, error: auth.error || 'Unauthorized' });
  }
  var rowNum = parseInt(body.row, 10);
  if (!rowNum || rowNum < 2) {
    return jsonOut_({ success: false, error: 'Invalid row' });
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getSheet_();
    var appIdCol = HEADERS.indexOf('applicationId') + 1;
    var currentAppId = sheet.getRange(rowNum, appIdCol).getValue();
    if (body.applicationId && String(currentAppId) !== String(body.applicationId)) {
      return jsonOut_({ success: false, error: 'Row changed, please refresh and try again.' });
    }
    sheet.deleteRow(rowNum);
    logAudit_(auth.username, 'delete', 'row ' + rowNum + ', applicationId ' + (body.applicationId || '?'));
  } finally {
    lock.releaseLock();
  }

  return jsonOut_({ success: true });
}

// =================================================================
//         PUBLIC SEARCH: RATE LIMITING + MASKED PREVIEW + REVEAL
// =================================================================

/**
 * POST { action: "getImage", token, fileId }
 * Lets an authenticated admin fetch ONE photo/signature's bytes on demand
 * (called when staff click "View" on a specific record) — deliberately not
 * bundled into adminList/adminExport, so a page of the dashboard's table
 * never has to ship every row's images at once.
 */
function handleGetImage_(body) {
  var auth = requireAdminToken_(body);
  if (!auth.valid) {
    return jsonOut_({ success: false, error: auth.error || 'Unauthorized' });
  }
  var fileId = String(body.fileId || '').trim();
  if (!fileId) {
    return jsonOut_({ success: false, error: 'Missing fileId' });
  }
  var dataUri = imageDataUri_(fileId);
  if (!dataUri) {
    return jsonOut_({ success: false, error: 'चित्र लोड नहीं हो सका।' });
  }
  return jsonOut_({ success: true, dataUri: dataUri });
}

/** Masks all but the last `keep` characters of a digit string, e.g. "XXXXXXXX1234". */
function maskDigits_(value, keep) {
  var str = String(value || '');
  if (str.length <= keep) return str.replace(/./g, 'X');
  return str.slice(0, -keep).replace(/./g, 'X') + str.slice(-keep);
}

/** Returns a copy of `record` with sensitive fields masked, for the unauthenticated preview step. */
function maskRecordForPreview_(record) {
  var masked = {};
  Object.keys(record).forEach(function (k) { masked[k] = record[k]; });
  if (masked.aadhar) masked.aadhar = maskDigits_(masked.aadhar, 4);
  if (masked.guardianAadhar) masked.guardianAadhar = maskDigits_(masked.guardianAadhar, 4);
  if (masked.mobile) masked.mobile = maskDigits_(masked.mobile, 4);
  if (masked.bankAccount) masked.bankAccount = maskDigits_(masked.bankAccount, 4);
  if (masked.ifsc) masked.ifsc = maskDigits_(masked.ifsc, 4);
  masked.photoUrl = ''; // legacy field — don't leak the photo/signature link before identity is confirmed
  masked.signatureUrl = '';
  masked.photoFileId = ''; // current field — same reasoning
  masked.signatureFileId = '';
  return masked;
}

/** Signs a short-lived "yes, show me the full record for this applicationId" token. */
function issueRevealToken_(applicationId) {
  var expiry = Date.now() + REVEAL_TOKEN_TTL_MINUTES * 60 * 1000;
  var payload = 'reveal|' + applicationId + '|' + expiry;
  return Utilities.base64EncodeWebSafe(Utilities.newBlob(payload).getBytes()) + '.' + hmac_(payload);
}

function verifyRevealToken_(token, expectedApplicationId) {
  if (!token || token.indexOf('.') === -1) return { valid: false, error: 'Missing reveal token.' };
  var parts = token.split('.');
  var payload;
  try {
    payload = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString();
  } catch (e) {
    return { valid: false, error: 'Malformed reveal token.' };
  }
  if (hmac_(payload) !== parts[1]) return { valid: false, error: 'Invalid reveal token.' };
  var segs = payload.split('|');
  if (segs[0] !== 'reveal') return { valid: false, error: 'Invalid reveal token.' };
  var applicationId = segs[1];
  var expiry = Number(segs[2]);
  if (!expiry || Date.now() > expiry) return { valid: false, error: 'यह प्रति समय-सीमा समाप्त हो गई। कृपया दोबारा खोजें।' };
  if (String(applicationId) !== String(expectedApplicationId)) return { valid: false, error: 'Token does not match this application.' };
  return { valid: true, applicationId: applicationId };
}

/** Simple sliding-window counter (per search key) using CacheService — no client identity required. */
function checkSearchRateLimit_(key) {
  var cache = CacheService.getScriptCache();
  var countKey = 'searchcount_' + key;
  var raw = cache.get(countKey);
  var count = (raw ? parseInt(raw, 10) : 0) + 1;
  cache.put(countKey, String(count), SEARCH_WINDOW_MINUTES * 60);
  return count <= SEARCH_MAX_ATTEMPTS_PER_KEY;
}

// =================================================================
//         ONE-OFF: IMPORT DATA FROM A PREVIOUS VERSION OF THIS APP
// =================================================================
// Run this ONCE from the Apps Script editor (select importLegacyData_ in the
// function dropdown, click ▶ Run), then delete this block once you've
// confirmed the import looks right in the `data` tab. It is deliberately
// NOT wired into doGet/doPost — nobody can trigger it remotely.
//
// HOW TO USE:
// 1. Fill in LEGACY_SHEET_ID and LEGACY_SHEET_NAME below.
// 2. Fill in COLUMN_MAP: for every column your OLD sheet has, map
//    newHeaderName -> 'Old Sheet's Exact Column Header Text'.
//    Any new field with no old equivalent (e.g. otr, email, rollNo) —
//    just leave it out of the map; it will be imported blank.
// 3. If your old sheet stored photo/signature as Drive links, map those
//    under the special photoUrl / signatureUrl keys (see the COLUMN_MAP
//    example below) — do NOT map them to the current photoFileId /
//    signatureFileId headers directly. Each one gets a freshly-made PRIVATE
//    copy of the file saved into this deployment's own Drive folder (via
//    migrateLegacyImage_ below); the original old file is left exactly as
//    it was (if it was public, it stays public — only the new copy is
//    private), so migrated applications end up genuinely private rather
//    than just carrying over a link to a still-exposed original.
// 4. Run it. Check the Apps Script "Executions" log for a summary
//    (imported / skipped / image-migration-failure counts). Check the
//    `data` tab.
// 5. Re-running is safe: rows whose applicationId already exists in `data`
//    are skipped, so you won't get duplicates if you run it twice. Note
//    that re-running does NOT re-use a photo/signature copy already made on
//    a prior run for the same row, since that row is now skipped entirely
//    as a duplicate before any image handling runs.
function importLegacyData_() {
  var LEGACY_SHEET_ID = 'PUT_YOUR_OLD_SPREADSHEET_ID_HERE';
  var LEGACY_SHEET_NAME = 'Sheet1'; // <-- change to your old tab's name

  // newHeaderName (as used in this app's HEADERS) -> old sheet's column header text.
  // EDIT THIS to match your old sheet exactly (case-sensitive).
  var COLUMN_MAP = {
    applicationId: 'Application ID',
    submittedAt:   'Submitted At',
    admClass:      'Class',
    studentName:   'Student Name',
    dob:           'DOB',
    mobile:        'Mobile',
    aadhar:        'Aadhar',
    pen:           'PEN',
    // Optional — only fill these in if your old sheet stored photo/signature
    // as Drive links or bare file IDs. See the note above: these get copied
    // into fresh PRIVATE files, not pasted in as a (likely still-public) URL.
    photoUrl:      'Photo URL',       // <-- your old sheet's photo link column, if any
    signatureUrl:  'Signature URL'    // <-- your old sheet's signature link column, if any
    // ... add every other column your old sheet has, following this pattern
  };

  var oldSheet = SpreadsheetApp.openById(LEGACY_SHEET_ID).getSheetByName(LEGACY_SHEET_NAME);
  if (!oldSheet) throw new Error('Legacy sheet/tab not found — check LEGACY_SHEET_ID/LEGACY_SHEET_NAME.');

  var oldData = oldSheet.getDataRange().getValues();
  var oldHeaders = oldData[0];

  var newSheet = getSheet_();
  var newHeaders = newSheet.getRange(1, 1, 1, newSheet.getLastColumn()).getValues()[0];
  var appIdCol = newHeaders.indexOf('applicationId');
  var dobCol = newHeaders.indexOf('dob');

  // Build a set of Application IDs already present, so re-running is safe.
  var existing = {};
  var curData = newSheet.getDataRange().getValues();
  for (var r = 1; r < curData.length; r++) {
    existing[String(curData[r][appIdCol])] = true;
  }

  var imported = 0, skippedDupe = 0, skippedNoId = 0, imageMigrateFailures = 0;

  for (var i = 1; i < oldData.length; i++) {
    var oldRowObj = {};
    oldHeaders.forEach(function (h, idx) { oldRowObj[h] = oldData[i][idx]; });

    var appId = COLUMN_MAP.applicationId ? oldRowObj[COLUMN_MAP.applicationId] : '';
    if (!appId) { skippedNoId++; continue; }
    if (existing[String(appId)]) { skippedDupe++; continue; }

    var newRow = newHeaders.map(function (newKey) {
      if (newKey === 'photoFileId' || newKey === 'signatureFileId') {
        var urlMapKey = (newKey === 'photoFileId') ? 'photoUrl' : 'signatureUrl';
        var oldImageVal = COLUMN_MAP[urlMapKey] ? oldRowObj[COLUMN_MAP[urlMapKey]] : '';
        if (!oldImageVal) return '';
        var filenameSuffix = (newKey === 'photoFileId') ? '_photo' : '_signature';
        var newFileId = migrateLegacyImage_(oldImageVal, String(appId) + filenameSuffix);
        if (!newFileId) imageMigrateFailures++;
        return newFileId;
      }
      var oldKey = COLUMN_MAP[newKey];
      if (!oldKey) return ''; // no mapping for this column -> leave blank
      var val = oldRowObj[oldKey];
      if (newKey === 'dob' && val) return formatDateDMY_(val);
      return (val !== undefined && val !== null) ? String(val).trim() : '';
    });

    newSheet.appendRow(newRow);
    if (dobCol !== -1) {
      newSheet.getRange(newSheet.getLastRow(), dobCol + 1).setNumberFormat('@');
    }
    existing[String(appId)] = true;
    imported++;
  }

  Logger.log('Import complete. Imported: ' + imported +
    ', skipped (duplicate applicationId): ' + skippedDupe +
    ', skipped (no applicationId): ' + skippedNoId +
    ', image copies that failed (left blank, logged individually above): ' + imageMigrateFailures);
}

/**
 * Given an old Drive URL or bare file ID (as a legacy, pre-private-storage
 * version of this system would have stored it), makes a fresh PRIVATE copy
 * of that file inside THIS deployment's own DRIVE_FOLDER_ID and returns the
 * new copy's file ID — ready to drop straight into photoFileId/
 * signatureFileId, exactly like a file saveImage_() just created.
 *
 * Deliberately does not touch the original file's sharing at all: if it was
 * public, it stays exactly as public as it always was. Only the new copy
 * made here is private — this is what makes a migrated application's
 * photo/signature genuinely private going forward, rather than just
 * carrying over a link to a still-exposed original elsewhere on Drive.
 *
 * Returns '' (never throws) on any failure — a bad/stale link, a file the
 * deploying account can't read, etc. — so one bad photo link doesn't abort
 * the whole import; the caller counts these as imageMigrateFailures.
 */
function migrateLegacyImage_(oldUrlOrId, filenamePrefix) {
  if (!oldUrlOrId) return '';
  var str = String(oldUrlOrId).trim();
  var oldFileId = str;
  var m = str.match(/[?&]id=([a-zA-Z0-9_-]+)/) || str.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (m) oldFileId = m[1];
  try {
    var oldFile = DriveApp.getFileById(oldFileId);
    var blob = oldFile.getBlob();
    var newFile = getFolder_().createFile(blob);
    var ext = (blob.getContentType() || '').split('/')[1] || 'jpg';
    newFile.setName(filenamePrefix + '.' + ext);
    // No setSharing call — stays private, exactly like saveImage_().
    return newFile.getId();
  } catch (err) {
    Logger.log('migrateLegacyImage_ failed for "' + oldUrlOrId + '": ' + err.message);
    return '';
  }
}

function findRecordByApplicationId_(applicationId) {
  var data = getSheet_().getDataRange().getValues();
  var headers = data[0];
  var appIdIdx = headers.indexOf('applicationId');
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][appIdIdx]).trim() === String(applicationId).trim()) {
      var record = {};
      headers.forEach(function (h, idx) {
        record[h] = (h === 'dob') ? formatDateDMY_(data[i][idx]) : data[i][idx];
      });
      return record;
    }
  }
  return null;
}

/**
 * POST { action: "searchReveal", applicationId, revealToken, aadhar }
 * Exchanges a short-lived reveal token (issued by doGet?action=search once the
 * class+DOB+ID/PEN combination has already matched) for the full, unmasked
 * record — used right before printing/downloading.
 *
 * Also requires the applicant's own Aadhaar number as a second factor here.
 * class+DOB+Application-ID/PEN (checked earlier, to even reach this screen)
 * is comparatively guessable — a 12-digit Aadhaar is not, so this is a real
 * extra bar before anything unmasked is released, not just a formality.
 */
function handleSearchReveal_(body) {
  var check = verifyRevealToken_(body.revealToken, body.applicationId);
  if (!check.valid) {
    return jsonOut_({ success: false, error: check.error });
  }

  // Rate-limit guesses against this specific application's reveal step,
  // separately from the initial search rate limit — otherwise a valid,
  // unexpired reveal token would let someone brute-force the Aadhaar number
  // with unlimited attempts.
  if (!checkSearchRateLimit_('reveal_' + body.applicationId)) {
    return jsonOut_({ success: false, error: 'बहुत अधिक प्रयास। कृपया ' + SEARCH_WINDOW_MINUTES + ' मिनट बाद पुनः प्रयास करें।' });
  }

  var record = findRecordByApplicationId_(body.applicationId);
  if (!record) {
    return jsonOut_({ success: false, error: 'आवेदन नहीं मिला।' });
  }

  var suppliedAadhar = String(body.aadhar || '').replace(/\D/g, '');
  var recordAadhar = String(record.aadhar || '').replace(/\D/g, '');
  if (!suppliedAadhar || suppliedAadhar.length !== 12 || suppliedAadhar !== recordAadhar) {
    return jsonOut_({ success: false, error: 'आधार संख्या मेल नहीं खाती। कृपया पुनः जाँचें।' });
  }

  record.photoFileId = resolveFileId_(record, 'photoFileId', 'photoUrl');
  record.signatureFileId = resolveFileId_(record, 'signatureFileId', 'signatureUrl');
  record.photoDataUri = imageDataUri_(record.photoFileId);
  record.signatureDataUri = imageDataUri_(record.signatureFileId);
  logAudit_('(public)', 'search_reveal', 'applicationId ' + body.applicationId);
  return jsonOut_({ success: true, record: record });
}

// ---------------------- GET: search lookup ----------------------
function doGet(e) {
  try {
    var action = e.parameter.action;

    if (action === 'search') {
      var cls = String(e.parameter.class || '').trim();
      var type = String(e.parameter.type || 'appId').trim();
      var value = String(e.parameter.value || '').trim().toLowerCase();
      var dobQuery = formatDateDMY_(e.parameter.dob || '');

      if (!value) return jsonOut_({ found: false, error: 'Missing search value' });
      if (!dobQuery) return jsonOut_({ found: false, error: 'जन्म तिथि (DOB) आवश्यक है' });

      var rateKey = (cls + '|' + type + '|' + value).toLowerCase();
      if (!checkSearchRateLimit_(rateKey)) {
        return jsonOut_({ found: false, error: 'बहुत अधिक प्रयास। कृपया ' + SEARCH_WINDOW_MINUTES + ' मिनट बाद पुनः प्रयास करें।' });
      }

      var data = getSheet_().getDataRange().getValues();
      var headers = data[0];
      var classIdx = headers.indexOf('admClass');
      var appIdIdx = headers.indexOf('applicationId');
      var penIdx = headers.indexOf('pen');
      var dobIdx = headers.indexOf('dob');

      for (var i = data.length - 1; i >= 1; i--) {
        var row = data[i];
        var classMatch = String(row[classIdx]).trim() === cls;
        var keyMatch = type === 'appId'
          ? String(row[appIdIdx]).trim().toLowerCase() === value
          : String(row[penIdx]).trim().toLowerCase() === value;
        var rowDob = formatDateDMY_(row[dobIdx]);
        var dobMatch = rowDob === dobQuery;

        if (classMatch && keyMatch && dobMatch) {
          var record = {};
          headers.forEach(function (h, idx) {
            record[h] = (h === 'dob') ? formatDateDMY_(row[idx]) : row[idx];
          });
          // Unauthenticated callers only ever get a masked preview + a
          // short-lived token to fetch the full record via searchReveal.
          return jsonOut_({
            found: true,
            preview: maskRecordForPreview_(record),
            revealToken: issueRevealToken_(record.applicationId)
          });
        }
      }
      return jsonOut_({ found: false });
    }

    return jsonOut_({ ok: true, message: 'Admission API running.' });
  } catch (err) {
    return jsonOut_({ error: err.message });
  }
}
