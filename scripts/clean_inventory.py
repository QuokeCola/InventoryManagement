"""Turn data/EquipmentList.xlsx into an import-ready Items table for the Google Sheet.

Reads the "Lab Equipment" and "Office Equipment" sheets and writes:
  data/items_import.xlsx  - Items, Log and Review tabs (import this into Google Sheets)
  data/items_import.csv   - the Items tab alone
  data/review.md          - everything the script guessed, for a human to check

Usage:  .venv/bin/python scripts/clean_inventory.py [path/to/EquipmentList.xlsx]
"""

import csv
import datetime as dt
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import openpyxl
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "data" / "EquipmentList.xlsx"
OUT_XLSX = ROOT / "data" / "items_import.xlsx"
OUT_CSV = ROOT / "data" / "items_import.csv"
OUT_REVIEW = ROOT / "data" / "review.md"

ITEM_COLUMNS = [
    "ItemID", "Category", "Description", "Brand", "Model", "S/N", "Condition",
    "Accessories", "Home Location", "Active", "Status", "Holder", "Last Updated",
    "Last Seen", "Notes",
]
LOG_COLUMNS = ["Timestamp", "ItemID", "Action", "User", "Note"]

EMAIL_DOMAIN = "umich.edu"

# Codes proposed for rows of the Lab Equipment sheet that have no Code Name, keyed by
# spreadsheet row. Existing prefixes are continued where one fits (3DP, AC); otherwise
# a new short prefix is introduced. All of these are listed in review.md.
PROPOSED_CODES = {
    95: "3DP12",   # Metal 3D Printer, Open Additive PANDA 11
    96: "AC8",     # 3-axis accelerometer, PCB 356A44
    97: "3DP13", 98: "3DP14", 99: "3DP15", 100: "3DP16", 101: "3DP17", 102: "3DP18",  # Ender 3 Pro x6
    103: "3DP19",  # BambuLab X1C
    104: "FS1",    # PCB 208C03 (no description; PCB 208C03 is a force sensor)
    105: "SCN1",   # 3D object scanner, Wiiboox Reeyee SP
    106: "PF1",    # Push-on fitting
    107: "THG1",   # Thermo-hygrometer (TH is taken by "T link hood")
    109: "ND1",    # Nitrogen dewar
    110: "DT1",    # Digital thermometer
    111: "PB1",    # Portable photo studio box
    112: "HSC1",   # High speed camera
    113: "LN1",    # Lens
    115: "3DP20", 116: "3DP21",  # Creality Ender 5 x2
    117: "RA1", 118: "RA2",      # Robot arms
    119: "DR1",    # Dremel
}
POSSIBLE_DUPLICATES = {
    "3DP20 / 3DP21": "Creality Ender 5 rows with no code, on the wood table; may be 3DP6 / 3DP9 "
                     "(also Ender 5, listed as retiring) rather than new printers",
    "PF1 / ND1": "also listed on the PANDA sheet (supplier list), may not need tracking here",
}
# Rows with nothing in them except a location note.
SKIP_ROWS = {108}

# Hand fixes for individual rows, applied after the generic cleanup. (field -> value, reason)
ROW_FIXES = {
    "LT3": {"Description": ("Laptop", 'was "Manual Stage", but brand/model is HP Zbook15 (same as LT2)')},
    "MA3": {"Description": ("Manual Stage", "blank; ThorLabs DTS25/M like MA1/MA2")},
    "AC7": {"Description": ("Accelerometer", "blank; guessed from AC code and PCB brand")},
    "M2": {"Description": ("Monitor", "blank; guessed from M code (M1 is a Dell monitor)")},
    "M3": {"Description": ("Monitor", "blank; guessed from M code (M1 is a Dell monitor)")},
    "M4": {"Description": ("Monitor", "blank, unopened; guessed from M code")},
    "FS1": {"Description": ("Force sensor", "blank; PCB 208C03 is an ICP force sensor")},
}

TEXT_FIXES = [  # applied to descriptions/brands/models
    (r"\bconditionor\b", "conditioner"),
    (r"\bAmplifer\b", "Amplifier"),
    (r"\bamplfier\b", "amplifier"),
    (r"\bMulit-Axis\b", "Multi-Axis"),
    (r"\bReinshaw\b", "Renishaw"),
    (r"\bThermal-Hygrometer\b", "Thermo-hygrometer"),
]

