#!/usr/bin/env python3
"""Backfill `<name>_card.jpg` siblings for existing post photos (logs/) so the
feed card can load a ~95 KB 1000 px image instead of the 1280 px / ~400 KB
original. New uploads get their card image client-side (uploadImage in
index.html); this covers everything uploaded before 2026-09-17.

Mirrors cardPathFor()/CARD_MAX/CARD_QUALITY in index.html — keep in sync.

Safety (see CLAUDE.md "Off-Supabase Backups — ABANDONED"): the only PostgREST
read is ONE short text column (logs.photo_url), paged 200 rows at a time.
Everything else is the Storage HTTP API (HEAD / GET / POST), throttled. Nothing
is deleted. Removing every *_card.jpg object reverts it completely.

Usage:
  python3 scripts/backfill-card-images.py --dry-run     # count what would be done
  python3 scripts/backfill-card-images.py --limit 20    # first 20, then review
  python3 scripts/backfill-card-images.py               # everything
  python3 scripts/backfill-card-images.py --force       # regenerate even if the card exists

Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in ~/.config/wrotate/supabase.env.
"""
import argparse
import io
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from PIL import Image, ImageOps

CARD_FOLDERS = ('logs/',)
CARD_MAX = 1000
CARD_QUALITY = 72           # PIL scale (0-95); 0.72 in the browser
CARD_SUFFIX = '_card'
IMAGE_EXT = ('.jpg', '.jpeg', '.png', '.webp')
MARKER = '/storage/v1/object/public/media/'
PAGE = 200
THROTTLE_S = 0.35           # between storage operations
UA = 'wrotate-backfill-card-images/1'


def load_env():
    path = os.path.expanduser('~/.config/wrotate/supabase.env')
    env = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    url = env.get('SUPABASE_URL')
    key = env.get('SUPABASE_SERVICE_ROLE_KEY')
    if not url or not key:
        sys.exit('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in ~/.config/wrotate/supabase.env')
    return url.rstrip('/'), key


def card_path_for(path):
    if not path or not path.startswith(CARD_FOLDERS):
        return None
    dot = path.rfind('.')
    slash = path.rfind('/')
    if dot < 0 or dot < slash:
        return None
    if path[dot:].lower() not in IMAGE_EXT:
        return None
    stem = path[:dot]
    if stem.endswith(CARD_SUFFIX) or stem.endswith('_thumb') or stem.endswith('_poster'):
        return None
    return stem + CARD_SUFFIX + '.jpg'


def storage_path_from(url):
    if not url:
        return None
    idx = url.find(MARKER)
    if idx < 0:
        return None
    path = url[idx + len(MARKER):]
    q = path.find('?')
    return path[:q] if q >= 0 else path


def parse_photo_url(v):
    """Mirror of parsePhotoUrl(): a JSON array for multi-photo posts, else one URL."""
    if not v:
        return []
    if v.startswith('['):
        try:
            arr = json.loads(v)
            return [u for u in arr if isinstance(u, str)]
        except ValueError:
            return [v]
    return [v]


def req(method, url, headers, data=None, timeout=30):
    r = urllib.request.Request(url, data=data, method=method, headers=headers)
    return urllib.request.urlopen(r, timeout=timeout)


def fetch_paths(base, key):
    """Distinct post-photo storage paths from logs.photo_url. One column, paged."""
    h = {'apikey': key, 'Authorization': f'Bearer {key}', 'Accept': 'application/json', 'User-Agent': UA}
    flt = 'photo_url=like.*%2Fstorage%2Fv1%2Fobject%2Fpublic%2Fmedia%2Flogs%2F*'
    seen, out = set(), []
    offset = 0
    while True:
        u = f'{base}/rest/v1/logs?select=photo_url&{flt}&order=id&limit={PAGE}&offset={offset}'
        with req('GET', u, h) as r:
            rows = json.loads(r.read().decode())
        for row in rows:
            for url in parse_photo_url(row.get('photo_url')):
                p = storage_path_from(url)
                if p and card_path_for(p) and p not in seen:
                    seen.add(p)
                    out.append(p)
        if len(rows) < PAGE:
            break
        offset += PAGE
        time.sleep(0.2)
    return out


def object_exists(base, key, path):
    u = f'{base}/storage/v1/object/media/{urllib.parse.quote(path)}'
    try:
        with req('HEAD', u, {'Authorization': f'Bearer {key}', 'User-Agent': UA}, timeout=15):
            return True
    except urllib.error.HTTPError as e:
        if e.code in (400, 404):
            return False
        raise


def download(base, path):
    u = f'{base}{MARKER}{urllib.parse.quote(path)}'
    with req('GET', u, {'User-Agent': UA}, timeout=60) as r:
        return r.read()


def make_card(data):
    im = Image.open(io.BytesIO(data))
    im = ImageOps.exif_transpose(im)
    if im.mode not in ('RGB', 'L'):
        im = im.convert('RGB')
    im.thumbnail((CARD_MAX, CARD_MAX), Image.LANCZOS)   # keeps aspect, longest side ≤ 1000
    buf = io.BytesIO()
    im.save(buf, 'JPEG', quality=CARD_QUALITY, optimize=True, progressive=True)
    return buf.getvalue()


def upload(base, key, path, data):
    u = f'{base}/storage/v1/object/media/{urllib.parse.quote(path)}'
    h = {'Authorization': f'Bearer {key}', 'apikey': key, 'Content-Type': 'image/jpeg',
         'Cache-Control': 'max-age=31536000', 'x-upsert': 'true', 'User-Agent': UA}
    with req('POST', u, h, data=data, timeout=60) as r:
        return r.status


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--force', action='store_true', help='regenerate even if the card image already exists')
    args = ap.parse_args()

    base, key = load_env()
    paths = fetch_paths(base, key)
    print(f'{len(paths)} distinct post photos in logs/')
    if args.limit:
        paths = paths[:args.limit]

    done = skipped = missing = failed = 0
    bytes_in = bytes_out = 0
    t0 = time.time()
    for i, p in enumerate(paths, 1):
        cp = card_path_for(p)
        try:
            if not args.force and object_exists(base, key, cp):
                skipped += 1
                continue
            if args.dry_run:
                done += 1
                if done <= 5:
                    print(f'  would create {cp}')
                continue
            try:
                data = download(base, p)
            except urllib.error.HTTPError as e:
                if e.code in (400, 404):
                    missing += 1
                    print(f'  ! original missing: {p}')
                    continue
                raise
            card = make_card(data)
            upload(base, key, cp, card)
            done += 1
            bytes_in += len(data)
            bytes_out += len(card)
            if done % 25 == 0:
                print(f'  {i}/{len(paths)}: {done} created, {skipped} skipped, '
                      f'{bytes_in/1e6:.1f} MB → {bytes_out/1e6:.2f} MB, {time.time()-t0:.0f}s')
        except Exception as e:  # keep going; report at the end
            failed += 1
            print(f'  ! {p}: {type(e).__name__}: {e}')
        finally:
            time.sleep(THROTTLE_S)

    verb = 'would create' if args.dry_run else 'created'
    print(f'{verb} {done}, skipped (exists) {skipped}, missing originals {missing}, failed {failed}'
          + (f', {bytes_in/1e6:.1f} MB → {bytes_out/1e6:.2f} MB' if bytes_in else '')
          + f', {time.time()-t0:.0f}s')


if __name__ == '__main__':
    main()
