/* KCB2 — 글자 부품이 같이 쓰는 도우미(낱말 단위 조판 + 낱말 하나 그리기). kc.js·typography/mixed_text.js 뒤에 읽는다.
 *
 *   KCB2.layoutWords(ctx, text, role, x, y, size, opt) → {lines:[{words, y, width}], words:[...], box}
 *     text: "낱말 낱말\n둘째 줄" (공백 = 낱말 경계, \n = 줄 바꿈) 또는 opt.words = [["낱말", ...], ...]
 *     opt: {align: "center"|"left"|"right", line_height: ×size, gaps: {낱말번호: 더 벌릴 px}}  (gaps = 그 낱말 '앞'에 틈)
 *     word = {i, text, items(KTypo.layout 글자), x0, x1, top, bottom, cx, cy, base, line}
 *       x0·x1 = 글자 잉크 폭(앞뒤 자간 빼고), top·bottom = 대략 글자 위·아래(기준선 기준 0.78em 위, 0.2em 아래), cy = 한글 글자 상자 가운데
 *   KCB2.drawWord(ctx, word, st)  st: {dx, dy, scale, sx, sy, alpha, blur, smear:[px,py], smear_cap, smear_n, color, ox, oy}
 *     낱말 가운데(또는 ox,oy)를 기준으로 옮기고 키운 뒤 그린다. blur = 고른 흐림 px, smear = 한 방향 번짐(가운데 기준, 알파 = alpha).
 *     v0.6.7: 번짐은 낱말을 화면 밖 판에 한 번 그려 같은 무게로 평균(KC.smearFn → KC.smearLine, float16 판, 사본 간격 ≤ 화면 1px)한 뒤
 *     알파·blur를 실어 한 번 그림(예전 v0.6: 사본 ≥ 7장 덮어 그리기 — 꼬리까지 진한 돌출 그림자·계단). 길이 ≤ 낱말 짧은 변 × smear_cap
 *     (기본 0.5, 0 = 그 상한 없음 — R13, 화면 px로 셈), 그리고 v0.6.7부터 늘 ≤ 글자 높이(0.8em) × 0.25('바코드' 막기 — smear_n만 예외). smear_n을 주면 그 수의 끊긴 사본을 예전처럼 덮어 그림(의도한 잔상 — R13 예외일 때만).
 * 결정적: f를 모르고, 받은 값만으로 그린다. 서체는 KTypo 역할로만.
 */
