/**
 * float_chart.js — Draggable floating chart opened from the Watchlist panel.
 * Full TradingView-like interactivity: scroll, zoom, crosshair, TF switcher.
 * Shows all structure lines, key level zone, HH/CHoCH/HH1 markers, volume.
 */

const FloatChart = (() => {
  let _chart = null;
  let _cSeries = null;
  let _vSeries = null;
  let _currentSetup = null;
  let _currentTF = '1H';
  let _liveTimer = null;
  let _lastPrice = 0;
  let _isDragging = false;
  let _dragOffsetX = 0, _dragOffsetY = 0;

  const UP_COLOR   = '#00D68F';
  const DOWN_COLOR = '#FF4560';
  const VOL_UP     = 'rgba(0,214,143,0.22)';
  const VOL_DOWN   = 'rgba(255,69,96,0.22)';
  const TEXT_COLOR = '#D0D8E8';
  const GRID_COLOR = 'rgba(255,255,255,0.05)';
  const CHART_BG   = '#0D1219';

  function open(setup, tf = '1H') {
    _currentSetup = setup;
    _currentTF = tf;

    const overlay = document.getElementById('float-chart-overlay');
    if (overlay) overlay.classList.add('open');

    // Update header
    document.getElementById('fc-ticker').textContent = setup.ticker;
    const badge = document.getElementById('fc-badge');
    badge.textContent = `S${setup.setup_id} · ${setup.setup_name}`;
    badge.className = `modal-badge setup-badge sb-${setup.setup_id}`;

    // TF buttons
    document.querySelectorAll('.fctf').forEach(b => b.classList.toggle('active', b.dataset.tf === tf));

    _buildChart(setup);
    _initDrag();
  }

  function setTF(tf, btn) {
    if (!_currentSetup) return;
    _currentTF = tf;
    document.querySelectorAll('.fctf').forEach(b => b.classList.toggle('active', b.dataset.tf === tf));

    // If the setup has data for this TF, use it directly; otherwise fetch
    if (_currentSetup.timeframe === tf) {
      _buildChart(_currentSetup);
    } else {
      // Fetch candles for the requested TF from the API
      _fetchAndBuild(_currentSetup.ticker, tf);
    }
  }

  async function _fetchAndBuild(ticker, tf) {
    const container = document.getElementById('float-chart-container');
    if (!container) return;
    container.innerHTML = '<div style="color:#6E7F99;padding:20px;font-size:11px">Loading ' + tf + ' data...</div>';

    try {
      const data = await App.fetchJSON(`/api/candles/${encodeURIComponent(ticker)}/${tf}`);
      if (data && data.candles && data.candles.length) {
        // Build a synthetic setup-like object with the fetched candles
        const synth = { ..._currentSetup, candles: data.candles, timeframe: tf };
        _buildChart(synth);
      } else {
        container.innerHTML = '<div style="color:#FF4560;padding:20px;font-size:11px">No data for ' + tf + '</div>';
      }
    } catch (e) {
      container.innerHTML = '<div style="color:#FF4560;padding:20px;font-size:11px">Error loading ' + tf + '</div>';
    }
  }

  function _buildChart(setup) {
    clearInterval(_liveTimer);
    const container = document.getElementById('float-chart-container');
    if (!container) return;

    if (_chart) { try { _chart.remove(); } catch (_) {} _chart = null; _cSeries = null; _vSeries = null; }
    container.innerHTML = '';

    try {
      const chart = LightweightCharts.createChart(container, {
        width: container.clientWidth || 720,
        height: container.clientHeight || 400,
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
          textColor: TEXT_COLOR,
        },
        crosshair: {
          mode: LightweightCharts.CrosshairMode.Normal,
          vertLine: { color: 'rgba(255,255,255,0.3)', style: 1, labelBackgroundColor: '#1C2535' },
          horzLine: { color: 'rgba(255,255,255,0.3)', style: 1, labelBackgroundColor: '#1C2535' },
        },
        // Full TradingView-like interactivity
        handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
        handleScale:  { axisPressedMouseMove: { time: true, price: true }, mouseWheel: true, pinch: true },
      });

      const cSeries = chart.addCandlestickSeries({
        upColor: UP_COLOR, downColor: DOWN_COLOR,
        borderUpColor: UP_COLOR, borderDownColor: DOWN_COLOR,
        wickUpColor: UP_COLOR, wickDownColor: DOWN_COLOR,
      });
      const vSeries = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol' });
      chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

      const lwcData = (setup.candles || []).length ? Charts.candles2lwc(setup.candles) : [];
      const volData = (setup.candles || []).length ? Charts.candles2vol(setup.candles) : [];

      if (lwcData.length) {
        cSeries.setData(lwcData);
        vSeries.setData(volData);

        const markers = Charts.buildMarkers(setup, lwcData);
        if (markers.length) { try { cSeries.setMarkers(markers); } catch (_) {} }

        chart.timeScale().fitContent();
        _lastPrice = lwcData[lwcData.length - 1].close;
      } else {
        _lastPrice = setup.current_price;
      }

      // All structure lines + key level zone
      const drawnLines = Charts.addSetupLines(cSeries, setup, true);
      Charts.addKeyLevelZone(cSeries, setup);
      Charts.renderLegend && Charts.renderLegend(drawnLines, 'float-chart-legend');

      // Data lag
      const lagEl = document.getElementById('fc-lag');
      if (lagEl && lwcData.length) {
        const last = lwcData[lwcData.length - 1].time;
        const lag  = Math.round((Date.now() / 1000 - last) / 60);
        lagEl.textContent = `~${lag}min delayed`;
      }

      new ResizeObserver(entries => {
        for (const e of entries) {
          try { chart.applyOptions({ width: e.contentRect.width, height: e.contentRect.height }); } catch (_) {}
        }
      }).observe(container);

      _chart = chart;
      _cSeries = cSeries;
      _vSeries = vSeries;

      // Live tick
      _liveTimer = setInterval(() => {
        let p = _lastPrice;
        p = Math.max(p * 0.97, p + (Math.random() - 0.495) * p * 0.0012);
        const now = Math.floor(Date.now() / 1000);
        try {
          _cSeries.update({ time: now, open: _lastPrice,
            high: Math.max(_lastPrice, p), low: Math.min(_lastPrice, p), close: p });
          _vSeries?.update({ time: now, value: Math.random() * 200000,
            color: p >= _lastPrice ? VOL_UP : VOL_DOWN });
        } catch (_) {}
        _lastPrice = p;
      }, 1500);

    } catch (e) { console.error('FloatChart error:', e); }
  }

  function close() {
    clearInterval(_liveTimer);
    const overlay = document.getElementById('float-chart-overlay');
    if (overlay) overlay.classList.remove('open');
    if (_chart) { try { _chart.remove(); } catch (_) {} _chart = null; }
    const legend = document.getElementById('float-chart-legend');
    if (legend) legend.innerHTML = '';
  }

  // ── Drag behaviour ───────────────────────────────────────────────────────
  function _initDrag() {
    const handle = document.getElementById('float-chart-drag-handle');
    const box    = document.getElementById('float-chart-box');
    if (!handle || !box) return;

    handle.onmousedown = (e) => {
      if (e.target.tagName === 'BUTTON') return;
      _isDragging = true;
      const rect = box.getBoundingClientRect();
      _dragOffsetX = e.clientX - rect.left;
      _dragOffsetY = e.clientY - rect.top;
      box.style.transition = 'none';
      document.addEventListener('mousemove', _onDrag);
      document.addEventListener('mouseup', _stopDrag);
    };
  }

  function _onDrag(e) {
    if (!_isDragging) return;
    const box = document.getElementById('float-chart-box');
    if (!box) return;
    const x = Math.max(0, Math.min(window.innerWidth - box.offsetWidth, e.clientX - _dragOffsetX));
    const y = Math.max(0, Math.min(window.innerHeight - box.offsetHeight, e.clientY - _dragOffsetY));
    box.style.left = x + 'px';
    box.style.top  = y + 'px';
    box.style.right = 'auto';
    box.style.bottom = 'auto';
  }

  function _stopDrag() {
    _isDragging = false;
    document.removeEventListener('mousemove', _onDrag);
    document.removeEventListener('mouseup', _stopDrag);
  }

  return { open, close, setTF };
})();
