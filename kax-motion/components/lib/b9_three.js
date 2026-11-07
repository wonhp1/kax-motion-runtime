/* KC3 — 3D 부품(webgl, three.js r186) 공용 도우미. 부품 .js보다 먼저, kc.js 뒤에 읽는다(일반 스크립트).
 *
 * three.js는 ES 모듈이라 일반 스크립트인 부품이 바로 import할 수 없다. 데모(또는 엔진)가 모듈 스크립트에서
 *   import * as THREE from "three"; import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
 *   KC3.install(THREE, { RoomEnvironment });
 * 를 부른 다음에 KC.make(3D 부품)를 한다. importmap은 저장소 기준 경로:
 *   {"imports": {"three": "components/vendor/three-r186/build/three.module.js",
 *                "three/addons/": "components/vendor/three-r186/examples/jsm/"}}
 * (stage.py는 importmap 경로를 못 읽으므로 demo/stage.json의 copy에 "components/vendor/three-r186"을 넣는다.)
 *
 *   KC3.install(THREE, addons)     THREE·addons 등록(한 번)
 *   KC3.T                          THREE
 *   KC3.trusted(fn)                three 객체 만들기·그리기를 감싼다 — 아래 '결정성' 참고
 *   KC3.surface(el, env, o)        el 안에 env 크기 캔버스 + WebGLRenderer(preserveDrawingBuffer) → {canvas, renderer}
 *   KC3.roundRect(w, h, r)         가운데 원점 둥근 사각 THREE.Shape(y 위)
 *   KC3.env(renderer, kind)        반사용 환경 텍스처(PMREM). kind "room"(RoomEnvironment) | "soft"(밝은 스튜디오 판 3개)
 *   KC3.ramp(v, f, f0, env)        숫자 또는 {from, to, at, dur, curve} → 그 프레임 값(at·dur 초, f0부터)
 *   KC3.lin(c)                     색 입력 → 선형 RGB [r,g,b] (0..1)
 *
 * 결정성: three는 객체를 만들 때 uuid를 Math.random으로 만든다(그림과 상관없음). KC 개발 모드는 부품 안 Math.random을 던지게
 * 하므로, KC3.trusted가 그동안만 Math.random을 시드 난수(KC.rng)로 바꿔 끼운다 → uuid도 매번 같고 금지 검사도 깨지지 않는다.
 * 부품 자체 코드의 난수는 여전히 KC.rng(seed)만 쓴다. 다른 금지 호출(Date·performance.now·타이머)은 그대로 막힌다.
 */
(function () {
  "use strict";
  const KC3 = {};
  let resolveReady;
  KC3.ready = new Promise((r) => { resolveReady = r; });
  KC3.T = null;
  KC3.addons = {};
  KC3.install = function (THREE, addons) {
    KC3.T = THREE;
    KC3.addons = Object.assign({}, KC3.addons, addons || {});
    resolveReady(THREE);
    return THREE;
  };
  KC3.need = function () {
    if (!KC3.T) throw new Error("KC3: three.js가 아직 없음 — 모듈 스크립트에서 KC3.install(THREE, addons)를 먼저 부른다");
    return KC3.T;
  };
  let seedN = 0x6b6333;
  KC3.trusted = function (fn) {
    const saved = Math.random;
    Math.random = KC.rng(seedN++);
    try { return fn(); } finally { Math.random = saved; }
  };

  KC3.surface = function (el, env, o) {
    const T = KC3.need();
    o = o || {};
    const cv = document.createElement("canvas");
    cv.width = env.width; cv.height = env.height;
    cv.setAttribute("style", `position:absolute;left:0;top:0;width:${env.width}px;height:${env.height}px;display:block`);
    el.appendChild(cv);
    const renderer = KC3.trusted(() => new T.WebGLRenderer({
      canvas: cv, antialias: false, alpha: o.alpha !== false, premultipliedAlpha: true, preserveDrawingBuffer: true, powerPreference: "high-performance",
    }));
    renderer.setPixelRatio(1);
    renderer.setSize(env.width, env.height, false);
    renderer.outputColorSpace = T.LinearSRGBColorSpace; // 후처리 마지막(final)이 sRGB로 바꾼다
    renderer.toneMapping = T.NoToneMapping;
    renderer.autoClear = false;
    return { canvas: cv, renderer };
  };

  KC3.roundRect = function (w, h, r) {
    const T = KC3.need();
    r = Math.min(r, w / 2, h / 2);
    const x0 = -w / 2, y0 = -h / 2, s = new T.Shape();
    s.moveTo(x0 + r, y0);
    s.lineTo(x0 + w - r, y0); s.absarc(x0 + w - r, y0 + r, r, -Math.PI / 2, 0, false);
    s.lineTo(x0 + w, y0 + h - r); s.absarc(x0 + w - r, y0 + h - r, r, 0, Math.PI / 2, false);
    s.lineTo(x0 + r, y0 + h); s.absarc(x0 + r, y0 + h - r, r, Math.PI / 2, Math.PI, false);
    s.lineTo(x0, y0 + r); s.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, false);
    return s;
  };

  // 반사 환경. "room" = three RoomEnvironment(PMREM 시그마 0.04). "soft" = 위·왼·오른 큰 빛 판 3개(밝은 스튜디오, 코드로 만든 것)
  const envCache = new WeakMap();
  KC3.env = function (renderer, kind) {
    const T = KC3.need();
    kind = kind || "room";
    let m = envCache.get(renderer);
    if (!m) { m = {}; envCache.set(renderer, m); }
    if (m[kind]) return m[kind];
    m[kind] = KC3.trusted(() => {
      const pm = new T.PMREMGenerator(renderer);
      let sc;
      if (kind === "room") {
        if (!KC3.addons.RoomEnvironment) throw new Error("KC3.env room: addons.RoomEnvironment 필요");
        sc = new KC3.addons.RoomEnvironment();
      } else {
        sc = new T.Scene();
        sc.background = new T.Color(0.08, 0.085, 0.095);
        const box = new T.BoxGeometry(1, 1, 1);
        const lit = (x, y, z, sx, sy, sz, k) => { const mm = new T.Mesh(box, new T.MeshBasicMaterial({ color: new T.Color(k, k, k) })); mm.position.set(x, y, z); mm.scale.set(sx, sy, sz); sc.add(mm); };
        lit(0, 9, 0, 14, 0.2, 8, 3.2); lit(-9, 2, 2, 0.2, 6, 10, 1.6); lit(9, 1, -2, 0.2, 5, 7, 1.0); lit(0, 1, 9, 6, 3, 0.2, 0.6);
      }
      const tex = pm.fromScene(sc, 0.04).texture;
      pm.dispose();
      return tex;
    });
    return m[kind];
  };

  KC3.ramp = function (v, f, f0, env) {
    if (v === null || v === undefined) return 0;
    if (typeof v === "number") return v;
    if (typeof v === "function") return v(f);
    const N = KC.frames(v.dur || 0.5, env), n = f - (f0 || 0) - KC.frames(v.at || 0, env);
    const P = KC.curve(v.curve || { fn: "smooth" }, N, env);
    const p = n <= 0 ? 0 : P(n);
    return (v.from || 0) + ((v.to === undefined ? 1 : v.to) - (v.from || 0)) * p;
  };

  const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  KC3.lin = function (c) {
    const q = KC.color(c);
    return [s2l(q[0] / 255), s2l(q[1] / 255), s2l(q[2] / 255)];
  };

  window.KC3 = KC3;
})();
