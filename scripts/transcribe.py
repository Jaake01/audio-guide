#!/usr/bin/env python3
"""用 Gemini（免費方案）把 mp3 聽寫成文字，用來檢查 TTS 有沒有多念或漏念。
用法：python3 scripts/transcribe.py audio/test-a.mp3
"""
import base64, json, os, sys, time, urllib.error, urllib.request

MODEL = os.environ.get("TRANSCRIBE_MODEL", "gemini-3.5-flash")
path = sys.argv[1]
body = {"contents": [{"parts": [
    {"inlineData": {"mimeType": "audio/mpeg", "data": base64.b64encode(open(path, "rb").read()).decode()}},
    {"text": "請逐字聽寫這段音訊，用繁體中文輸出，不要加任何說明。"}]}]}
def call():
    return urllib.request.Request(
    f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
    data=json.dumps(body).encode(),
    headers={"Content-Type": "application/json", "x-goog-api-key": os.environ["GEMINI_API_KEY"]})
wait = 15
for attempt in range(6):
    try:
        resp = json.load(urllib.request.urlopen(call(), timeout=300))
        break
    except urllib.error.HTTPError as e:
        if e.code not in (429, 500, 503) or attempt == 5:
            raise
        print(f"HTTP {e.code}，{wait} 秒後重試", file=sys.stderr)
        time.sleep(wait); wait *= 2
print("".join(p.get("text", "") for p in resp["candidates"][0]["content"]["parts"]))
