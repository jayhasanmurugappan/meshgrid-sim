# Cloudflare protection checklist (apply in the dashboard)
1. DNS: proxied (orange cloud) record for the site hostname.
2. Security > Bots: Bot Fight Mode ON, Block AI bots ON.
3. Security > WAF > Custom rules: Managed Challenge when `cf.client.bot` is false and the request is not a normal browser, plus a rate-limit rule (for example 60 requests/minute per IP).
4. Scrape Shield: Email Obfuscation ON, Hotlink Protection ON.
5. Turnstile: create a widget for the hostname, put the public site key in `config.js`.
6. Next phase: verify the Turnstile token server-side in a Cloudflare Worker (needs the Turnstile secret key, stored as a Worker/GitHub secret, never in this repo) and serve ledger and tariff rules from the Worker.
