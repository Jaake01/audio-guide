// 日本語音導覽 App（規格 v1，第 6 節步驟 2：骨架）
// 沒有框架、沒有建置步驟，GitHub Pages 直接提供這些檔案。
(() => {
  "use strict";

  const CFG = window.APP_CONFIG || {};
  const NEAR = CFG.NEARBY_RADIUS_M || 200;
  const FAR = CFG.EXPANDED_RADIUS_M || 500;

  const TYPES = {
    shrine: { icon: "⛩️", label: "神社" },
    temple: { icon: "🛕", label: "寺院" },
    statue: { icon: "🗿", label: "雕像" },
    building: { icon: "🏛️", label: "建築" },
    street: { icon: "🏮", label: "街道" },
    other: { icon: "📍", label: "其他" },
  };
  const KINDS = { history: "史實", legend: "傳說", gossip: "八卦", anime: "動漫典故" };
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
    spots: [], areas: [], trip: null,
    pos: null, posError: null, locating: false,
    current: null,        // 目前載入播放器的景點
    map: null,
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
  const fmtLen = (s) => !s ? "長度未知" : s < 60 ? `${Math.round(s)} 秒` : `約 ${Math.round(s / 60)} 分鐘`;
  const typeOf = (sp) => TYPES[sp.type] || TYPES.other;
  const gmapsUrl = (sp) => `https://www.google.com/maps/search/?api=1&query=${sp.lat},${sp.lng}`;

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
    return { md: `${d.getMonth() + 1}/${d.getDate()}`, wd: `週${WEEK[d.getDay()]}` };
  };

  // ---------- 定位（只在 App 開著時取一次，或按「重新定位」） ----------
  function locate() {
    if (testPos) { state.pos = testPos; return Promise.resolve(); }
    if (!("geolocation" in navigator)) {
      state.posError = "這個瀏覽器不支援定位";
      return Promise.resolve();
    }
    state.locating = true;
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (p) => {
          state.pos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy };
          state.posError = null; state.locating = false; resolve();
        },
        (e) => {
          state.posError = e.code === 1 ? "沒有定位權限" : "暫時拿不到定位";
          state.locating = false; resolve();
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
      );
    });
  }

  // ---------- 清單項目 ----------
  function thumbHtml(sp) {
    return sp.photo
      ? `<img class="thumb" src="${esc(sp.photo)}" alt="" loading="lazy">`
      : `<span class="thumb" aria-hidden="true">${typeOf(sp).icon}</span>`;
  }
  function verifiedBadge(sp) {
    return sp.verified
      ? `<span class="badge ok">已核對</span>`
      : `<span class="badge no">未核對</span>`;
  }
  function spotItem(sp, dist) {
    const t = typeOf(sp);
    return `<li><button class="spot" data-play="${esc(sp.id)}">
      ${thumbHtml(sp)}
      <span class="spot-body">
        <span class="spot-name">${esc(sp.name)}</span>
        <span class="spot-meta">
          ${dist != null ? `<span>${fmtDist(dist)}</span>` : ""}
          <span>${t.icon} ${t.label}</span>
          <span>${fmtLen(sp.duration)}</span>
          ${verifiedBadge(sp)}
        </span>
      </span>
      <span class="play-dot" aria-label="播放">▶</span>
    </button></li>`;
  }
  // 點清單 → 在點擊當下就開始播放（瀏覽器規定播放要由使用者操作觸發），再切到播放頁
  view.addEventListener("click", (e) => {
    const b = e.target.closest("[data-play]");
    if (!b) return;
    playSpot(b.dataset.play, true);
    location.hash = `#/spot/${b.dataset.play}`;
  });

  // ---------- 附近清單（首頁） ----------
  async function renderNearby() {
    setTitle("附近景點", "nearby");
    if (!state.pos && !state.posError) {
      view.innerHTML = `<p class="empty">正在取得目前位置…</p>`;
      await locate();
      if (currentRoute().name !== "nearby") return;
    }
    const refresh = `<div class="row-actions"><button class="btn" id="relocate">🔄 重新定位</button></div>`;

    if (!state.pos) {
      const t = today();
      view.innerHTML = `<p class="note warn">${esc(state.posError)}，改成顯示${t.inTrip ? "今天" : "行程第一天"}（${dayLabel(t.date).md}）的景點。</p>
        ${refresh}${dayList(t.date)}`;
      bindRelocate();
      return;
    }

    const withDist = state.spots.map((sp) => ({ sp, d: distance(state.pos, sp) }))
      .sort((a, b) => a.d - b.d);
    let list = withDist.filter((x) => x.d <= NEAR);
    let note = state.pos.test ? `<p class="note">使用網址裡的測試座標（${state.pos.lat}, ${state.pos.lng}）。</p>` : "";
    if (!list.length) {
      list = withDist.filter((x) => x.d <= FAR);
      note += `<p class="note">${NEAR} 公尺內沒有景點，已擴大到 ${FAR} 公尺。</p>`;
    }
    if (!list.length) {
      const t = today();
      const nearest = withDist[0];
      note = state.pos.test ? `<p class="note">使用網址裡的測試座標（${state.pos.lat}, ${state.pos.lng}）。</p>` : "";
      view.innerHTML = `${note}<p class="note warn">${FAR} 公尺內沒有景點${nearest ? `（最近的「${esc(nearest.sp.name)}」在 ${fmtDist(nearest.d)}外）` : ""}。下面是${t.inTrip ? "今天" : "行程第一天"}的景點。</p>
        ${refresh}${dayList(t.date)}`;
      bindRelocate();
      return;
    }
    view.innerHTML = `${note}${refresh}<ul class="list">${list.map((x) => spotItem(x.sp, x.d)).join("")}</ul>`;
    bindRelocate();
  }
  function bindRelocate() {
    const b = $("#relocate");
    if (b) b.onclick = async () => {
      b.disabled = true; b.textContent = "定位中…";
      state.pos = null; state.posError = null;
      await locate(); render();
    };
  }

  // ---------- 行程分頁 ----------
  function dayList(date) {
    const areas = state.areas.filter((a) => a.days.includes(date));
    if (!areas.length) return `<p class="empty">這天沒有安排地區。</p>`;
    return areas.map((a) => {
      const spots = state.spots.filter((s) => s.area === a.id && s.days.includes(date));
      return `<div class="area-card"><h2>${esc(a.name)}</h2>${a.note ? `<p>${esc(a.note)}</p>` : ""}</div>
        ${spots.length
          ? `<ul class="list">${spots.map((s) => spotItem(s, state.pos ? distance(state.pos, s) : null)).join("")}</ul>`
          : `<p class="empty">還沒有故事。</p>`}`;
    }).join("");
  }
  function renderTrip(date) {
    setTitle("行程", "trip");
    const t = today();
    if (!date || !tripDays().includes(date)) date = t.date;
    const tabs = tripDays().map((d) => {
      const l = dayLabel(d);
      return `<a class="day" href="#/trip/${d}" ${d === date ? 'aria-current="page"' : ""}>${l.md}<small>${d === t.date && t.inTrip ? "今天" : l.wd}</small></a>`;
    }).join("");
    view.innerHTML = `<div class="days">${tabs}</div>${dayList(date)}`;
    const cur = $(".day[aria-current]");
    if (cur) cur.scrollIntoView({ inline: "center", block: "nearest" });
  }

  // ---------- 地圖 ----------
  function renderMap() {
    setTitle("地圖", "map");
    if (!CFG.MAPS_API_KEY) {
      view.innerHTML = `<p class="note">還沒設定 Google Maps 金鑰（js/config.js），先用卡片清單代替地圖。</p>
        <ul class="list">${state.spots.map((sp) => `<li class="spot" style="cursor:default">
          ${thumbHtml(sp)}
          <span class="spot-body">
            <span class="spot-name">${esc(sp.name)}</span>
            <span class="spot-meta"><span>${esc(sp.summary)}</span></span>
            <a class="gmaps-link" href="${gmapsUrl(sp)}" target="_blank" rel="noopener">在 Google Maps 開啟 ↗</a>
          </span>
          <button class="play-dot" data-play="${esc(sp.id)}" aria-label="播放" style="border:0;cursor:pointer">▶</button>
        </li>`).join("")}</ul>`;
      return;
    }
    view.innerHTML = `<div id="map-canvas"></div>`;
    loadMaps().then(drawMap).catch(() => {
      view.innerHTML = `<p class="note warn">Google 地圖載入失敗（可能是離線或金鑰限制）。</p>`;
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
  function drawMap() {
    const el = $("#map-canvas");
    if (!el) return;
    const g = google.maps;
    const map = new g.Map(el, { center: state.pos || state.spots[0] || { lat: 35.68, lng: 139.76 }, zoom: 15,
      mapTypeControl: false, streetViewControl: false, fullscreenControl: false });
    const info = new g.InfoWindow();
    const bounds = new g.LatLngBounds();
    state.spots.forEach((sp) => {
      const m = new g.Marker({ position: sp, map, title: sp.name, label: { text: typeOf(sp).icon, fontSize: "18px" } });
      bounds.extend(sp);
      m.addListener("click", () => {
        const c = document.createElement("div");
        c.className = "map-card";
        c.innerHTML = `<b>${esc(sp.name)}</b><p>${esc(sp.summary)}</p>
          <div class="acts"><button data-play="${esc(sp.id)}">▶ 播放</button>
          <a class="gmaps-link" href="${gmapsUrl(sp)}" target="_blank" rel="noopener">在 Google Maps 開啟</a></div>`;
        c.querySelector("button").onclick = () => { playSpot(sp.id, true); location.hash = `#/spot/${sp.id}`; };
        info.setContent(c); info.open({ map, anchor: m });
      });
    });
    if (state.pos) {
      new g.Marker({ position: state.pos, map, title: "目前位置", zIndex: 999,
        icon: { path: g.SymbolPath.CIRCLE, scale: 8, fillColor: "#1a73e8", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2 } });
    } else if (state.spots.length > 1) {
      map.fitBounds(bounds);
    }
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
    if (!sp) { view.innerHTML = `<p class="empty">找不到這個景點。</p>`; return; }
    setTitle(sp.name, null);
    playSpot(id, false);
    const t = typeOf(sp);
    const hasStarts = sp.sections.every((s) => typeof s.start === "number");
    view.innerHTML = `<article class="player">
      <div class="hero">${sp.photo ? `<img src="${esc(sp.photo)}" alt="${esc(sp.name)}">` : `<span aria-hidden="true">${t.icon}</span>`}</div>
      ${sp.photo_credit ? `<p class="credit">照片：${esc(sp.photo_credit)}</p>` : ""}
      <h2>${esc(sp.name)}</h2>
      <div class="sub">
        <span>${esc([sp.name_ja, sp.name_en].filter(Boolean).join(" · "))}</span>
        <span>${t.icon} ${t.label}</span>
        ${verifiedBadge(sp)}
        <a href="${gmapsUrl(sp)}" target="_blank" rel="noopener">Google Maps ↗</a>
      </div>
      <input class="seek" id="seek" type="range" min="0" step="0.1" value="0" max="${sp.duration || 0}" aria-label="播放進度">
      <div class="times"><span id="t-cur">0:00</span><span id="t-dur">${fmtTime(sp.duration)}</span></div>
      <div class="controls">
        <button class="ctrl" id="back" aria-label="倒退 15 秒">−15</button>
        <button class="ctrl main" id="toggle" aria-label="播放">▶</button>
        <button class="ctrl" id="fwd" aria-label="快轉 15 秒">+15</button>
      </div>
      <div class="speeds">${SPEEDS.map((s) => `<button class="chip" data-speed="${s}" aria-pressed="${s === speed}">${s}×</button>`).join("")}</div>
      ${sp.sections.length > 1 && hasStarts
        ? `<div class="chips">${sp.sections.map((s, i) => `<button class="chip" data-sec="${i}" aria-pressed="false">${KINDS[s.kind] || s.kind}</button>`).join("")}</div>` : ""}
      <div class="transcript">${sp.sections.map((s, i) => `<section data-i="${i}">
        <h3>${KINDS[s.kind] || s.kind}</h3>
        ${s.text.split(/\n+/).map((p) => `<p>${esc(p)}</p>`).join("")}
        ${s.sources?.length ? `<ol class="sources">${s.sources.map((u) => `<li><a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a></li>`).join("")}</ol>` : ""}
      </section>`).join("")}</div>
    </article>`;

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
    updatePlayerUi();
  }

  function setSpeed(s) {
    speed = s; store("speed", String(s));
    audio.defaultPlaybackRate = s; audio.playbackRate = s;
    view.querySelectorAll("[data-speed]").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.speed === s)));
  }

  let lastSec = -1;
  function updatePlayerUi() {
    const sp = state.current;
    // 迷你播放列
    const mini = $("#mini");
    const onPlayer = currentRoute().name === "spot";
    const showMini = sp && !onPlayer && (!audio.paused || audio.currentTime > 0);
    mini.hidden = !showMini;
    document.body.classList.toggle("has-mini", !!showMini);
    if (sp) {
      const sec = sp.sections[sectionAt(sp, audio.currentTime)];
      $("#mini-icon").textContent = audio.paused ? "▶" : "❚❚";
      $("#mini-name").textContent = sp.name;
      $("#mini-sec").textContent = `${KINDS[sec?.kind] || ""} · ${fmtTime(audio.currentTime)} / ${fmtTime(audio.duration || sp.duration)}`;
    }
    if (!onPlayer || !sp || currentRoute().id !== sp.id) return;
    const toggle = $("#toggle");
    if (!toggle) return;
    toggle.textContent = audio.paused ? "▶" : "❚❚";
    toggle.setAttribute("aria-label", audio.paused ? "播放" : "暫停");
    const seek = $("#seek");
    const dur = audio.duration || sp.duration || 0;
    if (dur) { seek.max = dur; $("#t-dur").textContent = fmtTime(dur); }
    if (!seek.dataset.drag) { seek.value = audio.currentTime; $("#t-cur").textContent = fmtTime(audio.currentTime); }
    const i = sectionAt(sp, audio.currentTime);
    view.querySelectorAll("[data-sec]").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.sec === i)));
    view.querySelectorAll(".transcript section").forEach((s) => s.classList.toggle("current", +s.dataset.i === i));
    if (i !== lastSec && !audio.paused && audio.currentTime > 0.5) {
      const el = view.querySelector(`.transcript section[data-i="${i}"]`);
      if (el && i > 0) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    lastSec = i;
  }
  ["timeupdate", "play", "pause", "ended", "loadedmetadata", "seeked"].forEach((ev) =>
    audio.addEventListener(ev, () => { updatePlayerUi(); updatePositionState(); }));
  $("#mini").onclick = (e) => {
    if (!state.current) return;
    if (e.target.closest("#mini-icon")) {
      audio.paused ? audio.play().catch(() => {}) : audio.pause();
    } else {
      location.hash = `#/spot/${state.current.id}`;
    }
  };

  // ---------- Media Session：通知列／鎖定畫面的播放控制，切到別的 App 也能控制 ----------
  function setMediaSession(sp) {
    if (!("mediaSession" in navigator)) return;
    const art = sp.photo
      ? [{ src: sp.photo, sizes: "800x600", type: "image/webp" }]
      : [{ src: "icons/icon-512.png", sizes: "512x512", type: "image/png" }];
    navigator.mediaSession.metadata = new MediaMetadata({ title: sp.name, artist: "日本語音導覽", album: sp.name_ja || "", artwork: art });
  }
  if ("mediaSession" in navigator) {
    const ms = navigator.mediaSession;
    const h = {
      play: () => audio.play(),
      pause: () => audio.pause(),
      seekbackward: (d) => seekTo(audio.currentTime - (d.seekOffset || 15)),
      seekforward: (d) => seekTo(audio.currentTime + (d.seekOffset || 15)),
      seekto: (d) => seekTo(d.seekTime),
      previoustrack: () => jumpSection(-1),
      nexttrack: () => jumpSection(1),
    };
    for (const [k, fn] of Object.entries(h)) { try { ms.setActionHandler(k, fn); } catch { /* 不支援的動作 */ } }
  }
  function updatePositionState() {
    if (!("mediaSession" in navigator) || !audio.duration || !isFinite(audio.duration)) return;
    try {
      navigator.mediaSession.setPositionState({ duration: audio.duration, playbackRate: audio.playbackRate, position: Math.min(audio.currentTime, audio.duration) });
    } catch { /* ignore */ }
  }

  // ---------- 路由 ----------
  function currentRoute() {
    const [, name = "nearby", id] = location.hash.replace(/^#/, "").split("/");
    return { name: name || "nearby", id: id && decodeURIComponent(id) };
  }
  function setTitle(text, tab) {
    $("#title").textContent = text;
    document.title = tab ? `${text} · 日本語音導覽` : `${text} · 語音導覽`;
    document.querySelectorAll(".tabs a").forEach((a) => {
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
    else if (r.name === "spot") renderSpot(r.id);
    else renderNearby();
    updatePlayerUi();
  }
  window.addEventListener("hashchange", render);

  // ---------- 啟動 ----------
  Promise.all([
    fetch("data/spots.json").then((r) => r.json()),
    fetch("data/areas.json").then((r) => r.json()),
  ]).then(([spots, areas]) => {
    state.spots = spots;
    state.areas = areas.areas;
    state.trip = areas.trip;
    render();
  }).catch((e) => {
    view.innerHTML = `<p class="note warn">資料載入失敗：${esc(e.message)}</p>`;
  });
})();
