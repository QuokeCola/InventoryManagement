/**
 * Lab inventory check-out web app.
 *
 * Each item's QR code opens  <web app URL>?item=<ItemID>.  The page shows the item and
 * lets the signed-in user check it out or return it. Every action updates the item's row
 * on the Items tab and appends a row to the Log tab.
 *
 * The script is bound to the inventory spreadsheet. To run it standalone instead, set a
 * script property SHEET_ID to the spreadsheet's ID.
 *
 * The same code also backs the static site (web/, served by GitHub Pages), which can use the phone's camera
 * live where Apps Script's frame can't. The site signs people in through this web app (?login=1, on the
 * deployment limited to the university, which tells the script who is signed in) and gets a signed token back;
 * it then calls the functions below through doPost on a second deployment that anyone can reach, sending the
 * token with every call. With the script property SITE_URL set, this web app sends people (and the QR codes
 * on the labels) on to the site; ?classic=1 still opens the Apps Script page.
 */

const ITEMS_SHEET = 'Items';
const LOG_SHEET = 'Log';
const LOG_COLUMNS = ['Timestamp', 'ItemID', 'Action', 'User', 'Note'];
const REQUIRED_COLUMNS = ['ItemID', 'Active', 'Status', 'Holder', 'Last Updated'];
const LIST_COLUMNS = ['ItemID', 'Category', 'Description', 'Brand', 'Model', 'Condition', 'Home Location',
                      'Active', 'Status', 'Holder', 'Last Updated'];
const STATUS_AVAILABLE = 'Available';
const STATUS_OUT = 'Checked Out';
const HISTORY_LENGTH = 5;
const CONDITIONS = ['working', 'not working', 'unknown'];
const PHOTO_SIZE = 1200; // px on a photo's long side, as the page gets it
const DEFAULT_DOMAIN = 'umich.edu'; // only accounts in this domain may use the app (script property ALLOWED_DOMAIN overrides it)
const TOKEN_DAYS = 30;              // how long the static site's sign-in lasts
// What the static site may call, through doPost.
const API = { getAllItems: () => getAllItems(), getItem: (id) => getItem(id), getPhoto: (id) => getPhoto(id),
              checkOut: (id, note) => checkOut(id, note), returnItem: (id, note) => returnItem(id, note),
              setCondition: (id, condition) => setCondition(id, condition) };

let apiUser_ = ''; // who a doPost call's token says is calling (Session can't tell on the open deployment)

function doGet(e) {
  const params = (e && e.parameter) || {};
  if (params.login) return signInPage_(params['return']);
  const site = siteUrl_();
  const itemId = String(params.item || '').trim().toUpperCase();
  if (site && !params.classic) return redirectPage_(site + (itemId ? '?item=' + encodeURIComponent(itemId) : ''), 'Opening Lab Inventory…');
  const page = HtmlService.createTemplateFromFile('Index');
  page.itemId = itemId;
  // viewport-fit=cover: on phones the page runs under the notch and the home indicator (the page keeps its controls
  // clear of them); and saved to the home screen, it opens full screen, without the browser's bars.
  return page.evaluate()
    .setTitle('Lab Inventory')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .addMetaTag('apple-mobile-web-app-capable', 'yes')
    .addMetaTag('mobile-web-app-capable', 'yes');
}

