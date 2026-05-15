// ================= LOAD PAIRED TRUCKS =================
function loadPairedTrucks() {
  const container = document.getElementById("pairedTruckList");
  if (!container) return;

  db.ref("tankers").on("value", snap => {
    let html = "";

    snap.forEach(s => {
      const t = s.val();

      const hasPaired = t.compartments &&
        typeof t.compartments === "object" &&
        Object.values(t.compartments).some(c => c && c.lockId);

      if (!hasPaired) return;

      html += `
        <div class="paired-truck-item" onclick="openPairedTruck('${t.tankerId}')">
          <div style="font-weight:700;font-size:13px;">${t.tankerId}</div>
          <div style="font-size:11px;color:var(--text-muted);">${t.vehicleNumber || ''}</div>
        </div>
      `;
    });

    container.innerHTML = html || `<div class="empty-state" style="padding:30px 10px;"><i class="fas fa-truck"></i><p>No paired trucks</p></div>`;
  });
}

// ================= OPEN TRUCK DETAILS =================
function openPairedTruck(tankerId) {
  const container = document.getElementById("pairedTruckDetails");
  if (!container) return;

  db.ref(`tankers/${tankerId}`).once("value").then(snap => {
    const t = snap.val();

    if (!t?.compartments || typeof t.compartments !== "object") {
      container.innerHTML = `<div class="empty-state"><i class="fas fa-box-open"></i><p>No compartments found</p></div>`;
      return;
    }

    let html = `
      <div style="margin-bottom:16px;">
        <div style="font-size:18px;font-weight:800;color:var(--text-primary);">${tankerId}</div>
        <div style="font-size:12px;color:var(--text-muted);">${t.vehicleNumber || '—'}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;">
    `;

    Object.keys(t.compartments).forEach(compId => {
      const c      = t.compartments[compId] || {};
      const lockId = c.lockId;
      const isPaired = !!lockId;

      let realStatus = isPaired ? "LOCKED" : "UNPAIRED";
      if (lockId && window.lockStatusMap && window.lockStatusMap[lockId]) {
        realStatus = window.lockStatusMap[lockId];
      }

      const statusBadge = isPaired
        ? `<span class="vd-badge badge-green">PAIRED</span>`
        : `<span class="vd-badge badge-gray">UNPAIRED</span>`;

      const actionBtn = isPaired
        ? `<button class="vd-btn vd-btn-amber vd-btn-sm flex-1"
             onclick="unpairLock('${tankerId}','${compId}','${lockId}')">
             <i class="fas fa-unlink"></i> Unpair
           </button>`
        : `<button class="vd-btn vd-btn-green vd-btn-sm flex-1"
             onclick="rePairLock('${tankerId}')">
             <i class="fas fa-link"></i> Pair
           </button>`;

      // Depot / destination geo summary
      const depotName  = c.depot?.name     || "—";
      const destName   = c.destination     || "—";
      const depotCoord = c.depot?.location
        ? `${c.depot.location.latitude?.toFixed(4)}, ${c.depot.location.longitude?.toFixed(4)}`
        : null;
      const destCoord  = c.destinationLocation
        ? `${c.destinationLocation.latitude?.toFixed(4)}, ${c.destinationLocation.longitude?.toFixed(4)}`
        : null;

      html += `
        <div class="comp-card">
          <div class="comp-header">
            <span class="comp-title">Comp ${compId}</span>
            ${statusBadge}
          </div>

          <div class="comp-row"><span class="label">Lock</span><span class="value">${lockId || '—'}</span></div>

          <div class="comp-row">
            <span class="label"><i class="fas fa-warehouse" style="font-size:9px;margin-right:3px;color:#5aa0f0;"></i>Depot</span>
            <span class="value" title="${depotCoord || ''}">${depotName}${depotCoord ? ` <span style="opacity:.6;font-size:9px;">(${depotCoord})</span>` : ''}</span>
          </div>

          <div class="comp-row">
            <span class="label"><i class="fas fa-location-dot" style="font-size:9px;margin-right:3px;color:#22c55e;"></i>Destination</span>
            <span class="value" title="${destCoord || ''}">${destName}${destCoord ? ` <span style="opacity:.6;font-size:9px;">(${destCoord})</span>` : ''}</span>
          </div>

          <div class="comp-row"><span class="label">Status</span><span class="value">${realStatus}</span></div>

          <div class="comp-actions">
            <div class="comp-action-row">
              ${actionBtn}
              <button class="vd-btn vd-btn-red vd-btn-sm flex-1"
                onclick="deletePairing('${tankerId}','${compId}','${lockId || ''}')">
                <i class="fas fa-trash"></i> Delete
              </button>
            </div>
          </div>
        </div>
      `;
    });

    html += `</div>`;
    container.innerHTML = html;
  });
}