# Values that show up in location columns but are not places.
NOT_FOUND = re.compile(r"not found|^missing", re.I)
RETIRED = re.compile(r"retir", re.I)
MOVE_NOTES = re.compile(r"^(to long term storage|to new lab space|newly purchased|possibly packed|not working)$", re.I)
UNCERTAIN = re.compile(r"\?|^talk to", re.I)
UNIQNAME = re.compile(r"^[a-z]{3,8}$")  # bare lowercase word = a person's uniqname
ORDINALS = {"1": "1st", "2": "2nd", "3": "3rd", "4": "4th", "5": "5th", "erd": "3rd"}

review = defaultdict(list)  # section -> lines


def flag(section, item_id, text):
    review[section].append(f"- **{item_id}**: {text}")


def text(v):
    """Cell value as clean text; numbers stored as floats become integers ("36178.0" -> "36178")."""
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    if isinstance(v, (dt.datetime, dt.date)):
        return v.strftime("%Y-%m-%d")
    return re.sub(r"\s+", " ", str(v)).strip()


def fix_text(s):
    for pat, rep in TEXT_FIXES:
        s = re.sub(pat, rep, s)
    return s


def norm_condition(raw, item_id):
    s = raw.lower().strip()
    if s in ("working",):
        return "working"
    if s in ("not working", "no working", "broken"):
        return "not working"
    if s:
        flag("Condition normalized to unknown", item_id, f'original was "{raw}"')
    return "unknown"


def norm_location(raw):
    """Tidy a place name: fix typos and write shelves as "Cabinet 2, 3rd shelf"."""
    s = text(raw)
    s = re.sub(r"\bca[ib]{1,2}net\b|\bcaibnet\b", "Cabinet", s, flags=re.I)
    s = re.sub(r"^(Cabinet|Grey cabinet) ?(\d)?,? +(\w+) shelf", lambda m: (
        f"{m.group(1).capitalize()}{' ' + m.group(2) if m.group(2) else ''}, "
        f"{ORDINALS.get(m.group(3).lower(), m.group(3).lower())} shelf"), s, flags=re.I)
    s = re.sub(r"\bshelf left\b", "shelf (left)", s, flags=re.I)
    s = re.sub(r"^1100dow\b", "1100 Dow", s, flags=re.I)
    s = re.sub(r"^In (HA\d)$", r"In \1 case", s)
    return s[:1].upper() + s[1:] if s else s


def classify(raw):
    """What a location-column value means: ('place'|'person'|'notfound'|'retired'|'note'|'uncertain'|'', value)."""
    s = text(raw)
    if not s:
        return "", ""
    if RETIRED.search(s):
        return "retired", s
    if NOT_FOUND.search(s):
        return "notfound", s
    if MOVE_NOTES.match(s):
        return "note", s
    if UNCERTAIN.search(s):
        return "uncertain", s
    if UNIQNAME.match(s) and s not in ("outside", "office", "toolbox"):
        return "person", s
    if re.match(r"^1100dow \(", s, re.I):  # "1100DOW (to new lab space)" is a move note
        return "note", s
    return "place", norm_location(s)


def resolve_location(item_id, cols, found):
    """Pick home location / holder / active from the four location columns.

    Column priority, newest first: New Location (2026 audit), Location (after moving),
    Location (before moving), Location. Returns (home, holder, active, notes).
    """
    new, after, before, orig = (classify(c) for c in cols)
    history = "; ".join(f"{name}: {text(v)}" for name, v in
                        zip(("new", "after move", "before move", "original"), cols) if text(v))
    notes = []
    home, holder, active = "", "", True

    # A 2026 audit sighting wins over everything older.
    if new[0] == "place" or found:
        if new[0] == "place":
            home = new[1]
        if any(k in ("notfound", "retired") for k, _ in (after, before, orig)):
            notes.append("older columns said retired/not found, but it was seen in the 2026 audit")
        if not home:
            for kind, val in (after, before, orig):
                if kind == "place":
                    home = val
                    break
        if not home:
            flag("Active but no home location", item_id, history or "no location at all")
        return home, holder, active, notes, history

    if any(k == "retired" for k, _ in (after, before, orig)):
        active = False
        notes.append("marked retiring/retired")
    elif after[0] == "notfound" or (after[0] == "" and before[0] == "notfound"):
        active = False
        notes.append("not found in 1100 Dow")

    for kind, val in (after, before, orig):
        if kind == "place":
            home = val
            break
        if kind == "person" and not holder:
            holder = f"{val}@{EMAIL_DOMAIN}"
        if kind == "uncertain":
            notes.append(f'location unclear ("{val}")')
    if active and holder:
        flag("Assumed checked out to a person", item_id,
             f"location column holds uniqname, set Holder = {holder} ({history})")
    if active and not home:
        flag("Active but no home location", item_id, history or "no location at all")
    return home, holder, active, notes, history


