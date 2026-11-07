/* KX 렌더러 — 글자 단위 키네틱 타이틀용 캔버스 2D 엔진(kx 엔진).
   - 글자 = window.KG[inst][ch].d (engine/glyphs.py가 만든 em 윤곽) → Path2D. 서체 파일을 브라우저가 읽지 않는다.
   - 항목(item) = {inst, ch, size(px), skew(가짜 이탤릭), pen:[x,y](정착 위치, 기준선), fill}
   - 제목(title) = {z, items, motions:[{from,to,fn,hold}], clip(F,i)?, until?}
       fn(F, i) → {T:[a,b,c,d,e,f] 화면 상대 변환, a: 불투명도} | null(숨김)
       최종 행렬 = motions[n-1].T ∘ … ∘ motions[0].T ∘ 정착(펜 이동)
   - 렌더 순서: 바탕 단색 → z 오름차순 층 → (선택) 서브프레임 모션 블러 → 화면 전체 부드럽게(σ blur px).
   시크 안전: render(F)는 F만 보고 그린다(시간·난수 없음). F는 소수도 됨(서브프레임).

   모션 블러 모양(R13 움직임 번짐 모양):
     KX.init({motionBlur: {samples, shutter: 0.5, center: "space", cap: 0.5, gap: 0}})
       center "space"(기본) 표본을 가장 빠른 글자 묶음의 '지나간 길'을 따라 고른 간격으로, F 자리 앞뒤로 반씩(움직임 방향 가운데 기준)
              "time"        시각 방식: 시각으로 고르게 F−shutter/2 ~ F+shutter/2(시각 가운데 — 빨라지거나 느려지는 움직임에서는
                            한쪽이 길고 다른 쪽에 표본이 몰려 진한 꼬리가 됨)
       cap    번짐 길이 ≤ cap × 그 묶음(같은 변환으로 움직이는 글자들)의 화면 위 짧은 변(잉크 상자, R13). 0이면 상한 없음
              + 동작 객체의 blurCap(그 제목 글자): 번짐 길이 ≤ blurCap × 그 묶음에서 가장 낮은 글자의 잉크 높이(R10 '글자 높이의 25%' —
                KXP.bounceWords 기본 0.25). 둘 다 있으면 작은 쪽
       gap    > 0이고 KX.mbSamples가 없으면 표본 수를 스스로: 번짐 길이 ÷ gap(px) + 1(최대 64) — E5 '사본 간격 2px 이하'
     {center: "time", cap: 0}이면 상한 없는 시각 방식 그대로. KX.sampleTimes(F, n) → 그 프레임 표본 시각,
     KX.inkBox(it) → 글자 잉크 상자(글자 기준 px), KX._blur → 마지막 프레임 번짐 정보(측정용). */
