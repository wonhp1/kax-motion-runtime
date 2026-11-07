/* KCB8 — 유리 2D·알림·스티커 부품이 같이 쓰는 도우미. kc.js(·typography/mixed_text.js) 뒤, 이 도우미를 쓰는 부품 .js 앞에 읽는다.
 *
 *   KCB8.cpu(w, h)                     화면 밖 CPU 캔버스(처음부터 willReadFrequently — 크롬이 첫 drawImage 뒤 그리기 방식을 바꾸지 않게).
 *                                      ._ctx 붙음. create에서 만들고 매 프레임 지우고 다시 그린다.
 *   KCB8.clear(ctx)                    변환·알파·합성·필터 되돌리고 지움
 *   KCB8.rr(ctx, x, y, w, h, r, keep)  왼쪽 위 기준 둥근 사각 경로(beginPath 포함 — keep=true면 이어 붙임). r은 짧은 변 반까지
 *   KCB8.src(spec, env)                뒤 배경 입력 → (f) => 캔버스|그림|null. spec: (ctx, f) => {} | <canvas>|<img> | "#색" | null
 *   KCB8.blurred(dst, srcCanvas, box, sigma, tmp)
 *                                      srcCanvas의 box[x0,y0,x1,y1](+여유 3σ) 부분을 CPU 캔버스 두 장으로 흐려 dst(CPU)에 같은 좌표로 그림.
 *                                      흐림을 GPU/주 캔버스 filter로 하지 않아 프레임마다 ±1 흔들림이 없다(앞 묶음 함정).
 *   KCB8.soft(ctx, box, sigma, alpha, drawFn, tmp)  drawFn으로 box 안에 그린 것을 CPU에서 흐려 ctx에 붙임(글자 흐림 등장·빛 테)
 *   KCB8.text(ctx, s, role, x, y, size, color, opt) KTypo가 있으면 역할로, 없으면 sans-serif → 폭. opt: {align, alpha}
 *   KCB8.textW(ctx, s, role, size)     글 폭만
 *   KCB8.glyph(ctx, name, cx, cy, size, color)  코드로 그린 채운 기호(스티커용, 이모지 아님): heart·star·spark·smile·bolt·check·flame·note·sun·thumb
 *   KCB8.outline(spr, draw, ow, color) 실루엣 둘레 테두리(16방향으로 찍고 source-in 색) 뒤에 그림 — 흰 테 스티커
 *   KCB8.ease(spec, N, env)            KC.curve + {"fn":"spring","args":[f_hz, zeta]}(초 단위 감쇠 스프링, 넘침 있음)
 * 결정적: 시간·난수 없음. 받은 값만으로 그린다. 서체 이름 없음(KTypo 역할).
 */
