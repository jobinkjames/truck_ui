// ================= STATE =================
let currentTankerRef     = null;
let activeTankerDetailId = null;
let currentFilter        = "All";
let detailLockRefs       = [];
let tankerMap            = null;
let tankerMarkers        = {};
let liveMapInterval      = null;

window.lockStatusMap    = {};   // lockId → status
window.lockPhysicalMap  = {};   // lockId → physicalState

// ================= LIVE LOCK STATUS =================
db.ref("locks").on("value", snap => {
  const data = snap.val() || {};
  Object.keys(data).forEach(id => {
    window.lockStatusMap[id]   = data[id].status        || "LOCKED";
    window.lockPhysicalMap[id] = data[id].physicalState || "LOCKED";
  });

  if (activeTankerDetailId) {
    Object.keys(data).forEach(lockId => {
      refreshCardStatus(lockId, data[lockId]);
    });
  }
});

// ================= VERIFY ADMIN (modal) =================
async function verifyAdmin() {
  return new Promise(resolve => {
    if (!currentUser) { toast("Not logged in", "error"); return resolve(false); }

    const modalEl       = document.getElementById("adminVerifyModal");
    const modal         = new bootstrap.Modal(modalEl);
    const passwordInput = document.getElementById("verifyPasswordInput");
    const errorEl       = document.getElementById("verifyErrorMsg");

    passwordInput.value   = "";
    errorEl.style.display = "none";
    modal.show();
    setTimeout(() => passwordInput.focus(), 400);

    window.confirmAdminVerify = async function () {
      const pw = passwordInput.value.trim();
      if (!pw) { errorEl.textContent = "Password cannot be empty"; errorEl.style.display = "block"; return; }
      const cred = firebase.auth.EmailAuthProvider.credential(currentUser.email, pw);
      try {
        await currentUser.reauthenticateWithCredential(cred);
        modal.hide();
        resolve(true);
      } catch {
        errorEl.innerHTML = `<i class="fas fa-exclamation-triangle"></i> Incorrect password`;
        errorEl.style.display = "block";
        passwordInput.value   = "";
        passwordInput.focus();
      }
    };

    window.closeVerifyModal = function () { modal.hide(); resolve(false); };
  });
}

// ================= LOAD TANKER LIST =================
function loadUsedTankers() {
  const container = document.getElementById("tankerList");
  if (!container) return;

  db.ref("tankers").on("value", snap => {
    if (!snap.exists()) { container.innerHTML = emptyState("fa-truck-moving", "No tankers found"); return; }

    let html = "";
    snap.forEach(s => {
      const t     = s.val();
      const comps = typeof t.compartments === "object" && t.compartments ? t.compartments : {};
      if (Object.keys(comps).length === 0) return;

      let activeCount = 0;
      const destinations = new Set();

      Object.values(comps).forEach(c => {
        if (!c) return;
        const st = (c.lockId && window.lockStatusMap[c.lockId]) || c.status || "UNKNOWN";
        if (st === "LOCKED" || st === "UNLOCKED") activeCount++;
        if (c.destination) destinations.add(c.destination);
      });

      html += `
        <div class="tanker-item" onclick="openTankerDetailPage('${t.tankerId}')">
          <div>
            <strong>${t.tankerId}</strong>
            <small>${t.vehicleNumber || ""}</small>
            <small style="display:block;color:var(--text-muted);margin-top:2px;font-size:10px;">
              ${[...destinations].join(", ") || "No destinations"}
            </small>
          </div>
          <div style="text-align:right;">
            <div class="tanker-badge-active">ACTIVE</div>
            <small style="font-size:10px;color:var(--text-muted);">${activeCount} active</small>
          </div>
        </div>`;
    });

    container.innerHTML = html || emptyState("fa-truck-moving", "No paired tankers");
  });
}

// ================= OPEN DETAIL PAGE =================
function openTankerDetailPage(tankerId) {
  activeTankerDetailId = tankerId;
  currentFilter        = "All";

  if (liveMapInterval) { clearInterval(liveMapInterval); liveMapInterval = null; }
  if (tankerMap)       { tankerMap.remove(); tankerMap = null; tankerMarkers = {}; }
  detailLockRefs.forEach(r => r.off()); detailLockRefs = [];
  if (currentTankerRef) { currentTankerRef.off(); currentTankerRef = null; }

  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));

  let dp = document.getElementById("tanker-detail-page");
  if (!dp) {
    dp = document.createElement("div");
    dp.id        = "tanker-detail-page";
    dp.className = "page";
    document.querySelector(".content").appendChild(dp);
  }
  dp.classList.add("active");
  dp.innerHTML = `
    <div class="page-header" style="display:flex;align-items:center;gap:10px;">
      <button class="vd-btn vd-btn-sm" onclick="closeTankerDetailPage()">
        <i class="fas fa-arrow-left"></i> Back
      </button>
      <div><h3 style="margin:0;">Tanker Detail</h3><span class="page-sub">Live GPS & Lock Control</span></div>
      <div class="live-pill" style="margin-left:auto;"><span class="live-dot"></span> LIVE</div>
    </div>
    <div id="tanker-detail-body">
      ${emptyState("fa-spinner fa-spin", "Loading tanker…")}
    </div>`;

  document.getElementById("page-title").innerText = tankerId;

  currentTankerRef = db.ref(`tankers/${tankerId}`);
  currentTankerRef.on("value", snap => {
    const tanker = snap.val();
    if (!tanker) return;
    renderTankerDetailPage(tankerId, tanker);
  });

  loadLogs();
}

