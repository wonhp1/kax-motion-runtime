/* KCB17 — 큰 모양 바꿈(액체 덩어리·렌즈·아이콘 휘감기) 부품이 같이 쓰는 도우미. kc.js 뒤, 이 도우미를 쓰는 부품 .js 앞에 읽는다.
 *
 *   KCB17.cpu(w, h)                    화면 밖 CPU 캔버스(처음부터 willReadFrequently — 크롬이 중간에 그리기 방식을 바꾸지 않게, SPEC 함정 2). ._ctx 붙음
 *   KCB17.fit(slot, w, h)              다시 쓰는 캔버스 칸(slot = {c: null})을 w×h 이상으로(128px 단위로 키움). 크기는 실제 캔버스 width·height로 댄다(SPEC 31)
 *   KCB17.clear(ctx)                   변환·알파·합성·필터를 되돌리고 캔버스를 통째로 지움(SPEC 27)
 *   KCB17.Noise(seed)                  2D 기울기 잡음(Perlin) → {n2(x, y) ≈ −1..1, fbm(x, y, oct, gain, lac) ≈ −1..1}. 표는 KC.rng(seed)로 한 번
 *   KCB17.sdBox(px, py, hx, hy, r)     가운데 기준 둥근 사각까지 거리(px, 안쪽 −). r은 min(hx, hy)까지
 *   KCB17.spinDraw(ctx, src, sw, sh, cx, cy, ang, alpha, rad)
 *                                      회전 번짐(R13): src의 (0,0)~(sw,sh) 그림(가운데 = 회전 중심)을 (cx, cy)에 각도 폭 ang(라디안) 위로 고르게 평균해 그린다.
 *                                      가운데 기준(−ang/2 ~ +ang/2), 같은 무게. KCB3.smearDraw(직선 번짐)와 같은 '자기와 반 칸 돌린 자기의 평균'을 n번 —
 *                                      사본 2^n장, 가장 바깥 반지름에서 사본 간격 ≤ 1px. float16 판 누적(v0.6.6 KC.halve). drawImage 2n번(n ≤ 11).
 *                                      rad(선택) = 그림이 실제로 있는 반지름(px, src 가운데부터) — 주면 작업 캔버스가 그만큼만(기본: src 대각선 반)
 *   KCB17.mix3(a, b, t)                [r,g,b] 섞기(0..255 소수)
 *   KCB17.rgb(c)                       KC.color 꼴 → [r,g,b]
 *   KCB17.rrect(ctx, cx, cy, w, h, r)  가운데 기준 둥근 사각 경로(beginPath 포함)
 * 결정적: 시간·난수 없음(잡음 표는 시드로). 받은 값만으로 그린다.
 */
