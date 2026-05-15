// ================= FIREBASE CONFIG =================
const firebaseConfig = {
  apiKey: "AIzaSyAwUQCl9DC12BIdjg-zVlkahI-HeMgtknI",
  authDomain: "fueltruck-9fd8b.firebaseapp.com",
  databaseURL: "https://fueltruck-9fd8b-default-rtdb.firebaseio.com",
  projectId: "fueltruck-9fd8b",
  storageBucket: "fueltruck-9fd8b.firebasestorage.app",
  messagingSenderId: "531266663188",
  appId: "1:531266663188:web:b90c1c28c8b780b9d60801"
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db   = firebase.database();
let allLocks    = [];
let currentUser = null;

// ================= DESTINATION MAP =================
// ✅ FIX 1: declared ONCE (was declared twice — caused immediate JS crash)
let destinationMap       = null;
let destinationMarker    = null;
let currentLocationMarker = null;

function initDestinationMap() {
  const mapEl = document.getElementById("destinationMap");
  if (!mapEl) return;

  if (destinationMap) {
    destinationMap.remove();
    destinationMap = null;
  }

  destinationMap = L.map("destinationMap").setView([12.9716, 77.5946], 10);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap"
  }).addTo(destinationMap);

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      position => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        destinationMap.setView([lat, lng], 14);
        currentLocationMarker = L.marker([lat, lng], {
          icon: L.icon({
            iconUrl: "https://cdn-icons-png.flaticon.com/512/684/684908.png",
            iconSize: [32, 32],
            iconAnchor: [16, 32]
          })
        }).addTo(destinationMap);
        currentLocationMarker.bindPopup("Your Current Location");
      },
      err => console.error(err)
    );
  }

  destinationMap.on("click", function (e) {
    setDestinationMarker(e.latlng.lat, e.latlng.lng);
  });
}

function setDestinationMarker(lat, lng) {
  document.getElementById("destLat").value = lat.toFixed(6);
  document.getElementById("destLng").value = lng.toFixed(6);

  if (destinationMarker) destinationMap.removeLayer(destinationMarker);

  destinationMarker = L.marker([lat, lng], {
    icon: L.icon({
      iconUrl: "https://cdn-icons-png.flaticon.com/512/447/447031.png",
      iconSize: [36, 36],
      iconAnchor: [18, 36]
    })
  }).addTo(destinationMap);

  destinationMarker.bindPopup(
    `<b>Selected Destination</b><br>${lat.toFixed(5)}, ${lng.toFixed(5)}`
  ).openPopup();

  destinationMap.setView([lat, lng], 15);
}

async function searchPlace() {
  const query = document.getElementById("placeSearchInput").value.trim();
  if (!query) return toast("Enter location name", "warning");
  try {
    const res  = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
    const data = await res.json();
    if (!data.length) return toast("Location not found", "warning");
    const place = data[0];
    const lat = parseFloat(place.lat);
    const lng = parseFloat(place.lon);
    setDestinationMarker(lat, lng);
    destinationMap.setView([lat, lng], 15);
    toast("Location found", "success");
  } catch (e) {
    console.error(e);
    toast("Search failed", "error");
  }
}

function gotoCurrentLocation() {
  if (!navigator.geolocation) return toast("Geolocation not supported", "error");
  navigator.geolocation.getCurrentPosition(
    position => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      destinationMap.setView([lat, lng], 15);
      setDestinationMarker(lat, lng);
      toast("Current location loaded", "success");
    },
    err => {
      console.error(err);
      toast("Location permission denied", "error");
    }
  );
}

// ================= TOAST =================
function toast(message, type = "info") {
  const icons = {
    success: "fa-circle-check",
    error:   "fa-circle-xmark",
    warning: "fa-triangle-exclamation",
    info:    "fa-circle-info"
  };
  const container = document.getElementById("toast-container");
  const el = document.createElement("div");
  el.className = `toast-item ${type}`;
  el.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i><span>${message}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity   = "0";
    el.style.transform = "translateX(20px)";
    el.style.transition = "0.3s";
    setTimeout(() => el.remove(), 300);
  }, 3500);
}

// ================= AUTH =================
function showMessage(msg) {
  const el = document.getElementById("msg");
  if (el) el.innerText = msg;
}

