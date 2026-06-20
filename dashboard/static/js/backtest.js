/**
 * backtest.js — Complete Backtest Panel
 *
 * Features:
 *  - Run / cancel controls with progress bar
 *  - Summary KPI cards: win rate, profit factor, max DD, avg R, Sharpe
 *  - Equity curve (Lightweight Charts)
 *  - Breakdown tables: by setup, by timeframe, by ticker
 *  - Monthly returns heatmap
 *  - Trade log with filter + sort
 *  - Swing High / Low, CHoCH, HH visualisation notes per trade
 */

const Backtest = (() => {

  const SETUP_COLORS = { 2: '#A855F7', 3: '#F59E0B', 4: '#FF4560' };
  const SETUP_NAMES  = { 2: 'Typical', 3: 'Golden Zone', 4: 'Deep' };

  let _results   = null;
  let _trades    = [];
  let _pollTimer = null;
  let _eqChart   = null;
  let _tradeFilter = '';
  let _tradeSort   = 'date';

  // ── Open / Close panel ────────────────────────────────────────────────────
  function open() {
    const panel = document.getElementById('bt-panel');
    if (!panel) {
      console.error('bt-panel element not found in DOM');
      return;
    }
    panel.classList.add('open');
    // Only poll if a run is already in progress (don't auto-poll on fresh open)
    App.fetchJSON('/api/backtest/status').then(data => {
      if (!data) return;
      _setStatus(data.message || 'Ready.', data.progress || 0);
      if (data.status === 'running') {
        _setRunning(true);
        _startPolling();
      } else if (data.status === 'done' && data.has_results) {
        _loadResults();
      }
    });
  }

  function close() {
    const panel = document.getElementById('bt-panel');
    if (panel) panel.classList.remove('open');
    clearInterval(_pollTimer);
  }

  // ── Run / Cancel ──────────────────────────────────────────────────────────
  async function run() {
    const tickers  = (document.getElementById('bt-tickers').value || '').trim();
    const tfsChecked = [...document.querySelectorAll('.bt-tf-check:checked')].map(c => c.value);
    const maxT = parseInt(document.getElementById('bt-max-tickers').value || '50');

    if (!tfsChecked.length) { alert('Select at least one timeframe.'); return; }

    _setRunning(true);
    _clearResults();

    const body = {
      tickers:     tickers ? tickers.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) : [],
      timeframes:  tfsChecked,
      max_tickers: maxT,
    };

    await App.fetchJSON('/api/backtest/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    _startPolling();
  }

  async function cancel() {
    await App.fetchJSON('/api/backtest/cancel', { method: 'POST' });
    clearInterval(_pollTimer);
    _setRunning(false);
    _setStatus('Cancelled.', 0);
  }

  // ── Polling ───────────────────────────────────────────────────────────────
  function _startPolling() {
    clearInterval(_pollTimer);
    _pollTimer = setInterval(_pollStatus, 1500);
  }

  async function _pollStatus() {
    const data = await App.fetchJSON('/api/backtest/status');
    if (!data) return;

    _setStatus(data.message, data.progress);

    if (data.status === 'done') {
      clearInterval(_pollTimer);
      _setRunning(false);
      await _loadResults();
    } else if (data.status === 'error') {
      clearInterval(_pollTimer);
      _setRunning(false);
      _setStatus('Error: ' + data.message, 0);
    } else if (data.status === 'idle' && !data.has_results) {
      clearInterval(_pollTimer);
      _setRunning(false);
    }
  }

  async function _loadResults() {
    const data = await App.fetchJSON('/api/backtest/results');
    if (!data) return;
    _results = data;
    _trades  = data.trades || [];
    _renderResults(data);
  }

  // ── Status helpers ────────────────────────────────────────────────────────
  function _setRunning(running) {
    document.getElementById('bt-run-btn').disabled    = running;
    document.getElementById('bt-cancel-btn').disabled = !running;
    document.getElementById('bt-run-btn').textContent = running ? 'Running...' : 'Run Backtest';
  }

  function _setStatus(msg, pct) {
    const el = document.getElementById('bt-status-msg');
    const bar = document.getElementById('bt-progress-fill');
    if (el)  el.textContent = msg;
    if (bar) bar.style.width = pct + '%';
  }

  function _clearResults() {
    document.getElementById('bt-results').innerHTML = '';
    document.getElementById('bt-eq-container').innerHTML = '';
  }

  // ── Render all results ────────────────────────────────────────────────────
  function _renderResults(data) {
    const m = data.metrics;
    const r = document.getElementById('bt-results');

    // ── KPI cards ─────────────────────────────────────────────────────────
    const wr = m.win_rate ?? 0;
    const pf = m.profit_factor === Infinity ? '∞' : (m.profit_factor ?? 0).toFixed(2);
    const kpiHtml = `
    <div class="bt-kpi-row">
      ${_kpi('Total Trades',    m.total_trades,           '#D0D8E8')}
      ${_kpi('Win Rate',        wr.toFixed(1) + '%',      wr >= 55 ? '#00D68F' : wr >= 45 ? '#F59E0B' : '#FF4560')}
      ${_kpi('Profit Factor',   pf,                       m.profit_factor >= 1.5 ? '#00D68F' : m.profit_factor >= 1.0 ? '#F59E0B' : '#FF4560')}
      ${_kpi('Avg R Multiple',  (m.avg_r ?? 0).toFixed(2) + 'R', m.avg_r >= 0 ? '#00D68F' : '#FF4560')}
      ${_kpi('Max Drawdown',    m.max_drawdown_pct.toFixed(1) + '%', m.max_drawdown_pct <= 20 ? '#00D68F' : m.max_drawdown_pct <= 40 ? '#F59E0B' : '#FF4560')}
      ${_kpi('Sharpe Ratio',    (m.sharpe_ratio ?? 0).toFixed(2), m.sharpe_ratio >= 1 ? '#00D68F' : m.sharpe_ratio >= 0.5 ? '#F59E0B' : '#FF4560')}
      ${_kpi('Total R',         (m.total_r ?? 0).toFixed(1) + 'R', m.total_r >= 0 ? '#00D68F' : '#FF4560')}
      ${_kpi('Best Trade',      (m.best_trade_r ?? 0).toFixed(2) + 'R',  '#00D68F')}
      ${_kpi('Worst Trade',     (m.worst_trade_r ?? 0).toFixed(2) + 'R', '#FF4560')}
      ${_kpi('Avg Bars Held',   (m.avg_bars_held ?? 0).toFixed(1),        '#D0D8E8')}
    </div>`;

    // ── Equity curve ───────────────────────────────────────────────────────
    const eqHtml = `
    <div class="bt-section">
      <div class="bt-section-title">Equity Curve <span class="bt-hint">(1% risk per trade, $10k start)</span></div>
      <div id="bt-eq-inner" style="height:220px;background:#0D1219;border-radius:8px"></div>
    </div>`;

    // ── Setup breakdown ────────────────────────────────────────────────────
    const setupRows = Object.entries(m.by_setup || {}).map(([sid, s]) => {
      const col = SETUP_COLORS[sid] || '#888';
      return `<tr>
        <td><span style="color:${col}">S${sid} ${s.name}</span></td>
        <td>${s.total}</td>
        <td>${s.wins}</td>
        <td style="color:${s.win_rate>=50?'#00D68F':'#FF4560'}">${s.win_rate}%</td>
        <td style="color:${s.avg_r>=0?'#00D68F':'#FF4560'}">${s.avg_r}R</td>
        <td>${s.profit_factor}</td>
      </tr>`;
    }).join('');

    const tfRows = Object.entries(m.by_timeframe || {}).map(([tf, s]) => `
      <tr>
        <td>${tf}</td><td>${s.total}</td><td>${s.wins}</td>
        <td style="color:${s.win_rate>=50?'#00D68F':'#FF4560'}">${s.win_rate}%</td>
        <td style="color:${s.avg_r>=0?'#00D68F':'#FF4560'}">${s.avg_r}R</td>
      </tr>`).join('');

    const tickerRows = Object.entries(m.by_ticker || {}).map(([tk, s]) => `
      <tr>
        <td><strong>${tk}</strong></td><td>${s.total}</td><td>${s.wins}</td>
        <td style="color:${s.win_rate>=50?'#00D68F':'#FF4560'}">${s.win_rate}%</td>
        <td style="color:${s.avg_r>=0?'#00D68F':'#FF4560'}">${s.avg_r}R</td>
        <td style="color:${s.total_r>=0?'#00D68F':'#FF4560'}">${s.total_r}R</td>
      </tr>`).join('');

    const breakdownHtml = `
    <div class="bt-breakdown-row">
      <div class="bt-section">
        <div class="bt-section-title">By Setup</div>
        <table class="bt-table">
          <thead><tr><th>Setup</th><th>Trades</th><th>Wins</th><th>Win%</th><th>Avg R</th><th>PF</th></tr></thead>
          <tbody>${setupRows || '<tr><td colspan="6" style="color:#6E7F99">No data</td></tr>'}</tbody>
        </table>
      </div>
      <div class="bt-section">
        <div class="bt-section-title">By Timeframe</div>
        <table class="bt-table">
          <thead><tr><th>TF</th><th>Trades</th><th>Wins</th><th>Win%</th><th>Avg R</th></tr></thead>
          <tbody>${tfRows || '<tr><td colspan="5" style="color:#6E7F99">No data</td></tr>'}</tbody>
        </table>
      </div>
    </div>
    <div class="bt-section">
      <div class="bt-section-title">By Ticker (top 15)</div>
      <table class="bt-table">
        <thead><tr><th>Ticker</th><th>Trades</th><th>Wins</th><th>Win%</th><th>Avg R</th><th>Total R</th></tr></thead>
        <tbody>${tickerRows || '<tr><td colspan="6" style="color:#6E7F99">No data</td></tr>'}</tbody>
      </table>
    </div>`;

    // ── Monthly returns heatmap ────────────────────────────────────────────
    const monthlyHtml = _buildMonthlyHeatmap(m.monthly_returns || []);

    // ── Trade log ─────────────────────────────────────────────────────────
    const tradeLogHtml = `
    <div class="bt-section">
      <div class="bt-section-title">
        Trade Log <span class="bt-hint">(${data.trade_count} total, showing last ${_trades.length})</span>
        <input type="text" class="filter-input" id="bt-trade-search" placeholder="Filter ticker..."
               oninput="Backtest.filterTrades()" style="width:150px;font-size:10px;padding:3px 8px;margin-left:10px">
        <select class="sort-btn" id="bt-trade-sort" onchange="Backtest.sortTrades()" style="margin-left:6px;height:24px;padding:0 6px;font-size:10px">
          <option value="date">Date</option>
          <option value="r">R Multiple</option>
          <option value="setup">Setup</option>
          <option value="ticker">Ticker</option>
        </select>
      </div>
      <div id="bt-trade-table-wrap">
        ${_buildTradeTable(_trades)}
      </div>
    </div>`;

    r.innerHTML = kpiHtml + eqHtml + breakdownHtml + monthlyHtml + tradeLogHtml;

    // Render equity chart
    _renderEquityCurve(m.equity_curve || []);
  }

  // ── Equity curve with LWC ─────────────────────────────────────────────────
  function _renderEquityCurve(curve) {
    const el = document.getElementById('bt-eq-inner');
    if (!el || !curve.length) return;
    if (_eqChart) { try { _eqChart.remove(); } catch (_) {} _eqChart = null; }

    try {
      const chart = LightweightCharts.createChart(el, {
        width: el.clientWidth || 800,
        height: 220,
        layout: { background: { type: 'solid', color: '#0D1219' }, textColor: '#D0D8E8', fontSize: 10 },
        grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
        rightPriceScale: { borderVisible: false, textColor: '#D0D8E8' },
        timeScale: { borderVisible: false, timeVisible: true, textColor: '#D0D8E8' },
        crosshair: {
          mode: LightweightCharts.CrosshairMode.Normal,
          vertLine: { color: 'rgba(255,255,255,0.2)', style: 1, labelBackgroundColor: '#1C2535' },
          horzLine: { color: 'rgba(255,255,255,0.2)', style: 1, labelBackgroundColor: '#1C2535' },
        },
        handleScroll: { mouseWheel: true, pressedMouseMove: true },
        handleScale:  { mouseWheel: true, pinch: true },
      });

      // Area series for equity
      const areaSeries = chart.addAreaSeries({
        lineColor:   '#3B8BD4',
        topColor:    'rgba(59,139,212,0.25)',
        bottomColor: 'rgba(59,139,212,0.0)',
        lineWidth: 2,
        priceFormat: { type: 'price', precision: 0, minMove: 1 },
      });

      // Build sequential time-indexed data for the equity curve
      const now = Math.floor(Date.now() / 1000);
      const data = [];
      const secPerBar = 86400;

      curve.forEach((v, i) => {
        data.push({ time: now - (curve.length - i) * secPerBar, value: v });
      });

      areaSeries.setData(data);

      // Draw $10k baseline
      areaSeries.createPriceLine({
        price: 10000,
        color: 'rgba(255,255,255,0.2)',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: 'Start $10k',
      });

      chart.timeScale().fitContent();

      new ResizeObserver(entries => {
        for (const e of entries) { try { chart.applyOptions({ width: e.contentRect.width }); } catch (_) {} }
      }).observe(el);

      _eqChart = chart;
    } catch (e) { console.error('Equity chart error:', e); }
  }

  // ── Monthly returns heatmap ───────────────────────────────────────────────
  function _buildMonthlyHeatmap(monthly) {
    if (!monthly.length) return '';
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const cells = monthly.slice(-24).map(m => {
      const r = m.total_r;
      const intensity = Math.min(1, Math.abs(r) / 5);
      const bg = r >= 0
        ? `rgba(0,214,143,${0.1 + intensity * 0.5})`
        : `rgba(255,69,96,${0.1 + intensity * 0.5})`;
      const label = m.month ? m.month.slice(0, 7) : '';
      return `<div class="bt-month-cell" style="background:${bg}" title="${label}: ${r}R (${m.trades} trades, ${m.wins}W)">
        <div class="bmc-label">${label.slice(5)}</div>
        <div class="bmc-r" style="color:${r>=0?'#00D68F':'#FF4560'}">${r >= 0 ? '+' : ''}${r}R</div>
      </div>`;
    }).join('');

    return `<div class="bt-section">
      <div class="bt-section-title">Monthly Returns (last 24 months)</div>
      <div class="bt-month-grid">${cells}</div>
    </div>`;
  }

  // ── Trade table ───────────────────────────────────────────────────────────
  function _buildTradeTable(trades) {
    if (!trades.length) return '<div style="color:#6E7F99;padding:16px">No trades</div>';
    const rows = trades.map(t => {
      const col = SETUP_COLORS[t.setup_id] || '#888';
      const outcomeCol = t.outcome === 'win' ? '#00D68F' : '#FF4560';
      const patterns = (t.candle_patterns || []).join(', ') || '—';
      return `<tr>
        <td>${t.entry_date}</td>
        <td><strong>${t.ticker}</strong></td>
        <td><span style="color:${col}">S${t.setup_id}</span></td>
        <td>${t.timeframe}</td>
        <td>$${t.entry_price.toFixed(2)}</td>
        <td style="color:#FF4560">$${t.stop_loss.toFixed(2)}</td>
        <td style="color:#60A5FA">$${t.target.toFixed(2)}</td>
        <td>$${t.exit_price.toFixed(2)}</td>
        <td style="color:${outcomeCol};font-weight:700">${t.r_multiple >= 0 ? '+' : ''}${t.r_multiple}R</td>
        <td style="color:${outcomeCol};text-transform:uppercase;font-size:9px">${t.outcome}</td>
        <td>${t.bars_held}</td>
        <td style="color:#FACC15;font-size:9px">${patterns}</td>
      </tr>`;
    }).join('');

    return `<div style="overflow-x:auto">
    <table class="bt-table">
      <thead><tr>
        <th>Date</th><th>Ticker</th><th>Setup</th><th>TF</th>
        <th>Entry</th><th>SL</th><th>Target</th><th>Exit</th>
        <th>R</th><th>Result</th><th>Bars</th><th>Patterns</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  }

  function filterTrades() {
    _tradeFilter = (document.getElementById('bt-trade-search')?.value || '').toLowerCase();
    _refreshTradeTable();
  }

  function sortTrades() {
    _tradeSort = document.getElementById('bt-trade-sort')?.value || 'date';
    _refreshTradeTable();
  }

  function _refreshTradeTable() {
    let t = [..._trades];
    if (_tradeFilter) t = t.filter(x => x.ticker.toLowerCase().includes(_tradeFilter));
    if (_tradeSort === 'r')      t.sort((a, b) => b.r_multiple - a.r_multiple);
    if (_tradeSort === 'setup')  t.sort((a, b) => a.setup_id - b.setup_id);
    if (_tradeSort === 'ticker') t.sort((a, b) => a.ticker.localeCompare(b.ticker));
    const wrap = document.getElementById('bt-trade-table-wrap');
    if (wrap) wrap.innerHTML = _buildTradeTable(t);
  }

  // ── Helper: KPI card ──────────────────────────────────────────────────────
  function _kpi(label, value, color) {
    return `<div class="bt-kpi-card">
      <div class="bt-kpi-label">${label}</div>
      <div class="bt-kpi-value" style="color:${color}">${value}</div>
    </div>`;
  }

  return { open, close, run, cancel, filterTrades, sortTrades };
})();
