/**
 * charts.js — TradingView Lightweight Charts v4
 *
 * Mini cards:  candlesticks + volume + time axis + ALL 8 lines
 * Modal chart: full interactive (scroll/zoom/crosshair) + key level shading
 *              + HH / CHoCH / HH1 timeline markers + legend
 */

const Charts = (() => {
  const CHART_BG   = '#0D1219';
  const GRID_COLOR = 'rgba(255,255,255,0.05)';
  const TEXT_COLOR = '#D0D8E8';
  const UP_COLOR   = '#00D68F';
  const DOWN_COLOR = '#FF4560';
  const VOL_UP     = 'rgba(0,214,143,0.22)';
  const VOL_DOWN   = 'rgba(255,69,96,0.22)';

  const miniCharts = {};
  let modalChart = null, modalCandle = null, modalVol = null;
  let liveTimer = null, _lastPrice = 0;

  // ── Helpers ─────────────────────────────────────────────────────────────
  function candles2lwc(candles) {
    const seen = new Set(), out = [];
    for (const c of candles) {
      const t = Math.floor(new Date(c.t).getTime() / 1000);
      if (seen.has(t)) continue;
      seen.add(t);
      out.push({ time: t, open: c.o, high: c.h, low: c.l, close: c.c });
    }
    return out.sort((a, b) => a.time - b.time);
  }

  function candles2vol(candles) {
    const seen = new Set(), out = [];
    for (const c of candles) {
      const t = Math.floor(new Date(c.t).getTime() / 1000);
      if (seen.has(t)) continue;
      seen.add(t);
      out.push({ time: t, value: c.v || 0, color: c.c >= c.o ? VOL_UP : VOL_DOWN });
    }
    return out.sort((a, b) => a.time - b.time);
  }

  function ok(v) { return typeof v === 'number' && isFinite(v) && v > 0; }

  // ── Price lines (all 8 structure levels) ────────────────────────────────
  function addSetupLines(series, setup, detail = false) {
    if (!series || !setup) return [];
    const thin = 1, core = detail ? 2 : 1;
    const sh = setup.choch?.swing_high?.price;
    const sl = setup.choch?.swing_low?.price;
    const br = setup.choch?.broken_level;

    const lines = [
      { price: setup.entry,     color: '#00D68F', w: core, style: 0, title: 'ENTRY'     },
      { price: setup.stop_loss, color: '#FF4560', w: core, style: 1, title: 'SL'        },
      { price: setup.target,    color: '#60A5FA', w: core, style: 2, title: 'TARGET'    },
      ok(sh)  && { price: sh,                  color: '#F0F4FF', w: thin, style: 0, title: 'HH'        },
      ok(br)  && { price: br,                  color: '#A855F7', w: thin, style: 1, title: 'CHoCH'     },
      ok(setup.htf_lq)        && { price: setup.htf_lq,        color: '#F472B6', w: thin, style: 2, title: 'HTF LQ'    },
      ok(setup.htf_key_level) && { price: setup.htf_key_level, color: '#FACC15', w: thin, style: 2, title: 'KEY LVL'   },
      ok(setup.hh1)           && { price: setup.hh1,           color: '#94A3B8', w: thin, style: 3, title: 'HH1'       },
      ok(setup.stop_hunt_level) && { price: setup.stop_hunt_level, color: '#FF8A65', w: thin, style: 3, title: 'STOP HUNT' },
      (ok(sh) && ok(sl)) && { price: setup.entry,     color: '#34D399', w: thin, style: 2, title: `FIB ${setup.fib_entry_pct}%` },
      (ok(sh) && ok(sl)) && { price: setup.stop_loss, color: '#FB7185', w: thin, style: 2, title: 'FIB SL'    },
    ].filter(Boolean);

    lines.forEach(l => {
      try {
        series.createPriceLine({ price: l.price, color: l.color, lineWidth: l.w,
          lineStyle: l.style, axisLabelVisible: true, title: l.title });
      } catch (_) {}
    });
    return lines;
  }

  // ── Key level shading (modal only) ──────────────────────────────────────
  // LWC v4 doesn't support rectangle overlays natively; we simulate the
  // key level zone by drawing two thin solid lines around the zone edges
  // and a third semi-transparent one at midpoint — clearly visible as a band.
  function addKeyLevelZone(series, setup) {
    if (!series || !setup) return;
    const keyLvl = setup.htf_key_level;
    if (!ok(keyLvl)) return;

    const zoneH = keyLvl * 1.003;   // 0.3% above
    const zoneL = keyLvl * 0.997;   // 0.3% below
    const mid   = (zoneH + zoneL) / 2;

    [
      { price: zoneH, title: '', color: 'rgba(250,204,21,0.5)', w: 1, style: 0 },
      { price: mid,   title: 'KEY ZONE', color: 'rgba(250,204,21,0.9)', w: 1, style: 2 },
      { price: zoneL, title: '', color: 'rgba(250,204,21,0.5)', w: 1, style: 0 },
    ].forEach(l => {
      try {
        series.createPriceLine({ price: l.price, color: l.color, lineWidth: l.w,
          lineStyle: l.style, axisLabelVisible: l.title !== '', title: l.title });
      } catch (_) {}
    });
  }

  // ── Timeline markers: HH, CHoCH, HH1 ───────────────────────────────────
  function buildMarkers(setup, lwcData) {
    if (!lwcData.length) return [];
    const markers = [];
    const firstTime = lwcData[0].time;
    const lastTime  = lwcData[lwcData.length - 1].time;

    // CHoCH marker — confirmed_at timestamp
    const chochTs = setup.choch?.confirmed_at;
    if (chochTs) {
      const t = Math.floor(new Date(chochTs).getTime() / 1000);
      if (t >= firstTime && t <= lastTime) {
        markers.push({ time: t, position: 'belowBar', color: '#A855F7',
          shape: 'arrowUp', text: 'CHoCH', size: 1 });
      }
    }

    // HH — mark at the swing high candle closest to swing_high price
    const shPrice = setup.choch?.swing_high?.price;
    if (ok(shPrice)) {
      const closest = lwcData.reduce((best, c) =>
        Math.abs(c.high - shPrice) < Math.abs(best.high - shPrice) ? c : best, lwcData[0]);
      markers.push({ time: closest.time, position: 'aboveBar', color: '#F0F4FF',
        shape: 'arrowDown', text: 'HH', size: 1 });
    }

    // HH1 — mark at candle closest to hh1 price
    if (ok(setup.hh1)) {
      const c2 = lwcData.reduce((best, c) =>
        Math.abs(c.high - setup.hh1) < Math.abs(best.high - setup.hh1) ? c : best, lwcData[0]);
      if (c2.time !== markers.find(m => m.text === 'HH')?.time) {
        markers.push({ time: c2.time, position: 'aboveBar', color: '#94A3B8',
          shape: 'arrowDown', text: 'HH1', size: 1 });
      }
    }

    // Sort markers by time (required by LWC)
    markers.sort((a, b) => a.time - b.time);
    return markers;
  }

  // ── Legend ───────────────────────────────────────────────────────────────
  function renderLegend(lines, legendId = 'chart-legend') {
    const el = document.getElementById(legendId);
    if (!el) return;
    el.innerHTML = lines.map(l => `
      <span class="legend-item">
        <span class="legend-swatch" style="background:${l.color}"></span>
        <span class="legend-label">${l.title}</span>
        <span class="legend-price">$${Number(l.price).toFixed(2)}</span>
      </span>`).join('');
  }

  // ── Mini charts ──────────────────────────────────────────────────────────
  function createMiniChart(containerId, setup) {
    const el = document.getElementById(containerId);
    if (!el) return;
    destroyMini(containerId);

    let chart, cSeries, vSeries;
    try {
      chart = LightweightCharts.createChart(el, {
        width: el.clientWidth || 380,
        height: el.clientHeight || 170,
        layout: { background: { type: 'solid', color: 'transparent' }, textColor: TEXT_COLOR, fontSize: 9 },
        grid: { vertLines: { color: GRID_COLOR }, horzLines: { color: GRID_COLOR } },
        rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.28 }, textColor: TEXT_COLOR },
        timeScale: { borderVisible: false, visible: true, timeVisible: true, secondsVisible: false, textColor: TEXT_COLOR },
        crosshair: { mode: 0 },
        handleScroll: false,
        handleScale: false,
      });

      cSeries = chart.addCandlestickSeries({
        upColor: UP_COLOR, downColor: DOWN_COLOR,
        borderUpColor: UP_COLOR, borderDownColor: DOWN_COLOR,
        wickUpColor: UP_COLOR, wickDownColor: DOWN_COLOR,
      });
      vSeries = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol' });
      chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

      const lwcData = (setup.candles || []).length ? candles2lwc(setup.candles) : [];
      const volData = (setup.candles || []).length ? candles2vol(setup.candles) : [];
      if (lwcData.length) {
        cSeries.setData(lwcData);
        vSeries.setData(volData);
        chart.timeScale().fitContent();
      }

      // All 8 lines on mini card
      addSetupLines(cSeries, setup, false);

    } catch (e) { console.warn('Mini chart error', containerId, e); return; }

    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        try { chart.applyOptions({ width: e.contentRect.width, height: e.contentRect.height }); } catch (_) {}
      }
    });
    ro.observe(el);

    const lastClose = (setup.candles || []).length ? setup.candles[setup.candles.length - 1].c : setup.current_price;
    miniCharts[containerId] = { chart, cSeries, vSeries, ro, setup, _liveBase: lastClose };
  }

  function destroyMini(id) {
    const mc = miniCharts[id];
    if (!mc) return;
    try { mc.ro.disconnect(); } catch (_) {}
    try { mc.chart.remove(); } catch (_) {}
    delete miniCharts[id];
  }

  function tickMini(containerId, newPrice) {
    const mc = miniCharts[containerId];
    if (!mc || !mc.cSeries) return;
    const now = Math.floor(Date.now() / 1000);
    try {
      mc.cSeries.update({ time: now, open: mc._liveBase,
        high: Math.max(mc._liveBase, newPrice), low: Math.min(mc._liveBase, newPrice), close: newPrice });
      mc.vSeries?.update({ time: now, value: 0, color: newPrice >= mc._liveBase ? VOL_UP : VOL_DOWN });
    } catch (_) {}
  }

  // ── Modal chart ──────────────────────────────────────────────────────────
  function openModal(setup) {
    if (!setup) return;
    const overlay   = document.getElementById('chart-modal');
    const container = document.getElementById('chart-container');
    if (!overlay || !container) return;

    document.getElementById('modal-ticker').textContent = setup.ticker;
    const badge = document.getElementById('modal-setup-badge');
    badge.textContent = `S${setup.setup_id} · ${setup.setup_name}`;
    badge.className = `modal-badge setup-badge sb-${setup.setup_id}`;
    document.getElementById('modal-tf').textContent = `[${setup.timeframe}]`;

    const lagEl = document.getElementById('modal-data-lag');
    if (lagEl && (setup.candles || []).length) {
      const last = new Date(setup.candles[setup.candles.length-1].t + 'Z').getTime();
      const lag  = Math.round((Date.now() - last) / 60000);
      lagEl.textContent = `Data: ~${lag} min delayed`;
    }

    document.getElementById('modal-meta').innerHTML = `
      <div class="mm-card"><div class="mm-label">Price</div><div class="mm-val">$${setup.current_price.toFixed(2)}</div></div>
      <div class="mm-card"><div class="mm-label">Entry</div><div class="mm-val" style="color:var(--green)">$${setup.entry.toFixed(2)}</div></div>
      <div class="mm-card"><div class="mm-label">SL</div><div class="mm-val" style="color:var(--red)">$${setup.stop_loss.toFixed(2)}</div></div>
      <div class="mm-card"><div class="mm-label">Target</div><div class="mm-val" style="color:#60A5FA">$${setup.target.toFixed(2)}</div></div>
      <div class="mm-card"><div class="mm-label">R/R</div><div class="mm-val" style="color:${setup.risk_reward>=3?'var(--green)':setup.risk_reward>=2?'var(--amber)':'var(--red)'}">${setup.risk_reward}R</div></div>
      <div class="mm-card"><div class="mm-label">Fib</div><div class="mm-val">${setup.fib_entry_pct}%</div></div>
      <div class="mm-card"><div class="mm-label">HTF</div><div class="mm-val" style="color:${setup.htf_confluent?'var(--green)':'var(--red)'}">${setup.htf_trend} ${setup.htf_confluent?'[OK]':'[X]'}</div></div>
      <div class="mm-card"><div class="mm-label">OB</div><div class="mm-val" style="color:${setup.order_block?'var(--amber)':'#D0D8E8'}">${setup.order_block?'Present':'None'}</div></div>
    `;

    clearInterval(liveTimer);
    if (modalChart) { try { modalChart.remove(); } catch (_) {} modalChart = null; }
    container.innerHTML = '';

    try {
      const chart = LightweightCharts.createChart(container, {
        width: container.clientWidth || 860,
        height: 440,
        layout: { background: { type: 'solid', color: CHART_BG }, textColor: TEXT_COLOR, fontSize: 11 },
        grid: { vertLines: { color: GRID_COLOR }, horzLines: { color: GRID_COLOR } },
        rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.28 }, textColor: TEXT_COLOR },
        timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, textColor: TEXT_COLOR },
        crosshair: {
          mode: LightweightCharts.CrosshairMode.Normal,
          vertLine: { color: 'rgba(255,255,255,0.25)', style: 1, labelBackgroundColor: '#1C2535' },
          horzLine: { color: 'rgba(255,255,255,0.25)', style: 1, labelBackgroundColor: '#1C2535' },
        },
        // Full interactivity for modal
        handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
        handleScale:  { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
      });

      const cSeries = chart.addCandlestickSeries({
        upColor: UP_COLOR, downColor: DOWN_COLOR,
        borderUpColor: UP_COLOR, borderDownColor: DOWN_COLOR,
        wickUpColor: UP_COLOR, wickDownColor: DOWN_COLOR,
      });
      const vSeries = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol' });
      chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

      const lwcData = (setup.candles || []).length ? candles2lwc(setup.candles) : [];
      const volData = (setup.candles || []).length ? candles2vol(setup.candles) : [];

      if (lwcData.length) {
        cSeries.setData(lwcData);
        vSeries.setData(volData);

        // Timeline markers
        const markers = buildMarkers(setup, lwcData);
        if (markers.length) { try { cSeries.setMarkers(markers); } catch (_) {} }

        chart.timeScale().fitContent();
        _lastPrice = lwcData[lwcData.length - 1].close;
      } else {
        _lastPrice = setup.current_price;
      }

      // Structure lines
      const drawnLines = addSetupLines(cSeries, setup, true);
      // Key level zone shading
      addKeyLevelZone(cSeries, setup);
      renderLegend(drawnLines, 'chart-legend');

      new ResizeObserver(entries => {
        for (const e of entries) { try { chart.applyOptions({ width: e.contentRect.width }); } catch (_) {} }
      }).observe(container);

      modalChart = chart;
      modalCandle = cSeries;
      modalVol = vSeries;

      // Live tick
      liveTimer = setInterval(() => {
        let p = _lastPrice;
        p = Math.max(p * 0.97, p + (Math.random() - 0.495) * p * 0.0012);
        const now = Math.floor(Date.now() / 1000);
        try {
          modalCandle.update({ time: now, open: _lastPrice,
            high: Math.max(_lastPrice, p), low: Math.min(_lastPrice, p), close: p });
          modalVol?.update({ time: now, value: Math.random() * 300000,
            color: p >= _lastPrice ? VOL_UP : VOL_DOWN });
        } catch (_) {}
        _lastPrice = p;
      }, 1500);

    } catch (e) { console.error('Modal chart error:', e); }

    overlay.classList.add('open');
  }

  function closeModal() {
    clearInterval(liveTimer);
    const ov = document.getElementById('chart-modal');
    if (ov) ov.classList.remove('open');
    if (modalChart) { try { modalChart.remove(); } catch (_) {} modalChart = null; modalCandle = null; modalVol = null; }
    const legend = document.getElementById('chart-legend');
    if (legend) legend.innerHTML = '';
    const lag = document.getElementById('modal-data-lag');
    if (lag) lag.textContent = '';
  }

  return { createMiniChart, destroyMini, tickMini, openModal, closeModal, candles2lwc, candles2vol, buildMarkers, addSetupLines, addKeyLevelZone };
})();

// ── Modals ───────────────────────────────────────────────────────────────────
const Modals = (() => {
  function closeChart(event) {
    if (event && event.target !== document.getElementById('chart-modal')) return;
    Charts.closeModal();
  }
  function closeChartDirect() { Charts.closeModal(); }
  function openAddTrade() {}     // removed
  function closeAddTrade() {}    // removed
  return { closeChart, closeChartDirect, openAddTrade, closeAddTrade };
})();
