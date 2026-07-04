/**
 * backtest.js — QMScan Backtester Panel
 *
 * Two-step flow:
 *   Step 1: Download Data → stores 5Y of OHLCV in SQLite on the server
 *   Step 2: Run Backtest  → reads from SQLite, runs walk-forward, shows results
 *
 * Uses var + function(){} only — no arrow functions, no template literals.
 * Tested: Backtest object initialises correctly on page load.
 */

var Backtest = (function () {
  'use strict';

  /* ── State ─────────────────────────────────────────────────────────────── */
  var _pollTimer   = null;
  var _dlTimer     = null;
  var _eqChart     = null;
  var _allTrades   = [];
  var _trades      = [];

  var SETUP_COLORS = { 2: '#A855F7', 3: '#F59E0B', 4: '#FF4560' };

  /* ── Open / Close ──────────────────────────────────────────────────────── */
  function open() {
    var p = document.getElementById('bt-panel');
    if (!p) { alert('Backtest panel not found — please hard-refresh (Ctrl+Shift+R)'); return; }
    p.style.display = 'flex';

    // Check existing state
    Promise.all([
      fetch('/api/data/status').then(function(r){ return r.json(); }),
      fetch('/api/backtest/status').then(function(r){ return r.json(); }),
    ]).then(function(results) {
      var ds = results[0];
      var bs = results[1];
      updateDataStatus(ds);

      if (bs.status === 'running') {
        setBtRunning(true);
        setBtMsg(bs.message || 'Running...');
        setBtProgress(bs.progress || 0);
        startBtPoll();
        if (bs.has_results) loadResults(true);
      } else if (bs.has_results) {
        setBtMsg(bs.message || 'Results from previous run loaded.');
        loadResults(false);
      } else {
        setBtMsg('Ready. Download data first, then run backtest.');
      }
    }).catch(function() {
      setBtMsg('Ready. Download data first, then run backtest.');
    });
  }

  function close() {
    var p = document.getElementById('bt-panel');
    if (p) p.style.display = 'none';
    stopBtPoll();
    stopDlPoll();
  }

  /* ── Data Download ─────────────────────────────────────────────────────── */
  function downloadData() {
    var maxEl  = document.getElementById('bt-max-tickers');
    var maxT   = maxEl ? (parseInt(maxEl.value) || 50) : 50;
    var tfBoxes = document.querySelectorAll('.bt-tf-check:checked');
    var tfs = [];
    for (var i = 0; i < tfBoxes.length; i++) tfs.push(tfBoxes[i].value);
    if (!tfs.length) tfs = ['1D', '1W'];

    setDlRunning(true);
    setDlMsg('Starting download...');

    fetch('/api/data/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ max_tickers: maxT, timeframes: tfs, force: false }),
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.started) {
        setDlMsg('Downloading ' + d.tickers + ' tickers × ' + (d.timeframes || []).join('/') + '...');
        startDlPoll();
      } else {
        setDlMsg(d.message || 'Download already running');
      }
    })
    .catch(function(e) { setDlRunning(false); setDlMsg('Error: ' + e); });
  }

  function startDlPoll() {
    stopDlPoll();
    _dlTimer = setInterval(pollDl, 3000);
    pollDl();
  }

  function stopDlPoll() {
    if (_dlTimer) { clearInterval(_dlTimer); _dlTimer = null; }
  }

  function pollDl() {
    fetch('/api/data/status')
      .then(function(r) { return r.json(); })
      .then(function(d) {
        updateDataStatus(d);
        if (!d.running) {
          stopDlPoll();
          setDlRunning(false);
        }
      })
      .catch(function() {});
  }

  function updateDataStatus(d) {
    if (!d) return;
    var entries = (d.store && d.store.entries) ? d.store.entries : [];
    var total   = (d.store && d.store.total_entries) ? d.store.total_entries : 0;
    var sizeEl  = document.getElementById('bt-db-size');
    var countEl = document.getElementById('bt-db-count');
    var msgEl   = document.getElementById('bt-dl-msg');

    if (sizeEl) sizeEl.textContent = (d.db_size_mb || 0).toFixed(1) + ' MB';
    if (countEl) countEl.textContent = total + ' series stored';
    if (msgEl && d.message && !d.running) msgEl.textContent = d.message;

    // Progress bar for download
    if (d.running) {
      setDlRunning(true);
      setDlMsg(d.message || 'Downloading...');
    }
  }

  function setDlRunning(on) {
    var btn = document.getElementById('bt-dl-btn');
    if (btn) { btn.disabled = on; btn.textContent = on ? 'Downloading...' : 'Download Data'; }
  }

  function setDlMsg(msg) {
    var el = document.getElementById('bt-dl-msg');
    if (el) el.textContent = msg;
  }

  /* ── Run Backtest ──────────────────────────────────────────────────────── */
  function run() {
    var tfBoxes = document.querySelectorAll('.bt-tf-check:checked');
    var tfs = [];
    for (var i = 0; i < tfBoxes.length; i++) tfs.push(tfBoxes[i].value);
    if (!tfs.length) { alert('Select at least one timeframe.'); return; }

    var maxEl    = document.getElementById('bt-max-tickers');
    var tickerEl = document.getElementById('bt-tickers');
    var maxT     = maxEl ? (parseInt(maxEl.value) || 50) : 50;
    var rawTick  = tickerEl ? tickerEl.value.trim() : '';
    var tickers  = rawTick
      ? rawTick.split(',').map(function(s) { return s.trim().toUpperCase(); }).filter(Boolean)
      : [];

    setBtRunning(true);
    clearResults();
    var msgEl = document.getElementById('bt-status-msg');
    if (msgEl) msgEl.style.color = '';

    fetch('/api/backtest/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers: tickers, timeframes: tfs, max_tickers: maxT }),
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      setBtMsg('Scanning ' + (d.tickers || '?') + ' tickers across ' + (d.timeframes || []).join('/'));
      startBtPoll();
    })
    .catch(function(e) { setBtRunning(false); setBtMsg('Failed to start: ' + e); });
  }

  function cancel() {
    fetch('/api/backtest/cancel', { method: 'POST' }).catch(function() {});
    stopBtPoll();
    setBtRunning(false);
    setBtMsg('Cancelled.');
  }

  function startBtPoll() {
    stopBtPoll();
    _pollTimer = setInterval(pollBt, 3000);
    pollBt();
  }

  function stopBtPoll() {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  }

  function pollBt() {
    fetch('/api/backtest/status')
      .then(function(r) { return r.json(); })
      .then(function(d) {
        setBtMsg(d.message || '');
        setBtProgress(d.progress || 0);

        if (d.status === 'running') {
          setBtRunning(true);
          if (d.has_results) loadResults(true);

        } else if (d.status === 'done') {
          stopBtPoll();
          setBtRunning(false);
          setBtProgress(100);
          loadResults(false);

        } else if (d.status === 'error') {
          stopBtPoll();
          setBtRunning(false);
          setBtProgress(0);
          var el = document.getElementById('bt-status-msg');
          if (el) { el.textContent = 'ERROR: ' + (d.message || 'Unknown'); el.style.color = '#FF4560'; }

        } else {
          // idle — stop polling, show results if available
          stopBtPoll();
          setBtRunning(false);
          if (d.has_results) loadResults(false);
        }
      })
      .catch(function(e) { console.warn('[Backtest] poll error:', e); });
  }

  function loadResults(isPartial) {
    fetch('/api/backtest/results')
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(d) {
        _allTrades = d.trades || [];
        _trades    = _allTrades.slice();
        renderAll(d, isPartial);
      })
      .catch(function(e) { console.warn('[Backtest] results error:', e); });
  }

  /* ── UI helpers ────────────────────────────────────────────────────────── */
  function setBtRunning(on) {
    var r = document.getElementById('bt-run-btn');
    var c = document.getElementById('bt-cancel-btn');
    if (r) { r.disabled = on; r.textContent = on ? 'Running...' : 'Run Backtest'; }
    if (c) c.disabled = !on;
  }

  function setBtProgress(pct) {
    var f = document.getElementById('bt-progress-fill');
    if (f) f.style.width = Math.min(100, pct) + '%';
  }

  function setBtMsg(msg) {
    var el = document.getElementById('bt-status-msg');
    if (el) el.textContent = msg;
  }

  function clearResults() {
    var r = document.getElementById('bt-results');
    if (r) r.innerHTML = '';
    if (_eqChart) { try { _eqChart.remove(); } catch (e) { } _eqChart = null; }
  }

  /* ── Render results ────────────────────────────────────────────────────── */
  function renderAll(data, isPartial) {
    var container = document.getElementById('bt-results');
    if (!container) return;
    container.innerHTML = '';

    var m = data.metrics || {};

    // Status banner
    var banner = mk('div');
    if (isPartial) {
      banner.style.cssText = 'background:rgba(59,139,212,0.12);border:1px solid rgba(59,139,212,0.3);border-radius:8px;padding:10px 16px;margin-bottom:14px;font-size:11px;color:#85B7EB;';
      banner.textContent = 'Partial results — scan still running, updates every 3s.';
    } else {
      banner.style.cssText = 'background:rgba(0,214,143,0.08);border:1px solid rgba(0,214,143,0.2);border-radius:8px;padding:10px 16px;margin-bottom:14px;font-size:11px;color:#00D68F;';
      banner.textContent = 'Completed in ' + (data.elapsed_sec || 0) + 's — ' +
        (data.trade_count || 0) + ' trades across ' + (data.tickers_scanned || 0) + ' tickers.';
    }
    container.appendChild(banner);

    // 0 trades
    if (!data.trade_count || data.trade_count === 0) {
      var noTrades = mk('div');
      noTrades.style.cssText = 'background:#12151f;border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:32px;text-align:center;';
      noTrades.innerHTML = '<div style="font-size:36px;margin-bottom:12px">📊</div>' +
        '<div style="font-size:15px;font-weight:700;color:#D0D8E8;margin-bottom:10px">No Trades Found</div>' +
        '<div style="font-size:12px;color:#6E7F99;line-height:1.8">' +
        'The scanner ran but no ICT setups were found in the stored data.<br>' +
        '<strong style="color:#D0D8E8">Step 1:</strong> Click "Download Data" to store 5 years of price data.<br>' +
        '<strong style="color:#D0D8E8">Step 2:</strong> Then click "Run Backtest".</div>';
      container.appendChild(noTrades);
      return;
    }

    renderKPIs(container, m);
    renderEquity(container, m.equity_curve || []);
    renderBreakdowns(container, m);
    renderMonthly(container, m.monthly_returns || []);
    renderTrades(container, _trades, data.trade_count || 0);
  }

  /* ── KPI cards ─────────────────────────────────────────────────────────── */
  function renderKPIs(c, m) {
    var wr   = parseFloat(m.win_rate   || 0);
    var pf   = parseFloat(m.profit_factor || 0);
    var avgR = parseFloat(m.avg_r      || 0);
    var dd   = parseFloat(m.max_drawdown_pct || 0);
    var sh   = parseFloat(m.sharpe_ratio || 0);

    var kpis = [
      ['Total Trades',   m.total_trades || 0,               '#D0D8E8'],
      ['Wins',           m.wins  || 0,                      '#00D68F'],
      ['Losses',         m.losses || 0,                     '#FF4560'],
      ['Win Rate',       wr.toFixed(1) + '%',               wr >= 50 ? '#00D68F' : '#FF4560'],
      ['Profit Factor',  pf === Infinity ? '∞' : pf.toFixed(2), pf >= 1.5 ? '#00D68F' : pf >= 1 ? '#F59E0B' : '#FF4560'],
      ['Avg R',          avgR.toFixed(2) + 'R',             avgR >= 0 ? '#00D68F' : '#FF4560'],
      ['Max Drawdown',   dd.toFixed(1) + '%',               dd <= 20 ? '#00D68F' : '#FF4560'],
      ['Sharpe',         sh.toFixed(2),                     sh >= 1 ? '#00D68F' : '#F59E0B'],
      ['Total R',        parseFloat(m.total_r || 0).toFixed(1) + 'R', (m.total_r || 0) >= 0 ? '#00D68F' : '#FF4560'],
      ['Best Trade',     parseFloat(m.best_trade_r  || 0).toFixed(2) + 'R', '#00D68F'],
      ['Worst Trade',    parseFloat(m.worst_trade_r || 0).toFixed(2) + 'R', '#FF4560'],
      ['Avg Bars Held',  parseFloat(m.avg_bars_held || 0).toFixed(1), '#D0D8E8'],
    ];

    var row = mk('div');
    row.className = 'bt-kpi-row';
    for (var i = 0; i < kpis.length; i++) {
      var k = kpis[i];
      var card = mk('div'); card.className = 'bt-kpi-card';
      var lbl  = mk('div'); lbl.className = 'bt-kpi-label'; lbl.textContent = k[0];
      var val  = mk('div'); val.className = 'bt-kpi-value'; val.textContent = k[1]; val.style.color = k[2];
      card.appendChild(lbl); card.appendChild(val); row.appendChild(card);
    }
    c.appendChild(row);
  }

  /* ── Equity curve ──────────────────────────────────────────────────────── */
  function renderEquity(c, curve) {
    var sec   = mkSection(c, 'Equity Curve', '$10,000 start · 1% risk per trade');
    var inner = mk('div');
    inner.id  = 'bt-eq-inner';
    inner.style.cssText = 'height:240px;background:#0D1219;border-radius:8px;overflow:hidden;';
    sec.appendChild(inner);

    if (!curve || !curve.length) {
      inner.textContent = 'No equity data.';
      inner.style.color = '#6E7F99';
      inner.style.padding = '20px';
      return;
    }

    setTimeout(function () {
      try {
        var chart = LightweightCharts.createChart(inner, {
          width: inner.clientWidth || 900, height: 240,
          layout: { background: { type: 'solid', color: '#0D1219' }, textColor: '#D0D8E8', fontSize: 10 },
          grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
          rightPriceScale: { borderVisible: false, textColor: '#D0D8E8' },
          timeScale: { borderVisible: false, textColor: '#D0D8E8' },
          crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
          handleScroll: { mouseWheel: true, pressedMouseMove: true },
          handleScale:  { mouseWheel: true, pinch: true },
        });
        var area = chart.addAreaSeries({
          lineColor: '#3B8BD4', topColor: 'rgba(59,139,212,0.25)',
          bottomColor: 'rgba(59,139,212,0)', lineWidth: 2,
          priceFormat: { type: 'price', precision: 0, minMove: 1 },
        });
        var now = Math.floor(Date.now() / 1000);
        var day = 86400;
        area.setData(curve.map(function (v, i) {
          return { time: now - (curve.length - i) * day, value: v };
        }));
        area.createPriceLine({ price: 10000, color: 'rgba(255,255,255,0.2)', lineWidth: 1, lineStyle: 2, title: 'Start', axisLabelVisible: true });
        chart.timeScale().fitContent();
        new ResizeObserver(function (e) {
          try { chart.applyOptions({ width: e[0].contentRect.width }); } catch (_) { }
        }).observe(inner);
        _eqChart = chart;
      } catch (e) {
        inner.textContent = 'Chart error: ' + e.message;
        inner.style.color = '#FF4560';
        inner.style.padding = '20px';
      }
    }, 80);
  }

  /* ── Breakdown tables ──────────────────────────────────────────────────── */
  function renderBreakdowns(c, m) {
    var row = mk('div'); row.className = 'bt-breakdown-row'; c.appendChild(row);

    var setupSec = mkSection(row, 'By Setup', '');
    var sTbl = mkTable(['Setup', 'Trades', 'Wins', 'Win%', 'Avg R', 'PF']);
    var byS = m.by_setup || {};
    Object.keys(byS).forEach(function (sid) {
      var s = byS[sid];
      appendRow(sTbl, [
        { text: 'S' + sid + ' ' + (s.name || ''), color: SETUP_COLORS[sid] || '#888', bold: true },
        { text: s.total }, { text: s.wins },
        { text: s.win_rate + '%', color: s.win_rate >= 50 ? '#00D68F' : '#FF4560' },
        { text: s.avg_r + 'R',   color: s.avg_r >= 0    ? '#00D68F' : '#FF4560' },
        { text: s.profit_factor },
      ]);
    });
    if (!Object.keys(byS).length) appendEmptyRow(sTbl, 6, 'No data');
    setupSec.appendChild(sTbl);

    var tfSec = mkSection(row, 'By Timeframe', '');
    var tTbl = mkTable(['TF', 'Trades', 'Wins', 'Win%', 'Avg R']);
    var byT = m.by_timeframe || {};
    Object.keys(byT).forEach(function (tf) {
      var s = byT[tf];
      appendRow(tTbl, [
        { text: tf, bold: true }, { text: s.total }, { text: s.wins },
        { text: s.win_rate + '%', color: s.win_rate >= 50 ? '#00D68F' : '#FF4560' },
        { text: s.avg_r + 'R',   color: s.avg_r >= 0    ? '#00D68F' : '#FF4560' },
      ]);
    });
    if (!Object.keys(byT).length) appendEmptyRow(tTbl, 5, 'No data');
    tfSec.appendChild(tTbl);

    var tkSec = mkSection(c, 'By Ticker (top 15)', '');
    var tkTbl = mkTable(['Ticker', 'Trades', 'Wins', 'Win%', 'Avg R', 'Total R']);
    var byTk = m.by_ticker || {};
    Object.keys(byTk).forEach(function (tk) {
      var s = byTk[tk];
      appendRow(tkTbl, [
        { text: tk, bold: true }, { text: s.total }, { text: s.wins },
        { text: s.win_rate + '%', color: s.win_rate >= 50 ? '#00D68F' : '#FF4560' },
        { text: s.avg_r + 'R',   color: s.avg_r >= 0    ? '#00D68F' : '#FF4560' },
        { text: s.total_r + 'R', color: s.total_r >= 0  ? '#00D68F' : '#FF4560' },
      ]);
    });
    if (!Object.keys(byTk).length) appendEmptyRow(tkTbl, 6, 'No data');
    tkSec.appendChild(tkTbl);
  }

  /* ── Monthly heatmap ───────────────────────────────────────────────────── */
  function renderMonthly(c, monthly) {
    var sec = mkSection(c, 'Monthly Returns', 'last 24 months');
    var grid = mk('div'); grid.className = 'bt-month-grid';
    var slice = monthly.slice(-24);
    if (!slice.length) {
      var nm = mk('div'); nm.style.cssText = 'color:#6E7F99;font-size:11px;padding:8px';
      nm.textContent = 'No monthly data.'; grid.appendChild(nm);
    } else {
      slice.forEach(function (mo) {
        var r  = parseFloat(mo.total_r || 0);
        var intensity = Math.min(1, Math.abs(r) / 5);
        var bg = r >= 0
          ? 'rgba(0,214,143,' + (0.1 + intensity * 0.5) + ')'
          : 'rgba(255,69,96,' + (0.1 + intensity * 0.5) + ')';
        var cell = mk('div'); cell.className = 'bt-month-cell'; cell.style.background = bg;
        cell.title = (mo.month || '') + ': ' + r + 'R (' + (mo.trades || 0) + ' trades)';
        var lbl = mk('div'); lbl.className = 'bmc-label'; lbl.textContent = (mo.month || '').slice(5);
        var rv  = mk('div'); rv.className = 'bmc-r';
        rv.textContent = (r >= 0 ? '+' : '') + r + 'R';
        rv.style.color = r >= 0 ? '#00D68F' : '#FF4560';
        cell.appendChild(lbl); cell.appendChild(rv); grid.appendChild(cell);
      });
    }
    sec.appendChild(grid);
  }

  /* ── Trade log ─────────────────────────────────────────────────────────── */
  function renderTrades(c, trades, totalCount) {
    var sec = mkSection(c, 'Trade Log', 'showing last ' + trades.length + ' of ' + totalCount);
    var ctrl = mk('div');
    ctrl.style.cssText = 'display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;align-items:center;';

    var si = mk('input'); si.type = 'text'; si.id = 'bt-trade-search';
    si.placeholder = 'Filter ticker...'; si.className = 'filter-input';
    si.style.cssText = 'width:140px;font-size:10px;padding:3px 8px;';
    si.oninput = filterTrades;

    var ss = mk('select'); ss.id = 'bt-trade-sort'; ss.className = 'sort-btn';
    ss.style.cssText = 'height:26px;padding:0 6px;font-size:10px;'; ss.onchange = sortTrades;
    [['date', 'Sort: Date'], ['r', 'Best R'], ['setup', 'Setup'], ['ticker', 'Ticker']].forEach(function (o) {
      var opt = mk('option'); opt.value = o[0]; opt.textContent = o[1]; ss.appendChild(opt);
    });
    ctrl.appendChild(si); ctrl.appendChild(ss); sec.appendChild(ctrl);

    var wrap = mk('div'); wrap.id = 'bt-trade-table-wrap'; wrap.style.overflowX = 'auto';
    buildTradeTable(wrap, trades);
    sec.appendChild(wrap);
  }

  function buildTradeTable(wrap, trades) {
    wrap.innerHTML = '';
    if (!trades || !trades.length) {
      var nm = mk('div'); nm.style.cssText = 'color:#6E7F99;padding:16px;font-size:11px;';
      nm.textContent = 'No trades.'; wrap.appendChild(nm); return;
    }
    var tbl = mkTable(['Date', 'Ticker', 'Setup', 'TF', 'Entry', 'SL', 'Target', 'Exit', 'R', 'Result', 'Bars', 'Patterns']);
    trades.forEach(function (t) {
      var col = SETUP_COLORS[t.setup_id] || '#888';
      var oc  = t.outcome === 'win' ? '#00D68F' : '#FF4560';
      var r   = parseFloat(t.r_multiple || 0);
      appendRow(tbl, [
        { text: t.entry_date || '—' }, { text: t.ticker, bold: true },
        { text: 'S' + t.setup_id, color: col }, { text: t.timeframe },
        { text: '$' + parseFloat(t.entry_price || 0).toFixed(2) },
        { text: '$' + parseFloat(t.stop_loss   || 0).toFixed(2), color: '#FF4560' },
        { text: '$' + parseFloat(t.target      || 0).toFixed(2), color: '#60A5FA' },
        { text: '$' + parseFloat(t.exit_price  || 0).toFixed(2) },
        { text: (r >= 0 ? '+' : '') + r.toFixed(2) + 'R', color: oc, bold: true },
        { text: (t.outcome || 'open').toUpperCase(), color: oc, small: true },
        { text: t.bars_held || 0 },
        { text: (t.candle_patterns || []).join(', ') || '—', color: '#FACC15', small: true },
      ]);
    });
    wrap.appendChild(tbl);
  }

  function filterTrades() {
    var q = ((document.getElementById('bt-trade-search') || {}).value || '').toLowerCase();
    _trades = q ? _allTrades.filter(function (t) { return (t.ticker || '').toLowerCase().indexOf(q) !== -1; }) : _allTrades.slice();
    applySortRender(_trades);
  }

  function sortTrades() { applySortRender(_trades); }

  function applySortRender(trades) {
    var mode = ((document.getElementById('bt-trade-sort') || {}).value) || 'date';
    var s = trades.slice();
    if (mode === 'r')      s.sort(function (a, b) { return b.r_multiple - a.r_multiple; });
    if (mode === 'setup')  s.sort(function (a, b) { return a.setup_id - b.setup_id; });
    if (mode === 'ticker') s.sort(function (a, b) { return (a.ticker || '').localeCompare(b.ticker || ''); });
    var w = document.getElementById('bt-trade-table-wrap');
    if (w) buildTradeTable(w, s);
  }

  /* ── DOM helpers ───────────────────────────────────────────────────────── */
  function mk(tag) { return document.createElement(tag); }

  function mkSection(parent, title, hint) {
    var s = mk('div'); s.className = 'bt-section';
    var h = mk('div'); h.className = 'bt-section-title'; h.textContent = title;
    if (hint) { var hs = mk('span'); hs.className = 'bt-hint'; hs.textContent = ' ' + hint; h.appendChild(hs); }
    s.appendChild(h); parent.appendChild(s); return s;
  }

  function mkTable(headers) {
    var tbl = mk('table'); tbl.className = 'bt-table';
    var head = tbl.createTHead(); var hr = head.insertRow();
    headers.forEach(function (h) { var th = mk('th'); th.textContent = h; hr.appendChild(th); });
    tbl.createTBody(); return tbl;
  }

  function appendRow(tbl, cells) {
    var tr = tbl.tBodies[0].insertRow();
    cells.forEach(function (c) {
      var td = mk('td');
      td.textContent = (c && c.text !== undefined) ? c.text : (c || '');
      if (c && c.color) td.style.color = c.color;
      if (c && c.bold)  td.style.fontWeight = '700';
      if (c && c.small) td.style.fontSize   = '9px';
      tr.appendChild(td);
    });
  }

  function appendEmptyRow(tbl, cols, msg) {
    var tr = tbl.tBodies[0].insertRow();
    var td = mk('td'); td.colSpan = cols;
    td.textContent = msg;
    td.style.cssText = 'color:#6E7F99;text-align:center;padding:14px;font-size:11px;';
    tr.appendChild(td);
  }

  return {
    open: open, close: close,
    downloadData: downloadData,
    run: run, cancel: cancel,
    filterTrades: filterTrades, sortTrades: sortTrades,
  };
}());