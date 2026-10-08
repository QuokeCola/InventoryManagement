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
    getLastRow() { return this.rows.length; },
    getRange(r, c, nr = 1, nc = 1) {
      const s = this;
      const values = () => s.rows.slice(r - 1, r - 1 + nr).map(row => Array.from({ length: nc }, (_, j) => row[c - 1 + j] ?? ''));
      return {
        setValue(v) { while (s.rows[r - 1].length < c) s.rows[r - 1].push(''); s.rows[r - 1][c - 1] = v; },
        getValues: values,
        createTextFinder(text) { // matchCase(false) and matchEntireCell(true), as Code.gs uses it
          const finder = { matchCase: () => finder, matchEntireCell: () => finder, findAll: () => {
            const hits = [];
            values().forEach((row, i) => row.forEach(v => { if (String(v).toLowerCase() === String(text).toLowerCase()) hits.push({ getRow: () => r + i }); }));
            return hits;
          } };
          return finder;
        },
      };
    },
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
    require,
    SpreadsheetApp: { getActiveSpreadsheet: () => ({
      getSheetByName: n => sheets[n] || null,
      insertSheet: n => (sheets[n] = fakeSheet([])),
    }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => ctx.props[k] ?? null, setProperty: (k, v) => { ctx.props[k] = v; } }) },
    DriveApp: { getFolderById: id => {
      assert.strictEqual(id, 'photos');
      const files = ctx.photos.slice();
      return { searchFiles: () => ({ hasNext: () => files.length > 0, next: () => files.shift() }) };
    } },
    ScriptApp: { getOAuthToken: () => 'token' },
    CacheService: { getScriptCache: () => ({
      get: k => (k in ctx.cache ? ctx.cache[k] : null),
      getAll: ks => Object.fromEntries(ks.filter(k => k in ctx.cache).map(k => [k, ctx.cache[k]])),
      put: (k, v) => { ctx.cache[k] = v; },
      putAll: o => Object.assign(ctx.cache, o),
    }) },
    UrlFetchApp: { fetch: (url, opts) => { ctx.fetched.push(url); return ctx.fetch(url, opts); } },
    Session: { getActiveUser: () => ({ getEmail: () => ctx.user }), getScriptTimeZone: () => 'UTC' },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Utilities: {
      formatDate: d => d.toISOString(), base64Encode: bytes => Buffer.from(bytes).toString('base64'),
      base64EncodeWebSafe: v => Buffer.from(v).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      base64DecodeWebSafe: v => [...Buffer.from(v.replace(/-/g, '+').replace(/_/g, '/'), 'base64')],
      newBlob: bytes => ({ getDataAsString: () => Buffer.from(bytes).toString('utf8') }),
      computeHmacSha256Signature: (v, key) => [...require('crypto').createHmac('sha256', key).update(v).digest()],
      getUuid: () => require('crypto').randomUUID(),
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text => ({ text, setMimeType() { return this; } }) },
    HtmlService: { createHtmlOutput: html => ({ html, setTitle() { return this; }, addMetaTag() { return this; } }) },
    user, props: {}, cache: {}, photos: [], fetched: [], fetch: () => { throw new Error('no network'); },
  };
  vm.createContext(ctx);
  items.rows[3][5] = vm.runInContext('new Date("2026-10-06T16:05:00Z")', ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/Code.gs'), 'utf8'), ctx);
  return { ctx, sheets };
}

const { ctx, sheets } = load('alice@umich.edu');

let r = ctx.getItem('ha1');
assert.strictEqual(r.item.ItemID, 'HA1');
assert.strictEqual(r.history.length, 0);
assert.throws(() => ctx.getItem('NOPE'), /No item/);

r = ctx.checkOut('HA1', 'for modal test');
assert.strictEqual(r.item.Status, 'Checked Out');
assert.strictEqual(r.item.Holder, 'alice@umich.edu');
assert.strictEqual(sheets.Log.rows[0].join(), 'Timestamp,ItemID,Action,User,Note');
assert.strictEqual(sheets.Log.rows[1].slice(1).join('|'), 'HA1|Check out|alice@umich.edu|for modal test');
assert.strictEqual(r.history[0].action, 'Check out');

assert.throws(() => ctx.checkOut('HA1'), /already checked out/);
assert.throws(() => ctx.checkOut('3DP1'), /inactive/);
assert.throws(() => ctx.returnItem('3DP1'), /not checked out/);

const holder = (id) => ctx.getAllItems().items.find(i => i.ItemID === id).Holder;
assert.strictEqual(holder('HA1'), 'alice@umich.edu');

