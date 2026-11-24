#!/usr/bin/env python3
"""在 Wikimedia Commons 搜尋分類，印出分類名稱和座標。用法：python3 -I scripts/research/commons_coords.py 關鍵字..."""
import sys, re, time, urllib.parse, urllib.request, html
UA = {"User-Agent": "Mozilla/5.0 (audio-guide personal project)"}
get = lambda u: urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=30).read().decode("utf-8")
for q in sys.argv[1:]:
    s = get("https://commons.wikimedia.org/w/index.php?title=Special:Search&ns14=1&fulltext=1&limit=8&search=" + urllib.parse.quote(q))
    cats = [html.unescape(c) for c in re.findall(r'title="(Category:[^"]+)"', s) if not re.search(r"CommonsRoot|Nature|Society|Science|Images|Sound|Video|Media", c)][:4]
    print("==", q)
    for c in cats:
        time.sleep(2)
        try:
            p = get("https://commons.wikimedia.org/wiki/" + urllib.parse.quote(c.replace(" ", "_")))
        except Exception as e:
            print("  ", c, "|", e); continue
        m = re.search(r'"wgCoordinates":\{"lat":([\d.]+),"lon":([\d.]+)\}', p)
        print("  ", c, "|", (m.group(1), m.group(2)) if m else "無座標")
    time.sleep(2)
