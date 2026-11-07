/* KCB11M — 금속 칠 도우미: 가림막(흰 모양) 안을 매끈한 금속 밝기장 + 지나가는 빛 띠로 칠한다. kc.js 뒤에 읽는다.
 * type.metal_fill_text가 쓴다. 다른 부품도 같은 칠을 쓰도록 입력을 단순하게 둔다.
 *
 *   const M = KCB11M.create(W, H, {res: 4})          화면 크기 W×H, 밝기장 해상도 1/res (CPU 캔버스 — 첫 drawImage 뒤 그리기 방식이 바뀌지 않게)
 *   M.mask()                                        → 가림막 ctx(지운 뒤 흰색·불투명으로 모양을 그린다)
 *   M.paint(ctx, box, metal, sheen)                 가림막 안만 금속으로 칠해 ctx에 얹는다
 *     box   [x0,y0,x1,y1] 밝기장 기준 상자(글자 묶음 상자 — 줄무늬·옆 기울기가 이 상자를 따라감)
 *     metal {stops: [[y(0..1), 밝기(0..1)], ...], side: 왼→오 밝기 차, dark: 색, light: 색, rows: 상자를 몇 줄로 나눠 줄마다 같은 표(기본 1)}
 *     sheen null | {pos: 띠 가운데 x(상자 비율, −0.5..1.5), width: 상자 폭 비율, gain: 더할 밝기, angle: 도(기울기)}
 * 결정적: 밝기장은 JS로 화소마다 계산(캔버스 그라데이션 ±1 흔들림 피함). 키우기는 CPU imageSmoothing.
 */
(function () {
  "use strict";
  const KCB11M = window.KCB11M || {};
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const cpu = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return [c, c.getContext("2d", { willReadFrequently: true })]; };

  // 밝기 표 → y(0..1)에서 밝기(선형 보간 + smoothstep)
  function stopsAt(stops, t) {
    if (t <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        const a = stops[i - 1], b = stops[i];
        let u = (t - a[0]) / Math.max(1e-6, b[0] - a[0]);
        u = u * u * (3 - 2 * u);
        return a[1] + (b[1] - a[1]) * u;
      }
    }
    return stops[stops.length - 1][1];
  }
  KCB11M.stopsAt = stopsAt;

  KCB11M.DEFAULT_METAL = {
    stops: [[0, 0.78], [0.4, 0.9], [0.55, 0.7], [0.85, 0.58], [1, 0.7]],
    side: 0.18, dark: "#1e1e22", light: "#ecebf0",
  };

  KCB11M.create = function (W, H, opt) {
    opt = opt || {};
    const res = opt.res || 4;
    const [mk, mctx] = cpu(W, H);
    const fw = Math.ceil(W / res), fh = Math.ceil(H / res);
    const [fd, fctx] = cpu(fw, fh);
    const [out, octx] = cpu(W, H);
    const img = fctx.createImageData(fw, fh);
    return {
      mask() {
        mctx.setTransform(1, 0, 0, 1, 0, 0); mctx.globalAlpha = 1; mctx.globalCompositeOperation = "source-over"; mctx.filter = "none";
        mctx.clearRect(0, 0, W, H);
        mctx.fillStyle = "#fff";
        return mctx;
      },
      paint(ctx, box, metal, sheen) {
        const m = Object.assign({}, KCB11M.DEFAULT_METAL, metal || {});
        const dk = KC.color(m.dark), lt = KC.color(m.light);
        const [bx0, by0, bx1, by1] = box;
        const bw = Math.max(1, bx1 - bx0), bh = Math.max(1, by1 - by0);
        const tg = sheen ? Math.tan(((sheen.angle || 0) * Math.PI) / 180) : 0;
        const d = img.data;
        for (let j = 0; j < fh; j++) {
          const y = (j + 0.5) * res;
          const rows = m.rows || 1, tr = clamp((y - by0) / bh, 0, 0.99999) * rows, ty = tr - Math.floor(tr); // rows: 줄마다 같은 밝기 표
          const base = stopsAt(m.stops, ty);
          for (let i = 0; i < fw; i++) {
            const x = (i + 0.5) * res;
            const tx = (x - bx0) / bw;
            let v = base - m.side * (clamp(tx, 0, 1) - 0.5);
            if (sheen) {
              const u = (tx + tg * (ty - 0.5) * (bh / bw) - sheen.pos) / Math.max(1e-3, sheen.width);
              v += sheen.gain * Math.exp(-u * u * 4);
            }
            v = clamp(v, 0, 1);
            const k = (j * fw + i) * 4;
            d[k] = dk[0] + (lt[0] - dk[0]) * v;
            d[k + 1] = dk[1] + (lt[1] - dk[1]) * v;
            d[k + 2] = dk[2] + (lt[2] - dk[2]) * v;
            d[k + 3] = 255;
          }
        }
        fctx.putImageData(img, 0, 0);
        octx.setTransform(1, 0, 0, 1, 0, 0); octx.globalAlpha = 1; octx.globalCompositeOperation = "source-over"; octx.filter = "none";
        octx.clearRect(0, 0, W, H);
        octx.imageSmoothingEnabled = true; octx.imageSmoothingQuality = "low";
        octx.drawImage(fd, 0, 0, fw, fh, 0, 0, fw * res, fh * res);
        octx.globalCompositeOperation = "destination-in";
        octx.drawImage(mk, 0, 0);
        octx.globalCompositeOperation = "source-over";
        ctx.drawImage(out, 0, 0);
      },
    };
  };

  window.KCB11M = KCB11M;
})();
