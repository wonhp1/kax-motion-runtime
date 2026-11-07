/* KC — kax-motion 공용 부품 상자의 등록·어댑터. 쓰는 법: components/README.md.
 *
 * 브라우저 전역 스크립트(모듈·빌드 없음). 부품 파일(<분류>/<이름>/<이름>.js)보다 먼저 읽는다.
 *
 *   KC.def(id, {renderer, defaults, create(opts, env)})   부품 등록
 *   KC.make(id, opts, env)                                부품 하나 만들기 → 인스턴스(draw|mount·render, bounds, events, span)
 *   KC.rng(seed)                                          시드 난수(mulberry32, km 엔진 KM.rng와 같은 수열)
 *   KC.ease.*                                             측정 곡선(km 엔진 curves.js와 같은 이름·값 + 부품용 몇 개)
 *   KC.curve(spec, N, env)                                presets.json 곡선 한 칸 → (n 프레임) => 진행 0..1
 *   KC.toKM(inst, {id, f0, f1})                           km 엔진(KM.add) 장면으로
 *   KC.toKX(inst, z)                                      kx 엔진(KX.layer) 층으로
 *   KC.toHF([inst, ...], rootEl, {duration, fps, id})     엔진 없이 HyperFrames 루트 하나에서 시간 순서로 돌림
 *   KC.fill(o, defaults, opts) 기본값 한 단계 아래 합치기(KC.make가 부름) ·
 *   KC.normalize(root)·KC.prime(els)·KC.vis(el, on)·KC.styleKey(el) dom 도우미 · toHF {warm} 크롬 예열, 그리기 오류 → 빨간 띠
 *
 * 엔진 어댑터·사건 도우미:
 *   ① KC.toKM(inst, {id, f0, f1, warm})·KC.toKX(inst, z, {warm}) (또는 toKX(inst, {z, warm}))도 toHF와 같은 두 가지를 한다:
 *      크롬 첫 drawImage 예열 — 매 그리기 첫 줄에 1×1 빈 캔버스를 그려 그 캔버스 그리기 방식을 첫 프레임부터 고정({warm: false}로 끔),
 *      그리기 도중 오류 → 화면 위 90px 빨간 띠 'KC 그리기 오류 …' + window.KC_DRAW_ERROR + console.error 한 번(그 뒤 프레임도 띠).
 *        toKM: canvas2d는 부품 캔버스에, dom·webgl은 장면 요소 위 겹친 캔버스에. toKX: canvas2d는 KX 맨 위 층(모션 블러 표본마다),
 *        dom·webgl은 KX.render 끝에 #cv 위에. 오류가 나도 엔진의 다른 장면·층은 계속 그린다.
 *   ② KC.retier(events, {first, signature}) — 영상 전체 사건 목록에서 first 하나·signature 하나를 고른다(규칙 R12). 부품 events()는
 *      tier를 normal·detail만 내고 머릿사건 후보에 hint: "first"|"signature", 프레임에 onset(움직임 시작)·land(닿음·멈춤)를 붙인다.
 *      first·signature 칸 = 사건 type 이름 | 이 배열의 번호 | 고르는 함수 (e, i, list) → true인 것 — 셋 다 후보 중 가장 이른 것(f).
 *      안 주면 그 hint가 붙은 가장 이른 사건(예전 부품이 tier에 first·signature를 내면 그것도 hint로 봄). 고르지 않은 hint 사건은
 *      tier normal(hint 칸은 남김), detail은 그대로. 사본을 돌려주고 원본은 바꾸지 않는다. 같은 사건을 둘 다 고르면 오류.
 *   ③ KC.evAt(P, N) → {ramp, land} — 부품 events()가 사건 프레임(onset·land)을 정하는 공용 셈. 곡선 P(n)(시작부터 n프레임, 0→1,
 *      길이 N프레임)을 한 번 훑어 화면 '솟음'(ramp)과 '착지'(land) 프레임(시작 기준 상대, land는 소수 N일 수 있음)을 준다. 셈의 뜻은
 *      아래 KC.evAt 주석. 부품마다 따로 셈하지 않고 이것 하나를 쓴다.
 *
 * 결정성: 부품은 프레임 번호 f(소수 가능)만 보고 그린다. Date·performance.now·Math.random·타이머·네트워크 금지.
 *   개발 모드(KC.dev = true, 또는 페이지에서 window.KC_DEV = 1 / window.KC_SELFTEST = 1)에서는 부품의 create·draw·
 *   render·mount를 부르는 동안 그 함수들을 '던지는 함수'로 바꿔 끼워, 쓰면 바로 오류가 난다.
 */
