// kax-motion km 엔진 뼈대 (채팅·UI 2D 장면용으로 일반화).
// 장면(scene) 모듈을 등록하고, GSAP 드라이버 트윈 하나가 부르는 render(t)에서 지금 프레임에 걸린 장면만 보이게 한 뒤
// 그 장면의 render(f)를 부른다. 결정적·시크 안전: 시간·Math.random·네트워크를 쓰지 않는다(난수는 KM.rng(seed)).
//
// 장면 모듈: KM.add({ id, f0, f1, build(el, U), render(f, U) })
//   f = 컴포지션 프레임 번호(소수 가능, 30000/1001fps 기준). f0~f1(포함)에서만 보인다.
// 시작: KM.mount({ duration: 초, fps: 30000/1001, lift: [[0,"rgb(2,2,2)"]] })  ← index.html 끝에서 한 번
(function () {
  const scenes = [];
  let FPS = 30000 / 1001;
  let LIFT = null;
  const stage = () => document.getElementById("stage");

  const U = {
    clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
    lerp: (a, b, t) => a + (b - a) * t,
    // 표 보간: rows = [[f, v1, v2, ...], ...] (f 오름차순). 숫자는 선형 보간, 숫자 아닌 칸은 앞 행 값
    tab(rows, f) {
      const n = rows.length;
      if (f <= rows[0][0]) return rows[0].slice(1);
      if (f >= rows[n - 1][0]) return rows[n - 1].slice(1);
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) {
        const m = (lo + hi) >> 1;
        if (rows[m][0] <= f) lo = m; else hi = m;
      }
      const a = rows[lo], b = rows[hi];
      const t = (f - a[0]) / (b[0] - a[0]);
      const out = [];
      for (let k = 1; k < a.length; k++) out.push(typeof a[k] === "number" ? a[k] + (b[k] - a[k]) * t : a[k]);
      return out;
    },
    // 계단 표: f 이하에서 가장 가까운 행(보간 없음 — 타이핑·스왑·on_twos용)
    step(rows, f) {
      let r = rows[0];
      for (const x of rows) { if (x[0] <= f + 1e-3) r = x; else break; }
      return r.slice(1);
    },
    el(tag, cls, css, parent, html) {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (css) e.setAttribute("style", css);
      if (html !== undefined) e.innerHTML = html;
      if (parent) parent.appendChild(e);
      return e;
    },
    svg(markup, cls, css, parent) {
      const d = document.createElement("div");
      d.innerHTML = markup.trim();
      const s = d.firstChild;
      if (cls) s.setAttribute("class", cls);
      if (css) s.setAttribute("style", css);
      if (parent) parent.appendChild(s);
      return s;
    },
    // 방향 흐림(SVG feGaussianBlur, 자동 모션 블러 대신). sx·sy = 가로·세로 σ(px). 작으면 끈다.
    // 규칙: σ ≈ 0.35 × 그 프레임 이동량(px). index.html에 <svg><defs id="fdefs"></defs></svg>가 있어야 한다.
    mblur(el, id, sx, sy) {
      let b = U._mb[id];
      if (!b) {
        const NS = "http://www.w3.org/2000/svg";
        const f = document.createElementNS(NS, "filter");
        f.setAttribute("id", id);
        f.setAttribute("x", "-20%"); f.setAttribute("y", "-20%"); f.setAttribute("width", "140%"); f.setAttribute("height", "140%");
        f.setAttribute("color-interpolation-filters", "sRGB");
        b = document.createElementNS(NS, "feGaussianBlur");
        b.setAttribute("stdDeviation", "0 0");
        f.appendChild(b);
        document.getElementById("fdefs").appendChild(f);
        U._mb[id] = b;
      }
      if (sx + sy < 0.25) { el.style.filter = "none"; return; }
      b.setAttribute("stdDeviation", `${sx.toFixed(2)} ${sy.toFixed(2)}`);
      el.style.filter = `url(#${id})`;
    },
    _mb: {},
  };

  // 시드 고정 난수(mulberry32). 흐트러짐·흔들림에 쓴다.
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function add(sc) { scenes.push(sc); return sc; }

  function build() {
    const st = stage();
    for (const sc of scenes) {
      sc.el = U.el("div", "sc", "", st);
      sc.el.id = "sc_" + sc.id;
      sc._on = false;
      sc.build(sc.el, U);
    }
  }

  let liftEl = null, liftCur = "";
  function render(t) {
    const f = t * FPS;
    if (LIFT) {
      if (!liftEl) liftEl = document.getElementById("lift");
      if (liftEl) {
        let c = LIFT[0][1];
        for (const [ff, cc] of LIFT) if (f > ff - 1e-3) c = cc;
        if (c !== liftCur) { liftEl.style.background = c; liftCur = c; }
      }
    }
    for (const sc of scenes) {
      const on = f > sc.f0 - 1e-3 && f < sc.f1 + 1 - 1e-3;
      if (on !== sc._on) {
        sc.el.style.display = on ? "block" : "none";
        sc._on = on;
      }
      if (on) sc.render(f, U);
    }
  }

  // HyperFrames 계약: 루트 data-composition-id="main", window.__timelines["main"] = 멈춘 GSAP 타임라인
  function mount(opt) {
    FPS = opt.fps || FPS;
    LIFT = opt.lift || null;
    build();
    const tl = gsap.timeline({ paused: true });
    const drv = { t: 0 };
    tl.to(drv, { t: opt.duration, duration: opt.duration, ease: "none", onUpdate: () => render(drv.t) });
    window.__timelines = window.__timelines || {};
    window.__timelines[opt.id || "main"] = tl;
    render(0);
    return tl;
  }

  window.KM = Object.assign(window.KM || {}, { U, add, build, render, mount, rng, scenes, get FPS() { return FPS; } });
})();