ctx.user = 'bob@umich.edu';
r = ctx.returnItem('HA1', '');
assert.strictEqual(r.item.Status, 'Available');
assert.strictEqual(r.item.Holder, '');
assert.match(sheets.Log.rows[2][4], /on behalf of alice@umich.edu/);

ctx.user = 'chq@umich.edu';
const bs1 = ctx.getItem('BS1').item;
assert.strictEqual(bs1.Active, true);  // "TRUE" text counts as active
// google.script.run turns any response containing a Date into null, so none may be returned
assert.strictEqual(typeof bs1['Last Updated'], 'string');

r = ctx.setCondition('ha1', 'Not Working');
assert.strictEqual(r.item.Condition, 'not working');
assert.strictEqual(sheets.Items.rows[1][6], 'not working');
assert.strictEqual(sheets.Log.rows.at(-1).slice(2, 5).join('|'), 'Condition|chq@umich.edu|working → not working');
const logLen = sheets.Log.rows.length;
ctx.setCondition('HA1', 'not working');               // no change, no log row
assert.strictEqual(sheets.Log.rows.length, logLen);
assert.throws(() => ctx.setCondition('HA1', 'great'), /must be one of/);

const all = ctx.getAllItems();
assert.strictEqual(all.user, 'chq@umich.edu');
assert.strictEqual(all.conditions.join(), 'working,not working,unknown');
assert.strictEqual(all.items.length, 3);
assert.strictEqual(all.items.find(i => i.ItemID === 'BS1')['Last Updated'].constructor.name, 'String');
assert.strictEqual(all.items.find(i => i.ItemID === '3DP1').Active, false);
assert.strictEqual(all.items.find(i => i.ItemID === 'HA1')['S/N'], undefined); // only the listed columns

// ---- getPhoto ----
const blob = (type, text) => ({ getContentType: () => type, getBytes: () => [...Buffer.from(text)] });
const file = (id, name, size = 1000) => ({ getId: () => id, getName: () => name, getSize: () => size,
                                           getBlob: () => blob('image/jpeg', 'full ' + id), getThumbnail: () => blob('image/png', 'small ' + id) });
const dataUrl = (type, text) => `data:${type};base64,${Buffer.from(text).toString('base64')}`;

assert.strictEqual(ctx.getPhoto('AC2'), null);           // no folder set up
ctx.props.PHOTO_FOLDER_ID = 'photos';
ctx.photos = [file('f20', 'AC20.jpg'), file('fb', 'AC2 side.jpg'), file('fa', 'ac2 front.jpg')];
ctx.fetch = (url, opts) => {
  assert.strictEqual(opts.headers.Authorization, 'Bearer token');
  if (url.startsWith('https://www.googleapis.com/drive/v3/files/fa')) {
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ thumbnailLink: 'https://lh3.example/abc=s220' }) };
  }
  if (url === 'https://lh3.example/abc=s1200') return { getResponseCode: () => 200, getBlob: () => blob('image/jpeg', 'thumb fa') };
  throw new Error('unexpected fetch ' + url);
};
// "AC2 front" and "AC2 side" match (case aside) but "AC20" doesn't; the first by name wins, scaled by Drive
assert.strictEqual(ctx.getPhoto('ac2').url, dataUrl('image/jpeg', 'thumb fa'));
assert.strictEqual(ctx.fetched.at(-1), 'https://lh3.example/abc=s1200');
ctx.photos = []; ctx.fetched = [];                      // found once, then kept in the cache
assert.strictEqual(ctx.getPhoto('AC2').url, dataUrl('image/jpeg', 'thumb fa'));
assert.strictEqual(ctx.fetched.length, 0);
ctx.cache = {};

ctx.fetch = () => { throw new Error('no network'); };   // Drive's thumbnail unavailable: the file itself if small...
ctx.photos = [file('fa', 'AC2.jpg')];
assert.strictEqual(ctx.getPhoto('AC2').url, dataUrl('image/jpeg', 'full fa'));
ctx.cache = {};
ctx.photos = [file('fa', 'AC2.jpg', 8e6)];              // ...or Drive's small default thumbnail if not
assert.strictEqual(ctx.getPhoto('AC2').url, dataUrl('image/png', 'small fa'));

ctx.cache = {};
ctx.photos = [file('f20', 'AC20.jpg')];
assert.strictEqual(ctx.getPhoto('AC2'), null);           // no photo of its own
assert.strictEqual(ctx.getPhoto("AC2' or title contains '"), null); // nothing odd goes into the Drive query