(function () {
  "use strict";
  const KC = {};
  KC.version = "0.6.7";
  KC.parts = {};
  KC.dev = !!(window.KC_DEV || window.KC_SELFTEST);

  const DEFAULT_ENV = { fps: 30000 / 1001, width: 1920, height: 1080 };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  KC.clamp = clamp;
  KC.lerp = lerp;

  /* ---------- 시드 난수 ----------
     mulberry32. km 엔진 engine/km/core.js의 rng(seed)와 같은 수식(같은 시드 = 같은 수열). 중복 구현 — 엔진 없이 쓰는 부품도 같은 수열을 쓰게 */
  KC.rng = function (seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /* ---------- 측정 곡선 ----------
     중복 구현 — 출처: km 엔진 engine/km/curves.js (KM.curve). 이름·인자·값이 같다(어댑터 확인에서 KM.curve와 값 대조).
     엔진 없이(toHF) 쓰는 부품도 같은 곡선을 써야 해서 여기 사본을 둔다. 고칠 때는 두 곳을 같이 고친다.
       settle(n, a, r)   expo_settle: 첫 프레임에 a, 이후 남은 거리 r배씩 (n = 지난 프레임 수, 29.97fps 측정)
       accel(n, N, g)    expo_accel: 프레임당 이동 g배씩, N에서 1
       table(prog, n, N) 정규화 진행 표를 N프레임으로 늘여 읽기
       bezier(x1,y1,x2,y2) → (u)=>진행    cubic-bezier
       hold(n, k)        on_twos/threes: k프레임마다만 값이 바뀜
       named.*           km 엔진 측정 곡선 이름표 (n, N) => 진행
     부품용으로 더한 것(이 파일이 처음):
       smooth(u)         smoothstep 3u²−2u³
       whip(a, s, m)     → (u)=>진행: 선형 a + 로지스틱(가파름 s, 가운데 m) 1−a. 띠가 들어와 머뭇 → 가운데서 휙 → 머뭇 → 나감(실측 띠 움직임)
       phi(z)            표준 정규 누적(erf 근사 — 부드러운 띠 가장자리) */
  const E = {};
  E.settle = function (n, a, r) {
    if (n <= 0) return 0;
    if (n < 1) return a * n;
    return 1 - (1 - a) * Math.pow(r, n - 1);
  };
  E.settlePx = function (n, a, r, dist, epsPx) {
    const p = E.settle(n, a, r);
    return (1 - p) * Math.abs(dist) < (epsPx || 0.25) ? 1 : p;
  };
  E.accel = function (n, N, g) {
    if (n <= 0) return 0;
    if (n >= N) return 1;
    return (Math.pow(g, n) - 1) / (Math.pow(g, N) - 1);
  };
  E.table = function (prog, n, N) {
    const M = prog.length - 1;
    const x = N ? (n / N) * M : n;
    if (x <= 0) return prog[0];
    if (x >= M) return prog[M];
    const i = Math.floor(x), t = x - i;
    return prog[i] + (prog[i + 1] - prog[i]) * t;
  };
  E.bezier = function (x1, y1, x2, y2) {
    return function (t) {
      if (t <= 0) return 0;
      if (t >= 1) return 1;
      let u = t;
      for (let k = 0; k < 20; k++) {
        const bx = 3 * (1 - u) * (1 - u) * u * x1 + 3 * (1 - u) * u * u * x2 + u * u * u;
        const dx = 3 * (1 - u) * (1 - u) * x1 + 6 * (1 - u) * u * (x2 - x1) + 3 * u * u * (1 - x2);
        if (Math.abs(dx) < 1e-7) break;
        u = Math.min(1, Math.max(0, u - (bx - t) / dx));
      }
      return 3 * (1 - u) * (1 - u) * u * y1 + 3 * (1 - u) * u * u * y2 + u * u * u;
    };
  };
  E.hold = function (n, k) {
    return Math.floor((n + 1e-6) / k) * k;
  };
  E.named = {
    slideIn: (n) => E.settle(n, 0.44, 0.82),
    cursorIn: (n) => E.settle(n, 0.25, 0.77),
    pushIn: (n) => E.settle(n, 0.17, 0.9),
    cardZoom: (n) => E.settle(n, 0.19, 0.886),
    windowRise: (n) => E.settle(n, 0.57, 0.69),
    circleRise: (n) => E.settle(n, 0.51, 0.73),
    endcardIn: (n) => E.settle(n, 0.44, 0.884),
    exitUp: (n, N) => E.accel(n, N, 1.56),
    scrollExit: (n, N) => E.accel(n, N, 1.45),
    cursorOut: (n, N) => E.accel(n, N, 1.31),
    widen: (n, N) => E.accel(n, N, 1.37),
    edgeWipe: (n, N) => E.accel(n, N, 1.25),
    pullback: (n, N) => E.accel(n, N, 1.39),
    endcardOut: (n, N) => E.accel(n, N, 1.36),
  };
  E.PRESS = [1, 0.9976, 0.995, 0.99, 0.981, 0.976, 0.962, 0.885, 0.842, 0.828, 0.82, 0.817, 0.813];
  E.smooth = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
  E.whip = function (a, s, m) {
    const L = (x) => 1 / (1 + Math.exp(-s * (x - m)));
    const L0 = L(0), L1 = L(1);
    return (u) => { u = clamp(u, 0, 1); return a * u + (1 - a) * (L(u) - L0) / (L1 - L0); };
  };
  E.erf = function (x) { // Abramowitz-Stegun 7.1.26 근사
    const s = x < 0 ? -1 : 1; x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  };
  E.phi = (z) => 0.5 * (1 + E.erf(z / Math.SQRT2));
  KC.ease = E;

  /* presets.json 곡선 한 칸 → (n) => 진행 0..1. n = 시작에서 지난 프레임 수(env.fps 기준), N = 길이(프레임, env.fps 기준).
     spec 꼴:
       {"fn": "bezier", "args": [x1,y1,x2,y2]}           정규화(길이 N에 맞춰 늘어남)
       {"fn": "whip", "args": [a, s, m]}                  정규화
       {"fn": "smooth"} | {"fn": "linear"}               정규화
       {"fn": "table", "args": [[0, ..., 1]]}            정규화 진행 표(마디 고르게)
       {"fn": "settle", "args": [a, r], "fps": 29.97}     프레임 단위 측정 — n을 측정 fps로 바꿔 읽음(N 무시)
       {"fn": "accel", "args": [g], "fps": 29.97}         프레임 단위 측정 — N도 측정 fps로 바꿈
       {"fn": "named", "args": ["slideIn"], "fps": 29.97} km 엔진 이름표
       "이름"                                             KC.ease.named의 이름(측정 fps 29.97로 봄)
     hold(k)를 주면 {"hold": 2}처럼 on_twos(프레임 단위, env.fps 기준). */
  KC.curve = function (spec, N, env) {
    const fps = (env && env.fps) || DEFAULT_ENV.fps;
    if (typeof spec === "string") spec = { fn: "named", args: [spec], fps: 30000 / 1001 };
    if (typeof spec === "function") return spec;
    const a = spec.args || [];
    const k = spec.fps ? spec.fps / fps : 1; // env 프레임 → 측정 프레임
    let g;
    switch (spec.fn) {
      case "linear": g = (n) => clamp(n / N, 0, 1); break;
      case "smooth": g = (n) => E.smooth(n / N); break;
      case "bezier": { const b = E.bezier(a[0], a[1], a[2], a[3]); g = (n) => b(n / N); break; }
      case "whip": { const w = E.whip(a[0], a[1], a[2]); g = (n) => w(n / N); break; }
      case "table": g = (n) => E.table(a[0], clamp(n, 0, N), N); break;
      case "settle": g = (n) => E.settle(n * k, a[0], a[1]); break;
      case "accel": g = (n) => E.accel(n * k, N * k, a[0]); break;
      case "named": { const f = E.named[a[0]]; if (!f) throw new Error("KC.curve: 이름 없음 " + a[0]); g = (n) => f(n * k, N * k); break; }
      default: throw new Error("KC.curve: 모르는 fn " + spec.fn);
    }
    if (spec.hold) { const h = spec.hold, g0 = g; g = (n) => g0(E.hold(n, h)); }
    return g;
  };
  // 초 → 프레임(env.fps)
  KC.frames = (sec, env) => sec * ((env && env.fps) || DEFAULT_ENV.fps);
  // 부품 안 상대 진행: f0부터 durSec초 동안 0→1 (곡선 없이). 부품 안에서 KC.curve와 함께 씀
  KC.prog = (f, f0, durSec, env) => clamp((f - f0) / KC.frames(durSec, env), 0, 1);
  // "#rrggbb" | "rgb(...)" | [r,g,b] → [r,g,b,a]
  KC.color = function (c) {
    if (Array.isArray(c)) return [c[0], c[1], c[2], c.length > 3 ? c[3] : 1];
    c = String(c).trim();
    if (c[0] === "#") {
      let h = c.slice(1);
      if (h.length === 3) h = h.split("").map((x) => x + x).join("");
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
    }
    const m = /rgba?\(([^)]+)\)/.exec(c);
    if (m) { const p = m[1].split(",").map(parseFloat); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
    throw new Error("KC.color: 읽을 수 없는 색 " + c);
  };
  KC.rgba = (c, a) => { const q = KC.color(c); return `rgba(${Math.round(q[0])},${Math.round(q[1])},${Math.round(q[2])},${(+(a === undefined ? q[3] : q[3] * a)).toFixed(4)})`; };

  /* KC.ctxReset(ctx) — 다시 쓰는 화면 밖 캔버스의 그리기 상태를 새 캔버스의 처음 값으로(캔버스 규격 기본값). 그림은 지우지 않는다.
     부품이 쓰는 쪽 콜백(가둠 그림 등)을 화면 밖 캔버스에 부르기 전에 쓴다 — 앞 프레임에서 부품이 남긴 fillStyle·합성 방식이 콜백에 새면
     콜백이 fillStyle을 안 정할 때 렌더(차례로 그림)에서만 그림이 달라진다(예: 지난 띠 그라데이션이 가둠 그림 색이 되어 빛이 사라짐). */
  KC.ctxReset = function (c) {
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1; c.globalCompositeOperation = "source-over"; c.filter = "none";
    c.fillStyle = "#000000"; c.strokeStyle = "#000000";
    c.lineWidth = 1; c.lineCap = "butt"; c.lineJoin = "miter"; c.miterLimit = 10;
    if (c.setLineDash) c.setLineDash([]);
    c.lineDashOffset = 0;
    c.shadowBlur = 0; c.shadowColor = "rgba(0, 0, 0, 0)"; c.shadowOffsetX = 0; c.shadowOffsetY = 0;
    c.font = "10px sans-serif"; c.textAlign = "start"; c.textBaseline = "alphabetic"; c.direction = "inherit";
    c.imageSmoothingEnabled = true;
    if ("imageSmoothingQuality" in c) c.imageSmoothingQuality = "low";
    if ("letterSpacing" in c) c.letterSpacing = "0px";
    if ("wordSpacing" in c) c.wordSpacing = "0px";
    if ("fontKerning" in c) c.fontKerning = "auto";
    if ("fontStretch" in c) c.fontStretch = "normal";
    if ("fontVariantCaps" in c) c.fontVariantCaps = "normal";
    if ("textRendering" in c) c.textRendering = "auto";
    return c;
  };
  /* KC.ctxFrom(g, ctx) (v0.6.7) — 화면 밖 판 g를 KC.ctxReset으로 처음 값으로 돌린 뒤 ctx의 '그리는 모양' 상태(채우기·선·글꼴·그림자)만 옮긴다.
     변환·globalAlpha·합성 방식·filter·가둠은 옮기지 않는다(부르는 쪽이 정함). 쓰는 쪽 콜백을 번짐 판에 한 번 그릴 때, 번짐 없이
     ctx에 바로 그릴 때와 같은 상태에서 시작하게(KCB6.smear·type.logo_lockup). 앞 프레임 상태는 ctx에서만 오므로 번짐 없는 그림과 같은 뜻. */
  const CTX_STYLE = ["fillStyle", "strokeStyle", "lineWidth", "lineCap", "lineJoin", "miterLimit", "lineDashOffset", "font", "textAlign", "textBaseline",
    "direction", "shadowBlur", "shadowColor", "shadowOffsetX", "shadowOffsetY", "imageSmoothingEnabled", "letterSpacing", "wordSpacing", "fontKerning", "fontStretch"];
  KC.ctxFrom = function (g, ctx) {
    KC.ctxReset(g);
    for (const k of CTX_STYLE) if (k in ctx && k in g) g[k] = ctx[k];
    if (ctx.getLineDash && g.setLineDash) g.setLineDash(ctx.getLineDash());
    return g;
  };

  /* ---------- float 번짐 판(v0.6.6) ----------
     번짐(움직임 흐림·회전 흐림)은 사본 여러 장의 평균이다. 8비트 캔버스에 'lighter' + globalAlpha 1/n으로 더하면 사본마다 채널 값이
     반올림되고 그 오차가 한쪽으로 쌓여 색이 바뀐다(1/64씩 64장: 101 → 128, 알파 0.07 초록은 0이 됨). n이 프레임마다 바뀌면 색이 흔들린다.
     그래서 사본은 float16 2D 캔버스(getContext('2d', {colorType: 'float16', willReadFrequently: true}) — 소프트웨어 그리기, WebGL 아님)에
     더하고, 화면 판에 그릴 때 한 번만 8비트로 내린다. 크롬 globalAlpha는 float16 판에서도 1/255 단위로 반올림되므로 무게는 k/255로 나눠
     합이 정확히 255/255가 되게 준다(평평한 곳 값 그대로). float16을 못 여는 브라우저면 보통 8비트 판(예전 그림과 같은 셈)으로 돈다.
     CPU Float32(getImageData 누적)도 보았다: 1920×1080 세로 정수 칸 상자 흐림만 해도 약 50ms(float16 판 2배 겹치기 약 60ms와 비슷)인데,
     소수 자리 사본(보간)·회전·임의 방향을 다시 짜야 하고 8비트로 읽는 순간 옅은 알파 색이 깎인다 → float16 판(drawImage 보간 그대로)을 골랐다.
       KC.floatSmear                   float16 판을 쓰는지(참/거짓)
       KC.fbuf(key, w, h)              다시 쓰는 float 판(key와 128px 크기 칸마다 하나, 쓴 칸을 지우고 그리기 상태 초기화해 돌려줌). ._ctx 붙음
       KC.avgN(g, n, draw)             g(float 판)에 draw(g, i)로 그린 사본 n장을 같은 무게로 더함('lighter', 무게 k/255 · 합 1)
       KC.halve(A, Bc, w, h, n, place) '자기와 한 칸 옮긴 자기의 평균'을 n번(사본 2^n장 같은 무게). place(g, i)가 둘째 사본의 변환을 정함.
                                       무게 128/255 + 127/255를 단계마다 바꿔 줘 앞뒤 기울기 없음. 마지막 판(A 또는 Bc)을 돌려줌
       KC.smearLine(ctx, img, iw, ih, x, y, dx, dy, alpha)  img 왼쪽 위 iw×ih를 (x, y)에 그리되 (dx,dy) 선분 위에 고르게 평균
                                       (가운데 기준 −½ ~ +½, 사본 간격 ≤ 화면 1px — R13). KCB3.smearDraw·KCB6.smearImage가 이 셈을 쓴다. */
  const F16 = (function () {
    try {
      const c = document.createElement("canvas"); c.width = 1; c.height = 1;
      const x = c.getContext("2d", { colorType: "float16", willReadFrequently: true });
      return !!(x && x.getContextAttributes && x.getContextAttributes().colorType === "float16");
    } catch (e) { return false; }
  })();
  KC.floatSmear = F16;
  function fcanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
    let x = null;
    if (F16) { try { x = c.getContext("2d", { colorType: "float16", willReadFrequently: true }); } catch (e) { x = null; } }
    c._ctx = x || c.getContext("2d", { willReadFrequently: true });
    return c;
  }
  KC.fcanvas = fcanvas;
  // 판은 크기 칸(128px 단위)마다 따로 둔다: 큰 판 하나를 키워 같이 쓰면 drawImage가 판 전체를 떠 와서(쓰기 시 복사) 작은 번짐도
  //   수 ms가 들고, 판 크기가 앞 프레임에 따라 달라져 가장자리 보간이 ±1~2 흔들렸다(ex-107). 칸 수는 최근 48개까지(그 밖은 버림 —
  //   다시 만들어도 지운 판이라 그림은 같다).
  const FB = new Map();
  KC.fbuf = function (key, w, h) {
    const W = Math.max(128, Math.ceil(w / 128) * 128), H = Math.max(128, Math.ceil(h / 128) * 128), id = key + "|" + W + "|" + H;
    let c = FB.get(id);
    if (c) FB.delete(id);
    else { c = fcanvas(W, H); if (FB.size >= 48) FB.delete(FB.keys().next().value); }
    FB.set(id, c);
    const x = c._ctx;
    if (c._sv) x.restore();   // 지난번 가둠(clip) 풀기
    x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = "source-over"; x.globalAlpha = 1; x.filter = "none";
    x.imageSmoothingEnabled = true;
    // 지난번에 쓴 칸과 이번 칸을 함께 지운다(앞서 더 크게 쓴 자국이 남으면 소수 자리 보간에 섞여 결정성이 깨짐). +2px = 보간이 읽는 가장자리.
    const iw = Math.ceil(w), ih = Math.ceil(h);
    const cw = Math.min(W, Math.max(c._uw || W, iw + 2)), ch = Math.min(H, Math.max(c._uh || H, ih + 2));
    x.clearRect(0, 0, cw, ch);
    c._uw = iw + 2; c._uh = ih + 2;
    // 이번 칸(w, h) 밖에는 아무것도 못 남기게 가둔다 — 판이 크기 칸만큼 넉넉해서, 가둠이 없으면 (w, h) 밖에 그린 것(예: 회전 번짐의 rad 밖
    //   그림)이 다음 번 지우기에서 빠져 앞 프레임에 따라 그림이 달라졌다(차례 그리기 ≠ 시크).
    x.save(); c._sv = true;
    x.beginPath(); x.rect(0, 0, iw, ih); x.clip();
    return c;
  };
  KC.avgN = function (g, n, draw) {
    n = Math.max(1, Math.min(255, Math.round(n)));
    const op = g.globalCompositeOperation, ga = g.globalAlpha;
    g.globalCompositeOperation = "lighter";
    for (let i = 0, c0 = 0; i < n; i++) {
      const c1 = Math.round(((i + 1) * 255) / n);
      g.globalAlpha = (c1 - c0) / 255; c0 = c1;
      g.save(); draw(g, i); g.restore();
    }
    g.globalCompositeOperation = op; g.globalAlpha = ga;
  };
  KC.halve = function (A, Bc, w, h, n, place) {
    for (let i = 0; i < n; i++) {
      const b = Bc._ctx;
      b.setTransform(1, 0, 0, 1, 0, 0); b.globalCompositeOperation = "source-over"; b.globalAlpha = 1; b.filter = "none";
      b.clearRect(0, 0, Math.min(Bc.width, w + 2), Math.min(Bc.height, h + 2));
      const hi = i & 1 ? 127 : 128;
      b.globalCompositeOperation = "lighter"; b.globalAlpha = hi / 255;
      b.drawImage(A, 0, 0, w, h, 0, 0, w, h);
      b.globalAlpha = (255 - hi) / 255;
      place(b, i);
      b.drawImage(A, 0, 0, w, h, 0, 0, w, h);
      b.setTransform(1, 0, 0, 1, 0, 0); b.globalCompositeOperation = "source-over"; b.globalAlpha = 1;
      const t = A; A = Bc; Bc = t;
    }
    return A;
  };
  KC.smearLine = function (ctx, img, iw, ih, x, y, dx, dy, alpha) {
    const ga = ctx.globalAlpha, al = alpha === undefined ? 1 : alpha;
    const m = ctx.getTransform();
    const Ld = Math.hypot(m.a * dx + m.c * dy, m.b * dx + m.d * dy);   // 화면 길이(px)
    if (Ld < 0.75) { ctx.globalAlpha = ga * al; ctx.drawImage(img, 0, 0, iw, ih, x, y, iw, ih); ctx.globalAlpha = ga; return; }
    const n = Math.min(12, Math.max(1, Math.ceil(Math.log2(Ld + 1)))), K = Math.pow(2, n);   // 사본 2^n장, 간격 ≤ 1px
    const ox = 1 + Math.ceil(Math.max(0, -dx)), oy = 1 + Math.ceil(Math.max(0, -dy));
    const w2 = iw + Math.ceil(Math.abs(dx)) + 3, h2 = ih + Math.ceil(Math.abs(dy)) + 3;
    const A = KC.fbuf("line0", w2, h2), Bc = KC.fbuf("line1", w2, h2);
    A._ctx.drawImage(img, 0, 0, iw, ih, ox, oy, iw, ih);
    const R = KC.halve(A, Bc, w2, h2, n, (b, i) => { const s = Math.pow(2, i) / (K - 1); b.translate(dx * s, dy * s); });
    ctx.globalAlpha = ga * al;
    ctx.drawImage(R, 0, 0, w2, h2, x - ox - dx / 2, y - oy - dy / 2, w2, h2);
    ctx.globalAlpha = ga;
  };
  /* KC.smearFn(ctx, box, dx, dy, alpha, draw, key) (v0.6.7) — draw(g)로 그리는 것을 (dx,dy) 선분 위에 고르게 평균(KC.smearLine 셈 그대로).
     사본을 차례로 덮어 그리던 번짐(알파 1−(1−a)^(1/K)로 K장)은 덮임이 겹친 수에 비례하지 않아 꼬리까지 진하고(돌출 그림자처럼 보임)
     나중에 그린 앞쪽 사본이 위에 오고, 사본마다 8비트로 반올림됐다. 여기서는: 화면 밖 판에 draw를 한 번 그림(ctx의 지금 변환 그대로,
     화면 px) → 가운데 기준 같은 무게 평균(float16 판, 사본 간격 ≤ 화면 1px) → 결과를 ctx에 알파와 함께 한 번 그림(ctx의 filter·합성 방식·가둠 그대로).
       box: ctx의 지금 좌표로 draw가 그리는 범위 [x0, y0, x1, y1](넉넉히; null이면 캔버스 전체). 판은 화면 안 + 번짐 반 길이까지로 자름.
       dx, dy: 번짐 선분(ctx의 지금 좌표 단위 — 길이는 변환까지 넣은 화면 px로 셈). draw(g): g는 ctx와 같은 변환·그리기 모양(KC.ctxFrom).
       key: 판 이름(부르는 곳마다 다르게 — draw 안에서 다른 smearFn을 부르면 key가 달라야 함). */
  KC.smearFn = function (ctx, box, dx, dy, alpha, draw, key) {
    const m = ctx.getTransform(), cv = ctx.canvas;
    const Dx = m.a * dx + m.c * dy, Dy = m.b * dx + m.d * dy;
    let X0 = 0, Y0 = 0, X1 = cv.width, Y1 = cv.height;
    if (box) {
      X0 = Infinity; Y0 = Infinity; X1 = -Infinity; Y1 = -Infinity;
      for (const [u, v] of [[box[0], box[1]], [box[2], box[1]], [box[0], box[3]], [box[2], box[3]]]) {
        const px = m.a * u + m.c * v + m.e, py = m.b * u + m.d * v + m.f;
        X0 = Math.min(X0, px); X1 = Math.max(X1, px); Y0 = Math.min(Y0, py); Y1 = Math.max(Y1, py);
      }
    }
    const hx = Math.abs(Dx) / 2 + 2, hy = Math.abs(Dy) / 2 + 2;   // 화면 밖이라도 번짐이 화면에 닿는 몫까지
    X0 = Math.floor(Math.max(X0, -hx)) - 1; Y0 = Math.floor(Math.max(Y0, -hy)) - 1;
    X1 = Math.ceil(Math.min(X1, cv.width + hx)) + 1; Y1 = Math.ceil(Math.min(Y1, cv.height + hy)) + 1;
    if (!(X1 > X0 && Y1 > Y0)) return;
    const w = X1 - X0, h = Y1 - Y0;
    const S = KC.fbuf(key || "smearfn", w, h), g = S._ctx;
    KC.ctxFrom(g, ctx);
    g.setTransform(m.a, m.b, m.c, m.d, m.e - X0, m.f - Y0);
    draw(g);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    KC.smearLine(ctx, S, w, h, X0, Y0, Dx, Dy, alpha);
    ctx.restore();
  };

  /* KC.smearMax(px) (v0.6.7) — 글자가 실린 그림·층의 번짐 길이 상한(그림 px) = 글자 높이(0.8em) × 0.25 = 0.2 × px.
     px = 그 그림·층에서 가장 작은 글자 px(그림 px). 글자보다 길게 번지면 번짐 방향 획(세로 번짐이면 가로획)이 옅어져 가로지르는 획만
     줄무늬('바코드')로 남는다 — float 판에서도 같은 상자 흐림의 성질(components/tools/v067_barcode/README.md). 부르는 쪽이
     KCB6.smearImage·KCB3.smearDraw의 opt.max로 넘긴다(도우미 기본은 max 없음 그대로). 화면 크기 전환(transition.whip_slide 등)은 예외.
     px가 없거나 0이면 0(= 상한 없음). */
  KC.smearMax = function (px) { return px > 0 ? 0.2 * px : 0; };

  /* ---------- 금지 검사(개발 모드) ---------- */
  const BANNED = [];
  function ban(obj, key, label) { BANNED.push([obj, key, label]); }
  ban(Math, "random", "Math.random");
  ban(Date, "now", "Date.now");
  if (window.performance) ban(window.performance, "now", "performance.now");
  ban(window, "setTimeout", "setTimeout");
  ban(window, "setInterval", "setInterval");
  ban(window, "requestAnimationFrame", "requestAnimationFrame");
  ban(window, "fetch", "fetch");
  ban(window, "XMLHttpRequest", "XMLHttpRequest");
  KC.violations = [];
  function guarded(id, what, fn) {
    if (!KC.dev) return fn();
    const saved = BANNED.map(([o, k]) => o[k]);
    const D = window.Date;
    BANNED.forEach(([o, k, label]) => { o[k] = function () { throw new Error(`KC 금지 호출: ${label} (부품 ${id}.${what})`); }; });
    const FakeDate = function () { throw new Error(`KC 금지 호출: new Date() (부품 ${id}.${what})`); };
    FakeDate.now = Date.now; // 이미 던지는 함수
    window.Date = FakeDate;
    try { return fn(); }
    catch (e) { KC.violations.push(String(e && e.message || e)); throw e; }
    finally { window.Date = D; BANNED.forEach(([o, k], i) => { o[k] = saved[i]; }); }
  }
  KC._guarded = guarded;

  /* ---------- dom 부품 도우미(lib/b5_ui.js B5.normalize·prime·vis와 같은 것) ----------
     KC.normalize(root)  mount 끝에: style 글을 브라우저 꼴로 다시 씀
     KC.prime(els)       mount 끝(normalize 전)에: render가 바꿀 transform·opacity·filter·visibility를 미리 넣어 둠
     KC.vis(el, on)      보임 "inherit" | 숨김 "hidden"(""·"visible" 대신 — 부모를 따르고 style 글 순서가 안 바뀜)
     자가 시험 지문(toHF)은 이제 style을 '속성 이름순 + 기본값 빼기'로 정규화해서 대므로, 이 셋을 안 써도 순서·꼴 차이로
     거짓 실패하지는 않는다. 그래도 화소 쪽(크롬 그리기 방식)에는 prime이 도움이 된다(opacity는 0.999 이하로 시작). */
  KC.normalize = function (root) {
    [root].concat(Array.from(root.querySelectorAll("[style]"))).forEach((e) => { if (e.getAttribute("style")) e.style.cssText = e.style.cssText; });
  };
  KC.prime = function (els) {
    els.forEach((e) => {
      if (!e) return;
      if (!e.style.transform) e.style.transform = "none";
      if (!e.style.opacity) e.style.opacity = "1";
      if (!e.style.filter) e.style.filter = "none";
      if (!e.style.visibility) e.style.visibility = "inherit";
    });
  };
  KC.vis = (el, on) => { el.style.visibility = on ? "inherit" : "hidden"; };
  // 지문용 style 글: 속성 이름순, 기본값과 같은 것(transform none·opacity 1·filter none·visibility inherit, 빈 값)은 뺌
  const STYLE_DEFAULT = { transform: "none", opacity: "1", filter: "none", visibility: "inherit", "will-change": "auto" };
  KC.styleKey = function (e) {
    const st = e.style;
    if (!st || !st.length) return "";
    const out = [];
    for (let i = 0; i < st.length; i++) {
      const n = st[i], v = st.getPropertyValue(n).trim(), p = st.getPropertyPriority(n);
      if (v === "" || STYLE_DEFAULT[n] === v) continue;
      out.push(n + ":" + v + (p ? "!" + p : ""));
    }
    return out.sort().join(";");
  };

  /* ---------- 등록·만들기 ---------- */
  const RENDERERS = ["canvas2d", "dom", "webgl"];
  KC.def = function (id, spec) {
    if (!/^[a-z0-9]+\.[a-z0-9_]+$/.test(id)) throw new Error("KC.def: id는 '분류.이름'(소문자·숫자·_) — " + id);
    if (!spec || RENDERERS.indexOf(spec.renderer) < 0) throw new Error("KC.def: renderer는 canvas2d|dom|webgl — " + id);
    if (typeof spec.create !== "function") throw new Error("KC.def: create(opts, env) 필요 — " + id);
    if (KC.parts[id]) throw new Error("KC.def: 이미 등록됨 — " + id);
    KC.parts[id] = Object.assign({ id, defaults: {} }, spec);
    return KC.parts[id];
  };

  /* 기본값 깊은 합치기(lib/b13_three.js KC3.fill과 같은 뜻): 기본값이 보통 객체({...})인 칸에 opts도 보통 객체를
     주면 한 단계 아래까지 합친다 — {camera: {z: 900}}만 줘도 camera의 다른 칸은 기본값이 남는다. 배열·요소·함수는 통째로 바꾼다.
     곡선 칸({fn, ...})은 합치지 않는다(다른 fn의 args·fps·hold가 섞이면 뜻이 바뀜). 이미 합친 값(같은 객체)은 그대로. */
  const isPlain = (v) => !!v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;
  KC.fill = function (o, defaults, opts) {
    if (!defaults || !opts) return o;
    for (const k of Object.keys(opts)) {
      const d = defaults[k], v = opts[k];
      if (isPlain(d) && isPlain(v) && v !== d && !("fn" in d) && !("fn" in v)) o[k] = Object.assign({}, d, v);
    }
    return o;
  };

  /* KC.make(id, opts, env) → 인스턴스
     opts: 부품 defaults 위에 덮어씀(보통 객체 칸은 한 단계 아래까지 합침 — KC.fill). 모든 부품 공통 칸: f0(시작 프레임, 기본 0), f1(보이는 끝 프레임, 기본 부품이 정함), scale(1), z(toHF 순서, 0)
     env:  {fps, width, height} — 엔진 fps를 꼭 넘긴다(기본 30000/1001, 1920×1080)
     인스턴스: {id, renderer, opts, env, span() → [f0, f1], draw(ctx,f) | mount(el)·render(f), bounds(f), events()} */
  KC.make = function (id, opts, env) {
    const P = KC.parts[id];
    if (!P) throw new Error("KC.make: 등록 안 된 부품 " + id + " — 부품 .js를 kc.js 뒤에 읽었나?");
    env = Object.assign({}, DEFAULT_ENV, env || {});
    if (typeof env.fps === "string") { const q = env.fps.split("/"); env.fps = +q[0] / (+q[1] || 1); }
    const o = Object.assign({ f0: 0, scale: 1, z: 0 }, P.defaults, opts || {});
    KC.fill(o, P.defaults, opts);
    const raw = guarded(id, "create", () => P.create(o, env));
    const inst = { id, renderer: P.renderer, opts: o, env, _raw: raw };
    const wrap = (name) => (raw[name] ? function () { const a = arguments; return guarded(id, name, () => raw[name].apply(raw, a)); } : null);
    if (P.renderer === "canvas2d") {
      if (!raw.draw) throw new Error(id + ": canvas2d 부품은 draw(ctx, f) 필요");
      const d = wrap("draw");
      inst.draw = function (ctx, f) { ctx.save(); try { d(ctx, f); } finally { ctx.restore(); } };
    } else {
      if (!raw.mount || !raw.render) throw new Error(id + ": " + P.renderer + " 부품은 mount(el)·render(f) 필요");
      inst.mount = wrap("mount");
      inst.render = wrap("render");
    }
    inst.bounds = raw.bounds ? wrap("bounds") : () => null;
    inst.events = raw.events ? () => raw.events().map((e) => Object.assign({ id }, e)) : () => [];
    inst.span = function () {
      const s = raw.span ? raw.span() : [o.f0, Infinity];
      return [o.f0 !== undefined ? Math.min(s[0], o.f0) : s[0], o.f1 !== undefined ? o.f1 : s[1]];
    };
    // create가 돌려준 객체의 다른 칸(README '출력'에 적힌 nEnd·state(f)·rowY(i)·tileC(j)·index(f)·ownBlur 등)도 인스턴스에서 보이게.
    //   함수는 개발 모드 금지 검사로 감싸고(draw와 같음), 값은 늘 원본 칸을 읽는다(나중에 바뀌어도 같음).
    for (const k of Object.keys(raw)) {
      if (k in inst) continue;
      if (typeof raw[k] === "function") inst[k] = wrap(k);
      else Object.defineProperty(inst, k, { enumerable: true, configurable: true, get: () => raw[k], set: (v) => { raw[k] = v; } });
    }
    return inst;
  };

  // 여러 인스턴스의 사건을 프레임 순서로(효과음 맞추기용) — 영상 전체 first·signature는 KC.retier로 고른다
  KC.events = (list) => list.flatMap((c) => c.events()).sort((a, b) => a.f - b.f);

  /* ---------- KC.evAt(P, N) — 머리 주석 ③ ----------
     사건 프레임(부품 events()): 곡선 P(n)(시작부터 n프레임, 0→1, 길이 N)을 한 번 훑는다(비평 도구 --sync의 솟음·착지와 같은 셈).
       화면 프레임 차는 속도에 비례하지 않고 눌려 보여(느린 움직임도 크게 보임) 속도를 q = (속도/최고)^0.4로 눌러 잰다(렌더 대조로 정함).
       ramp = 속도가 최고의 2/3에 처음 닿는 프레임(화면 '솟음' — 처음부터 빠르면 1). 단 봉우리가 앞쪽(길이의 40% 안)이고 긴 감속 꼬리가
              있는 곡선은 q가 2/3(속도 36%)에 닿는 프레임 — 그런 곡선은 화면에서 더 일찍 솟아 보임
       land = 속도 봉우리 뒤 처음 '급감'(다음 프레임 q < 앞 두 프레임 평균의 절반, 그 평균 ≥ 0.2)하기 직전 프레임
              — 넘치는 스프링은 되돌아서는(멈칫) 프레임, 감속 끝에 서는 곡선은 거의 멈추는 프레임, 끝까지 빠르면 N.
              급감이 없으면(아주 길게 섬) 눈에 띄게 움직이는 구간(q ≥ 1/3)이 끝나는 프레임
     예) const e = KC.evAt(KC.curve(o.curve, N, env), N);  → 사건 {onset: f0 + e.ramp, land: f0 + e.land} */
  KC.evAt = (P, N) => {
    const M = Math.max(1, Math.ceil(N)), v = [0];
    let pr = P(0), vm = 0, nm = 1;
    for (let n = 1; n <= M + 1; n++) { const p = P(n); v[n] = Math.abs(p - pr); pr = p; if (n <= M && v[n] > vm) { vm = v[n]; nm = n; } }
    const q = v.map((x) => Math.pow(x / (vm || 1), 0.4)), th = nm <= 0.4 * M ? 0.363 : 2 / 3;
    let ramp = nm;
    for (let n = 1; n <= nm; n++) if (v[n] >= vm * th) { ramp = n; break; }
    for (let i = nm; i <= M; i++) {
      const m = (q[i - 1] + q[i]) / 2;
      if (m >= 0.2 && q[i + 1] < 0.5 * m) return { ramp, land: i === M ? N : i };
    }
    let land = nm;
    while (land < M && q[land + 1] >= 1 / 3) land++;
    return { ramp, land: land >= M ? N : land };
  };

  /* ---------- KC.retier(events, {first, signature}) — 머리 주석 ② ----------
     예) KC.retier(KC.events([a, b, c]))                                  // hint가 붙은 가장 이른 사건으로
         KC.retier(evs, {first: "chip_land", signature: (e) => e.id === "logo" && e.type === "pop"})
         KC.retier(evs, {first: 0, signature: 7})                          // 이 배열의 번호 */
  KC.retier = function (events, o) {
    o = o || {};
    const src = events || [];
    const list = src.map((e) => Object.assign({}, e));
    const hintOf = (e) => (e && (e.hint || (e.tier === "first" || e.tier === "signature" ? e.tier : null))) || null;
    const earliest = (idx) => (idx.length ? idx.reduce((a, b) => (list[b].f < list[a].f ? b : a)) : -1);
    function pick(sel, name) {
      if (sel === undefined || sel === null) {
        const i = earliest(src.map((e, k) => (hintOf(e) === name ? k : -1)).filter((k) => k >= 0));
        if (i < 0 && src.length) console.warn(`KC.retier: ${name} 후보(hint "${name}")가 없음 — {${name}: type 이름 | 번호 | 함수}로 고르기`);
        return i;
      }
      let cand;
      if (typeof sel === "number") {
        if (!(Number.isInteger(sel) && sel >= 0 && sel < list.length)) throw new Error(`KC.retier: ${name} 번호 ${sel} — 0~${list.length - 1}`);
        return sel;
      } else if (typeof sel === "string") cand = src.map((e, k) => (e.type === sel ? k : -1)).filter((k) => k >= 0);
      else if (typeof sel === "function") cand = src.map((e, k) => (sel(e, k, src) ? k : -1)).filter((k) => k >= 0);
      else throw new Error(`KC.retier: ${name}는 사건 type 이름 | 번호 | 고르는 함수`);
      if (!cand.length) throw new Error(`KC.retier: ${name}로 고를 사건이 없음(${typeof sel === "string" ? "type " + sel : "함수"})`);
      return earliest(cand);
    }
    const fi = pick(o.first, "first"), si = pick(o.signature, "signature");
    if (fi >= 0 && fi === si) throw new Error(`KC.retier: first와 signature가 같은 사건(#${fi} ${list[fi].type}) — 다른 사건을 고르기`);
    list.forEach((e, k) => {
      if (k === fi) e.tier = "first";
      else if (k === si) e.tier = "signature";
      else if (e.tier === "first" || e.tier === "signature" || (hintOf(src[k]) && e.tier !== "detail")) e.tier = "normal";
    });
    return list;
  };

  /* ---------- 엔진 어댑터 공통: 크롬 예열·그리기 오류 띠(머리 주석 ①) — toHF는 따로 ---------- */
  let WARM1 = null;
  const warmCanvas = () => { if (!WARM1) { WARM1 = document.createElement("canvas"); WARM1.width = WARM1.height = 1; } return WARM1; };
  function drawErrorOf(where, inst, f, e) {
    const msg = `그리기 오류 f=${f}: ${inst.id} ${String((e && e.message) || e).slice(0, 120)}`;
    if (!window.KC_DRAW_ERROR) { window.KC_DRAW_ERROR = msg; console.error("KC." + where, e); }
    return msg;
  }
  function redBand(ctx, W, msg) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over"; ctx.filter = "none";
    ctx.fillStyle = "#ff0000"; ctx.fillRect(0, 0, W, 90);
    ctx.fillStyle = "#fff"; ctx.font = "bold 40px sans-serif"; ctx.fillText("KC " + msg, 20, 60);
    ctx.restore();
  }
  const inSpan = (inst, f) => { const s = inst.span(); return f > s[0] - 1e-3 && f < s[1] + 1 - 1e-3; };
  KC.inSpan = inSpan;

  /* ---------- 어댑터: km 엔진 (KM.add) ----------
     KC.toKM(inst, {id, f0, f1}) — 장면 하나로 등록. f0·f1을 안 주면 inst.span()(끝이 없으면 1e9).
     canvas2d: 장면 요소 안에 env 크기 캔버스를 만들어 매 프레임 지우고 draw. dom/webgl: 장면 요소에 mount, render(f).
     f는 KM의 컴포지션 프레임 그대로 넘긴다(부품 opts.f0도 같은 프레임 축). KM.mount 전에 부른다. */
  KC.toKM = function (inst, o) {
    if (!window.KM || !KM.add) throw new Error("KC.toKM: km 엔진(KM) 없음 — engine/core.js를 먼저 읽기");
    o = o || {};
    const s = inst.span();
    const f0 = o.f0 !== undefined ? o.f0 : s[0], f1 = o.f1 !== undefined ? o.f1 : (isFinite(s[1]) ? s[1] : 1e9);
    const warm = o.warm !== false;
    let cv = null, ctx = null, host = null, errCv = null, err = null;
    function band(msg) {   // canvas2d는 부품 캔버스에, dom·webgl은 장면 요소 위 겹친 캔버스에
      let c = ctx;
      if (!c) {
        if (!errCv) {
          errCv = document.createElement("canvas"); errCv.width = inst.env.width; errCv.height = inst.env.height;
          errCv.setAttribute("style", `position:absolute;left:0;top:0;width:${inst.env.width}px;height:${inst.env.height}px;z-index:99999;pointer-events:none`);
          (host || document.body).appendChild(errCv);
        }
        c = errCv.getContext("2d");
      }
      redBand(c, inst.env.width, msg);
    }
    return KM.add({
      id: o.id || inst.id.replace(/\W/g, "_"), f0, f1,
      build(el) {
        host = el;
        if (inst.renderer === "canvas2d") {
          cv = document.createElement("canvas");
          cv.width = inst.env.width; cv.height = inst.env.height;
          cv.setAttribute("style", `position:absolute;left:0;top:0;width:${inst.env.width}px;height:${inst.env.height}px`);
          el.appendChild(cv);
          ctx = cv.getContext("2d");
        } else inst.mount(el);
      },
      render(f) {
        // KM은 f = t × fps를 반올림하지 않고 넘겨서 렌더 프레임 239가 238.99999로 들어올 수 있다(floor 계단이 한 프레임 밀림).
        //   toHF·KX.render와 같이 1/1000로 반올림(정수에 1/2000 안으로 가까우면 정수). 부품은 1/1000보다 고운 프레임을 쓰지 않는다.
        f = Math.round(f * 1000) / 1000;
        try {
          if (inst.renderer === "canvas2d") {
            ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
            if (warm) ctx.drawImage(warmCanvas(), 0, 0);   // 크롬 예열(toHF와 같음)
            inst.draw(ctx, f);
          } else inst.render(f);
        } catch (e) { if (!err) err = drawErrorOf("toKM", inst, f, e); }
        if (err) band(err);
      },
    });
  };

  /* ---------- 어댑터: kx 엔진 (KX.layer) ----------
     KC.toKX(inst, z, {warm, mb, speed}) — canvas2d: KX.layer(z, (ctx, F) => draw). KX의 서브프레임 모션 블러·화면 부드럽게(blur)를 같이 받는다.
     dom/webgl: KX 캔버스는 하나라 그 안에 못 넣는다 → 캔버스 부모에 겹친 요소로 mount(z < 0이면 캔버스 아래, 아니면 위),
     KX.render(F)가 끝날 때 render(F)를 부른다(모션 블러·화면 blur는 안 받음). KX.init 뒤에 부른다.
     번짐 겹침 막기(mb): 자기 번짐이 있는 부품(인스턴스 ownBlur = true — zoom_through 셔터, whip_slide, 칩·낱말 번짐 등, 목록은
       components/README.md)은 KX 서브프레임 표본마다 다른 시각으로 그리면 번짐이 두 번 들어간다(KX 표본이 도는 프레임 — 움직이는 글자 층이나
       속도 힌트가 있을 때). 그래서 mb "auto"(기본)는 ownBlur 부품을 표본마다 **그 프레임 시각 F로** 그린다 — 모든 표본이 같은 그림이라 KX 블러가
       걸리지 않고 부품 번짐만 남는다. mb "kx" = 표본 시각으로(부품 번짐을 끄고 KX에 맡길 때 — 그때는 speed로 빠르기를 알림),
       mb "own" = ownBlur가 없어도 프레임 시각으로.
     speed: (F) => px/프레임 | 숫자 — 이 층의 가장 빠른 움직임. KX.speedHints에 더해져 KX가 표본 수를 넉넉히 고른다(KX는 그리기 층의 빠르기를
       모름 — core.js '도형 층이 가장 빠르면 길을 모름 → 시각 가운데'). 직접 KX.speedHints를 쓰는 장면은 toKX보다 먼저 정한다(뒤에 정하면 덮어씀).
     프레임 번호: 정수에 1e-6 안으로 가까운 F는 정수로(서브프레임 시각 셈의 부동소수 찌꺼기 — floor 계단이 밀리지 않게). */
  const kxDom = [];
  let kxErr = null, kxBand = false, kxF = null;
  const kxHints = [];
  const snapF = (F) => { const r = Math.round(F); return Math.abs(F - r) < 1e-6 ? r : F; };
  function kxWrap() {   // KX.render를 한 번 감싼다: 지금 프레임 시각(kxF)을 알리고, 끝에 dom 부품 render + 오류 띠
    if (KX._kcWrapped) return;
    const orig = KX.render;
    KX.render = function (F) {
      const Fr = Math.round(F * 1000) / 1000;
      kxF = Fr;
      try { orig(F); } finally { kxF = null; }
      for (const d of kxDom) { try { d.render(Fr); } catch (e) { if (!kxErr) kxErr = drawErrorOf("toKX", d, Fr, e); } }
      if (kxErr && kxDom.length) { const c = document.getElementById("cv"); if (c && c.getContext) redBand(c.getContext("2d"), c.width, kxErr); }   // 같은 프레임에 띠
    };
    KX._kcWrapped = true;
  }
  function kxHint(fn) {
    kxHints.push(typeof fn === "function" ? fn : () => +fn || 0);
    if (KX._kcHints) return;
    const prev = KX.speedHints;
    KX.speedHints = (F) => { let m = prev ? +prev(F) || 0 : 0; for (const h of kxHints) m = Math.max(m, +h(F) || 0); return m; };
    KX._kcHints = true;
  }
  KC.toKX = function (inst, z, o) {
    if (!window.KX || !KX.layer) throw new Error("KC.toKX: kx 엔진(KX) 없음 — engine/core.js를 먼저 읽기");
    if (z && typeof z === "object") { o = z; z = o.z; }   // toKX(inst, {z, warm})도 됨
    o = o || {};
    z = z || 0;
    const warm = o.warm !== false;
    const mb = o.mb || "auto";
    if (mb !== "auto" && mb !== "kx" && mb !== "own") throw new Error("KC.toKX: mb는 auto|kx|own — " + mb);
    if (!kxBand) {   // 오류 띠: 장면 맨 위 층(서브프레임 표본마다 그려져 모션 블러 평균 뒤에도 남음). 오류 없으면 아무것도 안 그림
      kxBand = true;
      KX.layer(1e9, (ctx) => { if (kxErr) redBand(ctx, ctx.canvas.width, kxErr); });
    }
    kxWrap();
    if (o.speed !== undefined && o.speed !== null) kxHint(o.speed);
    if (inst.renderer === "canvas2d") {
      const ob = typeof inst.ownBlur === "function" ? inst.ownBlur() : inst.ownBlur;
      const atFrame = mb === "own" || (mb === "auto" && !!ob);
      inst.kxBlur = atFrame ? "own" : "kx";   // 어느 쪽 번짐을 받는지(확인용)
      KX.layer(z, (ctx, F) => {
        if (warm) ctx.drawImage(warmCanvas(), 0, 0);   // 크롬 예열(층이 그려질 때마다, 부품이 범위 밖이어도)
        const Fd = snapF(atFrame && kxF !== null ? kxF : F);
        if (!inSpan(inst, Fd)) return;
        try { inst.draw(ctx, Fd); } catch (e) { if (!kxErr) kxErr = drawErrorOf("toKX", inst, Fd, e); }
      });
      return inst;
    }
    const cv = document.getElementById("cv");
    const host = (cv && cv.parentNode) || document.body;
    const el = document.createElement("div");
    el.className = "kc-kx-dom";
    el.setAttribute("style", `position:absolute;left:0;top:0;width:${inst.env.width}px;height:${inst.env.height}px;pointer-events:none;overflow:hidden`);
    if (z < 0 && cv) host.insertBefore(el, cv); else host.appendChild(el);
    inst.mount(el);
    kxDom.push(inst);
    return inst;
  };

  /* ---------- 어댑터: 엔진 없이 HyperFrames (드라이버 트윈 하나) ----------
     KC.toHF(list, rootEl, {id: "main", duration: 초, fps, bg: "#..."|null, under(ctx, f), over(ctx, f)})
       - list: 인스턴스 배열(하나도 됨). opts.z(작은 것 먼저) → 같은 z면 넣은 순서로 그린다.
       - canvas2d 부품은 rootEl 안 캔버스 하나에 모아 그림(층 순서 = z). dom/webgl 부품은 각자 겹친 요소에 mount.
         dom 요소의 z-index = 부품 z, 캔버스의 z-index = 0 → 캔버스 아래에 둘 dom 부품은 z < 0.
       - under(ctx, f): 캔버스 맨 밑(바탕 결 KMTex 등), over(ctx, f): 맨 위.
       - window.__timelines[id] = 멈춘 GSAP 타임라인(트윈 하나, onUpdate → render(t)). f = round(t × fps, 1/1000).
         HyperFrames lint는 index.html 글에서 'window.__timelines' 등록 줄을 찾는다 → 데모에도
         window.__timelines["main"] = hf.timeline; 한 줄을 꼭 쓴다(kc.js 안 등록만으로는 lint 오류).
       - 돌려줌: {render(f), timeline, events(), canvas}
     window.KC_SELFTEST = 1이면 프레임마다 '그 프레임 → 다른 프레임 → 다시 그 프레임'을 그려 화소(캔버스)·스타일(dom) 지문이
     같은지 보고, 다르면 화면 위에 빨간 띠를 그린다(regress.py가 찾아냄). */
  KC.toHF = function (list, root, o) {
    if (!window.gsap) throw new Error("KC.toHF: gsap 없음");
    list = Array.isArray(list) ? list : [list];
    o = Object.assign({ id: "main" }, o || {});
    const env = (list[0] && list[0].env) || DEFAULT_ENV;
    const fps = o.fps ? (typeof o.fps === "string" ? +o.fps.split("/")[0] / (+o.fps.split("/")[1] || 1) : o.fps) : env.fps;
    const W = env.width, H = env.height;
    const order = list.map((c, i) => [c, i]).sort((a, b) => (a[0].opts.z || 0) - (b[0].opts.z || 0) || a[1] - b[1]).map((x) => x[0]);
    // 캔버스는 canvas2d 부품이나 bg·under·over가 있을 때만 화면에 붙인다(빈 캔버스도 check가 '불투명 요소'로 봄).
    // 자가 시험의 빨간 띠도 이 캔버스에 그리므로, 안 붙였으면 실패할 때만 붙인다.
    const needCanvas = order.some((c) => c.renderer === "canvas2d") || !!(o.bg || o.under || o.over);
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    cv.className = "kc-canvas";
    cv.setAttribute("style", `position:absolute;left:0;top:0;width:${W}px;height:${H}px;z-index:0`);
    if (needCanvas) root.appendChild(cv);
    // 시험 페이지(자가 시험·차례 그리기)는 화면 캔버스를 처음부터 소프트웨어(willReadFrequently)로 — 지문을 읽다(getImageData) 크롬이
    //   중간에 GPU → CPU로 바꾸면 그 순간 프레임만 어긋나 자가 시험이 가끔 실패한다(하드웨어 GPU에서).
    //   첫 지문 뒤로는 어차피 CPU로 그리므로 골든 화소는 같다. 시험이 아닌 렌더는 GPU 캔버스.
    const ctx = cv.getContext("2d", window.KC_SELFTEST || window.KC_SEQ ? { willReadFrequently: true } : undefined);
    const doms = [];
    for (const c of order) {
      if (c.renderer === "canvas2d") continue;
      const el = document.createElement("div");
      el.className = "kc-dom kc-" + c.id.replace(/\W/g, "_");
      el.setAttribute("style", `position:absolute;left:0;top:0;width:${W}px;height:${H}px;overflow:hidden;pointer-events:none;z-index:${c.opts.z || 0}`);
      root.appendChild(el);
      c.mount(el);
      doms.push([c, el]);
    }
    // 크롬 예열: 화면 캔버스에 처음 canvas를 drawImage하는 순간 그리기 방식이 한 번 바뀐다(그 프레임 앞뒤로
    // 화소가 ±1 달라져 자가 시험이 어긋남). 매 paint 첫 줄에 1×1 빈 캔버스를 그려 첫 프레임부터 같은 방식으로 고정. o.warm = false로 끔.
    const WARM = document.createElement("canvas"); WARM.width = WARM.height = 1;
    function paintRaw(f) {
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over"; ctx.filter = "none";
      ctx.clearRect(0, 0, W, H);
      if (o.warm !== false) ctx.drawImage(WARM, 0, 0);
      if (o.bg) { ctx.fillStyle = o.bg; ctx.fillRect(0, 0, W, H); }
      if (o.under) { ctx.save(); o.under(ctx, f); ctx.restore(); }
      for (const c of order) if (c.renderer === "canvas2d" && inSpan(c, f)) c.draw(ctx, f);
      if (o.over) { ctx.save(); o.over(ctx, f); ctx.restore(); }
      for (const [c] of doms) c.render(f);
    }
    // 그리는 도중 오류(부품·under·over): 조용히 반쯤 그린 프레임이 되지 않게 빨간 띠로 드러낸다(regress.py가 찾아 실패).
    let drawErr = null;
    function paint(f) {
      try { paintRaw(f); }
      catch (e) {
        try { ctx.restore(); } catch (e2) { /* save 짝이 안 맞아도 띠는 그린다 */ }
        if (!drawErr) { drawErr = `그리기 오류 f=${f}: ${String(e && e.message || e).slice(0, 120)}`; console.error("KC.toHF", e); }
        window.KC_DRAW_ERROR = drawErr;
      }
    }
    function banner(msg) {
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over"; ctx.filter = "none";
      ctx.fillStyle = "#ff0000"; ctx.fillRect(0, 0, W, 90);
      ctx.fillStyle = "#fff"; ctx.font = "bold 40px sans-serif"; ctx.fillText("KC " + msg, 20, 60);
      cv.style.zIndex = "99999";
      if (!cv.parentNode) root.appendChild(cv);
    }
    // 자가 시험(시크 안전·결정성): 지문 = 캔버스 화소 표본 + dom 스타일 문자열
    function fingerprint() {
      let h = 2166136261 >>> 0;
      const d = ctx.getImageData(0, 0, W, H).data;
      for (let i = 0; i < d.length; i += 4 * 7) { h ^= d[i] | (d[i + 1] << 8) | (d[i + 2] << 16) | (d[i + 3] << 24); h = Math.imul(h, 16777619) >>> 0; }
      for (const [, el] of doms) {
        const all = el.querySelectorAll("*");
        // style은 정규화해서 댄다(속성 순서·꼴·기본값 있고 없음으로 거짓 실패하지 않게 — KC.styleKey)
        let s = KC.styleKey(el);
        for (const e of all) s += "|" + KC.styleKey(e) + (e.tagName === "CANVAS" ? e.width : "");
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
      }
      return h;
    }
    let bad = null;
    // 차례 그리기 시험(window.KC_SEQ, regress.py의 'seq' 회차): 렌더(hyperframes render)처럼 앞 프레임을 차례로 그린 뒤 f를 그린다.
    //   "all"(또는 true) = 이 페이지에서 마지막으로 그린 정수 프레임 다음(처음이면 0)부터 f 앞까지 빠짐없이, 숫자 k = 그중 f 앞 k프레임만.
    //   시크(자가 시험)는 프레임을 건너뛰며 그려서, 바로 앞 프레임이 남긴 상태(화면 밖 캔버스의 fillStyle, 처음 크기로 굳은 캐시 등)에 기대는
    //   버그를 못 본다(가둠 콜백에 샌 그리기 상태·처음 크기로 굳은 화면 크기 층 — 렌더에서만 그림이 사라짐). regress가 이 그림을 시크 그림과 화소로 댄다.
    let seqLast = -1;
    function seqPaint(f) {
      const k = window.KC_SEQ === true || window.KC_SEQ === "all" ? Infinity : +window.KC_SEQ;
      let g = seqLast + 1;
      if (f < g - 1e-6) g = Math.ceil(f - 1e-6);   // 뒤로 가면(드묾) 차례 없이 그 프레임만
      if (isFinite(k)) g = Math.max(g, Math.ceil(f - k - 1e-6));
      for (g = Math.max(0, g); g < f - 1e-6; g++) paint(g);
      paint(f);
      if (Math.abs(f - Math.round(f)) < 1e-6) seqLast = Math.round(f);
    }
    function render(f) {
      f = Math.round(f * 1000) / 1000;
      if (window.KC_SELFTEST) {
        paint(f); const a = fingerprint();
        paint(f + 17.5); paint(Math.max(0, f - 9.25)); paint(f); const b = fingerprint();
        paint(f); const c = fingerprint();
        if (a !== b || b !== c) bad = `시크/결정성 어긋남 f=${f}`;
        if (KC.violations.length) bad = KC.violations[0];
        if (bad) { banner("SELFTEST FAIL: " + bad); window.KC_SELFTEST_FAIL = bad; }
      } else if (window.KC_SEQ) {
        seqPaint(f);
        // 자가 시험 쪽(시크 그림)과 같은 그리기 방식으로: 크롬은 화면 캔버스를 읽으면(getImageData) GPU → CPU 그리기로 바꾼다.
        //   시크 회차는 지문을 읽어 CPU로 그리므로, 차례 회차도 같은 읽기를 해야 가는 선·호의 가장자리 반올림(GPU ↔ CPU 차 최대 40)이 차례 차로 잡히지 않는다
        fingerprint();
        if (KC.violations.length) { banner("SELFTEST FAIL: " + KC.violations[0]); window.KC_SELFTEST_FAIL = KC.violations[0]; }
      } else paint(f);
      if (drawErr) banner(drawErr);
    }
    const tl = gsap.timeline({ paused: true });
    const drv = { t: 0 };
    const dur = o.duration;
    if (!(dur > 0)) throw new Error("KC.toHF: duration(초) 필요");
    tl.to(drv, { t: dur, duration: dur, ease: "none", onUpdate: () => render(drv.t * fps) });
    window.__timelines = window.__timelines || {};
    window.__timelines[o.id] = tl;
    render(0);
    return { render, timeline: tl, canvas: cv, events: () => KC.events(list) };
  };

  window.KC = KC;
})();
