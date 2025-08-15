const scriptURL = "https://script.google.com/macros/s/AKfycbxo8rvk6x5PGZOImUA5q7pkBC6SouF75YhvQWAIT3vCMxqk1WRvmw9R3WAf1oJcJ2cj/exec";

let scannedQR = { masuk: new Set(), keluar: new Set() };
let scannedPC = { masuk: new Set(), keluar: new Set() };
let isSending = false;
let lastScan = "";
let lastScanTime = 0;

function playBeep() { document.getElementById("beep-sound").play(); }
function flashSuccess() { document.body.classList.add("highlight"); setTimeout(() => document.body.classList.remove("highlight"), 500); }
function flashError() { document.body.classList.add("error-flash"); setTimeout(() => document.body.classList.remove("error-flash"), 500); }

function kirimData(nama, jumlah, petugas, catatan, mode, isQR=false, isPCScanner=false) {
    if (isSending) return;
    isSending = true;
    document.getElementById("msg").innerHTML = `📤 Mengirim: ${nama}...`;

    fetch(scriptURL, {
        method: "POST",
        body: new URLSearchParams({ nama, jumlah, petugas, catatan, mode })
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === "OK") {
            playBeep();
            flashSuccess();
            document.getElementById("msg").innerHTML = `<span class="ok">✅ ${nama} (${mode}) berhasil</span>`;
            if (isQR) scannedQR[mode].add(nama);
            if (isPCScanner) scannedPC[mode].add(nama);
            let otherMode = mode === "masuk" ? "keluar" : "masuk";
            if (isQR) scannedQR[otherMode].delete(nama);
            if (isPCScanner) scannedPC[otherMode].delete(nama);
        } else {
            document.getElementById("msg").innerHTML = `<span class="err">❌ Gagal</span>`;
        }
    })
    .catch(err => { document.getElementById("msg").innerHTML = `<span class="err">⚠️ Error: ${err}</span>`; })
    .finally(() => { isSending = false; });
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
            if (scannedPC[mode].has(nama)) {
                flashError();
                document.getElementById("msg").innerHTML = `<span class="err">⚠️ ${nama} sudah discan (${mode})</span>`;
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

    if (decodedText === lastScan && (now - lastScanTime) < 2000) return;
    lastScan = decodedText;
    lastScanTime = now;

    if (scannedQR[mode].has(decodedText)) {
        flashError();
        document.getElementById("msg").innerHTML = `<span class="err">⚠️ QR ${decodedText} sudah discan (${mode})</span>`;
        return;
    }

    kirimData(decodedText, document.getElementById("jumlah").value,
              document.getElementById("petugas").value.trim(),
              document.getElementById("catatan").value.trim(),
              mode, true, false);
}

const html5QrCode = new Html5Qrcode("reader");
Html5Qrcode.getCameras().then(cameras => {
    if (cameras && cameras.length) {
        let backCamera = cameras.find(cam => cam.label.toLowerCase().includes('back') || cam.label.toLowerCase().includes('rear') || cam.label.toLowerCase().includes('environment'));
        let cameraId = backCamera ? backCamera.id : cameras[cameras.length - 1].id;
        html5QrCode.start(cameraId, { fps: 10, qrbox: 200 }, onScanSuccess);
    } else {
        document.getElementById("msg").innerHTML = `<span class="err">⚠️ Kamera tidak ditemukan, gunakan input manual</span>`;
    }
}).catch(err => {
    document.getElementById("msg").innerHTML = `<span class="err">⚠️ Kamera gagal dibuka, gunakan input manual</span>`;
});