// ================= UNPAIR LOCK — soft reset (keeps compartment slot) =================
async function unpairLock(tankerId, compId, lockId) {
  if (!lockId) return toast("No lock assigned to this compartment", "warning");

  const ok = await verifyAdmin();
  if (!ok) return;

  try {
    // ✅ FIX 3: DON'T remove the compartment — reset it to a clean empty slot
    await db.ref(`tankers/${tankerId}/compartments/${compId}`).set({
      lockId:              null,
      destination:         null,
      destinationLocation: null,
      depot:               null,
      status:              "AVAILABLE",
      pairedAt:            null,
      pairedBy:            null
    });

    // Release the lock back to available pool
    await db.ref(`locks/${lockId}`).update({
      pairingStatus:      "AVAILABLE",
      status:             "AVAILABLE",
      currentTanker:      null,
      currentCompartment: null,
      depot:              null,
      destination:        null
    });

    toast("Unpaired successfully — compartment slot kept", "success");
    openPairedTruck(tankerId);
    loadTankerCompartments();

  } catch (e) {
    console.error(e);
    toast("Error while unpairing", "error");
  }
}

// ================= DELETE PAIRING — full remove =================
async function deletePairing(tankerId, compId, lockId) {
  const ok = await verifyAdmin();
  if (!ok) return;

  if (!confirm(`Delete pairing for ${tankerId} / ${compId}? This fully removes the compartment slot.`)) return;

  try {
    await db.ref(`tankers/${tankerId}/compartments/${compId}`).remove();

    if (lockId) {
      await db.ref(`locks/${lockId}`).update({
        pairingStatus:      "AVAILABLE",
        status:             "AVAILABLE",
        currentTanker:      null,
        currentCompartment: null,
        depot:              null,
        destination:        null
      });
    }

    toast("Pairing deleted", "success");
    openPairedTruck(tankerId);
    loadTankerCompartments();

  } catch (e) {
    console.error(e);
    toast("Error while deleting", "error");
  }
}

// ================= RE-PAIR =================
function rePairLock(tankerId) {
  nav("pairing");
  setTimeout(() => {
    const select = document.getElementById("tankerSelect");
    if (!select) return;
    select.value = tankerId;
    loadTankerCompartments();
    const compsContainer = document.getElementById("compartmentsContainer");
    if (compsContainer) compsContainer.scrollIntoView({ behavior: "smooth" });
  }, 300);
}

// ================= LOAD PAIRING DATA (tanker dropdown) =================
async function loadPairingData() {
  try {
    const tankersSnap = await db.ref("tankers").once("value");
    const tankerSel   = document.getElementById("tankerSelect");
    if (!tankerSel) return;
    tankerSel.innerHTML = '<option value="">— Select Tanker —</option>';
    tankersSnap.forEach(s => {
      const t = s.val();
      if (t) tankerSel.appendChild(new Option(`${t.tankerId} — ${t.vehicleNumber}`, t.tankerId));
    });
  } catch (e) {
    console.error("loadPairingData error:", e);
  }
}

// ================= LOAD TANKER COMPARTMENTS =================
async function loadTankerCompartments() {
  const tankerId  = document.getElementById("tankerSelect").value;
  const container = document.getElementById("compartmentsContainer");
  const pairMsg   = document.getElementById("pairMsg");
  container.innerHTML = "";
  if (pairMsg) pairMsg.innerHTML = "";
  if (!tankerId) return;

  const snap   = await db.ref(`tankers/${tankerId}`).once("value");
  const tanker = snap.val();

  let totalCompartments = 0;
  if (tanker?.compartmentsCount)                                            totalCompartments = tanker.compartmentsCount;
  else if (typeof tanker?.compartments === "number")                         totalCompartments = tanker.compartments;
  else if (tanker?.compartments && typeof tanker.compartments === "object")
    totalCompartments = Object.keys(tanker.compartments).length;

  if (!totalCompartments) {
    container.innerHTML = `<p style="color:var(--accent-amber);font-size:12px;">No compartment data found for this tanker.</p>`;
    return;
  }

  const [locksSnap, destSnap] = await Promise.all([
    db.ref("locks").once("value"),
    db.ref("destinations").once("value")
  ]);

  // Available locks (not assigned elsewhere, or already on this tanker)
  window.allLocks = [];
  locksSnap.forEach(s => {
    const l = s.val();
    if (!l.currentTanker || l.currentTanker === tankerId) window.allLocks.push(s.key);
  });

  // Build destinations list with location data stored for lookup
  window.destinationMeta = {}; // id/name → { name, location: { latitude, longitude, radius_meters } }
  destSnap.forEach(s => {
    const d = s.val();
    if (d?.name) window.destinationMeta[d.name] = d;
  });

  // Separate depots from non-depot destinations
  const depotOptions = Object.values(window.destinationMeta)
    .filter(d => d.type === "DEPOT" || d.type === "PORT")
    .map(d => `<option value="${d.name}">${d.name} (${d.type})</option>`)
    .join("");

  const destOptions = Object.values(window.destinationMeta)
    .map(d => `<option value="${d.name}">${d.name} (${d.type})</option>`)
    .join("");

  for (let i = 1; i <= totalCompartments; i++) {
    const compId   = `C${i}`;
    const existing = (tanker.compartments && typeof tanker.compartments === "object")
                     ? (tanker.compartments[compId] || {}) : {};

    const lockOptions = window.allLocks.map(lock =>
      `<option value="${lock}" ${lock === existing.lockId ? "selected" : ""}>${lock}</option>`
    ).join('');

    // Pre-select existing depot and destination
    const selectedDepot = existing.depot?.name || "";
    const selectedDest  = existing.destination  || "";

    const depotSelectHtml = `
      <option value="">— Select Depot —</option>
      ${Object.values(window.destinationMeta)
          .filter(d => d.type === "DEPOT" || d.type === "PORT")
          .map(d => `<option value="${d.name}" ${d.name === selectedDepot ? "selected" : ""}>${d.name} (${d.type})</option>`)
          .join("")}
    `;

    const destSelectHtml = `
      <option value="">— Select Destination —</option>
      ${Object.values(window.destinationMeta)
          .map(d => `<option value="${d.name}" ${d.name === selectedDest ? "selected" : ""}>${d.name} (${d.type})</option>`)
          .join("")}
    `;

    const div = document.createElement("div");
    div.className = "comp-pair-card";
    div.innerHTML = `
      <div class="comp-pair-header">Compartment ${compId}</div>

      <label class="field-label">Lock</label>
      <select class="vd-select lock-select mb-2" data-comp="${compId}" onchange="updateLockOptions()">
        <option value="">Select Lock</option>
        ${lockOptions}
      </select>

      <label class="field-label" style="display:flex;align-items:center;gap:5px;">
        <i class="fas fa-warehouse" style="font-size:10px;color:#5aa0f0;"></i> Depot Station
      </label>
      <select class="vd-select depot-select mb-2" data-comp="${compId}">
        ${depotSelectHtml}
      </select>

      <label class="field-label" style="display:flex;align-items:center;gap:5px;">
        <i class="fas fa-location-dot" style="font-size:10px;color:#22c55e;"></i> Destination Station
      </label>
      <select class="vd-select dest-select" data-comp="${compId}">
        ${destSelectHtml}
      </select>
    `;
    container.appendChild(div);
  }
}

