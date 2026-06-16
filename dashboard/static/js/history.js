/**
 * history.js — Setup History Log
 * Fetches /api/history and renders a searchable, filterable log panel
 * showing every setup detection event with full trade details.
 */

const History = (() => {
  let _history = [];
  let _filterText = '';
  let _filterTF = '';
  let _filterSetup = '';

  const SETUP_COLORS = { 1:'#0EA5E9', 2:'#A855F7', 3:'#F59E0B', 4:'#FF4560', 5:'#22d3ee' };
  const EVENT_META = {
    detected:    { label: 'DETECTED',    color: '#00D68F' },
    stopped_out: { label: 'STOPPED OUT', color: '#FF4560' },
    target_hit:  { label: 'TARGET HIT',  color: '#60A5FA' },
    expired:     { label: 'EXPIRED',     color: '#6E7F99' },
  };

  function fmtDt(iso) {
    if (!iso) return '—';
    const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'));
    if (isNaN(d)) return iso;
    return d.toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit',
      minute: '2-digit', hour12: false,
    });
  }

  function fmtPrice(v) {
    return v != null ? `$${Number(v).toFixed(2)}` : '—';
  }

  async function load() {
    const body = document.getElementById('history-body');
    if (!body) return;
    body.innerHTML = '<div class="empty-state-sm">Loading...</div>';

    try {
      const data = await App.fetchJSON('/api/history?limit=300');
      _history = data?.history || [];
    } catch (e) {
      body.innerHTML = `<div class="empty-state-sm" style="color:var(--red)">Failed to load history: ${e.message}</div>`;
      return;
    }

    updateStats();
    render();
  }

  function updateStats() {
    const total    = _history.length;
    const tickers  = new Set(_history.map(r => r.ticker)).size;
    const today    = new Date().toDateString();
    const todayCt  = _history.filter(r => new Date(r.logged_at + 'Z').toDateString() === today).length;
    const htfCt    = _history.filter(r => r.htf_confluent).length;

    document.getElementById('hs-total').textContent   = total;
    document.getElementById('hs-tickers').textContent = tickers;
    document.getElementById('hs-today').textContent   = todayCt;
    document.getElementById('hs-htf').textContent     = htfCt;
  }

  function render() {
    const body = document.getElementById('history-body');
    if (!body) return;

    const q  = _filterText.toLowerCase();
    const filtered = _history.filter(r => {
      if (q && !r.ticker.toLowerCase().includes(q) &&
               !(r.setup_name||'').toLowerCase().includes(q)) return false;
      if (_filterTF    && r.timeframe !== _filterTF)           return false;
      if (_filterSetup && String(r.setup_id) !== _filterSetup) return false;
      return true;
    });

    if (!filtered.length) {
      body.innerHTML = '<div class="empty-state-sm">No history entries match filters.</div>';
      return;
    }

    body.innerHTML = filtered.map(r => buildRow(r)).join('');
  }

  function buildRow(r) {
    const ev   = EVENT_META[r.event] || { label: r.event.toUpperCase(), color: '#888' };
    const sc   = SETUP_COLORS[r.setup_id] || '#888';
    const htf  = r.htf_confluent ? '<span class="flag flag-htf" style="font-size:9px">HTF</span>' : '';
    const ob   = r.order_block   ? '<span class="flag flag-ob" style="font-size:9px">OB</span>'  : '';
    const sh   = r.stop_hunt_risk? '<span class="flag flag-sh" style="font-size:9px">SH!</span>' : '';

    return `
    <div class="hist-row" data-id="${r.id}">
      <div class="hist-top">
        <div class="hist-left">
          <span class="hist-ticker">${r.ticker}</span>
          <span class="hist-badge" style="color:${sc};border-color:${sc}40;background:${sc}18">${r.timeframe} · S${r.setup_id}</span>
          <span class="hist-event" style="color:${ev.color};border-color:${ev.color}40;background:${ev.color}15">${ev.label}</span>
          ${htf}${ob}${sh}
        </div>
        <div class="hist-time">${fmtDt(r.logged_at)}</div>
      </div>
      <div class="hist-name">${r.setup_name || '—'}</div>
      <div class="hist-meta">
        <span class="hm"><span class="hm-k">Price</span> ${fmtPrice(r.price)}</span>
        <span class="hm"><span class="hm-k">Entry</span> <span style="color:var(--green)">${fmtPrice(r.entry)}</span></span>
        <span class="hm"><span class="hm-k">SL</span>    <span style="color:var(--red)">${fmtPrice(r.stop_loss)}</span></span>
        <span class="hm"><span class="hm-k">Target</span><span style="color:#60A5FA">${fmtPrice(r.target)}</span></span>
        <span class="hm"><span class="hm-k">R/R</span>   ${r.risk_reward ?? '—'}R</span>
        <span class="hm"><span class="hm-k">Fib</span>   ${r.fib_entry_pct ?? '—'}%</span>
        <span class="hm"><span class="hm-k">HTF</span>   ${r.htf_trend || '—'}</span>
      </div>
    </div>`;
  }

  function filter() {
    _filterText  = (document.getElementById('hist-search')?.value || '').trim();
    _filterTF    = document.getElementById('hist-tf-filter')?.value || '';
    _filterSetup = document.getElementById('hist-setup-filter')?.value || '';
    render();
  }

  async function clear() {
    if (!confirm('Clear all setup history? This cannot be undone.')) return;
    // No DELETE endpoint yet — just clear in-memory UI and show empty
    _history = [];
    updateStats();
    render();
  }

  return { load, filter, clear };
})();
