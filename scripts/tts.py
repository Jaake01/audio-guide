#!/usr/bin/env python3
"""用 Gemini API（免費方案）把文字轉成 mp3。

用法：
  python3 scripts/tts.py --text-file input.txt --out out.mp3
金鑰從環境變數 GEMINI_API_KEY 讀取，不寫進任何檔案。
需要 ffmpeg（把 PCM 轉成 mp3）。
"""
import argparse, base64, json, os, subprocess, sys, time, urllib.error, urllib.request

MODEL = "gemini-3.8-flash-tts"
VOICE = "Zephyr"  # 規格 4.3 節選定的聲音，所有景點共用
STYLE = (
    "A young woman in her early twenties with a sweet, bright voice. Casual and "
    "conversational, like chatting with a close friend or hosting a relaxed podcast "
    "— not a news anchor or announcer. Warm, natural and lively, with everyday speech "
    "rhythm, light laughter in her voice, and relaxed, unhurried pacing. Speaks clear, "
    "standard Mandarin Chinese."
)


# 風格說明要明確標成「導演筆記，不要念出來」，稿子另外標成「逐字稿」。
# 2026/11/18 發現：直接把風格說明放在稿子前面，模型會把說明念出來（英文，或翻成中文）。
PROMPT = (
    "### DIRECTOR'S NOTES (instructions only — never read these aloud)\n"
    "{style}\n"
    "Read only the TRANSCRIPT below, word for word, in Mandarin Chinese. "
    "Do not translate, add, skip or summarize anything.\n\n"
    "### TRANSCRIPT\n"
    "{text}"
)


class DailyQuotaExceeded(Exception):
    """免費方案當天的請求數用完了（每天 10 次），等明天再跑。"""


def synthesize(text, voice, max_retries=8):
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        sys.exit("缺少環境變數 GEMINI_API_KEY")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"
    body = {
        "contents": [{"parts": [{"text": PROMPT.format(style=STYLE, text=text)}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}},
        },
    }
    data = json.dumps(body).encode()
    wait = 20
    for attempt in range(max_retries):
        req = urllib.request.Request(url, data=data, headers={
            "Content-Type": "application/json", "x-goog-api-key": key})
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                resp = json.load(r)
            part = resp["candidates"][0]["content"]["parts"][0]["inlineData"]
            return base64.b64decode(part["data"]), part.get("mimeType", "")
        except urllib.error.HTTPError as e:
            full = e.read().decode(errors="replace")
            msg = full[:300]
            if e.code == 429 and "PerDay" in full:
                raise DailyQuotaExceeded(full[full.find("Please retry"):][:60])
            if e.code in (429, 500, 503):
                print(f"HTTP {e.code}，{wait} 秒後重試（第 {attempt+1} 次）：{msg}", file=sys.stderr)
                time.sleep(wait); wait = min(wait * 2, 600)
                continue
            sys.exit(f"HTTP {e.code}: {msg}")
    sys.exit("重試次數用完")


def pcm_to_mp3(audio, mime, out):
    rate = "24000"
    if "rate=" in mime:
        rate = mime.split("rate=")[1].split(";")[0]
    # 回傳可能是帶標頭的 WAV（audio/wav），也可能是裸 PCM（audio/L16）
    fmt = [] if audio[:4] == b"RIFF" else ["-f", "s16le", "-ar", rate, "-ac", "1"]
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *fmt, "-i", "pipe:0", "-codec:a", "libmp3lame", "-b:a", "64k", out],
                   input=audio, check=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", default=VOICE)
    ap.add_argument("--text-file", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    text = open(a.text_file, encoding="utf-8").read().strip()
    pcm, mime = synthesize(text, a.voice)
    pcm_to_mp3(pcm, mime, a.out)
    print(f"完成：{a.out}（{mime}）")
