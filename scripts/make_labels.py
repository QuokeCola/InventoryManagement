"""Make a printable sheet of QR labels, one per item.

Each QR code opens <web app URL>?item=<ItemID>. The page is laid out for Avery 5160 /
8160 address labels (30 per US Letter sheet, 2.625" x 1"); print it from a browser at
100% scale ("Actual size", no margins added). Use --plain for a simple cut-apart grid.

Usage:
  .venv/bin/python scripts/make_labels.py --url https://script.google.com/a/macros/umich.edu/s/XXXX/exec
  .venv/bin/python scripts/make_labels.py --url ... --ids HA1 HA2 AC2     # just these
  .venv/bin/python scripts/make_labels.py --url ... --all                 # include inactive items
"""

import argparse
import csv
import html
import io
import sys
from pathlib import Path
from urllib.parse import quote

import qrcode
import qrcode.image.svg

ROOT = Path(__file__).resolve().parent.parent

AVERY_5160_CSS = """
@page { size: letter; margin: 0; }
.sheet { width: 8.5in; height: 11in; padding: 0.5in 0.1875in 0; display: grid; break-after: page;
         grid-template-columns: repeat(3, 2.625in); grid-auto-rows: 1in; column-gap: 0.125in; }
.label { height: 1in; }
"""
PLAIN_CSS = """
@page { size: letter; margin: 0.4in; }
.sheet { display: grid; grid-template-columns: repeat(3, 2.5in); grid-auto-rows: 1in; gap: 0.15in; break-after: page; }
.label { outline: 1px dashed #bbb; }
"""


def item_url(base, item_id):
    sep = "&" if "?" in base else "?"
    return f"{base}{sep}item={quote(item_id)}"


def qr_svg(data):
    img = qrcode.make(data, image_factory=qrcode.image.svg.SvgPathImage,
                      error_correction=qrcode.constants.ERROR_CORRECT_M, border=4)
    buf = io.BytesIO()
    img.save(buf)
    svg = buf.getvalue().decode()
    return svg[svg.index("<svg"):]  # drop the XML declaration so it can be inlined


def load_items(csv_path, ids, include_inactive):
    with open(csv_path, newline="") as f:
        rows = list(csv.DictReader(f))
    if ids:
        wanted = [i.upper() for i in ids]
        by_id = {r["ItemID"].upper(): r for r in rows}
        missing = [i for i in wanted if i not in by_id]
        if missing:
            sys.exit(f"Not in {csv_path}: {', '.join(missing)}")
        return [by_id[i] for i in wanted]
    return [r for r in rows if include_inactive or r["Active"].upper() == "TRUE"]


def build_page(items, base_url, plain):
    labels = []
    for it in items:
        item_id = it["ItemID"]
        desc = it.get("Description", "")
        labels.append(
            '<div class="label">'
            f'<div class="qr">{qr_svg(item_url(base_url, item_id))}</div>'
            f'<div class="text"><div class="id">{html.escape(item_id)}</div>'
            f'<div class="desc">{html.escape(desc)}</div>'
            '<div class="hint">Scan to check out / return</div></div>'
            '</div>')
    per_sheet = 27 if plain else 30
    sheets = "\n".join('<div class="sheet">' + "\n".join(labels[i:i + per_sheet]) + "</div>"
                       for i in range(0, len(labels), per_sheet))
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Inventory labels</title>
<style>
* {{ box-sizing: border-box; }}
body {{ margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; }}
{PLAIN_CSS if plain else AVERY_5160_CSS}
.label {{ display: flex; align-items: center; gap: 0.08in; padding: 0.05in 0.08in; overflow: hidden; }}
.qr svg {{ width: 0.9in; height: 0.9in; display: block; }}
.text {{ min-width: 0; }}
.id {{ font-size: 15pt; font-weight: bold; line-height: 1.05; }}
.desc {{ font-size: 8pt; line-height: 1.15; max-height: 2.3em; overflow: hidden; }}
.hint {{ font-size: 6pt; color: #444; margin-top: 2px; }}
@media screen {{ body {{ background: #ccc; }} .sheet {{ background: #fff; margin: 16px auto; }} }}
</style></head>
<body>
{sheets}
</body></html>
"""


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", required=True, help="the deployed web app URL (ends in /exec)")
    ap.add_argument("--items", default=ROOT / "data" / "items_import.csv", type=Path,
                    help="CSV with ItemID, Description and Active columns (default: data/items_import.csv; "
                         "or download the Items tab from the Google Sheet as CSV)")
    ap.add_argument("--ids", nargs="+", help="only these item IDs")
    ap.add_argument("--all", action="store_true", help="include inactive items")
    ap.add_argument("--plain", action="store_true", help="simple grid with cut lines instead of Avery 5160")
    ap.add_argument("--out", default=ROOT / "data" / "labels.html", type=Path)
    args = ap.parse_args()

    if not args.url.startswith("https://"):
        sys.exit("--url should be the https:// web app URL from Deploy > Manage deployments")
    items = load_items(args.items, args.ids, args.all)
    args.out.write_text(build_page(items, args.url, args.plain))
    print(f"{len(items)} labels -> {args.out}  (open in a browser and print at 100% scale)")


if __name__ == "__main__":
    main()
