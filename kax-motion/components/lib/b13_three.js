/* KC3 덧붙임 — 3D 글자·타일·리본·창살 부품이 같이 쓰는 도우미. lib/b9_three.js 다음, 부품 .js보다 먼저 읽는다(일반 스크립트).
 *
 *   KC3.pxCam(T, env, fov)          화면 px 세계 카메라: z=0 평면에서 1단위 = 1px(1080p 기준), 원점 = 화면 가운데, y 위로 +.
 *                                   → {cam, D(카메라 거리)}. 부품은 위치를 px로 받아 그대로 쓴다.
 *   KC3.premul(m)                   재질을 미리 곱한 알파 덮기(ONE, ONE_MINUS_SRC_ALPHA)로
 *   KC3.addBlend(m)                 재질을 빛 더하기(색만 더하고 알파는 그대로)로
 *   KC3.pathShapes(d, s)            SVG 경로 문자열(절대 M L H V Q C Z, y 아래 +) → THREE.Shape[] (s배, y 위로 뒤집음, 구멍 자동)
 *   KC3.glyphs(role)                window.KC3_GLYPHS[role] (make_glyphs.py 자료) — 없으면 오류
 *   KC3.layoutText(G, text, o)      글자 배치 → [{ch, x, adv, shapes}] (em × o.size px), o.align "center"|"left"|"right", o.track(em 더함)
 *   KC3.pose(o, f, env, keys)       시작 자세 o.pose + 구간 o.moves[{at, dur, curve, curves?, to}] (초) → 그 프레임 자세(프레임 표 없음)
 *   KC3.gradBg(T, c, env)           바탕 셰이더: 위·아래 그라데이션 + 한 점 부드러운 빛(밝게만 — 가장자리 어둡게 없음 = 비네트 아님)
 *                                   c = {top, bottom, glow, glow_amt, glow_r, glow_x, glow_y(px)}
 *   KC3.fill(o, defaults, keys)     묶음 칸(객체 입력)을 기본값과 한 겹 더 합침(KC.make는 한 겹만)
 *   KC3.stableSeed(s)               문자열 → 정수 시드(KC.rng용)
 * 결정성: three 객체 만들기·그리기는 부품이 KC3.trusted(...) 안에서 부른다(b9_three.js 참고).
 */
