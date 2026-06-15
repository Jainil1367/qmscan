/**
 * watchlist.js — Renders stock cards and drives live price ticker updates.
 */

const Watchlist = (() => {
  const SETUP_COLORS = {
    1: '#0EA5E9', 2: '#A855F7', 3: '#F59E0B', 4: '#FF4560', 5: '#22d3ee'
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
  }

  // ── Card builder ──────────────────────────────────────────────────────────
  function buildCard(s) {
    const isMaster  = s.setup_id === 5;
    const rr        = s.risk_reward;
    const rrColor   = rr >= 3.0 ? 'var(--green)' : rr >= 2.0 ? 'var(--amber)' : 'var(--red)';
    const rrWidth   = Math.min(100, (rr / 5) * 100).toFixed(0);
    const cardColor = SETUP_COLORS[s.setup_id] || '#888';

    // Flags
    const flags = [];
    if (isMaster) {
      flags.push(`<span class="flag" style="color:#22d3ee;border-color:rgba(34,211,238,0.3)">${s.master_tf_count} TF Confluent</span>`);
      flags.push(`<span class="flag" style="color:#22d3ee;border-color:rgba(34,211,238,0.2);font-size:9px">${s.master_timeframes}</span>`);
    }
    if (s.htf_confluent) flags.push(`<span class="flag flag-htf">HTF [OK]</span>`);
    if (s.order_block)   flags.push(`<span class="flag flag-ob">OB [OK]</span>`);
    if (s.stop_hunt_risk) flags.push(`<span class="flag flag-sh">Stop Hunt [!]</span>`);

    // Meta grid
    const meta = [
      { k: 'Entry',  v: `$${s.entry.toFixed(2)}`,     cls: 'green' },
      { k: 'Stop',   v: `$${s.stop_loss.toFixed(2)}`,  cls: 'red'   },
      { k: 'Target', v: `$${s.target.toFixed(2)}`,     cls: 'blue'  },
      { k: 'R/R',    v: `${rr}R`,                      cls: ''      },
      { k: isMaster ? 'Score' : 'Fib %',
        v: isMaster ? `${s.master_score}pts` : `${s.fib_entry_pct}%`,
        cls: isMaster ? 'green' : '' },
      { k: 'HTF',    v: s.htf_trend || 'bullish',      cls: s.htf_confluent ? 'green' : '' },
    ];
    const metaHTML = meta.map(m =>
      `<div class="meta-item"><span class="meta-key">${m.k}</span><span class="meta-val ${m.cls}">${m.v}</span></div>`
    ).join('');

    // Pills
    let pills = '';
    if (isMaster) {
      pills = (s.master_setup_ids || []).map((id, i) => {
        const tfLabel = (s.master_timeframes || '').split(' + ')[i] || '';
        return `<span class="fib-pill" style="color:${SETUP_COLORS[id]||'#888'}">${tfLabel}</span>`;
      }).join('');
    } else {
      const ob = s.order_block;
      const slLabel = s.setup_id === 1 ? '61.8%' : s.setup_id === 2 ? '88.6%' : '113%';
      pills = `
        <span class="fib-pill fp-entry">Entry: ${s.fib_entry_pct}%</span>
        <span class="fib-pill">CHoCH: ${s.choch?.direction || 'bullish'}</span>
        <span class="fib-pill fp-sl">SL: ${slLabel}</span>
        <span class="fib-pill fp-tp">TP: HH</span>
        ${ob ? `<span class="fib-pill" style="color:var(--amber)">OB: $${ob.bottom?.toFixed(2)}-$${ob.top?.toFixed(2)}</span>` : ''}
      `;
    }

    const cardClass = isMaster
      ? 'stock-card master-card confluent'
      : `stock-card s${s.setup_id}-card${s.htf_confluent ? ' confluent' : ''}`;

    const badgeStyle = isMaster
      ? `style="color:#22d3ee;border-color:rgba(34,211,238,0.4);background:rgba(34,211,238,0.1)"`
      : `class="setup-badge sb-${s.setup_id}"`;

    const scoreLabel = isMaster ? `${s.master_score}pts` : `${rr}R`;
    const scoreColor = isMaster ? '#22d3ee' : rrColor;
    const barWidth   = isMaster ? Math.min(100, s.master_score * 8) : rrWidth;
    const barLabel   = isMaster ? 'Confluence Score' : 'R/R Strength';
    const bottomInfo = isMaster
      ? `Multi-TF Confluence &middot; Score ${s.master_score}`
      : `${s.setup_name} &middot; ${s.fib_entry_pct}% Fib Zone`;

    return `
    <div class="${cardClass}" data-id="${s.id}">
      <div class="card-top">
        <div class="card-info">
          <div class="ticker-row">
            <span class="ticker">${s.ticker}</span>
            <span class="setup-badge" ${badgeStyle}>${isMaster ? 'Master' : 'Setup ' + s.setup_id}</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            <span class="company-name">${s.ticker}</span>
            <span class="sector-tag">${isMaster ? (s.master_tf_count + ' TF') : s.timeframe}</span>
          </div>
          <div class="price-row">
            <span class="price" id="price-${safeId(s.id)}">$${s.current_price.toFixed(2)}</span>
            <span class="chg-pos" id="chg-${safeId(s.id)}">+0.00%</span>
          </div>
          <div class="meta-grid">${metaHTML}</div>
          <div class="rr-bar-wrap">
            <div class="rr-bar-label">
              <span>${barLabel}</span>
              <span style="color:${scoreColor}">${scoreLabel}</span>
            </div>
            <div class="rr-bar">
              <div class="rr-fill" style="width:${barWidth}%;background:${scoreColor}"></div>
            </div>
          </div>
          <div class="flag-row">${flags.join('')}</div>
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
          <button class="card-btn cb-chart" onclick="event.stopPropagation();Charts.openModal(App.getVisibleSetups().find(x=>x.id==='${s.id}'))">+ Chart</button>
          <button class="card-btn cb-trade" onclick="event.stopPropagation();Modals.openAddTrade(App.getVisibleSetups().find(x=>x.id==='${s.id}'))">+ Trade</button>
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

      lp.price = newPrice;
      lp.chgPct = chgPct;
    });
  }

  return { render };
})();
