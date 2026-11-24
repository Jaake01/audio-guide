#!/usr/bin/env python3
"""用 Gemini（免費方案）把音訊聽寫成文字（原本的語言，不翻譯），用來檢查 TTS 有沒有念錯語言、多念或漏念。
用法：python3 scripts/transcribe.py audio/test-a.mp3
"""
import base64, json, os, re, sys, time, urllib.error, urllib.request

MODEL = os.environ.get("TRANSCRIBE_MODEL", "gemini-3.1-flash-lite")
# 免費方案的模型常回 503（忙碌）；每個模型額度分開算，所以忙的時候換下一個模型試
MODELS = [MODEL] + [m for m in ["gemini-3.5-flash-lite", "gemini-2.5-flash"] if m != MODEL]
ASK = ("First line: name the language actually spoken in this audio (e.g. Mandarin Chinese, English). "
       "Then transcribe it verbatim in that same original language (if Chinese, use Traditional Chinese characters). Do NOT translate.")


def transcribe(data, mime="audio/mpeg", tries=6, ask=ASK):
    """依序換模型重試；tries 是總共嘗試幾次。"""
    body = {"contents": [{"parts": [
        {"inlineData": {"mimeType": mime, "data": base64.b64encode(data).decode()}},
        {"text": ask}]}]}
    wait = 15
    for attempt in range(tries):
        model = MODELS[attempt % len(MODELS)]
        req = urllib.request.Request(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json", "x-goog-api-key": os.environ["GEMINI_API_KEY"]})
        try:
            resp = json.load(urllib.request.urlopen(req, timeout=180))
            return "".join(p.get("text", "") for p in resp["candidates"][0]["content"]["parts"])
        except (urllib.error.HTTPError, TimeoutError, urllib.error.URLError) as e:
            code = getattr(e, "code", None)
            if (code is not None and code not in (429, 500, 503)) or attempt == tries - 1:
                raise
            print(f"    聽寫（{model}）失敗：{code or e}，{wait} 秒後換模型重試", file=sys.stderr)
            time.sleep(wait); wait = min(wait * 2, 120)


def find_times(data, phrases, mime="audio/mpeg"):
    """問模型每句話在音訊裡從第幾秒開始。回傳秒數清單（找不到的是 None）。"""
    lines = "\n".join(f"{i + 1}. {p}" for i, p in enumerate(phrases))
    ask = ("For each numbered phrase below, give the time in the audio where that phrase starts being spoken. "
           "Answer one line per phrase, exactly in the form `N. MM:SS`, nothing else.\n\n" + lines)
    out = transcribe(data, mime, tries=4, ask=ask)
    times = [None] * len(phrases)
    for m in re.finditer(r"(\d+)\.\s*(\d+):(\d{2}(?:\.\d+)?)", out):
        i = int(m.group(1)) - 1
        if 0 <= i < len(phrases):
            times[i] = int(m.group(2)) * 60 + float(m.group(3))
    return times


if __name__ == "__main__":
    print(transcribe(open(sys.argv[1], "rb").read()))