def read_lab(ws):
    hdr = [text(c.value) for c in ws[1]]
    col = {name: i for i, name in enumerate(hdr)}
    items = []
    for r in range(2, ws.max_row + 1):
        vals = [c.value for c in ws[r]]
        get = lambda name: vals[col[name]] if col[name] < len(vals) else None
        if r in SKIP_ROWS or not any(text(v) for v in vals):
            continue
        item_id = text(get("Code Name"))
        if not item_id:
            item_id = PROPOSED_CODES.get(r)
            if not item_id:
                raise SystemExit(f"Lab Equipment row {r} has no Code Name and no proposed code")
            flag("Proposed codes (row had no Code Name)", item_id,
                 f"row {r}: {text(get('Description')) or '(no description)'} "
                 f"{text(get('Brand'))} {text(get('Model'))}".rstrip())
        item_id = item_id.upper()
        found_raw = text(get("Found?")).lower()
        found = found_raw in ("yes", "labeled", "labled", "probably", "unopened")
        loc_cols = [get("New Location"), get("Location (after moving)"),
                    get("Location (before moving)"), get("Location")]
        home, holder, active, notes, history = resolve_location(item_id, loc_cols, found)

        seen = get("Last Seen Date") or get("Accessories 2")  # "Accessories 2" holds older sighting dates
        accessories = text(get("Accessories"))
        if accessories.upper() == "N/A":
            accessories = ""
        if history:
            notes.append(f"location history: {history}")
        if found_raw and not found:
            notes.append(f'Found? = "{text(get("Found?"))}"')
        items.append({
            "ItemID": item_id, "Category": "Lab",
            "Description": fix_text(text(get("Description"))),
            "Brand": fix_text(text(get("Brand"))), "Model": fix_text(text(get("Model"))),
            "S/N": text(get("S/N")),
            "Condition": norm_condition(text(get("Condition")), item_id),
            "Accessories": accessories, "Home Location": home,
            "Active": active, "Status": "Checked Out" if (holder and active) else "Available",
            "Holder": holder if active else "",
            "Last Seen": seen.date() if isinstance(seen, dt.datetime) else None,
            "Notes": "; ".join(notes),
        })
    return items


def read_office(ws):
    items = []
    header = None
    for row in ws.iter_rows(values_only=True):
        cells = [text(v) for v in row]
        if cells and cells[0] == "Code Name":
            header = {name: i for i, name in enumerate(cells)}
            continue
        if not header or not cells[header["Code Name"]] or not cells[header["Description"]]:
            continue  # blank rows and the stray "6 Safety goggles" note below the table
        get = lambda name: cells[header[name]]
        item_id = get("Code Name").upper()
        items.append({
            "ItemID": item_id, "Category": "Office", "Description": get("Description"),
            "Brand": get("Brand"), "Model": get("Model"), "S/N": get("S/N"),
            "Condition": norm_condition(get("Condition"), item_id),
            "Accessories": "" if get("Accessories").upper() == "N/A" else get("Accessories"),
            "Home Location": get("Location"), "Active": True, "Status": "Available",
            "Holder": "", "Last Seen": None, "Notes": "",
        })
    return items


def apply_row_fixes(items):
    by_id = {it["ItemID"]: it for it in items}
    for item_id, fixes in ROW_FIXES.items():
        for field, (value, why) in fixes.items():
            it = by_id[item_id]
            it[field] = value
            flag("Descriptions filled in or corrected", item_id, f"{field} set to {value!r}: {why}")


