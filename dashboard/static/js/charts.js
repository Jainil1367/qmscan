/**
 * charts.js — TradingView Lightweight Charts v4 integration
 *
 * Draws 8 key levels for every setup:
 *   1. HH        — swing high (CHoCH structure high)
 *   2. CHoCH     — broken structure level
 *   3. HTF LQ    — higher-timeframe liquidity level
 *   4. Key Level — higher-timeframe key level
 *   5. Fib Entry — entry price (fib-based)
 *   6. Fib SL    — stop loss price (fib-based)
 *   7. HH1       — prior swing high before current HH
 *   8. Stop Hunt — stop-hunt level below swing low
 */

const Charts = (() => {
  const CHART_BG   = '#0D1219';
  const GRID_COLOR = 'rgba(255,255,255,0.04)';
  const TEXT_COLOR = '#6E7F99';
  const UP_COLOR   = '#00D68F';
  const DOWN_COLOR = '#FF4560';

  const miniCharts = {};
  let modalChart = null;
  let modalSeries = null;
  let liveTickInterval = null;

  // ── Convert candles to LWC format, deduplicate timestamps ──────────────
  function candles2lwc(candles) {
    const seen = new Set();
    const result = [];
    for (const c of candles) {
      const t = Math.floor(new Date(c.t).getTime() / 1000);
      if (seen.has(t)) continue;
      seen.add(t);
      result.push({ time: t, open: c.o, high: c.h, low: c.l, close: c.c });
    }
    return result.sort((a, b) => a.time - b.time);
  }

  function isFiniteNum(v) {
    return typeof v === 'number' && isFinite(v);
  }

  // ── Unified level lines (Entry / SL / Target + structure levels) ────────
  // `detail` = true draws the full set of 8 structure/fib levels (modal),
  // `detail` = false draws only Entry/SL/Target (mini cards — keeps them readable).
  function addSetupLines(series, setup, detail = false) {
    if (!series || !setup) return;

    const lines = [];

    // Core trade levels — always shown
    lines.push({ price: setup.entry,     color: '#00D68F', lineWidth: 2, lineStyle: 0, title: 'ENTRY'  });
    lines.push({ price: setup.stop_loss, color: '#FF4560', lineWidth: 2, lineStyle: 1, title: 'SL'     });
    lines.push({ price: setup.target,    color: '#60A5FA', lineWidth: 2, lineStyle: 2, title: 'TARGET' });

    if (detail) {
      const swingHigh = setup.choch?.swing_high?.price;
      const swingLow  = setup.choch?.swing_low?.price;
      const broken    = setup.choch?.broken_level;

      // 1. HH — swing high
      if (isFiniteNum(swingHigh)) {
        lines.push({ price: swingHigh, color: '#E2E8F0', lineWidth: 1, lineStyle: 0, title: 'HH' });
      }

      // 2. CHoCH — broken structure level
      if (isFiniteNum(broken)) {
        lines.push({ price: broken, color: '#A855F7', lineWidth: 1, lineStyle: 1, title: 'CHoCH' });
      }

      // 3. HTF LQ — higher-timeframe liquidity
      if (isFiniteNum(setup.htf_lq) && setup.htf_lq > 0) {
        lines.push({ price: setup.htf_lq, color: '#F472B6', lineWidth: 1, lineStyle: 2, title: 'HTF LQ' });
      }

      // 4. Key Level — higher-timeframe key level
      if (isFiniteNum(setup.htf_key_level) && setup.htf_key_level > 0) {
        lines.push({ price: setup.htf_key_level, color: '#FACC15', lineWidth: 1, lineStyle: 2, title: 'KEY LVL' });
      }

      // 7. HH1 — prior swing high before current HH
      if (isFiniteNum(setup.hh1) && setup.hh1 > 0) {
        lines.push({ price: setup.hh1, color: '#94A3B8', lineWidth: 1, lineStyle: 3, title: 'HH1' });
      }

      // 8. Stop Hunt level — below swing low
      if (isFiniteNum(setup.stop_hunt_level) && setup.stop_hunt_level > 0) {
        lines.push({ price: setup.stop_hunt_level, color: '#FF8A65', lineWidth: 1, lineStyle: 3, title: 'STOP HUNT' });
      }

      // 5 & 6. Fib Entry / Fib SL — explicit fib-based labels (same prices as
      // ENTRY/SL above but labeled separately so both the trade levels and
      // the fib context are visible)
      if (isFiniteNum(swingHigh) && isFiniteNum(swingLow)) {
        lines.push({ price: setup.entry,     color: '#34D399', lineWidth: 1, lineStyle: 2, title: `FIB ${setup.fib_entry_pct}%` });
        lines.push({ price: setup.stop_loss, color: '#FB7185', lineWidth: 1, lineStyle: 2, title: 'FIB SL' });
      }
    }

    lines.forEach(l => {
      try {
        series.createPriceLine({
          price: l.price,
          color: l.color,
          lineWidth: l.lineWidth,
          lineStyle: l.lineStyle,
          axisLabelVisible: true,
          title: l.title,
        });
      } catch (e) {
        console.warn('createPriceLine failed for', l.title, e);
      }
    });

    return lines;
  }

  function renderLegend(lines) {
    const el = document.getElementById('chart-legend');
    if (!el) return;
    if (!lines || lines.length === 0) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = lines.map(l => `
      <span class="legend-item">
        <span class="legend-swatch" style="background:${l.color}"></span>
        <span class="legend-label">${l.title}</span>
        <span class="legend-price">$${l.price.toFixed(2)}</span>
      </span>
    `).join('');
  }

  // ── Mini charts ─────────────────────────────────────────────────────────
  function createMiniChart(containerId, setup) {
    const el = document.getElementById(containerId);
    if (!el || !el.clientWidth) return;

    destroyMini(containerId);

    let chart, series;
    try {
      chart = LightweightCharts.createChart(el, {
        width: el.clientWidth,
        height: el.clientHeight || 160,
        layout: {
          background: { type: 'solid', color: 'transparent' },
          textColor: TEXT_COLOR,
          fontSize: 9,
        },
        grid: {
          vertLines: { color: GRID_COLOR },
          horzLines: { color: GRID_COLOR },
        },
        rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.1 } },
        timeScale: { borderVisible: false, visible: false },
        crosshair: { mode: 0 },
        handleScroll: false,
        handleScale: false,
      });

      series = chart.addCandlestickSeries({
        upColor: UP_COLOR, downColor: DOWN_COLOR,
        borderUpColor: UP_COLOR, borderDownColor: DOWN_COLOR,
        wickUpColor: UP_COLOR, wickDownColor: DOWN_COLOR,
      });

      const data = (setup.candles && setup.candles.length > 0) ? candles2lwc(setup.candles) : [];
      if (data.length > 0) {
        series.setData(data);
      }

      // Mini cards: keep it readable — just Entry/SL/Target
      addSetupLines(series, setup, false);

      if (data.length > 0) {
        chart.timeScale().fitContent();
      }

    } catch (e) {
      console.warn('Mini chart error for', containerId, e);
      return;
    }

    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        try {
          chart.applyOptions({
            width: entry.contentRect.width,
            height: entry.contentRect.height,
          });
        } catch (e) {}
      }
    });
    ro.observe(el);

    miniCharts[containerId] = { chart, series, setup, ro };
  }

  function destroyMini(containerId) {
    const mc = miniCharts[containerId];
    if (mc) {
      try { mc.ro.disconnect(); } catch (e) {}
      try { mc.chart.remove(); } catch (e) {}
      delete miniCharts[containerId];
    }
  }

  // ── Modal chart ─────────────────────────────────────────────────────────
  function openModal(setup) {
    if (!setup) return;
    const overlay   = document.getElementById('chart-modal');
    const container = document.getElementById('chart-container');
    if (!overlay || !container) return;

    // Header
    document.getElementById('modal-ticker').textContent = setup.ticker;
    const badge = document.getElementById('modal-setup-badge');
    badge.textContent = `Setup ${setup.setup_id}: ${setup.setup_name}`;
    badge.className = `modal-badge setup-badge sb-${setup.setup_id}`;
    document.getElementById('modal-tf').textContent = `[${setup.timeframe}]`;

    // Meta
    document.getElementById('modal-meta').innerHTML = `
      <div class="mm-card"><div class="mm-label">Price</div><div class="mm-val">$${setup.current_price.toFixed(2)}</div></div>
      <div class="mm-card"><div class="mm-label">Entry</div><div class="mm-val" style="color:var(--green)">$${setup.entry.toFixed(2)}</div></div>
      <div class="mm-card"><div class="mm-label">Stop Loss</div><div class="mm-val" style="color:var(--red)">$${setup.stop_loss.toFixed(2)}</div></div>
      <div class="mm-card"><div class="mm-label">Target</div><div class="mm-val" style="color:#60A5FA">$${setup.target.toFixed(2)}</div></div>
      <div class="mm-card"><div class="mm-label">R/R</div><div class="mm-val" style="color:${setup.risk_reward>=3?'var(--green)':setup.risk_reward>=2?'var(--amber)':'var(--red)'}">${setup.risk_reward}R</div></div>
      <div class="mm-card"><div class="mm-label">Fib Level</div><div class="mm-val">${setup.fib_entry_pct}%</div></div>
      <div class="mm-card"><div class="mm-label">HTF</div><div class="mm-val" style="color:${setup.htf_confluent?'var(--green)':'var(--red)'}">${setup.htf_trend} ${setup.htf_confluent?'[OK]':'[X]'}</div></div>
      <div class="mm-card"><div class="mm-label">OB</div><div class="mm-val" style="color:${setup.order_block?'var(--amber)':'var(--text2)'}">${setup.order_block?'Present':'None'}</div></div>
    `;

    // Destroy old
    clearInterval(liveTickInterval);
    if (modalChart) { try { modalChart.remove(); } catch (e) {} modalChart = null; modalSeries = null; }
    container.innerHTML = '';

    try {
      const chart = LightweightCharts.createChart(container, {
        width: container.clientWidth || 800,
        height: 450,
        layout: {
          background: { type: 'solid', color: CHART_BG },
          textColor: TEXT_COLOR,
          fontSize: 10,
        },
        grid: {
          vertLines: { color: GRID_COLOR },
          horzLines: { color: GRID_COLOR },
        },
        rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.12 } },
        timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
        crosshair: {
          mode: LightweightCharts.CrosshairMode.Normal,
          vertLine: { color: 'rgba(255,255,255,0.2)', style: 1 },
          horzLine: { color: 'rgba(255,255,255,0.2)', style: 1 },
        },
      });

      const candleSeries = chart.addCandlestickSeries({
        upColor: UP_COLOR, downColor: DOWN_COLOR,
        borderUpColor: UP_COLOR, borderDownColor: DOWN_COLOR,
        wickUpColor: UP_COLOR, wickDownColor: DOWN_COLOR,
      });

      const data = (setup.candles && setup.candles.length > 0) ? candles2lwc(setup.candles) : [];
      if (data.length > 0) {
        candleSeries.setData(data);
      }

      // All 8 structure/fib levels + entry/SL/target
      const drawnLines = addSetupLines(candleSeries, setup, true);
      renderLegend(drawnLines);

      // CHoCH marker on the chart timeline
      if (setup.choch?.confirmed_at && data.length > 0) {
        const t = Math.floor(new Date(setup.choch.confirmed_at).getTime() / 1000);
        try {
          candleSeries.setMarkers([{
            time: t, position: 'belowBar', color: '#A855F7',
            shape: 'arrowUp', text: 'CHoCH', size: 1,
          }]);
        } catch (e) {}
      }

      if (data.length > 0) {
        chart.timeScale().fitContent();
      }

      new ResizeObserver(entries => {
        for (const e of entries) {
          try { chart.applyOptions({ width: e.contentRect.width }); } catch (err) {}
        }
      }).observe(container);

      modalChart = chart;
      modalSeries = candleSeries;
      startLiveTicks(setup);

    } catch (e) {
      console.error('Modal chart error:', e);
    }

    const addTradeBtn = document.getElementById('btn-add-trade');
    if (addTradeBtn) {
      addTradeBtn.onclick = () => {
        closeModal();
        Modals.openAddTrade(setup);
      };
    }

    overlay.classList.add('open');
  }

  function startLiveTicks(setup) {
    let price = setup.current_price;
    liveTickInterval = setInterval(() => {
      price = Math.max(price * 0.95, price + (Math.random() - 0.495) * price * 0.0015);
      const now = Math.floor(Date.now() / 1000);
      if (modalSeries) {
        try {
          modalSeries.update({ time: now, open: price, high: price, low: price, close: price });
        } catch (e) {}
      }
    }, 1500);
  }

  function closeModal() {
    clearInterval(liveTickInterval);
    const overlay = document.getElementById('chart-modal');
    if (overlay) overlay.classList.remove('open');
    if (modalChart) { try { modalChart.remove(); } catch (e) {} modalChart = null; modalSeries = null; }
    const legend = document.getElementById('chart-legend');
    if (legend) legend.innerHTML = '';
  }

  return { createMiniChart, destroyMini, openModal, closeModal };
})();

