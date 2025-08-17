const scriptURL = "https://script.google.com/macros/s/AKfycbxo8rvk6x5PGZOImUA5q7pkBC6SouF75YhvQWAIT3vCMxqk1WRvmw9R3WAf1oJcJ2cj/exec";

let scannedQR = { masuk: new Set(), keluar: new Set() };
let scannedPC = { masuk: new Set(), keluar: new Set() };
let isSending = false;
let lastScan = "";
let lastScanTime = 0;

// Queue and state additions
let sendingNow = { masuk: new Set(), keluar: new Set() };
let sendQueue = [];
let isProcessingQueue = false;
let pendingQueue = [];
let logEntries = [];
let html5QrCode = null;
let cameras = [];
let currentCameraId = null;
let isScannerRunning = false;

function playBeep() { document.getElementById("beep-sound").play(); }
function flashSuccess() { document.body.classList.add("highlight"); setTimeout(() => document.body.classList.remove("highlight"), 500); }
function flashError() { document.body.classList.add("error-flash"); setTimeout(() => document.body.classList.remove("error-flash"), 500); }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m])); }

function kirimData(nama, jumlah, petugas, catatan, mode, isQR=false, isPCScanner=false) {
    const cleanNama = (nama || "").trim();
    if (!cleanNama) return;
    if (sendingNow[mode].has(cleanNama)) {
        flashError();
        document.getElementById("msg").innerHTML = `<span class="err">⚠️ ${escapeHtml(cleanNama)} sedang dalam antrian (${mode})</span>`;
        return;
    }
    sendingNow[mode].add(cleanNama);
    const jumlahNum = Math.max(1, parseInt(jumlah, 10) || 1);
    enqueueSend({ nama: cleanNama, jumlah: jumlahNum, petugas: (petugas || "").trim(), catatan: (catatan || "").trim(), mode, isQR, isPCScanner, ts: Date.now() });
}

// Helpers: queue + offline persistence + logs
function updatePendingCount() {
    const el = document.getElementById("pendingCount");
    if (el) el.textContent = String(pendingQueue.length);
}
function loadPendingQueue() { try { return JSON.parse(localStorage.getItem("pendingQueue") || "[]"); } catch(e) { return []; } }
function savePendingQueue() { localStorage.setItem("pendingQueue", JSON.stringify(pendingQueue)); }
function loadLog() { try { return JSON.parse(localStorage.getItem("scanLog") || "[]"); } catch(e) { return []; } }
function saveLog() { localStorage.setItem("scanLog", JSON.stringify(logEntries.slice(-100))); }
function computeCounts() {
    let masuk = 0, keluar = 0;
    for (const e of logEntries) {
        if (e && e.success) {
            if (e.mode === "masuk") masuk++;
            else if (e.mode === "keluar") keluar++;
        }
    }
    return { masuk, keluar };
}
function refreshLogUI() {
    const ul = document.getElementById("logList");
    if (!ul) return;
    ul.innerHTML = "";
    const last = logEntries.slice(-50).reverse();
    for (const item of last) {
        const li = document.createElement("li");
        li.className = item.success ? "ok" : "err";
        const timeStr = new Date(item.ts).toLocaleTimeString();
        li.textContent = `[${timeStr}] ${(item.mode || "-").toUpperCase()} ${item.nama} x${item.jumlah}${item.success ? " ✓" : " ✗"}`;
        ul.appendChild(li);
    }
    const c = computeCounts();
    const masukEl = document.getElementById("countMasuk");
    const keluarEl = document.getElementById("countKeluar");
    if (masukEl) masukEl.textContent = String(c.masuk);
    if (keluarEl) keluarEl.textContent = String(c.keluar);
}
function addLogEntry(entry) { logEntries.push(entry); saveLog(); refreshLogUI(); }