// ================= CLOSE DETAIL PAGE =================
function closeTankerDetailPage() {
  activeTankerDetailId = null;
  currentFilter        = "All";

  if (liveMapInterval) { clearInterval(liveMapInterval); liveMapInterval = null; }
  if (tankerMap)       { tankerMap.remove(); tankerMap = null; tankerMarkers = {}; }
  detailLockRefs.forEach(r => r.off()); detailLockRefs = [];
  if (currentTankerRef) { currentTankerRef.off(); currentTankerRef = null; }

  document.getElementById("tanker-detail-page")?.classList.remove("active");
  document.getElementById("tanker")?.classList.add("active");
  document.getElementById("page-title").innerText = "Tanker Control";
}

// ================= RENDER DETAIL PAGE =================
function renderTankerDetailPage(tankerId, tanker) {
  const body = document.getElementById("tanker-detail-body");
  if (!body) return;

  const comps    = (tanker.compartments && typeof tanker.compartments === "object") ? tanker.compartments : {};
  const compKeys = Object.keys(comps).sort();

  // ── Filter bar ──
  let filterButtons = `<button class="filter-btn ${currentFilter === "All" ? "active" : ""}" onclick="setFilter('All','${tankerId}')">All</button>`;
  compKeys.forEach(k => {
    filterButtons += `<button class="filter-btn ${currentFilter === k ? "active" : ""}" onclick="setFilter('${k}','${tankerId}')">Comp ${k}</button>`;
  });

  // ── Cards ──
  let cards = "";
  compKeys.forEach(compId => {
    const comp = comps[compId];
    if (!comp) return;
    if (currentFilter !== "All" && currentFilter !== compId) return;

    const lockId      = comp.lockId || null;
    const status      = (lockId && window.lockStatusMap[lockId])   || comp.status        || "LOCKED";
    const physState   = (lockId && window.lockPhysicalMap[lockId]) || "UNKNOWN";
    const isUnlocked  = status === "UNLOCKED";
    const isPhysLocked = physState === "LOCKED";
    const sc          = isUnlocked ? "unlocked" : "locked";
    const destination = comp.destination  || "—";
    const depotName   = comp.depot?.name  || "—";

    // Button logic:
    // - if UNLOCKED → no button (already open, ESP32 will update to LOCKED physically)
    // - if status LOCKED + physicalState LOCKED → show Unlock button
    // - if status LOCKED + physicalState not LOCKED → show "Waiting for locking..."
    let actionBtn = "";
    if (isUnlocked) {
      actionBtn = `
        <div class="physical-state-row unlocked-state">
          <i class="fas fa-lock-open"></i>
          <span>Lock is open — will update when physically closed</span>
        </div>`;
    } else if (isPhysLocked) {
      actionBtn = `
        <button class="vd-btn vd-btn-green vd-btn-sm flex-1" onclick="manualUnlock('${tankerId}','${compId}','${lockId}')">
          <i class="fas fa-lock-open"></i> Unlock
        </button>`;
    } else {
      actionBtn = `
        <div class="physical-state-row waiting-state">
          <span class="waiting-spinner"></span>
          <span>Waiting for physical lock...</span>
        </div>`;
    }

    cards += `
      <div class="comp-card ${sc}" id="cc-${compId}">
        <div class="comp-header">
          <span class="comp-title">Comp ${compId}</span>
          <span class="comp-status ${sc}" id="cc-status-${compId}">${status}</span>
        </div>
        <div class="comp-row">
          <span class="label">Lock ID</span>
          <span class="value">${lockId || "—"}</span>
        </div>
        <div class="comp-row">
          <span class="label"><i class="fas fa-circle-dot" style="font-size:9px;color:${isPhysLocked ? '#ef4444' : '#22c55e'};margin-right:3px;"></i>Physical</span>
          <span class="value" id="cc-physical-${compId}" style="color:${isPhysLocked ? '#ef4444' : '#22c55e'};font-weight:700;">
            ${physState}
          </span>
        </div>
        <div class="comp-row">
          <span class="label"><i class="fas fa-warehouse" style="font-size:9px;color:#5aa0f0;margin-right:3px;"></i>Depot</span>
          <span class="value">${depotName}</span>
        </div>
        <div class="comp-row">
          <span class="label"><i class="fas fa-location-dot" style="font-size:9px;color:#22c55e;margin-right:3px;"></i>Destination</span>
          <span class="value">${destination}</span>
        </div>
        <div class="comp-row">
          <span class="label">GPS</span>
          <span class="value" id="cc-gps-${compId}">
            <span style="color:var(--text-muted);font-style:italic;font-size:10px;">Loading…</span>
          </span>
        </div>
        <div class="comp-row">
          <span class="label">Auth Key</span>
          <span class="value" id="key_${lockId}">…</span>
        </div>
        <div class="comp-row">
          <span class="label">Expiry</span>
          <span class="value" id="exp_${lockId}">…</span>
        </div>
        <div class="comp-row">
          <span class="label">Unlocked by</span>
          <span class="value" id="unlockedby_${lockId}" style="color:#a78bfa;font-size:9px;">—</span>
        </div>
        <div class="comp-actions" style="display:flex;flex-direction:column;gap:5px;margin-top:8px;">
          <div style="display:flex;gap:5px;" id="cc-mainbtn-${compId}">
            ${actionBtn}
          </div>
          <div style="display:flex;gap:5px;">
            <button class="vd-btn vd-btn-cyan vd-btn-sm flex-1" onclick="generateEmergencyKey('${lockId}')">
              <i class="fas fa-bolt"></i> Emergency
            </button>
            <button class="vd-btn vd-btn-red vd-btn-sm flex-1" onclick="resetLock('${lockId}')">
              <i class="fas fa-rotate-left"></i> Reset
            </button>
          </div>
        </div>
      </div>`;
  });

  // ── Timeline ──
  let timeline = "";
  compKeys.forEach(compId => {
    const comp   = comps[compId];
    if (!comp) return;
    const lockId = comp.lockId || null;
    const status = (lockId && window.lockStatusMap[lockId]) || comp.status || "LOCKED";
    const isUnlk = status === "UNLOCKED";

    const depotName  = comp.depot?.name  || "—";
    const destName   = comp.destination  || "—";
    const depotLat   = comp.depot?.location?.latitude;
    const depotLng   = comp.depot?.location?.longitude;
    const destLat    = comp.destinationLocation?.latitude;
    const destLng    = comp.destinationLocation?.longitude;
    const lockedLat  = comp.route?.lockedLocation?.latitude;
    const lockedLng  = comp.route?.lockedLocation?.longitude;
    const unlockedLat = comp.route?.unlockedLocation?.latitude;
    const unlockedLng = comp.route?.unlockedLocation?.longitude;
    const hasLocked   = lockedLat  && lockedLng;
    const hasUnlocked = unlockedLat && unlockedLng;

    timeline += `
      <div class="timeline-item">
        <div class="tl-spine">
          <div class="timeline-dot ${isUnlk ? "unlocked" : "locked"}">
            <i class="fas ${isUnlk ? "fa-lock-open" : "fa-lock"}"></i>
          </div>
          <div class="tl-spine-line"></div>
        </div>
        <div class="timeline-content">
          <div class="timeline-title">
            Comp ${compId} — <span id="tl-status-${compId}" style="color:${isUnlk ? "#22c55e" : "#ef4444"}">${status}</span>
          </div>

          <div class="tl-row">
            <i class="fas fa-circle-dot" style="color:#f59e0b;font-size:10px;width:14px;"></i>
            <span class="tl-label">Physical:</span>
            <span class="tl-value" id="tl-physical-${compId}" style="font-weight:700;">
              ${(lockId && window.lockPhysicalMap[lockId]) || "—"}
            </span>
          </div>

          <div class="tl-row">
            <i class="fas fa-user-check" style="color:#a78bfa;font-size:10px;width:14px;"></i>
            <span class="tl-label">Unlocked by:</span>
            <span class="tl-value" id="tl-unlockedby-${compId}" style="color:#a78bfa;">—</span>
          </div>

          <div class="tl-row">
            <i class="fas fa-warehouse" style="color:#5aa0f0;font-size:10px;width:14px;"></i>
            <span class="tl-label">Depot:</span>
            <span class="tl-value">
              ${depotName}
              ${depotLat && depotLng
                ? `<a href="https://maps.google.com/?q=${depotLat},${depotLng}" target="_blank" class="tl-map-link">
                     <i class="fas fa-arrow-up-right-from-square"></i> ${depotLat.toFixed(4)}, ${depotLng.toFixed(4)}
                   </a>`
                : ""}
            </span>
          </div>

          <div class="tl-row">
            <i class="fas fa-location-dot" style="color:#22c55e;font-size:10px;width:14px;"></i>
            <span class="tl-label">Destination:</span>
            <span class="tl-value">
              ${destName}
              ${destLat && destLng
                ? `<a href="https://maps.google.com/?q=${destLat},${destLng}" target="_blank" class="tl-map-link">
                     <i class="fas fa-arrow-up-right-from-square"></i> ${destLat.toFixed(4)}, ${destLng.toFixed(4)}
                   </a>`
                : ""}
            </span>
          </div>

          <div class="tl-row">
            <i class="fas fa-lock" style="color:#ef4444;font-size:10px;width:14px;"></i>
            <span class="tl-label">Locked at:</span>
            <span class="tl-value">
              ${hasLocked && (lockedLat !== 0 || lockedLng !== 0)
                ? `<a href="https://maps.google.com/?q=${lockedLat},${lockedLng}" target="_blank" class="tl-map-link">
                     <i class="fas fa-arrow-up-right-from-square"></i> ${lockedLat.toFixed(5)}, ${lockedLng.toFixed(5)}
                   </a>`
                : `<span style="color:var(--text-muted);font-style:italic;font-size:10px;">Not recorded yet</span>`}
            </span>
          </div>

          <div class="tl-row">
            <i class="fas fa-lock-open" style="color:#22c55e;font-size:10px;width:14px;"></i>
            <span class="tl-label">Unlocked at:</span>
            <span class="tl-value">
              ${hasUnlocked
                ? `<a href="https://maps.google.com/?q=${unlockedLat},${unlockedLng}" target="_blank" class="tl-map-link">
                     <i class="fas fa-arrow-up-right-from-square"></i> ${unlockedLat.toFixed(5)}, ${unlockedLng.toFixed(5)}
                   </a>`
                : `<span style="color:var(--text-muted);font-style:italic;font-size:10px;">Not yet</span>`}
            </span>
          </div>

          <div class="tl-row" id="tl-gps-${compId}">
            <i class="fas fa-satellite-dish" style="color:#f59e0b;font-size:10px;width:14px;"></i>
            <span class="tl-label">Live GPS:</span>
            <span class="tl-value" style="color:var(--text-muted);font-style:italic;font-size:10px;">Loading…</span>
          </div>
        </div>
      </div>`;
  });

  body.innerHTML = `
    <style>
      .timeline-item{display:flex;gap:12px;padding-bottom:18px;}
      .timeline-item:last-child{padding-bottom:4px;}
      .tl-spine{display:flex;flex-direction:column;align-items:center;width:24px;flex-shrink:0;}
      .timeline-dot{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px;border:2px solid;flex-shrink:0;transition:all .3s;}
      .timeline-dot.locked  {border-color:#ef4444;color:#ef4444;background:rgba(239,68,68,.08);}
      .timeline-dot.unlocked{border-color:#22c55e;color:#22c55e;background:rgba(34,197,94,.08);}
      .tl-spine-line{width:2px;flex:1;background:var(--border);margin-top:3px;min-height:12px;}
      .timeline-content{flex:1;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:5px;}
      .timeline-title{font-size:13px;font-weight:700;margin-bottom:2px;}
      .tl-row{display:flex;align-items:flex-start;gap:6px;font-size:11px;}
      .tl-label{color:var(--text-muted);flex-shrink:0;min-width:80px;}
      .tl-value{flex:1;font-family:var(--font-mono);font-size:10px;word-break:break-all;}
      .tl-map-link{color:#5aa0f0;text-decoration:none;display:inline-flex;align-items:center;gap:3px;}
      .tl-map-link:hover{text-decoration:underline;}

      .comp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;}
      .comp-card{border-radius:10px;border:1px solid var(--border);padding:12px;background:var(--surface);transition:border-color .2s;}
      .comp-card.unlocked{border-color:rgba(34,197,94,.4);background:rgba(34,197,94,.03);}
      .comp-card.locked  {border-color:rgba(239,68,68,.25);}
      .comp-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;}
      .comp-title{font-size:11px;font-weight:800;letter-spacing:.5px;}
      .comp-status{font-size:9px;font-weight:700;padding:2px 8px;border-radius:20px;}
      .comp-status.unlocked{background:rgba(34,197,94,.15);color:#22c55e;}
      .comp-status.locked  {background:rgba(239,68,68,.12);color:#ef4444;}
      .comp-row{display:flex;justify-content:space-between;align-items:center;font-size:11px;padding:3px 0;border-bottom:1px solid var(--border);}
      .comp-row:last-of-type{border:none;}
      .comp-row .label{color:var(--text-muted);}
      .comp-row .value{font-family:var(--font-mono);font-size:10px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
      .filter-btn{padding:5px 12px;border-radius:20px;border:1px solid var(--border);background:var(--surface);color:var(--text-muted);font-size:11px;cursor:pointer;transition:all .15s;}
      .filter-btn.active{background:#3b82f6;color:#fff;border-color:#3b82f6;}
      .filter-bar{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;}
      .flex-1{flex:1;}

      /* Physical state indicator rows */
      .physical-state-row{
        display:flex;align-items:center;gap:8px;
        padding:8px 10px;border-radius:8px;font-size:11px;font-weight:600;
        width:100%;
      }
      .physical-state-row.waiting-state{
        background:rgba(245,158,11,.08);
        border:1px solid rgba(245,158,11,.25);
        color:#f59e0b;
      }
      .physical-state-row.unlocked-state{
        background:rgba(34,197,94,.07);
        border:1px solid rgba(34,197,94,.2);
        color:#22c55e;
        font-size:10px;
      }
      /* Spinner for waiting state */
      .waiting-spinner{
        width:12px;height:12px;flex-shrink:0;
        border:2px solid rgba(245,158,11,.3);
        border-top-color:#f59e0b;
        border-radius:50%;
        animation:spin .8s linear infinite;
      }
      @keyframes spin{to{transform:rotate(360deg);}}

      #tankerLiveMap{height:420px;width:100%;border-radius:12px;overflow:hidden;}
      .lock-marker-wrapper{display:flex;flex-direction:column;align-items:center;gap:2px;}
      .lock-marker-wrapper .lock-icon{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,.4);}
      .lock-marker-wrapper.lock  .lock-icon{background:#ef4444;color:white;}
      .lock-marker-wrapper.unlock .lock-icon{background:#22c55e;color:white;}
      .lock-id-label{font-size:9px;font-weight:700;background:rgba(0,0,0,.75);color:white;padding:1px 5px;border-radius:4px;white-space:nowrap;}
    </style>

    <div class="filter-bar">${filterButtons}</div>

    <div class="panel mb-3">
      <div class="panel-header"><h4><i class="fas fa-lock"></i> Lock Dashboard</h4></div>
      <div class="panel-body">
        <div class="comp-grid">
          ${cards || emptyState("fa-box-open", "No compartments match")}
        </div>
      </div>
    </div>

    <div class="panel mb-3">
      <div class="panel-header"><h6><i class="fas fa-route"></i> Delivery Timeline</h6></div>
      <div class="panel-body">
        <div class="timeline-wrap">
          ${timeline || emptyState("fa-route", "No timeline data")}
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <h6><i class="fas fa-map-location-dot"></i> Live GPS Map</h6>
        <div class="live-pill small"><span class="live-dot"></span> LIVE</div>
      </div>
      <div class="panel-body p-0" style="padding:12px;">
        <div id="tankerLiveMap"></div>
      </div>
    </div>`;

  document.getElementById("page-title").innerText = `${tankerId} — Detail`;

  compKeys.forEach(compId => {
    const lockId = comps[compId]?.lockId;
    if (!lockId) return;
    startLockListener(tankerId, compId, lockId);
  });

  setTimeout(() => initTankerMap(tankerId, tanker), 150);
}

