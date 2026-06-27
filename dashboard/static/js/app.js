/**
 * app.js — Core application: WebSocket, state management, routing, countdown
 */

const App = (() => {
  // ── State ────────────────────────────────────────────────────────────────
  let state = {
    watchlist: { '1H': [], '4H': [], '1D': [], '1W': [] },
    alerts: [],
    currentTF: '1H',
    filterText: '',
    sortMode: 'rr',
    htfOnly: false,
    obOnly: false,
    scanCount: 0,
    lastScan: null,
    unreadAlerts: 0,
    countdown: 90,
  };

  let ws = null;
  let wsReconnectTimer = null;
  let countdownTimer = null;

  // ── WebSocket ────────────────────────────────────────────────────────────
  function connectWS() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);

    ws.onopen = () => {
      setWSStatus('connected', 'Live');
      clearTimeout(wsReconnectTimer);
      console.log('[QMScan] WebSocket connected');
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        handleMessage(msg);
      } catch (e) {
        console.warn('[QMScan] WS parse error:', e);
      }
    };

    ws.onclose = () => {
      setWSStatus('error', 'Disconnected');
      wsReconnectTimer = setTimeout(connectWS, 4000);
    };

    ws.onerror = () => {
      setWSStatus('error', 'Error');
    };
  }

  function handleMessage(msg) {
    if (msg.type === 'ping') return;

    if (msg.type === 'watchlist_update') {
      state.watchlist = msg.watchlist || {};
      state.scanCount = msg.scan_count || 0;
      if (msg.last_scan) {
        const ts = msg.last_scan.endsWith('Z') ? msg.last_scan : msg.last_scan + 'Z';
        state.lastScan = new Date(ts);
      }
      state.countdown = msg.scan_interval || 90;
      resetCountdown();
      updateStats();
      Watchlist.render();
    }

    if (msg.type === 'alert') {
      const alert = msg.alert;
      state.alerts.unshift(alert);
      state.unreadAlerts++;
      updateAlertBadge();
      Alerts.prepend(alert);
      showToast(alert);
    }
  }

  // ── WS Status ────────────────────────────────────────────────────────────
  function setWSStatus(status, label) {
    const dot = document.getElementById('ws-status')?.querySelector('.ws-dot');
    const lbl = document.getElementById('ws-label');
    if (dot) { dot.className = `ws-dot ${status}`; }
    if (lbl) lbl.textContent = label;
  }

  // ── Countdown ────────────────────────────────────────────────────────────
  function resetCountdown() {
    clearInterval(countdownTimer);
    countdownTimer = setInterval(() => {
      state.countdown = Math.max(0, state.countdown - 1);
      const el = document.getElementById('stat-next');
      if (el) el.textContent = state.countdown + 's';
    }, 1000);
  }

  // ── Stats bar ────────────────────────────────────────────────────────────
  function updateStats() {
    const visible = getVisibleSetups();
    const total = visible.length;

    let bestRR = 0;
    let htfCount = 0;
    visible.forEach(s => {
      if (s.risk_reward > bestRR) bestRR = s.risk_reward;
      if (s.htf_confluent) htfCount++;
    });

    setText('stat-total', total);
    setText('stat-scans', state.scanCount);
    setText('stat-bestrr', bestRR > 0 ? bestRR.toFixed(1) + 'R' : '—');
    setText('stat-htf', htfCount);
    if (state.lastScan) {
      setText('stat-lastscan', state.lastScan.toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      }));
    }
  }

  function getVisibleSetups() {
    const raw = state.watchlist[state.currentTF] || [];
    return raw.filter(s => {
      const q = state.filterText.toLowerCase();
      if (q && !s.ticker.toLowerCase().includes(q) &&
              !s.setup_name.toLowerCase().includes(q)) return false;
      if (state.htfOnly && !s.htf_confluent) return false;
      if (state.obOnly && !s.order_block) return false;
      return true;
    }).sort((a, b) => {
      if (state.sortMode === 'rr') return b.risk_reward - a.risk_reward;
      if (state.sortMode === 'setup') return a.setup_id - b.setup_id;
      if (state.sortMode === 'fib') return b.fib_entry_pct - a.fib_entry_pct;
      if (state.sortMode === 'htf') return (b.htf_confluent ? 1 : 0) - (a.htf_confluent ? 1 : 0);
      return 0;
    });
  }

  // ── Alert Badge ──────────────────────────────────────────────────────────
  function updateAlertBadge() {
    const el = document.getElementById('alert-count');
    if (!el) return;
    if (state.unreadAlerts > 0) {
      el.style.display = 'inline-block';
      el.textContent = state.unreadAlerts;
    } else {
      el.style.display = 'none';
    }
  }

  // ── Toast notification ───────────────────────────────────────────────────
  function showToast(alert) {
    const el = document.createElement('div');
    el.className = `toast toast-${alert.severity}`;
    el.innerHTML = `
      <div class="toast-top">
        <strong>${alert.ticker}</strong>
        <span class="toast-tf">${alert.timeframe}</span>
        <span class="toast-sev sev-${alert.severity}">${alert.severity.toUpperCase()}</span>
      </div>
      <div class="toast-msg">Setup ${alert.setup_id}: ${alert.setup_name} — R/R ${alert.risk_reward}R</div>
    `;

    // Add toast styles if not present
    if (!document.getElementById('toast-styles')) {
      const s = document.createElement('style');
      s.id = 'toast-styles';
      s.textContent = `
        #toast-container { position:fixed; bottom:20px; right:20px; z-index:9999; display:flex; flex-direction:column-reverse; gap:8px; }
        .toast { background:#161D29; border:1px solid rgba(255,255,255,0.10); border-radius:8px; padding:10px 14px; min-width:280px; max-width:340px; animation:slide-in 0.3s ease; font-family:var(--font-mono); font-size:11px; box-shadow:0 4px 20px rgba(0,0,0,0.5); }
        @keyframes slide-in { from{transform:translateX(40px);opacity:0} to{transform:translateX(0);opacity:1} }
        .toast-critical { border-left:3px solid var(--red); }
        .toast-high { border-left:3px solid var(--amber); }
        .toast-medium { border-left:3px solid var(--blue); }
        .toast-low { border-left:3px solid var(--text3); }
        .toast-top { display:flex; align-items:center; gap:8px; margin-bottom:4px; }
        .toast-tf { font-size:9px; color:var(--text3); margin-left:auto; }
        .toast-msg { color:var(--text2); font-size:10px; line-height:1.4; }
        .toast-sev { font-size:8px; padding:1px 5px; border-radius:3px; font-weight:700; }
      `;
      document.head.appendChild(s);
    }

    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }
    container.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }

  // ── API helpers ──────────────────────────────────────────────────────────
  async function fetchJSON(url, opts = {}) {
    try {
      const r = await fetch(url, opts);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      console.error('[QMScan] fetch error:', e);
      return null;
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────
  function setTF(tf) {
    state.currentTF = tf;
    document.querySelectorAll('.tf-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tf === tf);
    });
    updateStats();
    Watchlist.render();
  }

  function filter() {
    state.filterText = document.getElementById('filter-input')?.value || '';
    state.htfOnly = document.getElementById('htf-only')?.checked || false;
    state.obOnly = document.getElementById('ob-only')?.checked || false;
    updateStats();
    Watchlist.render();
  }

  function sort(mode, btn) {
    state.sortMode = mode;
    document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    Watchlist.render();
  }

  async function rescan() {
    setWSStatus('connected', 'Rescanning...');
    const data = await fetchJSON('/api/watchlist');
    if (data) {
      state.watchlist = data.watchlist || {};
      state.scanCount = data.scan_count || 0;
      updateStats();
      Watchlist.render();
    }
    setWSStatus('connected', 'Live');
  }

  function openPanel(name) {
    document.querySelectorAll('.panel-overlay').forEach(p => p.classList.remove('open'));
    const el = document.getElementById(`${name}-panel`);
    if (el) el.classList.add('open');
    if (name === 'alerts') {
      state.unreadAlerts = 0;
      updateAlertBadge();
    }
    if (name === 'tradelog') {
      TradeLog.refresh();
    }
  }

  function closePanel(name) {
    const el = document.getElementById(`${name}-panel`);
    if (el) el.classList.remove('open');
  }

  // ── Init ─────────────────────────────────────────────────────────────────
  function init() {
    // Tab click handlers
    document.getElementById('tf-tabs').addEventListener('click', e => {
      const btn = e.target.closest('.tf-tab');
      if (btn) setTF(btn.dataset.tf);
    });

    // Initial data fetch + WS
    fetchJSON('/api/watchlist').then(data => {
      if (data) {
        state.watchlist = data.watchlist || {};
        state.scanCount = data.scan_count || 0;
        updateStats();
        Watchlist.render();
      }
    });

    fetchJSON('/api/alerts').then(data => {
      if (data && data.alerts) {
        state.alerts = data.alerts;
        Alerts.renderAll(data.alerts);
      }
    });

    connectWS();
    resetCountdown();
    console.log('[QMScan] App initialized');
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    state,
    setTF,
    filter,
    sort,
    rescan,
    openPanel,
    closePanel,
    getVisibleSetups,
    fetchJSON,
    updateStats,
  };
})();

