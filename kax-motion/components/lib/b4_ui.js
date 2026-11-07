/* B4 — 앱 화면 틀 부품이 같이 쓰는 도우미. kc.js 다음, 이 도우미를 쓰는 부품 .js보다 먼저 읽는다(b1_shape.js도 먼저).
 *
 *   B4.rr(ctx, x0, y0, x1, y1, r)        모서리 둥근 사각 경로(왼쪽 위·오른쪽 아래 기준, beginPath 포함). r은 짧은 변 반까지
 *   B4.capsule(ctx, x0, x1, cy, h)        알약 경로(beginPath 포함)
 *   B4.canvas(w, h)                       화면 밖 캔버스 하나(부품 create에서 한 번 만들어 재사용)
 *   B4.smear(ctx, src, dx, dy, n, alpha)  src 캔버스를 (−dx/2..dx/2, −dy/2..dy/2)로 n장 펼쳐 평균 = 방향 흐림(움직임 흐림).
 *                                         캔버스 filter blur는 등방이라 세로 흐림을 못 낸다 → 여러 장 평균(상자 모션 블러).
 *                                         평균은 float16 판(KC.fbuf)에 'lighter'로 같은 무게씩 더해 만든다(v0.6.6 — 한 번만 8비트로 내림).
 *   B4.text(ctx, txt, role, x, y, size, opt)  KTypo가 있으면 KTypo.canvas, 없으면 sans-serif로(시험 페이지용) → 폭
 *   B4.textW(ctx, txt, role, size)        글자 폭만(그리지 않음)
 *   B4.lerp, B4.clamp, B4.mix(c1, c2, t)  (mix는 KC.color 꼴 → "rgba(...)")
 *   B4.normStyle(el, deep)                style 속성을 브라우저가 쓰는 꼴로 한 번 다시 써 둔다(mount 끝에서). 안 하면 setAttribute로 넣은
 *                                         'opacity:0'이 render의 같은 값 대입으로는 다시 쓰이지 않다가, 다른 값을 거쳐 돌아오면 'opacity: 0;'으로
 *                                         바뀌어 kc.js 자가 시험(스타일 문자열 지문)이 거짓으로 어긋남을 낸다.
 *   B4.speed(fn, n, dn)                   위치 함수 fn(n프레임)의 프레임당 속도(중앙 차분) — 움직임 흐림 세기
 * 결정적: 모두 순수 함수이거나 받은 캔버스에만 그린다. 난수·시계 없음.
 */
(function () {
  "use strict";
  const B4 = {};
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  B4.clamp = clamp;
  B4.lerp = (a, b, t) => a + (b - a) * t;

  B4.rr = function (c, x0, y0, x1, y1, r) {
    if (x1 < x0) { const t = x0; x0 = x1; x1 = t; }
    if (y1 < y0) { const t = y0; y0 = y1; y1 = t; }
    r = Math.max(0, Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2));
    c.beginPath();
    c.moveTo(x0 + r, y0);
    c.lineTo(x1 - r, y0);
    c.arcTo(x1, y0, x1, y0 + r, r);
    c.lineTo(x1, y1 - r);
    c.arcTo(x1, y1, x1 - r, y1, r);
    c.lineTo(x0 + r, y1);
    c.arcTo(x0, y1, x0, y1 - r, r);
    c.lineTo(x0, y0 + r);
    c.arcTo(x0, y0, x0 + r, y0, r);
    c.closePath();
  };
  B4.capsule = function (c, x0, x1, cy, h) {
    B4.rr(c, x0, cy - h / 2, x1, cy + h / 2, h / 2);
  };
  B4.canvas = function (w, h) {
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.ceil(w));
    cv.height = Math.max(1, Math.ceil(h));
    return cv;
  };
  B4.smear = function (ctx, src, dx, dy, n, alpha, x, y) {
    x = x || 0; y = y || 0;
    const a = alpha === undefined ? 1 : alpha;
    if (a <= 0) return;
    const d = Math.hypot(dx, dy);
    if (d < 0.75 || n <= 1) {
      ctx.globalAlpha *= a;
      ctx.drawImage(src, x, y);
      return;
    }
    n = Math.max(2, Math.min(n, Math.ceil(d) + 1));
    const pad = Math.ceil(d / 2) + 2;
    const W = src.width + 2 * pad, H = src.height + 2 * pad;
    // v0.6.6: float16 판(KC.fbuf)에 같은 무게로 더해 한 번만 8비트로 — 8비트 판에 1/n씩 더하면 채널마다 반올림이 쌓여
    //   밝은 화면이 분홍·초록 얼룩이 되고 n이 바뀔 때 색이 흔들렸다(ex-101 ui.phone_frame)
    const ACC = KC.fbuf("b4smear", W, H);
    KC.avgN(ACC._ctx, n, (g, i) => { const u = (i + 0.5) / n - 0.5; g.drawImage(src, pad + u * dx, pad + u * dy); });
    ctx.globalAlpha *= a;
    ctx.drawImage(ACC, 0, 0, W, H, x - pad, y - pad, W, H);
  };
  B4.text = function (ctx, txt, role, x, y, size, opt) {
    if (window.KTypo && window.KTYPO_PAIRS) return KTypo.canvas(ctx, txt, role, x, y, size, opt || {});
    ctx.font = `600 ${size}px sans-serif`;
    const w = ctx.measureText(txt).width;
    const al = opt && opt.align;
    ctx.fillText(txt, x - (al === "center" ? w / 2 : al === "right" ? w : 0), y);
    return w;
  };
  B4.textW = function (ctx, txt, role, size) {
    if (window.KTypo && window.KTYPO_PAIRS) return KTypo.layout(ctx, txt, role, 0, 0, size, {}).width;
    ctx.font = `600 ${size}px sans-serif`;
    return ctx.measureText(txt).width;
  };
  B4.mix = function (c1, c2, t) {
    const a = KC.color(c1), b = KC.color(c2);
    t = clamp(t, 0, 1);
    return `rgba(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)},${(a[3] + (b[3] - a[3]) * t).toFixed(4)})`;
  };
  B4.normStyle = function (el, deep) {
    const list = deep ? [el].concat(Array.from(el.querySelectorAll("*"))) : [el];
    for (const e of list) { const t = e.style && e.getAttribute("style"); if (t) e.style.cssText = e.style.cssText; }
  };
  B4.speed = (fn, n, dn) => { dn = dn || 0.5; return (fn(n + dn) - fn(n - dn)) / (2 * dn); };
  window.B4 = B4;
})();