/** The static site's calls: { fn, args, token } in, { result } or { error, auth? } out, as JSON. */
function doPost(e) {
  let out;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!Object.prototype.hasOwnProperty.call(API, req.fn)) throw new Error('Unknown call: ' + req.fn);
    apiUser_ = verifyToken_(req.token);
    if (!apiUser_) out = { error: 'Please sign in again.', auth: true };
    else out = { result: API[req.fn].apply(null, Array.isArray(req.args) ? req.args : []) };
  } catch (err) {
    out = { error: err && err.message ? err.message : String(err) };
  } finally {
    apiUser_ = '';
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// ---- Called from the page with google.script.run ---------------------------------

/** Every item, for the archive view. Only the columns the page lists, to keep the response small. */
function getAllItems() {
  const items = readItems_().rows.filter((it) => it.ItemID).map((it) => {
    return serializable_(Object.fromEntries(LIST_COLUMNS.map((f) => [f, it[f] === undefined ? '' : it[f]])));
  });
  return { user: currentUser_(), items: items, conditions: CONDITIONS };
}

/** One item in full, with its recent history. */
function getItem(itemId) {
  currentUser_();
  const item = find_(itemId).item;
  return { item: item, history: history_(item.ItemID) };
}

/**
 * The item's photo, from the Drive folder whose ID is in the script property PHOTO_FOLDER_ID: an image named
 * after the item ("AC2.jpg", or "AC2 front.jpg"; not "AC20.jpg"), the first by name (case aside) if there are several.
 * Returned as { url } with a data: URL, scaled down to PHOTO_SIZE px, because the page draws it in WebGL and
 * can't load Drive's own links there. Null if there is no folder set or no photo.
 */
function getPhoto(itemId) {
  currentUser_();
  const folderId = PropertiesService.getScriptProperties().getProperty('PHOTO_FOLDER_ID');
  const id = String(itemId || '').trim().toUpperCase();
  if (!folderId || !/^[A-Z0-9+_-]+$/.test(id)) return null;
  const named = new RegExp('^' + id.replace(/[+]/g, '\\+') + '(?![A-Z0-9])', 'i');
  const files = DriveApp.getFolderById(folderId).searchFiles(`title contains '${id}' and mimeType contains 'image/' and trashed = false`);
  let file = null;
  while (files.hasNext()) {
    const f = files.next();
    if (named.test(f.getName()) && (!file || f.getName().toLowerCase() < file.getName().toLowerCase())) file = f;
  }
  if (!file) return null;
  const blob = scaledImage_(file);
  return blob ? { url: `data:${blob.getContentType()};base64,${Utilities.base64Encode(blob.getBytes())}` } : null;
}

function checkOut(itemId, note) {
  return change_(itemId, (it, user) => {
    if (!it.Active) throw new Error(`${it.ItemID} is inactive (retired or missing) and cannot be checked out.`);
    if (it.Status === STATUS_OUT) {
      throw new Error(`${it.ItemID} is already checked out to ${it.Holder || 'someone'}. Return it first.`);
    }
    return { set: { Status: STATUS_OUT, Holder: user }, action: 'Check out', note: note };
  });
}

function returnItem(itemId, note) {
  return change_(itemId, (it, user) => {
    if (it.Status !== STATUS_OUT) throw new Error(`${it.ItemID} is not checked out.`);
    const forSomeoneElse = it.Holder && String(it.Holder).toLowerCase() !== user.toLowerCase();
    const prefix = forSomeoneElse ? `returned on behalf of ${it.Holder}. ` : '';
    return { set: { Status: STATUS_AVAILABLE, Holder: '' }, action: 'Return', note: (prefix + (note || '')).trim() };
  });
}

/** Anyone signed in can report an item's condition; the change is logged. */
function setCondition(itemId, condition) {
  const value = String(condition || '').trim().toLowerCase();
  if (!CONDITIONS.includes(value)) throw new Error(`Condition must be one of: ${CONDITIONS.join(', ')}.`);
  return change_(itemId, (it, user, header) => {
    if (!header.includes('Condition')) throw new Error('Items tab is missing the "Condition" column.');
    const before = String(it.Condition || 'unknown');
    return before === value ? null : { set: { Condition: value }, action: 'Condition', note: `${before} → ${value}` };
  });
}

/**
 * One change to one item, under the script lock. `decide(item, user, header)` checks that the
 * change is allowed and returns { set: {column: value}, action, note } (or null for "nothing to
 * do"); the row is updated, the action logged, and the item returned as getItem would.
 */
function change_(itemId, decide) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('The inventory is busy, please try again.');
  try {
    const user = currentUser_();
    const found = find_(itemId);
    const id = found.item.ItemID;
    const change = decide(found.item, user, found.header);
    if (change) {
      change.set['Last Updated'] = new Date();
      Object.keys(change.set).forEach((name) => {
        found.sheet.getRange(found.rowNumber, found.header.indexOf(name) + 1).setValue(change.set[name]);
      });
      logSheet_().appendRow([new Date(), id, change.action, user, cellText_(String(change.note || '').slice(0, 500))]);
    }
    return getItem(id);
  } finally {
    lock.releaseLock();
  }
}

