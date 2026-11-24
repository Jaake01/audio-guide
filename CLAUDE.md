# 日本語音導覽 App：給 Claude 的工作說明

完整規格在 `導覽App規格.md`，開工前先讀。使用者的行程文件（Claude Docs）：
https://claude.ai/artifact/DMc9RhM1Q8Bh3DDxvGofqw （「2027 東京輕井澤行程」，每天的路線、時間都在裡面）

## 跟使用者溝通

- **一律用繁體中文回覆**，使用者打簡體或英文也一樣。
- 使用者的 Claude 用量有上限：每個地區開一個新對話，不要在對話裡排定時任務（send_later、排程），不要一直來回確認小事。
- 語音和照片由 GitHub Actions 每天自動產生（見下方），**對話裡不用等語音做完**。

## 檔案

| 檔案 | 內容 |
|---|---|
| `data/spots.json` | 所有景點（故事、來源、座標、語音、照片）。格式見規格 4.2、4.2.1 節 |
| `data/areas.json` | 國家 → 地區（都道府縣）→ 街區，以及每天去哪些街區 |
| `scripts/tts.py` | Gemini TTS（聲音 Zephyr、導演筆記格式、加速 1.15 倍） |
| `scripts/build_audio.py` | 幫還沒有 mp3 的景點產生語音、剪掉模型自己編的開場、檢查是中文、算出每段開始秒數 |
| `scripts/transcribe.py` | 用 Gemini 聽寫音檔（原本的語言，不翻譯），檢查用 |
| `scripts/fetch_photos.py` | 依 `photo_source`（Commons 檔名）下載照片、記下作者與授權 |
| `scripts/research/nearby.py` | 列出某座標附近的維基百科條目（找候選景點） |
| `scripts/research/wikifetch.py` | 抓日文維基百科條目的文字、座標、照片檔名 |
| `scripts/research/commons_coords.py` | 維基百科沒座標時，從 Commons 分類找座標 |
| `.github/workflows/daily-media.yml` | 每天 UTC 08:37 自動產生語音、下載照片並 commit（只在 main 執行） |

## 做一個地區的流程

1. **列候選景點**：讀行程文件那天的路線，再用 `python3 -I scripts/research/nearby.py 緯度 經度 半徑` 找附近條目。整理成清單讓使用者選（使用者通常會說「路線上的全做，順路步行 5 分鐘內的也要」）。
2. **查資料**：`python3 -I scripts/research/wikifetch.py <暫存資料夾> 條目1 條目2 ...`，再用 WebSearch 找有趣的故事（來源不限，網友分享也可以，但要附網址）。
3. **寫稿**：每個景點分 `history`（史實）／`legend`（傳說）／`gossip`（八卦）／`anime`（動漫典故，查不到就不放）。
4. **自我檢查**：每一句都要對得上來源；查不到的刪掉；傳說、網友說法要講「據說」「網路上有人說」。
5. **加進 `data/spots.json`**，有照片的話填 `photo_source`（Commons 檔名，例如 wikifetch 抓到的 `images[0]`），`photo` 留 `null`、`verified` 設 `false`。新地區記得在 `data/areas.json` 補 `center`。
6. commit、push、開 PR。**使用者合併到 main 之後，GitHub Actions 會每天自動做語音和照片。**

## 寫稿規則（使用者確認過的）

- 口吻像朋友聊天、輕鬆的 Podcast；可以有小吐槽，但事實不能誇大。
- 目標每個景點 1,300–1,500 字（加速後約 4 分鐘）；資料不夠就寫短一點，**不要用沒有根據的內容硬湊**。
- 年份用中文數字寫（「一八九三年」），TTS 念得比較穩。
- 日文專有名詞盡量用中文讀法（例：鶴岡八幡宮），平假名、片假名少用，必要時加英文（例：Hato Sablé）。
- 每段 `sources` 放實際用到的網址，優先順序：官網 > 政府／文化財資料 > 維基百科 > 其他。
- 座標以維基百科、Commons 為準，不要估計。

## 已知的坑

- **Gemini TTS 免費方案每天只有 10 次請求**（每個模型分開算），UTC 08:00 左右重置。一個景點一次請求。
- 模型常在稿子前面**自己編 20–150 秒的開場**，`build_audio.py` 會自動剪掉；把風格說明放在稿子前面會被念出來，所以用「導演筆記／逐字稿」格式。
- 維基百科、Commons 的 **API 常被限速**，改抓一般網頁（腳本已經這樣做）。`upload.wikimedia.org` 也常回 429。
- 這個雲端環境連不到 en.wikipedia.org、很多官網；web-fetch 工具也一樣。查不到就用日文維基百科＋WebSearch 的結果。
- 在雲端環境用 `python3 -m http.server` 測 App 時 mp3 不能跳轉（不支援 Range），要用支援 Range 的伺服器。

## 目前進度（2026/11/24）

- 已完成：鶴岡八幡宮、川越 24 個、鎌倉・江之島 17 個（部分語音還在產生）。
- 照片：大多還沒下載（Commons 限速），已填好 `photo_source` 等 GitHub Actions 下載。
- 還沒做：1/20 池袋（候選清單已給使用者，還沒選）、1/23 之後的地區。
