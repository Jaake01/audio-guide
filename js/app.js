// 日本語音導覽 App（規格 v1）
// 沒有框架、沒有建置步驟，GitHub Pages 直接提供這些檔案。畫面樣式依規格 3.7 節設計稿。
(() => {
  "use strict";

  const CFG = window.APP_CONFIG || {};
  const NEAR = CFG.NEARBY_RADIUS_M || 200;
  const FAR = CFG.EXPANDED_RADIUS_M || 500;

  // ---------- 圖示（線條 SVG） ----------
  const svg = (inner, size = 20, extra = "") =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${inner}</svg>`;
  const ICON = {
    play: (s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>`,
    pause: (s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1"/><rect x="13.5" y="5" width="4" height="14" rx="1"/></svg>`,
    back: svg('<path d="M15 5l-7 7 7 7"/>', 20, 'stroke-width="2"'),
    chev: svg('<path d="M9 5l7 7-7 7"/>', 20, 'stroke-width="2"'),
    locate: svg('<circle cx="12" cy="12" r="3.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="8"/>'),
    pin: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#B8402A" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>`,
    map: svg('<path d="M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5z"/>', 18),
  };
  // 類型圖示：沒有照片時的佔位圖（純色底加圖示，規格 4.2.1 節）
  const TYPES = {
    shrine: { label: "神社", icon: '<path d="M3 6h18M5 6l1-2h12l1 2M6 10h12M8 6v14M16 6v14M12 6v4"/>' },
    temple: { label: "寺院", icon: '<path d="M3 10l9-6 9 6M5 10h14M6 10v10M18 10v10M4 20h16M10 20v-5h4v5"/>' },
    statue: { label: "雕像", icon: '<circle cx="12" cy="6" r="2.5"/><path d="M8 20v-6l2-4h4l2 4v6M6 20h12"/>' },
    building: { label: "建築", icon: '<path d="M4 20V9l8-5 8 5v11M4 20h16M9 20v-6h6v6M9 10h.01M15 10h.01"/>' },
    street: { label: "街道", icon: '<path d="M8 3L5 21M16 3l3 18M12 5v2M12 11v2M12 17v2"/>' },
    other: { label: "其他", icon: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 16l5-5 4 4 3-3 6 6"/><circle cx="16" cy="9" r="1.5"/>' },
  };
  const KINDS = { history: "史實", legend: "傳說", gossip: "八卦", anime: "動漫典故" };
  const TINTS = ["#C9D6CF", "#D8CBBF", "#C7D0DC", "#DCC9C4", "#D3D0BE"];
  const WEEK = "日一二三四五六";

  const $ = (sel, el = document) => el.querySelector(sel);
  const view = $("#view");
  const audio = $("#audio");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // 測試用網址參數：?lat=25.045&lng=121.517 假裝目前位置；?date=2027-01-22 假裝今天日期
  const params = new URLSearchParams(location.search);
  const testPos = params.has("lat") && params.has("lng")
    ? { lat: +params.get("lat"), lng: +params.get("lng"), test: true } : null;

  const state = {
    spots: [], areas: [], regions: [], countries: [], trip: null,
    pos: null, posError: null,
    current: null,        // 目前載入播放器的景點
    navigated: false,     // App 內換過頁（播放器返回鍵用）
  };

  // ---------- 工具 ----------
  function store(key, val) {
    try {
      if (val === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, val);
    } catch { return null; }
  }
  function distance(a, b) {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const fmtDist = (m) => m < 1000 ? `${Math.round(m / 10) * 10 || 10} 公尺` : `${(m / 1000).toFixed(1)} 公里`;
  const fmtTime = (s) => {
    s = Math.max(0, Math.floor(s || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  const typeOf = (sp) => TYPES[sp.type] || TYPES.other;
  const gmapsUrl = (sp) => `https://www.google.com/maps/search/?api=1&query=${sp.lat},${sp.lng}`;
  const areaOf = (sp) => state.areas.find((a) => a.id === sp.area);
  const tagsOf = (sp) => sp.sections.map((s) => KINDS[s.kind] || s.kind).join(" · ");
  const spotIndex = (sp) => state.spots.indexOf(sp);

  function localDate(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function tripDays() {
    const out = [];
    const d = new Date(state.trip.start + "T00:00:00");
    const end = new Date(state.trip.end + "T00:00:00");
    for (; d <= end; d.setDate(d.getDate() + 1)) out.push(localDate(d));
    return out;
  }
  // 「今天」：行程期間內就是今天，否則用行程第一天
  function today() {
    const t = params.get("date") || localDate();
    const days = tripDays();
    return { date: days.includes(t) ? t : days[0], inTrip: days.includes(t) };
  }
  const dayLabel = (iso) => {
    const d = new Date(iso + "T00:00:00");
    return { md: `${d.getMonth() + 1}/${d.getDate()}`, wd: WEEK[d.getDay()] };
  };
  const dayAreas = (date) => state.areas.filter((a) => a.days.includes(date));
  const dayTitle = (date) => dayAreas(date).map((a) => a.name).join("・");

  // ---------- 照片 ----------
  function photoHtml(sp, cls = "") {
    if (sp.photo) return `<img class="photo ${cls}" src="${esc(sp.photo)}" alt="${esc(sp.name)}" loading="lazy">`;
    const tint = TINTS[Math.max(0, spotIndex(sp)) % TINTS.length];
    return `<span class="photo ${cls}" role="img" aria-label="${esc(typeOf(sp).label)}" style="background:${tint}">${svg(typeOf(sp).icon, 24, 'stroke-width="1.6"')}</span>`;
  }
  const verifiedBadge = (sp) => sp.verified
    ? `<span class="badge-ok">已核對</span>` : `<span class="badge-no">未核對</span>`;

  // ---------- 定位（只在 App 開著時取一次，或按「重新定位」） ----------
  function locate() {
    if (testPos) { state.pos = testPos; return Promise.resolve(); }
    if (!("geolocation" in navigator)) {
      state.posError = "這個瀏覽器不支援定位";
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (p) => {
          state.pos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy };
          state.posError = null; resolve();
        },
        (e) => {
          state.posError = e.code === 1 ? "沒有定位權限" : "暫時拿不到定位";
          resolve();
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
      );
    });
  }

  // ---------- 卡片 ----------
  function spotCard(sp, dist) {
    const meta = [typeOf(sp).label, dist != null ? fmtDist(dist) : null, sp.duration ? fmtTime(sp.duration) : null]
      .filter(Boolean).join(" · ");
    return `<li><div class="card">
      ${photoHtml(sp)}
      <div class="card-body">
        <div class="card-name"><span>${esc(sp.name)}</span>${verifiedBadge(sp)}</div>
        <div class="meta">${esc(meta)}</div>
        <div class="tags">${esc(tagsOf(sp))}</div>
      </div>
      <button class="play" data-play="${esc(sp.id)}" aria-label="播放 ${esc(sp.name)}">${ICON.play()}</button>
    </div></li>`;
  }
  function compactCard(sp, sub) {
    return `<li><div class="card compact">
      ${photoHtml(sp, "s56")}
      <div class="card-body">
        <div class="card-name"><span>${esc(sp.name)}</span>${verifiedBadge(sp)}</div>
        <div class="meta">${esc(sub)}</div>
      </div>
      <button class="play" data-play="${esc(sp.id)}" aria-label="播放 ${esc(sp.name)}">${ICON.play(18)}</button>
    </div></li>`;
  }
  // 點播放 → 在點擊當下就開始播放（瀏覽器規定播放要由使用者操作觸發），再切到播放頁
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-play]");
    if (!b) return;
    playSpot(b.dataset.play, true);
    location.hash = `#/spot/${b.dataset.play}`;
  });

  // ---------- 附近清單（首頁） ----------
  function nearbyHead(where) {
    const t = today();
    const l = dayLabel(t.date);
    const title = dayTitle(t.date);
    return `<header class="head">
      <div class="head-row">
        <span class="pill">${l.md}（${l.wd}）${esc(title || "行程")}</span>
        <button class="icon-btn" id="relocate" aria-label="重新定位">${ICON.locate}</button>
      </div>
      <h1>附近景點</h1>
      ${where ? `<div class="where">${ICON.pin}<span>${where}</span></div>` : ""}
    </header>`;
  }
  async function renderNearby() {
    setTab("nearby", "附近景點");
    if (!state.pos && !state.posError) {
      view.innerHTML = nearbyHead("正在取得目前位置…");
      bindRelocate();
      await locate();
      if (currentRoute().name !== "nearby") return;
    }
    const testNote = state.pos?.test ? `<p class="note">使用網址裡的測試座標（${state.pos.lat}, ${state.pos.lng}）。</p>` : "";

    if (!state.pos) {
      const t = today();
      view.innerHTML = nearbyHead(`${esc(state.posError)}，改顯示${t.inTrip ? "今天" : "行程第一天"}的景點`) +
        dayListHtml(t.date);
      bindRelocate();
      return;
    }
    const withDist = state.spots.map((sp) => ({ sp, d: distance(state.pos, sp) })).sort((a, b) => a.d - b.d);
    let list = withDist.filter((x) => x.d <= NEAR);
    let where = `${NEAR} 公尺內有 ${list.length} 個故事`;
    if (!list.length) {
      list = withDist.filter((x) => x.d <= FAR);
      where = `${NEAR} 公尺內沒有，已擴大到 ${FAR} 公尺 · ${list.length} 個故事`;
    }
    if (!list.length) {
      const t = today();
      const nearest = withDist[0];
      view.innerHTML = nearbyHead(`${FAR} 公尺內沒有故事`) + testNote +
        (nearest ? `<p class="note">最近的是「${esc(nearest.sp.name)}」，在 ${fmtDist(nearest.d)}外。下面是${t.inTrip ? "今天" : "行程第一天"}的景點。</p>` : "") +
        dayListHtml(t.date);
      bindRelocate();
      return;
    }
    view.innerHTML = nearbyHead(where) + testNote +
      `<ul class="list">${list.map((x) => spotCard(x.sp, x.d)).join("")}</ul>`;
    bindRelocate();
  }
  function bindRelocate() {
    const b = $("#relocate");
    if (b) b.onclick = async () => {
      b.disabled = true;
      state.pos = null; state.posError = null;
      await locate(); render();
    };
  }

  // ---------- 行程分頁 ----------
  function dayListHtml(date) {
    const areas = dayAreas(date);
    const spots = state.spots.filter((s) => s.days.includes(date));
    if (!spots.length) {
      return `<div class="empty">${areas.length ? `${esc(dayTitle(date))}還沒有故事。` : "這天沒有安排地區。"}</div>`;
    }
    return `<ul class="list">${spots.map((s, i) => {
      const d = state.pos ? ` · ${fmtDist(distance(state.pos, s))}` : "";
      return compactCard(s, `${i + 1}. ${areaOf(s)?.name || ""}${d}`);
    }).join("")}</ul>`;
  }
  function renderTrip(date) {
    setTab("trip", "行程");
    const t = today();
    if (!date || !tripDays().includes(date)) date = t.date;
    const tabs = tripDays().map((d) => {
      const l = dayLabel(d);
      const isToday = d === t.date && t.inTrip;
      return `<a class="day" href="#/trip/${d}" ${d === date ? 'aria-current="page"' : ""}><b>${l.md}</b><small>${isToday ? "今天" : "週" + l.wd}</small></a>`;
    }).join("");
    const n = state.spots.filter((s) => s.days.includes(date)).length;
    view.innerHTML = `<header class="head"><h1>行程</h1></header>
      <nav class="days" aria-label="日期">${tabs}</nav>
      <div class="day-head"><b>${esc(dayTitle(date) || "沒有安排")}</b><span>${n ? n + " 個故事" : ""}</span></div>
      ${dayListHtml(date)}`;
    const cur = $(".day[aria-current]");
    if (cur) cur.scrollIntoView({ inline: "center", block: "nearest" });
  }

  // ---------- 導覽分頁：國家 → 地區（都道府縣）→ 景點（規格 3.6 節） ----------
  function regionSpots(regionId) {
    const areaIds = state.areas.filter((a) => a.region === regionId).map((a) => a.id);
    return state.spots.filter((s) => areaIds.includes(s.area));
  }
  function guideHead(heading, crumb, backHref) {
    return `<header class="head">
      <div class="head-title">
        ${backHref ? `<a class="icon-btn" href="${backHref}" aria-label="回上一層">${ICON.back}</a>` : ""}
        <h1>${esc(heading)}</h1>
      </div>
      <div class="crumb">${esc(crumb)}</div>
    </header>`;
  }
  function renderGuide(countryId, regionId) {
    setTab("guide", "導覽");
    const country = state.countries.find((c) => c.id === countryId);
    const region = state.regions.find((r) => r.id === regionId && r.country === countryId);

    if (!country) {
      view.innerHTML = guideHead("導覽", "依國家、地區瀏覽所有故事") +
        `<ul class="list">${state.countries.map((c) => {
          const regs = state.regions.filter((r) => r.country === c.id);
          const n = regs.reduce((k, r) => k + regionSpots(r.id).length, 0);
          return `<li><a class="card" href="#/guide/${c.id}">
            <span class="mark">${esc(c.mark || c.name[0])}</span>
            <span class="card-body"><span class="card-name"><span>${esc(c.name)}</span></span>
            <span class="meta">${regs.length} 個地區 · ${n} 個故事</span></span>
            <span class="chev">${ICON.chev}</span></a></li>`;
        }).join("")}</ul>`;
      return;
    }

    if (!region) {
      const regs = state.regions.filter((r) => r.country === country.id);
      view.innerHTML = guideHead(country.name, `導覽 › ${country.name}`, "#/guide") +
        (regs.length ? `<ul class="list">${regs.map((r, i) => {
          const spots = regionSpots(r.id);
          const sub = state.areas.filter((a) => a.region === r.id).map((a) => a.name).join("、");
          const withPhoto = spots.find((s) => s.photo);
          const photo = withPhoto
            ? `<img class="photo" src="${esc(withPhoto.photo)}" alt="" loading="lazy">`
            : `<span class="photo" aria-hidden="true" style="background:${TINTS[i % TINTS.length]}">${svg(TYPES.other.icon, 22, 'stroke-width="1.6"')}</span>`;
          return `<li><a class="card" href="#/guide/${country.id}/${r.id}">
            ${photo}
            <span class="card-body"><span class="card-name"><span>${esc(r.name)}</span></span>
            <span class="meta">${esc(sub)}</span></span>
            <span class="count ${spots.length ? "" : "none"}">${spots.length ? spots.length + " 個故事" : "尚未製作"}</span></a></li>`;
        }).join("")}</ul>` : `<div class="empty">這個國家還沒有設定地區。</div>`);
      return;
    }

    const spots = regionSpots(region.id);
    view.innerHTML = guideHead(region.name, `導覽 › ${country.name} › ${region.name}`, `#/guide/${country.id}`) +
      (spots.length
        ? `<ul class="list">${spots.map((s) => compactCard(s, `${typeOf(s).label} · ${areaOf(s)?.name || ""}`)).join("")}</ul>`
        : `<div class="empty">${esc(region.name)}的故事還沒製作。</div>`);
  }

  // ---------- 地圖 ----------
  function mapCardHtml(sp, staticCard) {
    const meta = [typeOf(sp).label, state.pos ? fmtDist(distance(state.pos, sp)) : null,
      sp.duration ? fmtTime(sp.duration) : null, sp.verified ? "已核對" : "未核對"].filter(Boolean).join(" · ");
    return `<div class="map-card ${staticCard ? "static" : ""}">
      <div class="map-card-top">
        ${photoHtml(sp, "s72")}
        <div class="card-body">
          <div class="map-card-name">${esc(sp.name)}</div>
          <div class="meta">${esc(meta)}</div>
          <div class="summary">${esc(sp.summary)}</div>
        </div>
      </div>
      <div class="btn-row">
        <button class="btn-main" data-play="${esc(sp.id)}">${ICON.play(18)}聽故事</button>
        <a class="btn-line" href="${gmapsUrl(sp)}" target="_blank" rel="noopener">在 Google Maps 開啟</a>
      </div>
    </div>`;
  }
  function renderMap() {
    setTab("map", "地圖");
    if (!CFG.MAPS_API_KEY) {
      view.innerHTML = `<header class="head"><h1>地圖</h1></header>
        <p class="note">還沒設定 Google Maps 金鑰（js/config.js），先用卡片清單代替地圖。</p>
        <ul class="list">${state.spots.map((sp) => `<li>${mapCardHtml(sp, true)}</li>`).join("")}</ul>`;
      return;
    }
    view.innerHTML = `<div class="map-wrap"><div id="map-canvas"></div>
      <div class="map-top"><button class="icon-btn" id="map-me" aria-label="回到目前位置">${ICON.locate}</button></div>
      <div id="map-card-slot"></div></div>`;
    loadMaps().then(drawMap).catch(() => {
      view.innerHTML = `<header class="head"><h1>地圖</h1></header><p class="note warn">Google 地圖載入失敗（可能是離線或金鑰限制）。</p>`;
    });
  }
  let mapsPromise;
  function loadMaps() {
    if (window.google?.maps) return Promise.resolve();
    mapsPromise ||= new Promise((resolve, reject) => {
      window.__mapsReady = resolve;
      const s = document.createElement("script");
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(CFG.MAPS_API_KEY)}&callback=__mapsReady&language=zh-TW`;
      s.async = true; s.onerror = () => { mapsPromise = null; reject(); };
      document.head.appendChild(s);
    });
    return mapsPromise;
  }
  async function drawMap() {
    const el = $("#map-canvas");
    if (!el) return;
    if (!state.pos && !state.posError) await locate();
    const g = google.maps;
    const map = new g.Map(el, {
      center: state.pos || state.spots[0] || { lat: 35.68, lng: 139.76 }, zoom: 16,
      mapTypeControl: false, streetViewControl: false, fullscreenControl: false, clickableIcons: false,
    });
    const slot = $("#map-card-slot");
    const bounds = new g.LatLngBounds();
    state.spots.forEach((sp, i) => {
      const m = new g.Marker({
        position: sp, map, title: sp.name,
        label: { text: String(i + 1), color: "#FFFFFF", fontWeight: "700", fontSize: "14px" },
        icon: { path: g.SymbolPath.CIRCLE, scale: 15, fillColor: "#B8402A", fillOpacity: 1, strokeColor: "#FFFFFF", strokeWeight: 3 },
      });
      bounds.extend(sp);
      m.addListener("click", () => { slot.innerHTML = mapCardHtml(sp); });
    });
    map.addListener("click", () => { slot.innerHTML = ""; });
    if (state.pos) {
      new g.Circle({ map, center: state.pos, radius: NEAR, strokeColor: "#B8402A", strokeOpacity: .6, strokeWeight: 2, fillColor: "#B8402A", fillOpacity: .06 });
      new g.Marker({
        position: state.pos, map, title: "目前位置", zIndex: 999,
        icon: { path: g.SymbolPath.CIRCLE, scale: 8, fillColor: "#2B6CB0", fillOpacity: 1, strokeColor: "#FFFFFF", strokeWeight: 4 },
      });
    } else if (state.spots.length > 1) {
      map.fitBounds(bounds);
    }
    $("#map-me").onclick = async () => {
      state.pos = null; state.posError = null;
      await locate();
      if (state.pos) map.panTo(state.pos);
    };
  }

  // ---------- 播放器 ----------
  const SPEEDS = [1, 1.25, 1.5];
  let speed = +store("speed") || 1;
  if (!SPEEDS.includes(speed)) speed = 1;
  const spotById = (id) => state.spots.find((s) => s.id === id);

  function playSpot(id, autoplay) {
    const sp = spotById(id);
    if (!sp) return;
    if (state.current !== sp) {
      state.current = sp;
      audio.src = sp.audio;
      audio.defaultPlaybackRate = speed;
      audio.playbackRate = speed;
      setMediaSession(sp);
    }
    if (autoplay) audio.play().catch(() => {});
  }
  function sectionAt(sp, t) {
    let idx = 0;
    sp.sections.forEach((s, i) => { if ((s.start ?? Infinity) <= t + 0.05) idx = i; });
    return idx;
  }
  function jumpSection(delta) {
    const sp = state.current;
    if (!sp) return;
    const i = sectionAt(sp, audio.currentTime);
    // 「上一段」：已經播了 3 秒以上就回到這段開頭，否則跳到前一段
    const inSec = audio.currentTime - (sp.sections[i].start || 0);
    const target = delta < 0 && inSec > 3 ? i : Math.min(Math.max(i + delta, 0), sp.sections.length - 1);
    seekTo(sp.sections[target].start || 0);
  }
  function seekTo(t) {
    const d = audio.duration || state.current?.duration || 0;
    audio.currentTime = Math.min(Math.max(t, 0), d ? d - 0.1 : t);
  }

  function renderSpot(id) {
    const sp = spotById(id);
    if (!sp) { setTab(null, "找不到景點"); view.innerHTML = `<div class="empty">找不到這個景點。</div>`; return; }
    setTab(null, sp.name);
    playSpot(id, false);
    const t = typeOf(sp);
    const sub = [areaOf(sp)?.name, t.label, state.pos ? fmtDist(distance(state.pos, sp)) : null].filter(Boolean).join(" · ");
    const hasStarts = sp.sections.every((s) => typeof s.start === "number");
    const tint = TINTS[Math.max(0, spotIndex(sp)) % TINTS.length];
    view.innerHTML = `<article>
      <div class="p-top">
        <div class="p-bar">
          <button class="p-back" id="p-back" aria-label="返回">${ICON.back}</button>
          <span class="p-ver ${sp.verified ? "" : "no"}">${sp.verified ? "已核對" : "未核對"}</span>
        </div>
        <div class="p-photo" style="${sp.photo ? "" : "background:" + tint}">
          ${sp.photo ? `<img src="${esc(sp.photo)}" alt="${esc(sp.name)}">` : svg(t.icon, 40, 'stroke-width="1.4"')}
        </div>
        ${sp.photo_credit ? `<div class="p-credit">照片：${esc(sp.photo_credit)}</div>` : ""}
        <div>
          <div class="p-sub">${esc(sub)}</div>
          <h1>${esc(sp.name)}</h1>
          <div class="p-ja">${esc([sp.name_ja !== sp.name ? sp.name_ja : null, sp.name_en].filter(Boolean).join(" · "))}</div>
        </div>
        <div>
          <input class="seek" id="seek" type="range" min="0" step="0.1" value="0" max="${sp.duration || 0}" aria-label="播放進度">
          <div class="p-times"><span id="t-cur">0:00</span><span id="t-dur">${fmtTime(sp.duration)}</span></div>
        </div>
        <div class="p-ctrl">
          <button class="p-skip" id="back" aria-label="倒退 15 秒">−15</button>
          <button class="p-main" id="toggle" aria-label="播放">${ICON.play(28)}</button>
          <button class="p-skip" id="fwd" aria-label="快轉 15 秒">+15</button>
        </div>
        <div class="chips">${SPEEDS.map((s) => `<button class="chip dark" data-speed="${s}" aria-pressed="${s === speed}">${s.toFixed(s === 1 ? 1 : 2)}×</button>`).join("")}</div>
      </div>
      ${sp.sections.length > 1 && hasStarts
        ? `<div class="chips p-secs">${sp.sections.map((s, i) => `<button class="chip" data-sec="${i}" aria-pressed="false">${KINDS[s.kind] || s.kind}</button>`).join("")}</div>` : ""}
      <div class="transcript">${sp.sections.map((s, i) => `<section class="t-card" data-i="${i}">
        <div class="t-label">${KINDS[s.kind] || s.kind}</div>
        ${s.text.split(/\n+/).map((p) => `<p>${esc(p)}</p>`).join("")}
        ${s.sources?.length ? `<div class="t-src"><b>這段的來源</b>${s.sources.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(srcLabel(u))}</a>`).join("")}</div>` : ""}
      </section>`).join("")}</div>
      <div class="p-maps"><a class="btn-line" href="${gmapsUrl(sp)}" target="_blank" rel="noopener">${ICON.map}在 Google Maps 開啟</a></div>
    </article>`;

    $("#p-back").onclick = () => (state.navigated ? history.back() : (location.hash = "#/nearby"));
    $("#toggle").onclick = () => (audio.paused ? audio.play().catch(() => {}) : audio.pause());
    $("#back").onclick = () => seekTo(audio.currentTime - 15);
    $("#fwd").onclick = () => seekTo(audio.currentTime + 15);
    const seek = $("#seek");
    seek.addEventListener("input", () => { seek.dataset.drag = "1"; $("#t-cur").textContent = fmtTime(+seek.value); });
    seek.addEventListener("change", () => { delete seek.dataset.drag; seekTo(+seek.value); });
    view.querySelectorAll("[data-speed]").forEach((b) => (b.onclick = () => setSpeed(+b.dataset.speed)));
    view.querySelectorAll("[data-sec]").forEach((b) => (b.onclick = () => {
      seekTo(sp.sections[+b.dataset.sec].start);
      if (audio.paused) audio.play().catch(() => {});
    }));
    lastSec = -1;
    updatePlayerUi();
  }
  // 來源連結顯示成比較好讀的名稱
  function srcLabel(u) {
    try {
      const url = new URL(u);
      const host = url.hostname.replace(/^www\./, "");
      const wiki = host.match(/^(ja|zh|en)\.wikipedia\.org$/);
      if (wiki) return `${{ ja: "日文", zh: "中文", en: "英文" }[wiki[1]]}維基百科：${decodeURIComponent(url.pathname.split("/").pop()).replace(/_/g, " ")}`;
      return host + (url.pathname.length > 1 ? decodeURIComponent(url.pathname) : "");
    } catch { return u; }
  }
  function setSpeed(s) {
    speed = s; store("speed", String(s));
    audio.defaultPlaybackRate = s; audio.playbackRate = s;
    view.querySelectorAll("[data-speed]").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.speed === s)));
  }

  let lastSec = -1;
  function updatePlayerUi() {
    const sp = state.current;
    const route = currentRoute();
    const onPlayer = route.name === "spot";
    // 迷你播放列
    const mini = $("#mini");
    const showMini = !!sp && !onPlayer && (!audio.paused || audio.currentTime > 0);
    mini.hidden = !showMini;
    document.body.classList.toggle("has-mini", showMini);
    const dur = audio.duration || sp?.duration || 0;
    if (sp) {
      const sec = sp.sections[sectionAt(sp, audio.currentTime)];
      $("#mini-text").textContent = `${audio.paused ? "已暫停" : "正在播放"}：${sp.name} · ${KINDS[sec?.kind] || ""}`;
      $("#mini-bar").style.width = dur ? `${Math.min(100, audio.currentTime / dur * 100)}%` : "0";
      const mb = $("#mini-btn");
      mb.innerHTML = audio.paused ? ICON.play(18) : ICON.pause(18);
      mb.setAttribute("aria-label", audio.paused ? "播放" : "暫停");
    }
    if (!onPlayer || !sp || route.id !== sp.id) return;
    const toggle = $("#toggle");
    if (!toggle) return;
    toggle.innerHTML = audio.paused ? ICON.play(28) : ICON.pause(28);
    toggle.setAttribute("aria-label", audio.paused ? "播放" : "暫停");
    const seek = $("#seek");
    if (dur) { seek.max = dur; $("#t-dur").textContent = fmtTime(dur); }
    if (!seek.dataset.drag) { seek.value = audio.currentTime; $("#t-cur").textContent = fmtTime(audio.currentTime); }
    const i = sectionAt(sp, audio.currentTime);
    view.querySelectorAll("[data-sec]").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.sec === i)));
    view.querySelectorAll(".t-card").forEach((s) => s.classList.toggle("current", +s.dataset.i === i));
    if (i !== lastSec && lastSec !== -1 && !audio.paused) {
      const el = view.querySelector(`.t-card[data-i="${i}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    lastSec = i;
  }
  ["timeupdate", "play", "pause", "ended", "loadedmetadata", "seeked"].forEach((ev) =>
    audio.addEventListener(ev, () => { updatePlayerUi(); updatePositionState(); }));
  $("#mini-open").onclick = () => { if (state.current) location.hash = `#/spot/${state.current.id}`; };
  $("#mini-btn").onclick = () => (audio.paused ? audio.play().catch(() => {}) : audio.pause());

  // ---------- Media Session：通知列／鎖定畫面的播放控制，切到別的 App 也能控制 ----------
  function setMediaSession(sp) {
    if (!("mediaSession" in navigator)) return;
    const art = sp.photo
      ? [{ src: sp.photo, sizes: "800x600", type: "image/webp" }]
      : [{ src: "icons/icon-512.png", sizes: "512x512", type: "image/png" }];
    navigator.mediaSession.metadata = new MediaMetadata({ title: sp.name, artist: "日本語音導覽", album: areaOf(sp)?.name || "", artwork: art });
  }
  if ("mediaSession" in navigator) {
    const h = {
      play: () => audio.play(),
      pause: () => audio.pause(),
      seekbackward: (d) => seekTo(audio.currentTime - (d.seekOffset || 15)),
      seekforward: (d) => seekTo(audio.currentTime + (d.seekOffset || 15)),
      seekto: (d) => seekTo(d.seekTime),
      previoustrack: () => jumpSection(-1),
      nexttrack: () => jumpSection(1),
    };
    for (const [k, fn] of Object.entries(h)) { try { navigator.mediaSession.setActionHandler(k, fn); } catch { /* 不支援的動作 */ } }
  }
  function updatePositionState() {
    if (!("mediaSession" in navigator) || !audio.duration || !isFinite(audio.duration)) return;
    try {
      navigator.mediaSession.setPositionState({ duration: audio.duration, playbackRate: audio.playbackRate, position: Math.min(audio.currentTime, audio.duration) });
    } catch { /* ignore */ }
  }

  // ---------- 路由 ----------
  function currentRoute() {
    const parts = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
    return { name: parts[0] || "nearby", id: parts[1], sub: parts[2] };
  }
  function setTab(tab, title) {
    document.title = `${title} · 日本語音導覽`;
    document.body.classList.toggle("on-player", tab === null);
    document.querySelectorAll(".nav a").forEach((a) => {
      if (a.dataset.tab === tab) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  }
  function render() {
    const r = currentRoute();
    window.scrollTo(0, 0);
    if (r.name === "map") renderMap();
    else if (r.name === "today") renderTrip(today().date);
    else if (r.name === "trip") renderTrip(r.id);
    else if (r.name === "guide") renderGuide(r.id, r.sub);
    else if (r.name === "spot") renderSpot(r.id);
    else renderNearby();
    updatePlayerUi();
  }
  window.addEventListener("hashchange", () => { state.navigated = true; render(); });

  // ---------- 啟動 ----------
  Promise.all([
    fetch("data/spots.json").then((r) => r.json()),
    fetch("data/areas.json").then((r) => r.json()),
  ]).then(([spots, areas]) => {
    state.spots = spots;
    state.areas = areas.areas;
    state.regions = areas.regions || [];
    state.countries = areas.countries || [];
    state.trip = areas.trip;
    render();
  }).catch((e) => {
    view.innerHTML = `<div class="empty">資料載入失敗：${esc(e.message)}</div>`;
  });
})();
