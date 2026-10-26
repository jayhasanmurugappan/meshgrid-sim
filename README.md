# ⚡ Meshgrid Sim | India 4.O Alliance

A decentralised, multi-source campus microgrid simulator. ☀️ Solar, 🔋 battery storage, 🏥 critical loads and the utility grid share power over MeshNet 🌐, a self-healing data mesh. The India 4.O Alliance acts as the power bank 🏦: it records every energy trade, bills each node and keeps a tamper-evident ledger. 🔌 Simulate outages, cloud cover and node failures, then watch critical loads stay on. A live laptop-battery mode turns your own device into the BESS. 🛡️ Built on the ISGRS hospital smart-grid concept by Omprasad Tandale and team.

© India 4.O Alliance. All rights reserved.

## What is in this repo
| File | Purpose |
|---|---|
| `index.html`, `styles.css` | Gate screen and simulator layout |
| `gate.js`, `config.js` | Cloudflare Turnstile check + access code (no secrets stored) |
| `app.js` | Simulation engine, MeshNet routing, Alliance ledger and billing, live battery mode |
| `robots.txt` | Disallows all crawlers and known AI bots |
| `CLOUDFLARE.md` | Cloudflare proxy, WAF and bot settings to apply |
| `.github/workflows/pages.yml` | Manual-only Pages deploy (does nothing until you run it) |

## Merit order (per 5 simulated minutes)
Peer-to-peer trade, then own banked credits, then Hub pool, then utility grid, then diesel (islanded only), then load shed. Tier 1 (hospital) is never shed and may use the Hub reserve.

## Run locally
Open `index.html` in Chrome or Edge. Open `index.html#test` to expose `window.__MG` for testing.

## Honest limits
The simulator runs in the browser, so a determined visitor can read it. Real protection comes from the Cloudflare layer, and from moving the ledger and tariff rules to a server (Cloudflare Worker) in the next phase. Prices and loads are illustrative.
