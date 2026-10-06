# Lab Inventory

QR-code check-out / return for lab equipment, built on Google Sheets and Google Apps Script.
There's no server to host or maintain.

- **Google Sheet**: the `Items` tab lists every item and its current status, and the `Log` tab records
  every check-out and return.
- **Web app** (`src/`): the main screen is a 3D archive (Three.js, loaded from the jsDelivr CDN): every
  item is a slab standing in a lane, one lane per equipment type, after
  [RhineLabUI](https://github.com/LBEILC/RhineLabUI) (MIT). Click a slab to select it, then check it
  out or return it from the overlay, or click again for details. Devices without WebGL get a 2D
  card archive instead. A side panel (a drawer on phones) has
  search, status filters and your checked-out items. Each item's QR code opens
  `<web app URL>?item=<ItemID>` straight to that item. The person is identified by their
  signed-in umich.edu Google account, so nobody types a name.
- **Labels** (`scripts/make_labels.py`): a printable sheet of QR labels.

```
data/EquipmentList.xlsx        original spreadsheet (input)
scripts/clean_inventory.py     EquipmentList.xlsx -> data/items_import.xlsx / .csv + data/review.md
scripts/make_labels.py         items CSV -> data/labels.html (printable QR labels)
src/                           Apps Script project (Code.gs, Index.html, Archive3D.html, appsscript.json)
tests/code_gs.test.js          offline test of Code.gs with fake Google services (node tests/code_gs.test.js)
```

## 1. Clean the data

```bash
python -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/clean_inventory.py
```

This reads the `Lab Equipment` and `Office Equipment` sheets and writes `data/items_import.xlsx`, which has
three tabs: `Items`, an empty `Log`, and `Review`. It also writes the same review list to `data/review.md`.
Read the review list before importing. It covers:

- codes proposed for the rows that had no Code Name
- descriptions the script filled in
- a duplicate serial number
- items marked **inactive**: retiring or "not found in 1100 Dow". Inactive items can't be checked out.
- the two items assumed to be with a person because a location column held a uniqname

How the four location columns were merged: `New Location` (the 2026 audit) wins, then
`Location (after moving)`, then `Location (before moving)`, then `Location`. The original values
are kept in the `Notes` column.

You can fix things either directly in the Google Sheet after import, or in the tables at the top of
`clean_inventory.py`, then rerun the script.

### Items columns

| Column | Meaning |
|---|---|
| ItemID | unique code; this is what's in the QR code |
| Category | Lab / Office |
| Description, Brand, Model, S/N, Accessories | as in the original sheet |
| Condition | working / not working / unknown |
| Home Location | where it lives when not checked out |
| Active | FALSE = retired or missing; the app refuses check-outs |
| Status | Available / Checked Out (set by the app) |
| Holder | email of whoever has it (set by the app) |
| Last Updated | last time the app changed the row |
| Last Seen | last inventory sighting from the original sheet |
| Notes | location history and anything odd |

The app finds columns by their header names. You can reorder the columns or add new ones, but don't
rename `ItemID`, `Active`, `Status`, `Holder` or `Last Updated`.

## 2. Create the Google Sheet

1. In Google Drive (signed in with your umich.edu account): **New → File upload →**
   `data/items_import.xlsx`. Then open it and choose **File → Save as Google Sheets**.
2. Check the `Items` tab. S/N and Model should still be text; for example, `13320102` should not have
   turned into `1.33E+07`. Optionally, select the `Active` column and choose **Insert → Checkbox**.
3. Share the Sheet only with the people who manage the inventory. Everyone else uses the web app,
   which runs as you, so they don't need access to the Sheet.

## 3. Add the script

**Option A: paste it in**

1. In the Sheet: **Extensions → Apps Script**.
2. Replace the contents of `Code.gs` with `src/Code.gs`.
3. Click **+ → HTML** and name the file `Index`. The editor shows it as `Index.html`; either name works. Paste in `src/Index.html`.
   Do the same for `Archive3D` with `src/Archive3D.html` (the 3D archive view).
4. Go to **Project Settings** and tick **Show "appsscript.json" manifest file in editor**. Then replace
   `appsscript.json` with `src/appsscript.json`.

**Option B: clasp (command line)**

```bash
npm install -g @google/clasp
clasp login
cp .clasp.json.example .clasp.json   # then paste the Script ID from Apps Script > Project Settings
clasp push
```

## 4. Deploy the web app

1. In the Apps Script editor: **Deploy → New deployment → ⚙ → Web app**.
2. Set **Execute as: Me** and **Who has access: Anyone within University of Michigan**.
3. Click **Deploy**, authorize the app, and copy the **Web app URL** (it ends in `/exec`).
4. Open `<URL>?item=HA1` on your phone to test it.

**Updating the code later:** use **Deploy → Manage deployments → ✎ → Version: New version**.
This keeps the same URL. Don't create a new deployment, because it gets a new URL and the printed
QR codes would stop working.

**Why these settings.** "Execute as me" means users don't need access to the Sheet. "Within University
of Michigan" means Google tells the script who is signed in (`Session.getActiveUser()`). With
"Anyone with a Google account", Google won't reveal the email of someone outside the domain, so the
log would be blank. The other option is **Execute as: User accessing the web app**. That works too,
but then every user needs edit access to the Sheet.

## 5. Print the labels

```bash
.venv/bin/python scripts/make_labels.py --url "https://script.google.com/a/macros/umich.edu/s/.../exec"
```

Open `data/labels.html` in a browser and print it at **100% / Actual size** on Avery 5160 or 8160
sheets (30 per page). Useful flags:

- `--ids HA1 AC2`: print only these items
- `--all`: include inactive items
- `--plain`: plain paper with cut lines

To make labels for items added in the Sheet later, download the `Items` tab as CSV and pass it with
`--items path.csv`.

## Day to day

- **Adding an item:** add a row on the `Items` tab with a new ItemID, set Active = TRUE and
  Status = Available, then print a label for it.
- **Retiring an item:** set Active = FALSE.
- **Condition:** anyone can change an item's condition from its page (working / not working /
  unknown). Each change is logged on `Log` as "Condition", for example `working → not working`.
- **Who has what:** filter `Items` by Status = Checked Out. The full history is on `Log`.
- **Returns:** anyone can return an item. If someone other than the holder returns it, the log
  records "returned on behalf of …".
