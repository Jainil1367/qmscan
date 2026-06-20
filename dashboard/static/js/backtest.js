/**
 * backtest.js — ICT Fibonacci Strategy Backtester Panel
 * Robust rewrite: no complex template literals, explicit DOM manipulation.
 */

var Backtest = (function () {
  'use strict';

  var _pollTimer   = null;
  var _eqChart     = null;
  var _trades      = [];
  var _results     = null;

  var SETUP_COLORS = { 2: '#A855F7', 3: '#F59E0B', 4: '#FF4560' };

  // ── Open/Close ─────────────────────────────────────────────────────────────
  function open() {
    var panel = document.getElementById('bt-panel');
    if (!panel) { console.error('[Backtest] bt-panel not found'); return; }
    panel.style.display = 'flex';
    // Check if a run is already in progress or results exist
    _fetchStatus();
  }

  function close() {
    var panel = document.getElementById('bt-panel');
    if (panel) panel.style.display = 'none';
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  }

  // ── Run / Cancel ───────────────────────────────────────────────────────────
  function run() {
    var tickerInput = document.getElementById('bt-tickers');
    var maxInput    = document.getElementById('bt-max-tickers');
    var checks      = document.querySelectorAll('.bt-tf-check:checked');

    var tickers  = tickerInput ? tickerInput.value.trim() : '';
    var maxT     = maxInput ? parseInt(maxInput.value) || 50 : 50;
    var tfs      = [];
    for (var i = 0; i < checks.length; i++) tfs.push(checks[i].value);

    if (!tfs.length) { alert('Select at least one timeframe.'); return; }

    _setRunning(true);
    _clearResults();

    var body = JSON.stringify({
      tickers:     tickers ? tickers.split(',').map(function(s){ return s.trim().toUpperCase(); }).filter(Boolean) : [],
      timeframes:  tfs,
      max_tickers: maxT,
    });

    fetch('/api/backtest/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
    })
    .then(function(r){ return r.json(); })
    .then(function(data){
      _setMsg('Backtest started — ' + (data.tickers || 0) + ' tickers, ' + (data.timeframes || []).join('/'));
      _startPolling();
    })
    .catch(function(e){
      _setRunning(false);
      _setMsg('Failed to start: ' + e.message);
    });
  }

  function cancel() {
    fetch('/api/backtest/cancel', { method: 'POST' })
      .then(function(){ _setRunning(false); _setMsg('Cancelled.'); })
      .catch(function(){});
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  }

  // ── Polling ─────────────────────────────────────────────────────────────────
  function _startPolling() {
    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = setInterval(_fetchStatus, 2000);
  }

  function _fetchStatus() {
    fetch('/api/backtest/status')
      .then(function(r){ return r.json(); })
      .then(function(data){
        _setProgress(data.progress || 0);
        _setMsg(data.message || '');

        if (data.status === 'running') {
          _setRunning(true);
        } else if (data.status === 'done') {
          if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
          _setRunning(false);
          if (data.has_results) _loadResults();
        } else if (data.status === 'error') {
          if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
          _setRunning(false);
          _setMsg('Error: ' + (data.message || 'unknown'));
        } else {
          // idle
          if (_pollTimer && !data.has_results) { clearInterval(_pollTimer); _pollTimer = null; }
          if (data.has_results) _loadResults();
        }
      })
      .catch(function(){});
  }

  function _loadResults() {
    fetch('/api/backtest/results')
      .then(function(r){ return r.json(); })
      .then(function(data){
        _results = data;
        _trades  = data.trades || [];
        _renderAll(data);
      })
      .catch(function(e){ _setMsg('Failed to load results: ' + e.message); });
  }

  // ── UI helpers ──────────────────────────────────────────────────────────────
  function _setRunning(running) {
    var runBtn    = document.getElementById('bt-run-btn');
    var cancelBtn = document.getElementById('bt-cancel-btn');
    if (runBtn)    { runBtn.disabled    = running; runBtn.textContent = running ? 'Running...' : 'Run Backtest'; }
    if (cancelBtn) { cancelBtn.disabled = !running; }
  }

  function _setProgress(pct) {
    var fill = document.getElementById('bt-progress-fill');
    if (fill) fill.style.width = Math.min(100, pct) + '%';
  }

  function _setMsg(msg) {
    var el = document.getElementById('bt-status-msg');
    if (el) el.textContent = msg;
  }

  function _clearResults() {
    var r = document.getElementById('bt-results');
    if (r) r.innerHTML = '';
    if (_eqChart) { try { _eqChart.remove(); } catch(e){} _eqChart = null; }
  }

  // ── Render all results ──────────────────────────────────────────────────────
  function _renderAll(data) {
    var container = document.getElementById('bt-results');
    if (!container) return;
    container.innerHTML = '';

    var m = data.metrics || {};

    _renderKPIs(container, m);
    _renderEquityCurve(container, m.equity_curve || []);
    _renderBreakdowns(container, m);
    _renderMonthly(container, m.monthly_returns || []);
    _renderTradeLog(container, _trades, data.trade_count || 0);
  }

  // ── KPI cards ───────────────────────────────────────────────────────────────
  function _renderKPIs(container, m) {
    var wr = (m.win_rate || 0).toFixed(1);
    var pf = m.profit_factor === Infinity ? 'inf' : (m.profit_factor || 0).toFixed(2);

    var kpis = [
      { label: 'Total Trades',  value: m.total_trades || 0,                    color: '#D0D8E8' },
      { label: 'Win Rate',      value: wr + '%',                                color: (m.win_rate||0) >= 50 ? '#00D68F' : '#FF4560' },
      { label: 'Profit Factor', value: pf,                                      color: (m.profit_factor||0) >= 1.5 ? '#00D68F' : (m.profit_factor||0) >= 1 ? '#F59E0B' : '#FF4560' },
      { label: 'Avg R Multiple',value: (m.avg_r||0).toFixed(2) + 'R',          color: (m.avg_r||0) >= 0 ? '#00D68F' : '#FF4560' },
      { label: 'Max Drawdown',  value: (m.max_drawdown_pct||0).toFixed(1) + '%', color: (m.max_drawdown_pct||0) <= 20 ? '#00D68F' : '#FF4560' },
      { label: 'Sharpe Ratio',  value: (m.sharpe_ratio||0).toFixed(2),         color: (m.sharpe_ratio||0) >= 1 ? '#00D68F' : '#F59E0B' },
      { label: 'Total R',       value: (m.total_r||0).toFixed(1) + 'R',        color: (m.total_r||0) >= 0 ? '#00D68F' : '#FF4560' },
      { label: 'Best Trade',    value: (m.best_trade_r||0).toFixed(2) + 'R',   color: '#00D68F' },
      { label: 'Worst Trade',   value: (m.worst_trade_r||0).toFixed(2) + 'R',  color: '#FF4560' },
      { label: 'Avg Bars Held', value: (m.avg_bars_held||0).toFixed(1),        color: '#D0D8E8' },
      { label: 'Wins',          value: m.wins || 0,                             color: '#00D68F' },
      { label: 'Losses',        value: m.losses || 0,                           color: '#FF4560' },
    ];

    var row = _el('div', 'bt-kpi-row');
    kpis.forEach(function(k) {
      var card  = _el('div', 'bt-kpi-card');
      var label = _el('div', 'bt-kpi-label');
      var value = _el('div', 'bt-kpi-value');
      label.textContent = k.label;
      value.textContent = k.value;
      value.style.color = k.color;
      card.appendChild(label);
      card.appendChild(value);
      row.appendChild(card);
    });
    container.appendChild(row);
  }

  // ── Equity curve ────────────────────────────────────────────────────────────
  function _renderEquityCurve(container, curve) {
    var section = _section(container, 'Equity Curve', '(1% risk per trade, $10,000 start)');
    var inner   = _el('div', '');
    inner.id    = 'bt-eq-inner';
    inner.style.cssText = 'height:240px;background:#0D1219;border-radius:8px;overflow:hidden;';
    section.appendChild(inner);

    if (!curve.length) {
      inner.textContent = 'No equity data.';
      inner.style.color = '#6E7F99';
      inner.style.padding = '20px';
      return;
    }

    // Render with a short delay to let DOM settle
    setTimeout(function() {
      try {
        var chart = LightweightCharts.createChart(inner, {
          width: inner.clientWidth || 800,
          height: 240,
          layout: { background: { type: 'solid', color: '#0D1219' }, textColor: '#D0D8E8', fontSize: 10 },
          grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
          rightPriceScale: { borderVisible: false, textColor: '#D0D8E8' },
          timeScale: { borderVisible: false, timeVisible: false, textColor: '#D0D8E8' },
          crosshair: {
            mode: LightweightCharts.CrosshairMode.Normal,
            vertLine: { color: 'rgba(255,255,255,0.2)', style: 1, labelBackgroundColor: '#1C2535' },
            horzLine: { color: 'rgba(255,255,255,0.2)', style: 1, labelBackgroundColor: '#1C2535' },
          },
          handleScroll: { mouseWheel: true, pressedMouseMove: true },
          handleScale:  { mouseWheel: true, pinch: true },
        });

        var areaSeries = chart.addAreaSeries({
          lineColor: '#3B8BD4',
          topColor: 'rgba(59,139,212,0.28)',
          bottomColor: 'rgba(59,139,212,0.0)',
          lineWidth: 2,
          priceFormat: { type: 'price', precision: 0, minMove: 1 },
        });

        var now = Math.floor(Date.now() / 1000);
        var secPerBar = 86400;
        var seriesData = curve.map(function(v, i) {
          return { time: now - (curve.length - i) * secPerBar, value: v };
        });

        areaSeries.setData(seriesData);
        areaSeries.createPriceLine({ price: 10000, color: 'rgba(255,255,255,0.2)', lineWidth: 1, lineStyle: 2, title: 'Start $10k', axisLabelVisible: true });
        chart.timeScale().fitContent();

        new ResizeObserver(function(entries) {
          entries.forEach(function(e) {
            try { chart.applyOptions({ width: e.contentRect.width }); } catch(_){}
          });
        }).observe(inner);

        _eqChart = chart;
      } catch(e) {
        console.error('[Backtest] equity chart error:', e);
        inner.textContent = 'Chart error: ' + e.message;
        inner.style.color = '#FF4560';
        inner.style.padding = '20px';
      }
    }, 50);
  }

  // ── Breakdowns ──────────────────────────────────────────────────────────────
  function _renderBreakdowns(container, m) {
    var row = _el('div', 'bt-breakdown-row');

    // By Setup
    var setupSection = _section(row, 'By Setup', '');
    var setupTable   = _makeTable(['Setup', 'Trades', 'Wins', 'Win%', 'Avg R', 'PF']);
    var bySetup = m.by_setup || {};
    Object.keys(bySetup).forEach(function(sid) {
      var s   = bySetup[sid];
      var col = SETUP_COLORS[sid] || '#888';
      var cells = [
        { text: 'S' + sid + ' ' + (s.name || ''), color: col, bold: true },
        { text: s.total },
        { text: s.wins },
        { text: s.win_rate + '%', color: s.win_rate >= 50 ? '#00D68F' : '#FF4560' },
        { text: s.avg_r + 'R',   color: s.avg_r >= 0 ? '#00D68F' : '#FF4560' },
        { text: s.profit_factor },
      ];
      setupTable.tBodies[0].appendChild(_row(cells));
    });
    if (!Object.keys(bySetup).length) setupTable.tBodies[0].appendChild(_emptyRow(6, 'No data yet'));
    setupSection.appendChild(setupTable);

    // By Timeframe
    var tfSection = _section(row, 'By Timeframe', '');
    var tfTable   = _makeTable(['TF', 'Trades', 'Wins', 'Win%', 'Avg R']);
    var byTF = m.by_timeframe || {};
    Object.keys(byTF).forEach(function(tf) {
      var s = byTF[tf];
      var cells = [
        { text: tf, bold: true },
        { text: s.total },
        { text: s.wins },
        { text: s.win_rate + '%', color: s.win_rate >= 50 ? '#00D68F' : '#FF4560' },
        { text: s.avg_r + 'R',   color: s.avg_r >= 0 ? '#00D68F' : '#FF4560' },
      ];
      tfTable.tBodies[0].appendChild(_row(cells));
    });
    if (!Object.keys(byTF).length) tfTable.tBodies[0].appendChild(_emptyRow(5, 'No data yet'));
    tfSection.appendChild(tfTable);

    container.appendChild(row);

    // By Ticker
    var tkSection = _section(container, 'By Ticker (Top 15)', '');
    var tkTable   = _makeTable(['Ticker', 'Trades', 'Wins', 'Win%', 'Avg R', 'Total R']);
    var byTicker = m.by_ticker || {};
    Object.keys(byTicker).forEach(function(tk) {
      var s = byTicker[tk];
      var cells = [
        { text: tk, bold: true },
        { text: s.total },
        { text: s.wins },
        { text: s.win_rate + '%', color: s.win_rate >= 50 ? '#00D68F' : '#FF4560' },
        { text: s.avg_r + 'R',   color: s.avg_r >= 0 ? '#00D68F' : '#FF4560' },
        { text: s.total_r + 'R', color: s.total_r >= 0 ? '#00D68F' : '#FF4560' },
      ];
      tkTable.tBodies[0].appendChild(_row(cells));
    });
    if (!Object.keys(byTicker).length) tkTable.tBodies[0].appendChild(_emptyRow(6, 'No data yet'));
    tkSection.appendChild(tkTable);
  }

  // ── Monthly returns heatmap ─────────────────────────────────────────────────
  function _renderMonthly(container, monthly) {
    var section = _section(container, 'Monthly Returns', '(last 24 months)');
    var grid    = _el('div', 'bt-month-grid');

    var slice = monthly.slice(-24);
    if (!slice.length) {
      var msg = _el('div', '');
      msg.style.cssText = 'color:#6E7F99;font-size:11px;padding:8px';
      msg.textContent = 'No monthly data yet.';
      grid.appendChild(msg);
    } else {
      slice.forEach(function(m) {
        var r         = m.total_r || 0;
        var intensity = Math.min(1, Math.abs(r) / 5);
        var bg        = r >= 0
          ? 'rgba(0,214,143,' + (0.1 + intensity * 0.5) + ')'
          : 'rgba(255,69,96,' + (0.1 + intensity * 0.5) + ')';
        var cell  = _el('div', 'bt-month-cell');
        cell.style.background = bg;
        cell.title = (m.month || '') + ': ' + r + 'R (' + (m.trades||0) + ' trades)';

        var lbl = _el('div', 'bmc-label');
        lbl.textContent = (m.month || '').slice(5);   // show MM only

        var rv  = _el('div', 'bmc-r');
        rv.textContent = (r >= 0 ? '+' : '') + r + 'R';
        rv.style.color = r >= 0 ? '#00D68F' : '#FF4560';

        cell.appendChild(lbl);
        cell.appendChild(rv);
        grid.appendChild(cell);
      });
    }
    section.appendChild(grid);
  }

  // ── Trade log ───────────────────────────────────────────────────────────────
  function _renderTradeLog(container, trades, totalCount) {
    var section = _section(container, 'Trade Log', '(showing last ' + trades.length + ' of ' + totalCount + ' total)');

    // Filter / sort controls
    var controls = _el('div', '');
    controls.style.cssText = 'display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;align-items:center';

    var searchInput = _el('input', 'filter-input');
    searchInput.type = 'text';
    searchInput.id   = 'bt-trade-search';
    searchInput.placeholder = 'Filter ticker...';
    searchInput.style.cssText = 'width:140px;font-size:10px;padding:3px 8px';
    searchInput.oninput = filterTrades;

    var sortSel = _el('select', 'sort-btn');
    sortSel.id  = 'bt-trade-sort';
    sortSel.style.cssText = 'height:26px;padding:0 6px;font-size:10px';
    sortSel.onchange = sortTrades;
    [['date','Date'],['r','Best R'],['setup','Setup'],['ticker','Ticker']].forEach(function(o) {
      var opt = document.createElement('option');
      opt.value = o[0]; opt.textContent = o[1];
      sortSel.appendChild(opt);
    });

    controls.appendChild(searchInput);
    controls.appendChild(sortSel);
    section.appendChild(controls);

    var wrap = _el('div', '');
    wrap.id = 'bt-trade-table-wrap';
    wrap.style.overflowX = 'auto';
    _buildTradeTable(wrap, trades);
    section.appendChild(wrap);
  }

  function _buildTradeTable(wrap, trades) {
    wrap.innerHTML = '';
    if (!trades || !trades.length) {
      var msg = _el('div', '');
      msg.style.cssText = 'color:#6E7F99;padding:16px;font-size:11px';
      msg.textContent = 'No trades to display.';
      wrap.appendChild(msg);
      return;
    }

    var headers = ['Date', 'Ticker', 'Setup', 'TF', 'Entry', 'SL', 'Target', 'Exit', 'R', 'Result', 'Bars', 'Patterns'];
    var table = _makeTable(headers);

    trades.forEach(function(t) {
      var col = SETUP_COLORS[t.setup_id] || '#888';
      var isWin = t.outcome === 'win';
      var outCol = isWin ? '#00D68F' : '#FF4560';
      var patterns = (t.candle_patterns || []).join(', ') || '—';
      var cells = [
        { text: t.entry_date || '—' },
        { text: t.ticker, bold: true },
        { text: 'S' + t.setup_id, color: col },
        { text: t.timeframe },
        { text: '$' + (t.entry_price||0).toFixed(2) },
        { text: '$' + (t.stop_loss||0).toFixed(2), color: '#FF4560' },
        { text: '$' + (t.target||0).toFixed(2),    color: '#60A5FA' },
        { text: '$' + (t.exit_price||0).toFixed(2) },
        { text: (t.r_multiple >= 0 ? '+' : '') + (t.r_multiple||0).toFixed(2) + 'R', color: outCol, bold: true },
        { text: (t.outcome||'').toUpperCase(), color: outCol, small: true },
        { text: t.bars_held || 0 },
        { text: patterns, color: '#FACC15', small: true },
      ];
      table.tBodies[0].appendChild(_row(cells));
    });

    wrap.appendChild(table);
  }

  // Public filter/sort called from inline event handlers
  function filterTrades() {
    var q = (document.getElementById('bt-trade-search') || {}).value || '';
    q = q.toLowerCase();
    var filtered = q ? _trades.filter(function(t){ return t.ticker.toLowerCase().indexOf(q) !== -1; }) : _trades.slice();
    _applySortAndRender(filtered);
  }

  function sortTrades() {
    filterTrades();
  }

  function _applySortAndRender(trades) {
    var mode = (document.getElementById('bt-trade-sort') || {}).value || 'date';
    var sorted = trades.slice();
    if (mode === 'r')      sorted.sort(function(a,b){ return b.r_multiple - a.r_multiple; });
    if (mode === 'setup')  sorted.sort(function(a,b){ return a.setup_id - b.setup_id; });
    if (mode === 'ticker') sorted.sort(function(a,b){ return (a.ticker||'').localeCompare(b.ticker||''); });
    var wrap = document.getElementById('bt-trade-table-wrap');
    if (wrap) _buildTradeTable(wrap, sorted);
  }

  // ── DOM helpers ─────────────────────────────────────────────────────────────
  function _el(tag, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  function _section(parent, title, hint) {
    var s  = _el('div', 'bt-section');
    var h  = _el('div', 'bt-section-title');
    h.textContent = title;
    if (hint) {
      var hspan = _el('span', 'bt-hint');
      hspan.textContent = ' ' + hint;
      h.appendChild(hspan);
    }
    s.appendChild(h);
    parent.appendChild(s);
    return s;
  }

  function _makeTable(headers) {
    var tbl  = _el('table', 'bt-table');
    var head = tbl.createTHead();
    var hr   = head.insertRow();
    headers.forEach(function(h) {
      var th = document.createElement('th');
      th.textContent = h;
      hr.appendChild(th);
    });
    tbl.createTBody();
    return tbl;
  }

  function _row(cells) {
    var tr = document.createElement('tr');
    cells.forEach(function(c) {
      var td = document.createElement('td');
      td.textContent = typeof c === 'object' ? (c.text !== undefined ? c.text : c) : c;
      if (typeof c === 'object') {
        if (c.color) td.style.color = c.color;
        if (c.bold)  td.style.fontWeight = '700';
        if (c.small) td.style.fontSize = '9px';
      }
      tr.appendChild(td);
    });
    return tr;
  }

  function _emptyRow(cols, msg) {
    var tr = document.createElement('tr');
    var td = document.createElement('td');
    td.colSpan = cols;
    td.textContent = msg;
    td.style.cssText = 'color:#6E7F99;text-align:center;padding:12px';
    tr.appendChild(td);
    return tr;
  }

  return { open: open, close: close, run: run, cancel: cancel, filterTrades: filterTrades, sortTrades: sortTrades };

}());
