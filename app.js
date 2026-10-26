/* Meshgrid Sim — India 4.O Alliance. Simulation only.
   Engine: per-step dispatch inside each MeshNet component.
   Merit order for a deficit: peer-to-peer > own banked credits > Hub pool > utility grid > diesel > (critical only) Hub reserve > load shed. */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var clamp = function (x, a, b) { return Math.max(a, Math.min(b, x)); };
  var NS = 'http://www.w3.org/2000/svg';

  var PRICE = { grid: 8, feed: 3, pool: 6.5, dg: 14, fee: 0.02, bank: 0.40, p2pMin: 3.5, p2pMax: 7.5 };
  var EFF = 0.96, STEP_MAX = 5, BLOCK_MIN = 15, HIST_MIN = 10, HUB_KW = 100, DG_KW = 60, DG_DELAY_MIN = 3, GRID_SYNC_MIN = 2;

  // tier 1 = critical (never shed), 2 = selective, 3 = non-essential
  var NODES = [
    { id: 'HOS', name: 'Hospital',    code: 'HOS', tier: 1, peak: 55, pv: 40, prof: 'flat',   x: 150, y: 120 },
    { id: 'LIB', name: 'Library',     code: 'LIB', tier: 2, peak: 18, pv: 20, prof: 'day',    x: 400, y: 70 },
    { id: 'ADM', name: 'Admin Block', code: 'ADM', tier: 3, peak: 20, pv: 15, prof: 'office', x: 650, y: 120 },
    { id: 'HST', name: 'Hostel',      code: 'HST', tier: 2, peak: 45, pv: 30, prof: 'eve',    x: 710, y: 300 },
    { id: 'CAN', name: 'Canteen',     code: 'CAN', tier: 3, peak: 25, bio: 12,  prof: 'meal',  x: 600, y: 450 },
    { id: 'LAB', name: 'Mech Labs',   code: 'LAB', tier: 2, peak: 40,          prof: 'lab',   x: 200, y: 450 },
    { id: 'WND', name: 'Wind Farm',   code: 'WND', tier: 0, peak: 0,  wind: 30, prof: 'none',  x: 90,  y: 290 },
    { id: 'HUB', name: 'Alliance Hub (BESS)', code: 'HUB', kind: 'hub', x: 400, y: 250 },
    { id: 'DGN', name: 'Diesel Gen',  code: 'DG',  kind: 'dg',   x: 400, y: 360 },
    { id: 'GRD', name: 'Utility Grid', code: 'GRID', kind: 'grid', x: 400, y: 490 }
  ];
  var byId = {}; NODES.forEach(function (n) { byId[n.id] = n; });
  var CUST = NODES.filter(function (n) { return !n.kind; });

  var EDGE_DEF = [
    ['HOS','LIB',9],['LIB','ADM',11],['ADM','HST',14],['HST','CAN',12],['CAN','LAB',16],['LAB','WND',13],['WND','HOS',15],
    ['HUB','HOS',6],['HUB','LIB',5],['HUB','ADM',7],['HUB','HST',8],['HUB','CAN',7],['HUB','LAB',8],['HUB','WND',9],
    ['HUB','DGN',3],['HUB','GRD',4],['CAN','GRD',10],['LAB','GRD',11]
  ];
  var EDGES = EDGE_DEF.map(function (e) { return { a: e[0], b: e[1], lat: e[2], cut: false }; });
  function edgeOf(a, b) { return EDGES.filter(function (e) { return (e.a === a && e.b === b) || (e.a === b && e.b === a); })[0]; }

  // ---------- load / generation profiles
  function g(h, c, w) { var z = (h - c) / w; return Math.exp(-z * z); }
  var PROFILE = {
    flat:   function (h) { return 0.85 + 0.1 * Math.sin((h - 14) / 24 * 2 * Math.PI); },
    day:    function (h) { return 0.25 + 0.75 * g(h, 13, 4); },
    office: function (h) { return 0.2 + 0.8 * g(h, 13, 3.2); },
    eve:    function (h) { return Math.min(1, 0.35 + 0.65 * g(h, 20, 2.8) + 0.25 * g(h, 6.5, 1.5)); },
    meal:   function (h) { return 0.2 + 0.8 * Math.max(g(h, 8, 1), g(h, 13, 1.1), g(h, 20, 1.3)); },
    lab:    function (h) { return 0.15 + 0.85 * g(h, 12, 3.5); },
    none:   function () { return 0; }
  };

  // ---------- hashing (demo chain; production would use SHA-256 + Alliance signatures)
  function h53(str) {
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57, ch;
    for (var i = 0; i < str.length; i++) { ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    var s = (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
    while (s.length < 14) s = '0' + s;
    return s;
  }

  // ---------- state
  var S, ui = { run: true, speed: 15, live: false, unplug: true, cap: 300, manual: 80 };
  var batt = null;

  function fresh() {
    EDGES.forEach(function (e) { e.cut = false; });
    var st = {
      t: 9 * 60, day: 1, cloud: 0.95, wind: 0.55,
      scen: { cloud: false, lull: false, peak: false, outage: false },
      fail: {}, gridRaw: true, gridConn: true, islandMin: 0, stableMin: 0, islandStart: null, lastIsland: null,
      hub: { E: 0.8 * ui.cap, cap: ui.cap, kw: 0 },
      dg: { running: false, kw: 0 },
      acct: {}, feeRs: 0, poolRs: 0,
      tot: { gen: 0, load: 0, served: 0, grid: 0, exp: 0, curt: 0, dg: 0, dgL: 0, p2p: 0, critNeed: 0, critServed: 0, islandServed: 0 },
      blk: null, chain: [], hist: [], histMin: 0, blkMin: 0, log: [], mode: '', prevStatus: {}, prevRoute: {}, socLow: false, bad: {}
    };
    CUST.forEach(function (n) { st.acct[n.id] = { bal: 0, credits: 0 }; });
    st.blk = newBlk();
    return st;
  }
  function newBlk() { var b = { p2p: 0, fee: 0, sold: {}, bought: {} }; CUST.forEach(function (n) { b.sold[n.id] = 0; b.bought[n.id] = 0; }); return b; }

  function clockLabel() {
    var m = Math.floor(S.t), hh = Math.floor(m / 60), mm = m % 60;
    return ('0' + hh).slice(-2) + ':' + ('0' + mm).slice(-2);
  }
  function log(msg, cls) { S.log.unshift({ t: 'D' + S.day + ' ' + clockLabel(), msg: msg, cls: cls || '' }); if (S.log.length > 60) S.log.pop(); }

  // ---------- MeshNet topology
  function topology() {
    var adj = {}; NODES.forEach(function (n) { adj[n.id] = []; });
    EDGES.forEach(function (e) {
      if (e.cut || S.fail[e.a] || S.fail[e.b]) return;
      adj[e.a].push({ id: e.b, lat: e.lat }); adj[e.b].push({ id: e.a, lat: e.lat });
    });
    var seen = {}, comps = [];
    NODES.forEach(function (n) {
      if (seen[n.id]) return;
      var q = [n.id], c = []; seen[n.id] = 1;
      while (q.length) { var u = q.pop(); c.push(u); adj[u].forEach(function (v) { if (!seen[v.id]) { seen[v.id] = 1; q.push(v.id); } }); }
      comps.push(c);
    });
    // BFS from HUB for route display
    var route = {}; route.HUB = { path: ['HUB'], ms: 0 };
    var queue = ['HUB'];
    if (!S.fail.HUB) {
      while (queue.length) {
        var u = queue.shift();
        adj[u].forEach(function (v) { if (!route[v.id]) { route[v.id] = { path: route[u].path.concat(v.id), ms: route[u].ms + v.lat }; queue.push(v.id); } });
      }
    }
    return { comps: comps, route: route };
  }

  // ---------- one simulation step
  function stepSim(dtMin) {
    var dtH = dtMin / 60, h;
    S.t += dtMin; if (S.t >= 1440) { S.t -= 1440; S.day++; }
    h = S.t / 60;

    // environment
    var irr = Math.max(0, Math.sin(Math.PI * (h - 6) / 12));
    S.cloud += ((S.scen.cloud ? 0.3 : 0.95) - S.cloud) * 0.25 + (Math.random() - 0.5) * (S.scen.cloud ? 0.12 : 0.02);
    S.cloud = clamp(S.cloud, 0.08, 1);
    S.wind += ((S.scen.lull ? 0.08 : 0.55 + 0.25 * Math.sin(h / 24 * Math.PI * 4 + 1)) - S.wind) * 0.25 + (Math.random() - 0.5) * 0.04;
    S.wind = clamp(S.wind, 0, 1);
    CUST.forEach(function (n) {
      n.gen = (n.pv || 0) * 0.85 * irr * S.cloud + (n.wind || 0) * S.wind + (n.bio || 0);
      n.load = n.peak * PROFILE[n.prof](h) * (S.scen.peak ? 1.35 : 1) * (1 + (Math.random() - 0.5) * 0.06);
      n.net = n.gen - n.load; n.served = n.load; n.unserved = 0; n.p2pSell = 0; n.p2pBuy = 0;
    });

    // utility grid state machine (outage, then stable wait, then resync)
    S.gridRaw = !S.scen.outage;
    if (!S.gridRaw) {
      if (S.gridConn) { S.gridConn = false; S.islandStart = S.day * 1440 + S.t; log('Grid failed. PCC opened, campus islanded.', 'err'); }
      S.stableMin = 0; S.islandMin += dtMin;
    } else if (!S.gridConn) {
      S.stableMin += dtMin;
      if (S.stableMin >= GRID_SYNC_MIN) {
        S.gridConn = true; S.lastIsland = Math.round(S.day * 1440 + S.t - S.islandStart); S.islandMin = 0;
        log('Grid stable for ' + GRID_SYNC_MIN + ' min. Resynchronised and reconnected (islanded ' + S.lastIsland + ' min).', 'ok');
      }
    }

    var topo = topology(); S.topo = topo;
    var hub = S.hub, gridOK = S.gridConn;
    var hubDraw = 0, hubCharge = 0, dgKw = 0, gridKw = 0, expKw = 0, curtKw = 0, p2pKw = 0, hubTop = 0;

    topo.comps.forEach(function (c) {
      var cust = c.map(function (id) { return byId[id]; }).filter(function (n) { return !n.kind; });
      if (!cust.length) return;
      var hubIn = c.indexOf('HUB') >= 0, dgIn = c.indexOf('DGN') >= 0;
      var sel = cust.filter(function (n) { return n.net > 0.01; });
      var buy = cust.filter(function (n) { return n.net < -0.01; });
      var Ssum = sel.reduce(function (a, n) { return a + n.net; }, 0);
      var Dsum = buy.reduce(function (a, n) { return a - n.net; }, 0);
      var p2p = Math.min(Ssum, Dsum);
      var price = p2p > 0 ? clamp(PRICE.p2pMin + (PRICE.p2pMax - PRICE.p2pMin) * Dsum / (Ssum + Dsum), PRICE.p2pMin, PRICE.p2pMax) : 0;

      sel.forEach(function (n) {
        n.p2pSell = p2p > 0 ? n.net * p2p / Ssum : 0; n.left = n.net - n.p2pSell;
        var kwh = n.p2pSell * dtH, rs = kwh * price;
        S.acct[n.id].bal += rs * (1 - PRICE.fee); S.feeRs += rs * PRICE.fee; S.blk.fee += rs * PRICE.fee; S.blk.sold[n.id] += kwh;
      });
      buy.forEach(function (n) {
        n.p2pBuy = p2p > 0 ? -n.net * p2p / Dsum : 0; n.need = -n.net - n.p2pBuy;
        var kwh = n.p2pBuy * dtH; S.acct[n.id].bal -= kwh * price; S.blk.bought[n.id] += kwh;
      });
      p2pKw += p2p; S.blk.p2p += p2p * dtH; S.tot.p2p += p2p * dtH;

      // bank surplus into the Alliance Hub (credits in kWh)
      var Sr = sel.reduce(function (a, n) { return a + n.left; }, 0);
      if (hubIn && Sr > 0.01) {
        var room = Math.max(0, 0.95 * hub.cap - hub.E);
        var chKw = Math.min(Sr, HUB_KW, room / (dtH * EFF)), ratio = chKw / Sr;
        sel.forEach(function (n) {
          var inKw = n.left * ratio, stored = inKw * dtH * EFF, bf = inKw * dtH * PRICE.bank;
          S.acct[n.id].credits += stored; S.acct[n.id].bal -= bf; S.feeRs += bf; S.blk.fee += bf;
          hub.E += stored; n.left -= inKw; hubCharge += inKw;
        });
      }
      sel.forEach(function (n) {
        if (n.left <= 0.001) return;
        if (gridOK) { expKw += n.left; S.acct[n.id].bal += n.left * dtH * PRICE.feed; S.tot.exp += n.left * dtH; }
        else { curtKw += n.left; S.tot.curt += n.left * dtH; }
      });

      // serve deficits, critical first
      buy.sort(function (a, b) { return a.tier - b.tier; });
      var avail = function (floor) { return hubIn ? Math.max(0, Math.min(HUB_KW - hubDraw, (hub.E - floor * hub.cap) / dtH - hubDraw)) : 0; };
      buy.forEach(function (n) {
        var need = n.need, use, a = S.acct[n.id];
        use = Math.min(need, a.credits / dtH, avail(0.05));               // 1 own credits
        if (use > 0) { a.credits -= use * dtH; hubDraw += use; need -= use; }
        use = Math.min(need, avail(gridOK ? 0.30 : (n.tier === 1 ? 0.30 : 0.40))); // 2 Hub pool
        if (use > 0) { hubDraw += use; need -= use; a.bal -= use * dtH * PRICE.pool; S.poolRs += use * dtH * PRICE.pool; }
        if (need > 0 && gridOK) { gridKw += need; a.bal -= need * dtH * PRICE.grid; S.tot.grid += need * dtH; need = 0; } // 3 grid
        if (need > 0 && !gridOK && dgIn && S.islandMin >= DG_DELAY_MIN) {  // 4 diesel
          use = Math.min(need, DG_KW - dgKw);
          if (use > 0) { dgKw += use; need -= use; a.bal -= use * dtH * PRICE.dg; S.tot.dg += use * dtH; S.tot.dgL += use * dtH * 0.3; }
        }
        if (need > 0 && n.tier === 1) {                                     // 5 critical may use the Hub reserve
          use = Math.min(need, avail(0.08));
          if (use > 0) { hubDraw += use; need -= use; a.bal -= use * dtH * PRICE.pool; S.poolRs += use * dtH * PRICE.pool; }
        }
        n.unserved = need; n.served = n.load - need;
      });
      // keep the Hub topped up from the grid when connected
      if (hubIn && gridOK && hub.E < 0.7 * hub.cap) { hubTop = 15; hub.E += hubTop * dtH * EFF; S.tot.grid += hubTop * dtH; gridKw += hubTop; }
    });

    hub.E = clamp(hub.E - hubDraw * dtH, 0, hub.cap);
    if (ui.live) hub.E = liveLevel() * hub.cap;
    hub.kw = hubCharge + hubTop - hubDraw;
    var dgWas = S.dg.running; S.dg.kw = dgKw; S.dg.running = dgKw > 0.1;
    if (S.dg.running && !dgWas) log('Diesel generator started.', 'warn');
    if (!S.dg.running && dgWas) log('Diesel generator stopped.', 'ok');
    S.gridKw = gridKw; S.expKw = expKw; S.p2pKw = p2pKw;

    // totals
    CUST.forEach(function (n) {
      S.tot.gen += n.gen * dtH; S.tot.load += n.load * dtH; S.tot.served += n.served * dtH;
      if (!gridOK) S.tot.islandServed += n.served * dtH;
      if (n.tier === 1) { S.tot.critNeed += n.load * dtH; S.tot.critServed += n.served * dtH; }
      var st = n.unserved > 0.02 * Math.max(n.load, 1) ? 'shed' : 'ok';
      if (S.prevStatus[n.id] && S.prevStatus[n.id] !== st) log(n.name + (st === 'shed' ? ' load shed (' + n.unserved.toFixed(0) + ' kW unserved).' : ' load restored.'), st === 'shed' ? 'err' : 'ok');
      S.prevStatus[n.id] = st;
    });
    var soc = hub.E / hub.cap;
    if (soc < 0.3 && !S.socLow) { S.socLow = true; log('Hub battery below 30%. Non-essential loads next in line.', 'warn'); }
    if (soc >= 0.35 && S.socLow) S.socLow = false;

    // MeshNet route changes (self-healing)
    CUST.forEach(function (n) {
      var r = topo.route[n.id], key = r ? r.path.join('>') : 'none';
      if (S.prevRoute[n.id] !== undefined && S.prevRoute[n.id] !== key) {
        log(r ? 'MeshNet healed: ' + n.name + ' now reaches the Hub via ' + r.path.map(function (i) { return byId[i].code; }).join(' > ') + ' (' + (r.path.length - 1) + ' hops).'
              : 'MeshNet: ' + n.name + ' is cut off from the Alliance Hub. Trading stopped.', r ? 'ok' : 'err');
      }
      S.prevRoute[n.id] = key;
    });

    // mode
    var mode = S.gridConn ? 'GRID-CONNECTED' : (S.gridRaw ? 'RESTORING' : 'ISLANDED');
    if (S.mode && S.mode !== mode) log('Mode: ' + mode + '.', mode === 'ISLANDED' ? 'err' : 'warn');
    S.mode = mode;

    // ledger: seal a block every 15 simulated minutes
    S.blkMin += dtMin; if (S.blkMin >= BLOCK_MIN) { S.blkMin -= BLOCK_MIN; sealBlock(); }
    // chart history
    S.histMin += dtMin; if (S.histMin >= HIST_MIN) {
      S.histMin -= HIST_MIN;
      var gsum = 0, lsum = 0; CUST.forEach(function (n) { gsum += n.gen; lsum += n.load; });
      S.hist.push({ t: S.t, gen: gsum, load: lsum, soc: soc * 100 }); if (S.hist.length > 144) S.hist.shift();
    }
  }

  function blockHash(b) { return h53(b.prev + '|' + b.i + '|' + b.time + '|' + b.p2p + '|' + b.fee + '|' + JSON.stringify(b.tx)); }
  function sealBlock() {
    var b = { i: S.chain.length + 1, time: 'D' + S.day + ' ' + clockLabel(), p2p: S.blk.p2p.toFixed(3), fee: S.blk.fee.toFixed(2), tx: [], prev: S.chain.length ? S.chain[S.chain.length - 1].hash : '0'.repeat(14) };
    CUST.forEach(function (n) { var s = S.blk.sold[n.id], u = S.blk.bought[n.id]; if (s > 0.0005 || u > 0.0005) b.tx.push([n.id, s.toFixed(3), u.toFixed(3)]); });
    b.hash = blockHash(b); S.chain.push(b); S.blk = newBlk(); S.bad = {};
  }
  function verifyChain() {
    var prev = '0'.repeat(14), badAt = 0; S.bad = {};
    S.chain.forEach(function (b) {
      var ok = b.prev === prev && blockHash(b) === b.hash;
      if (!ok) { S.bad[b.i] = true; if (!badAt) badAt = b.i; }
      prev = b.hash;
    });
    var el = $('#chainState');
    if (!S.chain.length) { el.textContent = 'No blocks sealed yet. A block seals every ' + BLOCK_MIN + ' simulated minutes.'; el.className = 'status'; }
    else if (badAt) { el.textContent = 'Chain BROKEN at block #' + badAt + '. Tampering detected, later blocks no longer match.'; el.className = 'status err'; }
    else { el.textContent = 'Chain valid: ' + S.chain.length + ' blocks, every hash matches.'; el.className = 'status ok'; }
    renderLedger();
  }

  // ---------- live device battery
  function liveLevel() { return batt ? batt.level : ui.manual / 100; }
  function setLiveNote(t) { $('#liveNote').textContent = t; }
  function applyCharging() {
    if (!ui.live || !ui.unplug || !batt) return;
    var wantOutage = !batt.charging;
    if (S.scen.outage !== wantOutage) { S.scen.outage = wantOutage; log(wantOutage ? 'Charger unplugged. Grid outage emulated.' : 'Charger plugged in. Grid returned.', wantOutage ? 'err' : 'ok'); syncChips(); }
  }
  function enableLive(on) {
    ui.live = on;
    $('#manualWrap').hidden = true;
    if (!on) { setLiveNote('Off. Simulated battery in use.'); return; }
    if (navigator.getBattery) {
      navigator.getBattery().then(function (b) {
        batt = b;
        var upd = function () { setLiveNote('LIVE: device battery ' + Math.round(b.level * 100) + '% (' + (b.charging ? 'charging' : 'on battery') + ') drives the Hub BESS.'); applyCharging(); };
        b.addEventListener('levelchange', upd); b.addEventListener('chargingchange', upd); upd();
      }).catch(fallbackManual);
    } else fallbackManual();
  }
  function fallbackManual() {
    batt = null; $('#manualWrap').hidden = false;
    setLiveNote('Battery API not available here (use Chrome or Edge). Use the manual slider to set the Hub level.');
  }

  // ---------- rendering
  var svg, nodeEls = {}, edgeEls = [];
  function el(tag, attrs, parent) { var e = document.createElementNS(NS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }

  function buildMap() {
    svg = $('#map'); while (svg.firstChild) svg.removeChild(svg.firstChild);
    EDGES.forEach(function (e, i) {
      var A = byId[e.a], B = byId[e.b], grp = el('g', {}, svg);
      var vis = el('line', { x1: A.x, y1: A.y, x2: B.x, y2: B.y, 'class': 'edge-vis' }, grp);
      var hit = el('line', { x1: A.x, y1: A.y, x2: B.x, y2: B.y, 'class': 'edge-hit' }, grp);
      var ti = el('title', {}, hit); ti.textContent = 'MeshNet link ' + A.code + ' – ' + B.code + ' (click to cut or restore)';
      hit.addEventListener('click', function () { e.cut = !e.cut; log('MeshNet link ' + A.code + '–' + B.code + (e.cut ? ' cut.' : ' restored.'), e.cut ? 'err' : 'ok'); syncChips(); render(); });
      edgeEls[i] = vis;
    });
    NODES.forEach(function (n) {
      var r = n.kind === 'hub' ? 40 : 30;
      var g2 = el('g', { 'class': 'node', transform: 'translate(' + n.x + ',' + n.y + ')', tabindex: 0, role: 'button' }, svg);
      var t = el('title', {}, g2); t.textContent = n.name + ' (click to drop or restore its MeshNet radio)';
      el('circle', { r: r, 'class': 'body' }, g2);
      var code = el('text', { y: 4, 'class': 'i' }, g2); code.textContent = n.code;
      var nm = el('text', { y: r + 14, 'class': 'n' }, g2); nm.textContent = n.name;
      var vv = el('text', { y: r + 28, 'class': 'v' }, g2);
      var bar = null;
      if (n.kind === 'hub') { el('rect', { x: -26, y: 12, width: 52, height: 6, fill: 'none', stroke: 'currentColor', opacity: 0.35 }, g2); bar = el('rect', { x: -26, y: 12, width: 0, height: 6, 'class': 'socbar' }, g2); }
      var toggle = function () { S.fail[n.id] = !S.fail[n.id]; log(n.name + ' MeshNet radio ' + (S.fail[n.id] ? 'dropped.' : 'restored.'), S.fail[n.id] ? 'err' : 'ok'); syncChips(); render(); };
      g2.addEventListener('click', toggle);
      g2.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(); } });
      nodeEls[n.id] = { g: g2, v: vv, bar: bar };
    });
  }

  function f1(x) { return x.toFixed(1); }
  function render() {
    $('#clock').textContent = 'Day ' + S.day + ' · ' + clockLabel();
    var m = $('#mode'); m.textContent = S.mode || 'GRID-CONNECTED';
    m.className = 'badge ' + (S.mode === 'ISLANDED' ? 'err' : S.mode === 'RESTORING' ? 'warn' : 'ok');

    EDGES.forEach(function (e, i) {
      var dead = e.cut || S.fail[e.a] || S.fail[e.b];
      edgeEls[i].setAttribute('class', 'edge-vis' + (e.cut ? ' cut' : (dead ? ' cut' : ' live')));
    });
    NODES.forEach(function (n) {
      var ne = nodeEls[n.id], cls = 'node', txt = '';
      if (S.fail[n.id]) { cls += ' off'; txt = 'mesh down'; }
      if (!n.kind) {
        if (!S.fail[n.id]) {
          if (n.unserved > 0.02 * Math.max(n.load, 1)) { cls += ' shed'; txt = 'SHED ' + f1(n.unserved) + ' kW'; }
          else if (n.net >= 0) { cls += ' sell'; txt = '+' + f1(n.net) + ' kW'; }
          else { cls += ' buy'; txt = f1(n.net) + ' kW'; }
        } else txt += ' · ' + f1(n.net) + ' kW';
      } else if (n.kind === 'hub') {
        var soc = S.hub.E / S.hub.cap * 100; cls += ' util'; txt = Math.round(soc) + '% · ' + (S.hub.kw >= 0 ? '+' : '') + f1(S.hub.kw) + ' kW';
        ne.bar.setAttribute('width', (52 * soc / 100).toFixed(1));
      } else if (n.kind === 'grid') {
        if (!S.gridRaw) { cls += ' shed'; txt = 'OUTAGE'; } else if (!S.gridConn) { cls += ' buy'; txt = 'SYNC…'; }
        else { cls += ' util'; txt = (S.gridKw > 0.05 ? 'import ' + f1(S.gridKw) : S.expKw > 0.05 ? 'export ' + f1(S.expKw) : 'idle') + ' kW'; }
      } else if (n.kind === 'dg') {
        if (S.dg.running) { cls += ' buy'; txt = 'RUN ' + f1(S.dg.kw) + ' kW'; } else { cls += ' idle'; txt = 'standby'; }
      }
      if (S.fail[n.id]) cls = 'node off';
      ne.g.setAttribute('class', cls); ne.v.textContent = txt;
    });

    // KPIs
    var T = S.tot, served = Math.max(T.served, 0.001);
    $('#k-ren').textContent = clamp(100 * (1 - (T.grid + T.dg) / served), 0, 100).toFixed(0) + '%';
    $('#k-crit').textContent = (T.critNeed > 0 ? 100 * T.critServed / T.critNeed : 100).toFixed(1) + '%';
    $('#k-soc').textContent = (S.hub.E / S.hub.cap * 100).toFixed(0) + '% · ' + S.hub.E.toFixed(0) + ' kWh';
    $('#k-p2p').textContent = T.p2p.toFixed(1) + ' kWh';
    $('#k-fee').textContent = '₹' + S.feeRs.toFixed(0);
    $('#k-grid').textContent = T.grid.toFixed(0) + ' kWh';
    $('#k-dg').textContent = Math.max(0, T.islandServed * 0.3 - T.dgL).toFixed(0) + ' L';
    $('#k-co2').textContent = Math.max(0, (T.served - T.grid - T.dg) * 0.82).toFixed(0) + ' kg';

    renderAcct(); renderLog(); drawChart();
    $('#play').textContent = ui.run ? 'Pause' : 'Play'; $('#play').setAttribute('aria-pressed', String(ui.run));
  }

  function renderAcct() {
    var rows = '';
    CUST.forEach(function (n) {
      var a = S.acct[n.id], r = S.topo && S.topo.route[n.id];
      var mesh = S.fail[n.id] ? 'radio down' : (r ? (r.path.length - 1) + ' hop' + (r.path.length - 1 === 1 ? '' : 's') + ' · ' + (r.ms + (Math.round(S.t) % 3)) + ' ms' : 'isolated');
      rows += '<tr><td>' + n.name + '</td><td class="num">' + f1(n.load) + '</td><td class="num">' + f1(n.gen) + '</td><td class="num">' + a.credits.toFixed(1) + '</td><td class="num ' + (a.bal >= 0 ? 'pos' : 'neg') + '">' + a.bal.toFixed(0) + '</td><td>' + mesh + '</td></tr>';
    });
    rows += '<tr><td><b>Alliance (fees)</b></td><td></td><td></td><td></td><td class="num pos">' + S.feeRs.toFixed(0) + '</td><td>2% + banking</td></tr>';
    rows += '<tr><td><b>Hub pool sales</b></td><td></td><td></td><td></td><td class="num pos">' + S.poolRs.toFixed(0) + '</td><td>₹6.50/kWh</td></tr>';
    $('#acct tbody').innerHTML = rows;
  }
  function renderLedger() {
    var rows = '';
    S.chain.slice(-10).reverse().forEach(function (b) {
      rows += '<tr' + (S.bad[b.i] ? ' class="bad"' : '') + '><td>' + b.i + '</td><td>' + b.time + '</td><td class="num">' + b.p2p + '</td><td class="num">' + b.fee + '</td><td class="hash">' + b.hash + '</td></tr>';
    });
    $('#ledger tbody').innerHTML = rows || '<tr><td colspan="5">First block seals in ' + BLOCK_MIN + ' simulated minutes.</td></tr>';
  }
  var lastChainLen = -1, lastLogKey = '';
  function renderLog() {
    if (S.chain.length !== lastChainLen) { lastChainLen = S.chain.length; renderLedger(); }
    var key = S.log.length + '|' + (S.log[0] ? S.log[0].t + S.log[0].msg : '');
    if (key === lastLogKey) return; lastLogKey = key;
    var ol = $('#log'); ol.innerHTML = '';
    S.log.slice(0, 14).forEach(function (e) {
      var li = document.createElement('li'); li.className = e.cls;
      var t = document.createElement('time'); t.textContent = e.t; var s = document.createElement('span'); s.textContent = e.msg;
      li.appendChild(t); li.appendChild(s); ol.appendChild(li);
    });
  }

  function cssv(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function drawChart() {
    var cv = $('#chart'), dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    if (!W) return;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    var c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
    var L = 44, R = 40, Tp = 10, B = 22, w = W - L - R, hh = H - Tp - B, hist = S.hist;
    var ink = cssv('--muted'), line = cssv('--line');
    var maxKw = 50; hist.forEach(function (p) { maxKw = Math.max(maxKw, p.gen, p.load); }); maxKw = Math.ceil(maxKw / 50) * 50;
    c.font = '11px ' + cssv('--font'); c.lineWidth = 1;
    for (var i = 0; i <= 4; i++) {
      var y = Tp + hh * i / 4; c.strokeStyle = line; c.beginPath(); c.moveTo(L, y); c.lineTo(L + w, y); c.stroke();
      c.fillStyle = ink; c.textAlign = 'right'; c.fillText(Math.round(maxKw * (1 - i / 4)), L - 6, y + 4);
      c.textAlign = 'left'; c.fillText(Math.round(100 * (1 - i / 4)) + '%', L + w + 6, y + 4);
    }
    var N = 144;
    function X(i2) { return L + w * (i2 + (N - hist.length)) / (N - 1); }
    function plot(key, color, scale) {
      if (!hist.length) return; c.strokeStyle = color; c.lineWidth = 2; c.beginPath();
      hist.forEach(function (p, k) { var y2 = Tp + hh * (1 - p[key] / scale); if (k) c.lineTo(X(k), y2); else c.moveTo(X(k), y2); });
      c.stroke();
    }
    plot('gen', cssv('--sell'), maxKw); plot('load', cssv('--load'), maxKw); plot('soc', cssv('--soc'), 100);
    c.fillStyle = ink; c.textAlign = 'left';
    if (hist.length) { var a0 = hist[0].t; c.fillText(('0' + Math.floor(a0 / 60)).slice(-2) + ':' + ('0' + Math.floor(a0 % 60)).slice(-2), L, H - 6); }
    c.textAlign = 'right'; c.fillText('now ' + clockLabel(), L + w, H - 6);
  }

  // ---------- controls
  function syncChips() {
    var e1 = edgeOf('HUB', 'HOS');
    var state = { cloud: S.scen.cloud, lull: S.scen.lull, peak: S.scen.peak, outage: S.scen.outage, link: !!(e1 && e1.cut), node: !!S.fail.LIB };
    document.querySelectorAll('#scen .chip').forEach(function (b) { b.setAttribute('aria-pressed', String(!!state[b.dataset.s])); });
  }
  function wire() {
    $('#scen').addEventListener('click', function (ev) {
      var b = ev.target.closest('.chip'); if (!b) return; var k = b.dataset.s;
      if (k === 'link') { var e = edgeOf('HUB', 'HOS'); e.cut = !e.cut; log('MeshNet link HUB–HOS ' + (e.cut ? 'cut.' : 'restored.'), e.cut ? 'err' : 'ok'); }
      else if (k === 'node') { S.fail.LIB = !S.fail.LIB; log('Library MeshNet radio ' + (S.fail.LIB ? 'dropped.' : 'restored.'), S.fail.LIB ? 'err' : 'ok'); }
      else { S.scen[k] = !S.scen[k]; var names = { cloud: 'Cloudy day', lull: 'Wind lull', peak: 'Peak demand', outage: 'Grid outage' }; log(names[k] + (S.scen[k] ? ' on.' : ' off.'), S.scen[k] && k === 'outage' ? 'err' : ''); }
      syncChips(); render();
    });
    $('#play').addEventListener('click', function () { ui.run = !ui.run; render(); });
    $('#speed').addEventListener('change', function (e) { ui.speed = +e.target.value; });
    $('#reset').addEventListener('click', function () { S = fresh(); stepSim(0.001); S.log = []; log('Simulation reset.', ''); syncChips(); render(); });
    $('#live').addEventListener('change', function (e) { enableLive(e.target.checked); });
    $('#unplug').addEventListener('change', function (e) { ui.unplug = e.target.checked; applyCharging(); });
    $('#cap').addEventListener('change', function (e) { ui.cap = +e.target.value; var soc = S.hub.E / S.hub.cap; S.hub.cap = ui.cap; S.hub.E = soc * ui.cap; Object.keys(S.acct).forEach(function (k) { S.acct[k].credits = 0; }); });
    $('#manual').addEventListener('input', function (e) { ui.manual = +e.target.value; $('#manualOut').textContent = ui.manual + '%'; });
    $('#verify').addEventListener('click', verifyChain);
    $('#tamper').addEventListener('click', function () {
      if (!S.chain.length) { var el2 = $('#chainState'); el2.textContent = 'Seal at least one block first (run a few simulated minutes).'; el2.className = 'status warn'; return; }
      var b = S.chain[Math.floor(S.chain.length / 2)]; b.p2p = (parseFloat(b.p2p) + 5).toFixed(3);
      log('Tamper test: block #' + b.i + ' altered without re-hashing.', 'warn'); verifyChain();
    });
    window.addEventListener('resize', drawChart);
  }

  // ---------- main loop
  function tick() {
    if (!ui.run) return;
    var rem = ui.speed * 0.25;
    while (rem > 0) { var d = Math.min(STEP_MAX, rem); stepSim(d); rem -= d; }
    render();
  }

  S = fresh(); buildMap(); wire();
  stepSim(0.001); S.log = []; log('Meshgrid online. India 4.O Alliance ledger open.', 'ok');
  for (var w = 0; w < 6; w++) { stepSim(5); }   // warm-up so the first frame has a chart and values
  syncChips(); render();
  setInterval(tick, 250);
  if (location.hash === '#test') window.__MG = { get S() { return S; }, stepSim: stepSim, verify: verifyChain };
})();
