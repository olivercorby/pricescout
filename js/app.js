// ============================================================
// PRICESCOUT — Community Price Tracker with Auth
// ============================================================

// ── SESSION ────────────────────────────────────────────────

const session = {
  user: null,

  load() {
    try {
      const stored = localStorage.getItem('ps_session');
      if (stored) this.user = JSON.parse(stored);
    } catch (e) { this.user = null; }
  },

  save(user) {
    this.user = user;
    localStorage.setItem('ps_session', JSON.stringify(user));
  },

  clear() {
    this.user = null;
    localStorage.removeItem('ps_session');
  },

  isLoggedIn() {
    return !!this.user?.id;
  }
};

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
  pendingEmail: null
};

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


// ── AUTOCOMPLETE ────────────────────────────────────────────

function setupAutocomplete(inputId, listId, items, onSelect) {
  const input = document.getElementById(inputId);
  const list = document.getElementById(listId);
  if (!input || !list) return;

  input.addEventListener('input', () => {
    const val = input.value.trim().toLowerCase();
    list.innerHTML = '';
    if (val.length < 1) { list.style.display = 'none'; return; }

    const matches = items.filter(i => i.toLowerCase().startsWith(val)).slice(0, 8);
    if (matches.length === 0) { list.style.display = 'none'; return; }

    matches.forEach(m => {
      const item = document.createElement('div');
      item.className = 'autocomplete-item';
      item.textContent = m;
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        input.value = m;
        list.style.display = 'none';
        if (onSelect) onSelect(m);
      });
      list.appendChild(item);
    });

    list.style.display = 'block';
  });

  input.addEventListener('blur', () => {
    setTimeout(() => { list.style.display = 'none'; }, 150);
  });

  input.addEventListener('focus', () => {
    if (input.value.trim().length > 0) input.dispatchEvent(new Event('input'));
  });
}

// ── AUTH ───────────────────────────────────────────────────

async function sendCode() {
  const email = document.getElementById('loginEmail').value.trim().toLowerCase();
  if (!email || !email.includes('@')) { showToast('Enter a valid email'); return; }

  const btn = document.getElementById('btnSendCode');
  btn.disabled = true;
  btn.textContent = 'Sending...';

  try {
    const res = await fetch('/.netlify/functions/send-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to send code');

    state.pendingEmail = email;
    document.getElementById('verifySub').textContent = `We sent a 6-digit code to ${email}`;
    document.getElementById('verifyCode').value = '';
    showScreen('verify');
    setTimeout(() => document.getElementById('verifyCode').focus(), 300);

  } catch (e) {
    showToast(e.message || 'Could not send code — try again');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Continue';
  }
}

async function verifyCode() {
  const code = document.getElementById('verifyCode').value.trim();
  if (code.length !== 6) { showToast('Enter the 6-digit code'); return; }
  if (!state.pendingEmail) { showScreen('login'); return; }

  const btn = document.getElementById('btnVerifyCode');
  btn.disabled = true;
  btn.textContent = 'Verifying...';
  btn.style.opacity = '0.6';

  try {
    const res = await fetch('/.netlify/functions/verify-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: state.pendingEmail, code })
    });

    const data = await res.json();

    if (res.status === 401) { showToast('Invalid or expired code'); return; }
    if (!res.ok) throw new Error(data.error || 'Verification failed');

    session.save(data.user);
    // Show onboarding for first-time users
    const isNew = !localStorage.getItem('ps_onboarded');
    if (isNew) {
      showScreen('onboard');
    } else {
      showToast(`Welcome back${data.user.email ? ', ' + data.user.email.split('@')[0] : ''}!`);
      showScreen('scan');
    }

  } catch (e) {
    showToast(e.message || 'Could not verify — try again');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign in';
    btn.style.opacity = '';
  }
}

async function resendCode() {
  if (!state.pendingEmail) { showScreen('login'); return; }
  document.getElementById('loginEmail').value = state.pendingEmail;
  await sendCode();
}

