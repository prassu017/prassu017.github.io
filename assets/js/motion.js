/* motion.js: interactions and motion for prassu017.github.io
   Classic script, loaded with defer. No dependencies.
   Hooks: [data-reveal] [data-split] [data-count] [data-magnetic] .spotlight [data-tilt]
          [data-marquee] #terminal .nav #scroll-progress [data-theme-toggle] a[href^="#"] #yr */
(function () {
  'use strict';

  var root = document.documentElement;
  root.classList.add('js');

  var mm = function (q) {
    return window.matchMedia ? window.matchMedia(q) : { matches: false, addEventListener: null };
  };
  var reducedMQ = mm('(prefers-reduced-motion: reduce)');
  var fineMQ = mm('(hover: hover) and (pointer: fine)');
  var reduced = function () { return !!reducedMQ.matches; };
  var finePointer = function () { return !!fineMQ.matches; };

  var $$ = function (sel, ctx) {
    return Array.prototype.slice.call((ctx || document).querySelectorAll(sel));
  };
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var raf = window.requestAnimationFrame
    ? window.requestAnimationFrame.bind(window)
    : function (fn) { return setTimeout(function () { fn(Date.now()); }, 16); };
  var now = function () { return window.performance && performance.now ? performance.now() : Date.now(); };

  /* ---------------------------------------------------------------- visibility */
  // One shared observer. Each element maps to a list of callbacks run once on entry.
  var watchers = typeof Map === 'function' ? new Map() : null;
  var io = null;
  if ('IntersectionObserver' in window && watchers) {
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        fire(e.target);
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
  }

  function fire(el) {
    if (!watchers) return;
    var fns = watchers.get(el);
    if (!fns) return;
    watchers.delete(el);
    if (io) io.unobserve(el);
    fns.forEach(function (fn) { try { fn(el); } catch (err) { if (window.console) console.error(err); } });
  }

  function inView(el) {
    var r = el.getBoundingClientRect();
    var vh = window.innerHeight || root.clientHeight;
    var vw = window.innerWidth || root.clientWidth;
    return r.bottom > 0 && r.right > 0 && r.top < vh * 0.92 && r.left < vw && (r.width || r.height);
  }

  // Run fn(el) once when el becomes visible. Without IO, run on the next frame.
  function onVisible(el, fn) {
    if (!io) { raf(function () { fn(el); }); return; }
    var list = watchers.get(el);
    if (list) { list.push(fn); return; }
    watchers.set(el, [fn]);
    io.observe(el);
  }

  // Elements already on screen at load: reveal on the next painted frame so the
  // transition still plays, without waiting for the async IO callback.
  function flushInView() {
    if (!watchers) return;
    var pending = [];
    watchers.forEach(function (_, el) { if (inView(el)) pending.push(el); });
    if (!pending.length) return;
    raf(function () { raf(function () { pending.forEach(fire); }); });
  }

  function reveal(el) {
    var d = parseInt(el.getAttribute('data-reveal-delay'), 10);
    if (d > 0 && !reduced()) setTimeout(function () { el.classList.add('is-in'); }, d);
    else el.classList.add('is-in');
  }

  /* ---------------------------------------------------------------- split text */
  var PUNCT = /^[.,;:!?%)\]}"'\u2019\u201D\u2026]+$/;
  var splitCSSDone = false;
  function splitCSS() {
    // Tiny scoped rule for trailing punctuation (.wp); words (.w/.wi) are styled in site.css.
    if (splitCSSDone) return;
    splitCSSDone = true;
    var st = document.createElement('style');
    st.textContent = '.js [data-split] .wp{opacity:0;transition:opacity .5s ease calc(var(--i,0) * 40ms + 200ms)}' +
      '.js [data-split].is-in .wp{opacity:1}' +
      '@media (prefers-reduced-motion: reduce){.js [data-split] .wp{opacity:1;transition:none}}';
    (document.head || root).appendChild(st);
  }

  function splitHeading(h) {
    if (h.hasAttribute('data-split-done')) return;
    var label = (h.textContent || '').replace(/\s+/g, ' ').trim();
    if (!label) return;
    splitCSS();
    var idx = 0;
    var lastWasWord = false;

    function wordSpan(text) {
      var w = document.createElement('span');
      w.className = 'w';
      w.setAttribute('aria-hidden', 'true');
      var wi = document.createElement('span');
      wi.className = 'wi';
      wi.style.setProperty('--i', String(idx++));
      wi.textContent = text;
      w.appendChild(wi);
      return w;
    }

    function build(src, dest) {
      Array.prototype.slice.call(src.childNodes).forEach(function (node) {
        if (node.nodeType === 3) {
          var parts = node.nodeValue.split(/(\s+)/);
          parts.forEach(function (p) {
            if (!p) return;
            if (/^\s+$/.test(p)) {
              dest.appendChild(document.createTextNode(' '));
              lastWasWord = false;
            } else {
              if (lastWasWord && PUNCT.test(p)) {
                // Punctuation glued to the previous word: plain inline span, so it
                // can never wrap onto its own line. Fades with that word.
                var pu = document.createElement('span');
                pu.className = 'wp';
                pu.setAttribute('aria-hidden', 'true');
                pu.style.setProperty('--i', String(Math.max(0, idx - 1)));
                pu.textContent = p;
                // Chrome allows a break between an inline-block and the next character, so
                // glue the punctuation to whatever holds the previous word (a .w, or a short
                // <em>/<strong>) inside a nowrap group.
                var prev = dest.lastChild;
                var short = prev && prev.nodeType === 1 &&
                  (prev.classList.contains('w') || prev.querySelectorAll('.w').length <= 4);
                if (short) {
                  var g = document.createElement('span');
                  g.className = 'wg';
                  g.style.whiteSpace = 'nowrap';
                  dest.replaceChild(g, prev);
                  g.appendChild(prev);
                  g.appendChild(pu);
                } else {
                  dest.appendChild(pu);
                }
              } else {
                dest.appendChild(wordSpan(p));
              }
              lastWasWord = true;
            }
          });
        } else if (node.nodeType === 1) {
          var tag = node.tagName;
          if (tag === 'BR') { dest.appendChild(node.cloneNode(false)); lastWasWord = false; return; }
          if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'svg' || tag === 'SVG' || tag === 'IMG') {
            dest.appendChild(node.cloneNode(true)); lastWasWord = false; return;
          }
          var shell = node.cloneNode(false); // keeps <em>/<strong>/<a> and their attributes
          build(node, shell);
          dest.appendChild(shell);
        }
      });
    }

    var frag = document.createDocumentFragment();
    build(h, frag);
    while (h.firstChild) h.removeChild(h.firstChild);
    h.appendChild(frag);
    h.setAttribute('aria-label', label);
    h.setAttribute('data-split-done', '');
    h.style.setProperty('--words', String(idx));
  }

  /* ---------------------------------------------------------------- counters */
  var easeOutExpo = function (t) { return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t); };

  function countUp(el) {
    var finalText = el.getAttribute('data-count-final');
    var raw = String(el.getAttribute('data-count') || '').replace(/,/g, '').trim();
    var target = parseFloat(raw);
    if (!isFinite(target) || target === 0 || reduced()) { el.textContent = finalText; return; }
    var decAttr = parseInt(el.getAttribute('data-decimals'), 10);
    var decimals = isFinite(decAttr) ? decAttr : (raw.split('.')[1] || '').length;
    var prefix = el.getAttribute('data-prefix') || '';
    var suffix = el.getAttribute('data-suffix') || '';
    var fmt = function (v) {
      return prefix + v.toLocaleString('en-US', {
        minimumFractionDigits: decimals, maximumFractionDigits: decimals
      }) + suffix;
    };
    var dur = 1600;
    var t0 = now();
    (function tick() {
      var t = clamp((now() - t0) / dur, 0, 1);
      if (t >= 1) { el.textContent = finalText; el.classList.add('is-counted'); return; }
      el.textContent = fmt(target * easeOutExpo(t));
      raf(tick);
    })();
  }

  function setupCounters() {
    $$('[data-count]').forEach(function (el) {
      var finalText = el.textContent;
      el.setAttribute('data-count-final', finalText);
      var target = parseFloat(String(el.getAttribute('data-count') || '').replace(/,/g, ''));
      if (reduced() || !isFinite(target) || target === 0) return; // static text stays as is
      var decAttr = parseInt(el.getAttribute('data-decimals'), 10);
      var decimals = isFinite(decAttr) ? decAttr : 0;
      el.textContent = (el.getAttribute('data-prefix') || '') + (0).toFixed(decimals) +
        (el.getAttribute('data-suffix') || '');
      onVisible(el, countUp);
    });
  }

  /* ---------------------------------------------------------------- spring helper */
  // Lerps an element's {x,y} toward a target each frame, then calls apply(state).
  function springLoop(state, apply, ease) {
    if (state.running) return;
    state.running = true;
    (function step() {
      state.x += (state.tx - state.x) * ease;
      state.y += (state.ty - state.y) * ease;
      var settled = Math.abs(state.tx - state.x) < 0.01 && Math.abs(state.ty - state.y) < 0.01;
      if (settled) { state.x = state.tx; state.y = state.ty; }
      apply(state, settled);
      if (settled) { state.running = false; return; }
      raf(step);
    })();
  }

  /* ---------------------------------------------------------------- magnetic */
  function setupMagnetic() {
    if (reduced() || !finePointer()) return;
    $$('[data-magnetic]').forEach(function (el) {
      var MAX = 6;
      var s = { x: 0, y: 0, tx: 0, ty: 0, running: false };
      var apply = function (st, settled) {
        el.style.transform = (settled && st.x === 0 && st.y === 0)
          ? '' : 'translate3d(' + st.x.toFixed(2) + 'px,' + st.y.toFixed(2) + 'px,0)';
      };
      el.addEventListener('pointermove', function (e) {
        if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
        var r = el.getBoundingClientRect();
        var dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2 || 1);
        var dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2 || 1);
        s.tx = clamp(dx, -1, 1) * MAX;
        s.ty = clamp(dy, -1, 1) * MAX;
        springLoop(s, apply, 0.2);
      });
      el.addEventListener('pointerleave', function () {
        s.tx = 0; s.ty = 0;
        springLoop(s, apply, 0.12);
      });
    });
  }

  /* ---------------------------------------------------------------- spotlight */
  function setupSpotlight() {
    $$('.spotlight').forEach(function (el) {
      var pending = false, cx = 0, cy = 0;
      el.addEventListener('pointermove', function (e) {
        cx = e.clientX; cy = e.clientY;
        if (pending) return;
        pending = true;
        raf(function () {
          pending = false;
          var r = el.getBoundingClientRect();
          el.style.setProperty('--mx', (cx - r.left).toFixed(1) + 'px');
          el.style.setProperty('--my', (cy - r.top).toFixed(1) + 'px');
        });
      }, { passive: true });
    });
  }

  /* ---------------------------------------------------------------- tilt */
  function setupTilt() {
    if (reduced() || !finePointer()) return;
    $$('[data-tilt]').forEach(function (el) {
      var MAX = 4;
      var s = { x: 0, y: 0, tx: 0, ty: 0, running: false }; // x = rotateX, y = rotateY
      var apply = function (st, settled) {
        if (settled && st.x === 0 && st.y === 0) {
          el.style.transform = '';
          el.style.removeProperty('--tilt-x');
          el.style.removeProperty('--tilt-y');
          el.classList.remove('is-tilting');
          return;
        }
        var rx = st.x.toFixed(2) + 'deg', ry = st.y.toFixed(2) + 'deg';
        el.style.setProperty('--tilt-x', rx);
        el.style.setProperty('--tilt-y', ry);
        el.style.transform = 'perspective(900px) rotateX(' + rx + ') rotateY(' + ry + ')';
      };
      el.addEventListener('pointermove', function (e) {
        if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
        var r = el.getBoundingClientRect();
        var px = clamp((e.clientX - r.left) / (r.width || 1), 0, 1);
        var py = clamp((e.clientY - r.top) / (r.height || 1), 0, 1);
        s.tx = (0.5 - py) * 2 * MAX;
        s.ty = (px - 0.5) * 2 * MAX;
        el.classList.add('is-tilting');
        springLoop(s, apply, 0.16);
      });
      el.addEventListener('pointerleave', function () {
        s.tx = 0; s.ty = 0;
        springLoop(s, apply, 0.1);
      });
    });
  }

  /* ---------------------------------------------------------------- marquee */
  function setupMarquee() {
    $$('[data-marquee]').forEach(function (m) {
      var track = m.querySelector('.marquee-track');
      if (!track || track.hasAttribute('data-cloned')) return;
      var kids = Array.prototype.slice.call(track.children);
      kids.forEach(function (k) {
        var c = k.cloneNode(true);
        c.setAttribute('aria-hidden', 'true');
        c.removeAttribute('id');
        $$('[id]', c).forEach(function (n) { n.removeAttribute('id'); });
        $$('a,button,input,select,textarea,[tabindex]', c).forEach(function (n) { n.setAttribute('tabindex', '-1'); });
        if (c.matches && c.matches('a,button,[tabindex]')) c.setAttribute('tabindex', '-1');
        track.appendChild(c);
      });
      track.setAttribute('data-cloned', '');
      m.classList.add('is-ready');
    });
  }

  /* ---------------------------------------------------------------- terminal */
  var PROMPT = '~/prasanna $ ';

  function setupTerminal() {
    var term = document.getElementById('terminal');
    var dataEl = document.getElementById('terminal-data');
    if (!term || !dataEl) return;
    var lines;
    try { lines = JSON.parse(dataEl.textContent || '[]'); } catch (err) { return; }
    if (!Array.isArray(lines) || !lines.length) return;

    var body = term.querySelector('[data-terminal-body], .terminal-body, .term-body') || term;
    // Clear static fallback lines (keep any chrome like a title bar when rendering into #terminal).
    if (body === term) $$('.t-line', term).forEach(function (n) { n.parentNode.removeChild(n); });
    else while (body.firstChild) body.removeChild(body.firstChild);

    var mk = function (tag, cls, text) {
      var n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    };
    var caret = mk('span', 'caret');
    caret.setAttribute('aria-hidden', 'true');

    function cmdLine() {
      var line = mk('div', 't-line t-in');
      line.appendChild(mk('span', 't-prompt', PROMPT));
      var cmd = mk('span', 't-cmd', '');
      line.appendChild(cmd);
      body.appendChild(line);
      return cmd;
    }
    function outLine(text) { body.appendChild(mk('div', 't-line t-out', String(text))); }
    function stick() { if (body.scrollHeight > body.clientHeight) body.scrollTop = body.scrollHeight; }
    function finish() {
      var last = cmdLine();
      last.parentNode.appendChild(caret);
      term.setAttribute('aria-busy', 'false');
      term.classList.add('is-done');
      stick();
    }

    function renderAll() {
      lines.forEach(function (l) {
        cmdLine().textContent = String(l.cmd || '');
        (l.out || []).forEach(outLine);
      });
      finish();
    }

    if (reduced()) { renderAll(); return; }

    // Idle prompt with caret until the terminal scrolls into view.
    var idle = cmdLine();
    idle.parentNode.appendChild(caret);

    onVisible(term, function () {
      term.setAttribute('aria-busy', 'true');
      term.classList.add('is-typing');
      body.removeChild(idle.parentNode);
      var li = 0;
      var wait = function (ms, fn) { setTimeout(fn, ms); };

      function nextLine() {
        if (li >= lines.length) { term.classList.remove('is-typing'); finish(); return; }
        var l = lines[li++];
        var text = String(l.cmd || '');
        var cmd = cmdLine();
        cmd.parentNode.appendChild(caret);
        stick();
        var ci = 0;
        (function typeChar() {
          if (ci < text.length) {
            cmd.textContent = text.slice(0, ++ci);
            wait(35 + Math.random() * 30 - 10, typeChar);
            return;
          }
          wait(260, function () {
            var outs = (l.out || []).slice();
            (function printOut() {
              if (outs.length) {
                outLine(outs.shift());
                stick();
                wait(90, printOut);
                return;
              }
              wait(380, nextLine);
            })();
          });
        })();
      }
      wait(250, nextLine);
    });
  }

  /* ---------------------------------------------------------------- nav + progress */
  function setupScroll() {
    var nav = document.querySelector('.nav');
    var bar = document.getElementById('scroll-progress');
    if (!nav && !bar) return;
    var ticking = false;
    function update() {
      ticking = false;
      var y = window.pageYOffset || root.scrollTop || 0;
      if (nav) nav.classList.toggle('scrolled', y > 16);
      if (bar) {
        var max = (root.scrollHeight || document.body.scrollHeight) - window.innerHeight;
        var p = max > 0 ? clamp(y / max, 0, 1) : 0;
        bar.style.transform = 'scaleX(' + p.toFixed(4) + ')';
      }
    }
    function onScroll() { if (!ticking) { ticking = true; raf(update); } }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    window.addEventListener('load', onScroll);
    update();
  }

  /* ---------------------------------------------------------------- theme */
  var darkMQ = mm('(prefers-color-scheme: light)');
  function currentTheme() {
    var t = root.getAttribute('data-theme');
    if (t === 'light' || t === 'dark') return t;
    return darkMQ.matches ? 'light' : 'dark';
  }

  function setupTheme() {
    var stored = null;
    try { stored = window.localStorage.getItem('theme'); } catch (err) { /* storage blocked */ }
    if ((stored === 'light' || stored === 'dark') && !root.getAttribute('data-theme')) {
      root.setAttribute('data-theme', stored);
    }
    var buttons = $$('[data-theme-toggle]');
    if (!buttons.length) return;
    function sync() {
      var t = currentTheme();
      var label = t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
      buttons.forEach(function (b) {
        b.setAttribute('aria-pressed', t === 'dark' ? 'true' : 'false');
        b.setAttribute('aria-label', label);
        b.setAttribute('title', label);
        b.setAttribute('data-theme-current', t);
      });
    }
    buttons.forEach(function (b) {
      b.addEventListener('click', function () {
        var next = currentTheme() === 'dark' ? 'light' : 'dark';
        root.classList.add('theme-switching');
        root.setAttribute('data-theme', next);
        try { window.localStorage.setItem('theme', next); } catch (err) { /* storage blocked */ }
        sync();
        setTimeout(function () { root.classList.remove('theme-switching'); }, 300);
      });
    });
    if (darkMQ.addEventListener) darkMQ.addEventListener('change', sync);
    else if (darkMQ.addListener) darkMQ.addListener(sync);
    sync();
  }

  /* ---------------------------------------------------------------- anchors */
  function setupAnchors() {
    document.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target && e.target.closest ? e.target.closest('a[href^="#"]') : null;
      if (!a) return;
      var hash = a.getAttribute('href');
      var target;
      if (hash === '#' || hash === '#top') {
        target = null;
      } else {
        var id;
        try { id = decodeURIComponent(hash.slice(1)); } catch (err) { id = hash.slice(1); }
        target = document.getElementById(id);
        if (!target) return;
      }
      e.preventDefault();
      var nav = document.querySelector('.nav');
      var offset = (nav ? nav.getBoundingClientRect().height : 72) + 8;
      var top = target ? target.getBoundingClientRect().top + (window.pageYOffset || 0) - offset : 0;
      var behavior = reduced() ? 'instant' : 'smooth';
      try { window.scrollTo({ top: Math.max(0, top), behavior: behavior }); }
      catch (err) { window.scrollTo(0, Math.max(0, top)); }
      if (window.history && history.pushState) {
        try { history.pushState(null, '', hash === '#' ? location.pathname + location.search : hash); } catch (err) { /* file:// etc */ }
      }
      if (target) {
        if (!target.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) {
          target.setAttribute('tabindex', '-1');
        }
        try { target.focus({ preventScroll: true }); } catch (err) { /* old browsers */ }
      }
    });
  }

  /* ---------------------------------------------------------------- init */
  function init() {
    var yr = document.getElementById('yr');
    if (yr) yr.textContent = String(new Date().getFullYear());

    setupTheme();
    setupScroll();

    var splits = $$('[data-split]');
    var reveals = $$('[data-reveal]');
    if (reduced()) {
      splits.concat(reveals).forEach(function (el) { el.classList.add('is-in'); });
    } else {
      splits.forEach(function (h) { splitHeading(h); onVisible(h, reveal); });
      reveals.forEach(function (el) { if (splits.indexOf(el) === -1) onVisible(el, reveal); });
    }

    setupCounters();
    setupMarquee();
    setupTerminal();
    setupSpotlight();
    setupMagnetic();
    setupTilt();
    setupAnchors();
    flushInView();

    window.Motion = { reduced: reduced, finePointer: finePointer, split: splitHeading, version: 2 };
  }

  var safe = function () { try { init(); } catch (err) { root.classList.remove('js'); root.classList.add('motion-failed'); if (window.console) console.error(err); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', safe);
  else safe();
})();