async function login() {
  const email    = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  if (!email || !password) return showMessage("Please fill all fields");
  try {
    await auth.signInWithEmailAndPassword(email, password);
  } catch (e) {
    showMessage(e.message);
  }
}

async function register() {
  const email    = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  if (!email || !password) return showMessage("Please fill all fields");
  if (password.length < 6)  return showMessage("Password must be at least 6 characters");
  try {
    const res = await auth.createUserWithEmailAndPassword(email, password);
    currentUser = res.user;
    await db.ref("users/" + currentUser.uid).set({ email: currentUser.email });
  } catch (e) {
    showMessage(e.message);
  }
}

// ================= DASHBOARD SHELL =================
function showDash() {
  document.getElementById("auth-panel").classList.add("d-none");
  document.getElementById("dashboard").classList.remove("d-none");

  const email   = currentUser.email;
  const initial = email ? email[0].toUpperCase() : "?";

  document.getElementById("user-info").innerHTML = `
    <div class="user-chip">
      <div class="user-avatar">${initial}</div>
      <div class="user-chip-info">
        <div class="user-email">${email}</div>
        <div class="user-status">● Online</div>
      </div>
    </div>
  `;

  nav("home");
}

const PAGE_TITLES = {
  home:       "Dashboard Overview",
  tanker:     "Tanker Control",
  pairing:    "Pair Locks",
  management: "Fleet Management"
};

// ================= NAVIGATION WITH MOBILE AUTO-CLOSE =================
function nav(pageId) {
  // Close tanker detail page if open
  if (typeof closeTankerDetailPage === "function" && pageId !== "tanker") {
    closeTankerDetailPage();
  }

  // Hide all pages
  document.querySelectorAll(".page").forEach(p => {
    p.classList.remove("active");
  });

  // Show selected page
  const page = document.getElementById(pageId);
  if (page) page.classList.add("active");

  // Update active nav button
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.classList.remove("active");
    if (btn.getAttribute("data-page") === pageId) {
      btn.classList.add("active");
    }
  });

  // Update page title
  const titleEl = document.getElementById("page-title");
  if (titleEl) {
    titleEl.textContent = PAGE_TITLES[pageId] || "VaultDrive";
  }

  // Call page-specific loaders
  if (pageId === "pairing") {
    loadPairingData();
    loadPairedTrucks();
  }
  if (pageId === "management") {
    loadFleetData();
    setTimeout(() => initDestinationMap(), 300);
  }
  if (pageId === "home") loadDashboard();
  if (pageId === "tanker") loadUsedTankers();

  // ================= AUTO CLOSE SIDEBAR ON MOBILE =================
  if (window.innerWidth <= 992) {
    closeSidebar();
  }
}

// ================= SIDEBAR FUNCTIONS =================
function toggleSidebar() {
  const sidebar = document.querySelector(".sidebar");
  if (sidebar) {
    sidebar.classList.toggle("open");
  }
}

function closeSidebar() {
  const sidebar = document.querySelector(".sidebar");
  if (sidebar) {
    sidebar.classList.remove("open");
  }
}



// ================= FLEET MANAGEMENT =================
async function addTanker() {
  const tankerId      = document.getElementById("newTankerId").value.trim().toUpperCase();
  const vehicleNumber = document.getElementById("newVehicleNumber").value.trim().toUpperCase();
  const name          = document.getElementById("newTankerName").value.trim();
  const compartments  = parseInt(document.getElementById("newCompartments").value);

  if (!tankerId || !vehicleNumber || !compartments || isNaN(compartments)) {
    return toast("Tanker ID, Vehicle Number and Compartments are required!", "warning");
  }

  try {
    await db.ref(`tankers/${tankerId}`).set({
      tankerId,
      vehicleNumber,
      name: name || vehicleNumber,
      compartmentsCount: compartments,
      status: "ACTIVE",
      createdAt: Date.now()
    });
    toast("Tanker added successfully!", "success");
    clearInputs();
    loadFleetData();
  } catch (err) {
    toast("Error: " + err.message, "error");
  }
}

async function addLock() {
  const lockId = document.getElementById("newLockId").value.trim().toUpperCase();
  if (!lockId) return toast("Lock ID is required", "warning");
  await db.ref(`locks/${lockId}`).set({ lockId, status: "AVAILABLE", pairingStatus: "AVAILABLE" });
  toast("Lock added!", "success");
  clearInputs();
  loadFleetData();
}

