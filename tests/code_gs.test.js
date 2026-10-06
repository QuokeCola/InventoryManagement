// Offline test of src/Code.gs with in-memory fakes of the Apps Script services.
// Run: node tests/code_gs.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

function fakeSheet(rows) {
  return {
    rows,
    getDataRange() { return { getValues: () => this.rows.map(r => r.slice()) }; },
    getRange(r, c) { const s = this; return { setValue(v) { while (s.rows[r - 1].length < c) s.rows[r - 1].push(''); s.rows[r - 1][c - 1] = v; } }; },
    appendRow(r) { this.rows.push(r); },
    setFrozenRows() {},
  };
}

function load(user) {
  const items = fakeSheet([
    ['ItemID', 'Description', 'Active', 'Status', 'Holder', 'Last Updated', 'Condition'],
    ['HA1', 'Impact hammer', true, 'Available', '', '', 'working'],
    ['3DP1', '3D Printer', false, 'Available', '', '', 'not working'],
    ['BS1', 'Ball Screw Stage', 'TRUE', 'Checked Out', 'chq@umich.edu', '', ''],
  ]);
  const sheets = { Items: items };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({
      getSheetByName: n => sheets[n] || null,
      insertSheet: n => (sheets[n] = fakeSheet([])),
    }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    Session: { getActiveUser: () => ({ getEmail: () => ctx.user }), getScriptTimeZone: () => 'UTC' },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Utilities: { formatDate: d => d.toISOString() },
    user,
  };
  vm.createContext(ctx);
  items.rows[3][5] = vm.runInContext('new Date("2026-10-06T16:05:00Z")', ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/Code.gs'), 'utf8'), ctx);
  return { ctx, sheets };
}

const { ctx, sheets } = load('alice@umich.edu');

let r = ctx.getItem('ha1');
assert.strictEqual(r.item.ItemID, 'HA1');
assert.strictEqual(r.user, 'alice@umich.edu');
assert.match(ctx.getItem('NOPE').error, /No item/);

r = ctx.checkOut('HA1', 'for modal test');
assert.strictEqual(r.item.Status, 'Checked Out');
assert.strictEqual(r.item.Holder, 'alice@umich.edu');
assert.strictEqual(sheets.Log.rows[0].join(), 'Timestamp,ItemID,Action,User,Note');
assert.strictEqual(sheets.Log.rows[1].slice(1).join('|'), 'HA1|Check out|alice@umich.edu|for modal test');
assert.strictEqual(r.history[0].action, 'Check out');

assert.throws(() => ctx.checkOut('HA1'), /already checked out/);
assert.throws(() => ctx.checkOut('3DP1'), /inactive/);
assert.throws(() => ctx.returnItem('3DP1'), /not checked out/);

assert.strictEqual(ctx.getMyItems().items.map(i => i.ItemID).join(), 'HA1');

ctx.user = 'bob@umich.edu';
r = ctx.returnItem('HA1', '');
assert.strictEqual(r.item.Status, 'Available');
assert.strictEqual(r.item.Holder, '');
assert.match(sheets.Log.rows[2][4], /on behalf of alice@umich.edu/);

ctx.user = 'chq@umich.edu';
const mine = ctx.getMyItems().items;
assert.strictEqual(mine[0].ItemID, 'BS1');  // "TRUE" text counts as active
// google.script.run turns any response containing a Date into null, so none may be returned
assert.strictEqual(typeof mine[0]['Last Updated'], 'string');

r = ctx.setCondition('ha1', 'Not Working');
assert.strictEqual(r.item.Condition, 'not working');
assert.strictEqual(sheets.Items.rows[1][6], 'not working');
assert.strictEqual(sheets.Log.rows.at(-1).slice(2, 5).join('|'), 'Condition|chq@umich.edu|working → not working');
const logLen = sheets.Log.rows.length;
ctx.setCondition('HA1', 'not working');               // no change, no log row
assert.strictEqual(sheets.Log.rows.length, logLen);
assert.throws(() => ctx.setCondition('HA1', 'great'), /must be one of/);
assert.strictEqual(r.conditions.join(), 'working,not working,unknown');

const all = ctx.getAllItems();
assert.strictEqual(all.items.length, 3);
assert.strictEqual(all.items.find(i => i.ItemID === 'BS1')['Last Updated'].constructor.name, 'String');
assert.strictEqual(all.items.find(i => i.ItemID === '3DP1').Active, false);

ctx.user = '';
assert.throws(() => ctx.getItem('HA1'), /Could not tell who you are/);

console.log('Code.gs: all checks passed');