(function () {
  "use strict";
  if (!window.KC3) throw new Error("b13_three.js: lib/b9_three.js를 먼저 읽는다");
  const KC3 = window.KC3;

  KC3.pxCam = function (T, env, fov) {
    fov = fov || 30;
    const D = env.height / 2 / Math.tan((fov * Math.PI) / 360);
    const cam = new T.PerspectiveCamera(fov, env.width / env.height, Math.max(1, D * 0.02), D * 40);
    cam.position.set(0, 0, D);
    cam.lookAt(0, 0, 0);
    return { cam, D };
  };

  KC3.premul = function (m) {
    const T = KC3.need();
    m.blending = T.CustomBlending; m.blendEquation = T.AddEquation;
    m.blendSrc = T.OneFactor; m.blendDst = T.OneMinusSrcAlphaFactor;
    m.blendSrcAlpha = T.OneFactor; m.blendDstAlpha = T.OneMinusSrcAlphaFactor;
    m.transparent = true;
    return m;
  };
  KC3.addBlend = function (m) {
    const T = KC3.need();
    m.blending = T.CustomBlending; m.blendEquation = T.AddEquation;
    m.blendSrc = T.OneFactor; m.blendDst = T.OneFactor;
    m.blendSrcAlpha = T.ZeroFactor; m.blendDstAlpha = T.OneFactor;
    m.transparent = true;
    return m;
  };

  // SVG 경로 → ShapePath. 숫자·명령만 읽는다(fontTools SVGPathPen 출력: 절대 좌표)
  KC3.pathShapes = function (d, s) {
    const T = KC3.need();
    s = s || 1;
    const sp = new T.ShapePath();
    const tok = d.match(/[MLHVQCZmlhvqcz]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
    let i = 0, cmd = null, cx = 0, cy = 0;
    const num = () => parseFloat(tok[i++]);
    const X = (v) => v * s, Y = (v) => -v * s;
    while (i < tok.length) {
      if (/[A-Za-z]/.test(tok[i])) cmd = tok[i++].toUpperCase();
      if (cmd === "Z") { cmd = null; continue; }
      if (cmd === "M") { cx = num(); cy = num(); sp.moveTo(X(cx), Y(cy)); cmd = "L"; }
      else if (cmd === "L") { cx = num(); cy = num(); sp.lineTo(X(cx), Y(cy)); }
      else if (cmd === "H") { cx = num(); sp.lineTo(X(cx), Y(cy)); }
      else if (cmd === "V") { cy = num(); sp.lineTo(X(cx), Y(cy)); }
      else if (cmd === "Q") { const a = num(), b = num(); cx = num(); cy = num(); sp.quadraticCurveTo(X(a), Y(b), X(cx), Y(cy)); }
      else if (cmd === "C") { const a = num(), b = num(), c = num(), e = num(); cx = num(); cy = num(); sp.bezierCurveTo(X(a), Y(b), X(c), Y(e), X(cx), Y(cy)); }
      else i++; // 모르는 토큰은 건너뜀
    }
    // 바깥/구멍 나누기: 서체마다 윤곽 방향 관례가 다르다(TrueType 시계·CFF 반시계, 가변 서체는 획이 겹침).
    // 가장 넓은 윤곽의 방향 = 바깥 방향. 같은 방향 = 채움, 반대 = 구멍(가장 작은 감싸는 채움에 붙임). 겹친 채움끼리는 둘 다 채움.
    const polys = sp.subPaths.map((p) => p.getPoints(6)).filter((q) => q.length > 2);
    if (!polys.length) return [];
    const area = (q) => { let a = 0; for (let i = 0; i < q.length; i++) { const r = q[(i + 1) % q.length]; a += q[i].x * r.y - r.x * q[i].y; } return a / 2; };
    const A = polys.map(area);
    let big = 0;
    A.forEach((a, i) => { if (Math.abs(a) > Math.abs(A[big])) big = i; });
    const sgn = Math.sign(A[big]) || 1;
    const inside = (pt, q) => { let c = false; for (let i = 0, j = q.length - 1; i < q.length; j = i++) { if ((q[i].y > pt.y) !== (q[j].y > pt.y) && pt.x < ((q[j].x - q[i].x) * (pt.y - q[i].y)) / (q[j].y - q[i].y) + q[i].x) c = !c; } return c; };
    const solids = [], shapes = [];
    polys.forEach((q, i) => { if (Math.sign(A[i]) === sgn) { const sh = new T.Shape(q); solids.push({ q, a: Math.abs(A[i]), sh }); shapes.push(sh); } });
    polys.forEach((q, i) => {
      if (Math.sign(A[i]) === sgn) return;
      let best = null;
      for (const s0 of solids) if (inside(q[0], s0.q) && (!best || s0.a < best.a)) best = s0;
      if (best) best.sh.holes.push(new T.Path(q));
    });
    return shapes;
  };

  KC3.glyphs = function (role) {
    const G = window.KC3_GLYPHS && window.KC3_GLYPHS[role];
    if (!G) throw new Error(`KC3.glyphs: KC3_GLYPHS["${role}"] 없음 — make_glyphs.py로 만든 glyphs.js를 먼저 읽는다`);
    return G;
  };

  // 글자 배치(em → px). 각 글자 shapes는 펜 원점(기준선 왼쪽) 기준 px
  KC3.layoutText = function (G, text, o) {
    o = o || {};
    const size = o.size || 200, track = o.track || 0;
    const out = [];
    let x = 0;
    for (const ch of Array.from(text)) {
      const g = G.chars[ch];
      if (!g) throw new Error(`KC3.layoutText: '${ch}' 윤곽 없음 — make_glyphs.py에 그 글자를 넣어 다시 만든다`);
      const adv = (g.adv + track) * size;
      out.push({ ch, x, adv, ko: !!g.ko, shapes: g.d ? KC3.pathShapes(g.d, size) : [] });
      x += adv;
    }
    const W = x - track * size;
    const off = o.align === "left" ? 0 : o.align === "right" ? -W : -W / 2;
    for (const c of out) c.x += off;
    out.width = W;
    return out;
  };

  KC3.pose = function (o, f, env, keys) {
    const p = {};
    const P0 = o.pose || {};
    for (const k of keys) p[k] = P0[k] === undefined ? 0 : P0[k];
    const n = f - (o.f0 || 0);
    for (const m of o.moves || []) {
      const N = Math.max(1e-3, KC.frames(m.dur, env)), a = KC.frames(m.at || 0, env);
      if (n <= a) break;
      const u = Math.min(n - a, N);
      const t = KC.curve(m.curve || { fn: "smooth" }, N, env)(u);
      const cur = {};
      for (const k of keys) {
        if (!m.to || m.to[k] === undefined) continue;
        const ck = m.curves && m.curves[k] ? KC.curve(m.curves[k], N, env)(u) : t;
        cur[k] = p[k] + (m.to[k] - p[k]) * ck;
      }
      Object.assign(p, cur);
    }
    return p;
  };

  const BG_FS = `uniform vec3 uTop; uniform vec3 uBot; uniform vec3 uGlow; uniform vec3 uGl; uniform vec2 uRes; varying vec2 vUv;
void main() {
  vec3 c = mix(uBot, uTop, smoothstep(0.0, 1.0, vUv.y));
  vec2 p = (vUv - uGl.xy) * vec2(uRes.x / uRes.y, 1.0);
  c += uGlow * exp(-dot(p, p) / (uGl.z * uGl.z));
  gl_FragColor = vec4(c, 1.0);
}`;
  KC3.gradBg = function (T, c, env) {
    const L = (x) => KC3.lin(x);
    return new T.ShaderMaterial({
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`, fragmentShader: BG_FS,
      depthTest: false, depthWrite: false,
      uniforms: {
        uTop: { value: new T.Vector3(...L(c.top)) }, uBot: { value: new T.Vector3(...L(c.bottom)) },
        uGlow: { value: new T.Vector3(...L(c.glow || "#000000").map((v) => v * (c.glow_amt || 0))) },
        uGl: { value: new T.Vector3((c.glow_x === undefined ? env.width / 2 : c.glow_x) / env.width, 1 - (c.glow_y === undefined ? env.height / 2 : c.glow_y) / env.height, c.glow_r || 0.45) },
        uRes: { value: new T.Vector2(env.width, env.height) },
      },
    });
  };

  // KC.make는 기본값을 한 겹만 합친다 → 묶음 칸(예: orbit, camera)은 부품이 기본값과 한 번 더 합친다(한 단계 아래까지).
  KC3.fill = function (o, defaults, keys) {
    for (const k of keys) {
      const d = defaults[k], v = o[k];
      if (v && d && typeof v === "object" && typeof d === "object" && !Array.isArray(v) && !Array.isArray(d) && v !== d) o[k] = Object.assign({}, d, v);
    }
    return o;
  };

  KC3.stableSeed = function (s) {
    let h = 2166136261;
    for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
    return h;
  };
})();
