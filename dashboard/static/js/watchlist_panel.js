/**
 * watchlist_panel.js — Collapsible side panel showing all active setups
 * as a live scrolling ticker strip + clickable rows that open FloatChart.
 */

const WatchlistPanel = (() => {
  let _setups = [];
  let _filterText = '';
  let _open = false;
  let _tickerTimer = null;
  const _livePrices = {};   // id → { price, chgPct }

  const SETUP_COLORS = { 2: '#A855F7', 3: '#F59E0B', 4: '#FF4560' };
  const SETUP_SHORT  = { 2: 'Typical', 3: 'Golden', 4: 'Deep' };

  // ── Toggle ──────────────────────────────────────────────────────────────
  function toggle() {
    _open = !_open;
    const panel   = document.getElementById('wl-panel');
    const appBody = document.getElementById('app-body');
    if (panel)   panel.classList.toggle('wl-panel-open', _open);
    if (appBody) appBody.classList.toggle('wl-open', _open);
    if (_open) _renderList();
  }

  // ── Receive setups from Watchlist.render() ──────────────────────────────
  function update(setups) {
    _setups = setups || [];
    setups.forEach(s => {
      if (!_livePrices[s.id]) _livePrices[s.id] = { price: s.current_price, chgPct: 0 };
    });
    _renderTicker();
    if (_open) _renderList();
  }

  // ── Live price update from Watchlist.tickPrices ─────────────────────────
  function tickPrice(id, price, chgPct) {
    if (!_livePrices[id]) return;
    _livePrices[id] = { price, chgPct };
    // Update row price label in the panel
    const priceEl = document.getElementById(`wlp-price-${_safeId(id)}`);
    const chgEl   = document.getElementById(`wlp-chg-${_safeId(id)}`);
    if (priceEl) priceEl.textContent = `$${price.toFixed(2)}`;
    if (chgEl) {
      chgEl.textContent = `${chgPct >= 0 ? '+' : ''}${chgPct.toFixed(2)}%`;
      chgEl.className = chgPct >= 0 ? 'wlr-chg green' : 'wlr-chg red';
    }
    // Also update ticker strip item
    const tkEl = document.getElementById(`wlt-price-${_safeId(id)}`);
    if (tkEl) {
      tkEl.textContent = `$${price.toFixed(2)}`;
      tkEl.className = chgPct >= 0 ? 'wlt-price green' : 'wlt-price red';
    }
  }

  function filter() {
    _filterText = (document.getElementById('wl-search')?.value || '').toLowerCase();
    _renderList();
  }

  // ── Ticker strip (continuous scroll) ───────────────────────────────────
  function _renderTicker() {
    const strip = document.getElementById('wl-ticker-strip');
    if (!strip) return;
    if (!_setups.length) { strip.innerHTML = ''; return; }

    // Build items — duplicate for seamless loop
    const items = [..._setups, ..._setups].map(s => {
      const lp = _livePrices[s.id] || { price: s.current_price, chgPct: 0 };
      const col = SETUP_COLORS[s.setup_id] || '#888';
      const sid = _safeId(s.id);
      return `<span class="wlt-item" onclick="WatchlistPanel.openChart('${s.id}')">
        <span class="wlt-ticker" style="color:${col}">${s.ticker}</span>
        <span class="wlt-tf">${s.timeframe}</span>
        <span class="wlt-price ${lp.chgPct >= 0 ? 'green' : 'red'}" id="wlt-price-${sid}">$${lp.price.toFixed(2)}</span>
      </span>`;
    }).join('');

    strip.innerHTML = `<div class="wlt-track">${items}</div>`;
  }

  // ── Rows list ────────────────────────────────────────────────────────────
  function _renderList() {
    const list = document.getElementById('wl-list');
    if (!list) return;

    const q = _filterText;
    const visible = _setups.filter(s =>
      !q || s.ticker.toLowerCase().includes(q) || (s.setup_name || '').toLowerCase().includes(q)
    );

    if (!visible.length) {
      list.innerHTML = '<div class="empty-state-sm" style="padding:20px;font-size:11px">No active setups</div>';
      return;
    }

    list.innerHTML = visible.map(s => _buildRow(s)).join('');
  }

  function _buildRow(s) {
    const lp  = _livePrices[s.id] || { price: s.current_price, chgPct: 0 };
    const col = SETUP_COLORS[s.setup_id] || '#888';
    const sid = _safeId(s.id);
    const rr  = s.risk_reward ?? 0;
    const htf = s.htf_confluent ? '<span class="flag flag-htf" style="font-size:8px;padding:1px 4px">HTF</span>' : '';
    const ob  = s.order_block ? '<span class="flag flag-ob" style="font-size:8px;padding:1px 4px">OB</span>' : '';

    // Pattern badge (show top 1 pattern if present)
    const pat = (s.candle_patterns || [])[0];
    const patBadge = pat
      ? `<span class="wlr-pattern" title="${pat.description}">${pat.name} ${pat.success_rate}%</span>`
      : '';

    return `
    <div class="wl-row" onclick="WatchlistPanel.openChart('${s.id}')">
      <div class="wlr-top">
        <span class="wlr-ticker" style="color:${col}">${s.ticker}</span>
        <span class="wlr-badge" style="color:${col};border-color:${col}40">S${s.setup_id} ${SETUP_SHORT[s.setup_id] || ''}</span>
        <span class="wlr-tf">${s.timeframe}</span>
        <div style="margin-left:auto;display:flex;gap:4px;align-items:center">${htf}${ob}</div>
      </div>
      <div class="wlr-prices">
        <span class="wlr-price" id="wlp-price-${sid}">$${lp.price.toFixed(2)}</span>
        <span class="wlr-chg ${lp.chgPct >= 0 ? 'green' : 'red'}" id="wlp-chg-${sid}">${lp.chgPct >= 0 ? '+' : ''}${lp.chgPct.toFixed(2)}%</span>
      </div>
      <div class="wlr-meta">
        <span>Entry <strong style="color:var(--green)">$${(s.entry ?? 0).toFixed(2)}</strong></span>
        <span>SL <strong style="color:var(--red)">$${(s.stop_loss ?? 0).toFixed(2)}</strong></span>
        <span>TP <strong style="color:#60A5FA">$${(s.target ?? 0).toFixed(2)}</strong></span>
        <span>R/R <strong>${rr}R</strong></span>
      </div>
      ${patBadge}
    </div>`;
  }

  // ── Open FloatChart for this setup ─────────────────────────────────────
  function openChart(id) {
    const setup = _setups.find(s => s.id === id);
    if (!setup) return;
    FloatChart.open(setup, setup.timeframe);
  }

  function _safeId(id) {
    return String(id).replace(/[^a-zA-Z0-9_]/g, '_');
  }

  return { toggle, update, tickPrice, filter, openChart };
})();