// ── Modals ──────────────────────────────────────────────────────────────────
const Modals = (() => {
  let currentSetup = null;

  function closeChart(event) {
    if (event && event.target !== document.getElementById('chart-modal')) return;
    Charts.closeModal();
  }

  function closeChartDirect() { Charts.closeModal(); }

  function openAddTrade(setup) {
    if (!setup) return;
    currentSetup = setup;
    document.getElementById('at-ticker').textContent =
      `${setup.ticker} — Setup ${setup.setup_id} (${setup.setup_name})`;
    updateSummary();
    document.getElementById('at-account').oninput = updateSummary;
    document.getElementById('at-risk').oninput = updateSummary;
    document.getElementById('at-confirm').onclick = confirmTrade;
    document.getElementById('addtrade-modal').classList.add('open');
  }

  function updateSummary() {
    if (!currentSetup) return;
    const account = parseFloat(document.getElementById('at-account').value) || 10000;
    const riskPct = parseFloat(document.getElementById('at-risk').value) || 1;
    const riskAmt = account * riskPct / 100;
    const riskPerShare = currentSetup.entry - currentSetup.stop_loss;
    const shares = riskPerShare > 0 ? (riskAmt / riskPerShare).toFixed(1) : 0;
    const potentialWin = (currentSetup.target - currentSetup.entry) * shares;
    document.getElementById('at-summary').innerHTML = `
      Entry: <strong>$${currentSetup.entry.toFixed(2)}</strong> |
      Stop: <strong style="color:var(--red)">$${currentSetup.stop_loss.toFixed(2)}</strong> |
      Target: <strong style="color:var(--green)">$${currentSetup.target.toFixed(2)}</strong><br>
      Risk: <strong>$${riskAmt.toFixed(2)}</strong> |
      Shares: <strong>${shares}</strong> |
      Potential P&L: <strong style="color:var(--green)">+$${potentialWin.toFixed(2)}</strong><br>
      R/R: <strong>${currentSetup.risk_reward}R</strong>
    `;
  }

  async function confirmTrade() {
    if (!currentSetup) return;
    const result = await App.fetchJSON('/api/trades', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        setup_id: currentSetup.id,
        account_size: parseFloat(document.getElementById('at-account').value) || 10000,
        risk_pct: parseFloat(document.getElementById('at-risk').value) || 1,
        notes: document.getElementById('at-notes').value,
      }),
    });
    if (result) { closeAddTrade(null, true); App.openPanel('tradelog'); }
  }

  function closeAddTrade(event, force = false) {
    if (!force && event && event.target !== document.getElementById('addtrade-modal')) return;
    document.getElementById('addtrade-modal').classList.remove('open');
    currentSetup = null;
  }

  return { closeChart, closeChartDirect, openAddTrade, closeAddTrade };
})();