(function () {
  "use strict";
  if (!window.KC) throw new Error("KCB17: kc.js를 먼저 읽기");
  const B = {};
  const clamp = KC.clamp;

  B.cpu = function (w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
    c._ctx = c.getContext("2d", { willReadFrequently: true });
    return c;
  };
  B.fit = function (slot, w, h) {
    const W = Math.ceil(Math.max(1, w) / 128) * 128, H = Math.ceil(Math.max(1, h) / 128) * 128;
    const c = slot.c;
    if (!c || c.width < W || c.height < H) slot.c = B.cpu(Math.max(W, c ? c.width : 0), Math.max(H, c ? c.height : 0));
    return slot.c;
  };
  B.clear = function (x) {
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalAlpha = 1; x.globalCompositeOperation = "source-over"; x.filter = "none";
    x.clearRect(0, 0, x.canvas.width, x.canvas.height);
  };

  B.rgb = (c) => { const q = KC.color(c); return [q[0], q[1], q[2]]; };
  B.mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  B.rrect = function (ctx, cx, cy, w, h, r) {
    w = Math.max(0, w); h = Math.max(0, h);
    r = clamp(r, 0, Math.min(w, h) / 2);
    const x = cx - w / 2, y = cy - h / 2, P = Math.PI;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.arc(x + w - r, y + r, r, -P / 2, 0);
    ctx.lineTo(x + w, y + h - r); ctx.arc(x + w - r, y + h - r, r, 0, P / 2);
    ctx.lineTo(x + r, y + h); ctx.arc(x + r, y + h - r, r, P / 2, P);
    ctx.lineTo(x, y + r); ctx.arc(x + r, y + r, r, P, 1.5 * P);
    ctx.closePath();
  };

  B.sdBox = function (px, py, hx, hy, r) {
    r = Math.min(r, hx, hy);
    const qx = Math.abs(px) - hx + r, qy = Math.abs(py) - hy + r;
    const ox = qx > 0 ? qx : 0, oy = qy > 0 ? qy : 0;
    return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - r;
  };

  /* 기울기 잡음: 격자마다 시드 표의 단위 기울기, 5차 보간(경계에서 기울기·곡률 0). 값 범위는 ×1.41로 대략 −1..1 */
  B.Noise = function (seed) {
    const rnd = KC.rng((seed >>> 0) || 1);
    const p = new Uint8Array(256), P = new Uint16Array(512), GX = new Float32Array(256), GY = new Float32Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
    for (let i = 0; i < 512; i++) P[i] = p[i & 255];
    for (let i = 0; i < 256; i++) { const a = rnd() * Math.PI * 2; GX[i] = Math.cos(a); GY[i] = Math.sin(a); }
    function n2(x, y) {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      const X = xi & 255, Y = yi & 255;
      const a = P[X] + Y, b = P[X + 1] + Y;
      const g00 = P[a], g01 = P[a + 1], g10 = P[b], g11 = P[b + 1];
      const d00 = GX[g00] * xf + GY[g00] * yf;
      const d10 = GX[g10] * (xf - 1) + GY[g10] * yf;
      const d01 = GX[g01] * xf + GY[g01] * (yf - 1);
      const d11 = GX[g11] * (xf - 1) + GY[g11] * (yf - 1);
      const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
      const x1 = d00 + u * (d10 - d00), x2 = d01 + u * (d11 - d01);
      return (x1 + v * (x2 - x1)) * 1.41;
    }
    function fbm(x, y, oct, gain, lac) {
      let s = 0, a = 1, n = 0, fx = x, fy = y;
      for (let k = 0; k < oct; k++) { s += a * n2(fx, fy); n += a; a *= gain; fx = fx * lac + 17.31; fy = fy * lac + 7.73; }
      return s / n;
    }
    return { n2, fbm };
  };

  /* 회전 번짐 — 머리 주석. src 안 그림의 가운데(sw/2, sh/2)가 회전 중심 */
  B.spinDraw = function (ctx, src, sw, sh, cx, cy, ang, alpha, rad) {
    const ga = ctx.globalAlpha, al = alpha === undefined ? 1 : alpha;
    const m = ctx.getTransform(), k = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
    const R = rad > 0 ? Math.min(rad, Math.hypot(sw, sh) / 2) : Math.hypot(sw, sh) / 2;
    const arc = Math.abs(ang) * R * k;   // 가장 바깥 화소가 셔터 동안 지나는 화면 길이
    ctx.globalAlpha = ga * al;
    if (arc < 0.75) { ctx.drawImage(src, 0, 0, sw, sh, cx - sw / 2, cy - sh / 2, sw, sh); ctx.globalAlpha = ga; return; }
    const n = Math.min(11, Math.max(1, Math.ceil(Math.log2(arc + 1)))), K = Math.pow(2, n);
    const D = Math.ceil(2 * R) + 4, h = D / 2;
    // v0.6.6: 사본은 float16 판(KC.fbuf·KC.halve)에 더해 한 번만 8비트로(8비트 판은 단계마다 반올림이 쌓여 색이 틀어짐)
    const A0 = KC.fbuf("spin0", D, D), B0 = KC.fbuf("spin1", D, D);
    A0._ctx.drawImage(src, 0, 0, sw, sh, h - sw / 2, h - sh / 2, sw, sh);
    const A = KC.halve(A0, B0, D, D, n, (b, i) => {
      const s = (Math.pow(2, i) / (K - 1)) * ang;
      b.translate(h, h); b.rotate(s); b.translate(-h, -h);
    });
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(-ang / 2);
    ctx.drawImage(A, 0, 0, D, D, -h, -h, D, D);
    ctx.restore();
    ctx.globalAlpha = ga;
  };

  window.KCB17 = B;
})();
