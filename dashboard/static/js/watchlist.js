/**
 * watchlist.js — Renders stock cards and drives live price ticker updates.
 * Setup 1 (Impulsive) and Master removed.
 * Adds: candlestick pattern badges, key level shading note, setup name in badge.
 */

const Watchlist = (() => {
  const SETUP_COLORS = {
    2: '#A855F7', 3: '#F59E0B', 4: '#FF4560',
  };
  const SETUP_NAMES = {
    2: 'Typical Correction',
    3: 'Golden Zone',
    4: 'Deep Correction',
  };

  const STRENGTH_COLOR = {
    'very high':   '#00D68F',
    'high':        '#34D399',
    'medium-high': '#FACC15',
    'medium':      '#EF9F27',
    'low':         '#94A3B8',
  };

  const livePrices = {};
  let tickerInterval = null;
  const renderedIds = new Set();

  function safeId(id) {
    return String(id).replace(/[^a-zA-Z0-9_]/g, '_');
  }

  // ── Render ────────────────────────────────────────────────────────────────
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
      WatchlistPanel.update([]);
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
    WatchlistPanel.update(setups);
  }

  // ── Card builder ──────────────────────────────────────────────────────────
  function buildCard(s) {
    const rr        = s.risk_reward ?? 0;
    const rrColor   = rr >= 3.0 ? 'var(--green)' : rr >= 2.0 ? 'var(--amber)' : 'var(--red)';
    const rrWidth   = Math.min(100, (rr / 5) * 100).toFixed(0);
    const cardColor = SETUP_COLORS[s.setup_id] || '#888';
    const setupName = SETUP_NAMES[s.setup_id] || s.setup_name || '';

    // Flags
    const flags = [];
    if (s.htf_confluent) flags.push(`<span class="flag flag-htf">HTF [OK]</span>`);
    if (s.order_block)   flags.push(`<span class="flag flag-ob">OB [OK]</span>`);
    if (s.stop_hunt_risk) flags.push(`<span class="flag flag-sh">Stop Hunt [!]</span>`);

    // Candlestick pattern badges
    const patterns = s.candle_patterns || [];
    const patternHTML = patterns.length ? `
      <div class="pattern-row">
        ${patterns.map(p => `
          <span class="pattern-badge" title="${p.description}">
            <span class="pb-name">${p.name}</span>
            <span class="pb-rate" style="color:${STRENGTH_COLOR[p.strength] || '#888'}">${p.success_rate}%</span>
          </span>
        `).join('')}
      </div>` : '';

    // Meta grid
    const meta = [
      { k: 'Entry',  v: `$${(s.entry ?? 0).toFixed(2)}`,     cls: 'green' },
      { k: 'Stop',   v: `$${(s.stop_loss ?? 0).toFixed(2)}`, cls: 'red'   },
      { k: 'Target', v: `$${(s.target ?? 0).toFixed(2)}`,    cls: 'blue'  },
      { k: 'R/R',    v: `${rr}R`,                            cls: ''      },
      { k: 'Fib %',  v: `${s.fib_entry_pct ?? 0}%`,          cls: ''      },
      { k: 'HTF',    v: s.htf_trend || 'bullish',             cls: s.htf_confluent ? 'green' : '' },
    ];
    const metaHTML = meta.map(m =>
      `<div class="meta-item"><span class="meta-key">${m.k}</span><span class="meta-val ${m.cls}">${m.v}</span></div>`
    ).join('');

    // Fib pills
    const ob = s.order_block;
    const slLabel = s.setup_id === 2 ? '88.6%' : '113%';
    const pills = `
      <span class="fib-pill fp-entry">Entry: ${s.fib_entry_pct}%</span>
      <span class="fib-pill">CHoCH: ${s.choch?.direction || 'bullish'}</span>
      <span class="fib-pill fp-sl">SL: ${slLabel}</span>
      <span class="fib-pill fp-tp">TP: HH</span>
      ${ob ? `<span class="fib-pill" style="color:var(--amber)">OB: $${ob.bottom?.toFixed(2)}-$${ob.top?.toFixed(2)}</span>` : ''}
    `;

    const cardClass = `stock-card s${s.setup_id}-card${s.htf_confluent ? ' confluent' : ''}`;
    const bottomInfo = `${s.fib_entry_pct}% Fib Zone`;

    return `
    <div class="${cardClass}" data-id="${s.id}">
      <div class="card-top">
        <div class="card-info">
          <div class="ticker-row">
            <span class="ticker">${s.ticker}</span>
            <span class="setup-badge sb-${s.setup_id}">S${s.setup_id} · ${setupName}</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px;margin-top:2px">
            <span class="sector-tag">${s.timeframe}</span>
          </div>
          <div class="price-row">
            <span class="price" id="price-${safeId(s.id)}">$${(s.current_price ?? 0).toFixed(2)}</span>
            <span class="chg-pos" id="chg-${safeId(s.id)}">+0.00%</span>
          </div>
          <div class="meta-grid">${metaHTML}</div>
          <div class="rr-bar-wrap">
            <div class="rr-bar-label">
              <span>R/R Strength</span>
              <span style="color:${rrColor}">${rr}R</span>
            </div>
            <div class="rr-bar">
              <div class="rr-fill" style="width:${rrWidth}%;background:${rrColor}"></div>
            </div>
          </div>
          <div class="flag-row">${flags.join('')}</div>
          ${patternHTML}
        </div>
        <div class="card-chart" id="chart-${safeId(s.id)}"
             onclick="Charts.openModal(App.getVisibleSetups().find(x=>x.id==='${s.id}'))"
             title="Click to expand chart">
        </div>
      </div>
      <div class="card-bottom">
        <div class="fib-info">${bottomInfo}</div>
        <div class="fib-pills">${pills}</div>
        <div class="card-actions">
          <button class="card-btn cb-chart" onclick="event.stopPropagation();Charts.openModal(App.getVisibleSetups().find(x=>x.id==='${s.id}'))">Expand Chart</button>
        </div>
      </div>
    </div>`;
  }

  // ── Live ticker ───────────────────────────────────────────────────────────
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

      const priceEl = document.getElementById(`price-${safeId(s.id)}`);
      const chgEl   = document.getElementById(`chg-${safeId(s.id)}`);

      if (priceEl) {
        priceEl.textContent = `$${newPrice.toFixed(2)}`;
        priceEl.classList.remove('tick-up', 'tick-down');
        void priceEl.offsetWidth;
        priceEl.classList.add(dir > 0 ? 'tick-up' : 'tick-down');
        setTimeout(() => priceEl.classList.remove('tick-up', 'tick-down'), 600);
      }
      if (chgEl) {
        chgEl.className = chgPct >= 0 ? 'chg-pos' : 'chg-neg';
        chgEl.textContent = `${chgPct >= 0 ? '+' : ''}${chgPct.toFixed(2)}%`;
      }

      Charts.tickMini('chart-' + safeId(s.id), newPrice);
      WatchlistPanel.tickPrice(s.id, newPrice, chgPct);

      lp.price = newPrice;
      lp.chgPct = chgPct;
    });
  }

  return { render };
})();
