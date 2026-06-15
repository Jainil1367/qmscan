# Deploying QMScan to a Free Public URL (Render.com)

This gives you a live URL like `https://qmscan.onrender.com` running the
scanner + dashboard 24/7 (with free-tier sleep after inactivity).

## 1. Push the project to GitHub

```bash
cd qmscan
git init
git add .
git commit -m "QMScan — initial deploy"
gh repo create qmscan --public --source=. --push
# or manually create a repo on github.com and:
# git remote add origin https://github.com/<you>/qmscan.git
# git push -u origin main
```

**Important — before pushing**, make sure `.gitignore` excludes:
```
venv/
.venv/
__pycache__/
*.pyc
logs/
trades/*.db
.env
```
(Never commit your `.env` — Render lets you set env vars in its dashboard.)

## 2. Create the Render Web Service

1. Go to **https://render.com** and sign up / log in (free, GitHub login works).
2. Click **New +** → **Web Service**.
3. Connect your GitHub account and select the `qmscan` repo.
4. Render will detect `render.yaml` automatically (Blueprint). If it asks,
   confirm "Apply render.yaml".
5. If configuring manually instead, use these settings:
   - **Runtime**: Python 3
   - **Build Command**: `pip install -r requirements-deploy.txt`
   - **Start Command**: `python run.py`
   - **Plan**: Free
6. Click **Create Web Service**.

## 3. Wait for the build

The first build takes 2–5 minutes (installing pandas/numpy/yfinance).
Once live, Render gives you a free URL:

```
https://qmscan-XXXX.onrender.com
```

Open it — your dashboard, scanner, and WebSocket live updates all run there.

## 4. (Optional) Custom domain

Render free tier supports custom domains at no extra cost:

1. Buy a cheap domain (Namecheap / Porkbun / Cloudflare — usually $1–12/yr
   for `.xyz`, `.dev`, `.app`, etc. True "free" domains like `.tk`/`.ml` are
   unreliable and not recommended for anything you care about).
2. In Render: **Settings → Custom Domains → Add Custom Domain**.
3. Add the CNAME/A record Render gives you to your domain's DNS settings.
4. Render auto-provisions a free SSL certificate (Let's Encrypt) — usually
   live within 15–60 minutes.

## Notes & Limitations on Free Tier

- **Sleep on inactivity**: Render free web services spin down after ~15 min
  with no HTTP traffic, then take ~30-60s to wake on the next request. The
  background scanner loop pauses while asleep. To keep it always-on, either
  upgrade to a paid instance (~$7/mo) or use a free uptime-pinger
  (e.g. UptimeRobot hitting `/` every 10 minutes) — note this uses your
  free usage hours.
- **Ephemeral disk**: `trades/trades.db` and `logs/qmscan.log` reset on every
  redeploy/restart. For persistent trade history, either:
  - Upgrade to a Render paid plan with a persistent disk, or
  - Point `trade_store.py`'s `DB_PATH` at an external database
    (e.g. a free PostgreSQL instance on Render/Neon/Supabase).
- **Desktop alerts disabled**: `pygame` sound alerts and `plyer` push
  notifications only work on a desktop OS, so they're excluded from
  `requirements-deploy.txt` and disabled via env vars (`ENABLE_SOUND_ALERTS`,
  `ENABLE_PUSH_ALERTS` = `false`). The dashboard's in-browser alerts panel
  still works normally.
- **yfinance rate limits**: Yahoo Finance may rate-limit frequent requests
  from cloud IPs more aggressively than residential IPs. If you see data
  gaps, increase `SCAN_INTERVAL_SECONDS` (env var) to 90–120s.

## Updating after changes

Any `git push` to your connected branch triggers an automatic redeploy
(if `autoDeploy: true`, which `render.yaml` sets by default).
