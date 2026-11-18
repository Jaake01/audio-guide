#!/usr/bin/env python3
"""依 data/spots.json 產生每個景點的 mp3（聲音 Zephyr，規格 4.3 節）。

每段（史實／傳說／八卦／動漫典故）分開轉語音，再接成一個 mp3，
並把每段的開始秒數寫回 spots.json 的 sections[].start，播放器靠它跳段；
總長度寫進 duration。

用法：
  python3 scripts/build_audio.py              # 只做還沒有 mp3 的景點
  python3 scripts/build_audio.py --id test-a  # 指定景點（會重做）
  python3 scripts/build_audio.py --force      # 全部重做
免費方案有速率限制：每次呼叫之間會等 --gap 秒，遇到 429 由 tts.py 自動重試。
中途中斷也沒關係，已完成的景點會直接寫回 spots.json，下次接著跑。
"""
import argparse, json, os, subprocess, sys, time

sys.path.insert(0, os.path.dirname(__file__))
import tts  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPOTS = os.path.join(ROOT, "data", "spots.json")
RATE = 24000
GAP_SEC = 0.7  # 段落之間的停頓


def to_pcm(audio, mime):
    """把 API 回傳的音訊統一轉成 24kHz 單聲道 s16le PCM。"""
    rate = mime.split("rate=")[1].split(";")[0] if "rate=" in mime else str(RATE)
    fmt = [] if audio[:4] == b"RIFF" else ["-f", "s16le", "-ar", rate, "-ac", "1"]
    r = subprocess.run(["ffmpeg", "-loglevel", "error", *fmt, "-i", "pipe:0",
                        "-f", "s16le", "-ar", str(RATE), "-ac", "1", "pipe:1"],
                       input=audio, capture_output=True, check=True)
    return r.stdout


def synth_checked(text, voice, gap, tries=4):
    """轉語音並檢查長度。中文大約每字 0.2 秒；長度差太多通常是模型念壞了
    （亂碼、重複、自己多念），就重做。"""
    n = len(text)
    lo, hi = n * 0.1, n * 0.4 + 3
    for t in range(tries):
        pcm = to_pcm(*tts.synthesize(text, voice))
        sec = len(pcm) / 2 / RATE
        if lo <= sec <= hi:
            return pcm
        print(f"    長度 {sec:.1f} 秒不合理（{n} 字，預期 {lo:.0f}–{hi:.0f} 秒），重做", flush=True)
        time.sleep(gap)
    sys.exit(f"重做 {tries} 次仍不合理，請檢查這段文字：{text[:30]}…")


def save(spots):
    tmp = SPOTS + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(spots, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, SPOTS)


def build(spot, voice, gap):
    pcm = b""
    silence = b"\x00\x00" * int(RATE * GAP_SEC)
    for i, sec in enumerate(spot["sections"]):
        if i:
            pcm += silence
            time.sleep(gap)
        sec["start"] = round(len(pcm) / 2 / RATE, 2)
        print(f"  {sec['kind']}（{len(sec['text'])} 字）", flush=True)
        pcm += synth_checked(sec["text"], voice, gap)
    out = os.path.join(ROOT, spot["audio"])
    os.makedirs(os.path.dirname(out), exist_ok=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "s16le", "-ar", str(RATE), "-ac", "1",
                    "-i", "pipe:0", "-codec:a", "libmp3lame", "-b:a", "64k", out], input=pcm, check=True)
    spot["duration"] = round(len(pcm) / 2 / RATE, 1)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--id", action="append", help="只做指定景點，可重複")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--voice", default=tts.VOICE)
    ap.add_argument("--gap", type=float, default=8, help="每次呼叫 API 之間等幾秒")
    a = ap.parse_args()
    spots = json.load(open(SPOTS, encoding="utf-8"))
    todo = [s for s in spots if (s["id"] in a.id if a.id else
                                 a.force or not os.path.exists(os.path.join(ROOT, s["audio"])))]
    print(f"要做 {len(todo)} 個景點，聲音 {a.voice}")
    for n, s in enumerate(todo, 1):
        print(f"[{n}/{len(todo)}] {s['id']}", flush=True)
        build(s, a.voice, a.gap)
        save(spots)
        if n < len(todo):
            time.sleep(a.gap)
    print("完成")
