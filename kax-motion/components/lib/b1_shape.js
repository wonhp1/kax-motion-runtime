/* B1 — 모양·버튼·로고 부품이 같이 쓰는 도우미. kc.js 다음, 이 도우미를 쓰는 부품 .js보다 먼저 읽는다.
 *
 *   B1.spring(f_hz, zeta)          → (t초) => 0..1(넘침 있음) 감쇠 스프링 계단 응답(처음 속도 0)
 *   B1.curve(spec, N, env)         KC.curve + {"fn":"spring","args":[f_hz, zeta], "t0": 늦춤초} (프레임 n → 초 n/env.fps)
 *   B1.track(keys, axis, t, sp)    키 목록을 스프링으로 이어 붙임(키마다 '목표 바꾸기' — 스프링 겹침, 축별 스프링)
 *   B1.rrect(ctx, cx, cy, w, h, r) 가운데 기준 둥근 사각 경로(원형 모서리, beginPath 포함). r은 min(w,h)/2로 자름
 *   B1.icon(name)                  코드로 그린 선 아이콘 → 획 목록 [[x,y]...](단위 상자 -0.5..0.5)
 *   B1.strokeIcon(ctx, name, cx, cy, size, {width, color, prog, from})  선 아이콘 그리기(prog: 0..1 길이 자르기)
 *   B1.hop(tSec, height, rise, fall, curves)  위로 튀었다 떨어짐(실측 곡선, 픽셀 위쪽 +)
 *   B1.mix(c1, c2, t) → "rgba(...)"  두 색 섞기(KC.color 꼴 입력)
 * 결정적: 모두 순수 함수(f·t만 봄). 난수 없음.
 * 스프링 값은 각 부품 presets.json(측정 출처) — 여기에는 모양만.
 */
