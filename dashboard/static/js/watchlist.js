/**
 * watchlist.js — Card renderer. Cleaner layout, all data preserved.
 */

const Watchlist = (() => {
  const SETUP_COLORS = { 2: '#A855F7', 3: '#F59E0B', 4: '#FF4560' };
  const SETUP_NAMES  = { 2: 'Typical', 3: 'Golden Zone', 4: 'Deep' };
  const STRENGTH_COLOR = {
    'very high': '#00D68F', 'high': '#34D399',
    'medium-high': '#FACC15', 'medium': '#EF9F27', 'low': '#94A3B8',
  };

  const livePrices = {};
  let tickerInterval = null;
  const renderedIds = new Set();

  function safeId(id) { return String(id).replace(/[^a-zA-Z0-9_]/g, '_'); }

  function render() {
    const grid  = document.getElementById('watchlist-grid');
    const empty = document.getElementById('empty-state');
    if (!grid) return;

    const setups = App.getVisibleSetups();
    if (setups.length === 0) {
      grid.innerHTML = '';
      if (empty) {
        empty.style.display = 'flex';
        empty.querySelector('.empty-title').textContent =
          App.state.scanCount > 0 ? 'No setups match current filters' : 'Waiting for first scan...';
      }
      stopTicker();
      if (typeof WatchlistPanel !== 'undefined') WatchlistPanel.update([]);
      return;
    }

    if (empty) empty.style.display = 'none';
    renderedIds.forEach(id => Charts.destroyMini('chart-' + safeId(id)));
    renderedIds.clear();
    grid.innerHTML = setups.map(s => buildCard(s)).join('');
    setups.forEach(s => {
      renderedIds.add(s.id);
      livePrices[s.id] = { price: s.current_price, chgPct: 0 };
    });
    requestAnimationFrame(() => {
      setups.forEach(s => Charts.createMiniChart('chart-' + safeId(s.id), s));
    });
    startTicker(setups);
    if (typeof WatchlistPanel !== 'undefined') WatchlistPanel.update(setups);
  }

  function buildCard(s) {
    const rr       = parseFloat(s.risk_reward ?? 0);
    const rrColor  = rr >= 3 ? 'var(--green)' : rr >= 2 ? 'var(--amber)' : 'var(--red)';
    const rrW      = Math.min(100, (rr / 5) * 100).toFixed(0);
    const col      = SETUP_COLORS[s.setup_id] || '#888';
    const name     = SETUP_NAMES[s.setup_id] || s.setup_name || '';
    const price    = parseFloat(s.current_price ?? 0);
    const entry    = parseFloat(s.entry ?? 0);
    const sl       = parseFloat(s.stop_loss ?? 0);
    const tp       = parseFloat(s.target ?? 0);

    // Risk: entry to SL in %
    const riskPct  = entry > 0 ? ((entry - sl) / entry * 100).toFixed(1) : '—';
    // Reward: entry to TP in %
    const rewardPct = entry > 0 ? ((tp - entry) / entry * 100).toFixed(1) : '—';

    // Flags
    const flags = [];
    if (s.htf_confluent) flags.push('<span class="flag flag-htf">HTF ✓</span>');
    if (s.order_block)   flags.push('<span class="flag flag-ob">OB ✓</span>');
    if (s.stop_hunt_risk) flags.push('<span class="flag flag-sh">⚠ Stop Hunt</span>');

    // Patterns — top 2 only to save space
    const patterns = (s.candle_patterns || []).slice(0, 2);
    const patHTML = patterns.length ? `<div class="pattern-row">${
      patterns.map(p => `<span class="pattern-badge" title="${p.description || ''}">
        <span class="pb-name">${p.name}</span>
        <span class="pb-rate" style="color:${STRENGTH_COLOR[p.strength] || '#888'}">${p.success_rate}%</span>
      </span>`).join('')
    }</div>` : '';

    const slLabel = s.setup_id === 2 ? '88.6%' : '113%';
    const chochDir = s.choch?.direction || 'bullish';
    const ob = s.order_block;

    return `
<div class="stock-card s${s.setup_id}-card${s.htf_confluent ? ' confluent' : ''}" data-id="${s.id}">

  <!-- ── Top strip: ticker + badge + timeframe + price ── -->
  <div class="card-head">
    <div class="card-head-left">
      <span class="ticker">${s.ticker}</span>
      <span class="setup-badge sb-${s.setup_id}">S${s.setup_id} · ${name}</span>
      <span class="sector-tag">${s.timeframe}</span>
    </div>
    <div class="card-head-right">
      <span class="price" id="price-${safeId(s.id)}">$${price.toFixed(2)}</span>
      <span class="chg-pos" id="chg-${safeId(s.id)}">+0.00%</span>
    </div>
  </div>

  <!-- ── Body: left info + right chart ── -->
  <div class="card-body">

    <!-- Left pane -->
    <div class="card-info">

      <!-- Key levels row -->
      <div class="card-levels">
        <div class="level-item">
          <span class="level-label">Entry</span>
          <span class="level-val green">$${entry.toFixed(2)}</span>
          <span class="level-pct">Fib ${s.fib_entry_pct}%</span>
        </div>
        <div class="level-item">
          <span class="level-label">Stop Loss</span>
          <span class="level-val red">$${sl.toFixed(2)}</span>
          <span class="level-pct">-${riskPct}%</span>
        </div>
        <div class="level-item">
          <span class="level-label">Target (HH)</span>
          <span class="level-val blue">$${tp.toFixed(2)}</span>
          <span class="level-pct">+${rewardPct}%</span>
        </div>
      </div>

      <!-- R/R bar -->
      <div class="card-rr">
        <div class="rr-bar-label">
          <span>R/R Strength</span>
          <span style="color:${rrColor};font-weight:700">${rr}R</span>
        </div>
        <div class="rr-bar"><div class="rr-fill" style="width:${rrW}%;background:${rrColor}"></div></div>
      </div>

      <!-- Setup details row -->
      <div class="card-detail-row">
        <span class="detail-chip">CHoCH <strong>${chochDir}</strong></span>
        <span class="detail-chip">SL @ <strong>${slLabel}</strong></span>
        <span class="detail-chip">HTF <strong style="color:${s.htf_confluent ? 'var(--green)' : 'var(--text2)'}">${s.htf_trend || '—'}</strong></span>
        ${ob ? `<span class="detail-chip" style="color:var(--amber)">OB $${parseFloat(ob.bottom).toFixed(2)}–$${parseFloat(ob.top).toFixed(2)}</span>` : ''}
      </div>

      <!-- Flags + patterns -->
      <div class="card-foot-info">
        ${flags.length ? `<div class="flag-row">${flags.join('')}</div>` : ''}
        ${patHTML}
      </div>
    </div>

    <!-- Right chart pane -->
    <div class="card-chart" id="chart-${safeId(s.id)}"
         onclick="Charts.openModal(App.getVisibleSetups().find(x=>x.id==='${s.id}'))"
         title="Click to expand chart">
    </div>
  </div>

  <!-- ── Footer: expand button ── -->
  <div class="card-footer">
    <button class="card-btn cb-chart"
      onclick="event.stopPropagation();Charts.openModal(App.getVisibleSetups().find(x=>x.id==='${s.id}'))">
      ⊕ Expand Chart
    </button>
  </div>

</div>`;
  }

  // ── Live ticker ────────────────────────────────────────────────────────────
  function startTicker(setups) {
    stopTicker();
    tickerInterval = setInterval(() => tickPrices(setups), 2000);
  }
  function stopTicker() {
    if (tickerInterval) { clearInterval(tickerInterval); tickerInterval = null; }
  }
  function tickPrices(setups) {
    setups.forEach(s => {
      const lp = livePrices[s.id];
      if (!lp) return;
      const drift    = (Math.random() - 0.495) * lp.price * 0.0018;
      const newPrice = Math.max(lp.price * 0.5, lp.price + drift);
      const dir      = newPrice > lp.price ? 1 : -1;
      const chgPct   = ((newPrice - s.current_price) / s.current_price) * 100;
      const priceEl  = document.getElementById('price-' + safeId(s.id));
      const chgEl    = document.getElementById('chg-' + safeId(s.id));
      if (priceEl) {
        priceEl.textContent = '$' + newPrice.toFixed(2);
        priceEl.classList.remove('tick-up', 'tick-down');
        void priceEl.offsetWidth;
        priceEl.classList.add(dir > 0 ? 'tick-up' : 'tick-down');
        setTimeout(() => priceEl.classList.remove('tick-up', 'tick-down'), 600);
      }
      if (chgEl) {
        chgEl.className = chgPct >= 0 ? 'chg-pos' : 'chg-neg';
        chgEl.textContent = (chgPct >= 0 ? '+' : '') + chgPct.toFixed(2) + '%';
      }
      Charts.tickMini('chart-' + safeId(s.id), newPrice);
      if (typeof WatchlistPanel !== 'undefined') WatchlistPanel.tickPrice(s.id, newPrice, chgPct);
      lp.price = newPrice;
      lp.chgPct = chgPct;
    });
  }

  return { render };
})();