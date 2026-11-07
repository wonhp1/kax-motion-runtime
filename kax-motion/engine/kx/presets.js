/* KXP — motion.json 프리셋 재생기. 표 [t, dx, dy, sx, sy, rot, sh, a](정착 상태 기준 상대값, 이동은 em)를
   새 단어의 글자/묶음 행렬로 바꾼다. core.js(KX)의 title.motions에 넣는 {from,to,fn,hold,entry}를 만든다.
   쓰는 법(engine/README.md):
     const P = KXP.load(MOTION);                      // motion.json 내용(객체)
     const word = KX.layoutWord("BS_opsz72_wght700", "WAVE", 136, 900, 620, {tracking: 0.05});
     KX.title({z: 10, items: word, motions: [
        KXP.letters(P.presets.letter_toss_wobble, 40),           // 40프레임에 첫 글자 등장
        KXP.group(P.presets.exit_dip_then_up, 120, {hide: true})  // 120프레임에 퇴장 시작, 끝나면 숨김
     ], clip: (F) => KX.rect(...KXG.cellBox(8))});                // 칸 자르기

   선택 기능(안 쓰면 기본 결과 그대로):
   ① 넘침 따로 맞추기: amp.over(위치)·amp.rotOver(회전)·amp.scaleOver(배율) — 정착값을 지나친 쪽만 곱한다.
      예) letter_spin_rise_overshoot를 0.8em 솟고 9%만 넘치게:
          KXP.letters("letter_spin_rise_overshoot", 40, {amp: {move: 1.03, over: 0.09 / KXP.overshootOf("letter_spin_rise_overshoot", "dy")}})
   ② 통통 튐: KXP.bounce(t0, {drop, bounces, decay, squash, rot, ...}) / 표만 KXP.bounceKeys(opt) — 아래 설명.
   ③ 이름이 hold_로 시작하는 묶음 동작(hold_micro_drift)은 등장으로 보지 않는다(그 전까지 글자를 숨기던 함정).

   ④ KXP.group 등장 판정은 표 첫 줄로 한다(KXP.entryOf) — 표를 직접 넘기거나(opt.keys·객체) 모프(section_card_shrink_up 등)를 써도
      시작 전에 글자가 숨지 않는다.
   ⑤ 낱말 묶음 통통 튐 KXP.bounceWords(t0, {words, stagger, drop, squash, focus, …}) — 굵은 한글은 낱말 하나가 한 덩어리로(R10)
   ⑥ KXP.bounceKeys {fallStretch} — 표보다 높은 낙하를 √높이로 늘림(기본 꺼짐, bounceWords는 켬)
*/
(function () {
  "use strict";
  const KXP = {};
  let LIB = null;
  KXP.load = (m) => (LIB = m);
  const get = (p) => (typeof p === "string" ? (LIB.presets[p] || (() => { throw new Error("프리셋 없음: " + p); })()) : p);

  // 표 보간: t < 0 → null(아직 안 보임), 표 끝 뒤 → 마지막 줄
  function sample(keys, t) {
    if (t < keys[0][0] - 1e-6) return null;
    const last = keys[keys.length - 1];
    if (t >= last[0]) return last.slice(1);
    let k = 0;
    while (k < keys.length - 1 && keys[k + 1][0] <= t) k++;
    const A = keys[k], B = keys[k + 1];
    const u = (t - A[0]) / (B[0] - A[0] || 1);
    return A.slice(1).map((v, j) => v + (B[j + 1] - v) * u);
  }
  KXP.sample = sample;

  /* 상대값 → 화면 상대 변환 T(기준점 둘레). r = [dx,dy,sx,sy,rot,sh,a], em = 화면 글자 크기 px
     amp: {move, scale, rot, shear} 진폭 배수(1 = 측정값 그대로) */
  function relT(r, anchor, em, amp, rotSign) {
    amp = amp || {};
    const mv = amp.move === undefined ? 1 : amp.move, sc = amp.scale === undefined ? 1 : amp.scale;
    const rt = amp.rot === undefined ? 1 : amp.rot, sh = (amp.shear === undefined ? 1 : amp.shear) * r[5];
    const sx = 1 + (r[2] - 1) * sc, sy = 1 + (r[3] - 1) * sc;
    const th = (r[4] * rt * (rotSign || 1) * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th);
    // L = R(th) · [[sx, sh·sx],[0, sy]]
    const a = c * sx, b = s * sx, cc = c * sh * sx - s * sy, d = s * sh * sx + c * sy;
    const [ax, ay] = anchor;
    const tx = ax + r[0] * em * mv * (amp.flipX ? -1 : 1), ty = ay + r[1] * em * mv;
    return [a, b, cc, d, tx - (a * ax + cc * ay), ty - (b * ax + d * ay)];
  }
  KXP.relT = relT;

  /* 넘침 분리: 표의 첫 줄(시작값)과 부호가 반대인 값 = 정착값을 지나친 몫(넘침)만 따로 곱한다.
     amp.over(dx·dy), amp.rotOver(rot), amp.scaleOver(sx·sy) — 기본 1(표 그대로). 0이면 넘침 없이 expo-out으로 바로 정착.
     움직임 진폭(amp.move 등)과 곱이 따로라 '솟는 폭'과 '넘침 비'를 따로 맞춘다. 0을 지나는 순간 값이 0이라 이어짐이 끊기지 않는다. */
  const EPS = [0.02, 0.02, 0.005, 0.005, 0.5];   // dx, dy(em), sx, sy(배율), rot(도): 시작값이 이보다 작으면 그 축은 넘침을 따지지 않음
  function shapeOver(r, r0, amp) {
    if (!amp || (amp.over === undefined && amp.rotOver === undefined && amp.scaleOver === undefined)) return r;
    const o = r.slice();
    const k = [amp.over, amp.over, amp.scaleOver, amp.scaleOver, amp.rotOver];
    const base = [0, 0, 1, 1, 0];
    [0, 1, 2, 3, 4].forEach((c, j) => {
      const m = k[j];
      if (m === undefined || m === 1) return;
      const v0 = r0[c] - base[j], v = r[c] - base[j];
      if (Math.abs(v0) < EPS[j] || v * v0 >= 0) return;
      o[c] = base[j] + v * m;
    });
    return o;
  }
  KXP.shapeOver = shapeOver;
  /* 표에서 잰 넘침 비 = |정착값을 지나친 최댓값| / |시작값| (col: "dx"|"dy"|"rot"|"sx"|"sy") */
  KXP.overshootOf = function (preset, col) {
    const p = get(preset), keys = p.keys, c = { dx: 1, dy: 2, sx: 3, sy: 4, rot: 5 }[col], base = col === "sx" || col === "sy" ? 1 : 0;
    const v0 = keys[0][c] - base;
    let mx = 0;
    for (const r of keys) { const v = r[c] - base; if (v * v0 < 0) mx = Math.max(mx, Math.abs(v)); }
    return Math.abs(v0) < 1e-9 ? 0 : mx / Math.abs(v0);
  };

  KXP.letterAnchor = (it) => [it.pen[0] + 0.3 * it.size, it.pen[1] - 0.36 * it.size];
  KXP.groupAnchor = (items) => {
    const a = items.map(KXP.letterAnchor);
    return [a.reduce((s, p) => s + p[0], 0) / a.length, a.reduce((s, p) => s + p[1], 0) / a.length];
  };

  // 측정 스태거를 n글자로 늘림(측정 글자 수보다 많으면 평균 간격으로 이어 감)
  KXP.stagger = function (p, n, step) {
    if (typeof step === "number") return Array.from({ length: n }, (_, i) => i * step);
    const st = p.stagger_frames || [0];
    if (n <= st.length) return st.slice(0, n);
    const avg = st.length > 1 ? st[st.length - 1] / (st.length - 1) : 1.2;
    const out = st.slice();
    for (let i = st.length; i < n; i++) out.push(Math.round(st[st.length - 1] + (i - st.length + 1) * avg));
    return out;
  };

  /* 글자 단위 프리셋. opt: {stagger: "measured"|숫자, order: "ltr"|"rtl"|"center", rotSign: "measured"|"alt"|1|-1,
     amp: {...}, solid: 불투명도를 첫 프레임만 빼고 1로(모션 블러를 켰을 때), hold: true(기본), hide: 표가 끝난 글자는 숨김,
     keys: 다른 표, part} */
  KXP.letters = function (preset, t0, opt) {
    opt = opt || {};
    const p = get(preset);
    const keys = opt.keys || (opt.part ? p.parts[opt.part].keys : p.keys);
    const tEnd = keys[keys.length - 1][0];
    let cache = null;
    function setup(items) {
      const n = items.length;
      let st = KXP.stagger(p, n, opt.stagger === "measured" || opt.stagger === undefined ? undefined : opt.stagger);
      let order = Array.from({ length: n }, (_, i) => i);
      if (opt.order === "rtl") order.reverse();
      if (opt.order === "center") order.sort((a, b) => Math.abs(a - (n - 1) / 2) - Math.abs(b - (n - 1) / 2));
      const delay = new Array(n);
      order.forEach((idx, k) => (delay[idx] = st[k]));
      const pat = p.rot_sign_by_letter || [1];
      const sign = items.map((_, i) => opt.rotSign === "measured" || opt.rotSign === undefined ? pat[i % pat.length] : opt.rotSign === "alt" ? (i % 2 ? -1 : 1) : opt.rotSign);
      cache = { delay, sign, n };
    }
    return {
      from: t0, to: t0 + tEnd + 40, hold: opt.hold !== false, entry: true,
      fn(F, i, it) {
        if (!cache) throw new Error("KXP.letters: bind(items)가 안 됨 — KX.title이 자동으로 부른다");
        const d = cache.delay[i] === undefined ? i * 1.2 : cache.delay[i];
        const r = sample(keys, F - t0 - d);
        if (!r) return null;
        if (opt.hide && F - t0 - d > tEnd) return null;   // 생애 전체 표(letter_toss_wobble 등)는 끝나면 숨김
        const a = opt.solid ? (F - t0 - d < 1 ? r[6] : 1) : r[6];
        return { T: relT(shapeOver(r, keys[0].slice(1), opt.amp), KXP.letterAnchor(it), it.size, opt.amp, cache.sign[i]), a };
      },
      bind(items) { this.items = items; setup(items); return this; },
    };
  };

  /* 등장(entry) 판정 — 이름이 아니라 **실제로 쓰는 표의 첫 줄**로 본다.
     이름만 보면(문자열이고 exit·hold_가 아니면 모두 등장) 표를 직접 넘기거나(opt.keys·객체) 모프(section_card_shrink_up 등)를
     쓸 때 그 동작 시작 전 프레임에 글자가 숨는다.
     판정: ① opt.entry를 주면 그 값 ② 이름(문자열, 또는 객체가 LIB 안 프리셋이면 그 이름)이 exit·hold_ → 등장 아님
           ③ 그 밖에는 표 첫 줄이 정착 자세(이동 ≤ 0.03em, 배율 차 ≤ 0.02, 회전 ≤ 1°, 기울임 ≤ 0.02, 불투명도 ≥ 0.95)면 등장 아님
              — 시작 전에 정착 자리에 그대로 보이는 것이 표 첫 줄과 이어진다. 첫 줄이 다른 자리·크기·투명이면 등장(시작 전 숨김). */
  const REST = { d: 0.03, s: 0.02, r: 1.0, sh: 0.02, a: 0.95 };
  KXP.isRest = (row) => !!row && Math.abs(row[1]) <= REST.d && Math.abs(row[2]) <= REST.d && Math.abs(row[3] - 1) <= REST.s && Math.abs(row[4] - 1) <= REST.s &&
    Math.abs(row[5]) <= REST.r && Math.abs(row[6] || 0) <= REST.sh && (row[7] === undefined ? 1 : row[7]) >= REST.a;
  KXP.nameOf = (preset) => (typeof preset === "string" ? preset : (LIB && Object.keys(LIB.presets).find((k) => LIB.presets[k] === preset)) || null);
  KXP.entryOf = function (preset, keys, opt) {
    if (opt && opt.entry !== undefined) return !!opt.entry;
    const name = KXP.nameOf(preset);
    if (name && (/exit/.test(name) || /^hold_/.test(name))) return false;
    return !KXP.isRest(keys[0]);
  };

  /* 묶음 단위 프리셋(단어·줄·칸 전체가 같은 변환). items를 꼭 bind 하거나 opt.items로 준다.
     opt: {items, anchor:[x,y], em, amp, part, keys(다른 표), hide: 표 끝나면 숨김(퇴장), solid,
           entry(기본: 위 KXP.entryOf — 표 첫 줄이 정착 자세가 아니면 등장으로 봄)} */
  KXP.group = function (preset, t0, opt) {
    opt = opt || {};
    const p = get(preset);
    const keys = opt.keys || (opt.part ? p.parts[opt.part].keys : p.keys);
    const tEnd = keys[keys.length - 1][0];
    let anchor = opt.anchor, em = opt.em;
    const m = {
      // 등장이면 t0 전에는 숨김(entry), 아니면(퇴장·정지 흐름·모프) t0 전에는 이 동작을 건너뜀 — 판정은 KXP.entryOf
      from: t0, to: t0 + tEnd, hold: true, entry: KXP.entryOf(preset, keys, opt),
      fn(F, i, it) {
        const r = sample(keys, F - t0);
        if (!r) return null;
        if (opt.hide && F - t0 > tEnd) return null;
        return { T: relT(shapeOver(r, keys[0].slice(1), opt.amp), anchor, em, opt.amp), a: opt.solid ? 1 : r[6] };
      },
      bind(items) {
        anchor = anchor || KXP.groupAnchor(items);
        em = em || Math.max(...items.map((x) => x.size));
        return m;
      },
    };
    if (opt.items) m.bind(opt.items);
    return m;
  };

  /* 3D 줄 회전(문이 열리듯 한 줄이 돎): 줄 왼쪽 끝 세로축 둘레로 φ도, 원근 중심 center, 거리 z0(px).
     phi(F) → 도. 글자마다 가운데 기준 아핀 근사(가로 cosφ·원근, 세로 원근). */
  KXP.swing3d = function (t0, t1, phiFn, axisX, center, z0, opt) {
    opt = opt || {};
    return {
      from: t0, to: t1, hold: opt.hold !== false, entry: !!opt.entry,
      fn(F, i, it) {
        const ph = (phiFn(F) * Math.PI) / 180;
        if (Math.abs(ph) >= Math.PI / 2 - 0.02) return null;
        const [ax, ay] = KXP.letterAnchor(it);
        const u = ax - axisX, x3 = axisX + u * Math.cos(ph), z = u * Math.sin(ph);
        const pz = z0 / (z0 + z);
        const X = center[0] + (x3 - center[0]) * pz, Y = center[1] + (ay - center[1]) * pz;
        const a = Math.cos(ph) * pz, d = pz;
        return { T: [a, 0, 0, d, X - a * ax, Y - d * ay], a: 1 };
      },
    };
  };

  /* ---------- 통통 튐(bounce) ----------
     측정 곡선 두 개에서 만든다(새로 그린 곡선 아님):
       - 높이: letter_toss_wobble dy 열 — t0~13 솟음(expo-out, 프레임당 남은 거리 ×0.75), t13~25 중력처럼 가속 낙하.
         튐 하나 = 솟음 표의 뒷부분 s..13 + 낙하 표의 앞부분 0..(12−s). 뒷부분만 써도 프레임당 감속 비가 그대로라 곡선 성격이 같다.
       - 튐 높이 h → 시작 칸 s: s = 13 − 13·√(h / 1.472)/tempo (1.472em = 측정 솟음 높이, 25프레임). 시간이 √높이에 비례(중력).
         실제 장면에서 눈으로 고른 값(0.32em → s7, 0.08em → s10)이 이 식과 같다.
       - 착지 눌림: letter_stretch_pop sx·sy 열(sy 0.56 → 0.94 → 1, sx 1.0 → 1.10 → 1, 10프레임)을 바닥 가운데 기준으로 —
         세기 = squash × min(1, 떨어진 높이/0.3em). 표는 글자 가운데 기준이라 dy에 (1−sy)·0.36em을 더해 바닥을 붙여 둔다.
       - 기울기: toss_wobble rot 열 × rot, 튈 때마다 부호가 바뀜(표의 교대 기울기).
     opt(모두 선택):
       drop     처음 떨어지는 높이(em, 기본 1.5). 0 = 바닥에서 바로 튐으로 시작
       v0       주면 떨어짐을 낙하 표 v0칸부터(이미 떨어지는 중으로 화면에 들어옴). 없으면 꼭대기에서 멈춘 채 시작
       bounces  착지 뒤 튀는 횟수(기본 2)
       h1       첫 튐 높이(em, 기본 drop × decay)
       decay    튐마다 높이 비(기본 0.25 — 0.32→0.08em 튐과 같음. 공처럼 오래 튀게는 0.4~0.5)
       squash   눌림 세기(0~1, 기본 0.75 → 가장 깊을 때 세로 0.67배). 한글 키네틱은 0.3~0.5
       rot      기울기 배수(기본 0.45 → 꼭대기에서 ±5.8°). 자간 −2~−4% 한글은 0~0.5(korean_typography 2절)
       tempo    빠르기(기본 1 = 측정 속도, 1.3이면 30% 빨리)
       hops     [{h, s}] 직접 지정(위 셋 대신)
       step     표 간격 프레임(기본 0.5 — 모션 블러 서브프레임용)
       fallStretch (기본 false) 표보다 높은 낙하·튐(s가 1 아래로 잘리는 h > 1.25em)을 표 전체를 √(h/1.472)배 늘려 씀
                — 끄면 11프레임에 잘려 높을수록 빨라진다(중력이면 시간 ∝ √높이). KXP.bounceWords가 켠다
     KXP.bounceKeys(opt) → keys 표([t,dx,dy,sx,sy,rot,sh,a], 다른 프리셋과 같은 꼴). keys.lands = 착지 프레임(t 기준) — 효과음 시각.
     KXP.bounce(t0, opt) → KXP.letters 동작(글자 사이 opt.stagger 기본 2프레임, 회전 부호 교대). .landFrames() = 글자별 절대 착지 프레임. */
  KXP.BOUNCE = { drop: 1.5, bounces: 2, decay: 0.25, squash: 0.75, rot: 0.45, tempo: 1, step: 0.5, settle: 10 };
  KXP.bounceKeys = function (o) {
    o = Object.assign({}, KXP.BOUNCE, o || {});
    const TW = get("letter_toss_wobble").keys, SP = get("letter_stretch_pop").keys;
    const DY = TW.map((r) => r[2]), ROT = TW.map((r) => r[5]), SX = SP.map((r) => r[3]), SY = SP.map((r) => r[4]);
    const H_REF = DY[0];
    const tab = (a, u) => { if (u <= 0) return a[0]; if (u >= a.length - 1) return a[a.length - 1]; const i = Math.floor(u), f = u - i; return a[i] + (a[i + 1] - a[i]) * f; };
    const RISE = (u) => tab(DY, u) / DY[0];                                  // u 0..13 : 1 → 0
    const FALL = (v) => (tab(DY, 13 + v) - DY[13]) / (DY[25] - DY[13]);      // v 0..12 : 0 → 1
    const sOf = (h) => Math.max(1, Math.min(11, Math.round(13 - (13 * Math.sqrt(Math.max(h, 1e-4) / H_REF)) / o.tempo)));
    // fallStretch: 표보다 높으면(s가 1 아래) 표 전체(s = 0)를 k = √(h/1.472)/tempo배 늘림. 아니면 k = 1(늘리지 않는 식)
    const kOf = (h) => (o.fallStretch && 13 - (13 * Math.sqrt(Math.max(h, 1e-4) / H_REF)) / o.tempo < 1 ? Math.sqrt(h / H_REF) / o.tempo : 1);
    let hops = o.hops;
    if (!hops) {
      hops = [];
      let h = o.h1 !== undefined ? o.h1 : o.drop > 0 ? o.drop * o.decay : 0.3;
      for (let k = 0; k < o.bounces; k++) { hops.push({ h }); h *= o.decay; }
    }
    hops = hops.map((g) => { const k = g.s === undefined ? kOf(g.h) : 1; return { h: g.h, s: g.s !== undefined ? g.s : k !== 1 ? 0 : sOf(g.h), k }; });
    // 구간 목록
    const parts = [], lands = [];
    let t = 0, sign = 1;
    if (o.drop > 0) {
      if (o.v0 !== undefined) { const d = 12 - o.v0; parts.push({ a: 0, b: d, kind: "dropv", h: o.drop, v0: o.v0, sign }); t = d; }
      else { const k = kOf(o.drop), s = k !== 1 ? 0 : sOf(o.drop), d = (12 - s) * k; parts.push({ a: 0, b: d, kind: "fall", h: o.drop, s, k, sign }); t = d; }
      lands.push(t);
    }
    for (const g of hops) {
      sign = -sign;
      const d1 = (13 - g.s) * g.k, d2 = (12 - g.s) * g.k;
      parts.push({ a: t, b: t + d1, kind: "rise", h: g.h, s: g.s, k: g.k, sign });
      parts.push({ a: t + d1, b: t + d1 + d2, kind: "fall", h: g.h, s: g.s, k: g.k, sign });
      t += d1 + d2; lands.push(t);
    }
    const end = t;
    const fallH = parts.filter((q) => q.kind !== "rise").map((q) => q.h);   // lands[i]에 떨어진 높이
    function state(F) {
      let y = 0, rot = 0;
      if (F < end) {
        const p = parts.find((q) => F >= q.a - 1e-6 && F < q.b) || parts[parts.length - 1];
        const u = F - p.a;
        if (p.kind === "dropv") { const f0 = FALL(p.v0); y = p.h * (1 - (FALL(p.v0 + u) - f0) / (1 - f0)); rot = tab(ROT, 13 + p.v0 + u) * o.rot * p.sign; }
        else if (p.kind === "rise") { const v = u / p.k; y = p.h * (1 - RISE(p.s + v) / RISE(p.s)); rot = tab(ROT, p.s + v) * o.rot * p.sign; }
        else { const v = u / p.k; y = p.h * (1 - FALL(v) / FALL(12 - p.s)); rot = tab(ROT, 13 + v) * o.rot * p.sign; }
      } else {
        // 마지막 착지 뒤: 남은 기울기를 프레임당 ×0.5로 정착(expo-out, common_rules 0.3~0.75)
        const pl = parts[parts.length - 1];
        const r0 = pl.kind === "dropv" ? tab(ROT, 13 + 12) : tab(ROT, 13 + (12 - pl.s));
        rot = r0 * o.rot * pl.sign * Math.pow(0.5, F - end);
      }
      let sx = 1, sy = 1;
      const li = lands.filter((l) => l <= F + 1e-6).length - 1, last = lands[li], next = lands[li + 1];
      if (last !== undefined && F - last <= 10) {
        const k = F - last, A = o.squash * Math.min(1, fallH[li] / 0.3);
        sx = 1 + (tab(SX, k) - 1) * A; sy = 1 + (tab(SY, k) - 1) * A;
      }
      if (next !== undefined && next - F < 1) {   // 닿기 1프레임 전부터 다음 눌림 첫 값으로 이어 들어감(블러 이중상 방지, E5)
        const w = 1 - (next - F), A = o.squash * Math.min(1, fallH[li + 1] / 0.3);
        sx += (1 + (SX[0] - 1) * A - sx) * w; sy += (1 + (SY[0] - 1) * A - sy) * w;
      }
      return { y, rot, sx, sy };
    }
    const keys = [];
    const tEnd = end + o.settle;
    for (let F = 0; F <= tEnd + 1e-9; F += o.step) {
      const st = state(F), r = (v, n) => Math.round(v * 10 ** n) / 10 ** n;
      keys.push([r(F, 3), 0, r(-st.y + (1 - st.sy) * 0.36, 4), r(st.sx, 4), r(st.sy, 4), r(st.rot, 2), 0, 1]);
    }
    keys.push([r3(tEnd + o.step), 0, 0, 1, 1, 0, 0, 1]);
    keys.lands = lands;
    keys.hops = hops;
    return keys;
  };
  const r3 = (v) => Math.round(v * 1000) / 1000;
  /* KXP.offscreenDrop(items, pad) — 글자들이 화면 위 밖에서 통째로 떨어져 들어오는 높이(em). KXP.bounceWords drop "offscreen"과 같은 셈:
     (가장 낮은 기준선 y + pad × em) / em, em = 가장 큰 글자 크기, pad 기본 0.3(받침·흐림 몫). 1/1000로 반올림. */
  KXP.offscreenDrop = function (items, pad) {
    const em = Math.max(...items.map((it) => it.size)), yb = Math.max(...items.map((it) => it.pen[1]));
    return r3((yb + (pad === undefined ? KXP.BOUNCE_WORDS.offscreenPad : pad) * em) / em);
  };
  KXP.bounce = function (t0, opt) {
    opt = opt || {};
    const base = (LIB && LIB.presets.letter_bounce) || { stagger_frames: [0, 2, 4, 6], rot_sign_by_letter: [1, -1, 1, -1] };
    const st = opt.stagger === undefined ? 2 : opt.stagger;
    if (opt.drop === "offscreen") return bounceOffscreen(t0, opt, base, st);
    const keys = KXP.bounceKeys(opt);
    const p = Object.assign({}, base, { keys });
    const m = KXP.letters(p, t0, Object.assign({}, opt, { stagger: st, rotSign: opt.rotSign === undefined ? "measured" : opt.rotSign }));
    const bind0 = m.bind;
    m.bind = function (items) {
      bind0.call(this, items);
      const n = items.length, d = KXP.stagger(p, n, typeof st === "number" ? st : undefined);
      this._delay = opt.order === "rtl" ? d.slice().reverse() : d;
      return this;
    };
    m.landFrames = function () { return (this._delay || [0]).map((d) => keys.lands.map((l) => t0 + d + l)); };
    m.keys = keys;
    return m;
  };
  /* KXP.bounce(t0, {drop: "offscreen", offscreenPad, …}) — 글자가 화면 위 밖에서 통째로 떨어져 들어옴(R10 '보이지 않는 마스크 금지').
     떨어지는 높이는 글자를 묶을 때(bind — KX.title이 부름) KXP.offscreenDrop(그 글자들, offscreenPad)으로 정한다(bounceWords와 같은 셈).
     높은 낙하라 fallStretch를 안 주면 true(bounceWords와 같음 — 높을수록 빨라지지 않게). 숫자 drop은 위 KXP.bounce 그대로.
     bind 전에는 표가 없다 → 박자에 맞춰 시작을 정하려면 KXP.bounceKeys(Object.assign({}, opt, {drop: KXP.offscreenDrop(글자들)}))로 먼저 잰다. */
  function bounceOffscreen(t0, opt, base, st) {
    let inner = null;
    const m = {
      from: t0, to: t0 + 1e6, hold: opt.hold !== false, entry: true,
      fn(F, i, it) {
        if (!inner) throw new Error("KXP.bounce drop offscreen: bind(items)가 안 됨 — KX.title이 자동으로 부른다");
        return inner.fn(F, i, it);
      },
      bind(items) {
        const drop = KXP.offscreenDrop(items, opt.offscreenPad);
        const o2 = Object.assign({}, opt, { drop, fallStretch: opt.fallStretch === undefined ? true : opt.fallStretch });
        const keys = KXP.bounceKeys(o2);
        const p = Object.assign({}, base, { keys });
        inner = KXP.letters(p, t0, Object.assign({}, o2, { stagger: st, rotSign: opt.rotSign === undefined ? "measured" : opt.rotSign }));
        inner.bind(items);
        const n = items.length, d = KXP.stagger(p, n, typeof st === "number" ? st : undefined);
        this._delay = opt.order === "rtl" ? d.slice().reverse() : d;
        this.from = inner.from; this.to = inner.to; this.entry = inner.entry; this.hold = inner.hold;
        this.keys = keys; this.drop = drop;
        return this;
      },
      landFrames() {
        if (!this.keys) throw new Error("KXP.bounce drop offscreen: landFrames는 bind 뒤에(KX.title 뒤)");
        return (this._delay || [0]).map((d) => this.keys.lands.map((l) => t0 + d + l));
      },
    };
    return m;
  }

  /* ---------- 낱말 묶음 통통 튐 KXP.bounceWords (R10 한글 낱말 묶음) ----------
     굵기 700 이상 한글은 글자 단위로 떨어뜨리거나 튀기지 않는다 — 낱말(어절)마다 글자들이 **같은 변환 하나**로 떨어지고 튄다.
     낱말끼리는 엇갈린 시작(stagger). 곡선은 KXP.bounce와 같은 측정 표(KXP.bounceKeys — letter_toss_wobble 솟음·낙하 + letter_stretch_pop 눌림).
     KXP.bounceWords(t0, opt) → KX.title motions에 넣는 동작 하나(제목 글자 전체에 걸림). opt(모두 선택):
       words    낱말 나누기. "오늘 동네 빵집"(그 글자 목록을 만든 문장 — 띄어쓰기로) | [2, 2, 2](낱말마다 글자 수) | [[0,1],[2,3]](글자 번호)
                | 없으면 글자 사이 틈(> gapEm, 기본 0.1em)·기준선 차이로 스스로 나눔(공백 글자는 항목에 없으므로 틈으로 보임)
       stagger  낱말 사이 시작 차(프레임, 기본 6) | [0, 6, 14, …] 낱말마다 시작(t0 기준 — 박자에 맞출 때)
       order    "ltr"(기본) | "rtl" | "center"
       drop     처음 떨어지는 높이(낱말 em, 기본 1.5) | "offscreen" = 낱말이 화면 위 밖에서 통째로 들어옴(R10 '보이지 않는 마스크 금지')
       v0 · bounces(2) · h1(0.35em) · decay(0.3) · tempo(1) · hops   KXP.bounce와 같은 뜻(낱말 em 기준)
       squash   낱말 눌림(기본 0.3)     rot  낱말 기울기(기본 0 — 넓은 낱말이 기울면 끝이 바닥선 아래로 내려감)
       focus    강조 낱말 하나만 글자 단위(T4): {word: 낱말 번호, stagger: 글자 사이 프레임(2), squash(0.15 — 0.2 넘으면 0.2로 자름),
                h1·decay·bounces(안 주면 낱말 값)} — 회전은 늘 0(R10). 떨어지는 높이·시작은 그 낱말과 같다
       blurCap  이 동작 글자의 모션 블러 상한: 번짐 길이 ≤ blurCap × 그 묶음에서 가장 낮은 글자 잉크 높이(기본 0.22 — R10 '세로 번짐
                ≤ 글자 높이 25%'에 여유, core.js가 읽음). 0이면 이 상한 없음(엔진 cap만)
       fallStretch 높은 낙하를 √높이로 늘림(기본 true — bounceKeys 설명)
     돌려줌(동작 객체에 붙음): .landFrames() 낱말마다 [첫 착지, 튐1 착지, …] 절대 프레임 — 효과음 시각(D4). 강조 낱말은 첫 글자 것
       .focusLandFrames() 강조 낱말 글자마다 [...]   .events() 효과음 사건 [{f, onset, land, type, tier, word, letter?, hint?}]
       (tier는 normal·detail만 — R12. 첫 낱말 첫 착지에 hint "first", 강조 낱말 첫 착지에 hint "signature" → KC.retier가 고름)
       .words 낱말별 글자 번호   .keysOf(w) 그 낱말 표 */
  KXP.BOUNCE_WORDS = { drop: 1.5, bounces: 2, h1: 0.35, decay: 0.3, squash: 0.3, rot: 0, tempo: 1, stagger: 6, order: "ltr", blurCap: 0.22, gapEm: 0.1, fallStretch: true, offscreenPad: 0.3 };
  KXP.FOCUS_MAX_SQUASH = 0.2;
  KXP.splitWords = function (items, words, gapEm) {
    const n = items.length;
    const fromCounts = (cs) => {
      const sum = cs.reduce((s, c) => s + c, 0);
      if (sum !== n) throw new Error(`KXP.bounceWords: 낱말 글자 수 합 ${sum} ≠ 글자 항목 ${n} — words는 공백을 뺀 글자 수(또는 그 문장)`);
      let k = 0; return cs.map((c) => Array.from({ length: c }, () => k++));
    };
    if (typeof words === "string") return fromCounts(words.trim().split(/\s+/).filter(Boolean).map((w) => Array.from(w).length));
    if (Array.isArray(words) && words.length && Array.isArray(words[0])) return words.map((w) => w.slice());
    if (Array.isArray(words)) return fromCounts(words);
    const g = gapEm === undefined ? KXP.BOUNCE_WORDS.gapEm : gapEm, out = [[0]];
    for (let i = 1; i < n; i++) {
      const a = items[i - 1], b = items[i], em = Math.max(a.size, b.size);
      const gap = b.pen[0] - (a.pen[0] + (a.adv || a.size * 0.6));
      if (gap > g * em || gap < -0.5 * em || Math.abs(b.pen[1] - a.pen[1]) > 0.3 * em) out.push([i]); else out[out.length - 1].push(i);
    }
    return out;
  };
  KXP.bounceWords = function (t0, opt) {
    const o = Object.assign({}, KXP.BOUNCE_WORDS);
    for (const [k, v] of Object.entries(opt || {})) if (v !== undefined) o[k] = v;   // undefined 칸은 기본값
    if (Array.isArray(o.focus)) throw new Error("KXP.bounceWords: 글자 단위 강조 낱말은 하나만(R10·T4) — focus: {word: k}");
    const fo = o.focus === undefined || o.focus === null ? null : typeof o.focus === "number" ? { word: o.focus } : Object.assign({}, o.focus);
    if (fo) {
      fo.stagger = fo.stagger === undefined ? 2 : fo.stagger;
      const sq = fo.squash === undefined ? 0.15 : fo.squash;
      if (sq > KXP.FOCUS_MAX_SQUASH) console.warn(`KXP.bounceWords: 강조 낱말 squash ${sq} → ${KXP.FOCUS_MAX_SQUASH}(R10 상한)`);
      if (fo.rot) console.warn("KXP.bounceWords: 강조 낱말 회전은 0으로 둠(R10)");
      fo.squash = Math.min(KXP.FOCUS_MAX_SQUASH, sq);
    }
    const base = { bounces: o.bounces, h1: o.h1, decay: o.decay, tempo: o.tempo, hops: o.hops, v0: o.v0, step: o.step, settle: o.settle, fallStretch: o.fallStretch };
    const cache = {};
    const keysFor = (drop, extra) => {
      const q = Object.assign({}, base, extra, { drop });
      for (const k of Object.keys(q)) if (q[k] === undefined) delete q[k];   // 안 준 칸은 KXP.BOUNCE 기본값으로
      const id = JSON.stringify(q);
      return cache[id] || (cache[id] = KXP.bounceKeys(q));
    };
    let words = null, wordOf = null, idxIn = null, delay = null, anchor = null, em = null, kw = null, kf = null, sign = null;
    const m = {
      from: t0, to: t0, hold: true, entry: true, blurCap: o.blurCap,
      fn(F, i, it) {
        if (!words) throw new Error("KXP.bounceWords: bind(items)가 안 됨 — KX.title이 자동으로 부른다");
        const g = wordOf[i];
        if (fo && g === fo.word) {
          const r = sample(kf, F - t0 - delay[g] - idxIn[i] * fo.stagger);
          return r ? { T: relT(r, KXP.letterAnchor(it), it.size, null, 1), a: 1 } : null;
        }
        const r = sample(kw[g], F - t0 - delay[g]);
        return r ? { T: relT(r, anchor[g], em[g], null, sign[g]), a: 1 } : null;
      },
      bind(items) {
        words = KXP.splitWords(items, o.words, o.gapEm);
        const nW = words.length;
        if (fo && !(fo.word >= 0 && fo.word < nW)) throw new Error(`KXP.bounceWords: focus.word ${fo.word} — 낱말은 0~${nW - 1}`);
        wordOf = new Array(items.length); idxIn = new Array(items.length);
        words.forEach((w, g) => w.forEach((i, k) => { wordOf[i] = g; idxIn[i] = k; }));
        // 낱말 시작
        if (Array.isArray(o.stagger)) delay = words.map((_, g) => (o.stagger[g] === undefined ? o.stagger[o.stagger.length - 1] : o.stagger[g]));
        else {
          let rank = words.map((_, g) => g);
          if (o.order === "rtl") rank = rank.map((g) => nW - 1 - g);
          if (o.order === "center") { const s = words.map((_, g) => g).sort((a, b) => Math.abs(a - (nW - 1) / 2) - Math.abs(b - (nW - 1) / 2)); rank = words.map((_, g) => s.indexOf(g)); }
          delay = rank.map((r) => r * o.stagger);
        }
        anchor = words.map((w) => KXP.groupAnchor(w.map((i) => items[i])));
        em = words.map((w) => Math.max(...w.map((i) => items[i].size)));
        sign = words.map((_, g) => (g % 2 ? -1 : 1));
        const dropOf = (g) => {
          if (o.drop !== "offscreen") return o.drop;
          const yb = Math.max(...words[g].map((i) => items[i].pen[1]));   // 기준선 → 그 아래 받침·흐림까지 pad
          return Math.round(((yb + o.offscreenPad * em[g]) / em[g]) * 1000) / 1000;
        };
        kw = words.map((_, g) => keysFor(dropOf(g), { squash: o.squash, rot: o.rot }));
        if (fo) kf = keysFor(dropOf(fo.word), { squash: fo.squash, rot: 0, h1: fo.h1 === undefined ? o.h1 : fo.h1, decay: fo.decay === undefined ? o.decay : fo.decay, bounces: fo.bounces === undefined ? o.bounces : fo.bounces });
        let end = 0;
        words.forEach((w, g) => {
          const K = fo && g === fo.word ? kf : kw[g], extra = fo && g === fo.word ? (w.length - 1) * fo.stagger : 0;
          end = Math.max(end, delay[g] + extra + K[K.length - 1][0]);
        });
        this.to = t0 + end;
        this.words = words;
        return this;
      },
      keysOf(g) { return fo && g === fo.word ? kf : kw[g]; },
      landFrames() { return words.map((_, g) => m.keysOf(g).lands.map((l) => t0 + delay[g] + l)); },
      focusLandFrames() { return fo ? words[fo.word].map((_, k) => kf.lands.map((l) => t0 + delay[fo.word] + k * fo.stagger + l)) : []; },
      events() {
        const ev = [], r1 = (v) => Math.round(v * 10) / 10;
        let firstW = -1;
        words.forEach((_, g) => { if (!(fo && g === fo.word) && (firstW < 0 || delay[g] < delay[firstW])) firstW = g; });
        words.forEach((w, g) => {
          const isF = fo && g === fo.word, letters = isF ? w.map((_, k) => k) : [0];
          for (const k of letters) {
            const st = t0 + delay[g] + (isF ? k * fo.stagger : 0), L = m.keysOf(g).lands.map((l) => st + l);
            L.forEach((land, j) => {
              const e = { f: r1(land), onset: r1(j ? L[j - 1] : st), land: r1(land), word: g, type: j ? (isF ? "letter_hop" : "word_hop") : isF ? "letter_land" : "word_land", tier: j === 0 && k === 0 ? "normal" : "detail" };
              if (isF) e.letter = k;
              if (j === 0 && k === 0 && (g === firstW || isF)) e.hint = isF ? "signature" : "first";
              ev.push(e);
            });
          }
        });
        return ev.sort((a, b) => a.f - b.f);
      },
    };
    return m;
  };

  // 칸 기준 등장 시각: cell_stagger(9~10프레임 = 1박) 규칙으로 n칸 시작 프레임
  KXP.cellStarts = (first, n, beatFrames) => Array.from({ length: n }, (_, i) => Math.round(first + i * (beatFrames || 9.47)));

  window.KXP = KXP;
})();
