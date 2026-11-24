#!/usr/bin/env python3
"""抓日文維基百科條目（一般網頁，不用 API）：存文字、座標、資訊框照片檔名。
用法：python3 -I scripts/research/wikifetch.py 輸出資料夾 標題1 標題2 ..."""
import sys, re, html, json, time, urllib.parse, urllib.request
out = sys.argv[1]
for title in sys.argv[2:]:
    url = "https://ja.wikipedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_"))
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (audio-guide personal project)"})
    try:
        s = urllib.request.urlopen(req, timeout=30).read().decode("utf-8")
    except Exception as e:
        print(title, "ERROR", e); time.sleep(3); continue
    coord = re.search(r'"wgCoordinates":\{"lat":([\d.]+),"lon":([\d.]+)\}', s)
    final = re.search(r'"wgPageName":"([^"]+)"', s)
    imgs = re.findall(r'og:image" content="[^"]*/commons/thumb/[0-9a-f]/[0-9a-f]{2}/([^/"]+)/', s)
    imgs += re.findall(r'commons\\/[0-9a-f]\\/[0-9a-f]{2}\\/([^?"\\]+\.(?:jpg|JPG|jpeg|png))', s)
    imgs = [i for i in imgs if not re.search(r'\.svg|Commons-logo|Wiki|Lock|Question|Edit|Disambig|Flag|Map|map|Locator|logo|Symbol|Emblem|icon', i)]
    files = []
    for i in imgs:
        f = urllib.parse.unquote(i)
        if f not in files:
            files.append(f)
    body = re.search(r'<div id="mw-content-text".*', s, re.S).group(0)
    body = re.sub(r'<(script|style|table)[^>]*>.*?</\1>', '', body, flags=re.S)
    body = re.sub(r'<sup[^>]*class="reference".*?</sup>', '', body, flags=re.S)
    body = re.sub(r'<(h[1-4])[^>]*>(.*?)</\1>', lambda m: '\n## ' + re.sub('<[^>]+>', '', m.group(2)) + '\n', body, flags=re.S)
    body = re.sub(r'<(p|li|br|dd|dt)[^>]*>', '\n', body)
    body = html.unescape(re.sub(r'<[^>]+>', '', body))
    body = re.sub(r'\[編集\]', '', body)
    body = re.sub(r'\n\s*\n+', '\n', body)
    cut = re.search(r'\n## (脚注|注釈|出典|参考文献|関連項目|外部リンク)', body)
    body = body[:cut.start()] if cut else body
    name = re.sub(r'[\\/ ]', '_', title)
    info = {"title": title, "page": final.group(1) if final else title, "url": url,
            "lat": float(coord.group(1)) if coord else None, "lng": float(coord.group(2)) if coord else None,
            "images": files[:6], "chars": len(body)}
    json.dump(info, open(f"{out}/{name}.json", "w"), ensure_ascii=False, indent=1)
    open(f"{out}/{name}.txt", "w").write(body)
    print(title, "|", info["page"], "|", info["lat"], info["lng"], "|", len(body), "字 |", files[:2])
    time.sleep(2)
