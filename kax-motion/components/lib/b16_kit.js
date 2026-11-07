/* KCB16 — UI·글자 부품 몇 개가 같이 쓰는 도우미. kc.js(·typography/mixed_text.js) 뒤, 이 도우미를 쓰는 부품 .js 앞에 읽는다.
 *
 * 부품이 쓰는 것
 *   KCB16.cpu(w, h)                      화면 밖 CPU 캔버스(willReadFrequently — 첫 drawImage 뒤 그리기 방식이 바뀌지 않게). ._ctx 붙음
 *   KCB16.fit(c, w, h)                   CPU 캔버스 c를 적어도 w×h로(128px 단위로 키움, 줄이지 않음) — 크기는 늘 c.width·c.height로 잰다(SPEC 31)
 *   KCB16.clear(ctx)                     변환·알파·합성·필터를 처음 값으로 + 통째로 지움(KC.ctxReset + clearRect — SPEC 27·30)
 *   KCB16.rr(ctx, x, y, w, h, r)         왼쪽 위 기준 둥근 사각 경로(beginPath 포함). r은 짧은 변 반까지
 *   KCB16.paint(ctx, src, x, y, w, h, f) 칸 내용: 색 | <img>·<canvas>(가운데 맞춰 꽉 채움) | (ctx, w, h, f) => {}(로컬 좌표) | null(안 그림)
 *   KCB16.text(ctx, s, role, x, y, size, color, opt) KTypo 역할로 한 줄(없으면 sans-serif) → 폭. opt: {align, alpha}
 *   KCB16.textW(s, role, size)           글 폭만
 *   KCB16.appIcon(ctx, cx, cy, size, o)  코드로 그린 앱 아이콘(둥근 네모 + 흰 선 기호). o: {color, color2(아래쪽 색), glyph: B1 선 아이콘 이름|null, r(비율 0.23)}
 *                                         브랜드 아이콘 대신 — 색은 입력. B1(lib/b1_shape.js)이 없으면 기호 없이 면만
 *   KCB16.blurInto(dst, src, box, sigma, tmp)  src의 box(+3σ 여유) 부분을 CPU에서 흐려 dst에 같은 좌표로(KCB8.blurred와 같은 방법, 흔들림 없음)
 *
 * 데모만 쓰는 것(부품 .js는 부르지 않는다)
 *   KCB16.photo(seed, w, h, kind)         코드로 그린 '사진 같은' 중립 그림(CPU 캔버스, 한 번 그려 둠). kind:
 *                                         "sea" "room" "shelf" "street" "night" "field" "studio" "cafe" "plant" "dusk" — 코드 그림
 * 결정적: 시간·Math.random 없음(난수는 KC.rng(seed)). 받은 값만으로 그린다. 서체 이름 없음(KTypo 역할).
 */