function signOut() {
  session.clear();
  state.scannedCode = null;
  state.product = null;
  showScreen('login');
  showToast('Signed out');
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

  // Reset product state on every new scan
  state.scannedCode = code;
  state.product = null;

  showScreen('results');
  document.getElementById('resultsProductName').textContent = 'Looking up product...';
  document.getElementById('resultsMeta').textContent = '';
  document.getElementById('resultsList').innerHTML = `<div class="loading-state"><div class="spinner"></div><div class="loading-text">Looking up prices...</div></div>`;

  // Run lookup and location in parallel
  const [product] = await Promise.all([
    lookupProduct(code).catch(() => null),
    detectLocationSilent()
  ]);

  if (product && product.title) {
    state.product = product;
    document.getElementById('resultsProductName').textContent = product.title;
    document.getElementById('resultsMeta').textContent = product.brand || '';
  } else {
    // Fallback — show the barcode/code but keep looking
    state.product = { title: code, brand: '', images: [] };
    document.getElementById('resultsProductName').textContent = code;
    document.getElementById('resultsMeta').textContent = 'Product details unavailable';
  }

  loadPrices();
}

// ── PRODUCT LOOKUP ─────────────────────────────────────────

async function lookupProduct(code) {
  const res = await fetch(`/.netlify/functions/lookup?code=${encodeURIComponent(code)}`);
  if (!res.ok) throw new Error('Lookup failed');
  const data = await res.json();
  const items = data.items || [];
  if (items.length > 0) {
    const item = items[0];
    return { title: item.title, brand: item.brand, images: item.images || [], category: item.category, searchQuery: item.title || code };
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
      () => { document.getElementById('locationLabel').textContent = 'Location unavailable'; resolve(null); },
      { timeout: 8000 }
    );
  });
}

async function detectLocationForReport() {
  const btn = document.getElementById('btnDetectReport');
  const originalHTML = btn.innerHTML;
  btn.textContent = 'Detecting...';
  btn.disabled = true;

  return new Promise(resolve => {
    if (!navigator.geolocation) {
      showToast('Geolocation not available');
      btn.innerHTML = originalHTML;
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
          if (city) { document.getElementById('reportCity').value = city; showToast(`Location set to ${city}`); }
        } catch (e) {}
        btn.innerHTML = originalHTML;
        btn.disabled = false;
        resolve(pos);
      },
      () => {
        showToast('Location denied — enter city manually');
        btn.innerHTML = originalHTML;
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
    const params = new URLSearchParams({ barcode: state.scannedCode, radius_km: state.radiusKm });
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
    const age = timeAgo(r.created_at);

    const card = document.createElement('div');
    card.className = `result-card${isBest ? ' best-price' : ''}`;
    card.innerHTML = `
      ${isBest ? '<div class="best-badge">Best price</div>' : ''}
      <div class="result-store-initial">${initial}</div>
      <div class="result-info">
        <div class="result-store">${r.store_name}</div>
        <div class="result-location">${r.city || 'Unknown location'}</div>
        <div class="result-age">${age}</div>
      </div>
      <div class="result-right">
        <div class="result-price${isBest ? ' best' : ''}">$${parseFloat(r.price).toFixed(2)}</div>
        <div style="font-size:10px;color:var(--text-dim);margin-top:3px;">${r.currency || 'CAD'}</div>
      </div>
      <button class="flag-btn" data-id="${r.id}" title="Flag as outdated">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
      </button>`;

    card.querySelector('.flag-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      flagReport(r.id, card, r.price);
    });

    list.appendChild(card);
  });
}


// ── UNDO TOAST ─────────────────────────────────────────────

let undoTimer = null;
let undoEl = null;

function showUndoToast(msg, reportId) {
  if (!undoEl) {
    undoEl = document.createElement('div');
    undoEl.className = 'undo-toast';
    undoEl.innerHTML = `<span id="undoMsg"></span><button class="undo-btn" id="undoBtn">Undo</button>`;
    document.body.appendChild(undoEl);
  }

  document.getElementById('undoMsg').textContent = msg;
  undoEl.classList.add('visible');
  clearTimeout(undoTimer);

  document.getElementById('undoBtn').onclick = async () => {
    undoEl.classList.remove('visible');
    if (reportId) {
      try {
        await fetch(`/.netlify/functions/delete-report?id=${reportId}`, { method: 'DELETE' });
        loadPrices();
        showToast('Report removed');
      } catch (e) {
        showToast('Could not undo');
      }
    }
  };

  undoTimer = setTimeout(() => undoEl.classList.remove('visible'), 5000);
}

// ── FLAG REPORT ────────────────────────────────────────────