// ================= FILTER =================
window.setFilter = function(filter, tankerId) {
  currentFilter = filter;
  if (currentTankerRef) {
    currentTankerRef.once("value").then(snap => {
      const t = snap.val();
      if (t) renderTankerDetailPage(tankerId, t);
    });
  }
};

// ================= LIVE LOCK LISTENER =================
// Tracks: status, physicalState, authKey, unlockedBy, GPS
// When physicalState flips to LOCKED → auto-generate auth key
// =======================================================
const _prevPhysical = {}; // lockId → last seen physicalState

function startLockListener(tankerId, compId, lockId) {
  const ref = db.ref(`locks/${lockId}`);
  detailLockRefs.push(ref);

  ref.on("value", async snap => {
    const data = snap.val() || {};

    // ── Auth key ──
    const keyEl = document.getElementById(`key_${lockId}`);
    const expEl = document.getElementById(`exp_${lockId}`);
    if (keyEl) keyEl.textContent = data.authKey?.key || "No Key";
    if (expEl) {
      if (data.authKey?.expiry) {
        const expired = data.authKey.expiry < Date.now();
        expEl.innerHTML = `<span style="color:${expired ? "#ef4444" : "#22c55e"}">${new Date(data.authKey.expiry).toLocaleTimeString()}${expired ? " (Expired)" : ""}</span>`;
      } else {
        expEl.textContent = "—";
      }
    }

    // ── Unlocked by ──
    const unlockedBy = data.unlockedBy || null;
    const ubCardEl   = document.getElementById(`unlockedby_${lockId}`);
    const ubTlEl     = document.getElementById(`tl-unlockedby-${compId}`);
    const ubText     = unlockedBy
      ? formatUnlockedBy(unlockedBy)
      : `<span style="color:var(--text-muted)">—</span>`;
    if (ubCardEl) ubCardEl.innerHTML = ubText;
    if (ubTlEl)   ubTlEl.innerHTML  = ubText;

    // ── Physical state ──
    const physState    = data.physicalState || "UNKNOWN";
    const prevPhysical = _prevPhysical[lockId];

    // Update physical state displays
    const physCardEl = document.getElementById(`cc-physical-${compId}`);
    const physTlEl   = document.getElementById(`tl-physical-${compId}`);
    const physColor  = physState === "LOCKED" ? "#ef4444" : "#22c55e";
    if (physCardEl) { physCardEl.textContent = physState; physCardEl.style.color = physColor; }
    if (physTlEl)   { physTlEl.textContent   = physState; physTlEl.style.color   = physColor; }

    // Auto-generate auth key when lock transitions to LOCKED physically
    // Only trigger on the transition (prev != LOCKED, new == LOCKED)
    if (physState === "LOCKED" && prevPhysical !== "LOCKED") {
      const hasValidKey = data.authKey?.key && !data.authKey?.used && data.authKey?.expiry > Date.now();
      if (!hasValidKey) {
        await generateKeyOnPhysicalLock(tankerId, compId, lockId, data);
      }
    }

    // Sync status = UNLOCKED when physicalState transitions to UNLOCKED
    // Only trigger on the transition (prev != UNLOCKED, new == UNLOCKED)
    if (physState === "UNLOCKED" && prevPhysical !== "UNLOCKED") {
      try {
        await db.ref(`locks/${lockId}`).update({ status: "UNLOCKED" });
        console.log(`[PhysSync] ${lockId} physicalState=UNLOCKED → status set to UNLOCKED`);
      } catch (e) {
        console.error(`[PhysSync] Failed to sync status for ${lockId}:`, e);
      }
    }

    _prevPhysical[lockId] = physState;

    // ── GPS ──
    const gps = data.location || data.gps || null;
    updateGpsDisplay(compId, lockId, gps, data.status);
  });
}