(function () {
  "use strict";
  const KCB2 = window.KCB2 || {};

  KCB2.layoutWords = function (ctx, text, role, x, y, size, opt) {
    opt = opt || {};
    const lh = (opt.line_height || 1.05) * size;
    const lines = opt.words ? opt.words : String(text).split("\n").map((l) => l.split(/\s+/).filter(Boolean));
    const gaps = opt.gaps || {};
    const out = { lines: [], words: [] };
    let wi = 0;
    // 공백 하나 폭(역할 라틴 서체)
    const sp = KTypo.layout(ctx, " ", role, 0, 0, size, {}).items[0];
    const spW = sp ? sp.adv : size * 0.25;
    for (let li = 0; li < lines.length; li++) {
      const base = y + li * lh;
      const ws = [];
      let pen = 0;
      for (let k = 0; k < lines[li].length; k++) {
        const t = lines[li][k];
        if (k > 0) pen += spW;
        pen += gaps[wi] || 0;
        const L = KTypo.layout(ctx, t, role, pen, base, size, {});
        const its = L.items;
        const x0 = its.length ? its[0].x : pen;
        const x1 = pen + L.width;
        ws.push({ i: wi, text: t, items: its, x0, x1, pen0: pen, base, line: li });
        pen += L.width;
        wi++;
      }
      const width = pen;
      const off = opt.align === "left" ? 0 : opt.align === "right" ? -width : -width / 2;
      for (const w of ws) {
        const d = x + off;
        for (const it of w.items) { it.x += d; it.center = [it.center[0] + d, it.center[1]]; }
        w.x0 += d; w.x1 += d; w.pen0 += d;
        w.top = w.base - 0.78 * size; w.bottom = w.base + 0.2 * size;
        w.cx = (w.x0 + w.x1) / 2; w.cy = w.base - 0.355 * size;
        out.words.push(w);
      }
      out.lines.push({ words: ws, y: base, width, x0: x + off, x1: x + off + width });
    }
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const w of out.words) { bx0 = Math.min(bx0, w.x0); bx1 = Math.max(bx1, w.x1); by0 = Math.min(by0, w.top); by1 = Math.max(by1, w.bottom); }
    out.box = out.words.length ? [bx0, by0, bx1, by1] : null;
    return out;
  };

  function fillItems(ctx, items) {
    for (const it of items) {
      ctx.font = it.font;
      if ("fontStretch" in ctx) ctx.fontStretch = it.stretch;
      ctx.fillText(it.ch, it.x, it.y);
    }
  }
  KCB2.fillItems = fillItems;

  KCB2.drawWord = function (ctx, w, st) {
    const a = st.alpha === undefined ? 1 : st.alpha;
    if (a <= 0.003) return;
    const ox = st.ox === undefined ? w.cx : st.ox, oy = st.oy === undefined ? w.cy : st.oy;
    const s = st.scale === undefined ? 1 : st.scale;
    const sx = s * (st.sx === undefined ? 1 : st.sx), sy = s * (st.sy === undefined ? 1 : st.sy);
    ctx.save();
    ctx.textBaseline = "alphabetic";
    ctx.translate(ox + (st.dx || 0), oy + (st.dy || 0));
    ctx.scale(sx, sy);
    ctx.translate(-ox, -oy);
    ctx.fillStyle = st.color || "#000";
    const b = st.blur || 0;
    ctx.filter = b > 0.05 ? `blur(${b.toFixed(2)}px)` : "none";
    const sm = st.smear || [0, 0];
    const L = Math.hypot(sm[0], sm[1]);
    if (L > 0.5) {
      // R13: 길이 ≤ 낱말 짧은 변(잉크 폭·글자 높이 중 작은 쪽, 화면 px) × smear_cap(기본 0.5, 0이면 상한 없음) — 가운데 기준 그대로 줄임.
      // smear_n: 사본 수를 정해 주면 그 수(의도한 잔상처럼 끊긴 사본이 효과일 때 — R13 예외, 부품 README에 적음).
      const m = ctx.getTransform();
      let px = sm[0], py = sm[1];
      let Ld = Math.hypot(m.a * px + m.c * py, m.b * px + m.d * py);
      const cap = st.smear_cap === undefined ? 0.5 : st.smear_cap;
      if (cap > 0) {
        const lim = cap * Math.min(Math.max(1, w.x1 - w.x0) * Math.hypot(m.a, m.b), Math.max(1, w.bottom - w.top) * Math.hypot(m.c, m.d));
        if (Ld > lim) { const k = lim / Ld; px *= k; py *= k; Ld = lim; }
      }
      // v0.6.7 글자 기준 상한: 길이 ≤ 글자 높이(0.8em, 낱말 안 가장 큰 글자 px, 화면 px) × 0.25. 그보다 길면 번짐 방향 획이 옅어져
      //   가로지르는 획만 줄무늬('바코드')로 남는다(components/tools/v067_barcode). smear_n(의도한 잔상)은 그대로
      if (!st.smear_n) {
        let em = w.bottom - w.top;
        for (const it of w.items) if (it.px > em) em = it.px;
        const lim = 0.25 * 0.8 * em * Math.hypot(m.c, m.d);
        if (Ld > lim) { const k = lim / Ld; px *= k; py *= k; Ld = lim; }
      }
      if (st.smear_n) {
        // smear_n: 정한 수의 끊긴 사본을 덮어 그림(의도한 잔상 — R13 예외, 예전 그림 그대로)
        const K = Math.max(2, Math.round(st.smear_n));
        const ak = 1 - Math.pow(1 - Math.min(a, 0.999), 1 / K);
        ctx.globalAlpha = ak;
        for (let k = 0; k < K; k++) {
          const t = k / (K - 1) - 0.5;
          ctx.save(); ctx.translate(px * t, py * t); fillItems(ctx, w.items); ctx.restore();
        }
      } else {
        // v0.6.7: 낱말을 화면 밖 판에 한 번 그려 (px,py) 선분 위에 같은 무게로 평균(KC.smearFn → KC.smearLine, float16 판, 가운데 기준,
        //   사본 간격 ≤ 화면 1px) → 알파 a와 blur(filter)를 실어 한 번 그림. 예전: 사본 K장(≥ 7)을 알파 1−(1−a)^(1/K)로 덮어 그려
        //   겹친 곳마다 덮임이 1에 가깝게 차서(반만 겹쳐도 0.97) 꼬리까지 진한 돌출 그림자·계단처럼 보였다.
        let em = w.bottom - w.top;
        for (const it of w.items) if (it.px > em) em = it.px;
        const pad = 0.45 * em + 2;
        ctx.globalAlpha = 1;
        KC.smearFn(ctx, [w.x0 - pad, w.top - pad, w.x1 + pad, w.bottom + pad], px, py, a, (g) => {
          g.fillStyle = st.color || "#000"; g.textBaseline = "alphabetic"; fillItems(g, w.items);
        }, "b2word");
      }
    } else {
      ctx.globalAlpha = a;
      fillItems(ctx, w.items);
    }
    ctx.restore();
  };

  // 색 섞기 [r,g,b,a] → "rgba()"
  KCB2.mix = function (c0, c1, t) {
    const a = KC.color(c0), b = KC.color(c1);
    t = KC.clamp(t, 0, 1);
    return `rgba(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)},${(a[3] + (b[3] - a[3]) * t).toFixed(4)})`;
  };

  // 측정용 화면 밖 ctx(bounds가 그리기 전에 불려도 조판할 수 있게)
  let mctx = null;
  KCB2.measureCtx = function () {
    if (!mctx) { const c = document.createElement("canvas"); c.width = 8; c.height = 8; mctx = c.getContext("2d"); }
    return mctx;
  };

  window.KCB2 = KCB2;
})();
