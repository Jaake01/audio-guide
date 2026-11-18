#!/usr/bin/env python3
"""用 Gemini（免費方案）把音訊聽寫成文字（原本的語言，不翻譯），用來檢查 TTS 有沒有念錯語言、多念或漏念。
用法：python3 scripts/transcribe.py audio/test-a.mp3
"""
import base64, json, os, sys, time, urllib.error, urllib.request

MODEL = os.environ.get("TRANSCRIBE_MODEL", "gemini-3.5-flash")
ASK = ("First line: name the language actually spoken in this audio (e.g. Mandarin Chinese, English). "
       "Then transcribe it verbatim in that same original language (if Chinese, use Traditional Chinese characters). Do NOT translate.")


def transcribe(data, mime="audio/mpeg", tries=6):
    body = {"contents": [{"parts": [
        {"inlineData": {"mimeType": mime, "data": base64.b64encode(data).decode()}},
        {"text": ASK}]}]}
    wait = 15
    for attempt in range(tries):
        req = urllib.request.Request(
            f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json", "x-goog-api-key": os.environ["GEMINI_API_KEY"]})
        try:
            resp = json.load(urllib.request.urlopen(req, timeout=300))
            return "".join(p.get("text", "") for p in resp["candidates"][0]["content"]["parts"])
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 503) or attempt == tries - 1:
                raise
            print(f"    聽寫 HTTP {e.code}，{wait} 秒後重試", file=sys.stderr)
            time.sleep(wait); wait = min(wait * 2, 300)


if __name__ == "__main__":
    print(transcribe(open(sys.argv[1], "rb").read()))
