#!/usr/bin/env python3
"""下載景點照片（規格 4.2.1 節）。

data/spots.json 裡有 "photo_source"（Wikimedia Commons 的檔名）但還沒有 "photo" 的景點，
會去讀 Commons 檔案頁的作者與授權，只接受 CC／公有領域／GFDL，下載縮圖轉成寬 800 的 webp，
存到 photos/<id>.webp，並寫回 photo 與 photo_credit（作者 / 授權 / 原始網址）。

Wikimedia 常限速（HTTP 429），所以每張之間會等一下；失敗的下次再跑會自動重試。
用法：python3 scripts/fetch_photos.py [--limit 10]
需要 Pillow（pip install pillow）。
"""
import argparse, html, io, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPOTS = os.path.join(ROOT, "data", "spots.json")
UA = {"User-Agent": "audio-guide/1.0 (personal travel app; Wikimedia Commons photos with attribution)"}


def get(url, tries=5):
    wait = 20
    for t in range(tries):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()
        except urllib.error.HTTPError as e:
            if e.code == 429 and t < tries - 1:
                time.sleep(wait); wait *= 1.6; continue
            raise
        except (urllib.error.URLError, ConnectionError, TimeoutError):
            if t < tries - 1:
                time.sleep(wait); wait *= 1.6; continue
            raise


def text(x):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", x))).strip()


def fetch(fname):
    """回傳 (圖片位元組, 作者, 授權, 檔案頁網址)；授權不明時回傳 None。"""
    page = "https://commons.wikimedia.org/wiki/File:" + urllib.parse.quote(fname.replace(" ", "_"))
    s = get(page).decode("utf-8")
    lic = re.findall(r'class="licensetpl(?:_|&#95;)short"[^>]*>(.*?)</span>', s, re.S)
    lic = text(lic[0]) if lic else ""
    m = re.search(r'id="fileinfotpl(?:_|&#95;)aut"[^>]*>.*?</td>\s*<td[^>]*>(.*?)</td>', s, re.S)
    author = text(m.group(1))[:60] if m else ""
    if not re.search(r"CC|Public domain|PD|GFDL", lic, re.I):
        print(f"  授權不明（{lic or '找不到'}），跳過")
        return None
    orig = re.search(r'href="(https://upload\.wikimedia\.org/wikipedia/commons/[0-9a-f]/[0-9a-f]{2}/[^"]+)"', s)
    if not orig:
        print("  找不到原始檔連結，跳過")
        return None
    o = orig.group(1)
    for size in [1280, 960, 640, 500, None]:  # Commons 只接受固定的縮圖寬度；比原圖寬會回 400
        url = o if size is None else o.replace("/commons/", "/commons/thumb/", 1) + f"/{size}px-" + o.rsplit("/", 1)[1]
        time.sleep(5)
        try:
            return get(url), author, lic, page
        except urllib.error.HTTPError as e:
            if e.code != 400:
                raise
    return None


def save(spots):
    tmp = SPOTS + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(spots, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, SPOTS)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=50)
    a = ap.parse_args()
    spots = json.load(open(SPOTS, encoding="utf-8"))
    todo = [s for s in spots if s.get("photo_source") and not s.get("photo")][: a.limit]
    print(f"要下載 {len(todo)} 張照片")
    done = 0
    for s in todo:
        print(f"[{s['id']}] {s['photo_source']}", flush=True)
        try:
            r = fetch(s["photo_source"])
        except Exception as e:
            print(f"  失敗：{e}（下次再試）")
            time.sleep(15)
            continue
        if not r:
            continue
        data, author, lic, page = r
        im = Image.open(io.BytesIO(data)).convert("RGB")
        w, h = im.size
        if w > 800:
            im = im.resize((800, round(h * 800 / w)), Image.LANCZOS)
        out = f"photos/{s['id']}.webp"
        os.makedirs(os.path.join(ROOT, "photos"), exist_ok=True)
        im.save(os.path.join(ROOT, out), "WEBP", quality=78)
        s["photo"] = out
        s["photo_credit"] = f"{author} / {lic} / {page}"
        save(spots)
        done += 1
        print(f"  完成（{author} / {lic}）")
        time.sleep(10)
    print(f"這次完成 {done} 張")
