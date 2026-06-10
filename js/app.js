// ============================================================
// PRICESCOUT — Community Price Tracker
// ============================================================

// ── STATE ──────────────────────────────────────────────────

const state = {
  scannedCode: null,
  product: null,
  userLat: null,
  userLng: null,
  userCity: null,
  radiusKm: 25,
  cameraStream: null,
  barcodeDetector: null,
  userToken: getUserToken()
};

function getUserToken() {
  let token = localStorage.getItem('ps_token');
  if (!token) {
    token = 'u_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('ps_token', token);
  }
  return token;
}

// ── SCREENS ────────────────────────────────────────────────

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`screen-${name}`).classList.add('active');
}

// ── TOAST ──────────────────────────────────────────────────

let toastTimer = null;
function showToast(msg, duration = 3000) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), duration);
}

// ── CAMERA / SCANNING ──────────────────────────────────────

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    state.cameraStream = stream;
    const video = document.getElementById('cameraFeed');
    video.srcObject = stream;
    video.classList.add('active');
    const idle = document.getElementById('scannerIdle');
    if (idle) idle.style.display = 'none';

    if ('BarcodeDetector' in window) {
      state.barcodeDetector = new BarcodeDetector({
        formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'qr_code']
      });
      scanLoop(video);
      showToast('Point at a barcode');
    } else {
      showToast('Camera active — use manual entry for best results');
    }
  } catch (err) {
    showToast('Camera access denied — use manual entry');
  }
}

function stopCamera() {
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach(t => t.stop());
    state.cameraStream = null;
  }
  const video = document.getElementById('cameraFeed');
  video.classList.remove('active');
  const idle = document.getElementById('scannerIdle');
  if (idle) idle.style.display = '';
}

async function scanLoop(video) {
  if (!state.barcodeDetector || !state.cameraStream) return;
  try {
    const barcodes = await state.barcodeDetector.detect(video);
    if (barcodes.length > 0) {
      stopCamera();
      handleCode(barcodes[0].rawValue);
      return;
    }
  } catch (e) {}
  if (state.cameraStream) requestAnimationFrame(() => scanLoop(video));
}

// ── CODE HANDLING ──────────────────────────────────────────

async function handleCode(code) {
  if (!code || !code.trim()) { showToast('Enter a barcode or model number'); return; }
  code = code.trim();
  state.scannedCode = code;

  // Go straight to results, look up product in background
  showScreen('results');
  document.getElementById('resultsProductName').textContent = 'Looking up product...';
  document.getElementById('resultsMeta').textContent = code;
  document.getElementById('resultsList').innerHTML = `<div class="loading-state"><div class="spinner"></div><div class="loading-text">Looking up prices...</div></div>`;

  // Detect location and look up product in parallel
  const [product] = await Promise.all([
    lookupProduct(code).catch(() => ({ title: code, brand: '', images: [] })),
    detectLocationSilent()
  ]);

  state.product = product;

  document.getElementById('resultsProductName').textContent = product.title || code;
  document.getElementById('resultsMeta').textContent = product.brand || '';

  // Load community prices
  loadPrices();
}

// ── PRODUCT LOOKUP ─────────────────────────────────────────

async function lookupProduct(code) {
  const res = await fetch(`/.netlify/functions/lookup?code=${encodeURIComponent(code)}`);
  if (!res.ok) throw new Error('Lookup failed');
  const data = await res.json();
  const isBarcode = /^\d{6,14}$/.test(code);
  const items = data.items || [];
  if (items.length > 0) {
    const item = items[0];
    return {
      title: item.title,
      brand: item.brand,
      images: item.images || [],
      category: item.category,
      searchQuery: item.title || code
    };
  }
  throw new Error('Not found');
}

// ── LOCATION ───────────────────────────────────────────────