// ── Alerts UI ────────────────────────────────────────────────────────────────
const Alerts = (() => {
  function renderAll(alerts) {
    const body = document.getElementById('alerts-body');
    if (!body) return;
    if (!alerts.length) {
      body.innerHTML = '<div class="empty-state-sm">No alerts yet.</div>';
      return;
    }
    body.innerHTML = alerts.slice(0, 80).map(renderCard).join('');
  }

  function prepend(alert) {
    const body = document.getElementById('alerts-body');
    if (!body) return;
    const empty = body.querySelector('.empty-state-sm');
    if (empty) empty.remove();
    body.insertAdjacentHTML('afterbegin', renderCard(alert));
  }

  function renderCard(a) {
    const time = new Date(a.created_at).toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    return `
    <div class="alert-card ${a.severity}">
      <div class="ac-top">
        <span class="ac-ticker">${a.ticker} <span style="font-size:10px;color:var(--text2);font-weight:400">[${a.timeframe}]</span></span>
        <span class="ac-sev sev-${a.severity}">${a.severity}</span>
      </div>
      <div class="ac-msg">Setup ${a.setup_id}: ${a.setup_name} | Entry $${a.entry.toFixed(2)} | SL $${a.stop_loss.toFixed(2)} | TP $${a.target.toFixed(2)} | R/R ${a.risk_reward}R
        ${a.htf_confluent ? ' | <span style="color:var(--green)">HTF ✓</span>' : ''}
        ${a.order_block_present ? ' | <span style="color:var(--amber)">OB ✓</span>' : ''}
      </div>
      <div class="ac-time">${time}</div>
    </div>`;
  }

  return { renderAll, prepend };
})();