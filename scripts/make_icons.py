#!/usr/bin/env python3
"""產生 App 圖示（紅底白色鳥居）。用法：python3 scripts/make_icons.py"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RED, WHITE = (184, 64, 42), (255, 255, 255)


def torii(size, pad):
    """pad：圖案周圍留白比例（maskable 圖示要留比較多）。"""
    s = 4 * size  # 先畫大再縮小，邊緣比較平滑
    im = Image.new("RGB", (s, s), RED)
    d = ImageDraw.Draw(im)
    u = s * (1 - 2 * pad) / 100  # 100 單位的畫布
    ox = oy = s * pad
    R = lambda x0, y0, x1, y1: d.rectangle([ox + x0 * u, oy + y0 * u, ox + x1 * u, oy + y1 * u], fill=WHITE)
    d.polygon([(ox + 4 * u, oy + 14 * u), (ox + 96 * u, oy + 14 * u), (ox + 90 * u, oy + 24 * u), (ox + 10 * u, oy + 24 * u)], fill=WHITE)  # 笠木
    R(16, 36, 84, 44)   # 貫
    R(46, 24, 54, 36)   # 額束
    R(24, 24, 33, 92)   # 左柱
    R(67, 24, 76, 92)   # 右柱
    return im.resize((size, size), Image.LANCZOS)


os.makedirs(os.path.join(ROOT, "icons"), exist_ok=True)
torii(192, 0.16).save(os.path.join(ROOT, "icons/icon-192.png"))
torii(512, 0.16).save(os.path.join(ROOT, "icons/icon-512.png"))
torii(512, 0.24).save(os.path.join(ROOT, "icons/icon-maskable-512.png"))