async function detectLocationSilent() {
  return new Promise(resolve => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        state.userLat = pos.coords.latitude;
        state.userLng = pos.coords.longitude;
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${state.userLat}&lon=${state.userLng}&format=json`);
          const data = await res.json();
          state.userCity = data.address?.city || data.address?.town || data.address?.village || '';
          document.getElementById('locationLabel').textContent = state.userCity || 'Location detected';
        } catch (e) {
          document.getElementById('locationLabel').textContent = 'Location detected';
        }
        resolve(pos);
      },
      () => {
        document.getElementById('locationLabel').textContent = 'Location unavailable';
        resolve(null);
      },
      { timeout: 8000 }
    );
  });
}

async function detectLocationForReport() {
  const btn = document.getElementById('btnDetectReport');
  btn.textContent = 'Detecting...';
  btn.disabled = true;

  return new Promise(resolve => {
    if (!navigator.geolocation) {
      showToast('Geolocation not available');
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg> Detect`;
      btn.disabled = false;
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        state.userLat = pos.coords.latitude;
        state.userLng = pos.coords.longitude;
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${state.userLat}&lon=${state.userLng}&format=json`);
          const data = await res.json();
          const city = data.address?.city || data.address?.town || data.address?.village || '';
          if (city) {
            document.getElementById('reportCity').value = city;
            showToast(`Location set to ${city}`);
          }
        } catch (e) {}
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg> Detect`;
        btn.disabled = false;
        resolve(pos);
      },
      () => {
        showToast('Location denied — enter city manually');
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg> Detect`;
        btn.disabled = false;
        resolve(null);
      }
    );
  });
}

// ── LOAD COMMUNITY PRICES ──────────────────────────────────

async function loadPrices() {
  if (!state.scannedCode) return;

  const list = document.getElementById('resultsList');
  list.innerHTML = `<div class="loading-state"><div class="spinner"></div><div class="loading-text">Looking up prices...</div></div>`;

  try {
    const params = new URLSearchParams({
      barcode: state.scannedCode,
      radius_km: state.radiusKm
    });
    if (state.userLat) params.set('lat', state.userLat);
    if (state.userLng) params.set('lng', state.userLng);

    const res = await fetch(`/.netlify/functions/get-prices?${params}`);
    if (!res.ok) throw new Error('Failed');
    const data = await res.json();
    renderResults(data.results || []);
  } catch (e) {
    renderResults([]);
  }
}

// ── RENDER RESULTS ─────────────────────────────────────────

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function renderResults(results) {
  const list = document.getElementById('resultsList');

  if (results.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📍</div>
        <div class="empty-title">No prices reported yet</div>
        <div class="empty-body">Be the first to report a price for this product in your area. Every report helps other shoppers nearby.</div>
        <button class="empty-cta" id="emptyCta">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Report the first price
        </button>
      </div>`;
    document.getElementById('emptyCta')?.addEventListener('click', openReportScreen);
    return;
  }

  const lowestPrice = Math.min(...results.map(r => r.price));

  list.innerHTML = `<div class="results-count">${results.length} PRICE${results.length !== 1 ? 'S' : ''} REPORTED</div>`;

  results.forEach(r => {
    const isBest = r.price === lowestPrice;
    const initial = (r.store_name || '?').charAt(0).toUpperCase();
    const locationText = r.city ? r.city : 'Unknown location';
    const age = timeAgo(r.created_at);

    const card = document.createElement('div');
    card.className = `result-card${isBest ? ' best-price' : ''}`;
    card.innerHTML = `
      ${isBest ? '<div class="best-badge">Best price</div>' : ''}
      <div class="result-store-initial">${initial}</div>
      <div class="result-info">
        <div class="result-store">${r.store_name}</div>
        <div class="result-location">${locationText}</div>
        <div class="result-age">${age}</div>
      </div>
      <div class="result-right">
        <div class="result-price${isBest ? ' best' : ''}">$${parseFloat(r.price).toFixed(2)}</div>
        <div style="font-size:10px;color:var(--text-dim);margin-top:3px;">${r.currency || 'CAD'}</div>
      </div>
      <button class="flag-btn" data-id="${r.id}" title="Flag as outdated">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
      </button>
    `;

    card.querySelector('.flag-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      flagReport(r.id);
    });

    list.appendChild(card);
  });
}

