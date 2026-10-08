/*
  The static site's stand-in for Apps Script's google.script.run and google.script.history, so the page
  (src/Index.html, built into the site by web/build.mjs) runs unchanged outside Apps Script.

  Calls go to Code.gs's doPost on the deployment anyone can reach, with the sign-in token: { fn, args, token } as
  text/plain JSON, which needs no CORS preflight. The token comes from signing in on the university-only
  deployment (?login=1), which sends the browser back here with #token=… on the address; it is kept in this
  browser until it expires (Code.gs, TOKEN_DAYS) or the server stops accepting it, and ?signout drops it.

  With no apiUrl in config.js, or ?demo on the address, the calls are answered here from a few made-up items
  instead, so the site can be tried out before it is connected to the inventory.

  The page may use the camera here (unlike in Apps Script's frame), so the label scanner runs live.
*/
(() => {
  const config = window.LAB_INVENTORY || {};
  const KEY = 'labInventory.token';
  const params = new URLSearchParams(location.search);
  const store = {
    get() { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } },
    set(v) { // signing out also forgets the item list the page keeps for its next visit
      try { if (v) localStorage.setItem(KEY, v); else { localStorage.removeItem(KEY); localStorage.removeItem('labInventory.items'); } } catch (e) {}
    },
  };
  window.SCANNER_LIVE = true;

  // A token handed back by sign-in: keep it, and take it off the address.
  const handed = /(?:^#|&)token=([^&]+)/.exec(location.hash);
  if (handed) {
    store.set(decodeURIComponent(handed[1]));
    history.replaceState(null, '', location.pathname + location.search);
  }
  addEventListener('hashchange', () => { if (/(?:^#|&)token=/.test(location.hash)) location.reload(); }); // handed back to a page already open
  if (params.has('signout')) store.set('');
  const demo = !config.apiUrl || params.has('demo');
  window.LAB_INVENTORY_DEMO = demo; // the page keeps the demo's items apart from the real ones
  const never = () => new Promise(() => {}); // a call that waits for a sign-in, which reloads the page

  // ---- signing in ------------------------------------------------------------------

  function signIn(why) {
    if (!config.loginUrl) { failed('This site has no sign-in address yet (web/config.js).'); return; }
    const back = location.origin + location.pathname + location.search.replace(/[?&]signout\b[^&]*/, '').replace(/^&/, '?');
    overlay(`<p class="cap">Lab Inventory</p>
      <h1>Sign in</h1>
      <p>${why || 'Use your University of Michigan Google account. You stay signed in on this device for a month.'}</p>
      <a class="btn fill" href="${config.loginUrl}?login=1&amp;return=${encodeURIComponent(back)}">Sign in with UMich Google</a>`);
  }

  function failed(text) {
    overlay(`<p class="cap">Lab Inventory</p><h1>Can’t reach the inventory</h1><p>${text}</p>`);
  }

  function overlay(html) {
    let box = document.getElementById('signin');
    if (!box) {
      const style = document.createElement('style');
      style.textContent = `
        #signin { position: fixed; inset: 0; z-index: 90; display: grid; place-items: center; padding: 24px; background: var(--paper, #ebe7e1); color: var(--ink, #1b1b1b); }
        #signin > div { max-width: 26rem; }
        #signin h1 { font: 800 2.2rem/1.1 var(--display, system-ui); margin: .3em 0 .4em; }
        #signin p { font: 400 1rem/1.5 var(--body, system-ui); color: var(--muted, #7d766c); margin: 0 0 1.6em; }
        #signin .cap { font-size: .74rem; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; margin: 0; }
        #signin .btn { text-decoration: none; }`;
      document.head.appendChild(style);
      box = Object.assign(document.createElement('div'), { id: 'signin' });
      box.setAttribute('role', 'dialog');
      document.body.appendChild(box);
    }
    box.innerHTML = `<div>${html}</div>`;
  }

  // ---- calls -------------------------------------------------------------------------

  async function call(fn, args) {
    if (demo) return Demo[fn](...args);
    const token = store.get();
    if (!token) { signIn(); return never(); }
    let res;
    try {
      res = await (await fetch(config.apiUrl, { method: 'POST', body: JSON.stringify({ fn, args, token }) })).json();
    } catch (e) {
      throw new Error('Could not reach the inventory. Check the connection and try again.');
    }
    if (res.auth) { store.set(''); signIn('Your sign-in has run out. Sign in again with your University of Michigan Google account.'); return never(); }
    if (res.error) throw new Error(res.error);
    return res.result;
  }

  /** google.script.run: .withSuccessHandler(f).withFailureHandler(g).someFunction(...args), as in Apps Script. */
  const runner = (ok, fail) => new Proxy({}, {
    get(_, name) {
      if (name === 'withSuccessHandler') return (f) => runner(f, fail);
      if (name === 'withFailureHandler') return (f) => runner(ok, f);
      return (...args) => { call(name, args).then((r) => ok && ok(r), (e) => fail && fail(e)); };
    },
  });

  window.google = { script: {
    run: runner(),
    history: { replace(state, query) { // keeps ?item= on the address, so a reload or a shared link opens the same item
      const q = new URLSearchParams(query || {});
      if (demo && params.has('demo')) q.set('demo', '');
      history.replaceState(null, '', location.pathname + (String(q) ? '?' + String(q).replace(/=(?=&|$)/g, '') : ''));
    } },
  } };

  // ---- demo items ------------------------------------------------------------------------

  const Demo = (() => {
    const user = 'demo@umich.edu', conditions = ['working', 'not working', 'unknown'], log = [];
    const now = () => new Date().toISOString().slice(0, 16).replace('T', ' ');
    const rows = [
      ['3DP1', '3D Printer', 'Creality', 'Ender 5', 'Wood table'], ['3DP2', '3D Printer', 'BambuLab', 'X1C', 'Wood table'],
      ['3DP3', '3D Printer', 'Ultimaker', 'Ultimaker 3', 'Cabinet 2'], ['AC1', 'Shear accelerometer', 'PCB', '393B05', 'In HA1 case'],
      ['AC2', 'Shear accelerometer', 'PCB', '352A24', 'In HA1 case'], ['AC3', '3-axis accelerometer', 'PCB', '356A44', 'Cabinet 1'],
      ['HA1', 'Impact hammer', 'PCB', '086C03', 'Cabinet 1'], ['HA2', 'Impact hammer', 'PCB', '086E80', 'Cabinet 1'],
      ['MD1', 'Motor driver', 'Aerotech', 'Ndrive', 'Cabinet 3'], ['MD2', 'Motor driver', 'Aerotech', 'Ndrive', 'Cabinet 3'],
      ['MD3', 'Motor driver', 'Aerotech', 'Soloist', 'Cabinet 3'], ['BS1', 'Ball screw stage', 'Aerotech', 'ATS115', 'Cabinet 2'],
      ['DR1', 'Dremel', 'Dremel', '4000', 'Tool drawer'], ['RA1', 'Robot arm', 'Universal Robots', 'UR5', 'Lab floor'],
    ];
    const items = rows.map(([ItemID, Description, Brand, Model, home], i) => ({
      ItemID, Category: 'Lab', Description, Brand, Model, 'S/N': '', Accessories: '', Condition: conditions[i % 5 === 4 ? 2 : 0],
      'Home Location': home, Active: ItemID !== '3DP3', Status: i === 3 || i === 8 ? 'Checked Out' : 'Available',
      Holder: i === 3 ? 'alex@umich.edu' : i === 8 ? user : '', 'Last Updated': '2026-10-07 09:30',
    }));
    const find = (id) => {
      const it = items.find((x) => x.ItemID === String(id || '').trim().toUpperCase());
      if (!it) throw new Error(`No item with ID "${id}".`);
      return it;
    };
    const copy = (x) => JSON.parse(JSON.stringify(x));
    const result = (it) => ({ item: copy(it), history: log.filter((h) => h.id === it.ItemID).slice(-5).reverse().map(({ id, ...h }) => h) });
    const change = (id, decide) => {
      const it = find(id), c = decide(it);
      if (c) {
        Object.assign(it, c.set, { 'Last Updated': now() });
        log.push({ id: it.ItemID, when: now(), action: c.action, user, note: c.note || '' });
      }
      return new Promise((resolve) => setTimeout(() => resolve(result(it)), 350)); // as if over the network
    };
    return {
      getAllItems: async () => ({ user, items: copy(items), conditions }),
      getItem: async (id) => result(find(id)),
      getPhoto: async () => null,
      checkOut: async (id, note) => change(id, (it) => {
        if (!it.Active) throw new Error(`${it.ItemID} is inactive (retired or missing) and cannot be checked out.`);
        if (it.Status === 'Checked Out') throw new Error(`${it.ItemID} is already checked out to ${it.Holder}. Return it first.`);
        return { set: { Status: 'Checked Out', Holder: user }, action: 'Check out', note };
      }),
      returnItem: async (id, note) => change(id, (it) => {
        if (it.Status !== 'Checked Out') throw new Error(`${it.ItemID} is not checked out.`);
        const other = it.Holder && it.Holder !== user ? `returned on behalf of ${it.Holder}. ` : '';
        return { set: { Status: 'Available', Holder: '' }, action: 'Return', note: (other + (note || '')).trim() };
      }),
      setCondition: async (id, condition) => change(id, (it) => {
        const value = String(condition || '').trim().toLowerCase();
        if (!conditions.includes(value)) throw new Error(`Condition must be one of: ${conditions.join(', ')}.`);
        return value === it.Condition ? null : { set: { Condition: value }, action: 'Condition', note: `${it.Condition} → ${value}` };
      }),
    };
  })();

  if (demo) {
    addEventListener('DOMContentLoaded', () => {
      const tag = Object.assign(document.createElement('p'), { textContent: 'Demo items: not connected to the inventory' });
      tag.style.cssText = 'position:fixed;left:50%;top:env(safe-area-inset-top,0px);transform:translateX(-50%);z-index:80;margin:0;white-space:nowrap;' +
        'padding:2px 10px;font:600 .66rem/1.4 system-ui;letter-spacing:.12em;text-transform:uppercase;background:var(--accent,#b8742a);color:#fff;pointer-events:none';
      document.body.appendChild(tag);
    });
  }
})();
