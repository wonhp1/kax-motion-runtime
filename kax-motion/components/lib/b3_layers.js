/* KCB3 — 전환 부품이 같이 쓰는 도우미. kc.js 뒤, 전환 부품 .js 앞에 읽는다.
 *
 *   KCB3.painter(src)          장면 원천 → (ctx, f) 그리기 함수. src 꼴:
 *                                (ctx, f) => {...}  그리기 함수(가장 흔함 — 앞 장면·뒤 장면)
 *                                KC canvas2d 인스턴스  (KC.make 결과, span 안에서만 그림)
 *                                <canvas>·<img>     그대로 (0,0)에 붙임
 *                                "#rrggbb"·[r,g,b]  단색 면
 *                                null               없음
 *   KCB3.layer(src, env)       원천을 자기 캔버스(env 크기)에 그리는 층 → {canvas, at(f)}. at(f)는 부를 때마다 새로 그린다
 *                              (같은 f 캐시 없음 — 서체 로드 뒤 다시 그리는 경우가 있어 캐시가 틀린 그림을 남김).
 *   KCB3.Accum(W, H)           정확한 평균(Float32, 곱한 알파) — 모션 블러·줌 통과 사본 평균용.
 *                              begin() → add(canvas, w) × n → end(ctx, {chroma: [dx, dy], box}) (w 합 = 1)
 *                              8비트 캔버스에 알파 1/(j+1)로 쌓으면 표본 32개 넘어 뒤 표본이 반올림으로 사라지는 계단
 *                              이 생긴다 → 화소를 Float32로 더해 계단이 없다.
 *   KCB3.samples(dispPx, max)  한 프레임 셔터 동안 가장 크게 움직인 px → 표본 수(1.5px마다 하나, 최대 max)
 *   KCB3.smearDraw(ctx, src, x, y, dx, dy, alpha, o)  v0.6: 층 하나를 (dx,dy) 선분 위에 고르게 평균해 그림(가운데 기준, 사본 간격 ≤ 1px — R13)
 *                                v0.6.6: float16 판 누적(KC.smearLine), o.max = 길이 상한(글자 층은 가장 작은 글자 높이 × 0.25 권장)
 *   KCB3.clear(ctx)            변환·알파·합성·필터를 되돌리고 지움
 * 결정적: 시간·난수 없음. 같은 입력이면 같은 화소.
 */