(function () {
  "use strict";
  if (!window.KC) throw new Error("KCB16: kc.js를 먼저 읽기");
  const B = {};
  const clamp = KC.clamp;

  B.cpu = function (w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
    c._ctx = c.getContext("2d", { willReadFrequently: true });
    return c;
  };
  B.fit = function (c, w, h) {
    const W = Math.max(1, Math.ceil(w / 128) * 128), H = Math.max(1, Math.ceil(h / 128) * 128);
    if (c.width < w || c.height < h) { c.width = Math.max(c.width, W); c.height = Math.max(c.height, H); }
    return c;
  };
  B.clear = function (ctx) {
    KC.ctxReset(ctx);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  };
  B.rr = function (ctx, x, y, w, h, r) {
    if (w < 0) { x += w; w = -w; }
    if (h < 0) { y += h; h = -h; }
    r = clamp(r, 0, Math.min(w, h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };
  const isImg = (s) => s && (s.tagName === "IMG" || s.tagName === "CANVAS" || (typeof ImageBitmap !== "undefined" && s instanceof ImageBitmap));
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

  let mctx = null;
  const mc = () => { if (!mctx) mctx = B.cpu(8, 8)._ctx; return mctx; };
  B.text = function (ctx, s, role, x, y, size, color, opt) {
    opt = opt || {};
    if (!s) return 0;
    const ga = ctx.globalAlpha;
    if (opt.alpha !== undefined) ctx.globalAlpha = ga * opt.alpha;
    ctx.fillStyle = color;
    let w;
    if (window.KTypo) w = KTypo.canvas(ctx, String(s), role, x, y, size, { align: opt.align || "left", tracking: opt.tracking });
    else {
      ctx.font = `${role === "ui_title" ? 700 : 400} ${size}px sans-serif`;
      ctx.textAlign = opt.align || "left"; ctx.textBaseline = "alphabetic";
      ctx.fillText(String(s), x, y); w = ctx.measureText(String(s)).width;
      ctx.textAlign = "left";
    }
    ctx.globalAlpha = ga;
    return w;
  };
  B.textW = function (s, role, size) {
    if (!s) return 0;
    if (window.KTypo) return KTypo.layout(mc(), String(s), role, 0, 0, size, {}).width;
    const c = mc(); c.font = `400 ${size}px sans-serif`; return c.measureText(String(s)).width;
  };

  B.appIcon = function (ctx, cx, cy, size, o) {
    o = o || {};
    const r = size * (o.r === undefined ? 0.23 : o.r), x = cx - size / 2, y = cy - size / 2;
    const c1 = KC.color(o.color || "#4b6bfb"), c2 = KC.color(o.color2 || o.color || "#4b6bfb");
    // 세로 두 색(가운데 위 → 아래). 그라데이션은 캡처마다 ±1 흔들릴 수 있어 띠 8줄로 직접 채움(SPEC 함정 1)
    ctx.save();
    B.rr(ctx, x, y, size, size, r); ctx.clip();
    const n = 8;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      ctx.fillStyle = `rgb(${Math.round(c1[0] + (c2[0] - c1[0]) * t)},${Math.round(c1[1] + (c2[1] - c1[1]) * t)},${Math.round(c1[2] + (c2[2] - c1[2]) * t)})`;
      ctx.fillRect(x, y + (size * i) / n, size, size / n + 1);
    }
    ctx.restore();
    if (o.glyph && window.B1) B1.strokeIcon(ctx, o.glyph, cx, cy, size * 0.56, { color: o.ink || "#ffffff", width: Math.max(1.5, size * 0.075) });
  };

  // KCB8.blurred와 같은 방법(CPU 캔버스 두 장): 원천 사각만 옮겨 흐림 → dst에 같은 좌표로
  B.blurInto = function (dst, src, box, sigma, tmp) {
    const m = Math.ceil(sigma * 3) + 2;
    const x0 = Math.floor(box[0]) - m, y0 = Math.floor(box[1]) - m, x1 = Math.ceil(box[2]) + m, y1 = Math.ceil(box[3]) + m;
    const w = x1 - x0, h = y1 - y0;
    if (w <= 0 || h <= 0) return;
    if (!tmp.a) { tmp.a = B.cpu(w, h); tmp.b = B.cpu(w, h); }
    B.fit(tmp.a, w, h); B.fit(tmp.b, w, h);
    const a = tmp.a._ctx, b = tmp.b._ctx;
    B.clear(a); B.clear(b);
    a.drawImage(src, -x0, -y0);
    if (sigma > 0.05) { b.filter = `blur(${sigma.toFixed(2)}px)`; b.drawImage(tmp.a, 0, 0, w, h, 0, 0, w, h); b.filter = "none"; }
    else b.drawImage(tmp.a, 0, 0, w, h, 0, 0, w, h);
    dst.drawImage(tmp.b, 0, 0, w, h, x0, y0, w, h);
  };

  /* ---------- 데모용 '사진 같은' 그림 ---------- */
  const PAL = {
    sea: { sky: ["#f2c79a", "#8fb6d6"], ground: ["#3f7f99", "#1f4e66"], obj: ["#f6e2c4", "#d9925f", "#2d4a5a"], horizon: 0.55 },
    room: { sky: ["#e9dfd1", "#cdbba6"], ground: ["#a98868", "#7a5d44"], obj: ["#f3efe8", "#5c6b5a", "#b4553c"], horizon: 0.68 },
    shelf: { sky: ["#ece6dc", "#d8d0c3"], ground: ["#c7b9a6", "#a3937f"], obj: ["#d89a4a", "#2f3e46", "#e8e2d6"], horizon: 0.82 },
    street: { sky: ["#c9d6df", "#9fb1bd"], ground: ["#7d7f80", "#4b4d4f"], obj: ["#e7e2d8", "#33393f", "#c96a46"], horizon: 0.6 },
    night: { sky: ["#0d1830", "#1c2c4c"], ground: ["#16203a", "#0a1020"], obj: ["#f2b45a", "#e7d27a", "#5a7ab8"], horizon: 0.62, dots: true },
    field: { sky: ["#d7e4ea", "#a9c6d3"], ground: ["#8ba55c", "#4f6b33"], obj: ["#f1ead2", "#3d5a2a", "#d7b34e"], horizon: 0.58 },
    studio: { sky: ["#efe1df", "#dcc3c2"], ground: ["#d6b9b4", "#b8958f"], obj: ["#f7f2ee", "#7c3b3b", "#2c2a33"], horizon: 0.74 },
    cafe: { sky: ["#3b2a22", "#5a4033"], ground: ["#2a1d17", "#140d0a"], obj: ["#e9b97a", "#c47a3d", "#f3e3c8"], horizon: 0.66, dots: true },
    plant: { sky: ["#e7ebe0", "#c9d5bf"], ground: ["#b5a58e", "#8c7c66"], obj: ["#4d7a43", "#2f5a35", "#cf8a5a"], horizon: 0.72 },
    dusk: { sky: ["#f4b98e", "#6a5a8e"], ground: ["#2e3550", "#161a2c"], obj: ["#ffd6a3", "#f08a62", "#3a3f63"], horizon: 0.6, dots: true },
  };
  B.photoKinds = Object.keys(PAL);
  B.photo = function (seed, w, h, kind) {
    const P = PAL[kind] || PAL.room;
    const R = KC.rng(seed >>> 0 || 1);
    const c = B.cpu(w, h), x = c._ctx;
    const vg = (y0, y1, a, b) => { const g = x.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, a); g.addColorStop(1, b); return g; };
    const hz = h * P.horizon;
    x.fillStyle = vg(0, hz, P.sky[0], P.sky[1]); x.fillRect(0, 0, w, hz + 2);
    x.fillStyle = vg(hz, h, P.ground[0], P.ground[1]); x.fillRect(0, hz, w, h - hz);
    // 큰 빛 덩어리(부드러운 원)
    for (let i = 0; i < 3; i++) {
      const cx = w * (0.15 + 0.7 * R()), cy = h * (0.15 + 0.5 * R()), rr = Math.min(w, h) * (0.25 + 0.3 * R());
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, rr);
      g.addColorStop(0, "rgba(255,255,255,0.32)"); g.addColorStop(1, "rgba(255,255,255,0)");
      x.fillStyle = g; x.fillRect(0, 0, w, h);
    }
    // 물건: 둥근 사각·원(세로 명암 + 바닥 그림자)
    const n = 4 + Math.floor(R() * 4);
    for (let i = 0; i < n; i++) {
      const col = P.obj[i % P.obj.length];
      const ow = w * (0.08 + 0.22 * R()), oh = h * (0.12 + 0.42 * R());
      const ox = w * (0.04 + 0.9 * R()) - ow / 2, oy = hz + h * (0.04 * R()) - oh * (0.55 + 0.4 * R());
      x.save();
      x.filter = "blur(6px)"; x.fillStyle = "rgba(0,0,0,0.22)";
      x.beginPath(); x.ellipse(ox + ow / 2, oy + oh + 4, ow * 0.55, Math.max(4, oh * 0.06), 0, 0, Math.PI * 2); x.fill();
      x.filter = "none";
      const k = KC.color(col);
      const lite = `rgb(${Math.min(255, k[0] + 26)},${Math.min(255, k[1] + 26)},${Math.min(255, k[2] + 26)})`;
      const dark = `rgb(${Math.round(k[0] * 0.72)},${Math.round(k[1] * 0.72)},${Math.round(k[2] * 0.72)})`;
      x.fillStyle = vg(oy, oy + oh, lite, dark);
      if (R() < 0.4) { x.beginPath(); x.ellipse(ox + ow / 2, oy + oh * 0.55, ow / 2, oh * 0.45, 0, 0, Math.PI * 2); x.fill(); }
      else { B.rr(x, ox, oy, ow, oh, Math.min(ow, oh) * (0.08 + 0.3 * R())); x.fill(); }
      x.fillStyle = "rgba(255,255,255,0.18)"; x.fillRect(ox + ow * 0.12, oy + oh * 0.08, Math.max(2, ow * 0.08), oh * 0.7);
      x.restore();
    }
    if (P.dots) { // 밤·카페: 작은 빛 점(보케)
      for (let i = 0; i < 26; i++) {
        const cx = w * R(), cy = h * (0.1 + 0.6 * R()), rr = 3 + 14 * R();
        const col = P.obj[i % 2];
        x.save(); x.globalAlpha = 0.35 + 0.5 * R(); x.filter = `blur(${(1 + rr * 0.35).toFixed(1)}px)`;
        x.fillStyle = col; x.beginPath(); x.arc(cx, cy, rr, 0, Math.PI * 2); x.fill(); x.restore();
      }
    }
    // 사진 같은 부드러움: 한 번 살짝 흐림
    const t = B.cpu(w, h);
    t._ctx.filter = "blur(1.2px)"; t._ctx.drawImage(c, 0, 0); t._ctx.filter = "none";
    return t;
  };

  window.KCB16 = B;
})();