// Robust sender: try POST then GET fallback
async function sendToAppsScript(params, signal) {
    const headers = { "Accept": "application/json, text/plain, */*", "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" };
    const body = new URLSearchParams(params).toString();

    function parseOk(res, text) {
        try { const data = JSON.parse(text); return { ok: res.ok && data && data.status === "OK", message: data && data.message ? data.message : null }; } catch(_) {}
        const t = (text || "").trim();
        if (/\bstatus\b\s*:\s*"?OK"?/i.test(t) || /^OK$/i.test(t)) return { ok: true, message: null };
        return { ok: res.ok && text === "", message: text };
    }

    // Try POST first
    try {
        const res = await fetch(scriptURL, { method: "POST", headers, body, redirect: "follow", signal });
        const text = await res.text();
        const parsed = parseOk(res, text);
        if (parsed.ok) return { ok: true };
        // If clearly method not allowed or not parsed, try GET fallback
    } catch (e) {
        // network error -> fall back to GET
    }

    // GET fallback
    const url = scriptURL + (scriptURL.includes("?") ? "&" : "?") + body;
    const res2 = await fetch(url, { method: "GET", headers: { "Accept": "application/json, text/plain, */*" }, redirect: "follow", signal });
    const text2 = await res2.text();
    const parsed2 = parseOk(res2, text2);
    return { ok: parsed2.ok, message: parsed2.message || text2 };
}

function enqueueSend(payload) { sendQueue.push(payload); processQueue(); }
function processQueue() {
    if (isProcessingQueue || sendQueue.length === 0) return;
    isProcessingQueue = true;
    const item = sendQueue.shift();
    document.getElementById("msg").innerHTML = `📤 Mengirim: ${escapeHtml(item.nama)}...`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    sendToAppsScript({ nama: item.nama, jumlah: item.jumlah, petugas: item.petugas, catatan: item.catatan, mode: item.mode }, controller.signal)
    .then(result => {
        clearTimeout(timeoutId);
        if (result && result.ok) {
            if (document.getElementById("beepToggle")?.checked) playBeep();
            if (document.getElementById("vibrateToggle")?.checked && navigator.vibrate) navigator.vibrate(100);
            flashSuccess();
            document.getElementById("msg").innerHTML = `<span class="ok">✅ ${escapeHtml(item.nama)} (${item.mode}) berhasil</span>`;
            if (item.isQR) scannedQR[item.mode].add(item.nama);
            if (item.isPCScanner) scannedPC[item.mode].add(item.nama);
            const otherMode = item.mode === "masuk" ? "keluar" : "masuk";
            if (item.isQR) scannedQR[otherMode].delete(item.nama);
            if (item.isPCScanner) scannedPC[otherMode].delete(item.nama);
            addLogEntry({ ts: item.ts || Date.now(), mode: item.mode, nama: item.nama, jumlah: item.jumlah, success: true });
        } else {
            flashError();
            const emsg = result && result.message ? result.message : "Tidak diketahui";
            document.getElementById("msg").innerHTML = `<span class="err">❌ Gagal${emsg ? ": " + escapeHtml(emsg) : ""}</span>`;
            pendingQueue.push(item); savePendingQueue(); updatePendingCount();
            addLogEntry({ ts: item.ts || Date.now(), mode: item.mode, nama: item.nama, jumlah: item.jumlah, success: false });
        }
    })
    .catch(err => {
        clearTimeout(timeoutId);
        flashError();
        const emsg = err && err.message ? err.message : String(err);
        document.getElementById("msg").innerHTML = `<span class=\"err\">⚠️ Jaringan error: ${escapeHtml(emsg)}</span>`;
        pendingQueue.push(item); savePendingQueue(); updatePendingCount();
        addLogEntry({ ts: item.ts || Date.now(), mode: item.mode, nama: item.nama, jumlah: item.jumlah, success: false });
    })
    .finally(() => {
        sendingNow[item.mode].delete(item.nama);
        isProcessingQueue = false;
        processQueue();
    });
}
function retryPendingQueue() {
    if (pendingQueue.length === 0) return;
    const toRetry = pendingQueue.splice(0, pendingQueue.length);
    savePendingQueue(); updatePendingCount();
    for (const p of toRetry) {
        if (!sendingNow[p.mode]?.has(p.nama)) sendingNow[p.mode].add(p.nama);
        enqueueSend(p);
    }
}