(function () {
  "use strict";
  const B1 = {};
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  B1.spring = function (f, z) {
    const w = 2 * Math.PI * f;
    if (z < 1) {
      const wd = w * Math.sqrt(1 - z * z), k = (z * w) / wd;
      return (t) => (t <= 0 ? 0 : 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + k * Math.sin(wd * t)));
    }
    return (t) => (t <= 0 ? 0 : 1 - Math.exp(-w * t) * (1 + w * t));
  };
  // spec이 스프링이면 (n 프레임) => 값, 아니면 KC.curve 그대로
  B1.curve = function (spec, N, env) {
    if (spec && spec.fn === "spring") {
      const fps = (env && env.fps) || 30000 / 1001;
      const s = B1.spring(spec.args[0], spec.args[1]), t0 = spec.t0 || 0;
      return (n) => s(n / fps - t0);
    }
    return KC.curve(spec, N, env);
  };
  // 키 목록 [{t, <axis>: 값}, ...](t 오름차순, 초)을 축별 스프링으로 잇는다.
  // 첫 키 값에서 시작해, 키 k의 t부터 (v_k − v_{k−1})만큼 스프링 계단을 더한다(겹쳐 쌓임 = 움직이는 중 목표 바꾸기).
  // sp = {f, z, delay}(초). 값이 없는 키는 앞 값 유지.
  B1.track = function (keys, axis, t, sp) {
    const S = sp._s || (sp._s = B1.spring(sp.f, sp.z));
    const d = sp.delay || 0;
    let prev = null, v = 0;
    for (let i = 0; i < keys.length; i++) {
      const q = keys[i][axis];
      if (q === undefined || q === null) continue;
      if (prev === null) { v = q; prev = q; continue; }
      v += (q - prev) * S(t - keys[i].t - d);
      prev = q;
    }
    return v;
  };

  B1.rrect = function (ctx, cx, cy, w, h, r) {
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

  /* ---------- 선 아이콘(코드 그림) ----------
     단위 상자 -0.5..0.5. 획 = 점 목록. 호는 점으로 편다. */
  const arc = (cx, cy, r, a0, a1, n) => {
    const P = []; n = n || 24;
    for (let i = 0; i <= n; i++) { const a = ((a0 + (a1 - a0) * (i / n)) * Math.PI) / 180; P.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    return P;
  };
  const ICONS = {
    check: () => [[[-0.3, 0.02], [-0.09, 0.24], [0.32, -0.2]]],
    plus: () => [[[0, -0.32], [0, 0.32]], [[-0.32, 0], [0.32, 0]]],
    arrow_up: () => [[[0, 0.32], [0, -0.3]], [[-0.24, -0.08], [0, -0.32], [0.24, -0.08]]],
    arrow_right: () => [[[-0.32, 0], [0.3, 0]], [[0.08, -0.24], [0.32, 0], [0.08, 0.24]]],
    play: () => [[[-0.18, -0.28], [0.3, 0], [-0.18, 0.28], [-0.18, -0.28]]],
    heart: () => {
      const L = arc(-0.15, -0.1, 0.16, 140, 360, 20), R = arc(0.15, -0.1, 0.16, 180, 400, 20);
      return [[[0, 0.32]].concat(L.slice(0)).concat(R.slice(1)).concat([[0, 0.32]])];
    },
    star: () => {
      const P = [];
      for (let i = 0; i <= 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 0.15 : 0.36; P.push([r * Math.cos(a), 0.03 + r * Math.sin(a)]); }
      return [P];
    },
    bolt: () => [[[0.06, -0.36], [-0.2, 0.04], [0.02, 0.04], [-0.06, 0.36], [0.2, -0.06], [-0.02, -0.06], [0.06, -0.36]]],
    lock: () => [[[-0.16, 0.02]].concat(arc(0, -0.1, 0.16, 180, 360, 16)).concat([[0.16, 0.02]]), [[-0.24, 0.02], [0.24, 0.02], [0.24, 0.34], [-0.24, 0.34], [-0.24, 0.02]], [[0, 0.14], [0, 0.22]]],
    bell: () => [[[-0.26, 0.18]].concat(arc(0, -0.06, 0.2, 180, 360, 20)).concat([[0.26, 0.18], [-0.26, 0.18]]), arc(0, 0.24, 0.07, 0, 180, 10)],
    cloud_up: () => [arc(-0.16, 0.06, 0.14, 90, 270, 12).concat(arc(0.02, -0.06, 0.2, 200, 340, 14)).concat(arc(0.2, 0.07, 0.13, 270, 450, 12)).concat([[-0.16, 0.2]]), [[0, 0.3], [0, 0.02]], [[-0.1, 0.12], [0, 0.02], [0.1, 0.12]]],
    moon: () => [arc(0, 0, 0.3, 17.6, 271.4, 30).concat(arc(0.14, -0.1, 0.24, 236.5, 52.4, 20).slice(1))], // 초승달: 큰 원 긴 호 + 안쪽 원 짧은 호(두 원 교점에서 잼)
    leaf: () => { // 잎(두 호가 만나는 볼록 렌즈) + 잎맥
      const P1 = [-0.27, 0.27], P2 = [0.29, -0.29], n = [-Math.SQRT1_2, -Math.SQRT1_2], U = [], L = [];
      for (let i = 0; i <= 20; i++) { const t = i / 20, k = 0.2 * Math.sin(Math.PI * t); U.push([P1[0] + (P2[0] - P1[0]) * t + n[0] * k, P1[1] + (P2[1] - P1[1]) * t + n[1] * k]); }
      for (let i = 20; i >= 0; i--) { const t = i / 20, k = -0.2 * Math.sin(Math.PI * t); L.push([P1[0] + (P2[0] - P1[0]) * t + n[0] * k, P1[1] + (P2[1] - P1[1]) * t + n[1] * k]); }
      return [U.concat(L.slice(1)), [[-0.36, 0.36], [0.1, -0.1]]];
    },
    spark: () => [[[0, -0.36], [0.06, -0.06], [0.36, 0], [0.06, 0.06], [0, 0.36], [-0.06, 0.06], [-0.36, 0], [-0.06, -0.06], [0, -0.36]]],
    circle: () => [arc(0, 0, 0.32, -90, 270, 36)],
    face: () => [[[-0.17, -0.14], [-0.17, -0.04]], [[0.17, -0.14], [0.17, -0.04]], arc(0, 0.02, 0.18, 30, 150, 14)],
  };
  B1.iconNames = Object.keys(ICONS);
  const cache = {};
  B1.icon = function (name) {
    if (cache[name]) return cache[name];
    const g = ICONS[name];
    if (!g) throw new Error("B1.icon: 없는 아이콘 " + name + " (있는 것: " + B1.iconNames.join(", ") + ")");
    const strokes = g().map((P) => {
      const cum = [0];
      for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
      return { P, cum, L: cum[cum.length - 1] };
    });
    const total = strokes.reduce((a, s) => a + s.L, 0);
    return (cache[name] = { strokes, total });
  };
  // 아이콘 획을 차례로 그린다. prog 0..1 = 전체 길이 중 그릴 몫(획 순서대로), from 0..1 = 앞에서 지운 몫
  B1.strokeIcon = function (ctx, name, cx, cy, size, o) {
    o = o || {};
    const I = B1.icon(name);
    const p1 = clamp(o.prog === undefined ? 1 : o.prog, 0, 1) * I.total, p0 = clamp(o.from || 0, 0, 1) * I.total;
    if (p1 - p0 <= 1e-4) return;
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(size, size);
    ctx.lineWidth = (o.width || size * 0.08) / size;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = o.color || "#fff";
    ctx.beginPath();
    let acc = 0;
    for (const s of I.strokes) {
      const a = clamp(p0 - acc, 0, s.L), b = clamp(p1 - acc, 0, s.L);
      acc += s.L;
      if (b - a <= 1e-5) continue;
      const pt = (d) => {
        let i = 1; while (i < s.cum.length - 1 && s.cum[i] < d) i++;
        const t = (d - s.cum[i - 1]) / Math.max(1e-9, s.cum[i] - s.cum[i - 1]);
        return [s.P[i - 1][0] + (s.P[i][0] - s.P[i - 1][0]) * t, s.P[i - 1][1] + (s.P[i][1] - s.P[i - 1][1]) * t, i];
      };
      const A = pt(a), B = pt(b);
      ctx.moveTo(A[0], A[1]);
      for (let i = A[2]; i < B[2]; i++) ctx.lineTo(s.P[i][0], s.P[i][1]);
      ctx.lineTo(B[0], B[1]);
    }
    ctx.stroke();
    ctx.restore();
  };

  // 위로 튀었다 떨어짐: tSec(시작부터 초) → 위쪽 변위 px(≥0). rise·fall 초. 실측 곡선(튀는 로고 20프레임 @60)
  const HOP_RISE = KC.ease.bezier(0.263, -0.067, 0.207, 1.045), HOP_FALL = KC.ease.bezier(0.309, -0.004, 0.821, -0.007);
  B1.hop = function (t, height, rise, fall) {
    if (t <= 0) return 0;
    if (t < rise) return height * HOP_RISE(t / rise);
    const u = (t - rise) / fall;
    if (u >= 1) return 0;
    return height * (1 - HOP_FALL(u)); // HOP_FALL = 꼭대기(0) → 바닥(1)으로 가속하는 측정 진행
  };

  B1.mix = function (c1, c2, t) {
    const a = KC.color(c1), b = KC.color(c2);
    t = clamp(t, 0, 1);
    return `rgba(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)},${(a[3] + (b[3] - a[3]) * t).toFixed(4)})`;
  };
  B1.clamp = clamp;
  window.B1 = B1;
})();