async function addDestination() {
  const name      = document.getElementById("newDestName").value.trim();
  const type      = document.getElementById("newDestType").value;
  const radius    = parseInt(document.getElementById("newDestRadius").value) || 15;
  const latitude  = parseFloat(document.getElementById("destLat").value);
  const longitude = parseFloat(document.getElementById("destLng").value);

  if (!name)                    return toast("Location name required", "warning");
  if (!latitude || !longitude)  return toast("Please select location on map", "warning");

  const id = name.toLowerCase().replace(/\s+/g, "_");

  try {
    await db.ref(`destinations/${id}`).set({
      id, name, type, active: true,
      location: { latitude, longitude, radius_meters: radius },
      createdAt: Date.now(),
      createdBy: currentUser.email
    });

    if (type === "DEPOT") {
      await db.ref("depot").set({ name, location: { latitude, longitude, radius_meters: radius } });
    }

    toast("Location added successfully", "success");
    clearInputs();

    if (destinationMarker) {
      destinationMap.removeLayer(destinationMarker);
      destinationMarker = null;
    }
    document.getElementById("destLat").value = "";
    document.getElementById("destLng").value = "";
    loadFleetData();
  } catch (e) {
    console.error(e);
    toast("Error adding destination", "error");
  }
}

function clearInputs() {
  ["newTankerId","newVehicleNumber","newTankerName","newCompartments",
   "newLockId","newDestName","destLat","destLng"]
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
}

// ================= LOAD FLEET DATA =================
async function loadFleetData() {
  const tableDiv = document.getElementById("fleetTable");
  if (!tableDiv) return;

  try {
    const [tankersSnap, locksSnap] = await Promise.all([
      db.ref("tankers").once("value"),
      db.ref("locks").once("value")
    ]);

    let rows = "";

    tankersSnap.forEach(s => {
      const t = s.val();
      const compCount =
        t.compartmentsCount ||
        (typeof t.compartments === "number"
          ? t.compartments
          : Object.keys(t.compartments || {}).length);

      const badgeClass =
        t.status === "ASSIGNED" ? "badge-green" :
        t.status === "LOCKED"   ? "badge-red"   : "badge-gray";

      rows += `
        <tr>
          <td><span class="vd-badge badge-blue">TANKER</span></td>
          <td class="mono" style="font-size:12px;">${t.tankerId}</td>
          <td>${t.vehicleNumber} &nbsp;·&nbsp; ${compCount} Compartments</td>
          <td><span class="vd-badge ${badgeClass}">${t.status || 'ACTIVE'}</span></td>
        </tr>`;
    });

    locksSnap.forEach(s => {
      const l = s.val();
      const statusBadge =
        l.status === "LOCKED"   ? "badge-red"   :
        l.status === "UNLOCKED" ? "badge-green"  : "badge-gray";
      const pairBadge = l.currentTanker ? "badge-cyan" : "badge-gray";
      rows += `
        <tr>
          <td><span class="vd-badge badge-amber">LOCK</span></td>
          <td class="mono" style="font-size:12px;">${l.lockId}</td>
          <td>${l.currentTanker ? `Tanker: ${l.currentTanker} / ${l.currentCompartment || '—'}` : 'Not Assigned'}</td>
          <td>
            <span class="vd-badge ${statusBadge}">${l.status || 'AVAILABLE'}</span>
            <span class="vd-badge ${pairBadge}" style="margin-left:4px;">${l.currentTanker ? 'ASSIGNED' : 'UNASSIGNED'}</span>
          </td>
        </tr>`;
    });

    tableDiv.innerHTML = rows
      ? `<table class="vd-table">
           <thead><tr><th>Type</th><th>ID</th><th>Details</th><th>Status</th></tr></thead>
           <tbody>${rows}</tbody>
         </table>`
      : `<div class="empty-state"><i class="fas fa-database"></i><p>No fleet data found</p></div>`;

  } catch (e) {
    console.error(e);
    tableDiv.innerHTML = `<div class="empty-state"><i class="fas fa-circle-xmark"></i><p style="color:var(--accent-red)">Error loading data</p></div>`;
  }
}

