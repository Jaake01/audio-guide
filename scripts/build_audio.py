#!/usr/bin/env python3
"""依 data/spots.json 產生每個景點的 mp3（聲音 Zephyr，規格 4.3 節）。

免費方案每天只有 10 次請求，所以一個景點只呼叫一次：整篇稿子（史實／傳說／八卦／動漫典故）
一起送出，拿回一個音檔後，再從音檔裡的停頓找出每段的開始秒數，寫回 spots.json 的
sections[].start（播放器靠它跳段）；總長度寫進 duration。

做好之後會用另一個模型（額度分開算）把語音聽寫回來，確認念的是中文、和稿子一樣，
沒有把導演筆記念出來。不合格就重做（重做也算一次請求）。

用法：
  python3 scripts/build_audio.py              # 只做還沒有 mp3 的景點
  python3 scripts/build_audio.py --id test-a  # 指定景點（會重做）
  python3 scripts/build_audio.py --force      # 全部重做
當天額度用完時會存好進度並結束，隔天再跑同一個指令就會接著做。
"""
import argparse, difflib, json, os, re, subprocess, sys, time

sys.path.insert(0, os.path.dirname(__file__))
import tts  # noqa: E402
import transcribe as tr  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPOTS = os.path.join(ROOT, "data", "spots.json")
RATE = 24000


def to_pcm(audio, mime):
    """把 API 回傳的音訊統一轉成 24kHz 單聲道 s16le PCM。"""
    rate = mime.split("rate=")[1].split(";")[0] if "rate=" in mime else str(RATE)
    fmt = [] if audio[:4] == b"RIFF" else ["-f", "s16le", "-ar", rate, "-ac", "1"]
    r = subprocess.run(["ffmpeg", "-loglevel", "error", *fmt, "-i", "pipe:0",
                        "-f", "s16le", "-ar", str(RATE), "-ac", "1", "pipe:1"],
                       input=audio, capture_output=True, check=True)
    return r.stdout


def pcm_to_mp3(pcm, kbps=64):
    return subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "s16le", "-ar", str(RATE), "-ac", "1",
                           "-i", "pipe:0", "-codec:a", "libmp3lame", "-b:a", f"{kbps}k", "-f", "mp3", "pipe:1"],
                          input=pcm, capture_output=True, check=True).stdout


def speed_up(pcm, tempo):
    """加速但不改變音高（ffmpeg atempo）。"""
    if abs(tempo - 1) < 1e-3:
        return pcm
    return subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "s16le", "-ar", str(RATE), "-ac", "1", "-i", "pipe:0",
                           "-af", f"atempo={tempo}", "-f", "s16le", "-ar", str(RATE), "-ac", "1", "pipe:1"],
                          input=pcm, capture_output=True, check=True).stdout


def silences(pcm, min_len=0.35):
    """回傳 [(開始秒, 結束秒)]：音檔裡的停頓。"""
    r = subprocess.run(["ffmpeg", "-loglevel", "info", "-f", "s16le", "-ar", str(RATE), "-ac", "1", "-i", "pipe:0",
                        "-af", f"silencedetect=n=-35dB:d={min_len}", "-f", "null", "-"],
                       input=pcm, capture_output=True)
    log = r.stderr.decode(errors="replace")
    starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", log)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", log)]
    return list(zip(starts, ends))


def trim_lead(pcm, first_text):
    """模型有時會在稿子前面自己編一段開場（例如假的聊天）。找到第一句真正開始的位置，
    把前面多出來的部分剪掉。回傳 (剪過的 pcm, 剪掉幾秒)。"""
    phrase = re.split(r"[。！？\n]", first_text.strip())[0][:20]
    try:
        t = tr.find_times(pcm_to_mp3(pcm, 48), [phrase])[0]
    except Exception as e:
        print(f"    ⚠ 無法確認開頭（{e}），請自己聽一下開頭", flush=True)
        return pcm, 0.0
    if t is None or t < 0.6:
        return pcm, 0.0
    # 取最接近第一句開頭的停頓；附近沒有停頓（亂講的內容直接接上第一句）就直接在第一句開頭剪
    near = [g for g in silences(pcm, 0.15) if t - 1.2 <= g[1] <= t + 0.3]  # 只在第一句「之前」剪，免得剪掉第一句的開頭
    cut = min(near, key=lambda g: abs(g[1] - t))[1] - 0.1 if near else t - 0.1
    cut = max(0.0, cut)
    return pcm[int(cut * RATE) * 2:], cut