async function flagReport(id, cardEl, currentPrice) {
  try {
    const res = await fetch('/.netlify/functions/flag-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    const data = await res.json();

    if (data.hidden) {
      cardEl.style.transition = 'opacity 0.3s, transform 0.3s';
      cardEl.style.opacity = '0';
      cardEl.style.transform = 'translateX(10px)';
      setTimeout(() => cardEl.remove(), 300);
      showToast('Price removed — thanks for keeping it accurate');
    } else {
      showToast(`Flagged as outdated (${data.flags}/3)`);
      const btn = cardEl.querySelector('.flag-btn');
      if (btn) btn.style.color = 'var(--text-primary)';

      // Show price suggestion form if not already showing
      if (!cardEl.querySelector('.flag-notice')) {
        showFlagNotice(id, cardEl, currentPrice, data.flags);
      }
    }
  } catch (e) {
    showToast('Could not flag report');
  }
}

async function showFlagNotice(id, cardEl, currentPrice, flagCount) {
  // Check if there's already a suggestion
  let existing = null;
  try {
    const res = await fetch(`/.netlify/functions/flag-report?id=${id}`);
    const data = await res.json();
    existing = data.suggestion;
  } catch (e) {}

  const notice = document.createElement('div');

  if (existing) {
    const needed = 3 - existing.confirmations;
    notice.className = 'flag-notice';
    notice.innerHTML = `
      <div class="flag-notice-title">Price flagged (${flagCount}/3)</div>
      <div class="flag-notice-body">Someone suggested $${parseFloat(existing.suggested_price).toFixed(2)} CAD as the current price. Needs ${needed} more confirmation${needed !== 1 ? 's' : ''} to update.</div>
      <button class="btn-confirm-price" data-id="${id}" data-price="${existing.suggested_price}">
        ✓ Confirm $${parseFloat(existing.suggested_price).toFixed(2)}
      </button>`;

    notice.querySelector('.btn-confirm-price').addEventListener('click', async (e) => {
      await confirmSuggestedPrice(id, existing.suggested_price, cardEl);
    });
  } else {
    notice.className = 'flag-notice';
    notice.innerHTML = `
      <div class="flag-notice-title">Price flagged (${flagCount}/3)</div>
      <div class="flag-notice-body">What's the current price? Your suggestion needs 2 more confirmations to update.</div>
      <div class="suggest-price-row">
        <div class="suggest-price-wrap">
          <span class="suggest-price-symbol">$</span>
          <input class="suggest-price-input" type="number" placeholder="0.00" step="0.01" min="0" />
        </div>
        <button class="btn-suggest">Suggest</button>
      </div>`;

    notice.querySelector('.btn-suggest').addEventListener('click', async () => {
      const input = notice.querySelector('.suggest-price-input');
      const price = parseFloat(input.value);
      if (!price || price <= 0) { showToast('Enter a valid price'); return; }
      await submitPriceSuggestion(id, price, cardEl, notice);
    });
  }

  cardEl.parentNode.insertBefore(notice, cardEl.nextSibling);
}

async function submitPriceSuggestion(id, price, cardEl, noticeEl) {
  if (!session.isLoggedIn()) { showToast('Sign in to suggest prices'); return; }

  try {
    const res = await fetch('/.netlify/functions/flag-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, suggested_price: price, user_id: session.user.id, action: 'confirm' })
    });
    const data = await res.json();

    if (data.price_updated) {
      showToast(`Price updated to $${parseFloat(price).toFixed(2)}`);
      loadPrices();
    } else {
      noticeEl.innerHTML = `
        <div class="flag-notice-title">Suggestion submitted</div>
        <div class="flag-notice-body">$${parseFloat(price).toFixed(2)} suggested. Needs ${data.needed} more confirmation${data.needed !== 1 ? 's' : ''} to update.</div>`;
      showToast('Price suggestion submitted — thanks!');
    }
  } catch (e) {
    showToast('Could not submit suggestion');
  }
}

async function confirmSuggestedPrice(id, price, cardEl) {
  if (!session.isLoggedIn()) { showToast('Sign in to confirm prices'); return; }

  try {
    const res = await fetch('/.netlify/functions/flag-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, suggested_price: price, user_id: session.user.id, action: 'confirm' })
    });
    const data = await res.json();

    if (data.price_updated) {
      showToast(`Price updated to $${parseFloat(price).toFixed(2)}`);
      loadPrices();
    } else {
      showToast(`Confirmed — needs ${data.needed} more confirmation${data.needed !== 1 ? 's' : ''}`);
    }
  } catch (e) {
    showToast('Could not confirm price');
  }
}

// ── REPORT SCREEN ──────────────────────────────────────────

