// 프리셋 곡선(motion.json의 families·presets를 코드로). 모두 '진행 0→1'을 돌려준다. n = 시작에서 지난 프레임 수(소수 가능).
//   KM.curve.settle(n, a, r)          expo_settle: 첫 프레임에 a만큼, 이후 남은 거리 r배씩 (넘침 0)
//   KM.curve.accel(n, N, g)           expo_accel: 프레임당 이동이 g배씩, N에서 1 (그 뒤 하드컷)
//   KM.curve.table(prog, n, N)        정규화 표(motion.json progress)를 N프레임으로 늘이거나 줄여 읽기
//   KM.curve.bezier(x1,y1,x2,y2)      cubic-bezier 함수(t→진행)
//   KM.curve.hold(n, k)               on_twos: k프레임마다만 값이 바뀌게 n을 내림
//   KM.curve.fromPreset(p, N)         motion.json의 프리셋 객체 하나 → (n)=>진행 함수
//   KM.anim(f, f0, N, from, to, fn)   f0부터 N프레임 동안 from→to (fn은 위 함수 중 하나)
(function () {
  const C = {};
  C.settle = function (n, a, r) {
    if (n <= 0) return 0;
    if (n < 1) return a * n; // 첫 프레임 사이(서브프레임)는 선형
    const rem = (1 - a) * Math.pow(r, n - 1);
    return 1 - rem;
  };
  // 남은 거리가 epsPx 아래로 내려가면 1로 붙인다(거리 dist px 기준)
  C.settlePx = function (n, a, r, dist, epsPx) {
    const p = C.settle(n, a, r);
    return (1 - p) * Math.abs(dist) < (epsPx || 0.25) ? 1 : p;
  };
  C.accel = function (n, N, g) {
    if (n <= 0) return 0;
    if (n >= N) return 1;
    return (Math.pow(g, n) - 1) / (Math.pow(g, N) - 1);
  };
  C.table = function (prog, n, N) {
    const M = prog.length - 1;
    const x = N ? (n / N) * M : n;
    if (x <= 0) return prog[0];
    if (x >= M) return prog[M];
    const i = Math.floor(x), t = x - i;
    return prog[i] + (prog[i + 1] - prog[i]) * t;
  };
  C.bezier = function (x1, y1, x2, y2) {
    return function (t) {
      if (t <= 0) return 0;
      if (t >= 1) return 1;
      let u = t;
      for (let k = 0; k < 20; k++) {
        const bx = 3 * (1 - u) * (1 - u) * u * x1 + 3 * (1 - u) * u * u * x2 + u * u * u;
        const dx = 3 * (1 - u) * (1 - u) * x1 + 6 * (1 - u) * u * (x2 - x1) + 3 * u * u * (1 - x2);
        if (Math.abs(dx) < 1e-7) break;
        u = Math.min(1, Math.max(0, u - (bx - t) / dx));
      }
      return 3 * (1 - u) * (1 - u) * u * y1 + 3 * (1 - u) * u * u * y2 + u * u * u;
    };
  };
  C.hold = function (n, k) {
    return Math.floor((n + 1e-6) / k) * k;
  };
  // p = motion.json presets[name]. N을 주면 그 길이로 늘인다(없으면 측정 길이).
  C.fromPreset = function (p, N) {
    const c = p.curve;
    if (c && c.progress) return (n) => C.table(c.progress, n, N || c.frames);
    if (c && c.first_jump !== undefined) return (n) => C.settle(n, c.first_jump, c.ratio_per_frame);
    const v = p.values || {};
    if (p.family === "expo_accel" && v.g) return (n) => C.accel(n, N || 10, v.g);
    return (n) => Math.min(1, Math.max(0, n / (N || 10)));
  };
  // 자주 쓰는 이름 붙은 곡선(실측 값). 길이 N은 바꿔도 모양은 같다.
  C.named = {
    slideIn: (n) => C.settle(n, 0.44, 0.82),     // slide_in_expo (샷 3)
    cursorIn: (n) => C.settle(n, 0.25, 0.77),    // cursor_approach (샷 4)
    pushIn: (n) => C.settle(n, 0.17, 0.90),      // push_in_decay (샷 7, 카메라)
    cardZoom: (n) => C.settle(n, 0.19, 0.886),   // card_zoom_settle (샷 11)
    windowRise: (n) => C.settle(n, 0.57, 0.69),  // window_rise (샷 16)
    circleRise: (n) => C.settle(n, 0.51, 0.73),  // circle_rise_blur (샷 18)
    endcardIn: (n) => C.settle(n, 0.44, 0.884),  // glow_endcard_in (샷 19)
    exitUp: (n, N) => C.accel(n, N, 1.56),       // exit_accel (샷 3·4)
    scrollExit: (n, N) => C.accel(n, N, 1.45),   // scroll_exit_accel (샷 7)
    cursorOut: (n, N) => C.accel(n, N, 1.31),    // cursor_exit (샷 7)
    widen: (n, N) => C.accel(n, N, 1.37),        // frame_widen_accel (샷 11)
    edgeWipe: (n, N) => C.accel(n, N, 1.25),     // edge_wipe_exit (샷 12)
    pullback: (n, N) => C.accel(n, N, 1.39),     // pullback_accel (샷 15)
    endcardOut: (n, N) => C.accel(n, N, 1.36),   // glow_endcard_exit (샷 19)
  };
  // 버튼 눌림 배율 표(button_press, 12프레임) — 0.813까지 가속-감속, 되튐 없음
  C.PRESS = [1, 0.9976, 0.995, 0.99, 0.981, 0.976, 0.962, 0.885, 0.842, 0.828, 0.82, 0.817, 0.813];

  function anim(f, f0, N, from, to, fn) {
    const n = f - f0;
    if (n <= 0) return from;
    const p = fn(n, N);
    return from + (to - from) * p;
  }

  window.KM = window.KM || {};
  KM.curve = C;
  KM.anim = anim;
})();
