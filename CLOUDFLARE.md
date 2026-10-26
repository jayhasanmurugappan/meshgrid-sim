# Cloudflare dashboard checklist

Open https://dash.cloudflare.com, pick your account, then your domain (zone). Do the steps in order.

## 1. DNS: proxy the site
**DNS > Records** > find the site hostname > **Edit** > Proxy status: **Proxied** (orange cloud) > **Save**.
(Pages custom domains are proxied automatically.)

## 2. Bot Fight Mode
**Security > Bots** > **Bot Fight Mode**: turn **On**.
(On newer dashboards: **Security > Settings > Bot traffic > Bot fight mode**.)

## 3. Block AI bots
**Security > Bots** > **Block AI Bots**: choose **Block on all pages** > **Save**.
Also on the same page: **AI Labyrinth** On (optional), **Manage your robots.txt**: "Instruct AI bot traffic with robots.txt".

## 4. WAF rate-limit rule
**Security > WAF > Rate limiting rules** > **Create rule**
- Rule name: `meshgrid-sim rate limit`
- If incoming requests match: **Edit expression**, paste:

```
(http.host eq "YOUR-HOSTNAME")
```

- With the same characteristics: **IP**
- When rate exceeds: **60** requests per **1 minute** (Free plan: period 10 s, so use **10** requests per **10 seconds**)
- Then take action: **Block**, duration **1 minute** (Free plan: 10 s)
- **Deploy**

## 5. WAF custom rule (challenge non-browsers)
**Security > WAF > Custom rules** > **Create rule**
- Rule name: `meshgrid-sim challenge`
- **Edit expression**, paste:

```
(http.host eq "YOUR-HOSTNAME" and not cf.client.bot and not http.request.uri.path in {"/robots.txt"} and (http.user_agent eq "" or lower(http.user_agent) contains "curl" or lower(http.user_agent) contains "python" or lower(http.user_agent) contains "wget" or lower(http.user_agent) contains "headless"))
```

- Choose action: **Block** > **Deploy**

## 6. Scrape Shield
**Scrape Shield** (newer dashboards: **Security > Settings**)
- **Email Address Obfuscation**: On
- **Hotlink Protection**: On

## 7. Turnstile (real keys)
**Turnstile** (left menu, account level) > **Add widget**
- Widget name `meshgrid-sim`, Hostname: your site hostname, Widget mode **Managed** > **Create**
- **Site key** (public) goes in `config.js` (`TURNSTILE_SITEKEY`).
- **Secret key** goes ONLY in GitHub Secrets as `TURNSTILE_SECRET` of the Worker repo, never in this repo.

## 8. Server-side check
The Worker (`meshgrid-sim-worker`, private) verifies the Turnstile token and serves tariffs and ledger rules.
