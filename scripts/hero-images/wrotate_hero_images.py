#!/usr/bin/env python3
"""
wrotate_hero_images.py — populate hero_image for curated watch_models.

Pipeline per model:
    resolve image URL -> download -> normalise to JPEG -> upload to Supabase
    Storage -> PATCH watch_models.hero_image (and hero_credit).

Storage convention (matches existing rows):
    media/watches/<uploader_user_id>/model-<watch_model_id>.jpg
Public URL:
    https://api.wrotate.com/storage/v1/object/public/media/watches/<uid>/model-<mid>.jpg?v=<epoch_ms>

Usage:
    export SUPABASE_URL=https://xnzweevzrojmouzhpwzv.supabase.co
    export SUPABASE_SERVICE_ROLE_KEY=...            # service role, NOT anon
    export WROTATE_UPLOADER_ID=d70b1a85-4f31-4431-b3b7-db76543daaf5

    python3 wrotate_hero_images.py --dry-run                  # resolve only, touch nothing
    python3 wrotate_hero_images.py --only cartier-santos      # one model, for real
    python3 wrotate_hero_images.py                            # every model missing a hero
    python3 wrotate_hero_images.py --force --only seiko-turtle  # redo one that already has an image

Deps:  pip3 install requests pillow
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional
from urllib.parse import urljoin, urlparse

import requests
from PIL import Image

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
UPLOADER_ID = os.environ.get("WROTATE_UPLOADER_ID", "d70b1a85-4f31-4431-b3b7-db76543daaf5")
PUBLIC_BASE = os.environ.get("WROTATE_PUBLIC_BASE", "https://api.wrotate.com").rstrip("/")

BUCKET = "media"
TABLE = "watch_models"
MAX_EDGE = 1500
JPEG_QUALITY = 90
MIN_ACCEPTABLE_EDGE = 600
REQUEST_TIMEOUT = 30
POLITE_DELAY = 1.5
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/125.0 Safari/537.36")
SCRIPT_DIR = Path(__file__).resolve().parent


@dataclass
class Result:
    slug: str
    model_id: str = ""
    status: str = "pending"
    source_page: str = ""
    image_url: str = ""
    strategy: str = ""
    src_format: str = ""
    src_size: str = ""
    out_size: str = ""
    out_bytes: int = 0
    hero_image: str = ""
    ambiguous: bool = False
    notes: list = field(default_factory=list)

    def note(self, msg: str) -> None:
        self.notes.append(msg)


def sb_headers(extra: Optional[dict] = None) -> dict:
    h = {"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"}
    if extra:
        h.update(extra)
    return h


def fetch_targets(only, force, limit):
    params = {"select": "id,brand,name,slug,hero_image", "is_auto": "eq.false",
              "merged_into": "is.null", "order": "brand,name"}
    if only:
        params["slug"] = "in.(" + ",".join(f'"{s}"' for s in only) + ")"
    elif not force:
        params["hero_image"] = "is.null"
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{TABLE}", headers=sb_headers(), params=params, timeout=REQUEST_TIMEOUT)
    r.raise_for_status()
    rows = r.json()
    if only and not force:
        rows = [r_ for r_ in rows if not r_.get("hero_image")] or rows
    if limit:
        rows = rows[:limit]
    return rows


def upload_object(path: str, data: bytes) -> None:
    r = requests.post(f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{path}",
                      headers=sb_headers({"Content-Type": "image/jpeg", "x-upsert": "true", "Cache-Control": "3600"}),
                      data=data, timeout=REQUEST_TIMEOUT)
    if r.status_code >= 300:
        raise RuntimeError(f"storage upload {r.status_code}: {r.text[:300]}")


def patch_model(model_id: str, hero_image: str, credit: Optional[str]) -> None:
    payload = {"hero_image": hero_image, "hero_credit": credit}
    r = requests.patch(f"{SUPABASE_URL}/rest/v1/{TABLE}",
                       headers=sb_headers({"Content-Type": "application/json", "Prefer": "return=minimal"}),
                       params={"id": f"eq.{model_id}"}, data=json.dumps(payload), timeout=REQUEST_TIMEOUT)
    if r.status_code >= 300:
        raise RuntimeError(f"patch {r.status_code}: {r.text[:300]}")


META_RE = re.compile(r"<meta[^>]+>", re.I)
CONTENT_RE = re.compile(r'content=["\']([^"\']+)["\']', re.I)
PROP_RE = re.compile(r'(?:property|name)=["\']([^"\']+)["\']', re.I)
LDJSON_RE = re.compile(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', re.I | re.S)
IMG_RE = re.compile(r"<img[^>]+>", re.I)
SRC_RE = re.compile(r'(?:data-src|srcset|src)=["\']([^"\']+)["\']', re.I)


def _og_image(html):
    for tag in META_RE.findall(html):
        prop = PROP_RE.search(tag)
        if prop and prop.group(1).lower() in ("og:image", "og:image:secure_url", "twitter:image"):
            c = CONTENT_RE.search(tag)
            if c:
                return c.group(1)
    return None


def _ldjson_image(html):
    for block in LDJSON_RE.findall(html):
        try:
            data = json.loads(block.strip())
        except Exception:
            continue
        stack = [data]
        while stack:
            node = stack.pop()
            if isinstance(node, list):
                stack.extend(node)
            elif isinstance(node, dict):
                if node.get("@type") in ("Product", "IndividualProduct"):
                    img = node.get("image")
                    if isinstance(img, str):
                        return img
                    if isinstance(img, list) and img:
                        first = img[0]
                        return first if isinstance(first, str) else first.get("url")
                    if isinstance(img, dict):
                        return img.get("url")
                stack.extend(node.values())
    return None


def _largest_img(html, base):
    best = None
    for tag in IMG_RE.findall(html):
        m = SRC_RE.search(tag)
        if not m:
            continue
        url = m.group(1).split()[0]
        if not url or url.startswith("data:"):
            continue
        low = url.lower()
        score = 0
        if any(k in low for k in ("large", "zoom", "2000", "1500", "1200", "hero")):
            score += 2
        if any(k in low for k in ("product", "packshot", "still")):
            score += 2
        if any(k in low for k in ("icon", "logo", "sprite", "banner", "flag")):
            score -= 5
        if score > 0 and (best is None or score > best[0]):
            best = (score, urljoin(base, url))
    return best[1] if best else None


def resolve_image_url(entry, res, session):
    if entry.get("image_url"):
        res.strategy = "explicit"
        res.source_page = entry.get("page_url", "")
        return entry["image_url"]
    page = entry.get("page_url")
    if not page:
        res.note("no page_url or image_url in sources.json")
        return None
    res.source_page = page
    try:
        r = session.get(page, timeout=REQUEST_TIMEOUT)
        r.raise_for_status()
    except Exception as e:
        res.note(f"page fetch failed: {e}")
        return None
    html = r.text
    for name, fn in (("og:image", lambda: _og_image(html)), ("ld+json", lambda: _ldjson_image(html)),
                     ("largest-img", lambda: _largest_img(html, page))):
        url = fn()
        if url:
            res.strategy = name
            if name != "og:image":
                res.ambiguous = True
                res.note(f"fell back to {name}; verify this is the packshot")
            return urljoin(page, url)
    res.note("no image found on page")
    return None


def upscale_hint(url):
    p = urlparse(url)
    if "demandware" in p.netloc or "/dw/image/" in p.path:
        return f"{url.split('?')[0]}?sw={MAX_EDGE}&sh={MAX_EDGE}"
    if "scene7" in p.netloc:
        return f"{url.split('?')[0]}?wid={MAX_EDGE}&hei={MAX_EDGE}"
    if "shopify" in p.netloc or "cdn/shop" in p.path:
        return re.sub(r"_(\d+x\d*|\d*x\d+)(?=\.\w+)", f"_{MAX_EDGE}x", url)
    return url


def to_jpeg(raw, res):
    im = Image.open(io.BytesIO(raw))
    res.src_format = im.format or "?"
    res.src_size = f"{im.width}x{im.height}"
    if max(im.size) < MIN_ACCEPTABLE_EDGE:
        raise ValueError(f"source only {im.width}x{im.height} — thumbnail, rejected")
    if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
        im = im.convert("RGBA")
        bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
        im = Image.alpha_composite(bg, im).convert("RGB")
    else:
        im = im.convert("RGB")
    if max(im.size) > MAX_EDGE:
        im.thumbnail((MAX_EDGE, MAX_EDGE), Image.LANCZOS)
    res.out_size = f"{im.width}x{im.height}"
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=JPEG_QUALITY, optimize=True, progressive=True)
    return buf.getvalue()


def load_sources(path):
    if not path.exists():
        sys.exit(f"sources file not found: {path}")
    return {e["slug"]: e for e in json.loads(path.read_text())}


def process(row, entry, session, args):
    res = Result(slug=row["slug"], model_id=row["id"])
    if entry.get("ambiguous_note"):
        res.ambiguous = True
        res.note(entry["ambiguous_note"])
    url = resolve_image_url(entry, res, session)
    if not url:
        res.status = "failed"
        return res
    url = upscale_hint(url)
    res.image_url = url
    try:
        r = session.get(url, timeout=REQUEST_TIMEOUT)
        r.raise_for_status()
        raw = r.content
    except Exception as e:
        res.status = "failed"
        res.note(f"image fetch failed: {e}")
        return res
    try:
        jpeg = to_jpeg(raw, res)
    except Exception as e:
        res.status = "failed"
        res.note(f"convert failed: {e}")
        return res
    res.out_bytes = len(jpeg)
    obj_path = f"watches/{UPLOADER_ID}/model-{row['id']}.jpg"
    public = f"{PUBLIC_BASE}/storage/v1/object/public/{BUCKET}/{obj_path}?v={int(time.time()*1000)}"
    res.hero_image = public
    if args.dry_run or args.save_local:
        out = SCRIPT_DIR / "preview"
        out.mkdir(exist_ok=True)
        (out / f"{row['slug']}.jpg").write_bytes(jpeg)
    if args.dry_run:
        res.status = "dry-run"
        return res
    try:
        upload_object(obj_path, jpeg)
        patch_model(row["id"], public, entry.get("credit"))
        res.status = "ok"
    except Exception as e:
        res.status = "failed"
        res.note(str(e))
    return res


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sources", default=str(SCRIPT_DIR / "sources.json"))
    ap.add_argument("--only", default="")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--save-local", action="store_true")
    ap.add_argument("--report", default=str(SCRIPT_DIR / "hero_run_report.csv"))
    args = ap.parse_args()
    if not (SUPABASE_URL and SERVICE_KEY):
        sys.exit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
    sources = load_sources(Path(args.sources))
    only = [s.strip() for s in args.only.split(",") if s.strip()]
    rows = fetch_targets(only, args.force, args.limit)
    if not rows:
        print("nothing to do")
        return
    session = requests.Session()
    session.headers.update({"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})
    results = []
    for i, row in enumerate(rows, 1):
        slug = row["slug"]
        entry = sources.get(slug)
        print(f"[{i}/{len(rows)}] {row['brand']} {row['name']} ({slug})", flush=True)
        if not entry or not (entry.get("image_url") or entry.get("page_url")):
            r = Result(slug=slug, model_id=row["id"], status="skipped")
            r.note("no source")
            results.append(r)
            print("    skipped — no source", flush=True)
            continue
        res = process(row, entry, session, args)
        results.append(res)
        flag = "  [AMBIGUOUS]" if res.ambiguous else ""
        print(f"    {res.status}: {res.src_format} {res.src_size} -> {res.out_size} ({res.out_bytes//1024} KB) via {res.strategy}{flag}", flush=True)
        for n in res.notes:
            print(f"      - {n}", flush=True)
        time.sleep(POLITE_DELAY)
    with open(args.report, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["slug", "model_id", "status", "strategy", "src_format", "src_size", "out_size", "out_kb",
                    "ambiguous", "source_page", "image_url", "hero_image", "notes"])
        for r in results:
            w.writerow([r.slug, r.model_id, r.status, r.strategy, r.src_format, r.src_size, r.out_size,
                        r.out_bytes // 1024, "yes" if r.ambiguous else "", r.source_page, r.image_url,
                        r.hero_image, " | ".join(r.notes)])
    ok = sum(1 for r in results if r.status in ("ok", "dry-run"))
    amb = [r.slug for r in results if r.ambiguous]
    bad = [r.slug for r in results if r.status in ("failed", "skipped")]
    print(f"\n{ok}/{len(results)} succeeded. Report: {args.report}")
    if amb:
        print(f"Ambiguous, worth a second look ({len(amb)}): {', '.join(amb)}")
    if bad:
        print(f"Needs attention ({len(bad)}): {', '.join(bad)}")


if __name__ == "__main__":
    main()