(function () {
  "use strict";
  if (!window.KC) throw new Error("KCB3: kc.js를 먼저 읽기");
  const B = {};
  const clamp = KC.clamp;

  B.canvas = function (W, H, read) {
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    c._ctx = c.getContext("2d", read ? { willReadFrequently: true } : undefined);
    return c;
  };
  B.clear = function (ctx) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over"; ctx.filter = "none";
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  };

  B.painter = function (src) {
    if (src === null || src === undefined || src === false) return null;
    if (typeof src === "function") return src;
    if (src && typeof src.draw === "function" && src.renderer === "canvas2d") return (ctx, f) => { if (KC.inSpan(src, f)) src.draw(ctx, f); };
    if (src && (src.tagName === "CANVAS" || src.tagName === "IMG")) return (ctx) => ctx.drawImage(src, 0, 0);
    if (typeof src === "string" || Array.isArray(src)) {
      const c = KC.rgba(src);
      return (ctx) => { ctx.fillStyle = c; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height); };
    }
    throw new Error("KCB3.painter: 장면 원천은 (ctx,f) 함수·KC canvas2d 인스턴스·canvas·img·색 중 하나");
  };

  B.layer = function (src, env, read) {
    const p = B.painter(src);
    if (!p) return null;
    const cv = B.canvas(env.width, env.height, read), cx = cv._ctx;
    return {
      canvas: cv, ctx: cx,
      at(f) { B.clear(cx); cx.save(); p(cx, f); cx.restore(); return cv; },
    };
  };

  B.samples = (disp, max) => Math.max(1, Math.min(max || 32, Math.ceil(disp / 1.5)));

  /* v0.6 KCB3.smearDraw(ctx, src, x, y, dx, dy, alpha, o) — src(캔버스·그림)를 (x, y)에 그리되 (dx,dy) 선분 위에 고르게 평균(상자 흐림,
     가운데 기준 −½ ~ +½). '자기와 반 칸 밀린 자기의 평균'을 n번 되풀이 → 사본 2^n장 같은 무게, 간격 = 화면 길이/(2^n − 1) ≤ 1px
     (R13 E5 — 계단·좁은 무늬 결 없음). 표본 수와 상관없이 한 장면 층에 drawImage 2n번(n ≤ 12) — 화면 전체 층도 가볍다.
     v0.6.6: 셈은 KC.smearLine(kc.js) — 사본을 float16 판에 더하고 한 번만 8비트로 내림(예전 8비트 판은 반올림이 단계마다 쌓여
       색이 틀어지고, 긴 세로 번짐에서 한글 가로획이 지워져 줄무늬가 됐다). KCB6.smearImage와 같은 셈.
     길이 상한은 부르는 쪽이 정한다(화면 전체 전환은 R13 예외). 글자가 실린 층을 길게 번질 때는 o.max로 자른다 —
       권장 = 그 층에서 가장 작은 글자 높이 × 0.25(ex-101: 그보다 길면 float 판에서도 가로획이 옅어져 세로획만 줄무늬처럼 남음).
     o: {size: [w, h](src에서 쓸 왼쪽 위 크기, 기본 전체), max: 길이 상한(src px, 가운데 기준 그대로 줄임 — 기본 없음)} */
  B.smearDraw = function (ctx, src, x, y, dx, dy, alpha, o) {
    const iw = o && o.size ? o.size[0] : src.width, ih = o && o.size ? o.size[1] : src.height;
    const mx = o && o.max > 0 ? o.max : 0, L = Math.hypot(dx, dy);
    if (mx && L > mx) { const k = mx / L; dx *= k; dy *= k; }
    KC.smearLine(ctx, src, iw, ih, x, y, dx, dy, alpha);
  };

  // 정확한 평균
  B.Accum = function (W, H) {
    const acc = new Float32Array(W * H * 4);
    const out = B.canvas(W, H, true);
    let x0 = 0, y0 = 0, x1 = W, y1 = H;
    return {
      begin(box) {
        if (box) { x0 = Math.max(0, Math.floor(box[0])); y0 = Math.max(0, Math.floor(box[1])); x1 = Math.min(W, Math.ceil(box[2])); y1 = Math.min(H, Math.ceil(box[3])); }
        else { x0 = 0; y0 = 0; x1 = W; y1 = H; }
        acc.fill(0);
      },
      add(cv, w) {
        const bw = x1 - x0, bh = y1 - y0;
        if (bw <= 0 || bh <= 0) return;
        const px = cv.getContext("2d", { willReadFrequently: true }).getImageData(x0, y0, bw, bh).data;
        for (let yy = 0; yy < bh; yy++) {
          let i = yy * bw * 4, j = ((y0 + yy) * W + x0) * 4;
          for (let xx = 0; xx < bw; xx++, i += 4, j += 4) {
            const a = px[i + 3];
            if (a === 0) continue;
            const aw = a * w;
            acc[j] += px[i] * aw; acc[j + 1] += px[i + 1] * aw; acc[j + 2] += px[i + 2] * aw; acc[j + 3] += aw;
          }
        }
      },
      // ctx 위에 평균을 source-over로 얹는다. chroma [dx,dy]: R을 +d, B를 −d 자리에서 가져옴(색 갈라짐)
      // radial {c, k}: 화소마다 d = (p − c)·k (방사 색 갈라짐 — 줌 통과)
      end(ctx, o) {
        o = o || {};
        const bw = x1 - x0, bh = y1 - y0;
        if (bw <= 0 || bh <= 0) return;
        const oc = out._ctx;
        const im = oc.createImageData(bw, bh), d = im.data;
        const cd0 = o.chroma ? [Math.round(o.chroma[0]), Math.round(o.chroma[1])] : null;
        const rad = o.radial || null; // {c: [x,y], k}: 가운데에서 멀수록 R은 바깥, B는 안쪽(방사 색 갈라짐)
        let cd = cd0;
        for (let yy = 0; yy < bh; yy++) {
          for (let xx = 0; xx < bw; xx++) {
            const i = (yy * bw + xx) * 4, j = ((y0 + yy) * W + x0 + xx) * 4;
            if (rad) cd = [Math.round((x0 + xx - rad.c[0]) * rad.k), Math.round((y0 + yy - rad.c[1]) * rad.k)];
            if (!cd || (cd[0] === 0 && cd[1] === 0)) {
              const a = acc[j + 3];
              if (a <= 0) continue;
              d[i] = acc[j] / a; d[i + 1] = acc[j + 1] / a; d[i + 2] = acc[j + 2] / a; d[i + 3] = a;
            } else {
              // 화면 밖 자리는 가장자리 화소로(테두리에 색 줄이 생기지 않게). 채널마다 제 자리 알파로 나눠 색을 되돌린다
              // — 불투명한 그림(전환 장면)에서 정확하다. 반투명 가장자리는 알파를 가운데(G) 것으로 쓴다.
              const xr = clamp(x0 + xx - cd[0], 0, W - 1), yr = clamp(y0 + yy - cd[1], 0, H - 1);
              const xb = clamp(x0 + xx + cd[0], 0, W - 1), yb = clamp(y0 + yy + cd[1], 0, H - 1);
              const jr = (yr * W + xr) * 4, jb = (yb * W + xb) * 4;
              const ar = acc[jr + 3], ag = acc[j + 3], ab = acc[jb + 3];
              if (ag <= 0) continue;
              d[i] = ar > 0 ? acc[jr] / ar : 0; d[i + 1] = acc[j + 1] / ag; d[i + 2] = ab > 0 ? acc[jb + 2] / ab : 0; d[i + 3] = ag;
            }
          }
        }
        oc.clearRect(0, 0, W, H);
        oc.putImageData(im, 0, 0);
        ctx.drawImage(out, 0, 0, bw, bh, x0, y0, bw, bh);
      },
    };
  };

  window.KCB3 = B;
})();
