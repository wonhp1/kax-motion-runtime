/* KCB7 — 카드·목록·스캔 부품이 같이 쓰는 도우미. kc.js 뒤, 이 도우미를 쓰는 부품 .js 앞에 읽는다.
 *
 *   KCB7.rrect(ctx, x, y, w, h, r)          왼쪽 위 기준 둥근 사각 경로(beginPath 포함)
 *   KCB7.canvas(w, h)                       화면 밖 캔버스(._ctx 붙음). create에서 만들고 매 프레임 지우고 다시 그린다
 *   KCB7.paint(ctx, src, x, y, w, h, f)      카드 내용 그리기. src 꼴:
 *                                             "#rrggbb"·"rgb()"·[r,g,b]   단색 면
 *                                             <img>·<canvas>               가운데 맞춰 꽉 채움(cover) — 사진 카드
 *                                             (ctx, w, h, f) => {...}      그리기 함수(0,0 ~ w,h 로컬 좌표)
 *                                             null                         아무것도 안 그림
 *   KCB7.card(spr, src, w, h, r, o, f)       spr(화면 밖 캔버스)에 카드 하나: 바탕 o.fill + 테두리 o.frame(bw) 안쪽에 내용(둥근 자르기)
 *   KCB7.shadow(w, h, r, blur, color)       부드러운 그림자 판(미리 그림, 한 번) → {cv, m}. drawImage(cv, x - m, y - m)
 *                                           캔버스 shadowBlur는 프레임마다 ±1 흔들려(앞 묶음 함정) 판을 미리 굽는다.
 *   KCB7.vnoise(x, y, seed)                 값 잡음 0..1(정수 해시 + smoothstep, 결정적)
 *   KCB7.develop(spr, st, o)                사진 현상: spr 위에 모자이크(st.blk px 칸) + 흰 막(st.white, st.reveal; 잡음 순서)
 *   KCB7.keys(K, u)                         [[u, v], ...] 짧은 정규화 마디 → 선형 보간 값(u 0..1). 단계 모양을 적는 데만 씀(좌표표 아님)
 *   KCB7.cursor(ctx, x, y, size, o)         코드로 그린 화살 커서(흰 몸 + 진한 테)
 *   KCB7.tile(o)                            데모용 그리기 함수: 단색 타일 + 선 아이콘(B1.strokeIcon, 있으면) + 글자 막대(코드 그림)
 *   KCB7.perim(x0, y0, x1, y1, r, step, dir) 둥근 사각 둘레를 편 점 목록 {P, cum, L}(왼쪽 변 위 끝에서 반시계, dir −1 = 시계)
 *   KCB7.perimSeg(ctx, G, a, b)             둘레 길이 구간 [a, b] px 경로 추가(감아 돎) — 크기가 바뀌는 상자의 둘레 빛(ai_scan)
 * 결정적: 시간·난수 없음. 받은 값만으로 그린다. 서체 이름 없음(글자는 부품이 KTypo 역할로).
 */
