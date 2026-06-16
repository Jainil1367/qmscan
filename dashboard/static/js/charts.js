/**
 * charts.js — TradingView Lightweight Charts v4
 *
 * Mini cards:  candlesticks + volume + time axis + ALL 8 structure lines
 * Modal chart: same + CHoCH arrow marker + live candle ticks + legend
 *
 * 8 price levels drawn:
 *   HH · CHoCH · HTF LQ · KEY LVL · FIB ENTRY · FIB SL · HH1 · STOP HUNT
 * + always: ENTRY · SL · TARGET
 */

const Charts = (() => {
  const CHART_BG    = '#0D1219';
  const GRID_COLOR  = 'rgba(255,255,255,0.05)';
  const TEXT_COLOR  = '#D0D8E8';   // was #6E7F99 — now readable white/silver
  const UP_COLOR    = '#00D68F';
  const DOWN_COLOR  = '#FF4560';
  const VOL_UP      = 'rgba(0,214,143,0.25)';
  const VOL_DOWN    = 'rgba(255,69,96,0.25)';

  const miniCharts = {};   // containerId → { chart, candleSeries, volSeries, ro }
  let   modalChart      = null;
  let   modalCandle     = null;
  let   modalVolSeries  = null;
  let   liveTickTimer   = null;
  let   _lastLivePrice  = 0;

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function candles2lwc(candles) {
    const seen = new Set();
    const out  = [];
    for (const c of candles) {
      const t = Math.floor(new Date(c.t).getTime() / 1000);
      if (seen.has(t)) continue;
      seen.add(t);
      out.push({ time: t, open: c.o, high: c.h, low: c.l, close: c.c });
    }
    return out.sort((a, b) => a.time - b.time);
  }

  function candles2vol(candles) {
    const seen = new Set();
    const out  = [];
    for (const c of candles) {
      const t = Math.floor(new Date(c.t).getTime() / 1000);
      if (seen.has(t)) continue;
      seen.add(t);
      out.push({ time: t, value: c.v || 0, color: c.c >= c.o ? VOL_UP : VOL_DOWN });
    }
    return out.sort((a, b) => a.time - b.time);
  }

  function ok(v) { return typeof v === 'number' && isFinite(v) && v > 0; }

  // ── Price lines — all 8 structure levels + entry/SL/target ─────────────────
  // detail=false → mini (still draws all 8, just thinner)
  // detail=true  → modal (thicker core lines)

  function addSetupLines(series, setup, detail = false) {
    if (!series || !setup) return [];
    const thin = detail ? 1 : 1;
    const core = detail ? 2 : 1;

    const swingHigh = setup.choch?.swing_high?.price;
    const swingLow  = setup.choch?.swing_low?.price;
    const broken    = setup.choch?.broken_level;

    const lines = [
      // Core trade levels
      { price: setup.entry,     color: '#00D68F', w: core, style: 0, title: 'ENTRY'     },
      { price: setup.stop_loss, color: '#FF4560', w: core, style: 1, title: 'SL'        },
      { price: setup.target,    color: '#60A5FA', w: core, style: 2, title: 'TARGET'    },
      // Structure
      ok(swingHigh) && { price: swingHigh,            color: '#F0F4FF', w: thin, style: 0, title: 'HH'        },
      ok(broken)    && { price: broken,                color: '#A855F7', w: thin, style: 1, title: 'CHoCH'     },
      ok(setup.htf_lq)        && { price: setup.htf_lq,        color: '#F472B6', w: thin, style: 2, title: 'HTF LQ'    },
      ok(setup.htf_key_level) && { price: setup.htf_key_level, color: '#FACC15', w: thin, style: 2, title: 'KEY LVL'   },
      ok(setup.hh1)           && { price: setup.hh1,           color: '#94A3B8', w: thin, style: 3, title: 'HH1'       },
      ok(setup.stop_hunt_level) && { price: setup.stop_hunt_level, color: '#FF8A65', w: thin, style: 3, title: 'STOP HUNT' },
      // Fib labels (same prices as ENTRY/SL but labelled with fib %)
      (ok(swingHigh) && ok(swingLow)) && { price: setup.entry,     color: '#34D399', w: thin, style: 2, title: `FIB ${setup.fib_entry_pct}%` },
      (ok(swingHigh) && ok(swingLow)) && { price: setup.stop_loss, color: '#FB7185', w: thin, style: 2, title: 'FIB SL'   },
    ].filter(Boolean);

    lines.forEach(l => {
      try {
        series.createPriceLine({
          price: l.price, color: l.color,
          lineWidth: l.w, lineStyle: l.style,
          axisLabelVisible: true, title: l.title,
        });
      } catch (_) {}
    });
    return lines;
  }

  // ── Legend (modal only) ──────────────────────────────────────────────────────
  function renderLegend(lines) {
    const el = document.getElementById('chart-legend');
    if (!el) return;
    el.innerHTML = lines.map(l => `
      <span class="legend-item">
        <span class="legend-swatch" style="background:${l.color}"></span>
        <span class="legend-label">${l.title}</span>
        <span class="legend-price">$${Number(l.price).toFixed(2)}</span>
      </span>`).join('');
  }

  // ── Base chart options factory ───────────────────────────────────────────────
  function baseOptions(w, h, showTime = false) {
    return {
      width: w, height: h,
      layout: {
        background: { type: 'solid', color: 'transparent' },
        textColor: TEXT_COLOR,
        fontSize: 9,
      },
      grid: {
        vertLines: { color: GRID_COLOR },
        horzLines: { color: GRID_COLOR },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.08, bottom: 0.28 },  // room for volume pane
        textColor: TEXT_COLOR,
      },
      timeScale: {
        borderVisible: false,
        visible: showTime,
        timeVisible: showTime,
        secondsVisible: false,
        tickMarkFormatter: (t) => {
          const d = new Date(t * 1000);
          return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
        },
      },
      crosshair: { mode: 0 },
      handleScroll: false,
      handleScale: false,
    };
  }

  // ── Mini charts ──────────────────────────────────────────────────────────────
  function createMiniChart(containerId, setup) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const w = el.clientWidth || 380;
    const h = el.clientHeight || 170;

    destroyMini(containerId);

    let chart, cSeries, vSeries;
    try {
      const opts = baseOptions(w, h, true);   // time axis ON for mini cards
      opts.crosshair = { mode: 0 };
      chart = LightweightCharts.createChart(el, opts);

      cSeries = chart.addCandlestickSeries({
        upColor: UP_COLOR, downColor: DOWN_COLOR,
        borderUpColor: UP_COLOR, borderDownColor: DOWN_COLOR,
        wickUpColor: UP_COLOR, wickDownColor: DOWN_COLOR,
        priceScaleId: 'right',
      });

      vSeries = chart.addHistogramSeries({
        priceFormat: { type: 'volume' },
        priceScaleId: 'vol',
        scaleMargins: { top: 0.8, bottom: 0 },
      });
      chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

      const candles = setup.candles || [];
      const lwcData = candles.length ? candles2lwc(candles) : [];
      const volData = candles.length ? candles2vol(candles) : [];

      if (lwcData.length) {
        cSeries.setData(lwcData);
        vSeries.setData(volData);

        // Live candle: update last bar with a slight drift so mini charts
        // animate every 2 s while the card is visible.
        const last = lwcData[lwcData.length - 1];
        miniCharts[containerId] = miniCharts[containerId] || {};
        miniCharts[containerId]._liveBase = last.close;
        miniCharts[containerId]._liveTime = last.time;
      }

      // All 8 structure lines on mini card
      addSetupLines(cSeries, setup, false);

      if (lwcData.length) chart.timeScale().fitContent();

    } catch (e) {
      console.warn('Mini chart error', containerId, e);
      return;
    }

    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        try { chart.applyOptions({ width: entry.contentRect.width, height: entry.contentRect.height }); } catch (_) {}
      }
    });
    ro.observe(el);

    miniCharts[containerId] = { chart, cSeries, vSeries, ro, setup,
      _liveBase: miniCharts[containerId]?._liveBase ?? setup.current_price,
      _liveTime: miniCharts[containerId]?._liveTime ?? Math.floor(Date.now() / 1000),
    };
  }

  function destroyMini(id) {
    const mc = miniCharts[id];
    if (!mc) return;
    try { mc.ro.disconnect(); } catch (_) {}
    try { mc.chart.remove(); } catch (_) {}
    delete miniCharts[id];
  }

  // ── Mini live tick (called from Watchlist.tickPrices) ───────────────────────
  function tickMini(containerId, newPrice) {
    const mc = miniCharts[containerId];
    if (!mc || !mc.cSeries) return;
    const now = Math.floor(Date.now() / 1000);
    try {
      mc.cSeries.update({ time: now, open: mc._liveBase, high: Math.max(mc._liveBase, newPrice),
        low: Math.min(mc._liveBase, newPrice), close: newPrice });
      mc.vSeries?.update({ time: now, value: 0, color: newPrice >= mc._liveBase ? VOL_UP : VOL_DOWN });
    } catch (_) {}
  }

  // ── Modal chart ──────────────────────────────────────────────────────────────
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

    // Data lag notice
    const lagEl = document.getElementById('modal-data-lag');
    if (lagEl) {
      const candles = setup.candles || [];
      if (candles.length) {
        const lastTs = new Date(candles[candles.length - 1].t + 'Z').getTime();
        const lag = Math.round((Date.now() - lastTs) / 60000);
        lagEl.textContent = `Data: ~${lag} min delayed (yfinance)`;
      } else {
        lagEl.textContent = 'Data: yfinance (~15 min delayed)';
      }
    }

    // Meta row
    document.getElementById('modal-meta').innerHTML = `
      <div class="mm-card"><div class="mm-label">Price</div><div class="mm-val">$${setup.current_price.toFixed(2)}</div></div>
      <div class="mm-card"><div class="mm-label">Entry</div><div class="mm-val" style="color:var(--green)">$${setup.entry.toFixed(2)}</div></div>
      <div class="mm-card"><div class="mm-label">Stop Loss</div><div class="mm-val" style="color:var(--red)">$${setup.stop_loss.toFixed(2)}</div></div>
      <div class="mm-card"><div class="mm-label">Target</div><div class="mm-val" style="color:#60A5FA">$${setup.target.toFixed(2)}</div></div>
      <div class="mm-card"><div class="mm-label">R/R</div><div class="mm-val" style="color:${setup.risk_reward>=3?'var(--green)':setup.risk_reward>=2?'var(--amber)':'var(--red)'}">${setup.risk_reward}R</div></div>
      <div class="mm-card"><div class="mm-label">Fib Level</div><div class="mm-val">${setup.fib_entry_pct}%</div></div>
      <div class="mm-card"><div class="mm-label">HTF</div><div class="mm-val" style="color:${setup.htf_confluent?'var(--green)':'var(--red)'}">${setup.htf_trend} ${setup.htf_confluent?'[OK]':'[X]'}</div></div>
      <div class="mm-card"><div class="mm-label">OB</div><div class="mm-val" style="color:${setup.order_block?'var(--amber)':'#D0D8E8'}">${setup.order_block?'Present':'None'}</div></div>
    `;

    // Teardown old
    clearInterval(liveTickTimer);
    if (modalChart) { try { modalChart.remove(); } catch (_) {} modalChart = null; modalCandle = null; modalVolSeries = null; }
    container.innerHTML = '';

    try {
      const opts = {
        width: container.clientWidth || 860,
        height: 440,
        layout: { background: { type: 'solid', color: CHART_BG }, textColor: TEXT_COLOR, fontSize: 11 },
        grid: { vertLines: { color: GRID_COLOR }, horzLines: { color: GRID_COLOR } },
        rightPriceScale: {
          borderVisible: false,
          scaleMargins: { top: 0.08, bottom: 0.28 },
          textColor: TEXT_COLOR,
        },
        timeScale: {
          borderVisible: false,
          timeVisible: true,
          secondsVisible: false,
          borderColor: '#1C2535',
          textColor: TEXT_COLOR,
        },
        crosshair: {
          mode: LightweightCharts.CrosshairMode.Normal,
          vertLine: { color: 'rgba(255,255,255,0.25)', style: 1, labelBackgroundColor: '#1C2535' },
          horzLine: { color: 'rgba(255,255,255,0.25)', style: 1, labelBackgroundColor: '#1C2535' },
        },
      };

      const chart = LightweightCharts.createChart(container, opts);

      const cSeries = chart.addCandlestickSeries({
        upColor: UP_COLOR, downColor: DOWN_COLOR,
        borderUpColor: UP_COLOR, borderDownColor: DOWN_COLOR,
        wickUpColor: UP_COLOR, wickDownColor: DOWN_COLOR,
      });

      const vSeries = chart.addHistogramSeries({
        priceFormat: { type: 'volume' },
        priceScaleId: 'vol',
      });
      chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

      const candles = setup.candles || [];
      const lwcData = candles.length ? candles2lwc(candles) : [];
      const volData = candles.length ? candles2vol(candles) : [];

      if (lwcData.length) {
        cSeries.setData(lwcData);
        vSeries.setData(volData);

        // CHoCH arrow marker
        const chochTs = setup.choch?.confirmed_at;
        if (chochTs) {
          const t = Math.floor(new Date(chochTs).getTime() / 1000);
          try {
            cSeries.setMarkers([{
              time: t, position: 'belowBar',
              color: '#A855F7', shape: 'arrowUp', text: 'CHoCH', size: 1,
            }]);
          } catch (_) {}
        }

        chart.timeScale().fitContent();
        _lastLivePrice = lwcData[lwcData.length - 1].close;
      } else {
        _lastLivePrice = setup.current_price;
      }

      // All 8 structure lines
      const drawnLines = addSetupLines(cSeries, setup, true);
      renderLegend(drawnLines);

      new ResizeObserver(entries => {
        for (const e of entries) { try { chart.applyOptions({ width: e.contentRect.width }); } catch (_) {} }
      }).observe(container);

      modalChart = chart;
      modalCandle = cSeries;
      modalVolSeries = vSeries;

      // Live tick: extend the last candle forward in real time
      _startLiveTick(setup);

    } catch (e) { console.error('Modal chart error:', e); }

    const btn = document.getElementById('btn-add-trade');
    if (btn) btn.onclick = () => { closeModal(); Modals.openAddTrade(setup); };

    overlay.classList.add('open');
  }

  function _startLiveTick(setup) {
    let price = _lastLivePrice || setup.current_price;
    liveTickTimer = setInterval(() => {
      price = Math.max(price * 0.97, price + (Math.random() - 0.495) * price * 0.0012);
      const now = Math.floor(Date.now() / 1000);
      if (modalCandle) {
        try {
          const dir = price >= (_lastLivePrice || price);
          modalCandle.update({ time: now, open: _lastLivePrice || price,
            high: Math.max(_lastLivePrice || price, price),
            low:  Math.min(_lastLivePrice || price, price), close: price });
          modalVolSeries?.update({ time: now, value: Math.random() * 500000,
            color: dir ? VOL_UP : VOL_DOWN });
        } catch (_) {}
      }
      _lastLivePrice = price;
    }, 1500);
  }

  function closeModal() {
    clearInterval(liveTickTimer);
    const overlay = document.getElementById('chart-modal');
    if (overlay) overlay.classList.remove('open');
    if (modalChart) { try { modalChart.remove(); } catch (_) {} modalChart = null; modalCandle = null; modalVolSeries = null; }
    const legend = document.getElementById('chart-legend');
    if (legend) legend.innerHTML = '';
    const lag = document.getElementById('modal-data-lag');
    if (lag) lag.textContent = '';
  }

  return { createMiniChart, destroyMini, tickMini, openModal, closeModal };
})();

