/* KCB6 — 데이터 카드(달력·차트·대시보드) 부품이 같이 쓰는 도우미. kc.js·typography/mixed_text.js 뒤에 읽는다.
 *
 *   KCB6.rrect(ctx, x0, y0, x1, y1, r)            둥근 사각 경로(beginPath 포함)
 *   KCB6.text(ctx, str, role, x, y, size, color, opt) KTypo 역할로 한 줄 그리기. opt: {align, alpha, tabular, tracking} → 폭
 *   KCB6.width(str, role, size, opt)              글 폭(측정 ctx)
 *   KCB6.smear(ctx, dx, dy, alpha, fn, box)       한 방향 움직임 흐림: fn(g)를 한 번 그려 (dx,dy) 선분 위 같은 무게 평균(v0.6.7 KC.smearFn, 알파 = alpha). 결정적
 *   KCB6.smearImage(ctx, img, x, y, dx, dy, alpha, opt) 미리 그린 그림(캔버스)을 (dx,dy) 선분 위에 고르게 평균(가운데 기준) — v0.6: 사본 간격
 *                                                 ≤ 화면 1px(계단·결 없음), 같은 무게 평균(덮어 그리기 아님), 길이 ≤ 짧은 변 50%(opt.cap·opt.short, R13)
 *                                                 v0.6.6: float16 판 누적(KC.smearLine), opt.max = 길이 상한 px(글자 그림은 가장 작은 글자 높이 × 0.25 권장)
 *   KCB6.sprite(w, h)                             화면 밖 캔버스 하나(create에서 만들어 매 프레임 지우고 다시 그림)
 *   KCB6.warp(ctx, src, sx, sy, sw, sh, map)      가로줄 띠로 원근 그리기: map(y_src) → [y_dst, x_center_dst, scale] (가로축 회전 + 원근은 가로줄이 가로줄로 감)
 *   KCB6.niceMax(v, n)                            축 위 끝을 보기 좋은 수로(1·2·2.5·5 × 10^k, n칸)
 *   KCB6.parseTime("15:30") → {h, m}               규칙 E1: 0 ≤ h ≤ 24, 0 ≤ m < 60 아니면 던짐(있을 수 없는 시각을 화면에 못 내보냄)
 *   KCB6.koTime(h, m, style)                       "오후 3:30" | "오후 3시"(style "hour") — 12시 = 오후 12시, 0시 = 오전 12시
 *   KCB6.fmt(n, sep, digits)                       천 단위 구분 숫자 문자열
 *   KCB6.lerpColor(a, b, t)                        [r,g,b,a] 섞기 → "rgba()"
 * 결정적: f를 모르고, 받은 값만으로 그린다. 서체는 KTypo 역할로만(부품 안 서체 이름 없음).
 */