// ================= SAVE ALL PAIRINGS =================
async function saveAllPairings() {
  const tankerId = document.getElementById("tankerSelect").value;
  if (!tankerId) return toast("Please select a tanker", "warning");

  const lockSelects  = document.querySelectorAll(".lock-select");
  const depotSelects = document.querySelectorAll(".depot-select");
  const destSelects  = document.querySelectorAll(".dest-select");

  let success = 0;

  for (let i = 0; i < lockSelects.length; i++) {
    const compId      = lockSelects[i].getAttribute("data-comp");
    const lockId      = lockSelects[i].value;
    const depotName   = depotSelects[i].value;
    const destName    = destSelects[i].value;

    if (!lockId || !destName) continue; // depot optional but destination required

    // ✅ FIX 1+2: fetch full location objects for depot and destination
    const depotMeta = depotName ? (window.destinationMeta[depotName] || null) : null;
    const destMeta  = window.destinationMeta[destName] || null;

    const depotPayload = depotMeta ? {
      name:     depotMeta.name,
      type:     depotMeta.type,
      location: depotMeta.location || null
    } : null;

    const destLocationPayload = destMeta?.location || null;

    try {
      const now = Date.now();

      // Save to tanker compartment
      await db.ref(`tankers/${tankerId}/compartments/${compId}`).set({
        lockId,
        destination:         destName,
        destinationLocation: destLocationPayload,   // ✅ destination coords
        depot:               depotPayload,           // ✅ depot name + coords
        status:              "ASSIGNED",
        pairedAt:            now,
        pairedBy:            currentUser.email
      });

      // Save to lock node — so the lock hardware knows where it is going
      await db.ref(`locks/${lockId}`).update({
        pairingStatus:       "ASSIGNED",
        status:              "UNLOCKED",
        currentTanker:       tankerId,
        currentCompartment:  compId,
        destination:         destName,
        destinationLocation: destLocationPayload,   // ✅ destination coords on lock node
        depot:               depotPayload           // ✅ depot coords on lock node
      });

      success++;
    } catch (err) {
      console.error(err);
      toast(`Error saving ${compId}: ${err.message}`, "error");
    }
  }

  if (success > 0) {
    await db.ref(`tankers/${tankerId}`).update({ status: "ASSIGNED" });
    toast(`${success} compartment(s) paired successfully`, "success");
    loadPairedTrucks();
  } else {
    toast("Select at least one lock + destination", "warning");
  }

  loadTankerCompartments();
}

// ================= PREVENT DUPLICATE LOCK SELECTION =================
function updateLockOptions() {
  const selects  = document.querySelectorAll(".lock-select");
  const selected = [];
  selects.forEach(sel => { if (sel.value) selected.push(sel.value); });
  selects.forEach(sel => {
    const current = sel.value;
    let options   = '<option value="">Select Lock</option>';
    (window.allLocks || []).forEach(lockId => {
      if (!selected.includes(lockId) || lockId === current)
        options += `<option value="${lockId}" ${lockId === current ? "selected" : ""}>${lockId}</option>`;
    });
    sel.innerHTML = options;
  });
}