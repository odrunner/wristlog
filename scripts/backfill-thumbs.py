#!/usr/bin/env python3
"""Backfill `<name>_thumb.jpg` siblings for existing media (watches/, avatars/,
wishlist/, clubs/) so the feed/profile chips can load ~15 KB thumbnails instead
of the 1280 px originals. New uploads get their thumb client-side (uploadImage in
index.html); this covers everything uploaded before 2026-08-15.

Mirrors thumbPathFor()/THUMB_MAX/THUMB_QUALITY in index.html — keep in sync.

Safety (see CLAUDE.md "Off-Supabase Backups — ABANDONED"): the only PostgREST
reads are ONE short text column per table, paged 200 rows at a time. Everything
else is the Storage HTTP API (HEAD / GET / POST), throttled. Nothing is deleted.

Usage:
  python3 scripts/backfill-thumbs.py --dry-run          # count what would be done
  python3 scripts/backfill-thumbs.py --limit 20         # first 20, then review
  python3 scripts/backfill-thumbs.py                    # everything
  python3 scripts/backfill-thumbs.py --force            # regenerate even if the thumb exists

Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in ~/.config/wrotate/supabase.env.
"""
import argparse
import io
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from PIL import Image, ImageOps

THUMB_FOLDERS = ('watches/', 'avatars/', 'wishlist/', 'clubs/')
THUMB_MAX = 240
THUMB_QUALITY = 82          # PIL scale (0-95); 0.82 in the browser
THUMB_SUFFIX = '_thumb'
MARKER = '/storage/v1/object/public/media/'
SOURCES = [                 # (table, url column, filter)
    ('watches',  'image',      'image=like.*%2Fstorage%2Fv1%2Fobject%2Fpublic%2Fmedia%2F*'),
    ('profiles', 'avatar_url', 'avatar_url=like.*%2Fstorage%2Fv1%2Fobject%2Fpublic%2Fmedia%2F*'),
    ('wishlist', 'image',      'image=like.*%2Fstorage%2Fv1%2Fobject%2Fpublic%2Fmedia%2F*'),
    ('clubs',    'image_url',  'image_url=like.*%2Fstorage%2Fv1%2Fobject%2Fpublic%2Fmedia%2F*'),
]
PAGE = 200
THROTTLE_S = 0.35           # between storage operations


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


def thumb_path_for(path):
    if not path or not path.startswith(THUMB_FOLDERS):
        return None
    dot = path.rfind('.')
    slash = path.rfind('/')
    if dot < 0 or dot < slash:
        return None
    stem = path[:dot]
    if stem.endswith(THUMB_SUFFIX):
        return None
    return stem + THUMB_SUFFIX + path[dot:]


def storage_path_from(url):
    if not url:
        return None
    idx = url.find(MARKER)
    if idx < 0:
        return None
    path = url[idx + len(MARKER):]
    q = path.find('?')
    return path[:q] if q >= 0 else path


def req(method, url, headers, data=None, timeout=30):
    r = urllib.request.Request(url, data=data, method=method, headers=headers)
    return urllib.request.urlopen(r, timeout=timeout)


def fetch_paths(base, key):
    """Distinct storage paths from the four URL columns. One column, paged."""
    h = {'apikey': key, 'Authorization': f'Bearer {key}', 'Accept': 'application/json',
         'User-Agent': 'wrotate-backfill-thumbs/1'}
    import json
    seen, out = set(), []
    for table, col, flt in SOURCES:
        offset = 0
        while True:
            u = f'{base}/rest/v1/{table}?select={col}&{flt}&limit={PAGE}&offset={offset}'
            with req('GET', u, h) as r:
                rows = json.loads(r.read().decode())
            for row in rows:
                p = storage_path_from(row.get(col))
                if p and thumb_path_for(p) and p not in seen:
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
        with req('HEAD', u, {'Authorization': f'Bearer {key}', 'User-Agent': 'wrotate-backfill-thumbs/1'}, timeout=15):
            return True
    except urllib.error.HTTPError as e:
        if e.code in (400, 404):
            return False
        raise


def download(base, path):
    u = f'{base}{MARKER}{urllib.parse.quote(path)}'
    with req('GET', u, {'User-Agent': 'wrotate-backfill-thumbs/1'}, timeout=60) as r:
        return r.read()


def make_thumb(data):
    im = Image.open(io.BytesIO(data))
    im = ImageOps.exif_transpose(im)
    if im.mode not in ('RGB', 'L'):
        im = im.convert('RGB')
    im.thumbnail((THUMB_MAX, THUMB_MAX), Image.LANCZOS)   # keeps aspect, longest side ≤ 240
    buf = io.BytesIO()
    im.save(buf, 'JPEG', quality=THUMB_QUALITY, optimize=True, progressive=False)
    return buf.getvalue()


def upload(base, key, path, data):
    u = f'{base}/storage/v1/object/media/{urllib.parse.quote(path)}'
    h = {'Authorization': f'Bearer {key}', 'apikey': key, 'Content-Type': 'image/jpeg',
         'Cache-Control': 'max-age=31536000', 'x-upsert': 'true',
         'User-Agent': 'wrotate-backfill-thumbs/1'}
    with req('POST', u, h, data=data, timeout=60) as r:
        return r.status


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--force', action='store_true', help='regenerate even if the thumb already exists')
    args = ap.parse_args()

    base, key = load_env()
    paths = fetch_paths(base, key)
    print(f'{len(paths)} distinct originals across watches/avatars/wishlist/clubs')
    if args.limit:
        paths = paths[:args.limit]

    done = skipped = missing = failed = 0
    bytes_in = bytes_out = 0
    t0 = time.time()
    for i, p in enumerate(paths, 1):
        tp = thumb_path_for(p)
        try:
            if not args.force and object_exists(base, key, tp):
                skipped += 1
                continue
            if args.dry_run:
                done += 1
                print(f'  would create {tp}')
                continue
            try:
                data = download(base, p)
            except urllib.error.HTTPError as e:
                if e.code in (400, 404):
                    missing += 1
                    print(f'  ! original missing: {p}')
                    continue
                raise
            thumb = make_thumb(data)
            upload(base, key, tp, thumb)
            done += 1
            bytes_in += len(data)
            bytes_out += len(thumb)
            if done % 25 == 0:
                print(f'  {i}/{len(paths)}: {done} created, {skipped} skipped, '
                      f'{bytes_in/1e6:.1f} MB → {bytes_out/1e6:.2f} MB, {time.time()-t0:.0f}s')
        except Exception as e:  # keep going; report at the end
            failed += 1
            print(f'  ! {p}: {type(e).__name__}: {e}')
        finally:
            time.sleep(THROTTLE_S)

    verb = 'would create' if args.dry_run else 'created'
    print(f'\n{verb} {done}, skipped (thumb exists) {skipped}, original missing {missing}, failed {failed}')
    if bytes_in:
        print(f'originals {bytes_in/1e6:.1f} MB → thumbs {bytes_out/1e6:.2f} MB '
              f'(avg {bytes_out/max(done,1)/1e3:.1f} KB each, {100*bytes_out/bytes_in:.1f}%)')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