// ── FLAG REPORT ────────────────────────────────────────────

async function flagReport(id) {
  try {
    await fetch(`/.netlify/functions/flag-report?id=${id}`, { method: 'POST' });
    showToast('Flagged as outdated — thanks');
  } catch (e) {
    showToast('Could not flag report');
  }
}

// ── OPEN REPORT SCREEN ─────────────────────────────────────

function openReportScreen() {
  const product = state.product || {};

  document.getElementById('reportProductName').textContent = product.title || state.scannedCode || '';
  document.getElementById('reportProductBrand').textContent = product.brand || '';

  const imgWrap = document.getElementById('reportProductImage');
  if (product.images && product.images.length > 0) {
    imgWrap.innerHTML = `<img src="${product.images[0]}" alt="" onerror="this.style.display='none'">`;
  }

  // Pre-fill city if we already have it
  if (state.userCity) {
    document.getElementById('reportCity').value = state.userCity;
  }

  document.getElementById('reportStore').value = '';
  document.getElementById('reportPrice').value = '';

  showScreen('report');
}

// ── SUBMIT REPORT ──────────────────────────────────────────

async function submitReport() {
  const store = document.getElementById('reportStore').value.trim();
  const priceVal = document.getElementById('reportPrice').value.trim();
  const city = document.getElementById('reportCity').value.trim();

  if (!store) { showToast('Enter the store name'); return; }
  if (!priceVal || isNaN(parseFloat(priceVal))) { showToast('Enter a valid price'); return; }
  if (!city) { showToast('Enter your city'); return; }

  const btn = document.getElementById('btnSubmitReport');
  btn.disabled = true;
  btn.textContent = 'Submitting...';

  try {
    const body = {
      barcode: state.scannedCode,
      product_name: state.product?.title || state.scannedCode,
      product_brand: state.product?.brand || '',
      store_name: store,
      price: parseFloat(priceVal),
      currency: 'CAD',
      city: city,
      lat: state.userLat,
      lng: state.userLng,
      user_token: state.userToken
    };

    const res = await fetch('/.netlify/functions/submit-price', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) throw new Error('Submit failed');

    showToast('Price reported — thank you!');
    showScreen('results');
    loadPrices();

  } catch (e) {
    showToast('Could not submit — try again');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Submit price';
  }
}

// ── EVENT LISTENERS ────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {

  // Scan screen
  document.getElementById('btnStartCamera').addEventListener('click', startCamera);
  document.getElementById('btnManualSearch').addEventListener('click', () => handleCode(document.getElementById('manualCode').value));
  document.getElementById('manualCode').addEventListener('keydown', e => { if (e.key === 'Enter') handleCode(document.getElementById('manualCode').value); });

  // Results screen
  document.getElementById('btnBackToScan').addEventListener('click', () => { stopCamera(); showScreen('scan'); });
  document.getElementById('btnNewScan').addEventListener('click', () => {
    state.scannedCode = null;
    state.product = null;
    document.getElementById('manualCode').value = '';
    showScreen('scan');
  });
  document.getElementById('btnReport').addEventListener('click', openReportScreen);

  document.querySelectorAll('.radius-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.radius-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.radiusKm = parseInt(btn.dataset.km);
      if (state.scannedCode) loadPrices();
    });
  });

  // Report screen
  document.getElementById('btnBackToResults').addEventListener('click', () => showScreen('results'));
  document.getElementById('btnDetectReport').addEventListener('click', detectLocationForReport);
  document.getElementById('btnSubmitReport').addEventListener('click', submitReport);

});

// ── SERVICE WORKER ─────────────────────────────────────────

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
