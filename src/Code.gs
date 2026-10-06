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

var ITEMS_SHEET = 'Items';
var LOG_SHEET = 'Log';
var LOG_COLUMNS = ['Timestamp', 'ItemID', 'Action', 'User', 'Note'];
var STATUS_AVAILABLE = 'Available';
var STATUS_OUT = 'Checked Out';
var HISTORY_LENGTH = 5;
var CONDITIONS = ['working', 'not working', 'unknown'];

function doGet(e) {
  var page = pageTemplate_();
  page.itemId = String((e && e.parameter && e.parameter.item) || '').trim().toUpperCase();
  page.appUrl = ScriptApp.getService().getUrl();
  return page.evaluate()
    .setTitle('Lab Inventory')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ---- Called from the page with google.script.run ---------------------------------

/** Item details, who is asking, and the item's recent history. */
function getItem(itemId) {
  var user = currentUser_();
  var found = findItem_(itemId);
  if (!found) return { user: user, error: 'No item with ID "' + itemId + '".' };
  return { user: user, item: found.item, history: history_(found.item.ItemID), conditions: CONDITIONS };
}

/** Every item, for the archive view. Only the fields the page shows, to keep the response small. */
function getAllItems() {
  var user = currentUser_();
  var fields = ['ItemID', 'Category', 'Description', 'Brand', 'Model', 'Condition', 'Home Location',
                'Active', 'Status', 'Holder', 'Last Updated'];
  var items = readItems_().rows.filter(function (it) { return it.ItemID; }).map(function (it) {
    var out = {};
    fields.forEach(function (f) { out[f] = it[f] === undefined ? '' : it[f]; });
    return serializable_(out);
  });
  return { user: user, items: items, conditions: CONDITIONS };
}

/** Items the current user is holding. */
function getMyItems() {
  var user = currentUser_();
  var table = readItems_();
  var mine = table.rows.filter(function (it) {
    return it.Status === STATUS_OUT && String(it.Holder).trim().toLowerCase() === user.toLowerCase();
  });
  return { user: user, items: mine.map(serializable_) };
}

function checkOut(itemId, note) {
  return withLock_(function () {
    var user = currentUser_();
    var found = mustFind_(itemId);
    var it = found.item;
    if (!it.Active) throw new Error(it.ItemID + ' is inactive (retired or missing) and cannot be checked out.');
    if (it.Status === STATUS_OUT) {
      throw new Error(it.ItemID + ' is already checked out to ' + (it.Holder || 'someone') + '. Return it first.');
    }
    update_(found, { Status: STATUS_OUT, Holder: user });
    log_(it.ItemID, 'Check out', user, note);
    return getItem(it.ItemID);
  });
}

function returnItem(itemId, note) {
  return withLock_(function () {
    var user = currentUser_();
    var found = mustFind_(itemId);
    var it = found.item;
    if (it.Status !== STATUS_OUT) throw new Error(it.ItemID + ' is not checked out.');
    var logNote = note || '';
    if (it.Holder && String(it.Holder).toLowerCase() !== user.toLowerCase()) {
      logNote = ('returned on behalf of ' + it.Holder + '. ' + logNote).trim();
    }
    update_(found, { Status: STATUS_AVAILABLE, Holder: '' });
    log_(it.ItemID, 'Return', user, logNote);
    return getItem(it.ItemID);
  });
}

/** Anyone signed in can report an item's condition; the change is logged. */
function setCondition(itemId, condition) {
  var value = String(condition || '').trim().toLowerCase();
  if (CONDITIONS.indexOf(value) < 0) throw new Error('Condition must be one of: ' + CONDITIONS.join(', ') + '.');
  return withLock_(function () {
    var user = currentUser_();
    var found = mustFind_(itemId);
    var it = found.item;
    if (found.table.header.indexOf('Condition') < 0) throw new Error('Items tab is missing the "Condition" column.');
    var before = String(it.Condition || 'unknown');
    if (before !== value) {
      update_(found, { Condition: value });
      log_(it.ItemID, 'Condition', user, before + ' → ' + value);
    }
    return getItem(it.ItemID);
  });
}

// ---- Sheet access -----------------------------------------------------------------

function spreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

/** Items tab as objects keyed by header name, so columns can be reordered freely. */
function readItems_() {
  var sheet = spreadsheet_().getSheetByName(ITEMS_SHEET);
  if (!sheet) throw new Error('The spreadsheet has no "' + ITEMS_SHEET + '" tab.');
  var values = sheet.getDataRange().getValues();
  var header = values[0].map(function (h) { return String(h).trim(); });
  ['ItemID', 'Active', 'Status', 'Holder', 'Last Updated'].forEach(function (name) {
    if (header.indexOf(name) < 0) throw new Error('Items tab is missing the "' + name + '" column.');
  });
  var rows = values.slice(1).map(function (row) {
    var it = {};
    header.forEach(function (name, i) { if (name) it[name] = row[i]; });
    it.ItemID = String(it.ItemID).trim();
    it.Active = it.Active === true || String(it.Active).toUpperCase() === 'TRUE';
    it.Status = String(it.Status || STATUS_AVAILABLE).trim();
    return it;
  });
  return { sheet: sheet, header: header, rows: rows };
}

function findItem_(itemId) {
  var id = String(itemId || '').trim().toUpperCase();
  if (!id) return null;
  var table = readItems_();
  for (var i = 0; i < table.rows.length; i++) {
    if (table.rows[i].ItemID.toUpperCase() === id) {
      return { table: table, rowNumber: i + 2, item: serializable_(table.rows[i]) };
    }
  }
  return null;
}

function mustFind_(itemId) {
  var found = findItem_(itemId);
  if (!found) throw new Error('No item with ID "' + itemId + '".');
  return found;
}

function update_(found, changes) {
  changes['Last Updated'] = new Date();
  var header = found.table.header;
  Object.keys(changes).forEach(function (name) {
    found.table.sheet.getRange(found.rowNumber, header.indexOf(name) + 1).setValue(changes[name]);
  });
}

function logSheet_() {
  var ss = spreadsheet_();
  var sheet = ss.getSheetByName(LOG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(LOG_SHEET);
    sheet.appendRow(LOG_COLUMNS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function log_(itemId, action, user, note) {
  logSheet_().appendRow([new Date(), itemId, action, user, String(note || '').slice(0, 500)]);
}

function history_(itemId) {
  var values = logSheet_().getDataRange().getValues().slice(1);
  var tz = Session.getScriptTimeZone();
  return values
    .filter(function (r) { return String(r[1]).toUpperCase() === itemId.toUpperCase(); })
    .slice(-HISTORY_LENGTH)
    .reverse()
    .map(function (r) {
      return {
        when: r[0] instanceof Date ? Utilities.formatDate(r[0], tz, 'yyyy-MM-dd HH:mm') : String(r[0]),
        action: r[2], user: r[3], note: r[4],
      };
    });
}

// ---- Helpers ----------------------------------------------------------------------

/** The page file, whether the editor saved it as "Index" or "Index.html". */
function pageTemplate_() {
  var names = ['Index', 'Index.html'];
  for (var i = 0; i < names.length; i++) {
    try {
      return HtmlService.createTemplateFromFile(names[i]);
    } catch (err) {
      if (i === names.length - 1) throw err;
    }
  }
}

function currentUser_() {
  var email = Session.getActiveUser().getEmail();
  if (!email) {
    throw new Error('Could not tell who you are. Sign in with your university Google account ' +
                    '(the web app must be deployed with access limited to your domain).');
  }
  return email;
}

/** google.script.run can't send Date objects; turn them into strings. */
function serializable_(it) {
  var out = {};
  var tz = Session.getScriptTimeZone();
  Object.keys(it).forEach(function (k) {
    var v = it[k];
    out[k] = v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd HH:mm') : v;
  });
  return out;
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('The inventory is busy, please try again.');
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}
