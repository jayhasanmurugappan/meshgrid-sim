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
| `.github/workflows/pages.yml` | Manual-only GitHub Pages deploy (does nothing until you run it) |
| `.github/workflows/cloudflare-pages.yml` | Manual-only Cloudflare Pages deploy (needs `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) |

## Merit order (per 5 simulated minutes)
Peer-to-peer trade, then own banked credits, then Hub pool, then utility grid, then diesel (islanded only), then load shed. Tier 1 (hospital) is never shed and may use the Hub reserve.

## Run locally
Open `index.html` in Chrome or Edge. Open `index.html#test` to expose `window.__MG` for testing.

## Phase 2 emulation
Phase 2 links the simulator to real hardware signals, one source at a time. Each step is a panel in the side bar.

| Panel | Signal | Status |
|---|---|---|
| Live battery | This device's battery level drives the Hub BESS; unplugging the charger = grid outage | Done (Phase 1) |
| Manual battery slider | Same as above for browsers without the Battery API (Firefox, Safari) | Done (Phase 1) |
| Phone as a node | A second phone's battery joins as an extra node over a shared session code | Planned |
| Smart plug / energy meter | Real kW reading from one plug feeds one node's load | Planned |
| Server-side ledger | Ledger and tariffs come from the Cloudflare Worker, not the page | Draft (Worker repo) |

## 5-minute demo script
| Time | Do | Say |
|---|---|---|
| 0:00 | Open the site, pass the Cloudflare check, enter the access code | "Only invited people get in; bots are stopped at the door." |
| 0:30 | Point at the map and the KPI row | "Ten nodes: hospital, hostel, labs, wind, solar, the Alliance Hub battery, diesel and the grid." |
| 1:00 | Speed: Fast · 60 min/s | "Watch a day pass. Surplus nodes sell to deficit nodes peer-to-peer first." |
| 1:45 | Click **Grid outage** | "The utility grid fails. The campus islands within seconds." |
| 2:15 | Point at **Critical load served = 100%** | "The hospital is never shed. Non-essential loads go first." |
| 2:45 | Click **Cut Hub–Hospital link**, then **Drop Library radio** | "MeshNet heals itself and reroutes around the failure." (see Event log) |
| 3:30 | Tick **Use this device's battery**, unplug the laptop charger | "This laptop is now the Hub battery. Unplugging it is a real outage." |
| 4:15 | Click **Verify chain**, then **Tamper test** | "Every 15 minutes the Alliance seals a ledger block. Change one number and the chain breaks." |
| 4:45 | Show **Alliance statements** | "Each node gets a bill or a payout. That is the Alliance's business model." |

Before the demo: plug in the laptop, use Chrome or Edge, and click **Reset**.

## Honest limits
The simulator runs in the browser, so a determined visitor can read it. Real protection comes from the Cloudflare layer, and from moving the ledger and tariff rules to a server (Cloudflare Worker) in the next phase. Prices and loads are illustrative.