// ---- Sheet access -----------------------------------------------------------------

function spreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

/** Items tab as objects keyed by header name, so columns can be reordered freely. */
function readItems_() {
  const sheet = spreadsheet_().getSheetByName(ITEMS_SHEET);
  if (!sheet) throw new Error(`The spreadsheet has no "${ITEMS_SHEET}" tab.`);
  const values = sheet.getDataRange().getValues();
  const header = values[0].map((h) => String(h).trim());
  REQUIRED_COLUMNS.forEach((name) => {
    if (!header.includes(name)) throw new Error(`Items tab is missing the "${name}" column.`);
  });
  const rows = values.slice(1).map((row) => {
    const it = {};
    header.forEach((name, i) => { if (name) it[name] = row[i]; });
    it.ItemID = String(it.ItemID).trim();
    it.Active = it.Active === true || String(it.Active).toUpperCase() === 'TRUE';
    it.Status = String(it.Status || STATUS_AVAILABLE).trim();
    return it;
  });
  return { sheet: sheet, header: header, rows: rows };
}

/** The item's row (and where it sits in the sheet), or an error if there is no such item. */
function find_(itemId) {
  const id = String(itemId || '').trim().toUpperCase();
  const table = readItems_();
  const i = id ? table.rows.findIndex((it) => it.ItemID.toUpperCase() === id) : -1;
  if (i < 0) throw new Error(`No item with ID "${itemId}".`);
  return { sheet: table.sheet, header: table.header, rowNumber: i + 2, item: serializable_(table.rows[i]) };
}