(function () {
  "use strict";
  if (!window.KC) throw new Error("KCB8: kc.js를 먼저 읽기");
  const B = {};
  const clamp = KC.clamp;

  B.cpu = function (w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
    c._ctx = c.getContext("2d", { willReadFrequently: true });
    return c;
  };
  B.clear = function (ctx) {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over"; ctx.filter = "none";
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  };
  B.rr = function (ctx, x, y, w, h, r, keep) {
    if (w < 0) { x += w; w = -w; }
    if (h < 0) { y += h; h = -h; }
    r = clamp(r, 0, Math.min(w, h) / 2);
    if (!keep) ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  B.src = function (spec, env) {
    if (!spec) return () => null;
    if (typeof spec === "function") {
      let cv = null;
      return function (f) {
        if (!cv) cv = B.cpu(env.width, env.height);
        const c = cv._ctx;
        B.clear(c);
        c.save(); spec(c, f); c.restore();
        return cv;
      };
    }
    if (typeof spec === "string" || Array.isArray(spec)) {
      let cv = null;
      return function () {
        if (!cv) { cv = B.cpu(env.width, env.height); cv._ctx.fillStyle = KC.rgba(spec); cv._ctx.fillRect(0, 0, cv.width, cv.height); }
        return cv;
      };
    }
    return () => spec;
  };

  // 흐림용 CPU 캔버스 두 장: 크기는 '지금 필요한 크기'를 128px 단위로 올린 값만으로 정한다(앞 프레임 기록과 무관).
  // 캔버스 크기가 기록 따라 달라지면 크롬 blur(큰 σ에서 줄여 흐림)가 화소를 조금 다르게 내 시크 지문이 어긋난다.
  function pair(tmp, w, h) {
    const k = Math.ceil(w / 128) * 128 + "x" + Math.ceil(h / 128) * 128;
    tmp._m = tmp._m || {};
    if (!tmp._m[k]) { const [cw, ch] = k.split("x").map(Number); tmp._m[k] = [B.cpu(cw, ch), B.cpu(cw, ch)]; }
    return tmp._m[k];
  }

  // src의 box 부분을 흐려 dst에 같은 좌표로(dst는 화면 크기 CPU 캔버스). tmp = {a, b} 재사용 CPU 캔버스(없으면 만듦)
  B.blurred = function (dst, src, box, sigma, tmp) {
    const m = Math.ceil(sigma * 3) + 2;
    const x0 = Math.floor(box[0]) - m, y0 = Math.floor(box[1]) - m, x1 = Math.ceil(box[2]) + m, y1 = Math.ceil(box[3]) + m;
    const w = x1 - x0, h = y1 - y0;
    if (w <= 0 || h <= 0) return;
    const P = pair(tmp, w, h), a = P[0]._ctx, b = P[1]._ctx;
    tmp.a = P[0]; tmp.b = P[1];
    B.clear(a); B.clear(b);
    a.drawImage(src, -x0, -y0);
    // 원천 사각만 흐림(캔버스가 앞 프레임 때문에 더 크게 남아 있어도 그 밖 내용이 섞이지 않게 — 시크 결정성)
    if (sigma > 0.05) { b.filter = `blur(${sigma.toFixed(2)}px)`; b.drawImage(tmp.a, 0, 0, w, h, 0, 0, w, h); b.filter = "none"; }
    else b.drawImage(tmp.a, 0, 0, w, h, 0, 0, w, h);
    dst._ctx.drawImage(tmp.b, 0, 0, w, h, x0, y0, w, h);
  };

  // drawFn(c)로 box[x0,y0,x1,y1] 안에 그린 것을 CPU에서 sigma만큼 흐려 ctx에 alpha로 붙임(화면 좌표 그대로).
  // sigma ≤ 0.05면 흐림 없이. ctx의 변환은 그대로 적용된다(붙이는 그림이 변환을 따라감).
  B.soft = function (ctx, box, sigma, alpha, drawFn, tmp) {
    if (!(alpha > 0.002)) return;
    const m = Math.ceil(Math.max(0, sigma) * 3) + 2;
    const x0 = Math.floor(box[0]) - m, y0 = Math.floor(box[1]) - m, w = Math.ceil(box[2]) + m - x0, h = Math.ceil(box[3]) + m - y0;
    if (w <= 0 || h <= 0) return;
    const P = pair(tmp, w, h), a = P[0]._ctx, b = P[1]._ctx;
    tmp.sa = P[0]; tmp.sb = P[1];
    B.clear(a); B.clear(b);
    a.save(); a.translate(-x0, -y0); drawFn(a); a.restore();
    let out = tmp.sa;
    if (sigma > 0.05) { b.filter = `blur(${sigma.toFixed(2)}px)`; b.drawImage(tmp.sa, 0, 0, w, h, 0, 0, w, h); b.filter = "none"; out = tmp.sb; }
    ctx.save(); ctx.globalAlpha *= Math.min(1, alpha);
    ctx.drawImage(out, 0, 0, w, h, x0, y0, w, h);
    ctx.restore();
  };

  B.text = function (ctx, s, role, x, y, size, color, opt) {
    opt = opt || {};
    ctx.save();
    if (color) ctx.fillStyle = typeof color === "string" ? color : KC.rgba(color);
    if (opt.alpha !== undefined) ctx.globalAlpha *= opt.alpha;
    let w;
    if (window.KTypo && KTypo.canvas) w = KTypo.canvas(ctx, s, role, x, y, size, { align: opt.align || "left" });
    else { ctx.font = `600 ${size}px sans-serif`; ctx.textAlign = opt.align || "left"; ctx.fillText(s, x, y); w = ctx.measureText(s).width; }
    ctx.restore();
    return w;
  };
  B.textW = function (ctx, s, role, size) {
    if (window.KTypo && KTypo.layout) { ctx.save(); const w = KTypo.layout(ctx, s, role, 0, 0, size, {}).width; ctx.restore(); return w; }
    ctx.save(); ctx.font = `600 ${size}px sans-serif`; const w = ctx.measureText(s).width; ctx.restore(); return w;
  };

  // 채운 기호(단위 상자 −0.5..0.5에 그리는 경로). 스티커·알림 아이콘용 코드 그림
  const G = {
    heart(c) { c.moveTo(0, 0.36); c.bezierCurveTo(-0.5, 0.02, -0.46, -0.42, -0.14, -0.4); c.bezierCurveTo(-0.04, -0.4, 0, -0.32, 0, -0.26); c.bezierCurveTo(0, -0.32, 0.04, -0.4, 0.14, -0.4); c.bezierCurveTo(0.46, -0.42, 0.5, 0.02, 0, 0.36); c.closePath(); },
    star(c) { for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.2 : 0.48; i ? c.lineTo(r * Math.cos(a), r * Math.sin(a) + 0.03) : c.moveTo(r * Math.cos(a), r * Math.sin(a) + 0.03); } c.closePath(); },
    spark(c) { c.moveTo(0, -0.48); c.quadraticCurveTo(0.05, -0.05, 0.48, 0); c.quadraticCurveTo(0.05, 0.05, 0, 0.48); c.quadraticCurveTo(-0.05, 0.05, -0.48, 0); c.quadraticCurveTo(-0.05, -0.05, 0, -0.48); c.closePath(); },
    smile(c) { c.arc(0, 0, 0.46, 0, Math.PI * 2); c.closePath(); },
    bolt(c) { c.moveTo(0.08, -0.48); c.lineTo(-0.3, 0.06); c.lineTo(-0.02, 0.06); c.lineTo(-0.1, 0.48); c.lineTo(0.3, -0.08); c.lineTo(0.02, -0.08); c.closePath(); },
    check(c) { c.arc(0, 0, 0.46, 0, Math.PI * 2); c.closePath(); },
    flame(c) { c.moveTo(0, -0.48); c.bezierCurveTo(0.12, -0.24, 0.4, -0.12, 0.36, 0.14); c.bezierCurveTo(0.34, 0.36, 0.18, 0.48, 0, 0.48); c.bezierCurveTo(-0.2, 0.48, -0.36, 0.34, -0.36, 0.12); c.bezierCurveTo(-0.36, -0.06, -0.22, -0.14, -0.18, -0.3); c.bezierCurveTo(-0.08, -0.2, -0.04, -0.12, -0.04, -0.06); c.bezierCurveTo(0.06, -0.2, 0.06, -0.36, 0, -0.48); c.closePath(); },
    note(c) { c.ellipse(-0.16, 0.28, 0.17, 0.13, -0.4, 0, Math.PI * 2); c.closePath(); c.rect(-0.03, -0.42, 0.09, 0.7); c.moveTo(0.06, -0.42); c.quadraticCurveTo(0.34, -0.36, 0.38, -0.12); c.quadraticCurveTo(0.26, -0.24, 0.06, -0.24); c.closePath(); },
    sun(c) { c.arc(0, 0, 0.24, 0, Math.PI * 2); c.closePath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, ca = Math.cos(a), sa = Math.sin(a), px = -sa * 0.05, py = ca * 0.05; c.moveTo(ca * 0.32 + px, sa * 0.32 + py); c.lineTo(ca * 0.48, sa * 0.48); c.lineTo(ca * 0.32 - px, sa * 0.32 - py); c.closePath(); } },
    thumb(c) { B.rr(c, -0.42, -0.04, 0.2, 0.46, 0.05); c.moveTo(-0.16, -0.02); c.lineTo(0.0, -0.3); c.quadraticCurveTo(0.06, -0.48, 0.14, -0.4); c.quadraticCurveTo(0.2, -0.32, 0.12, -0.12); c.lineTo(0.36, -0.12); c.quadraticCurveTo(0.46, -0.1, 0.42, 0.02); c.lineTo(0.32, 0.36); c.quadraticCurveTo(0.28, 0.44, 0.18, 0.44); c.lineTo(-0.16, 0.44); c.closePath(); },
  };
  // 기호 안쪽 무늬(얼굴·체크) — 진한 선
  const DETAIL = {
    smile(c, ink) { c.fillStyle = ink; c.beginPath(); c.ellipse(-0.15, -0.09, 0.05, 0.08, 0, 0, Math.PI * 2); c.ellipse(0.15, -0.09, 0.05, 0.08, 0, 0, Math.PI * 2); c.fill(); c.strokeStyle = ink; c.lineWidth = 0.06; c.lineCap = "round"; c.beginPath(); c.arc(0, 0.04, 0.22, 0.2 * Math.PI, 0.8 * Math.PI); c.stroke(); },
    check(c, ink) { c.strokeStyle = ink; c.lineWidth = 0.09; c.lineCap = "round"; c.lineJoin = "round"; c.beginPath(); c.moveTo(-0.2, 0.02); c.lineTo(-0.05, 0.17); c.lineTo(0.22, -0.14); c.stroke(); },
    flame(c, ink) { c.fillStyle = ink; c.beginPath(); c.moveTo(0, 0.1); c.bezierCurveTo(0.12, 0.2, 0.16, 0.3, 0.14, 0.36); c.bezierCurveTo(0.1, 0.44, -0.1, 0.44, -0.14, 0.36); c.bezierCurveTo(-0.16, 0.26, -0.08, 0.2, 0, 0.1); c.fill(); },
  };
  B.glyphNames = Object.keys(G);
  B.glyph = function (ctx, name, cx, cy, size, color, detail) {
    const g = G[name];
    if (!g) throw new Error("KCB8.glyph: 모르는 기호 " + name + " (" + Object.keys(G).join("·") + ")");
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(size, size);
    ctx.fillStyle = typeof color === "string" ? color : KC.rgba(color);
    ctx.beginPath(); g(ctx); ctx.fill("nonzero");
    if (DETAIL[name] && detail) DETAIL[name](ctx, detail);
    ctx.restore();
  };
  // spr(CPU 캔버스)에 draw(ctx)로 그린 모양 둘레에 ow px 테두리(색) — 16방향 찍기 + source-in
  B.outline = function (spr, draw, ow, color, tmp) {
    const c = spr._ctx;
    B.clear(c);
    if (ow > 0) {
      if (!tmp.o || tmp.o.width !== spr.width || tmp.o.height !== spr.height) tmp.o = B.cpu(spr.width, spr.height);
      const o = tmp.o._ctx;
      B.clear(o); draw(o);
      for (let k = 0; k < 16; k++) { const a = k * Math.PI / 8; c.drawImage(tmp.o, ow * Math.cos(a), ow * Math.sin(a)); }
      c.globalCompositeOperation = "source-in"; c.fillStyle = typeof color === "string" ? color : KC.rgba(color); c.fillRect(0, 0, spr.width, spr.height);
      c.globalCompositeOperation = "source-over";
      c.drawImage(tmp.o, 0, 0);
    } else draw(c);
  };

  // KC.curve + 스프링(초 단위). spec {fn:"spring", args:[f_hz, zeta]}
  B.spring = function (fhz, z) {
    const w = 2 * Math.PI * fhz;
    if (z < 1) { const wd = w * Math.sqrt(1 - z * z), k = (z * w) / wd; return (t) => (t <= 0 ? 0 : 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + k * Math.sin(wd * t))); }
    return (t) => (t <= 0 ? 0 : 1 - Math.exp(-w * t) * (1 + w * t));
  };
  B.ease = function (spec, N, env) {
    if (spec && spec.fn === "spring") {
      const fps = (env && env.fps) || 30000 / 1001, s = B.spring(spec.args[0], spec.args[1]);
      return (n) => s(n / fps);
    }
    return KC.curve(spec, N, env);
  };
  // 진행: f에서 at초 뒤 시작, dur초 동안 spec 곡선 → 0..1(스프링은 넘침)
  B.prog = function (spec, f, f0, at, dur, env) {
    const fps = env.fps, n = f - f0 - at * fps;
    if (n <= 0) return 0;
    const N = Math.max(1e-3, dur * fps);
    if (spec && spec.fn === "spring") return B.ease(spec, N, env)(n);
    return n >= N ? 1 : KC.curve(spec, N, env)(n);
  };

  window.KCB8 = B;
})();