(function () {
  "use strict";
  if (!window.KC) throw new Error("KCB7: kc.js를 먼저 읽기");
  const B = {};
  const clamp = KC.clamp;

  B.rrect = function (ctx, x, y, w, h, r) {
    w = Math.max(0, w); h = Math.max(0, h);
    r = clamp(r, 0, Math.min(w, h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  B.canvas = function (w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
    c._ctx = c.getContext("2d", { willReadFrequently: true });
    return c;
  };

  const isImg = (s) => s && typeof s === "object" && !Array.isArray(s) && (s.tagName === "IMG" || s.tagName === "CANVAS" || s.getContext || s.naturalWidth !== undefined);
  B.paint = function (ctx, src, x, y, w, h, f) {
    if (src === null || src === undefined) return;
    if (typeof src === "function") { ctx.save(); ctx.translate(x, y); src(ctx, w, h, f); ctx.restore(); return; }
    if (isImg(src)) {
      const iw = src.naturalWidth || src.width, ih = src.naturalHeight || src.height;
      if (!iw || !ih || (src.tagName === "IMG" && !src.complete)) return;
      const k = Math.max(w / iw, h / ih), dw = iw * k, dh = ih * k;
      ctx.drawImage(src, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      return;
    }
    ctx.fillStyle = KC.rgba(src); ctx.fillRect(x, y, w, h);
  };

  // spr 크기 = 카드 크기(정수로 올림). o = {fill, frame, bw, r_in}
  B.card = function (spr, src, w, h, r, o, f) {
    const c = spr._ctx;
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = "source-over"; c.filter = "none";
    c.clearRect(0, 0, spr.width, spr.height);
    const bw = (o && o.bw) || 0;
    c.save();
    B.rrect(c, 0, 0, w, h, r); c.clip();
    if (o && o.frame && bw > 0) { c.fillStyle = KC.rgba(o.frame); c.fillRect(0, 0, w, h); }
    else if (o && o.fill) { c.fillStyle = KC.rgba(o.fill); c.fillRect(0, 0, w, h); }
    if (bw > 0) { B.rrect(c, bw, bw, w - 2 * bw, h - 2 * bw, Math.max(0, r - bw)); c.clip(); }
    B.paint(c, src, bw, bw, w - 2 * bw, h - 2 * bw, f);
    c.restore();
    return spr;
  };

  B.shadow = function (w, h, r, blur, color) {
    const m = Math.ceil(blur * 3 + 4);
    const cv = B.canvas(w + 2 * m, h + 2 * m), c = cv._ctx;
    c.filter = `blur(${blur.toFixed(2)}px)`;
    c.fillStyle = KC.rgba(color || "#000");
    B.rrect(c, m, m, w, h, r); c.fill();
    c.filter = "none";
    return { cv, m };
  };

  function hash(x, y, s) { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
  B.vnoise = function (x, y, s) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
    return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
  };

  // 사진 현상: st = {white 0..1, reveal 0..1, blk 칸 px(0 = 없음)}, o = {seed, cu, cv(늦게 드러나는 곳 0..1), film(흰 막 색), cell, grid}
  const tmp = B.canvas(8, 8);
  B.develop = function (spr, st, o) {
    const c = spr._ctx, W = spr.width, H = spr.height;
    o = o || {};
    if (st.blk >= 1.5) {
      const sw = Math.max(1, Math.round(W / st.blk)), sh = Math.max(1, Math.round(H / st.blk));
      tmp.width = sw; tmp.height = sh;
      const t = tmp._ctx;
      t.imageSmoothingEnabled = true; t.clearRect(0, 0, sw, sh);
      t.drawImage(spr, 0, 0, sw, sh);
      c.save();
      c.globalCompositeOperation = "copy";
      c.imageSmoothingEnabled = false;
      c.drawImage(tmp, 0, 0, sw, sh, 0, 0, W, H);
      c.restore();
      c.save();
      c.globalCompositeOperation = "source-atop";
      c.fillStyle = o.grid || "rgba(0,0,0,0.22)";
      const cw = W / sw, chh = H / sh;
      for (let i = 1; i < sw; i++) c.fillRect(i * cw - 0.6, 0, 1.2, H);
      for (let j = 1; j < sh; j++) c.fillRect(0, j * chh - 0.6, W, 1.2);
      c.restore();
    }
    if (st.white > 0.001) {
      const cell = o.cell || 10, seed = o.seed || 1, cu = o.cu === undefined ? 0.5 : o.cu, cv = o.cv === undefined ? 0.5 : o.cv;
      const film = KC.color(o.film || "#fbfbfa");
      c.save();
      c.globalCompositeOperation = "source-atop";
      for (let y = 0; y < H; y += cell) for (let x = 0; x < W; x += cell) {
        const nz = B.vnoise(x / 60, y / 60, seed) * 0.7 + B.vnoise(x / 19, y / 19, seed + 7) * 0.3;
        const dir = 1 - Math.min(1, Math.hypot((x / W - cu) / 0.5, (y / H - cv) / 0.5) / 1.25); // 가장자리 먼저, (cu,cv) 마지막
        const ord = 0.6 * dir + 0.4 * nz;
        let a = ord > st.reveal ? 1 : st.white * 0.1;
        if (st.reveal >= 1) a = st.white;
        if (a <= 0.003) continue;
        c.fillStyle = `rgba(${film[0]},${film[1]},${film[2]},${a.toFixed(3)})`;
        c.fillRect(x, y, cell, cell);
      }
      c.restore();
    }
  };

  B.keys = function (K, u) {
    if (!K || !K.length) return 0;
    if (u <= K[0][0]) return K[0][1];
    for (let i = 1; i < K.length; i++) if (u <= K[i][0]) {
      const [a, va] = K[i - 1], [b, vb] = K[i];
      return va + (vb - va) * ((u - a) / Math.max(1e-9, b - a));
    }
    return K[K.length - 1][1];
  };

  B.cursor = function (ctx, x, y, size, o) {
    o = o || {};
    const k = size / 40;
    ctx.save();
    ctx.translate(x, y); ctx.scale(k, k);
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(0, 34); ctx.lineTo(8.5, 26); ctx.lineTo(14, 38.5); ctx.lineTo(19.5, 36); ctx.lineTo(14, 24); ctx.lineTo(25, 24); ctx.closePath();
    ctx.lineJoin = "round";
    ctx.fillStyle = KC.rgba(o.fill || "#ffffff", o.alpha); ctx.fill();
    ctx.lineWidth = 2.6; ctx.strokeStyle = KC.rgba(o.ink || "#16161a", o.alpha); ctx.stroke();
    ctx.restore();
  };

  // 데모용 타일: {bg, ink, icon, bars(글자 막대 수), blob(둥근 덩어리 색)}
  B.tile = function (o) {
    o = o || {};
    return function (ctx, w, h) {
      ctx.fillStyle = KC.rgba(o.bg || "#d9dde6"); ctx.fillRect(0, 0, w, h);
      if (o.blob) {
        ctx.fillStyle = KC.rgba(o.blob);
        ctx.beginPath(); ctx.arc(w * (o.bx || 0.7), h * (o.by || 0.3), Math.min(w, h) * (o.br || 0.42), 0, Math.PI * 2); ctx.fill();
      }
      if (o.hill) {
        ctx.fillStyle = KC.rgba(o.hill);
        ctx.beginPath(); ctx.moveTo(0, h * 0.78);
        ctx.quadraticCurveTo(w * 0.35, h * 0.56, w * 0.62, h * 0.72); ctx.quadraticCurveTo(w * 0.84, h * 0.82, w, h * 0.66);
        ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fill();
      }
      if (o.icon && window.B1) B1.strokeIcon(ctx, o.icon, w * (o.ix || 0.5), h * (o.iy || 0.42), Math.min(w, h) * (o.isize || 0.36), { color: KC.rgba(o.ink || "#ffffff"), width: Math.min(w, h) * 0.03 });
      const bars = o.bars || 0;
      for (let i = 0; i < bars; i++) {
        ctx.fillStyle = KC.rgba(o.ink || "#ffffff", i === 0 ? 0.9 : 0.55);
        const bw = w * (i === 0 ? 0.56 : 0.4 - 0.08 * (i - 1)), bh = Math.max(4, h * 0.03);
        B.rrect(ctx, w * 0.1, h * (0.8 + 0.07 * i), bw, bh, bh / 2); ctx.fill();
      }
    };
  };

  // 둥근 사각 둘레를 펴 둔 점 목록(왼쪽 변 위 끝에서 반시계 = 아래로 내려감, 실측 둘레 빛 방향). dir -1이면 시계.
  B.perim = function (x0, y0, x1, y1, r, step, dir) {
    r = clamp(r, 0, Math.min(x1 - x0, y1 - y0) / 2);
    step = step || 2;
    const P = [];
    const line = (xa, ya, xb, yb) => { const n = Math.max(1, Math.ceil(Math.hypot(xb - xa, yb - ya) / step)); for (let i = 1; i <= n; i++) P.push([xa + (xb - xa) * (i / n), ya + (yb - ya) * (i / n)]); };
    const arc = (cx, cy, a0, a1) => { const n = Math.max(2, Math.ceil((Math.abs(a1 - a0) * r) / step)); for (let i = 1; i <= n; i++) { const a = a0 + (a1 - a0) * (i / n); P.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } };
    const H = Math.PI / 2;
    P.push([x0, y0 + r]);
    line(x0, y0 + r, x0, y1 - r); arc(x0 + r, y1 - r, 2 * H, H);
    line(x0 + r, y1, x1 - r, y1); arc(x1 - r, y1 - r, H, 0);
    line(x1, y1 - r, x1, y0 + r); arc(x1 - r, y0 + r, 0, -H);
    line(x1 - r, y0, x0 + r, y0); arc(x0 + r, y0 + r, -H, -2 * H);
    if (dir === -1) P.reverse();
    const cum = [0];
    for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    return { P, cum, L: cum[cum.length - 1] };
  };
  // 둘레 길이 구간 [a, b](px, 감아 돎) 경로 추가
  B.perimSeg = function (ctx, G, a, b) {
    if (b - a <= 0.5) return;
    const L = G.L;
    const k = Math.floor(a / L); a -= k * L; b -= k * L;
    const pt = (d) => { let lo = 0, hi = G.cum.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (G.cum[m] <= d) lo = m; else hi = m; } const t = (d - G.cum[lo]) / Math.max(1e-9, G.cum[hi] - G.cum[lo]); return [[G.P[lo][0] + (G.P[hi][0] - G.P[lo][0]) * t, G.P[lo][1] + (G.P[hi][1] - G.P[lo][1]) * t], lo]; };
    const seg = (s0, s1) => { const [p0, i0] = pt(s0), [p1, i1] = pt(s1); ctx.moveTo(p0[0], p0[1]); for (let i = i0 + 1; i <= i1; i++) ctx.lineTo(G.P[i][0], G.P[i][1]); ctx.lineTo(p1[0], p1[1]); };
    if (b > L) { seg(a, L); seg(0, Math.min(L, b - L)); } else seg(a, b);
  };

  window.KCB7 = B;
})();