(function () {
  "use strict";
  const B = window.KCB6 || {};
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  B.rrect = function (ctx, x0, y0, x1, y1, r) {
    r = Math.max(0, Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2));
    ctx.beginPath();
    ctx.moveTo(x0 + r, y0);
    ctx.arcTo(x1, y0, x1, y1, r);
    ctx.arcTo(x1, y1, x0, y1, r);
    ctx.arcTo(x0, y1, x0, y0, r);
    ctx.arcTo(x0, y0, x1, y0, r);
    ctx.closePath();
  };

  let mctx = null;
  const mc = () => { if (!mctx) { const c = document.createElement("canvas"); c.width = 8; c.height = 8; mctx = c.getContext("2d"); } return mctx; };
  B.measureCtx = mc;
  B.width = function (str, role, size, opt) {
    return KTypo.layout(mc(), String(str), role, 0, 0, size, opt || {}).width;
  };
  B.text = function (ctx, str, role, x, y, size, color, opt) {
    opt = opt || {};
    const a = opt.alpha === undefined ? 1 : opt.alpha;
    if (a <= 0.003 || str === "" || str === null || str === undefined) return 0;
    const L = KTypo.layout(ctx, String(str), role, x, y, size, { align: opt.align || "left", tabular: !!opt.tabular, tracking: opt.tracking || 0 });
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = KC.rgba(color, a);
    for (const it of L.items) {
      ctx.font = it.font;
      if ("fontStretch" in ctx) ctx.fontStretch = it.stretch;
      ctx.fillText(it.ch, it.x, it.y);
    }
    return L.width;
  };

  /* smear(ctx, dx, dy, alpha, fn, box) — v0.6.7: fn(g)를 화면 밖 판에 한 번 그려 (dx,dy) 선분 위에 같은 무게로 평균(가운데 기준, KC.smearFn →
     KC.smearLine: float16 판, 사본 간격 ≤ 화면 1px, 길이는 ctx 변환까지 넣은 화면 px)한 뒤 알파와 함께 한 번 그림.
     예전: fn을 사본 3~9장으로 알파 1−(1−a)^(1/K) 덮어 그림 — 겹친 곳 덮임이 1에 가깝게 차 꼬리까지 진하고(돌출 그림자), 3px 간격 계단.
     g는 ctx와 같은 변환·그리기 모양(KC.ctxFrom — fillStyle 등은 ctx에서 옮김, globalAlpha는 1). box = ctx 좌표로 fn이 그리는 범위
     [x0, y0, x1, y1](없으면 캔버스 전체 — 느림, 큰 판). 길이 상한(R13)은 부르는 쪽이 정함(smearImage는 cap·max). */
  B.smear = function (ctx, dx, dy, alpha, fn, box) {
    const L = Math.hypot(dx, dy);
    const ga = ctx.globalAlpha;
    if (L < 0.75) { ctx.globalAlpha = ga * alpha; fn(ctx); ctx.globalAlpha = ga; return; }
    KC.smearFn(ctx, box || null, dx, dy, alpha, fn, "b6smear");
  };

  /* v0.6 smearImage(R13): 그림을 (dx,dy) 선분 위에 고르게 평균(상자 흐림), 가운데 기준(−½ ~ +½).
     예전(v0.5): 1.5px 간격 사본을 덮어 그림(최대 48장) — 긴 번짐은 간격이 벌어져 계단, 1px 선 같은 좁은 무늬는 결이 보였고,
       덮어 그리기라 마지막(앞쪽) 사본이 위에 와서 칩 왼쪽 띠 같은 가장자리 색이 번짐 전체에 진하게 남았다(돌출처럼 보임).
     지금: '자기와 반 칸 밀린 자기의 평균'을 n번 되풀이 → 사본 2^n장을 같은 무게로 평균, 간격 = 길이/(2^n − 1) ≤ 화면 1px
       (ctx 변환까지 넣은 화면 길이로 셈). 계단·결 없음.
     v0.6.6: 셈은 KC.smearLine(kc.js) — 사본을 float16 판에 더하고 한 번만 8비트로 내림. 예전 8비트 판은 단계마다 반올림이 쌓여
       옅은 알파 색이 틀어지고(크림 → 연두·분홍) 긴 번짐이 계단·돌출 글자처럼 보였다.
     opt: {cap: 길이 ≤ cap × 짧은 변(기본 0.5 — R13, 0이면 상한 없음), short: 짧은 변(그림 px, 기본 그림의 짧은 변 — 여백이 있으면 넉넉함),
           size: [w, h](img에서 쓸 왼쪽 위 크기 — 다시 쓰는 큰 캔버스의 일부만, 기본 전체),
           max: 길이 상한(그림 px, v0.6.6 — 기본 없음). 글자가 실린 그림을 길게 번질 때 = 가장 작은 글자 높이 × 0.25 권장:
             짧은 변 50%(cap)는 카드 크기 기준이라 글자보다 훨씬 길 수 있고, 그러면 가로획이 옅어져 세로획만 줄무늬('바코드')로 남는다
             (float 판에서도 같다 — 상자 흐림의 성질)} */
  B.smearImage = function (ctx, img, x, y, dx, dy, alpha, opt) {
    const iw = opt && opt.size ? opt.size[0] : img.width, ih = opt && opt.size ? opt.size[1] : img.height;
    const cap = opt && opt.cap !== undefined ? opt.cap : 0.5;
    const L = Math.hypot(dx, dy);
    if (cap > 0 && L > 0) {
      const sh = (opt && opt.short) || Math.min(iw, ih);
      if (L > cap * sh) { const k = (cap * sh) / L; dx *= k; dy *= k; }
    }
    const mx = opt && opt.max > 0 ? opt.max : 0, L2 = Math.hypot(dx, dy);
    if (mx && L2 > mx) { const k = mx / L2; dx *= k; dy *= k; }
    KC.smearLine(ctx, img, iw, ih, x, y, dx, dy, alpha);
  };
  B.sprite = function (w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
    // willReadFrequently: 소프트웨어 그리기로 고정 — GPU 캔버스는 글자 캐시가 데워지기 전·후 그림이 달라 결정성 시험에 걸렸다
    return { canvas: c, ctx: c.getContext("2d", { willReadFrequently: true }), w: c.width, h: c.height };
  };

  B.warp = function (ctx, src, sx, sy, sw, sh, map, step) {
    step = step || 2;
    for (let y = 0; y < sh; y += step) {
      const h = Math.min(step, sh - y);
      const a = map(sy + y), b = map(sy + y + h);
      const s = (a[2] + b[2]) / 2, cx = (a[1] + b[1]) / 2;
      const dh = b[0] - a[0];
      if (Math.abs(dh) < 1e-3) continue;
      // 띠 사이 틈을 막으려 위아래 0.35px 겹침
      ctx.drawImage(src, sx, sy + y, sw, h, cx - (sw * s) / 2, a[0] - 0.35, sw * s, dh + 0.7);
    }
  };

  B.niceMax = function (v, n) {
    n = n || 4;
    if (!(v > 0)) return 1;
    const raw = v / n, k = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * k >= raw - 1e-9) return m * k * n;
    return 10 * k * n;
  };

  B.parseTime = function (t) {
    let h, m;
    if (typeof t === "number") { h = Math.floor(t); m = Math.round((t - h) * 60); if (m === 60) { h += 1; m = 0; } }
    else {
      const q = /^\s*(\d{1,2})(?::(\d{2}))?\s*$/.exec(String(t));
      if (!q) throw new Error("KCB6.parseTime: 시각은 'HH:MM' — " + t);
      h = +q[1]; m = q[2] ? +q[2] : 0;
    }
    if (!(h >= 0 && h <= 24 && m >= 0 && m < 60) || (h === 24 && m > 0)) throw new Error("KCB6.parseTime: 있을 수 없는 시각(규칙 E1) — " + t);
    return { h, m, v: h + m / 60 };
  };
  B.koTime = function (h, m, style) {
    const am = h < 12 || h === 24;
    let hh = h % 12; if (hh === 0) hh = 12;
    const pre = am ? "오전" : "오후";
    if (style === "hour") return `${pre} ${hh}시` + (m ? ` ${m}분` : "");
    return `${pre} ${hh}:${String(m).padStart(2, "0")}`;
  };
  B.fmt = function (n, sep, digits) {
    let t = digits ? (+n).toFixed(digits) : String(Math.round(n));
    if (sep) { const p = t.split("."); p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, sep); t = p.join("."); }
    return t;
  };
  B.lerpColor = function (a, b, t) {
    const p = KC.color(a), q = KC.color(b);
    t = clamp(t, 0, 1);
    return `rgba(${Math.round(p[0] + (q[0] - p[0]) * t)},${Math.round(p[1] + (q[1] - p[1]) * t)},${Math.round(p[2] + (q[2] - p[2]) * t)},${(p[3] + (q[3] - p[3]) * t).toFixed(4)})`;
  };

  window.KCB6 = B;
})();