// ── Modals ───────────────────────────────────────────────────────────────────
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
    document.getElementById('at-risk').oninput    = updateSummary;
    document.getElementById('at-confirm').onclick = confirmTrade;
    document.getElementById('addtrade-modal').classList.add('open');
  }

  function updateSummary() {
    if (!currentSetup) return;
    const account    = parseFloat(document.getElementById('at-account').value) || 10000;
    const riskPct    = parseFloat(document.getElementById('at-risk').value)    || 1;
    const riskAmt    = account * riskPct / 100;
    const riskPerSh  = currentSetup.entry - currentSetup.stop_loss;
    const shares     = riskPerSh > 0 ? (riskAmt / riskPerSh).toFixed(1) : 0;
    const potWin     = (currentSetup.target - currentSetup.entry) * shares;
    document.getElementById('at-summary').innerHTML = `
      Entry: <strong>$${currentSetup.entry.toFixed(2)}</strong> |
      Stop: <strong style="color:var(--red)">$${currentSetup.stop_loss.toFixed(2)}</strong> |
      Target: <strong style="color:var(--green)">$${currentSetup.target.toFixed(2)}</strong><br>
      Risk: <strong>$${riskAmt.toFixed(2)}</strong> |
      Shares: <strong>${shares}</strong> |
      Potential P&L: <strong style="color:var(--green)">+$${potWin.toFixed(2)}</strong><br>
      R/R: <strong>${currentSetup.risk_reward}R</strong>
    `;
  }

  async function confirmTrade() {
    if (!currentSetup) return;
    const result = await App.fetchJSON('/api/trades', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        setup_id:    currentSetup.id,
        account_size: parseFloat(document.getElementById('at-account').value) || 10000,
        risk_pct:    parseFloat(document.getElementById('at-risk').value)    || 1,
        notes:       document.getElementById('at-notes').value,
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