// ================= PAIRING SYSTEM =================
async function loadPairingData() {
  try {
    const tankersSnap = await db.ref("tankers").once("value");
    const tankerSel = document.getElementById("tankerSelect");
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
  if (tanker?.compartmentsCount)                          totalCompartments = tanker.compartmentsCount;
  else if (typeof tanker?.compartments === "number")       totalCompartments = tanker.compartments;
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

  allLocks = [];
  locksSnap.forEach(s => {
    const l = s.val();
    if (!l.currentTanker || l.currentTanker === tankerId) allLocks.push(s.key);
  });

  let destOptions = '<option value="">Select Destination</option>';
  destSnap.forEach(s => {
    const d = s.val();
    if (d?.name) destOptions += `<option value="${d.name}">${d.name}</option>`;
  });

  for (let i = 1; i <= totalCompartments; i++) {
    const compId   = `C${i}`;
    const existing = (tanker.compartments && typeof tanker.compartments === "object")
                     ? (tanker.compartments[compId] || {}) : {};

    const lockOptions = allLocks.map(lock =>
      `<option value="${lock}" ${lock === existing.lockId ? "selected" : ""}>${lock}</option>`
    ).join('');

    const destWithSelected = destOptions.replace(
      `value="${existing.destination}"`,
      `value="${existing.destination}" selected`
    );

    const div = document.createElement("div");
    div.className = "comp-pair-card";
    div.innerHTML = `
      <div class="comp-pair-header">Compartment ${compId}</div>
      <label class="field-label">Lock</label>
      <select class="vd-select lock-select mb-2" data-comp="${compId}" onchange="updateLockOptions()">
        <option value="">Select Lock</option>
        ${lockOptions}
      </select>
      <label class="field-label">Destination</label>
      <select class="vd-select dest-select" data-comp="${compId}">
        ${destWithSelected}
      </select>
    `;
    container.appendChild(div);
  }
}

async function saveAllPairings() {
  const tankerId = document.getElementById("tankerSelect").value;
  if (!tankerId) return toast("Please select a tanker", "warning");

  const lockSelects = document.querySelectorAll(".lock-select");
  const destSelects = document.querySelectorAll(".dest-select");
  let success = 0;

  for (let i = 0; i < lockSelects.length; i++) {
    const compId      = lockSelects[i].getAttribute("data-comp");
    const lockId      = lockSelects[i].value;
    const destination = destSelects[i].value;
    if (!lockId || !destination) continue;

    try {
      const now = Date.now();
      await db.ref(`tankers/${tankerId}/compartments/${compId}`).set({
        lockId, destination, status: "ASSIGNED",
        pairedAt: now, pairedBy: currentUser.email
      });
      await db.ref(`locks/${lockId}`).update({
        pairingStatus: "ASSIGNED", status: "UNLOCKED",
        currentTanker: tankerId, currentCompartment: compId
      });
      success++;
    } catch (err) {
      console.error(err);
    }
  }

  if (success > 0) {
    await db.ref(`tankers/${tankerId}`).update({ status: "ASSIGNED" });
    toast(`${success} compartment(s) assigned successfully`, "success");
  } else {
    toast("Select at least one lock + destination", "warning");
  }

  loadTankerCompartments();
}

function updateLockOptions() {
  const selects  = document.querySelectorAll(".lock-select");
  const selected = [];
  selects.forEach(sel => { if (sel.value) selected.push(sel.value); });
  selects.forEach(sel => {
    const current = sel.value;
    let options   = '<option value="">Select Lock</option>';
    allLocks.forEach(lockId => {
      if (!selected.includes(lockId) || lockId === current)
        options += `<option value="${lockId}" ${lockId === current ? "selected" : ""}>${lockId}</option>`;
    });
    sel.innerHTML = options;
  });
}

// ================= PAIRED TRUCKS (pairing page) =================
async function loadPairedTrucks() {
  const container = document.getElementById("pairedTruckList");
  if (!container) return;
  const snap = await db.ref("tankers").once("value");
  let html = "";
  snap.forEach(s => {
    const t     = s.val();
    const comps = typeof t.compartments === "object" ? t.compartments : {};
    if (!Object.keys(comps).length) return;
    html += `
      <div class="tanker-item" onclick="showPairedTruckDetails('${t.tankerId}')">
        <div><strong>${t.tankerId}</strong><small>${t.vehicleNumber || ''}</small></div>
        <div><span class="vd-badge badge-green">${Object.keys(comps).length} comps</span></div>
      </div>`;
  });
  container.innerHTML = html || `<div class="empty-state"><p>No paired trucks</p></div>`;
}

async function showPairedTruckDetails(tankerId) {
  const container = document.getElementById("pairedTruckDetails");
  if (!container) return;
  const snap   = await db.ref(`tankers/${tankerId}`).once("value");
  const tanker = snap.val();
  if (!tanker) return;
  const comps = typeof tanker.compartments === "object" ? tanker.compartments : {};
  let html = `<div style="font-weight:700;margin-bottom:10px;">${tankerId} — ${tanker.vehicleNumber}</div>`;
  Object.entries(comps).forEach(([compId, c]) => {
    html += `
      <div class="comp-pair-card" style="margin-bottom:8px;">
        <div class="comp-pair-header">${compId}</div>
        <div style="font-size:12px;">Lock: <b>${c.lockId || '—'}</b></div>
        <div style="font-size:12px;">Dest: ${c.destination || '—'}</div>
        <div style="font-size:11px;color:var(--text-muted);">Status: ${c.status || '—'}</div>
      </div>`;
  });
  container.innerHTML = html;
}

// ================= LOGOUT =================
async function logout() {
  await auth.signOut();
  document.getElementById("dashboard").classList.add("d-none");
  document.getElementById("auth-panel").classList.remove("d-none");
}

// ================= AUTH STATE =================
auth.onAuthStateChanged(user => {
  if (user) {
    currentUser = user;
    showDash();
  }
});

// ================= DASHBOARD =================
// ✅ FIX 2: only ONE loadDashboard function (was declared twice — second one silently replaced the first)
async function loadDashboard() {
  try {
    const [tankersSnap, locksSnap] = await Promise.all([
      db.ref("tankers").once("value"),
      db.ref("locks").once("value")
    ]);

    let totalTankers = 0, tankersInUse = 0;
    let activePairings = 0;

    tankersSnap.forEach(s => {
      const t = s.val();
      totalTankers++;
      const hasAssignments = t.compartments &&
        Object.values(t.compartments).some(c => c.lockId);
      if (hasAssignments) tankersInUse++;
      if (t.compartments) {
        Object.values(t.compartments).forEach(c => { if (c.lockId) activePairings++; });
      }
    });

    let totalLocks = 0, locksInUse = 0, locksAvailable = 0;
    locksSnap.forEach(s => {
      const l = s.val();
      totalLocks++;
      if (l.currentTanker) locksInUse++;
      else locksAvailable++;
    });

    const tankersAvailable = totalTankers - tankersInUse;

    document.getElementById("totalTankers").innerText     = totalTankers;
    document.getElementById("tankersInUse").innerText     = tankersInUse;
    document.getElementById("tankersAvailable").innerText = tankersAvailable;
    document.getElementById("totalLocks").innerText       = totalLocks;
    document.getElementById("locksInUse").innerText       = locksInUse;
    document.getElementById("locksAvailable").innerText   = locksAvailable;
    document.getElementById("activePairings").innerText   = activePairings;
    document.getElementById("expiredKeys").innerText      = 0;

    loadDashboardPairings();
  } catch (e) {
    console.error("Dashboard error:", e);
  }
}

async function loadDashboardPairings() {
  const container = document.getElementById("dashboardPairings");
  if (!container) return;

  try {
    const snap = await db.ref("tankers").once("value");
    let data = [];
    snap.forEach(s => {
      const t = s.val();
      if (t.compartments) {
        Object.entries(t.compartments).forEach(([compId, c]) => {
          if (c.lockId) data.push({
            tankerId: t.tankerId, compartment: compId,
            lockId: c.lockId, destination: c.destination, status: c.status
          });
        });
      }
    });

    if (!data.length) {
      container.innerHTML = `<div class="empty-state"><p>No pairings found</p></div>`;
      return;
    }

    data = data.slice(-5).reverse();
    const rows = data.map(p => `
      <tr>
        <td class="mono">${p.tankerId}</td>
        <td>${p.compartment}</td>
        <td class="mono">${p.lockId}</td>
        <td>${p.destination}</td>
        <td><span class="vd-badge badge-green">${p.status || 'ASSIGNED'}</span></td>
      </tr>`).join('');

    container.innerHTML = `
      <table class="vd-table">
        <thead><tr><th>Tanker</th><th>Compartment</th><th>Lock</th><th>Destination</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch (e) {
    console.error(e);
    container.innerHTML = `<p style="color:red;">Error loading pairings</p>`;
  }
}