// ================= FORMAT UNLOCKED BY =================
function formatUnlockedBy(value) {
  const icons = {
    "STATION_VERIFIED": `<i class="fas fa-tower-broadcast" style="color:#22c55e;margin-right:3px;"></i>`,
    "FIREBASE_REMOTE":  `<i class="fas fa-cloud" style="color:#5aa0f0;margin-right:3px;"></i>`,
  };
  const icon  = icons[value] || `<i class="fas fa-user" style="color:#a78bfa;margin-right:3px;"></i>`;
  const label = value.replace(/_/g, " ");
  return `<span style="color:#a78bfa;font-size:9px;">${icon}${label}</span>`;
}

// ================= AUTO-GENERATE KEY ON PHYSICAL LOCK =================
async function generateKeyOnPhysicalLock(tankerId, compId, lockId, lockData) {
  try {
    const key    = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = Date.now() + 2 * 60 * 60 * 1000; // 2 hours

    // Read current GPS from location field
    const gpsSnap = await db.ref(`locks/${lockId}/location`).once("value");
    const gps     = gpsSnap.val();

    await db.ref(`locks/${lockId}`).update({
      status:  "LOCKED",
      authKey: {
        key,
        expiry,
        used:      false,
        createdAt: Date.now(),
        type:      "LOCK"
      }
    });

    // Record where it was locked
    await db.ref(`tankers/${tankerId}/compartments/${compId}/route/lockedLocation`).set({
      latitude:  gps?.latitude  || 0,
      longitude: gps?.longitude || 0,
      time:      Date.now()
    });

    logAction("LOCK", lockId);
    toast(`Key generated for ${lockId}: ${key}`, "success");

    console.log(`[AutoKey] Generated key ${key} for ${lockId} on physical lock`);
  } catch (e) {
    console.error("[AutoKey] Error generating key:", e);
    toast("Error generating auth key", "error");
  }
}

