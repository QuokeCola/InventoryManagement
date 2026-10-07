/**
 * Lab inventory check-out web app.
 *
 * Each item's QR code opens  <web app URL>?item=<ItemID>.  The page shows the item and
 * lets the signed-in user check it out or return it. Every action updates the item's row
 * on the Items tab and appends a row to the Log tab.
 *
 * The script is bound to the inventory spreadsheet. To run it standalone instead, set a
 * script property SHEET_ID to the spreadsheet's ID.
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

function doGet(e) {
  const page = HtmlService.createTemplateFromFile('Index');
  page.itemId = String((e && e.parameter && e.parameter.item) || '').trim().toUpperCase();
  return page.evaluate()
    .setTitle('Lab Inventory')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
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
      logSheet_().appendRow([new Date(), id, change.action, user, String(change.note || '').slice(0, 500)]);
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
  const email = Session.getActiveUser().getEmail();
  if (!email) {
    throw new Error('Could not tell who you are. Sign in with your university Google account ' +
                    '(the web app must be deployed with access limited to your domain).');
  }
  return email;
}

/** google.script.run can't send Date objects; turn them into strings. */
function text_(value) {
  return value instanceof Date ? Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm') : value;
}

function serializable_(it) {
  return Object.fromEntries(Object.keys(it).map((k) => [k, text_(it[k])]));
}