(function () {
  "use strict";
  const KX = {};
  const MB_DEF = { samples: 0, shutter: 0.5, center: "space", cap: 0.5, gap: 0 };
  let W = 1920, H = 1080, BG = "rgb(11,0,16)", BLUR = 0.6, MB = Object.assign({}, MB_DEF);
  let out, octx, cv, ctx, acc, actx;
  const layers = [];
  const pathCache = {};

  KX.init = function (opt) {
    opt = opt || {};
    W = opt.W || W; H = opt.H || H;
    if (opt.bg) BG = opt.bg;
    if (opt.blur !== undefined) BLUR = opt.blur;
    if (opt.motionBlur) MB = Object.assign({}, MB_DEF, opt.motionBlur);
    if (MB.center !== "space" && MB.center !== "time") throw new Error("KX.init motionBlur.center는 \"space\" | \"time\" — " + MB.center);
    out = opt.canvas || document.getElementById("cv");
    out.width = W; out.height = H;
    octx = out.getContext("2d");
    cv = document.createElement("canvas"); cv.width = W; cv.height = H; ctx = cv.getContext("2d");
    acc = document.createElement("canvas"); acc.width = W; acc.height = H; actx = acc.getContext("2d");
    return KX;
  };

  // ---------- 글자 윤곽 ----------
  function glyph(inst, ch) {
    const g = (window.KG || {})[inst];
    if (!g || !g[ch]) throw new Error(`KG에 글자 없음: ${inst} '${ch}' — glyphs.py spec에 넣을 것`);
    return g[ch];
  }
  function emPath(inst, ch) {
    const k = inst + "|" + ch;
    if (!pathCache[k]) pathCache[k] = new Path2D(glyph(inst, ch).d);
    return pathCache[k];
  }
  function itemPath(it) {
    if (!it._p) {
      const p = new Path2D();
      p.addPath(emPath(it.inst, it.ch), new DOMMatrix([it.size, 0, -(it.skew || 0) * it.size, it.size, 0, 0]));
      it._p = p;
    }
    return it._p;
  }
  KX.adv = (inst, ch) => glyph(inst, ch).adv;
  // 글자 윤곽(SVG 경로 글, glyphs.py는 절대 좌표 M·L·H·V·Q·C·Z) → 잉크 상자 [x0, y0, x1, y1](em, 조절점 포함이라 아주 조금 넉넉)
  function pathBox(d) {
    const tok = String(d || "").match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || [];
    const N = { M: 2, L: 2, T: 2, H: 1, V: 1, S: 4, Q: 4, C: 6, A: 7, Z: 0 };
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, cx = 0, cy = 0, sx = 0, sy = 0, cmd = "M", k = 0;
    const add = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
    while (k < tok.length) {
      if (/[A-Za-z]/.test(tok[k])) { cmd = tok[k++]; if (cmd === "Z" || cmd === "z") { cx = sx; cy = sy; } continue; }
      const C = cmd.toUpperCase(), rel = cmd !== C, n = N[C];
      if (!n) { k++; continue; }
      const v = tok.slice(k, k + n).map(Number); k += n;
      if (v.length < n) break;
      const ox = rel ? cx : 0, oy = rel ? cy : 0;
      if (C === "H") { cx = v[0] + ox; add(cx, cy); }
      else if (C === "V") { cy = v[0] + oy; add(cx, cy); }
      else if (C === "A") { cx = v[5] + ox; cy = v[6] + oy; add(cx, cy); }
      else { for (let j = 0; j < n; j += 2) add(v[j] + ox, v[j + 1] + oy); cx = v[n - 2] + ox; cy = v[n - 1] + oy; }
      if (C === "M") { sx = cx; sy = cy; cmd = rel ? "l" : "L"; }   // M 뒤에 이어 오는 숫자는 L
    }
    return isFinite(x0) ? [x0, y0, x1, y1] : null;
  }
  KX.glyphBox = (inst, ch) => { const g = glyph(inst, ch); if (g._box === undefined) g._box = pathBox(g.d); return g._box; };
  // 항목 잉크 상자(글자 기준 px — 펜이 원점, y 아래로 +, 가짜 이탤릭 밀림 포함). 윤곽이 없는 글자(공백)는 advance × 0.7em
  KX.inkBox = function (it) {
    if (!it._box) {
      const b = KX.glyphBox(it.inst, it.ch) || [0, -0.7, (it.adv || it.size * 0.6) / it.size, 0];
      const s = it.size, k = -(it.skew || 0) * s;
      const xs = [b[0] * s + k * b[1], b[2] * s + k * b[1], b[0] * s + k * b[3], b[2] * s + k * b[3]];
      it._box = [Math.min(...xs), b[1] * s, Math.max(...xs), b[3] * s];
    }
    return it._box;
  };
  // 인스턴스 이름(glyphs.py와 같은 규칙: 축 태그 알파벳 순, 숫자는 그대로) — KX.inst("BS", {wght: 700, opsz: 72}) → "BS_opsz72_wght700"
  KX.inst = (key, axes) => key + Object.keys(axes || {}).sort().map((k) => "_" + k + axes[k]).join("");

  /* 단어 배치: 글자 항목 배열을 돌려준다.
     opt: {tracking: em(글자 사이 더할 간격), align: "left"|"center"|"right", skew, fill, idPrefix} */
  KX.layoutWord = function (inst, text, size, x, y, opt) {
    opt = opt || {};
    const tr = opt.tracking || 0;
    const chars = Array.from(text);
    let w = 0;
    const advs = chars.map((c) => KX.adv(inst, c) * size);
    w = advs.reduce((s, a) => s + a, 0) + tr * size * (chars.length - 1);
    let px = x - (opt.align === "center" ? w / 2 : opt.align === "right" ? w : 0);
    const items = [];
    chars.forEach((c, k) => {
      if (c !== " ") items.push({ id: (opt.idPrefix || "") + k, inst, ch: c, size, skew: opt.skew || 0, pen: [px, y], fill: opt.fill || null, adv: advs[k] });
      px += advs[k] + tr * size;
    });
    items.width = w;
    return items;
  };

  /* 단어 그라데이션(글자에 붙어 함께 움직임): 정착 상태 단어 상자 기준.
     g = {dir: "v"|"h"|deg(숫자), stops: [[t,[r,g,b]],...] 또는 [[r,g,b],[r,g,b]], top?, bottom?} */
  KX.wordFill = function (items, g) {
    const xs = items.flatMap((it) => [it.pen[0], it.pen[0] + (it.adv || it.size * 0.6)]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const y1 = Math.max(...items.map((it) => it.pen[1]));
    const cap = g.cap || 0.72;
    const y0 = y1 - Math.max(...items.map((it) => it.size)) * cap;
    const stops = g.stops.map((s, k, a) => (Array.isArray(s[1]) ? s : [a.length === 1 ? 0 : k / (a.length - 1), s]));
    let P0, P1;
    if (g.dir === "h") { P0 = [x0, 0]; P1 = [x1, 0]; }
    else if (typeof g.dir === "number") {
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, r = Math.hypot(x1 - x0, y1 - y0) / 2, a = (g.dir * Math.PI) / 180;
      P0 = [cx - Math.cos(a) * r, cy - Math.sin(a) * r]; P1 = [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    } else { P0 = [0, y0]; P1 = [0, y1]; }
    for (const it of items) {
      // 항목 경로 좌표 = 화면(정착) − 펜 (가짜 이탤릭 밀림은 무시해도 눈에 차이 없음)
      it.fill = { type: "lin", p0: [P0[0] - it.pen[0], P0[1] - it.pen[1]], p1: [P1[0] - it.pen[0], P1[1] - it.pen[1]], stops };
      if (g.dir === "v" || g.dir === undefined) { it.fill.p0[0] = 0; it.fill.p1[0] = 0; }
    }
    return items;
  };

  const rgb = (c) => (typeof c === "string" ? c : `rgb(${c[0]},${c[1]},${c[2]})`);
  function fillOf(c, it) {
    const f = it.fill;
    if (!f) return "#fff";
    if (f.type === "solid") return rgb(f.c);
    if (typeof f === "string" || Array.isArray(f)) return rgb(f);
    const g = c.createLinearGradient(f.p0[0], f.p0[1], f.p1[0], f.p1[1]);
    for (const s of f.stops) g.addColorStop(Math.max(0, Math.min(1, s[0])), rgb(s[1]));
    return g;
  }

  // ---------- 자르기(반평면) ----------
  // hps = [[nx,ny,d],...]: nx*x+ny*y <= d 쪽이 보임. 사각형은 KX.rect(x0,y0,x1,y1).
  KX.rect = (x0, y0, x1, y1) => [[-1, 0, -x0], [1, 0, x1], [0, -1, -y0], [0, 1, y1]];
  KX.below = (y) => [[0, -1, -y]];   // y보다 아래(큰 y)만 보임
  KX.above = (y) => [[0, 1, y]];     // y보다 위(작은 y)만 보임 — 기준선 마스크 리빌
  KX.leftOf = (x) => [[1, 0, x]];
  KX.rightOf = (x) => [[-1, 0, -x]];
  function clipPoly(hps) {
    let P = [[-4, -4], [W + 4, -4], [W + 4, H + 4], [-4, H + 4]];
    for (const [nx, ny, d] of hps) {
      const Q = [];
      for (let i = 0; i < P.length; i++) {
        const a = P[i], b = P[(i + 1) % P.length];
        const sa = nx * a[0] + ny * a[1] - d, sb = nx * b[0] + ny * b[1] - d;
        if (sa <= 0) Q.push(a);
        if ((sa <= 0) !== (sb <= 0)) { const t = sa / (sa - sb); Q.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
      }
      P = Q;
      if (!P.length) break;
    }
    return P;
  }
  function applyClip(c, hps) {
    if (!hps || !hps.length) return true;
    const P = clipPoly(hps);
    if (P.length < 3) return false;
    c.beginPath(); c.moveTo(P[0][0], P[0][1]);
    for (let k = 1; k < P.length; k++) c.lineTo(P[k][0], P[k][1]);
    c.closePath(); c.clip();
    return true;
  }

  // ---------- 행렬 ----------
  const mul = (A, B) => [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3], A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
  KX.mul = mul;

  function itemState(t, F, i) {
    const it = t.items[i];
    let M = [1, 0, 0, 1, it.pen[0], it.pen[1]], al = 1, any = false;
    for (const m of t.motions || []) {
      const on = F >= m.from - 1e-6 && (F <= m.to + 1e-6 || m.hold);
      if (!on) { if (m.entry && F < m.from) return null; continue; }
      const r = m.fn(Math.min(F, m.hold ? Infinity : m.to), i, it);
      if (r === null) return null;
      M = mul(r.T, M); al *= r.a === undefined ? 1 : r.a; any = true;
    }
    if (t.until !== undefined && F > t.until + 1e-6) return null;
    return { M, a: al, any };
  }
  function drawTitle(c, t, F) {
    if (t.from !== undefined && F < t.from - 1e-6) return;
    if (t.until !== undefined && F > t.until + 1e-6) return;
    if (t.under) t.under(c, F);
    for (let i = 0; i < t.items.length; i++) {
      const s = itemState(t, F, i);
      if (!s || s.a <= 0.002) continue;
      c.save();
      const hp = t.clip ? t.clip(F, i, t.items[i]) : null;
      if (hp === false || !applyClip(c, hp)) { c.restore(); continue; }
      c.setTransform(...s.M);
      c.globalAlpha = Math.min(1, s.a);
      c.fillStyle = t.fillAt ? t.fillAt(F, i, c) : fillOf(c, t.items[i]);
      c.fill(itemPath(t.items[i]));
      c.restore();
    }
    if (t.over) t.over(c, F);
  }

  KX.title = function (t) {
    t.z = t.z || 0; t.motions = t.motions || [];
    for (const m of t.motions) if (m.bind) m.bind(t.items);   // 프리셋 동작에 글자 목록 묶기(스태거·기준점)
    layers.push({ z: t.z, fn: (c, F) => drawTitle(c, t, F), t }); return t; };
  /* F 둘레(±shutter/2) 글자 모서리 이동 최댓값(px) — 모션 블러 표본 수 정하기용. 도형 층은 KX.speedHints(F)로 더함 */
  KX.speedAt = function (F, sh) {
    sh = sh === undefined ? MB.shutter : sh;
    let mx = 0;
    for (const L of layers) {
      const t = L.t; if (!t) continue;
      if (t.from !== undefined && F < t.from - 1) continue;
      if (t.until !== undefined && F > t.until + 1) continue;
      for (let i = 0; i < t.items.length; i++) {
        const a = itemState(t, F - sh / 2, i), b = itemState(t, F + sh / 2, i);
        if (!a || !b) continue;
        const it = t.items[i], w = it.adv || it.size * 0.6, h = it.size * 0.75;
        for (const [px, py] of [[0, 0], [w, 0], [0, -h], [w, -h]]) {
          const ax = a.M[0] * px + a.M[2] * py + a.M[4], ay = a.M[1] * px + a.M[3] * py + a.M[5];
          const bx = b.M[0] * px + b.M[2] * py + b.M[4], by = b.M[1] * px + b.M[3] * py + b.M[5];
          mx = Math.max(mx, Math.hypot(bx - ax, by - ay));
        }
      }
    }
    if (KX.speedHints) mx = Math.max(mx, KX.speedHints(F) * sh);
    return mx / sh;   // px/프레임
  };

  /* ---------- 모션 블러 표본 시각(R13 움직임 번짐 모양) ----------
     묶음 = 한 제목 안에서 같은 '움직임 변환'(정착 펜 이동을 뺀 행렬)으로 움직이는 글자들(낱말 묶음 동작이면 낱말 하나, 글자 단위면 글자 하나).
     묶음마다 빠르기 v(px/프레임, 잉크 상자 모서리 최대 이동)와 허용 길이 C = min(MB.cap × 화면 위 짧은 변, blurCap × 가장 낮은 글자 잉크 높이)를 재고,
       상한: 시각 폭 shEff = min(shutter, C / v)
       space: 가장 빠른 묶음의 가장 많이 움직이는 모서리가 지나간 길(호 길이)을 따라 F 자리 앞뒤로 반씩, 고른 간격으로 표본 시각을 고름.
              앞이나 뒤 한쪽이 짧으면(착지·출발·숨은 구간) 다른 쪽도 같은 길이로 줄여 늘 가운데 기준.
       time : 시각 방식 F − shEff·n/(tot−1) + shEff/2 (shEff = shutter면 상한 없는 시각 방식과 화소 같음) */
  const lastF = () => (KX.lastFrame === undefined ? 1e9 : KX.lastFrame);
  const clampF = (t) => Math.max(0, Math.min(lastF(), t));
  const relM = (M, it) => [M[0], M[1], M[2], M[3], M[4] - (M[0] * it.pen[0] + M[2] * it.pen[1]), M[5] - (M[1] * it.pen[0] + M[3] * it.pen[1])];
  const apply = (M, p) => [M[0] * p[0] + M[2] * p[1] + M[4], M[1] * p[0] + M[3] * p[1] + M[5]];
  function glyphCapOf(t) {   // 동작 객체 blurCap(R10 — 글자 높이 기준) 가운데 가장 작은 것
    let c = Infinity;
    for (const m of t.motions || []) if (m.blurCap > 0) c = Math.min(c, m.blurCap);
    return c;
  }
  const anyMotionCap = () => layers.some((L) => L.t && (L.t.motions || []).some((m) => m.blurCap > 0));
  // F 둘레(±sh/2) 움직이는 묶음들
  function groupsAt(F, sh) {
    const out = [];
    layers.forEach((L, li) => {
      const t = L.t; if (!t) return;
      if (t.from !== undefined && F < t.from - 1) return;
      if (t.until !== undefined && F > t.until + 1) return;
      const gcap = glyphCapOf(t), byKey = {};
      for (let i = 0; i < t.items.length; i++) {
        const a = itemState(t, F - sh / 2, i), b = itemState(t, F + sh / 2, i);
        if (!a || !b) continue;
        const it = t.items[i], bx = KX.inkBox(it);
        let best = 0, corner = null;
        for (const p of [[bx[0], bx[1]], [bx[2], bx[1]], [bx[0], bx[3]], [bx[2], bx[3]]]) {
          const pa = apply(a.M, p), pb = apply(b.M, p), d = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
          if (d > best) { best = d; corner = p; }
        }
        if (best < 0.05) continue;   // 거의 안 움직임
        const key = relM(a.M, it).concat(relM(b.M, it)).map((v) => Math.round(v * 1e4)).join(",");
        let g = byKey[key];
        if (!g) { g = byKey[key] = { t, li, gcap, items: [], speed: 0, ref: null, corner: null, box: [Infinity, Infinity, -Infinity, -Infinity], minH: Infinity, M: a.M }; out.push(g); }
        g.items.push(i);
        g.minH = Math.min(g.minH, bx[3] - bx[1]);
        if (best / sh > g.speed) { g.speed = best / sh; g.ref = i; g.corner = corner; }
        const q = [bx[0] + it.pen[0], bx[1] + it.pen[1], bx[2] + it.pen[0], bx[3] + it.pen[1]];   // 정착 자리 기준 합친 상자
        g.box = [Math.min(g.box[0], q[0]), Math.min(g.box[1], q[1]), Math.max(g.box[2], q[2]), Math.max(g.box[3], q[3])];
      }
    });
    for (const g of out) {
      const s = itemState(g.t, F, g.ref), M = s ? s.M : g.M, sy = Math.hypot(M[2], M[3]);
      g.short = Math.min((g.box[2] - g.box[0]) * Math.hypot(M[0], M[1]), (g.box[3] - g.box[1]) * sy);
      g.capLen = Math.min(MB.cap > 0 ? MB.cap * g.short : Infinity, isFinite(g.gcap) ? g.gcap * g.minH * sy : Infinity);   // 허용 번짐 길이(px)
    }
    return out;
  }
  // 묶음의 tA~tB 사이 번짐 길이(모든 글자 모서리 이동 최댓값, px)
  function smearOf(g, tA, tB) {
    let mx = 0;
    for (const i of g.items) {
      const a = itemState(g.t, clampF(tA), i), b = itemState(g.t, clampF(tB), i);
      if (!a || !b) continue;
      const bx = KX.inkBox(g.t.items[i]);
      for (const p of [[bx[0], bx[1]], [bx[2], bx[1]], [bx[0], bx[3]], [bx[2], bx[3]]]) {
        const pa = apply(a.M, p), pb = apply(b.M, p); mx = Math.max(mx, Math.hypot(pb[0] - pa[0], pb[1] - pa[1]));
      }
    }
    return mx;
  }
  // 프레임 F의 번짐 모양(표본 수와 상관없는 부분)
  function blurGeom(F) {
    const sh = MB.shutter, geo = { F, mode: "time", sh, shEff: sh, half: 0, L: 0, groups: [], ref: null };
    const capOn = MB.cap > 0 || anyMotionCap();
    if (MB.center === "time" && !capOn) return geo;          // 시각 방식 그대로(묶음을 재지 않음)
    const gs = groupsAt(F, sh);
    geo.groups = gs;
    let ref = null, hint = KX.speedHints ? KX.speedHints(F) : 0;
    for (const g of gs) {
      if (isFinite(g.capLen)) geo.shEff = Math.min(geo.shEff, g.capLen / g.speed);
      if (!ref || g.speed > ref.speed) ref = g;
    }
    geo.L = ref ? ref.speed * geo.shEff : 0;
    if (MB.center === "time" || !ref || hint > ref.speed) return geo;   // 도형 층(speedHints)이 가장 빠르면 길을 모름 → 시각 가운데
    // 가장 빠른 묶음 모서리의 길: [F − shEff, F + shEff]를 64칸으로
    const t = ref.t, i = ref.ref, c = ref.corner, K = 64, lim = geo.shEff;
    const T = [], P = [];
    for (let j = 0; j <= K; j++) { const tj = F - lim + (2 * lim * j) / K; T.push(tj); const s = itemState(t, clampF(tj), i); P.push(s ? apply(s.M, c) : null); }
    const mid = K / 2;
    if (!P[mid]) return geo;
    let jl = mid, jr = mid;
    while (jl > 0 && P[jl - 1]) jl--;
    while (jr < K && P[jr + 1]) jr++;
    const S = new Array(K + 1).fill(0);
    for (let j = mid - 1; j >= jl; j--) S[j] = S[j + 1] - Math.hypot(P[j][0] - P[j + 1][0], P[j][1] - P[j + 1][1]);
    for (let j = mid + 1; j <= jr; j++) S[j] = S[j - 1] + Math.hypot(P[j][0] - P[j - 1][0], P[j][1] - P[j - 1][1]);
    // 목표 길이 = 시각으로 고르게(shEff 폭) 찍었을 때와 같은 길이, 앞뒤 반씩 — 한쪽이 모자라면 둘 다 그만큼
    const q1 = Math.max(jl, K / 4), q3 = Math.min(jr, (3 * K) / 4);
    let half = (S[q3] - S[q1]) / 2;
    half = Math.min(half, -S[jl], S[jr]);
    geo.mode = "space"; geo.ref = ref; geo.T = T; geo.S = S; geo.jl = jl; geo.jr = jr;
    geo.half = Math.max(0, half);
    // 다른 묶음이 상한을 넘으면(앞뒤 시각 폭이 달라져서) 한 번 줄임
    if (geo.half > 0.05) {
      const [tA, tB] = [invS(geo, -geo.half), invS(geo, geo.half)];
      let k = 1;
      for (const g of gs) if (isFinite(g.capLen)) { const L = smearOf(g, tA, tB); if (L > g.capLen) k = Math.min(k, g.capLen / L); }
      geo.half *= k;
    }
    geo.L = 2 * geo.half;
    return geo;
  }
  // 호 길이 s(F 자리 = 0) → 시각
  function invS(geo, s) {
    const { T, S, jl, jr } = geo;
    if (s <= S[jl]) return T[jl];
    if (s >= S[jr]) return T[jr];
    let j = jl;
    while (j < jr && S[j + 1] < s) j++;
    const d = S[j + 1] - S[j];
    return d > 1e-9 ? T[j] + ((T[j + 1] - T[j]) * (s - S[j])) / d : T[j];
  }
  // 표본 시각 tot개(n = 0이 가장 늦은 쪽 — 시각 방식과 같은 차례)
  function timesOf(geo, F, tot) {
    const out = new Array(tot);
    if (geo.mode === "space") {
      for (let n = 0; n < tot; n++) out[n] = geo.half > 0.05 ? clampF(invS(geo, geo.half - (2 * geo.half * n) / (tot - 1))) : clampF(F);
      return out;
    }
    const sh = geo.shEff;
    for (let n = 0; n < tot; n++) out[n] = Math.max(0, Math.min(KX.lastFrame === undefined ? 1e9 : KX.lastFrame, F - sh * (n / (tot - 1)) + sh / 2));   // 0 앞·끝 뒤 서브프레임은 잘라 씀
    return out;
  }
  // 표본 수를 스스로(gap): 가장 긴 번짐 ÷ gap + 1
  function autoSamples(geo) {
    let L = geo.mode === "space" ? geo.L : 0;
    if (geo.mode !== "space") for (const g of geo.groups) L = Math.max(L, g.speed * geo.shEff);
    if (geo.mode !== "space" && !geo.groups.length) L = Math.max(L, KX.speedAt(geo.F) * geo.shEff);   // time + 상한 없음: 묶음을 안 쟀으니 KX.speedAt로
    if (KX.speedHints) L = Math.max(L, KX.speedHints(geo.F) * geo.shEff);
    return L < 0.75 ? 0 : Math.min(64, Math.ceil(L / MB.gap) + 1);
  }
  KX.blurGeom = (F) => blurGeom(Math.round(F * 1000) / 1000);
  KX.sampleTimes = function (F, n) {
    F = Math.round(F * 1000) / 1000;
    const geo = blurGeom(F);
    if (n === undefined) n = KX.mbSamples ? KX.mbSamples(F) : MB.gap > 0 ? autoSamples(geo) : MB.samples;
    if (!(n > 1)) return [F];
    const per = Math.min(12, n), tot = Math.ceil(n / per) * per;
    return timesOf(geo, F, tot);
  };
  KX.layer = function (z, fn) { layers.push({ z, fn }); };   // 자유 그리기(막대·아이콘): fn(ctx, F)

  // ---------- 도형 ----------
  KX.shapes = {
    rect(c, [x0, y0, x1, y1], fill, alpha) { c.save(); c.globalAlpha = alpha === undefined ? 1 : alpha; c.fillStyle = fill; c.fillRect(x0, y0, x1 - x0, y1 - y0); c.restore(); },
    // 휘는 막대: 중심선 y = ye + b(1-u²), u∈[-1,1], 두께 T (motion.json bar_bent_* 표와 같은 꼴)
    bent(c, xc, L, ye, b, T, fill, alpha) {
      const N = 48; c.save(); c.globalAlpha = alpha === undefined ? 1 : alpha; c.fillStyle = fill; c.beginPath();
      for (let i = 0; i <= N; i++) { const u = -1 + 2 * i / N; const x = xc + u * L / 2, y = ye + b * (1 - u * u) - T / 2; i ? c.lineTo(x, y) : c.moveTo(x, y); }
      for (let i = N; i >= 0; i--) { const u = -1 + 2 * i / N; c.lineTo(xc + u * L / 2, ye + b * (1 - u * u) + T / 2); }
      c.closePath(); c.fill(); c.restore();
    },
    vgrad(c, y0, y1, stops) { const g = c.createLinearGradient(0, y0, 0, y1); stops.forEach((s) => g.addColorStop(s[0], rgb(s[1]))); return g; },
    hgrad(c, x0, x1, stops) { const g = c.createLinearGradient(x0, 0, x1, 0); stops.forEach((s) => g.addColorStop(s[0], rgb(s[1]))); return g; },
  };

  // ---------- 렌더 ----------
  function drawScene(c, F) {
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.filter = "none"; c.globalCompositeOperation = "source-over";
    c.fillStyle = BG; c.fillRect(0, 0, W, H);
    if (KX.under) { c.save(); try { KX.under(c, F); } finally { c.restore(); } }   // 바탕 결(texture.js)을 장면 맨 밑에
    const ls = layers.slice().sort((p, q) => p.z - q.z);
    for (const L of ls) { c.save(); try { L.fn(c, F); } finally { c.restore(); } }
  }
  KX.render = function (F) {
    F = Math.round(F * 1000) / 1000;
    let src = cv, geo = null;
    let NS = KX.mbSamples ? KX.mbSamples(F) : MB.samples;   // 프레임마다 빠르기로 표본 수(E5: 40px/프레임 넘으면 32 이상)
    if (!KX.mbSamples && MB.gap > 0) { geo = blurGeom(F); NS = autoSamples(geo); }   // 번짐 길이로 표본 수
    KX._lastSamples = NS;
    if (NS > 1) {
      // 서브프레임 평균. 8비트 캔버스에서 알파 1/(j+1)을 j가 크게 쓰면(1/255 아래) 뒤 표본이 반올림으로 사라져
      // 표본 수를 늘려도 몇 겹 계단이 남는다(E5) → 2단 평균: 묶음마다 ≤12개 평균 → 묶음들을 다시 평균(모든 알파 ≥ 1/12)
      const per = Math.min(12, NS), G = Math.ceil(NS / per), tot = G * per;
      if (!geo) geo = blurGeom(F);
      const times = timesOf(geo, F, tot);   // 표본 시각(space 기본 / time = 시각 방식)
      KX._blur = { F, mode: geo.mode, samples: tot, shEff: geo.shEff, half: geo.half, times };
      if (!KX._grp) { KX._grp = document.createElement("canvas"); KX._grp.width = W; KX._grp.height = H; KX._gctx = KX._grp.getContext("2d"); }
      const gctx = KX._gctx;
      actx.setTransform(1, 0, 0, 1, 0, 0); actx.globalAlpha = 1; actx.clearRect(0, 0, W, H);
      for (let g = 0; g < G; g++) {
        gctx.setTransform(1, 0, 0, 1, 0, 0); gctx.globalAlpha = 1; gctx.clearRect(0, 0, W, H);
        for (let j = 0; j < per; j++) {
          drawScene(ctx, times[g * per + j]);
          gctx.globalAlpha = 1 / (j + 1); gctx.drawImage(cv, 0, 0);
        }
        actx.globalAlpha = 1 / (g + 1); actx.drawImage(KX._grp, 0, 0);
      }
      actx.globalAlpha = 1; src = acc;
    } else { KX._blur = { F, mode: "none", samples: 1, times: [F] }; drawScene(ctx, F); }
    octx.setTransform(1, 0, 0, 1, 0, 0); octx.globalAlpha = 1; octx.filter = "none";
    octx.fillStyle = BG; octx.fillRect(0, 0, W, H);
    octx.filter = BLUR > 0 ? `blur(${BLUR}px)` : "none";
    octx.drawImage(src, 0, 0);
    octx.filter = "none";
  };
  KX.layers = layers;
  KX.stateOf = (t, F, i) => itemState(t, F, i);   // 빛 지나감(글자 모양 안에만)용
  KX.pathOf = (it) => itemPath(it);
  KX.rgb = rgb;
  window.KX = KX;
})();