function openReportScreen() {
  const product = state.product || {};
  document.getElementById('reportProductName').textContent = product.title || state.scannedCode || '';
  document.getElementById('reportProductBrand').textContent = product.brand || '';

  const imgWrap = document.getElementById('reportProductImage');
  if (product.images?.length > 0) {
    imgWrap.innerHTML = `<img src="${product.images[0]}" alt="" onerror="this.style.display='none'">`;
  }

  if (state.userCity) document.getElementById('reportCity').value = state.userCity;
  document.getElementById('reportStore').value = '';
  document.getElementById('reportPrice').value = '';
  showScreen('report');
}

async function submitReport() {
  const store = document.getElementById('reportStore').value.trim();
  const priceVal = document.getElementById('reportPrice').value.trim();
  const city = document.getElementById('reportCity').value.trim();

  if (!store) { showToast('Enter the store name'); return; }
  if (!priceVal || isNaN(parseFloat(priceVal))) { showToast('Enter a valid price'); return; }
  if (!city) { showToast('Enter your city'); return; }
  if (!session.isLoggedIn()) { showToast('Please sign in to report prices'); showScreen('login'); return; }

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
      city,
      lat: state.userLat,
      lng: state.userLng,
      user_id: session.user.id
    };

    const res = await fetch('/.netlify/functions/submit-price', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (res.status === 429) { showToast('You already reported this store today'); return; }
    if (!res.ok) throw new Error('Submit failed');

    const reportData = await res.json();
    showScreen('results');
    loadPrices();
    showUndoToast('Price reported — thank you!', reportData.id);

  } catch (e) {
    showToast('Could not submit — try again');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Submit price';
  }
}

// ── ACCOUNT SCREEN ─────────────────────────────────────────

async function openAccountScreen() {
  if (!session.isLoggedIn()) { showScreen('login'); return; }

  const user = session.user;
  const initial = user.email.charAt(0).toUpperCase();
  document.getElementById('accountAvatar').textContent = initial;
  document.getElementById('accountEmail').textContent = user.email;

  const joined = new Date(user.created_at);
  document.getElementById('accountSince').textContent = `Member since ${joined.toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })}`;

  // Load report count
  try {
    const res = await fetch(`/.netlify/functions/user-stats?user_id=${user.id}`);
    const data = await res.json();
    document.getElementById('statReports').textContent = data.count || 0;
  } catch (e) {
    document.getElementById('statReports').textContent = '0';
  }

  showScreen('account');
}

// ── INIT ───────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  session.load();

  // Start on correct screen
  if (session.isLoggedIn()) {
    const onboarded = localStorage.getItem('ps_onboarded');
    showScreen(onboarded ? 'scan' : 'onboard');
  } else {
    showScreen('login');
  }

  // Onboarding
  document.getElementById('btnStartScanning')?.addEventListener('click', () => {
    localStorage.setItem('ps_onboarded', '1');
    showScreen('scan');
  });

  // Autocomplete
  setupAutocomplete('reportCity', 'cityList', CANADIAN_CITIES);
  setupAutocomplete('reportStore', 'storeList', CANADIAN_RETAILERS);

  // Login screen
  document.getElementById('btnSendCode').addEventListener('click', sendCode);
  document.getElementById('loginEmail').addEventListener('keydown', e => { if (e.key === 'Enter') sendCode(); });

  // Verify screen
  document.getElementById('btnBackToLogin').addEventListener('click', () => showScreen('login'));
  document.getElementById('btnVerifyCode').addEventListener('click', verifyCode);
  document.getElementById('btnResendCode').addEventListener('click', resendCode);
  document.getElementById('verifyCode').addEventListener('keydown', e => { if (e.key === 'Enter') verifyCode(); });

  // Auto-submit when 6 digits entered
  document.getElementById('verifyCode').addEventListener('input', e => {
    if (e.target.value.length === 6) verifyCode();
  });

  // Scan screen
  document.getElementById('btnStartCamera').addEventListener('click', startCamera);
  document.getElementById('btnManualSearch').addEventListener('click', () => handleCode(document.getElementById('manualCode').value));
  document.getElementById('manualCode').addEventListener('keydown', e => { if (e.key === 'Enter') handleCode(document.getElementById('manualCode').value); });
  document.getElementById('btnAccount').addEventListener('click', openAccountScreen);

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

  // Account screen
  document.getElementById('btnBackFromAccount').addEventListener('click', () => showScreen('scan'));
  document.getElementById('btnSignOut').addEventListener('click', signOut);
});

// ── SERVICE WORKER ─────────────────────────────────────────

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
