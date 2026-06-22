/* backtest.js - QMScan Backtester */
/* Uses var and function() only - no arrow functions, no template literals */

var Backtest = (function() {

  var _pollTimer = null;
  var _eqChart   = null;
  var _trades    = [];
  var _allTrades = [];

  var SETUP_COLORS = { 2: '#A855F7', 3: '#F59E0B', 4: '#FF4560' };

  /* ── Open ── */
  function open() {
    var p = document.getElementById('bt-panel');
    if (!p) { alert('Backtest panel not found. Please hard-refresh the page (Ctrl+Shift+R).'); return; }
    p.style.display = 'flex';
    fetch('/api/backtest/status')
      .then(function(r){ return r.json(); })
      .then(function(d){
        setMsg(d.message || 'Ready.');
        setProgress(d.progress || 0);
        if (d.status === 'running') { setRunning(true); startPoll(); }
        else if (d.status === 'done' && d.has_results) { loadResults(); }
      })
      .catch(function(){});
  }

  /* ── Close ── */
  function close() {
    var p = document.getElementById('bt-panel');
    if (p) p.style.display = 'none';
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  }

  /* ── Run ── */
  function run() {
    var tfBoxes  = document.querySelectorAll('.bt-tf-check:checked');
    var tfs      = [];
    for (var i = 0; i < tfBoxes.length; i++) tfs.push(tfBoxes[i].value);
    if (!tfs.length) { alert('Select at least one timeframe.'); return; }

    var tickerEl = document.getElementById('bt-tickers');
    var maxEl    = document.getElementById('bt-max-tickers');
    var rawTick  = tickerEl ? tickerEl.value.trim() : '';
    var maxT     = maxEl ? (parseInt(maxEl.value) || 50) : 50;

    var tickers = [];
    if (rawTick) {
      tickers = rawTick.split(',').map(function(s){ return s.trim().toUpperCase(); }).filter(function(s){ return s.length > 0; });
    }

    setRunning(true);
    clearResults();
    var msgEl = document.getElementById('bt-status-msg');
    if (msgEl) { msgEl.style.color = ''; }   // reset any red error color

    fetch('/api/backtest/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers: tickers, timeframes: tfs, max_tickers: maxT })
    })
    .then(function(r){ return r.json(); })
    .then(function(d){
      setMsg('Backtest started — ' + (d.tickers || '?') + ' tickers across ' + (d.timeframes || []).join('/'));
      startPoll();
    })
    .catch(function(e){ setRunning(false); setMsg('Failed to start: ' + e); });
  }

  /* ── Cancel ── */
  function cancel() {
    fetch('/api/backtest/cancel', { method: 'POST' }).catch(function(){});
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
    setRunning(false);
    setMsg('Cancelled.');
  }

  /* ── Polling ── */
  function startPoll() {
    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = setInterval(poll, 2000);
  }

  function poll() {
    fetch('/api/backtest/status')
      .then(function(r){ return r.json(); })
      .then(function(d){
        setMsg(d.message || '');
        setProgress(d.progress || 0);
        if (d.status === 'running') {
          setRunning(true);
        } else if (d.status === 'done') {
          clearInterval(_pollTimer); _pollTimer = null;
          setRunning(false);
          setProgress(100);
          if (d.has_results) loadResults();
        } else if (d.status === 'error') {
          clearInterval(_pollTimer); _pollTimer = null;
          setRunning(false);
          setProgress(0);
          // Show error visibly in red
          var msgEl = document.getElementById('bt-status-msg');
          if (msgEl) { msgEl.textContent = 'ERROR: ' + (d.message || 'Unknown error'); msgEl.style.color = '#FF4560'; }
        } else {
          // idle - stop polling
          if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
          setRunning(false);
          if (d.has_results) loadResults();
        }
      })
      .catch(function(e){ console.warn('[Backtest] poll error:', e); });
  }

  /* ── Load results ── */
  function loadResults() {
    fetch('/api/backtest/results')
      .then(function(r){ return r.json(); })
      .then(function(d){
        _allTrades = d.trades || [];
        _trades    = _allTrades.slice();
        renderAll(d);
      })
      .catch(function(e){ setMsg('Results error: ' + e); });
  }

  /* ── UI helpers ── */
  function setRunning(on) {
    var r = document.getElementById('bt-run-btn');
    var c = document.getElementById('bt-cancel-btn');
    if (r) { r.disabled = on; r.textContent = on ? 'Running...' : 'Run Backtest'; }
    if (c) c.disabled = !on;
  }
  function setProgress(pct) {
    var f = document.getElementById('bt-progress-fill');
    if (f) f.style.width = Math.min(100, pct) + '%';
  }
  function setMsg(msg) {
    var el = document.getElementById('bt-status-msg');
    if (el) el.textContent = msg;
  }
  function clearResults() {
    var r = document.getElementById('bt-results');
    if (r) r.innerHTML = '';
    if (_eqChart) { try { _eqChart.remove(); } catch(e){} _eqChart = null; }
  }

  /* ── Render all ── */
  function renderAll(data) {
    var container = document.getElementById('bt-results');
    if (!container) return;
    container.innerHTML = '';

    var m = data.metrics || {};

    renderKPIs(container, m);
    renderEquity(container, m.equity_curve || []);
    renderBreakdowns(container, m);
    renderMonthly(container, m.monthly_returns || []);
    renderTrades(container, _trades, data.trade_count || 0);
  }

  /* ── KPIs ── */
  function renderKPIs(c, m) {
    var wr  = parseFloat(m.win_rate  || 0).toFixed(1);
    var pf  = m.profit_factor === Infinity ? 'Inf' : parseFloat(m.profit_factor || 0).toFixed(2);
    var avgR= parseFloat(m.avg_r     || 0).toFixed(2);
    var dd  = parseFloat(m.max_drawdown_pct || 0).toFixed(1);
    var sh  = parseFloat(m.sharpe_ratio || 0).toFixed(2);
    var totR= parseFloat(m.total_r   || 0).toFixed(1);
    var best= parseFloat(m.best_trade_r  || 0).toFixed(2);
    var worst=parseFloat(m.worst_trade_r || 0).toFixed(2);
    var bars= parseFloat(m.avg_bars_held || 0).toFixed(1);

    var kpis = [
      ['Total Trades',  m.total_trades || 0,  '#D0D8E8'],
      ['Wins',          m.wins  || 0,          '#00D68F'],
      ['Losses',        m.losses|| 0,          '#FF4560'],
      ['Win Rate',      wr + '%',              parseFloat(wr) >= 50 ? '#00D68F' : '#FF4560'],
      ['Profit Factor', pf,                    parseFloat(pf) >= 1.5 ? '#00D68F' : parseFloat(pf) >= 1.0 ? '#F59E0B' : '#FF4560'],
      ['Avg R Multiple',avgR + 'R',            parseFloat(avgR) >= 0 ? '#00D68F' : '#FF4560'],
      ['Max Drawdown',  dd + '%',              parseFloat(dd) <= 20 ? '#00D68F' : '#FF4560'],
      ['Sharpe Ratio',  sh,                    parseFloat(sh) >= 1 ? '#00D68F' : '#F59E0B'],
      ['Total R',       totR + 'R',            parseFloat(totR) >= 0 ? '#00D68F' : '#FF4560'],
      ['Best Trade',    best + 'R',            '#00D68F'],
      ['Worst Trade',   worst + 'R',           '#FF4560'],
      ['Avg Bars Held', bars,                  '#D0D8E8'],
    ];

    var row = mk('div'); row.className = 'bt-kpi-row';
    for (var i = 0; i < kpis.length; i++) {
      var k    = kpis[i];
      var card = mk('div'); card.className = 'bt-kpi-card';
      var lbl  = mk('div'); lbl.className = 'bt-kpi-label'; lbl.textContent = k[0];
      var val  = mk('div'); val.className = 'bt-kpi-value'; val.textContent = k[1]; val.style.color = k[2];
      card.appendChild(lbl); card.appendChild(val); row.appendChild(card);
    }
    c.appendChild(row);
  }

  /* ── Equity curve ── */
  function renderEquity(c, curve) {
    var sec   = mkSection(c, 'Equity Curve', '1% risk per trade · $10,000 starting capital');
    var inner = mk('div');
    inner.id  = 'bt-eq-inner';
    inner.style.cssText = 'height:240px;background:#0D1219;border-radius:8px;overflow:hidden;';
    sec.appendChild(inner);

    if (!curve || !curve.length) {
      inner.textContent = 'No equity curve data.';
      inner.style.cssText += 'color:#6E7F99;padding:20px;font-size:11px;';
      return;
    }

    setTimeout(function() {
      try {
        var chart = LightweightCharts.createChart(inner, {
          width:  inner.clientWidth || 900,
          height: 240,
          layout: { background: { type: 'solid', color: '#0D1219' }, textColor: '#D0D8E8', fontSize: 10 },
          grid:   { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
          rightPriceScale: { borderVisible: false, textColor: '#D0D8E8' },
          timeScale: { borderVisible: false, timeVisible: false, textColor: '#D0D8E8' },
          crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
          handleScroll: { mouseWheel: true, pressedMouseMove: true },
          handleScale:  { mouseWheel: true, pinch: true },
        });
        var area = chart.addAreaSeries({
          lineColor: '#3B8BD4', topColor: 'rgba(59,139,212,0.28)', bottomColor: 'rgba(59,139,212,0)',
          lineWidth: 2, priceFormat: { type: 'price', precision: 0, minMove: 1 },
        });
        var now    = Math.floor(Date.now() / 1000);
        var oneDay = 86400;
        var pts    = curve.map(function(v, i) { return { time: now - (curve.length - i) * oneDay, value: v }; });
        area.setData(pts);
        area.createPriceLine({ price: 10000, color: 'rgba(255,255,255,0.25)', lineWidth: 1, lineStyle: 2, title: 'Start', axisLabelVisible: true });
        chart.timeScale().fitContent();
        new ResizeObserver(function(entries) {
          try { chart.applyOptions({ width: entries[0].contentRect.width }); } catch(e){}
        }).observe(inner);
        _eqChart = chart;
      } catch(e) {
        inner.textContent = 'Chart error: ' + e.message;
        inner.style.color = '#FF4560';
        inner.style.padding = '20px';
      }
    }, 80);
  }

  /* ── Breakdowns ── */
  function renderBreakdowns(c, m) {
    var row = mk('div'); row.className = 'bt-breakdown-row'; c.appendChild(row);

    /* By Setup */
    var setupSec   = mkSection(row, 'Performance by Setup', '');
    var setupTable = mkTable(['Setup', 'Trades', 'Wins', 'Win %', 'Avg R', 'PF']);
    var bySetup    = m.by_setup || {};
    var setupKeys  = Object.keys(bySetup);
    if (setupKeys.length) {
      setupKeys.forEach(function(sid) {
        var s = bySetup[sid];
        appendRow(setupTable, [
          { text: 'S' + sid + ' ' + (s.name || ''), color: SETUP_COLORS[sid] || '#888', bold: true },
          { text: s.total },
          { text: s.wins },
          { text: s.win_rate + '%', color: s.win_rate >= 50 ? '#00D68F' : '#FF4560' },
          { text: s.avg_r + 'R',   color: s.avg_r >= 0 ? '#00D68F' : '#FF4560' },
          { text: s.profit_factor },
        ]);
      });
    } else {
      appendEmptyRow(setupTable, 6, 'Run a backtest to see results');
    }
    setupSec.appendChild(setupTable);

    /* By Timeframe */
    var tfSec   = mkSection(row, 'Performance by Timeframe', '');
    var tfTable = mkTable(['TF', 'Trades', 'Wins', 'Win %', 'Avg R']);
    var byTF    = m.by_timeframe || {};
    var tfKeys  = Object.keys(byTF);
    if (tfKeys.length) {
      tfKeys.forEach(function(tf) {
        var s = byTF[tf];
        appendRow(tfTable, [
          { text: tf, bold: true },
          { text: s.total },
          { text: s.wins },
          { text: s.win_rate + '%', color: s.win_rate >= 50 ? '#00D68F' : '#FF4560' },
          { text: s.avg_r + 'R',   color: s.avg_r >= 0 ? '#00D68F' : '#FF4560' },
        ]);
      });
    } else {
      appendEmptyRow(tfTable, 5, 'No data');
    }
    tfSec.appendChild(tfTable);

    /* By Ticker */
    var tkSec   = mkSection(c, 'Top Tickers by Trade Count', '');
    var tkTable = mkTable(['Ticker', 'Trades', 'Wins', 'Win %', 'Avg R', 'Total R']);
    var byTick  = m.by_ticker || {};
    var tkKeys  = Object.keys(byTick);
    if (tkKeys.length) {
      tkKeys.forEach(function(tk) {
        var s = byTick[tk];
        appendRow(tkTable, [
          { text: tk, bold: true, color: '#D0D8E8' },
          { text: s.total },
          { text: s.wins },
          { text: s.win_rate + '%', color: s.win_rate >= 50 ? '#00D68F' : '#FF4560' },
          { text: s.avg_r + 'R',   color: s.avg_r >= 0 ? '#00D68F' : '#FF4560' },
          { text: s.total_r + 'R', color: s.total_r >= 0 ? '#00D68F' : '#FF4560' },
        ]);
      });
    } else {
      appendEmptyRow(tkTable, 6, 'No data');
    }
    tkSec.appendChild(tkTable);
  }

  /* ── Monthly heatmap ── */
  function renderMonthly(c, monthly) {
    var sec  = mkSection(c, 'Monthly Returns Heatmap', 'last 24 months');
    var grid = mk('div'); grid.className = 'bt-month-grid';

    var slice = monthly.slice(-24);
    if (!slice.length) {
      var nm = mk('div'); nm.style.cssText = 'color:#6E7F99;font-size:11px;padding:8px';
      nm.textContent = 'No monthly data yet.'; grid.appendChild(nm);
    } else {
      slice.forEach(function(mo) {
        var r  = parseFloat(mo.total_r || 0);
        var intensity = Math.min(1, Math.abs(r) / 5);
        var bg = r >= 0
          ? 'rgba(0,214,143,' + (0.1 + intensity * 0.5) + ')'
          : 'rgba(255,69,96,' + (0.1 + intensity * 0.5) + ')';

        var cell = mk('div'); cell.className = 'bt-month-cell'; cell.style.background = bg;
        cell.title = (mo.month || '') + ': ' + r + 'R (' + (mo.trades || 0) + ' trades, ' + (mo.wins || 0) + ' wins)';

        var lbl = mk('div'); lbl.className = 'bmc-label'; lbl.textContent = (mo.month || '').slice(5);
        var rv  = mk('div'); rv.className = 'bmc-r';
        rv.textContent = (r >= 0 ? '+' : '') + r + 'R';
        rv.style.color = r >= 0 ? '#00D68F' : '#FF4560';

        cell.appendChild(lbl); cell.appendChild(rv); grid.appendChild(cell);
      });
    }
    sec.appendChild(grid);
  }

  /* ── Trade log ── */
  function renderTrades(c, trades, totalCount) {
    var sec = mkSection(c, 'Trade Log', 'showing last ' + trades.length + ' of ' + totalCount + ' total');

    /* Controls */
    var ctrl = mk('div');
    ctrl.style.cssText = 'display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;align-items:center;';

    var si = mk('input'); si.type='text'; si.id='bt-trade-search'; si.placeholder='Filter ticker...';
    si.className='filter-input'; si.style.cssText='width:140px;font-size:10px;padding:3px 8px;';
    si.oninput = filterTrades;

    var ss = mk('select'); ss.id='bt-trade-sort'; ss.className='sort-btn';
    ss.style.cssText='height:26px;padding:0 6px;font-size:10px;';
    ss.onchange = sortTrades;
    [['date','Sort: Date'],['r','Best R'],['setup','Setup'],['ticker','Ticker']].forEach(function(o){
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
      var nm = mk('div'); nm.style.cssText='color:#6E7F99;padding:16px;font-size:11px;';
      nm.textContent = 'No trades to display.'; wrap.appendChild(nm); return;
    }
    var tbl = mkTable(['Date','Ticker','Setup','TF','Entry','SL','Target','Exit','R','Result','Bars','Patterns']);
    trades.forEach(function(t) {
      var col   = SETUP_COLORS[t.setup_id] || '#888';
      var isWin = t.outcome === 'win';
      var oc    = isWin ? '#00D68F' : '#FF4560';
      var r     = parseFloat(t.r_multiple || 0);
      appendRow(tbl, [
        { text: t.entry_date || '—' },
        { text: t.ticker || '—', bold: true },
        { text: 'S' + t.setup_id, color: col },
        { text: t.timeframe || '—' },
        { text: '$' + parseFloat(t.entry_price||0).toFixed(2) },
        { text: '$' + parseFloat(t.stop_loss||0).toFixed(2), color: '#FF4560' },
        { text: '$' + parseFloat(t.target||0).toFixed(2), color: '#60A5FA' },
        { text: '$' + parseFloat(t.exit_price||0).toFixed(2) },
        { text: (r >= 0 ? '+' : '') + r.toFixed(2) + 'R', color: oc, bold: true },
        { text: (t.outcome || 'open').toUpperCase(), color: oc, small: true },
        { text: t.bars_held || 0 },
        { text: (t.candle_patterns || []).join(', ') || '—', color: '#FACC15', small: true },
      ]);
    });
    wrap.appendChild(tbl);
  }

  /* Public: filter + sort trades */
  function filterTrades() {
    var q = (document.getElementById('bt-trade-search') || {}).value || '';
    q = q.toLowerCase();
    var filtered = q
      ? _allTrades.filter(function(t){ return (t.ticker||'').toLowerCase().indexOf(q) !== -1; })
      : _allTrades.slice();
    _trades = filtered;
    applySortRender(_trades);
  }

  function sortTrades() { applySortRender(_trades); }

  function applySortRender(trades) {
    var mode = ((document.getElementById('bt-trade-sort')||{}).value) || 'date';
    var s    = trades.slice();
    if (mode === 'r')      s.sort(function(a,b){ return b.r_multiple - a.r_multiple; });
    if (mode === 'setup')  s.sort(function(a,b){ return a.setup_id - b.setup_id; });
    if (mode === 'ticker') s.sort(function(a,b){ return (a.ticker||'').localeCompare(b.ticker||''); });
    var w = document.getElementById('bt-trade-table-wrap');
    if (w) buildTradeTable(w, s);
  }

  /* ── DOM helpers ── */
  function mk(tag) { return document.createElement(tag); }

  function mkSection(parent, title, hint) {
    var s = mk('div'); s.className = 'bt-section';
    var h = mk('div'); h.className = 'bt-section-title'; h.textContent = title;
    if (hint) {
      var hs = mk('span'); hs.className = 'bt-hint'; hs.textContent = ' ' + hint; h.appendChild(hs);
    }
    s.appendChild(h); parent.appendChild(s);
    return s;
  }

  function mkTable(headers) {
    var tbl  = mk('table'); tbl.className = 'bt-table';
    var head = tbl.createTHead();
    var hr   = head.insertRow();
    headers.forEach(function(h) { var th = mk('th'); th.textContent = h; hr.appendChild(th); });
    tbl.createTBody();
    return tbl;
  }

  function appendRow(tbl, cells) {
    var tr = tbl.tBodies[0].insertRow();
    cells.forEach(function(c) {
      var td = mk('td');
      td.textContent = (c && c.text !== undefined) ? c.text : (c || '');
      if (c && c.color)  td.style.color      = c.color;
      if (c && c.bold)   td.style.fontWeight  = '700';
      if (c && c.small)  td.style.fontSize    = '9px';
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

  return { open: open, close: close, run: run, cancel: cancel, filterTrades: filterTrades, sortTrades: sortTrades };

}());