// Scanner fisik / input manual
let keyBuffer = "";
let keyTimes = [];
const SCANNER_THRESHOLD = 50;

document.getElementById("nama").addEventListener("keypress", function(e) {
    const now = Date.now();
    keyBuffer += e.key;
    keyTimes.push(now);

    if (e.key === "Enter") {
        let nama = keyBuffer.trim();
        if (nama.toLowerCase().endsWith("enter")) {
            nama = nama.slice(0, -5).trim();
        }
        if (!nama) { keyBuffer=""; keyTimes=[]; e.preventDefault(); return; }

        const mode = document.querySelector('input[name="mode"]:checked').value;
        let intervals = [];
        for (let i=1;i<keyTimes.length;i++) intervals.push(keyTimes[i]-keyTimes[i-1]);
        let avgInterval = intervals.length ? intervals.reduce((a,b)=>a+b,0)/intervals.length : 0;

        if (avgInterval < SCANNER_THRESHOLD) {
            if (scannedPC[mode].has(nama) || sendingNow[mode].has(nama)) {
                flashError();
                document.getElementById("msg").innerHTML = `<span class="err">⚠️ ${escapeHtml(nama)} sudah discan/menunggu (${mode})</span>`;
            } else {
                kirimData(nama, document.getElementById("jumlah").value,
                          document.getElementById("petugas").value.trim(),
                          document.getElementById("catatan").value.trim(),
                          mode, false, true);
            }
        } else {
            kirimData(nama, document.getElementById("jumlah").value,
                      document.getElementById("petugas").value.trim(),
                      document.getElementById("catatan").value.trim(),
                      mode, false, false);
        }

        keyBuffer="";
        keyTimes=[];
        document.getElementById("nama").value="";
        e.preventDefault();
    }
});

document.getElementById("btnManual").addEventListener("click", function() {
    const nama = document.getElementById("nama").value.trim();
    if (!nama) return;
    const mode = document.querySelector('input[name="mode"]:checked').value;
    kirimData(nama, document.getElementById("jumlah").value,
              document.getElementById("petugas").value.trim(),
              document.getElementById("catatan").value.trim(),
              mode, false, false);
    document.getElementById("nama").value = "";
});

function onScanSuccess(decodedText) {
    const now = Date.now();
    const mode = document.querySelector('input[name="mode"]:checked').value;
    const text = (decodedText || "").trim();

    if (text === lastScan && (now - lastScanTime) < 2000) return;
    lastScan = text;
    lastScanTime = now;

    if (!text) return;

    if (scannedQR[mode].has(text) || sendingNow[mode].has(text)) {
        flashError();
        document.getElementById("msg").innerHTML = `<span class="err">⚠️ QR ${escapeHtml(text)} sudah discan/menunggu (${mode})</span>`;
        return;
    }

    kirimData(text, document.getElementById("jumlah").value,
              document.getElementById("petugas").value.trim(),
              document.getElementById("catatan").value.trim(),
              mode, true, false);
}

