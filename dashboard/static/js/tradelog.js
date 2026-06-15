/**
 * tradelog.js — Trade log panel: list trades, open/close/cancel, live P&L, stats
 */

const TradeLog = (() => {
  let trades = [];
  let statsInterval = null;

  async function refresh() {
    const [tradesData, statsData] = await Promise.all([
      App.fetchJSON('/api/trades?limit=100'),
      App.fetchJSON('/api/trades/stats'),
    ]);

    if (tradesData && tradesData.trades) {
      trades = tradesData.trades;
      renderTrades();
    }

    if (statsData) {
      renderStats(statsData);
    }
  }

  function renderStats(s) {
    setText('ts-total', s.total_trades);
    const wrEl = document.getElementById('ts-winrate');
    if (wrEl) {
      wrEl.textContent = s.win_rate + '%';
      wrEl.className = `ts-val ${s.win_rate >= 50 ? 'green' : 'red'}`;
    }
    const pnlEl = document.getElementById('ts-pnl');
    if (pnlEl) {
      pnlEl.textContent = (s.total_pnl >= 0 ? '+$' : '-$') + Math.abs(s.total_pnl).toFixed(2);
      pnlEl.className = `ts-val ${s.total_pnl >= 0 ? 'green' : 'red'}`;
    }
    const rEl = document.getElementById('ts-r');
    if (rEl) {
      rEl.textContent = (s.total_r >= 0 ? '+' : '') + s.total_r.toFixed(1) + 'R';
      rEl.className = `ts-val ${s.total_r >= 0 ? 'green' : 'red'}`;
    }
    const expEl = document.getElementById('ts-exp');
    if (expEl) {
      expEl.textContent = s.expectancy.toFixed(2) + 'R';
      expEl.className = `ts-val ${s.expectancy >= 0 ? 'green' : 'red'}`;
    }
  }

  function renderTrades() {
    const body = document.getElementById('tradelog-body');
    if (!body) return;
    if (!trades.length) {
      body.innerHTML = '<div class="empty-state-sm">No trades logged yet. Click + Trade on any setup card.</div>';
      return;
    }
    body.innerHTML = trades.map(t => buildTradeCard(t)).join('');
  }

  function buildTradeCard(t) {
    const statusClass = t.status === 'closed_win' ? 'win' : t.status === 'closed_loss' ? 'loss' : t.status;
    const statusBadge = t.status.replace('_', ' ').toUpperCase();
    const isOpen = t.status === 'open';
    const isPending = t.status === 'pending';
    const isClosed = t.status.startsWith('closed');

    const pnlColor = t.pnl > 0 ? 'var(--green)' : t.pnl < 0 ? 'var(--red)' : 'var(--text2)';
    const pnlSign = t.pnl > 0 ? '+' : '';

    const flags = [];
    if (t.htf_confluent) flags.push('<span class="flag flag-htf">HTF ✓</span>');
    if (t.order_block)   flags.push('<span class="flag flag-ob">OB ✓</span>');

    const actions = [];
    if (isPending) {
      actions.push(`<button class="tc-btn tc-btn-open" onclick="TradeLog.openTrade('${t.id}', ${t.entry})">Mark Open</button>`);
      actions.push(`<button class="tc-btn tc-btn-cancel" onclick="TradeLog.cancelTrade('${t.id}')">Cancel</button>`);
    }
    if (isOpen) {
      actions.push(`<button class="tc-btn tc-btn-close" onclick="TradeLog.closeTrade('${t.id}', ${t.target})">Close at TP</button>`);
      actions.push(`<button class="tc-btn tc-btn-cancel" onclick="TradeLog.closeTrade('${t.id}', ${t.stop_loss})">Close at SL</button>`);
    }

    const created = new Date(t.created_at).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    return `
    <div class="trade-card ${statusClass}" id="tc-${t.id}">
      <div class="tc-top">
        <div style="display:flex;align-items:center;gap:8px">
          <span class="tc-ticker">${t.ticker}</span>
          <span class="setup-badge sb-${t.setup_id}" style="font-size:9px">Setup ${t.setup_id}</span>
          <span style="font-size:9px;color:var(--text3)">[${t.timeframe}]</span>
        </div>
        <span class="tc-status st-${t.status}">${statusBadge}</span>
      </div>

      <div class="tc-meta">
        <span class="tcm">Entry: <span>$${t.entry.toFixed(2)}</span></span>
        <span class="tcm">SL: <span style="color:var(--red)">$${t.stop_loss.toFixed(2)}</span></span>
        <span class="tcm">TP: <span style="color:var(--blue)">$${t.target.toFixed(2)}</span></span>
        <span class="tcm">R/R: <span>${t.risk_reward}R</span></span>
        <span class="tcm">Risk: <span>$${t.risk_amount.toFixed(2)}</span></span>
        <span class="tcm">Shares: <span>${t.position_size.toFixed(1)}</span></span>
        ${isClosed ? `<span class="tcm">P&L: <span style="color:${pnlColor}">${pnlSign}$${Math.abs(t.pnl).toFixed(2)} (${pnlSign}${t.pnl_r.toFixed(1)}R)</span></span>` : ''}
      </div>

      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <div class="flag-row" style="flex:1">${flags.join('')}</div>
        <div class="tc-actions">${actions.join('')}</div>
        <span style="font-size:9px;color:var(--text3);margin-left:auto">${created}</span>
      </div>
      ${t.notes ? `<div style="font-size:10px;color:var(--text2);margin-top:2px">📝 ${t.notes}</div>` : ''}
    </div>`;
  }

  async function openTrade(id, openPrice) {
    const price = parseFloat(prompt(`Open price for trade (suggested: $${openPrice.toFixed(2)}):`, openPrice.toFixed(2)));
    if (isNaN(price)) return;
    await App.fetchJSON(`/api/trades/${id}/open`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ open_price: price }),
    });
    await refresh();
  }

  async function closeTrade(id, suggestedPrice) {
    const price = parseFloat(prompt(`Close price (suggested: $${suggestedPrice.toFixed(2)}):`, suggestedPrice.toFixed(2)));
    if (isNaN(price)) return;
    await App.fetchJSON(`/api/trades/${id}/close`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ close_price: price }),
    });
    await refresh();
  }

  async function cancelTrade(id) {
    if (!confirm('Cancel this trade?')) return;
    await App.fetchJSON(`/api/trades/${id}`, { method: 'DELETE' });
    await refresh();
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  return { refresh, openTrade, closeTrade, cancelTrade };
})();