// ================= UPDATE GPS DISPLAY =================
function updateGpsDisplay(compId, lockId, gps, status) {
  const cardGpsEl    = document.getElementById(`cc-gps-${compId}`);
  const timelineGpsEl = document.getElementById(`tl-gps-${compId}`);

  const lat    = gps?.latitude;
  const lng    = gps?.longitude;
  const hasGps = lat && lng;

  const gpsHtml = hasGps
    ? `<a href="https://maps.google.com/?q=${lat},${lng}" target="_blank" style="color:#5aa0f0;font-size:10px;text-decoration:none;">
         <i class="fas fa-location-dot" style="color:#22c55e;"></i> ${lat.toFixed(5)}, ${lng.toFixed(5)}
         <i class="fas fa-arrow-up-right-from-square" style="font-size:8px;margin-left:2px;"></i>
       </a>`
    : `<span style="color:var(--text-muted);font-style:italic;font-size:10px;"><i class="fas fa-satellite-dish"></i> No GPS signal</span>`;

  if (cardGpsEl)     cardGpsEl.innerHTML = gpsHtml;
  if (timelineGpsEl) timelineGpsEl.innerHTML = `
    <i class="fas fa-satellite-dish" style="color:#f59e0b;font-size:10px;width:14px;"></i>
    <span class="tl-label">Live GPS:</span>
    <span class="tl-value">${gpsHtml}</span>`;

  if (hasGps && tankerMap && tankerMarkers[lockId]) {
    tankerMarkers[lockId].setLatLng([lat, lng]);
    tankerMarkers[lockId].getPopup()?.setContent(buildPopupHtml(lockId, compId, lat, lng, status));
  }
}

