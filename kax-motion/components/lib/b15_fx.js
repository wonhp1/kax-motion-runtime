/* KCB15 — 작은 효과 부품들이 같이 쓰는 도우미. kc.js 뒤, 이 도우미를 쓰는 부품 .js 앞에 읽는다.
 *
 *   KCB15.sprite(w, h)                 화면 밖 캔버스 {canvas, ctx, w, h} — 소프트웨어 그리기(willReadFrequently, 결정성)
 *   KCB15.fit(c, w, h)                 다시 쓰는 캔버스 c(sprite 객체 또는 null)를 w×h 이상으로(128px 단위로 키움) — 크기는
 *                                      c.canvas.width로 댄다(SPEC 31). 돌려준 캔버스는 변환·합성·알파를 처음 값으로 하고 통째로 지운다(SPEC 27·30)
 *   KCB15.Field(x0, y0, w, h, cell)    격자(cell px)에서 화소 값을 직접 셈 → 쌍선형 확대(bg.glow_field와 같은 방식 — 캔버스
 *                                      그라데이션은 캡처마다 ±1 흔들려 자가 시험을 못 넘음, SPEC 함정 1)
 *       .paint((x, y, out) => {...})   out = [r, g, b, a](0..255)를 채운다. x·y = 그 격자 점의 화면 px
 *       .draw(ctx, alpha)              화면에 붙임(격자 점이 x0 + i·cell 화소 가운데에 오게)
 *   KCB15.lin(v8)                      sRGB 8비트 → 선형 0..1(표)
 *   KCB15.enc(l)                       선형 0..1 → sRGB 0..255(정수, 표 4096칸)
 *   KCB15.spin(ctx, img, cx, cy, ang, alpha, opt)
 *                                      정사각 그림 img(내용은 안쪽 원 안)를 화면 (cx, cy)에 가운데를 맞춰 그리되, 그 가운데 둘레로 각도
 *                                      −ang/2 ~ +ang/2(라디안)를 고르게 평균(회전 번짐, 가운데 기준 — R13). '자기와 반 칸 돌린 자기의 평균'을
 *                                      n번 → 사본 2^n장 같은 무게, 바깥 끝(opt.r, 그림 px — 기본 반 변) 호 간격 ≤ 1px. float16 판 누적
 *                                      (v0.6.6 KC.halve — 무게 128/255 + 127/255, 평평한 곳은 값 그대로). opt: {r: 내용 바깥 반지름(그림 px), size: 그림 변(기본 img.width)}
 * 결정적: 시간·난수 없음. 같은 입력이면 같은 화소.
 */
(function () {
  "use strict";
  if (!window.KC) throw new Error("KCB15: kc.js를 먼저 읽기");
  const B = {};

  B.sprite = function (w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
    return { canvas: c, ctx: c.getContext("2d", { willReadFrequently: true }), w: c.width, h: c.height };
  };
  B.fit = function (c, w, h) {
    const W = Math.ceil(Math.max(1, w) / 128) * 128, H = Math.ceil(Math.max(1, h) / 128) * 128;
    if (!c || c.canvas.width < W || c.canvas.height < H) c = B.sprite(Math.max(W, c ? c.canvas.width : 0), Math.max(H, c ? c.canvas.height : 0));
    const x = c.ctx;
    KC.ctxReset(x);
    x.clearRect(0, 0, c.canvas.width, c.canvas.height);
    c.w = c.canvas.width; c.h = c.canvas.height;
    return c;
  };

  B.Field = function (x0, y0, w, h, cell) {
    const S = Math.max(1, Math.round(cell || 4));
    const GW = Math.floor((Math.max(1, w) - 1) / S) + 2, GH = Math.floor((Math.max(1, h) - 1) / S) + 2;
    const sp = B.sprite(GW, GH);
    const img = sp.ctx.createImageData(GW, GH);
    const out = [0, 0, 0, 255];
    return {
      GW, GH, S, canvas: sp.canvas,
      paint(fn) {
        const d = img.data;
        for (let gy = 0; gy < GH; gy++) {
          const y = y0 + gy * S;
          for (let gx = 0; gx < GW; gx++) {
            out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 255;
            fn(x0 + gx * S, y, out);
            const p = (gy * GW + gx) * 4;
            d[p] = out[0]; d[p + 1] = out[1]; d[p + 2] = out[2]; d[p + 3] = out[3];
          }
        }
        sp.ctx.putImageData(img, 0, 0);
      },
      draw(ctx, alpha) {
        ctx.save();
        ctx.globalAlpha *= alpha === undefined ? 1 : alpha;
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
        ctx.drawImage(sp.canvas, 0, 0, GW, GH, x0 - S / 2, y0 - S / 2, GW * S, GH * S);
        ctx.restore();
      },
    };
  };

  const LIN = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const v = i / 255; LIN[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  const ENC = new Uint8ClampedArray(4097);
  for (let i = 0; i <= 4096; i++) { const l = i / 4096; ENC[i] = Math.round(255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * Math.pow(l, 1 / 2.4) - 0.055)); }
  B.lin = (v) => LIN[v < 0 ? 0 : v > 255 ? 255 : v | 0];
  B.enc = (l) => ENC[l <= 0 ? 0 : l >= 1 ? 4096 : (l * 4096 + 0.5) | 0];

  B.spin = function (ctx, img, cx, cy, ang, alpha, opt) {
    const N = (opt && opt.size) || img.width, half = N / 2;
    const r = (opt && opt.r) || half;
    const ga = ctx.globalAlpha, al = alpha === undefined ? 1 : alpha;
    const m = ctx.getTransform(), k = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
    const arc = Math.abs(ang) * r * k;   // 바깥 끝 호 길이(화면 px)
    if (arc < 0.75) { ctx.globalAlpha = ga * al; ctx.drawImage(img, 0, 0, N, N, cx - half, cy - half, N, N); ctx.globalAlpha = ga; return; }
    const n = Math.min(12, Math.max(1, Math.ceil(Math.log2(arc + 1)))), K = Math.pow(2, n);
    // v0.6.6: 사본은 float16 판(KC.fbuf·KC.halve)에 더해 한 번만 8비트로(8비트 판은 단계마다 반올림이 쌓여 색이 틀어짐)
    const A0 = KC.fbuf("spin0", N, N), B0 = KC.fbuf("spin1", N, N);
    A0._ctx.drawImage(img, 0, 0, N, N, 0, 0, N, N);
    const A = KC.halve(A0, B0, N, N, n, (b, i) => {
      const d = ang * Math.pow(2, i) / (K - 1);
      b.translate(half, half); b.rotate(d); b.translate(-half, -half);
    });
    ctx.save();
    ctx.globalAlpha = ga * al;
    ctx.translate(cx, cy); ctx.rotate(-ang / 2); ctx.translate(-half, -half);
    ctx.drawImage(A, 0, 0, N, N, 0, 0, N, N);
    ctx.restore();
  };

  window.KCB15 = B;
})();