def check_duplicates(items):
    ids = Counter(it["ItemID"] for it in items)
    dupes = [i for i, n in ids.items() if n > 1]
    if dupes:
        raise SystemExit(f"Duplicate ItemIDs: {dupes}")
    sns = defaultdict(list)
    for it in items:
        if it["S/N"]:
            sns[it["S/N"]].append(it["ItemID"])
    for sn, owners in sns.items():
        if len(owners) > 1:
            flag("Duplicate serial numbers", " / ".join(owners), f"both have S/N {sn}; one is probably a copy-paste error")


def write_outputs(items, now):
    for it in items:
        it["Last Updated"] = now
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Items"
    ws.append(ITEM_COLUMNS)
    for it in items:
        ws.append([it[c] for c in ITEM_COLUMNS])
    # Keep S/N and model as text so Sheets doesn't turn "13320102" into 1.33E+07.
    for col_name in ("ItemID", "Model", "S/N"):
        letter = get_column_letter(ITEM_COLUMNS.index(col_name) + 1)
        for cell in ws[letter][1:]:
            cell.number_format = "@"
    for col_name, fmt in (("Last Updated", "yyyy-mm-dd hh:mm"), ("Last Seen", "yyyy-mm-dd")):
        letter = get_column_letter(ITEM_COLUMNS.index(col_name) + 1)
        for cell in ws[letter][1:]:
            cell.number_format = fmt
    log = wb.create_sheet("Log")
    log.append(LOG_COLUMNS)
    rv = wb.create_sheet("Review")
    rv.append(["Section", "Detail"])
    for section, lines in review.items():
        for line in lines:
            rv.append([section, line.removeprefix("- ").replace("**", "")])
    for sheet in (ws, log, rv):
        for cell in sheet[1]:
            cell.font = Font(bold=True)
            cell.fill = PatternFill("solid", fgColor="DDE6F0")
        sheet.freeze_panes = "A2"
        for i, column in enumerate(sheet.columns, 1):
            width = max(len(text(c.value)) for c in column)
            sheet.column_dimensions[get_column_letter(i)].width = min(max(width + 2, 8), 60)
    wb.save(OUT_XLSX)

    with OUT_CSV.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(ITEM_COLUMNS)
        for it in items:
            w.writerow([it[c].strftime("%Y-%m-%d %H:%M") if isinstance(it[c], dt.datetime)
                        else ("TRUE" if it[c] is True else "FALSE" if it[c] is False else it[c] or "")
                        for c in ITEM_COLUMNS])

    order = ["Proposed codes (row had no Code Name)", "Descriptions filled in or corrected",
             "Duplicate serial numbers", "Possible duplicate entries", "Assumed checked out to a person",
             "Active but no home location", "Condition normalized to unknown",
             "Marked inactive (cannot be checked out)"]
    lines = [f"# Cleanup review\n\nGenerated {now:%Y-%m-%d %H:%M} from `{SRC.name}`. "
             f"{len(items)} items ({sum(it['Active'] for it in items)} active). "
             "Fix anything wrong here in the Google Sheet after import (or in "
             "`scripts/clean_inventory.py` and rerun).\n"]
    for section in order + [s for s in review if s not in order]:
        if review.get(section):
            lines.append(f"\n## {section} ({len(review[section])})\n")
            lines.extend(review[section])
    OUT_REVIEW.write_text("\n".join(lines) + "\n")


def main():
    wb = openpyxl.load_workbook(SRC, data_only=True)
    items = read_lab(wb["Lab Equipment"]) + read_office(wb["Office Equipment"])
    apply_row_fixes(items)
    check_duplicates(items)
    for item_id, why in POSSIBLE_DUPLICATES.items():
        flag("Possible duplicate entries", item_id, why)
    for it in items:
        if not it["Active"]:
            reason = it["Notes"].split("; location history")[0].split("; ")[0]
            review["Marked inactive (cannot be checked out)"].append(
                f"- **{it['ItemID']}** {it['Description']}: {reason}")
    items.sort(key=lambda it: (it["Category"] != "Lab",
                               [int(p) if p.isdigit() else p for p in re.split(r"(\d+)", it["ItemID"])]))
    write_outputs(items, dt.datetime.now().replace(second=0, microsecond=0))
    print(f"{len(items)} items -> {OUT_XLSX.relative_to(ROOT)}, {OUT_CSV.relative_to(ROOT)}; "
          f"review list -> {OUT_REVIEW.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