// ================= REFRESH CARD STATUS (from global lock listener) =================
function refreshCardStatus(lockId, lockData) {
  if (!currentTankerRef) return;
  currentTankerRef.once("value").then(snap => {
    const t = snap.val();
    if (!t) return;
    const comps = typeof t.compartments === "object" ? t.compartments : {};

    Object.entries(comps).forEach(([compId, comp]) => {
      if (comp?.lockId !== lockId) return;

      const status      = lockData.status        || "LOCKED";
      const physState   = lockData.physicalState  || "UNKNOWN";
      const isUnlocked  = status    === "UNLOCKED";
      const isPhysLocked = physState === "LOCKED";
      const sc          = isUnlocked ? "unlocked" : "locked";

      // Update card class + badge
      const card    = document.getElementById(`cc-${compId}`);
      const badge   = document.getElementById(`cc-status-${compId}`);
      const mainBtn = document.getElementById(`cc-mainbtn-${compId}`);
      const tlBadge = document.getElementById(`tl-status-${compId}`);
      const physCard = document.getElementById(`cc-physical-${compId}`);
      const physTl   = document.getElementById(`tl-physical-${compId}`);

      if (card)    { card.className = `comp-card ${sc}`; }
      if (badge)   { badge.className = `comp-status ${sc}`; badge.textContent = status; }
      if (tlBadge) { tlBadge.style.color = isUnlocked ? "#22c55e" : "#ef4444"; tlBadge.textContent = status; }

      const physColor = isPhysLocked ? "#ef4444" : "#22c55e";
      if (physCard) { physCard.textContent = physState; physCard.style.color = physColor; }
      if (physTl)   { physTl.textContent   = physState; physTl.style.color   = physColor; }

      // Update action button
      if (mainBtn) {
        if (isUnlocked) {
          mainBtn.innerHTML = `
            <div class="physical-state-row unlocked-state">
              <i class="fas fa-lock-open"></i>
              <span>Lock is open — will update when physically closed</span>
            </div>`;
        } else if (isPhysLocked) {
          mainBtn.innerHTML = `
            <button class="vd-btn vd-btn-green vd-btn-sm flex-1" onclick="manualUnlock('${t.tankerId}','${compId}','${lockId}')">
              <i class="fas fa-lock-open"></i> Unlock
            </button>`;
        } else {
          mainBtn.innerHTML = `
            <div class="physical-state-row waiting-state">
              <span class="waiting-spinner"></span>
              <span>Waiting for physical lock...</span>
            </div>`;
        }
      }

      // Update unlockedBy
      const unlockedBy = lockData.unlockedBy || null;
      const ubCardEl   = document.getElementById(`unlockedby_${lockId}`);
      const ubTlEl     = document.getElementById(`tl-unlockedby-${compId}`);
      const ubText     = unlockedBy ? formatUnlockedBy(unlockedBy) : `<span style="color:var(--text-muted)">—</span>`;
      if (ubCardEl) ubCardEl.innerHTML = ubText;
      if (ubTlEl)   ubTlEl.innerHTML  = ubText;
    });
  });
}