def section_starts(sections, pcm):
    """找每段的開始秒數：先問模型每段第一句從哪裡開始，再對到最近的停頓；
    問不到時，依字數比例估計，再對到附近最長的停頓。"""
    dur = len(pcm) / 2 / RATE
    gaps = silences(pcm)
    firsts = [re.split(r"[。！？\n]", s["text"].strip())[0][:20] for s in sections[1:]]
    try:
        asked = tr.find_times(pcm_to_mp3(pcm, 48), firsts) if firsts else []
    except Exception as e:
        print(f"    ⚠ 問不到段落時間（{e}），改用估計", flush=True)
        asked = [None] * len(firsts)
    lens = [len(s["text"]) for s in sections]
    total, acc, starts = sum(lens), 0, [0.0]
    for i, n in enumerate(lens[:-1]):
        acc += n
        t = asked[i]
        if t is not None and 0 < t < dur:
            near = [g for g in gaps if -3 <= g[1] - t <= 1.5]
            starts.append(round(min(near, key=lambda g: abs(g[1] - t))[1] - 0.15, 2) if near else round(t, 2))
            continue
        guess = dur * acc / total
        window = [g for g in gaps if abs((g[0] + g[1]) / 2 - guess) < max(8, dur * 0.06)]
        g = max(window, key=lambda g: g[1] - g[0]) if window else None
        starts.append(round(g[1] - 0.15, 2) if g else round(guess, 2))
    return starts


def check(pcm, text):
    """聽寫回來檢查：是中文、和稿子相似、沒有念出導演筆記。回傳 (是否合格, 說明)。"""
    try:
        heard = tr.transcribe(pcm_to_mp3(pcm, 48))
    except Exception as e:  # 聽寫服務暫時不能用：不擋住流程，但要提醒
        return True, f"⚠ 無法聽寫檢查（{e}），請自己聽一下"
    low = heard.lower()
    if any(w in low for w in ["director", "transcript", "podcast", "news anchor"]) or "播客" in heard or "主播" in heard:
        return False, "把導演筆記念出來了"
    cjk = lambda x: "".join(re.findall(r"[一-鿿]", x))
    a, b = cjk(text), cjk(heard)
    if len(b) < len(a) * 0.5:
        return False, f"聽起來不是中文（{heard.strip().splitlines()[0][:40] if heard.strip() else ''}）"
    ratio = difflib.SequenceMatcher(None, a, b).ratio()
    if ratio < 0.6:
        return False, f"和稿子差太多（相似度 {ratio:.2f}）"
    return True, f"✓ 中文，相似度 {ratio:.2f}"


def save(spots):
    tmp = SPOTS + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(spots, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, SPOTS)


def build(spot, voice, gap, tries=3):
    text = "\n\n".join(s["text"] for s in spot["sections"])
    n = len(re.sub(r"\s", "", text))
    lo, hi = n * 0.15, n * 0.33 + 10  # 中文大約每字 0.2–0.25 秒
    for t in range(tries):
        if t:
            time.sleep(gap)
        print(f"  第 {t + 1} 次（{n} 字）", flush=True)
        pcm = to_pcm(*tts.synthesize(text, voice))
        # 先剪掉模型自己編的開場，再檢查長度（短稿子加上一分鐘的亂編開場，會被誤判成太長）
        pcm, cut = trim_lead(pcm, spot["sections"][0]["text"])
        if cut:
            print(f"    開頭多了 {cut:.0f} 秒稿子以外的內容，已剪掉", flush=True)
        sec = len(pcm) / 2 / RATE
        if not lo <= sec <= hi:
            print(f"    長度 {sec:.0f} 秒不合理（預期 {lo:.0f}–{hi:.0f} 秒），重做", flush=True)
            continue
        ok, why = check(pcm, text)
        print(f"    {why}", flush=True)
        if not ok:
            continue
        pcm = speed_up(pcm, tts.TEMPO)
        sec = len(pcm) / 2 / RATE
        out = os.path.join(ROOT, spot["audio"])
        os.makedirs(os.path.dirname(out), exist_ok=True)
        open(out, "wb").write(pcm_to_mp3(pcm))
        for s, st in zip(spot["sections"], section_starts(spot["sections"], pcm)):
            s["start"] = st
        spot["duration"] = round(sec, 1)
        print(f"    完成：{sec:.0f} 秒，各段開始 {[s['start'] for s in spot['sections']]}", flush=True)
        return True
    print(f"  重做 {tries} 次仍不合格，先跳過，請檢查稿子", flush=True)
    return False


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--id", action="append", help="只做指定景點，可重複")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--voice", default=tts.VOICE)
    ap.add_argument("--gap", type=float, default=30, help="每次呼叫 API 之間等幾秒（避開每分鐘限制）")
    a = ap.parse_args()
    spots = json.load(open(SPOTS, encoding="utf-8"))
    todo = [s for s in spots if (s["id"] in a.id if a.id else
                                 a.force or not os.path.exists(os.path.join(ROOT, s["audio"])))]
    print(f"要做 {len(todo)} 個景點，聲音 {a.voice}、加速 {tts.TEMPO} 倍（免費方案每天 10 次請求）")
    done = 0
    try:
        for i, s in enumerate(todo, 1):
            print(f"[{i}/{len(todo)}] {s['id']}", flush=True)
            if build(s, a.voice, a.gap):
                save(spots)
                done += 1
            if i < len(todo):
                time.sleep(a.gap)
    except tts.DailyQuotaExceeded as e:
        print(f"今天的免費額度用完了（{e}）。已完成的景點都存好了，明天再跑同一個指令會接著做。")
    print(f"這次完成 {done} 個景點")
