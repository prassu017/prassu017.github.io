/*
 * tesseract.js
 * A clean, interactive 4D tesseract (hypercube) for the hero.
 * Classic script, no dependencies.
 *
 *   window.Tesseract.mount(el [, { nodes, pose, slot }])  -> instance | null
 *   instance: { el, reset(), select(id|null), destroy() }
 *
 * Auto-mounts to #tesseract. Nodes come from
 * <script type="application/json" id="tesseract-data">[...]</script>.
 * Colors are read from CSS custom properties on :root at draw time.
 */
(function () {
  'use strict';
  if (window.Tesseract) return;

  var TAU = Math.PI * 2;
  // Camera distances. A soft 3D perspective keeps the classic "cube inside a
  // cube" read without the stretched near edges a short camera produces.
  var D4 = 3.0;          // 4D camera distance (w axis)
  var D3 = 4.5;          // 3D camera distance (z axis)
  var PLANES = ['xy', 'xz', 'yz', 'xw', 'yw', 'zw'];

  // Resting pose (radians). Found by a seeded search that maximizes, at both
  // 1:1 and 4:3, the smallest gap between data nodes, between a data node and
  // any other vertex, and between a data node and any edge it does not touch.
  // Small 4D angles keep the inner cube visibly nested in the outer one.
  var REST = { xy: -3.036, xz: 2.674, yz: -2.866, xw: 0.007, yw: -0.414, zw: 0.45 };

  // The 8 even-parity vertices: no two share an edge, so data nodes never sit
  // on the same edge. SLOT[k] is the vertex for data node k, ordered so the
  // nodes nearest the viewer (labeled by default) are the lead deployments.
  var SLOT = [12, 15, 5, 10, 9, 6, 3, 0];

  // Offset the intro starts from (added to REST, eased to zero).
  var INTRO_FROM = { xy: 0.32, xw: -0.95, yw: 0.6, zw: -0.35 };
  var INTRO_MS = 1200;
  var RESET_MS = 720;
  var GRACE_MS = 450;

  var KIND_TEXT = { deployment: 'Deployment', project: 'Project', role: 'Role' };

  // ---- geometry -----------------------------------------------------------
  var VERTS = [];
  var EDGES = [];
  (function () {
    var i, b, j;
    for (i = 0; i < 16; i++) VERTS.push([i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1, i & 8 ? 1 : -1]);
    for (i = 0; i < 16; i++) for (b = 0; b < 4; b++) { j = i ^ (1 << b); if (i < j) EDGES.push([i, j]); }
  })();

  function rot(p, a, b, t) {
    var c = Math.cos(t), s = Math.sin(t), x = p[a], y = p[b];
    p[a] = x * c - y * s;
    p[b] = x * s + y * c;
  }

  // Rotate in 4D, perspective-project 4D -> 3D -> 2D (unit space).
  // u scales the original w coordinate (0 = flat cube, 1 = full tesseract).
  function project(v, A, u, out, cam) {
    var p = [v[0], v[1], v[2], v[3] * u];
    var d4 = cam ? cam.d4 : D4, d3 = cam ? cam.d3 : D3;
    rot(p, 0, 3, A.xw); rot(p, 1, 3, A.yw); rot(p, 2, 3, A.zw);
    rot(p, 0, 1, A.xy); rot(p, 0, 2, A.xz); rot(p, 1, 2, A.yz);
    var k4 = 1 / (d4 - p[3]);
    var x3 = p[0] * k4, y3 = p[1] * k4, z3 = p[2] * k4;
    var k3 = 1 / (d3 - z3);
    out.x = x3 * k3;
    out.y = y3 * k3;
    out.s = k3 * k4;     // bigger = nearer the viewer
    return out;
  }

  function wrap(a) { return a - TAU * Math.round(a / TAU); }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  // ---- colors -------------------------------------------------------------
  var probe = null;
  var colorCache = {};
  function parseColor(str, fallback) {
    str = (str || '').trim();
    if (!str) return fallback;
    if (colorCache[str]) return colorCache[str];
    try {
      if (window.CSS && CSS.supports && !CSS.supports('color', str)) return fallback;
      if (!probe) {
        var c = document.createElement('canvas');
        c.width = c.height = 1;
        probe = c.getContext('2d', { willReadFrequently: true });
      }
      probe.clearRect(0, 0, 1, 1);
      probe.fillStyle = '#000';
      probe.fillStyle = str;
      probe.fillRect(0, 0, 1, 1);
      var d = probe.getImageData(0, 0, 1, 1).data;
      var out = [d[0], d[1], d[2], d[3] / 255];
      colorCache[str] = out;
      return out;
    } catch (e) {
      return fallback;
    }
  }
  function rgba(c, a) {
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + clamp(a, 0, 1).toFixed(3) + ')';
  }
  function mix(c1, c2, t) {
    return [Math.round(lerp(c1[0], c2[0], t)), Math.round(lerp(c1[1], c2[1], t)), Math.round(lerp(c1[2], c2[2], t)), 1];
  }
  function readTheme() {
    var cs = getComputedStyle(document.documentElement);
    var g = function (n, fb) { return parseColor(cs.getPropertyValue(n), fb); };
    var th = {
      fg: g('--fg', [244, 244, 245, 1]),
      muted: g('--muted', [161, 161, 170, 1]),
      dim: g('--dim', [113, 113, 122, 1]),
      accent: g('--accent', [165, 180, 252, 1]),
      bg: g('--bg', [9, 9, 11, 1]),
      mono: (cs.getPropertyValue('--font-mono') || '').trim() ||
        '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
    };
    // Opaque backgrounds only make sense for masking; fall back if translucent.
    if (th.bg[3] < 0.5) th.bg = [9, 9, 11, 1];
    th.light = (0.2126 * th.bg[0] + 0.7152 * th.bg[1] + 0.0722 * th.bg[2]) / 255 > 0.5;
    return th;
  }

  // ---- styles -------------------------------------------------------------
  var CSS_TEXT = [
    '.tx-host{-webkit-tap-highlight-color:transparent;isolation:isolate}',
    '.tx-host:focus{outline:none}',
    '.tx-host:focus-visible{outline:1px solid color-mix(in srgb,var(--accent,#a5b4fc) 55%,transparent);outline-offset:6px;border-radius:var(--radius,16px)}',
    '.tx-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:pan-y;cursor:grab;user-select:none;-webkit-user-select:none}',
    '.tx-host.tx-dragging .tx-canvas{cursor:grabbing}',
    '.tx-host.tx-over-node .tx-canvas{cursor:pointer}',
    '.tx-card{position:absolute;left:0;top:0;z-index:2;box-sizing:border-box;width:min(256px,calc(100% - 16px));padding:14px 16px 13px;',
    'border-radius:14px;border:1px solid var(--line-2,rgba(255,255,255,.12));color:var(--fg,#f4f4f5);text-decoration:none;',
    'background:rgba(15,15,18,.86);',
    'background:linear-gradient(var(--card,transparent),var(--card,transparent)),color-mix(in srgb,var(--bg,#09090b) 82%,transparent);',
    '-webkit-backdrop-filter:blur(16px) saturate(1.4);backdrop-filter:blur(16px) saturate(1.4);',
    'box-shadow:0 18px 40px -18px rgba(0,0,0,.45),0 1px 0 0 rgba(255,255,255,.04) inset;',
    'opacity:0;visibility:hidden;pointer-events:none;transform:translateY(4px) scale(.985);transform-origin:var(--tx-ox,0) 50%;',
    'transition:opacity .18s ease,transform .22s cubic-bezier(.2,.8,.2,1),visibility 0s linear .22s}',
    '.tx-card.is-on{opacity:1;visibility:visible;pointer-events:auto;transform:none;transition:opacity .18s ease,transform .22s cubic-bezier(.2,.8,.2,1),visibility 0s}',
    '.tx-card:hover{border-color:color-mix(in srgb,var(--accent,#a5b4fc) 35%,var(--line-2,rgba(255,255,255,.12)))}',
    '.tx-kind{display:flex;align-items:center;gap:7px;font:500 10.5px/1 var(--font-mono,ui-monospace,monospace);letter-spacing:.08em;text-transform:uppercase;color:var(--muted,#a1a1aa)}',
    '.tx-dot{width:6px;height:6px;border-radius:50%;flex:none;background:var(--muted,#a1a1aa)}',
    '.tx-card[data-kind="deployment"] .tx-dot{background:var(--accent,#a5b4fc)}',
    '.tx-card[data-kind="project"] .tx-dot{background:var(--fg,#f4f4f5)}',
    '.tx-label{margin-top:10px;font:500 13.5px/1.3 var(--font-sans,system-ui,sans-serif);color:var(--fg,#f4f4f5)}',
    '.tx-metric{margin-top:4px;font:600 24px/1.15 var(--font-sans,system-ui,sans-serif);letter-spacing:-.02em;color:var(--fg,#f4f4f5);font-variant-numeric:tabular-nums}',
    '.tx-summary{margin:8px 0 0;font:400 12.5px/1.5 var(--font-sans,system-ui,sans-serif);color:var(--muted,#a1a1aa)}',
    '.tx-open{display:inline-flex;align-items:center;gap:4px;margin-top:11px;font:500 11.5px/1 var(--font-mono,ui-monospace,monospace);color:var(--accent,#a5b4fc)}',
    '.tx-card:hover .tx-open{text-decoration:underline;text-underline-offset:3px}',
    '.tx-sr{position:absolute!important;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}',
    '@media (max-width:480px){.tx-card{padding:12px 13px 11px}.tx-metric{font-size:21px}.tx-summary{font-size:12px}}',
    '@media (prefers-reduced-motion:reduce){.tx-card,.tx-card.is-on{transition:none;transform:none}}'
  ].join('');

  function injectStyle() {
    if (document.getElementById('tx-style')) return;
    var s = document.createElement('style');
    s.id = 'tx-style';
    s.textContent = CSS_TEXT;
    (document.head || document.documentElement).appendChild(s);
  }

  function readNodes(el) {
    var src = document.getElementById('tesseract-data') || el.querySelector('script[type="application/json"]');
    if (!src) return null;
    try {
      var data = JSON.parse(src.textContent);
      return Array.isArray(data) ? data : null;
    } catch (e) {
      return null;
    }
  }

  var reducedMQ = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function reduced() { return !!(reducedMQ && reducedMQ.matches); }

  // ---- component ----------------------------------------------------------
  function mount(el, opts) {
    if (!el) return null;
    if (el.__tx) return el.__tx;
    opts = opts || {};
    var nodes = (opts.nodes || readNodes(el) || []).slice(0, 8);
    if (!nodes.length) return null;
    var slot = (opts.slot || SLOT).slice(0, nodes.length);
    var cam = { d4: opts.d4 || D4, d3: opts.d3 || D3 };
    var rest = {};
    PLANES.forEach(function (k) { rest[k] = (opts.pose && k in opts.pose) ? opts.pose[k] : REST[k]; });

    injectStyle();
    el.classList.add('tx-host');
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
    if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', 'Interactive 4D tesseract of deployments, projects and roles. Use arrow keys to browse, Enter to open.');

    var canvas = document.createElement('canvas');
    canvas.className = 'tx-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    var ctx = canvas.getContext('2d');

    var card = document.createElement('a');
    card.className = 'tx-card';
    card.setAttribute('aria-hidden', 'true');
    card.tabIndex = -1;
    card.innerHTML = '<div class="tx-kind"><i class="tx-dot"></i><span></span></div>' +
      '<div class="tx-label"></div><div class="tx-metric"></div><p class="tx-summary"></p>' +
      '<span class="tx-open">Open <span aria-hidden="true">↗</span></span>';
    var cKind = card.querySelector('.tx-kind span');
    var cLabel = card.querySelector('.tx-label');
    var cMetric = card.querySelector('.tx-metric');
    var cSummary = card.querySelector('.tx-summary');

    var live = document.createElement('span');
    live.className = 'tx-sr';
    live.setAttribute('aria-live', 'polite');

    el.appendChild(canvas);
    el.appendChild(card);
    el.appendChild(live);

    // ---- state ----
    var W = 0, H = 0, dpr = 1, pad = 24, restS = 1;
    var ang = {};
    PLANES.forEach(function (k) { ang[k] = rest[k]; });
    var unfold = 1, alpha = 1;
    var raw = [], pts = [];
    for (var i = 0; i < 16; i++) { raw.push({ x: 0, y: 0, s: 0 }); pts.push({ x: 0, y: 0, t: 0 }); }
    var nodeAt = {};
    slot.forEach(function (v, k) { nodeAt[v] = k; });
    var hv = nodes.map(function () { return 0; });   // hover tween per node
    var R = nodes.map(function () { return 6; });     // ring radius per node (last draw)

    var hot = -1, hotSrc = null, cardHover = false, hideTimer = 0;
    var down = null, dragging = false, vel = { xw: 0, yw: 0 }, inertia = false;
    var intro = null, ease = null, started = false;
    var raf = 0, lastT = 0, destroyed = false;
    var lastTap = null;
    var listEls = [];

    function queryList() {
      listEls = Array.prototype.slice.call(document.querySelectorAll('.tx-list [data-id]'));
    }

    // ---- sizing ----
    function computeRestFit() {
      var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, tmp = { x: 0, y: 0, s: 0 };
      for (var i = 0; i < 16; i++) {
        project(VERTS[i], rest, 1, tmp, cam);
        if (tmp.x < minX) minX = tmp.x; if (tmp.x > maxX) maxX = tmp.x;
        if (tmp.y < minY) minY = tmp.y; if (tmp.y > maxY) maxY = tmp.y;
      }
      pad = clamp(Math.min(W, H) * 0.075, 22, 44);
      restS = Math.max(1, Math.min((W - 2 * pad) / (maxX - minX), (H - 2 * pad) / (maxY - minY)));
    }

    function resize() {
      var w = el.clientWidth, h = el.clientHeight;
      if (!h && w) h = w;
      var d = Math.min(2, window.devicePixelRatio || 1);
      if (w === W && h === H && d === dpr) return;
      W = w; H = h; dpr = d;
      canvas.width = Math.max(1, Math.round(W * dpr));
      canvas.height = Math.max(1, Math.round(H * dpr));
      computeRestFit();
      draw();
    }

    // ---- render loop (on demand) ----
    function request() {
      if (raf || destroyed) return;
      raf = requestAnimationFrame(frame);
    }

    function frame(now) {
      raf = 0;
      var dt = lastT && now - lastT < 100 ? (now - lastT) / 1000 : 1 / 60;
      lastT = now;
      var active = false;

      if (intro) {
        if (!intro.t0) intro.t0 = now;
        var p = clamp((now - intro.t0) / INTRO_MS, 0, 1);
        var e = easeOutCubic(p);
        PLANES.forEach(function (k) { ang[k] = rest[k] + (INTRO_FROM[k] || 0) * (1 - e); });
        unfold = easeInOutCubic(clamp(p / 0.9, 0, 1));
        alpha = clamp(p / 0.35, 0, 1);
        if (p >= 1) { intro = null; unfold = 1; alpha = 1; } else active = true;
      }

      if (ease) {
        if (!ease.t0) ease.t0 = now;
        var q = clamp((now - ease.t0) / RESET_MS, 0, 1);
        var f = easeInOutCubic(q);
        PLANES.forEach(function (k) { ang[k] = ease.from[k] + ease.diff[k] * f; });
        if (q >= 1) { PLANES.forEach(function (k) { ang[k] = rest[k]; }); ease = null; } else active = true;
      }

      if (inertia) {
        ang.xw += vel.xw * dt;
        ang.yw += vel.yw * dt;
        var decay = Math.exp(-dt * 4.2);
        vel.xw *= decay; vel.yw *= decay;
        if (Math.abs(vel.xw) + Math.abs(vel.yw) < 0.015) inertia = false; else active = true;
      }

      var rm = reduced();
      for (var k = 0; k < hv.length; k++) {
        var target = k === hot ? 1 : 0;
        if (hv[k] !== target) {
          hv[k] = rm ? target : hv[k] + (target - hv[k]) * (1 - Math.exp(-dt * 16));
          if (Math.abs(hv[k] - target) < 0.01) hv[k] = target; else active = true;
        }
      }

      draw();
      if (active) request(); else lastT = 0;
    }

    function draw() {
      if (destroyed || W < 2 || H < 2) return;
      var th = readTheme();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      var i, minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, sMin = 1e9, sMax = -1e9;
      for (i = 0; i < 16; i++) {
        var r = project(VERTS[i], ang, unfold, raw[i], cam);
        if (r.x < minX) minX = r.x; if (r.x > maxX) maxX = r.x;
        if (r.y < minY) minY = r.y; if (r.y > maxY) maxY = r.y;
        if (r.s < sMin) sMin = r.s; if (r.s > sMax) sMax = r.s;
      }
      // Fit: never larger than the resting fit; shrink smoothly if a pose would overflow.
      var bw = Math.max(1e-6, maxX - minX), bh = Math.max(1e-6, maxY - minY);
      var S = Math.min(restS, (W - 2 * pad) / bw, (H - 2 * pad) / bh);
      var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, sR = Math.max(1e-6, sMax - sMin);
      for (i = 0; i < 16; i++) {
        pts[i].x = W / 2 + (raw[i].x - cx) * S;
        pts[i].y = H / 2 + (raw[i].y - cy) * S;
        pts[i].t = (raw[i].s - sMin) / sR;   // 0 = farthest, 1 = nearest
      }

      ctx.globalAlpha = alpha;
      ctx.lineCap = 'round';

      var hotAmt = 0;
      for (i = 0; i < hv.length; i++) if (hv[i] > hotAmt) hotAmt = hv[i];
      var nodeTint = function (v) { return v in nodeAt ? hv[nodeAt[v]] : 0; };

      // edges, far to near
      var order = EDGES.slice().sort(function (a, b) {
        return (pts[a[0]].t + pts[a[1]].t) - (pts[b[0]].t + pts[b[1]].t);
      });
      var eLo = th.light ? 0.13 : 0.09, eHi = th.light ? 0.58 : 0.5;
      for (i = 0; i < order.length; i++) {
        var A = pts[order[i][0]], B = pts[order[i][1]];
        var tt = (A.t + B.t) / 2;
        var tint = Math.max(nodeTint(order[i][0]), nodeTint(order[i][1]));
        var base = lerp(eLo, eHi, Math.pow(tt, 0.9)) * (1 - 0.35 * hotAmt * (1 - tint));
        var col = tint > 0.001 ? mix(th.fg, th.accent, tint) : th.fg;
        ctx.strokeStyle = rgba(col, lerp(base, 0.5 + 0.35 * tt, tint));
        ctx.lineWidth = lerp(0.75 + 0.5 * tt, 1.3, tint);
        ctx.beginPath();
        ctx.moveTo(A.x, A.y);
        ctx.lineTo(B.x, B.y);
        ctx.stroke();
      }

      // plain vertices
      for (i = 0; i < 16; i++) {
        if (i in nodeAt) continue;
        var P = pts[i];
        ctx.fillStyle = rgba(th.fg, lerp(0.22, 0.75, P.t));
        ctx.beginPath();
        ctx.arc(P.x, P.y, lerp(1.1, 2.0, P.t), 0, TAU);
        ctx.fill();
      }

      // data nodes, far to near
      var dn = slot.map(function (v, k) { return k; }).sort(function (a, b) { return pts[slot[a]].t - pts[slot[b]].t; });
      for (i = 0; i < dn.length; i++) {
        var k = dn[i], node = nodes[k], Q = pts[slot[k]], h = hv[k];
        var kc = node.kind === 'deployment' ? th.accent : node.kind === 'project' ? th.fg : th.muted;
        var rr = lerp(5, 7, Q.t) + 2.5 * h;
        R[k] = rr;
        if (h > 0.01) {
          ctx.fillStyle = rgba(kc, 0.1 * h);
          ctx.beginPath(); ctx.arc(Q.x, Q.y, rr + 7 * h, 0, TAU); ctx.fill();
        }
        // mask the edges underneath so the node reads crisply
        ctx.fillStyle = rgba(th.bg, 0.92);
        ctx.beginPath(); ctx.arc(Q.x, Q.y, rr, 0, TAU); ctx.fill();
        ctx.strokeStyle = rgba(kc, lerp(0.45 + 0.35 * Q.t, 1, h));
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(Q.x, Q.y, rr, 0, TAU); ctx.stroke();
        ctx.fillStyle = rgba(kc, lerp(0.75 + 0.25 * Q.t, 1, h));
        ctx.beginPath(); ctx.arc(Q.x, Q.y, lerp(2, 2.6, Q.t) + 0.6 * h, 0, TAU); ctx.fill();
      }

      ctx.globalAlpha = 1;
      drawLabels(th, dn);
      if (hot >= 0 && !cardHover && !dragging) placeCard();
    }

    // Labels: the hot node plus the nearest few, never overlapping each other,
    // the card, or other nodes.
    function drawLabels(th, dn) {
      if (alpha < 0.6) return;
      var max = W < 380 ? 2 : 3;
      var cand = dn.slice().reverse();              // nearest first
      if (hot >= 0) { cand = cand.filter(function (k) { return k !== hot; }); cand.unshift(hot); }
      var size = W < 380 ? 10.5 : 11;
      ctx.font = '500 ' + size + 'px ' + th.mono;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      var placed = [];
      if (hot >= 0 && card.classList.contains('is-on')) {
        placed.push({ x: card.offsetLeft - 4, y: card.offsetTop - 4, w: card.offsetWidth + 8, h: card.offsetHeight + 8 });
      }
      var circles = slot.map(function (v, k) { return { x: pts[v].x, y: pts[v].y, r: R[k] + 3 }; });
      var hitsBox = function (b) {
        for (var j = 0; j < placed.length; j++) {
          var o = placed[j];
          if (b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y) return true;
        }
        for (j = 0; j < circles.length; j++) {
          var c = circles[j];
          var nx = clamp(c.x, b.x, b.x + b.w), ny = clamp(c.y, b.y, b.y + b.h);
          if ((nx - c.x) * (nx - c.x) + (ny - c.y) * (ny - c.y) < c.r * c.r) return true;
        }
        return false;
      };
      var shown = 0;
      for (var n = 0; n < cand.length && shown < max; n++) {
        var k = cand[n], P = pts[slot[k]], text = nodes[k].label, isHot = k === hot;
        var tw = ctx.measureText(text).width, bh = size + 6, gap = R[k] + 7;
        var opts = [
          { x: P.x - tw / 2, y: P.y + gap },
          { x: P.x - tw / 2, y: P.y - gap - bh },
          { x: P.x + gap, y: P.y - bh / 2 },
          { x: P.x - gap - tw, y: P.y - bh / 2 }
        ];
        var box = null;
        for (var o = 0; o < opts.length; o++) {
          var b = { x: clamp(opts[o].x, 6, W - tw - 6), y: clamp(opts[o].y, 4, H - bh - 4), w: tw, h: bh };
          if (!hitsBox(b)) { box = b; break; }
        }
        if (!box) continue;
        placed.push({ x: box.x - 6, y: box.y - 2, w: box.w + 12, h: box.h + 4 });
        var a = isHot ? 1 : (hot >= 0 ? 0.55 : 0.8);
        ctx.lineJoin = 'round';
        ctx.lineWidth = 3;
        ctx.strokeStyle = rgba(th.bg, 0.85 * a);
        ctx.strokeText(text, box.x, box.y + bh / 2);
        ctx.fillStyle = rgba(isHot ? th.fg : th.muted, a);
        ctx.fillText(text, box.x, box.y + bh / 2);
        shown++;
      }
    }

    // ---- hover card ----
    function fillCard(k) {
      var n = nodes[k];
      card.setAttribute('data-kind', n.kind || '');
      cKind.textContent = KIND_TEXT[n.kind] || n.kind || '';
      cLabel.textContent = n.label || '';
      cMetric.textContent = n.metric || '';
      cSummary.textContent = n.summary || '';
      var href = n.href || '#';
      card.setAttribute('href', href);
      if (/^#/.test(href)) { card.removeAttribute('target'); card.removeAttribute('rel'); }
      else { card.setAttribute('target', '_blank'); card.setAttribute('rel', 'noopener noreferrer'); }
    }

    function placeCard() {
      if (hot < 0) return;
      var P = pts[slot[hot]], rr = R[hot] + 14;
      var cw = card.offsetWidth, ch = card.offsetHeight, m = 8, x, y, ox;
      if (P.x + rr + cw <= W - m) { x = P.x + rr; y = P.y - ch / 2; ox = '0'; }
      else if (P.x - rr - cw >= m) { x = P.x - rr - cw; y = P.y - ch / 2; ox = '100%'; }
      else {
        x = P.x - cw / 2; ox = '50%';
        y = P.y > H / 2 ? P.y - rr - ch : P.y + rr;
      }
      x = clamp(x, m, Math.max(m, W - cw - m));
      y = clamp(y, m, Math.max(m, H - ch - m));
      card.style.transform = '';
      card.style.left = Math.round(x) + 'px';
      card.style.top = Math.round(y) + 'px';
      card.style.setProperty('--tx-ox', ox);
    }

    function syncList() {
      if (!listEls.length) queryList();
      var id = hot >= 0 ? String(nodes[hot].id) : null;
      for (var j = 0; j < listEls.length; j++) {
        listEls[j].classList.toggle('is-active', listEls[j].getAttribute('data-id') === id);
      }
    }

    function setHot(k, src) {
      clearTimeout(hideTimer); hideTimer = 0;
      if (k === hot) { if (k >= 0) hotSrc = src; return; }
      hot = k; hotSrc = k >= 0 ? src : null;
      if (k >= 0) {
        fillCard(k);
        placeCard();
        card.classList.add('is-on');
        if (src === 'key') {
          var n = nodes[k];
          live.textContent = (KIND_TEXT[n.kind] || '') + ': ' + n.label + ', ' + n.metric + '. ' + n.summary + ' Press Enter to open.';
        }
      } else {
        card.classList.remove('is-on');
        cardHover = false;
      }
      el.setAttribute('data-active', k >= 0 ? nodes[k].id : '');
      syncList();
      request();
    }

    function scheduleHide() {
      if (hot < 0 || hideTimer) return;
      hideTimer = setTimeout(function () {
        hideTimer = 0;
        if (!cardHover) setHot(-1);
      }, GRACE_MS);
    }

    function openNode(k) {
      if (k < 0 || !nodes[k]) return;
      var href = nodes[k].href || '';
      if (!href) return;
      if (href.charAt(0) === '#') {
        var target = href.length > 1 ? document.getElementById(decodeURIComponent(href.slice(1))) : null;
        if (target) target.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
      } else {
        window.open(href, '_blank', 'noopener,noreferrer');
      }
    }

    // ---- pose control ----
    function reset() {
      inertia = false; vel.xw = vel.yw = 0;
      if (intro) return;
      if (reduced()) {
        PLANES.forEach(function (k) { ang[k] = rest[k]; });
        ease = null;
        request();
        return;
      }
      var from = {}, diff = {}, total = 0;
      PLANES.forEach(function (k) { from[k] = ang[k]; diff[k] = wrap(rest[k] - ang[k]); total += Math.abs(diff[k]); });
      if (total < 1e-4) return;
      ease = { from: from, diff: diff, t0: 0 };
      request();
    }

    function startIntro() {
      if (started) return;
      started = true;
      if (reduced()) { unfold = 1; alpha = 1; draw(); return; }
      intro = { t0: 0 };
      unfold = 0; alpha = 0;
      request();
    }

    // ---- hit testing ----
    function local(e) {
      var r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    function hit(x, y, slack) {
      var best = -1, bd = 1e9;
      for (var k = 0; k < slot.length; k++) {
        var P = pts[slot[k]];
        var d = Math.hypot(P.x - x, P.y - y);
        if (d < Math.max(16, R[k] + (slack || 9)) && d < bd) { bd = d; best = k; }
      }
      return best;
    }

    // ---- pointer ----
    function onDown(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      var p = local(e);
      down = { id: e.pointerId, x: p.x, y: p.y, sx: p.x, sy: p.y, t: e.timeStamp, type: e.pointerType };
      dragging = false;
      inertia = false; vel.xw = vel.yw = 0;
      if (ease) ease = null;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }

    function onMove(e) {
      var p = local(e);
      if (down && e.pointerId === down.id) {
        if (!dragging && Math.hypot(p.x - down.sx, p.y - down.sy) > 4 && !intro) {
          dragging = true;
          el.classList.add('tx-dragging');
          el.classList.remove('tx-over-node');
          setHot(-1);
        }
        if (dragging) {
          var k = 2.6 / Math.max(240, Math.min(W, H));
          var dx = (p.x - down.x) * k, dy = (p.y - down.y) * k;
          ang.xw += dx; ang.yw += dy;
          var dts = Math.max(8, e.timeStamp - down.t) / 1000;
          vel.xw = vel.xw * 0.5 + (dx / dts) * 0.5;
          vel.yw = vel.yw * 0.5 + (dy / dts) * 0.5;
          down.t = e.timeStamp;
          request();
        }
        down.x = p.x; down.y = p.y;
        return;
      }
      if (e.pointerType === 'touch') return;
      var k2 = hit(p.x, p.y);
      el.classList.toggle('tx-over-node', k2 >= 0);
      if (k2 >= 0) setHot(k2, 'pointer');
      else if (hot >= 0 && hotSrc === 'pointer') scheduleHide();
    }

    function onUp(e) {
      if (!down || e.pointerId !== down.id) return;
      var d = down, p = local(e);
      down = null;
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      if (dragging) {
        dragging = false;
        el.classList.remove('tx-dragging');
        var idle = e.timeStamp - d.t;
        var cap = 6;
        vel.xw = clamp(vel.xw, -cap, cap); vel.yw = clamp(vel.yw, -cap, cap);
        if (!reduced() && idle < 90 && Math.abs(vel.xw) + Math.abs(vel.yw) > 0.05) { inertia = true; request(); }
        else { vel.xw = vel.yw = 0; request(); }
        return;
      }
      var k = hit(p.x, p.y, d.type === 'mouse' ? 9 : 16);
      if (d.type === 'mouse') {
        if (k >= 0) openNode(k);
        return;
      }
      // touch / pen: tap shows the card, double tap resets the pose
      var now = e.timeStamp;
      if (lastTap && now - lastTap.t < 320 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 30) {
        lastTap = null;
        reset();
        return;
      }
      lastTap = { t: now, x: p.x, y: p.y };
      setHot(k >= 0 ? (k === hot ? -1 : k) : -1, 'touch');
    }

    function onCancel(e) {
      if (!down || e.pointerId !== down.id) return;
      down = null;
      if (dragging) { dragging = false; el.classList.remove('tx-dragging'); }
    }

    function onLeave() {
      el.classList.remove('tx-over-node');
      if (!down && hot >= 0 && hotSrc === 'pointer') scheduleHide();
    }

    function onDbl(e) { e.preventDefault(); reset(); }

    // ---- card ----
    function onCardEnter() { cardHover = true; clearTimeout(hideTimer); hideTimer = 0; }
    function onCardLeave() { cardHover = false; if (hotSrc !== 'key') scheduleHide(); }
    function onCardClick(e) {
      var href = card.getAttribute('href') || '';
      if (href.charAt(0) === '#') { e.preventDefault(); openNode(hot); }
    }

    // ---- keyboard ----
    function onKey(e) {
      if (e.target !== el) return;
      var n = nodes.length, k = hot;
      switch (e.key) {
        case 'ArrowRight': case 'ArrowDown': k = hot < 0 ? 0 : (hot + 1) % n; break;
        case 'ArrowLeft': case 'ArrowUp': k = hot < 0 ? n - 1 : (hot - 1 + n) % n; break;
        case 'Home': k = 0; break;
        case 'End': k = n - 1; break;
        case 'Enter': case ' ': if (hot >= 0) { e.preventDefault(); openNode(hot); } return;
        case 'Escape': if (hot >= 0) { e.preventDefault(); setHot(-1); } return;
        case 'r': case 'R': reset(); return;
        default: return;
      }
      e.preventDefault();
      setHot(k, 'key');
    }
    function onFocus() {
      var fv = true;
      try { fv = el.matches(':focus-visible'); } catch (err) { /* older browsers */ }
      if (fv && hot < 0) setHot(0, 'key');
    }
    function onBlur(e) {
      if (e.relatedTarget && el.contains(e.relatedTarget)) return;
      if (hot >= 0 && hotSrc === 'key') setHot(-1);
    }

    // ---- .tx-list mirror ----
    function listIndex(t) {
      var item = t && t.closest ? t.closest('.tx-list [data-id]') : null;
      if (!item) return -1;
      var id = item.getAttribute('data-id');
      for (var k = 0; k < nodes.length; k++) if (String(nodes[k].id) === id) return k;
      return -1;
    }
    function onListOver(e) { var k = listIndex(e.target); if (k >= 0) setHot(k, 'list'); }
    function onListOut(e) {
      if (listIndex(e.target) < 0) return;
      if (e.relatedTarget && listIndex(e.relatedTarget) >= 0) return;
      if (hotSrc === 'list') scheduleHide();
    }

    // ---- theme / environment ----
    var themeTimer = 0;
    function onTheme() {
      request();
      clearTimeout(themeTimer);
      themeTimer = setTimeout(request, 320);   // catch CSS transitions on theme switch
    }

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onCancel);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('dblclick', onDbl);
    card.addEventListener('pointerenter', onCardEnter);
    card.addEventListener('pointerleave', onCardLeave);
    card.addEventListener('click', onCardClick);
    el.addEventListener('keydown', onKey);
    el.addEventListener('focus', onFocus);
    el.addEventListener('focusout', onBlur);
    document.addEventListener('pointerover', onListOver);
    document.addEventListener('pointerout', onListOut);
    document.addEventListener('focusin', onListOver);
    document.addEventListener('focusout', onListOut);
    window.addEventListener('resize', resize);

    var ro = window.ResizeObserver ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(el);
    var mo = window.MutationObserver ? new MutationObserver(onTheme) : null;
    if (mo) mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
    var schemeMQ = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
    var addMQ = function (mq, fn) { if (!mq) return; if (mq.addEventListener) mq.addEventListener('change', fn); else if (mq.addListener) mq.addListener(fn); };
    var rmMQ = function (mq, fn) { if (!mq) return; if (mq.removeEventListener) mq.removeEventListener('change', fn); else if (mq.removeListener) mq.removeListener(fn); };
    addMQ(schemeMQ, onTheme);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { request(); });

    queryList();
    var io = null;
    var deferIntro = !!window.IntersectionObserver && !reduced();
    if (deferIntro) { unfold = 0; alpha = 0; }   // stay blank until the intro plays
    resize();

    if (deferIntro) {
      io = new IntersectionObserver(function (entries) {
        for (var j = 0; j < entries.length; j++) {
          if (entries[j].isIntersecting) { io.disconnect(); io = null; startIntro(); break; }
        }
      }, { threshold: 0.15 });
      io.observe(el);
    } else {
      startIntro();
    }

    var api = {
      el: el,
      reset: reset,
      select: function (id) {
        var k = -1;
        for (var j = 0; j < nodes.length; j++) if (String(nodes[j].id) === String(id)) k = j;
        setHot(k, 'api');
      },
      destroy: function () {
        destroyed = true;
        if (raf) cancelAnimationFrame(raf);
        clearTimeout(hideTimer); clearTimeout(themeTimer);
        if (ro) ro.disconnect();
        if (mo) mo.disconnect();
        if (io) io.disconnect();
        rmMQ(schemeMQ, onTheme);
        window.removeEventListener('resize', resize);
        el.removeEventListener('keydown', onKey);
        el.removeEventListener('focus', onFocus);
        el.removeEventListener('focusout', onBlur);
        document.removeEventListener('pointerover', onListOver);
        document.removeEventListener('pointerout', onListOut);
        document.removeEventListener('focusin', onListOver);
        document.removeEventListener('focusout', onListOut);
        hot = -1; syncList();
        [canvas, card, live].forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
        el.classList.remove('tx-host', 'tx-dragging', 'tx-over-node');
        delete el.__tx;
      },
      // exposed for testing / debugging
      _debug: function () {
        return {
          W: W, H: H, dpr: dpr, hot: hot, angles: Object.assign({}, ang), animating: !!raf,
          nodes: slot.map(function (v, k) { return { id: nodes[k].id, x: pts[v].x, y: pts[v].y, r: R[k], t: pts[v].t }; }),
          verts: pts.map(function (p) { return { x: p.x, y: p.y }; })
        };
      }
    };
    el.__tx = api;
    return api;
  }

  window.Tesseract = { mount: mount, REST: REST, SLOT: SLOT };

  function auto() {
    var el = document.getElementById('tesseract');
    if (el) mount(el);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto);
  else auto();
})();