// ================= INIT GPS MAP =================
function initTankerMap(tankerId, tanker) {
  const mapEl = document.getElementById("tankerLiveMap");
  if (!mapEl) return;
  if (typeof L === "undefined") { console.warn("Leaflet not loaded"); return; }

  if (tankerMap) { tankerMap.remove(); tankerMap = null; tankerMarkers = {}; }

  tankerMap = L.map("tankerLiveMap").setView([12.9716, 77.5946], 11);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>'
  }).addTo(tankerMap);

  const comps = typeof tanker.compartments === "object" && tanker.compartments ? tanker.compartments : {};

  Object.values(comps).forEach(comp => {
    if (!comp) return;
    const dLat = comp.depot?.location?.latitude;
    const dLng = comp.depot?.location?.longitude;
    if (dLat && dLng) {
      L.marker([dLat, dLng], { icon: buildStaticIcon("#3b82f6", "fa-warehouse") })
        .addTo(tankerMap)
        .bindPopup(`<b>DEPOT</b><br>${comp.depot?.name || ""}<br><small>${dLat.toFixed(5)}, ${dLng.toFixed(5)}</small>`);
    }
    const destLat = comp.destinationLocation?.latitude;
    const destLng = comp.destinationLocation?.longitude;
    if (destLat && destLng) {
      L.marker([destLat, destLng], { icon: buildStaticIcon("#22c55e", "fa-location-dot") })
        .addTo(tankerMap)
        .bindPopup(`<b>DESTINATION</b><br>${comp.destination || ""}<br><small>${destLat.toFixed(5)}, ${destLng.toFixed(5)}</small>`);
    }
  });

  const fetchPromises = Object.entries(comps).map(([compId, comp]) => {
    const lockId = comp?.lockId;
    if (!lockId) return Promise.resolve(null);
    return db.ref(`locks/${lockId}`).once("value").then(snap => {
      const data   = snap.val();
      if (!data)   return null;
      const gps    = data.location || data.gps || null;
      const lat    = gps?.latitude;
      const lng    = gps?.longitude;
      if (!lat || !lng) return null;
      const status = data.status || window.lockStatusMap[lockId] || "LOCKED";
      const marker = buildLockMarker(lockId, compId, comp, lat, lng, status);
      marker.addTo(tankerMap);
      tankerMarkers[lockId] = marker;
      return [lat, lng];
    });
  });

  Promise.all(fetchPromises).then(results => {
    const bounds = results.filter(Boolean);
    if (bounds.length > 0) tankerMap.fitBounds(bounds, { padding: [50, 50] });
  });

  if (liveMapInterval) clearInterval(liveMapInterval);
  liveMapInterval = setInterval(() => {
    Object.entries(comps).forEach(([compId, comp]) => {
      const lockId = comp?.lockId;
      if (!lockId) return;
      db.ref(`locks/${lockId}/location`).once("value").then(snap => {
        const gps = snap.val();
        if (!gps?.latitude || !gps?.longitude) return;
        updateGpsDisplay(compId, lockId, gps, window.lockStatusMap[lockId]);
        if (tankerMarkers[lockId]) tankerMarkers[lockId].setLatLng([gps.latitude, gps.longitude]);
      });
    });
  }, 10000);
}

// ================= BUILD LOCK MARKER =================
function buildLockMarker(lockId, compId, comp, lat, lng, status) {
  const isUnlk = status === "UNLOCKED";
  const icon   = L.divIcon({
    className: "",
    html: `
      <div class="lock-marker-wrapper ${isUnlk ? "unlock" : "lock"}">
        <div class="lock-icon"><i class="fas ${isUnlk ? "fa-lock-open" : "fa-lock"}"></i></div>
        <div class="lock-id-label">${lockId}</div>
      </div>`,
    iconSize:    [60, 52],
    iconAnchor:  [30, 52],
    popupAnchor: [0, -54]
  });
  return L.marker([lat, lng], { icon }).bindPopup(buildPopupHtml(lockId, compId, lat, lng, status, comp));
}

function buildPopupHtml(lockId, compId, lat, lng, status, comp) {
  const isUnlk = status === "UNLOCKED";
  const dest   = comp?.destination || "—";
  const depot  = comp?.depot?.name || "—";
  return `
    <div style="font-family:monospace;font-size:12px;min-width:180px;line-height:1.7;">
      <div style="font-weight:800;font-size:13px;margin-bottom:4px;">${lockId}</div>
      <div style="color:#666;font-size:11px;">Compartment: <b>${compId}</b></div>
      <div style="color:#666;font-size:11px;"><i class="fas fa-warehouse" style="color:#3b82f6;"></i> ${depot}</div>
      <div style="color:#666;font-size:11px;"><i class="fas fa-location-dot" style="color:#22c55e;"></i> ${dest}</div>
      <div style="margin:5px 0;">
        <span style="padding:2px 8px;border-radius:12px;font-size:10px;font-weight:700;
          background:${isUnlk ? "rgba(34,197,94,.15)" : "rgba(239,68,68,.12)"};
          color:${isUnlk ? "#22c55e" : "#ef4444"};">${status}</span>
      </div>
      <div style="color:#999;font-size:10px;">${lat.toFixed(6)}, ${lng.toFixed(6)}</div>
      <a href="https://maps.google.com/?q=${lat},${lng}" target="_blank"
         style="font-size:10px;color:#5aa0f0;text-decoration:none;">
        <i class="fas fa-arrow-up-right-from-square"></i> Open in Maps
      </a>
    </div>`;
}

