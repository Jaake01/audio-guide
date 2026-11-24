#!/usr/bin/env python3
"""列出某個座標附近、日文維基百科有座標的條目（用一般搜尋頁的 nearcoord，不用 API：API 常被限速）。
用法：python3 -I scripts/research/nearby.py 緯度 經度 半徑公尺
會自動濾掉學校、公司、車站等不適合的條目（規格 4.1 節第 2 點），其餘印出「標題 | 摘要」。"""
import html, re, sys, urllib.parse, urllib.request
lat, lng, r = sys.argv[1:4]
url = ("https://ja.wikipedia.org/w/index.php?title=%E7%89%B9%E5%88%A5:%E6%A4%9C%E7%B4%A2&profile=advanced&fulltext=1&ns0=1&limit=500&search="
       + urllib.parse.quote(f"nearcoord:{r}m,{lat},{lng}"))
s = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (audio-guide personal project)"}), timeout=60).read().decode("utf-8")
items = re.findall(r'<li class="mw-search-result[^"]*"[^>]*>(.*?)</li>', s, re.S)
skip = re.compile(r"学校|大学|高等|中学|小学|株式会社|企業|警察|郵便局|銀行|病院|放送|会社|ホールディングス|組合|インターチェンジ|線$|道路|国道|県道|バス|駅$|停留場|幼稚園|ホテル|マンション|事件")
print("共", len(items), "筆")
for it in items:
    t = html.unescape(re.search(r'title="([^"]+)"', it).group(1))
    sn = re.search(r'<div class="searchresult">(.*?)</div>', it, re.S)
    sn = re.sub(r"\s+", " ", html.unescape(re.sub("<[^>]+>", "", sn.group(1) if sn else "")))
    if not (skip.search(t) or skip.search(sn[:30])):
        print(t, "|", sn[:70])