async function startScanner(cameraId) {
    if (!html5QrCode) html5QrCode = new Html5Qrcode("reader");
    if (isScannerRunning) await stopScanner();
    if (!cameraId) return;
    try {
        await html5QrCode.start(cameraId, { fps: 10, qrbox: 200 }, onScanSuccess);
        isScannerRunning = true;
        currentCameraId = cameraId;
        const btn = document.getElementById("toggleScanner");
        if (btn) btn.textContent = "Stop Kamera";
        document.getElementById("msg").textContent = "🔍 Arahkan kamera ke kode...";
    } catch (e) {
        isScannerRunning = false;
        document.getElementById("msg").innerHTML = `<span class=\"err\">⚠️ Kamera gagal dibuka</span>`;
    }
}
async function stopScanner() {
    if (html5QrCode && isScannerRunning) {
        try { await html5QrCode.stop(); await html5QrCode.clear(); } catch(e) {}
        isScannerRunning = false;
    }
}
async function switchCamera(newId) { await startScanner(newId); }
function initCamera() {
    html5QrCode = new Html5Qrcode("reader");
    Html5Qrcode.getCameras().then(cams => {
        cameras = cams || [];
        const select = document.getElementById("cameraSelect");
        if (select && cameras.length) {
            select.innerHTML = "";
            cameras.forEach(cam => {
                const opt = document.createElement("option");
                opt.value = cam.id; opt.textContent = cam.label || cam.id; select.appendChild(opt);
            });
            let back = cameras.find(cam => (cam.label || "").toLowerCase().includes("back") || (cam.label || "").toLowerCase().includes("rear") || (cam.label || "").toLowerCase().includes("environment"));
            currentCameraId = back ? back.id : cameras[cameras.length - 1].id;
            select.value = currentCameraId;
            startScanner(currentCameraId);
            select.addEventListener("change", () => { const id = select.value; switchCamera(id); });
        } else {
            document.getElementById("msg").innerHTML = `<span class="err">⚠️ Kamera tidak ditemukan, gunakan input manual</span>`;
        }
    }).catch(err => {
        document.getElementById("msg").innerHTML = `<span class="err">⚠️ Kamera gagal dibuka, gunakan input manual</span>`;
    });

    const toggleBtn = document.getElementById("toggleScanner");
    if (toggleBtn) {
        toggleBtn.addEventListener("click", async () => {
            if (isScannerRunning) { await stopScanner(); toggleBtn.textContent = "Mulai Kamera"; }
            else { await startScanner(currentCameraId || cameras?.[0]?.id); toggleBtn.textContent = "Stop Kamera"; }
        });
    }
}

function setupApp() {
    // Persist petugas & jumlah
    const petugasInput = document.getElementById("petugas");
    const jumlahInput = document.getElementById("jumlah");
    const savedPetugas = localStorage.getItem("petugas"); if (savedPetugas) petugasInput.value = savedPetugas;
    const savedJumlah = localStorage.getItem("jumlah"); if (savedJumlah) jumlahInput.value = savedJumlah;
    petugasInput.addEventListener("change", () => localStorage.setItem("petugas", petugasInput.value.trim()));
    jumlahInput.addEventListener("change", () => localStorage.setItem("jumlah", jumlahInput.value));

    // +/- jumlah
    const inc = document.getElementById("incJumlah");
    const dec = document.getElementById("decJumlah");
    if (inc) inc.addEventListener("click", () => { const v = parseInt(jumlahInput.value || "1", 10) || 1; jumlahInput.value = v + 1; jumlahInput.dispatchEvent(new Event("change")); });
    if (dec) dec.addEventListener("click", () => { const v = parseInt(jumlahInput.value || "1", 10) || 1; jumlahInput.value = Math.max(1, v - 1); jumlahInput.dispatchEvent(new Event("change")); });

    // Pending queue & log
    pendingQueue = loadPendingQueue(); updatePendingCount();
    logEntries = loadLog(); refreshLogUI();

    const retryBtn = document.getElementById("retryPending"); if (retryBtn) retryBtn.addEventListener("click", retryPendingQueue);
    const clearLogBtn = document.getElementById("clearLog"); if (clearLogBtn) clearLogBtn.addEventListener("click", () => { logEntries = []; saveLog(); refreshLogUI(); });

    // Camera
    initCamera();
}
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupApp);
} else {
    setupApp();
}