// ================= STATIC ICON =================
function buildStaticIcon(color, faClass) {
  return L.divIcon({
    className: "",
    html: `
      <div style="filter:drop-shadow(0 2px 5px rgba(0,0,0,.4));">
        <svg viewBox="0 0 32 40" width="32" height="40" xmlns="http://www.w3.org/2000/svg">
          <path d="M16 1C8.3 1 2 7.4 2 15.5C2 26 16 39 16 39S30 26 30 15.5C30 7.4 23.7 1 16 1Z"
            fill="${color}" stroke="rgba(255,255,255,.6)" stroke-width="1.5"/>
          <circle cx="16" cy="15.5" r="6.5" fill="white" opacity=".9"/>
        </svg>
        <div style="position:absolute;top:8px;left:0;right:0;text-align:center;color:${color};font-size:9px;">
          <i class="fas ${faClass}"></i>
        </div>
      </div>`,
    iconSize:    [32, 40],
    iconAnchor:  [16, 40],
    popupAnchor: [0, -42]
  });
}

// ================= MANUAL UNLOCK (admin only) =================
async function manualUnlock(tankerId, compId, lockId) {
  if (!lockId) return toast("No lock assigned", "warning");
  if (!await verifyAdmin()) return;
  try {
    const keySnap = await db.ref(`locks/${lockId}/authKey`).once("value");
    const keyData = keySnap.val();
    if (keyData?.expiry && keyData.expiry < Date.now()) return toast("Auth key expired", "error");

    const gpsSnap = await db.ref(`locks/${lockId}/location`).once("value");
    const gps     = gpsSnap.val();

    await db.ref(`locks/${lockId}`).update({
      status:     "UNLOCK",      // ESP32 watches for "UNLOCK" to open relay
      unlockedBy: currentUser?.email || "ADMIN"
    });
    await db.ref(`locks/${lockId}/authKey`).remove();

    await db.ref(`tankers/${tankerId}/compartments/${compId}/route/unlockedLocation`).set({
      latitude:  gps?.latitude  || 0,
      longitude: gps?.longitude || 0,
      time:      Date.now()
    });

    logAction("UNLOCK", lockId);
    toast("Unlock command sent to ESP32", "success");
  } catch (e) {
    console.error(e);
    toast("Unlock failed", "error");
  }
}

// ================= EMERGENCY KEY =================
async function generateEmergencyKey(lockId) {
  if (!await verifyAdmin()) return;
  const key = Math.floor(100000 + Math.random() * 900000).toString();
  await db.ref(`locks/${lockId}/authKey`).set({
    key, expiry: Date.now() + 2 * 60 * 60 * 1000, used: false, emergency: true, createdAt: Date.now()
  });
  logAction("EMERGENCY", lockId);
  toast(`Emergency Key for ${lockId}: ${key}`, "info");
}

// ================= RESET LOCK =================
async function resetLock(lockId) {
  if (!await verifyAdmin()) return;
  if (!confirm(`Reset ${lockId}? It will become available for re-pairing.`)) return;
  await db.ref(`locks/${lockId}`).update({
    pairingStatus: "AVAILABLE", status: "AVAILABLE",
    currentTanker: null, currentCompartment: null,
    physicalState: null, unlockedBy: null
  });
  await db.ref(`locks/${lockId}/authKey`).remove();
  logAction("RESET", lockId);
  toast(`${lockId} reset`, "success");
}

// ================= LOGS =================
async function logAction(action, lockId) {
  await db.ref("logs").push({
    action, lockId,
    user: currentUser?.email || "unknown",
    time: Date.now()
  });
  loadLogs();
}

async function loadLogs() {
  const c = document.getElementById("activityLogs");
  if (!c) return;
  const snap = await db.ref("logs").limitToLast(20).once("value");
  const items = [];
  snap.forEach(s => items.push(s.val()));
  items.reverse();
  if (!items.length) {
    c.innerHTML = `<div class="empty-state" style="padding:30px 10px;"><i class="fas fa-scroll"></i><p>No activity</p></div>`;
    return;
  }
  c.innerHTML = items.map(l => `
    <div class="log-item">
      <div class="log-action ${l.action}">${l.action}</div>
      <div class="log-meta">
        <span style="font-family:var(--font-mono);font-size:10px;">${l.lockId}</span><br>
        <span style="font-size:10px;">${l.user}</span><br>
        <span style="font-size:10px;color:var(--text-dim);">${new Date(l.time).toLocaleTimeString()}</span>
      </div>
    </div>`).join("");
}

// ================= HELPERS =================
function emptyState(icon, msg) {
  return `<div class="empty-state"><i class="fas ${icon}"></i><p>${msg}</p></div>`;
}

// backward compat
function openTankerLive(id) { openTankerDetailPage(id); }
function renderTankerDetails() {}

window.addEventListener("load", () => {});