function logSheet_() {
  const ss = spreadsheet_();
  let sheet = ss.getSheetByName(LOG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(LOG_SHEET);
    sheet.appendRow(LOG_COLUMNS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function history_(itemId) {
  return logSheet_().getDataRange().getValues().slice(1)
    .filter((r) => String(r[1]).toUpperCase() === itemId.toUpperCase())
    .slice(-HISTORY_LENGTH)
    .reverse()
    .map((r) => ({ when: String(text_(r[0])), action: r[2], user: r[3], note: r[4] }));
}

// ---- Helpers ----------------------------------------------------------------------

/** Contents of another HTML file in the project, for <?!= include('Name') ?> in the page. */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/**
 * An image file from Drive, scaled down: Drive's own thumbnail of it at PHOTO_SIZE px, or failing that the file
 * itself if it is small enough to send, or Drive's small default thumbnail.
 */
function scaledImage_(file) {
  const auth = { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true };
  try {
    const meta = UrlFetchApp.fetch(`https://www.googleapis.com/drive/v3/files/${file.getId()}?fields=thumbnailLink`, auth);
    const link = meta.getResponseCode() === 200 && JSON.parse(meta.getContentText()).thumbnailLink;
    if (link) {
      const res = UrlFetchApp.fetch(link.replace(/=s\d+$/, '=s' + PHOTO_SIZE), auth);
      if (res.getResponseCode() === 200 && /^image\//.test(res.getBlob().getContentType())) return res.getBlob();
    }
  } catch (e) { /* fall back below */ }
  return file.getSize() < 2.5e6 ? file.getBlob() : file.getThumbnail();
}

function currentUser_() {
  const email = apiUser_ || Session.getActiveUser().getEmail();
  if (!email) {
    throw new Error('Could not tell who you are. Sign in with your university Google account ' +
                    '(the web app must be deployed with access limited to your domain).');
  }
  const domain = allowedDomain_();
  if (domain && !email.toLowerCase().endsWith('@' + domain)) throw new Error(`Sign in with your ${domain} account (not ${email}).`);
  return email;
}

function allowedDomain_() {
  const domain = PropertiesService.getScriptProperties().getProperty('ALLOWED_DOMAIN');
  return String(domain == null ? DEFAULT_DOMAIN : domain).trim().toLowerCase().replace(/^@/, '');
}

/**
 * Text for a cell that the sheet will take as text, not a formula: a note starting with = + - or @ would
 * otherwise run as one (=IMPORTXML(...) and the like) in the Log tab.
 */
function cellText_(text) {
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

// ---- Sign-in for the static site ----------------------------------------------------

/** The static site's address (script property SITE_URL), with a trailing slash; '' if there is none. */
function siteUrl_() {
  const url = String(PropertiesService.getScriptProperties().getProperty('SITE_URL') || '').trim();
  return url ? url.replace(/\/?$/, '/') : '';
}

/**
 * ?login=1&return=<a page of the site>: who is signed in (on the deployment limited to the university), as a
 * token handed back to the site in the address's #fragment. Only the site's own pages get one.
 */
function signInPage_(returnTo) {
  const site = siteUrl_(), back = String(returnTo || site);
  if (!site || back.indexOf(site) !== 0 || /[\s"'<>\\]/.test(back)) {
    return HtmlService.createHtmlOutput('<p style="font:16px system-ui;margin:2em">This sign-in link is not for this site. ' +
                                        '(Set the script property SITE_URL to the static site\'s address.)</p>').setTitle('Lab Inventory');
  }
  let token;
  try { token = makeToken_(currentUser_()); } catch (err) {
    return HtmlService.createHtmlOutput('<p style="font:16px system-ui;margin:2em">' + htmlText_(err.message) + '</p>').setTitle('Lab Inventory');
  }
  return redirectPage_(back.replace(/#.*$/, '') + '#token=' + encodeURIComponent(token), 'Signed in. Opening Lab Inventory…');
}

/** A page that goes on to url at once (the whole window, not just Apps Script's frame), with a link if it can't. */
function redirectPage_(url, text) {
  const href = htmlText_(url);
  return HtmlService.createHtmlOutput(
    `<p style="font:16px system-ui;margin:2em">${htmlText_(text)} <a href="${href}" target="_top">Continue</a></p>` +
    `<script>try { window.top.location.replace(${JSON.stringify(url)}); } catch (e) {}</script>`)
    .setTitle('Lab Inventory')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function htmlText_(s) {
  return String(s).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
}

/** The key tokens are signed with: made once, kept in the script properties. Delete it to sign everyone out. */
function tokenSecret_() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('TOKEN_SECRET');
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('TOKEN_SECRET', secret);
  }
  return secret;
}

const sign_ = (payload) => Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, tokenSecret_()));

/** "<email>|<expiry ms>.<signature>": who it is and until when, signed so the site can't change it. */
function makeToken_(email, now) {
  const payload = Utilities.base64EncodeWebSafe(email + '|' + ((now || Date.now()) + TOKEN_DAYS * 864e5));
  return payload + '.' + sign_(payload);
}

/** The email in a token, if it is one of ours and not expired; '' otherwise. */
function verifyToken_(token, now) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !parts[0] || sign_(parts[0]) !== parts[1]) return '';
  const fields = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString().split('|');
  return fields.length === 2 && Number(fields[1]) > (now || Date.now()) ? fields[0] : '';
}

/** google.script.run can't send Date objects; turn them into strings. */
function text_(value) {
  return value instanceof Date ? Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm') : value;
}

function serializable_(it) {
  return Object.fromEntries(Object.keys(it).map((k) => [k, text_(it[k])]));
}