ctx.cache = {};                                          // a photo over the cache's 100 KB per key is kept in pieces
ctx.photos = [file('fa', 'AC2.jpg')];
const big = 'x'.repeat(250000);
ctx.photos[0].getBlob = () => blob('image/jpeg', big);
assert.strictEqual(ctx.getPhoto('AC2').url, dataUrl('image/jpeg', big));
assert.ok(Object.values(ctx.cache).every(v => v.length <= 100000) && Object.keys(ctx.cache).length > 2);
ctx.photos = [];
assert.strictEqual(ctx.getPhoto('AC2').url, dataUrl('image/jpeg', big));

ctx.user = '';
assert.throws(() => ctx.getItem('HA1'), /Could not tell who you are/);

// ---- only the university's accounts ----
ctx.user = 'someone@gmail.com';
assert.throws(() => ctx.getAllItems(), /Sign in with your umich.edu account/);
ctx.props.ALLOWED_DOMAIN = '';                          // turned off
assert.strictEqual(ctx.getAllItems().user, 'someone@gmail.com');
delete ctx.props.ALLOWED_DOMAIN;

// ---- a note that looks like a formula goes in as text ----
ctx.user = 'chq@umich.edu';
ctx.checkOut('HA1', '=IMPORTXML("http://x", "//a")');
assert.strictEqual(sheets.Log.rows.at(-1)[4], '\'=IMPORTXML("http://x", "//a")');
ctx.returnItem('HA1', 'back - fine');
assert.strictEqual(sheets.Log.rows.at(-1)[4], 'back - fine');

// ---- the static site: sign-in tokens and doPost ----
const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).text);
const token = ctx.makeToken_('dana@umich.edu');
assert.strictEqual(ctx.verifyToken_(token), 'dana@umich.edu');
assert.strictEqual(ctx.verifyToken_(token, Date.now() + 31 * 864e5), '');          // expired
const [payload, sig] = token.split('.');
const forged = Buffer.from('eve@umich.edu|' + (Date.now() + 1e9)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
assert.strictEqual(ctx.verifyToken_(forged + '.' + sig), '');                      // someone else's name, our signature
assert.strictEqual(ctx.verifyToken_(payload + '.x' + sig), '');
assert.strictEqual(ctx.verifyToken_(''), '');

ctx.user = '';                                          // the open deployment: Session doesn't know who it is
assert.deepStrictEqual(post({ fn: 'getAllItems', token: 'nope' }), { error: 'Please sign in again.', auth: true });
assert.match(post({ fn: 'eval', args: ['1'], token }).error, /Unknown call/);
assert.match(post({ fn: 'readItems_', token }).error, /Unknown call/);
assert.strictEqual(post({ fn: 'getAllItems', token }).result.user, 'dana@umich.edu');
r = post({ fn: 'checkOut', args: ['ha1', 'from the site'], token }).result;
assert.strictEqual(r.item.Holder, 'dana@umich.edu');
assert.strictEqual(sheets.Log.rows.at(-1).slice(2, 5).join('|'), 'Check out|dana@umich.edu|from the site');
assert.match(post({ fn: 'checkOut', args: ['HA1'], token }).error, /already checked out/);
assert.match(post({ fn: 'getAllItems', token: ctx.makeToken_('x@gmail.com') }).error, /umich.edu account/);

// sign-in page: only back to the site, with the token in the fragment
ctx.user = 'dana@umich.edu';
assert.match(ctx.doGet({ parameter: { login: '1', return: 'https://evil.example/' } }).html, /not for this site/);
ctx.props.SITE_URL = 'https://quokecola.github.io/InventoryManagement';
assert.match(ctx.doGet({ parameter: { login: '1', return: 'https://evil.example/' } }).html, /not for this site/);
assert.match(ctx.doGet({ parameter: { login: '1', return: 'https://quokecola.github.io/InventoryManagement.evil.example/' } }).html, /not for this site/);
const page = ctx.doGet({ parameter: { login: '1', return: 'https://quokecola.github.io/InventoryManagement/?item=HA1' } }).html;
const handed = decodeURIComponent(/#token=([^"&]+)"/.exec(page)[1]);
assert.ok(page.includes('https://quokecola.github.io/InventoryManagement/?item=HA1#token='));
assert.strictEqual(ctx.verifyToken_(handed), 'dana@umich.edu');
ctx.user = 'mallory@gmail.com';
assert.match(ctx.doGet({ parameter: { login: '1' } }).html, /Sign in with your umich.edu account/);
// with SITE_URL set, the web app (and the labels' QR codes) go on to the site
assert.ok(ctx.doGet({ parameter: { item: 'ha1' } }).html.includes('"https://quokecola.github.io/InventoryManagement/?item=HA1"'));

console.log('Code.gs: all checks passed');
