/* KCG — 유리 WebGL 부품 공용 도우미. three 없이 WebGL2. kc.js 뒤, 부품 .js 앞에 읽는다(일반 스크립트).
 *
 *   KCG.src(spec, env)            뒤 배경 입력 → (f) => 그림 원본(canvas|img). spec: function(ctx, f) | canvas | img | "CSS 선택자"
 *                                  함수면 화면 밖 2D 캔버스(willReadFrequently — 처음부터 CPU 캔버스라 그리기 방식이 안 바뀜)에 매 프레임 그림
 *   KCG.ramp(v, f, f0, env)        숫자 | {from, to, at, dur, curve} → 그 프레임 값(at·dur 초, f0부터)
 *   KCG.wobble(t, w)               젤리 출렁임(로그 가로세로비): w = {amp, period, decay, phase} 초 단위, t 초(<0이면 0)
 *   KCG.surface(el, env, alpha)    el 안에 env 크기 캔버스 + WebGL2(preserveDrawingBuffer) → G
 *   KCG.Lens(G)                    유리 렌즈 엔진(4패스: 내용 → 가로 흐림 → 세로 흐림 → 합성) — glass.liquid_lens·transition.glass_portal
 *   KCG.Warp(G)                    사영 변환·화면 고정 배럴 휘기 + 사본 평균(셔터) — ui.widget_tilt_morph_card·fx.barrel_wall_warp
 *   KCG.homog(src4, dst4), KCG.inv3(m), KCG.mul3(a, b)   3×3 행렬(행 우선 9개)
 *
 * 좌표: 모두 화면 px, 위가 0(1920×1080 기준). 셰이더 안에서 gl_FragCoord를 뒤집어 맞춘다.
 * 결정성: 그림은 f로만 정해진다(시간·난수 없음). 소프트웨어 렌더(SwiftShader)와 GPU 렌더는 화소가 조금 다르다 → 골든은 소프트웨어로만.
 */
(function () {
  "use strict";
  const KCG = {};
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  /* ---------- 입력 ---------- */
  KCG.src = function (spec, env) {
    if (!spec) return () => null;
    if (typeof spec === "function") {
      let cv = null, ctx = null;
      return function (f) {
        if (!cv) {
          cv = document.createElement("canvas");
          cv.width = env.width; cv.height = env.height;
          ctx = cv.getContext("2d", { willReadFrequently: true });
        }
        // 캐시 없음: 같은 f라도 다시 그린다(서체가 늦게 들어온 뒤 hf.render(0)을 다시 부르는 데모가 낡은 그림을 쓰지 않게)
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over"; ctx.filter = "none";
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.save(); spec(ctx, f); ctx.restore();
        return cv;
      };
    }
    if (typeof spec === "string") return () => document.querySelector(spec);
    return () => spec;
  };

  KCG.ramp = function (v, f, f0, env) {
    if (v === null || v === undefined) return 0;
    if (typeof v === "number") return v;
    if (typeof v === "function") return v(f);
    const N = KC.frames(v.dur || 0.5, env), n = f - (f0 || 0) - KC.frames(v.at || 0, env);
    const P = KC.curve(v.curve || { fn: "smooth" }, N, env);
    const p = n <= 0 ? 0 : P(n);
    return (v.from || 0) + ((v.to === undefined ? 1 : v.to) - (v.from || 0)) * p;
  };

  // 젤리: A·e^(−t/τ)·sin(2πt/T + φ) (실측 방울 가로세로 로그비에 맞춘 꼴)
  KCG.wobble = function (t, w) {
    if (!w || !(t > 0)) return 0;
    return (w.amp || 0) * Math.exp(-t / (w.decay || 0.3)) * Math.sin(2 * Math.PI * t / (w.period || 0.5) + (w.phase || 0));
  };

  /* ---------- WebGL2 바탕 ---------- */
  const VS = `#version 300 es
in vec2 aP; void main(){ gl_Position = vec4(aP, 0.0, 1.0); }`;

  KCG.surface = function (el, env, alpha) {
    const cv = document.createElement("canvas");
    cv.width = env.width; cv.height = env.height;
    cv.setAttribute("style", `position:absolute;left:0;top:0;width:${env.width}px;height:${env.height}px;display:block`);
    el.appendChild(cv);
    const gl = cv.getContext("webgl2", { preserveDrawingBuffer: true, premultipliedAlpha: true, alpha: alpha !== false, antialias: false, depth: false, stencil: false });
    if (!gl) throw new Error("KCG: WebGL2 없음");
    // 반정밀 실수 렌더 대상: 확장이 있어도 소프트웨어 렌더에서 FBO가 불완전할 수 있어 1×1로 확인한다(불완전하면 RGBA8)
    let half = !!gl.getExtension("EXT_color_buffer_float");
    if (half) {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 1, 1, 0, gl.RGBA, gl.HALF_FLOAT, null);
      const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      half = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fb); gl.deleteTexture(t);
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const G = { cv, gl, W: env.width, H: env.height, half, vao };
    G.prog = function (fs) {
      const mk = (type, src) => {
        const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("KCG 셰이더: " + gl.getShaderInfoLog(s));
        return s;
      };
      const p = gl.createProgram();
      gl.attachShader(p, mk(gl.VERTEX_SHADER, VS)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
      gl.bindAttribLocation(p, 0, "aP"); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("KCG 링크: " + gl.getProgramInfoLog(p));
      p.u = {};
      const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); p.u[info.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(p, info.name); }
      return p;
    };
    G.tex = function (w, h, float) {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (w) {
        if (float && half) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
        else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      }
      return t;
    };
    G.fbo = function (tex) { const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0); return f; };
    // 원본 올리기(매번 — 원본 캔버스가 같은 f에서도 바뀔 수 있음)
    G.upload = function (tex, img) {
      if (!img) return false;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
      tex._w = img.width || img.naturalWidth; tex._h = img.height || img.naturalHeight;
      return true;
    };
    G.bindTex = function (unit, tex, prog, name) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(prog.u[name], unit); };
    // 화면 위 0 기준 상자 [x0,y0,x1,y1] → 시저(아래 0 기준)
    G.scissor = function (box) {
      if (!box) { gl.disable(gl.SCISSOR_TEST); return; }
      const x0 = clamp(Math.floor(box[0]), 0, G.W), x1 = clamp(Math.ceil(box[2]), 0, G.W);
      const y0 = clamp(Math.floor(box[1]), 0, G.H), y1 = clamp(Math.ceil(box[3]), 0, G.H);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(x0, G.H - y1, Math.max(0, x1 - x0), Math.max(0, y1 - y0));
    };
    G.draw = function () { gl.bindVertexArray(vao); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); };
    return G;
  };

  /* ---------- 공통 GLSL ---------- */
  const HEAD = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform vec2 uSZ;
`;
  // 모양 거리: 안쪽 +(px), n = 바깥 방향 단위 법선(위가 0 좌표). 0 타원(방울), 1 둥근 사각(알약 = 모서리 = 짧은 반지름)
  const SDF = `
uniform int uShape; uniform vec2 uC; uniform vec2 uHalf; uniform float uCorner;
float lensD(vec2 p, out vec2 n) {
  vec2 v = p - uC;
  if (uShape == 0) {
    vec2 g = v / (uHalf * uHalf);
    float rho = length(v / uHalf), gl = length(g);
    n = gl > 1e-7 ? g / gl : vec2(0.0, -1.0);
    return gl > 1e-7 ? (1.0 - rho) * rho / gl : min(uHalf.x, uHalf.y);
  }
  float r = min(uCorner, min(uHalf.x, uHalf.y));
  vec2 q = abs(v) - (uHalf - vec2(r));
  vec2 sg = vec2(v.x < 0.0 ? -1.0 : 1.0, v.y < 0.0 ? -1.0 : 1.0);
  if (q.x > 0.0 && q.y > 0.0) n = normalize(q) * sg;
  else if (q.x > q.y) n = vec2(sg.x, 0.0);
  else n = vec2(0.0, sg.y);
  return -(length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r);
}
`;

  // 1) 내용: 옛 장면을 렌즈로 굴절(안쪽 확대 mag + 테 띠에서 안쪽으로 Δ(d) 당김: s(d)=d+Δ(d) + 채널 분산),
  //    새 장면은 방울 안 어안 지도 s(ρ)=Z·sin(πρ/2)(잰 반지름 지도를 이 식 하나로, 채널별 Z) 또는 정착(전체 화면 확대 M + 배럴 k2), w로 섞음
  const FS_CONTENT = HEAD + SDF + `
uniform sampler2D uOld, uNew;
uniform float uLensOn, uMag, uRimB, uDisp, uPow, uChroma;
uniform float uW; uniform int uNewMode; uniform vec3 uNewZ; uniform vec3 uSettle;
out vec4 o;
vec4 sOld(vec2 q) { return texture(uOld, q / uSZ); }
void main() {
  vec2 p = vec2(gl_FragCoord.x, uSZ.y - gl_FragCoord.y);
  vec2 n; float d = lensD(p, n);
  vec2 v = p - uC;
  vec4 old;
  if (uLensOn < 0.5 || d < -1.0) old = sOld(p);
  else {
    vec2 base = uC + v / uMag;
    float t = clamp(1.0 - max(d, 0.0) / max(uRimB, 1e-3), 0.0, 1.0);
    float D = uDisp * pow(t, uPow);
    old = sOld(base - n * D);
    if (uChroma > 0.0 && D > 0.0) {
      old.r = sOld(base - n * D * (1.0 + uChroma)).r;
      old.b = sOld(base - n * D * (1.0 - uChroma)).b;
    }
  }
  vec4 nw = vec4(0.0);
  if (uW > 0.0) {
    if (uNewMode == 0) {
      float rho = length(v / uHalf);
      float k = rho > 1e-5 ? sin(1.5707963 * min(rho, 1.0)) / rho : 1.5707963;
      vec4 g = texture(uNew, (uC + v * (uNewZ.y * k)) / uSZ);
      nw = vec4(texture(uNew, (uC + v * (uNewZ.x * k)) / uSZ).r, g.g, texture(uNew, (uC + v * (uNewZ.z * k)) / uSZ).b, g.a);
    } else {
      float r2 = dot(v, v) / (uSettle.z * uSettle.z);
      nw = texture(uNew, (uC + v * (1.0 / uSettle.x) * (1.0 + uSettle.y * r2)) / uSZ);
    }
  }
  o = mix(old, nw, uW);
}`;

  // 2·3) 가우스(한 방향, 쌍선형 두 탭 묶기). σ ≤ 32
  const FS_BLUR = HEAD + `
uniform sampler2D uSrc; uniform vec2 uDir; uniform float uSig;
out vec4 o;
void main() {
  vec2 fc = gl_FragCoord.xy;
  float s = max(uSig, 0.3); float R = ceil(3.0 * s);
  vec4 acc = texture(uSrc, fc / uSZ); float ws = 1.0;
  for (int i = 1; i <= 96; i += 2) {
    float fi = float(i); if (fi > R) break;
    float w1 = exp(-0.5 * fi * fi / (s * s)), w2 = exp(-0.5 * (fi + 1.0) * (fi + 1.0) / (s * s));
    float w = w1 + w2, off = (fi * w1 + (fi + 1.0) * w2) / w;
    acc += (texture(uSrc, (fc + uDir * off) / uSZ) + texture(uSrc, (fc - uDir * off) / uSZ)) * w; ws += 2.0 * w;
  }
  o = acc / ws;
}`;

  // 4) 합성: 안쪽 = 흐린 내용 + 우윳빛·채도 빼기·안쪽 광택·테 빛·무지갯빛·테 안쪽 어두운 선, 바깥 = (확대된) 옛 장면 × (1 − 그림자)
  //    outside 모드 1(투명)이면 바깥은 그림자만(검정 알파). 비네트 없음.
  const FS_FINAL = HEAD + SDF + `
uniform sampler2D uCont, uOut;
uniform int uOutMode; uniform float uOutZoom; uniform float uAlpha; uniform float uPlain;
uniform vec4 uShadow;
uniform vec3 uMilkCol; uniform float uMilk, uDesat, uSheen, uRimLight, uRimW, uRimB, uIrid, uEdgeDark;
uniform vec2 uLight;
out vec4 o;
float erf_(float x) { float s = sign(x); x = abs(x); float t = 1.0 / (1.0 + 0.3275911 * x);
  return s * (1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-x * x)); }
vec3 screen(vec3 a, vec3 b) { return 1.0 - (1.0 - a) * (1.0 - b); }
void main() {
  vec2 fc = gl_FragCoord.xy;
  vec2 p = vec2(fc.x, uSZ.y - fc.y);
  if (uPlain > 0.5) { o = texture(uCont, fc / uSZ); return; }
  vec2 n; float d = lensD(p, n);
  vec2 v = p - uC;
  vec2 hs = uHalf * uShadow.z;
  float rhs = length((p - (uC + vec2(0.0, uShadow.y))) / max(hs, vec2(1e-3)));
  float Rs = 0.5 * (hs.x + hs.y);
  float sh = uShadow.x * 0.5 * (1.0 + erf_((1.0 - rhs) * Rs / max(uShadow.w, 1e-3) / 1.4142136)) * uAlpha;
  vec4 outside;
  if (uOutMode == 0) { vec4 ob = texture(uOut, (uC + v / uOutZoom) / uSZ); outside = vec4(ob.rgb * (1.0 - sh), ob.a); }
  else outside = vec4(0.0, 0.0, 0.0, sh);
  float m = clamp(d + 0.5, 0.0, 1.0) * uAlpha;
  if (m <= 0.0) { o = outside; return; }
  vec4 cb = texture(uCont, fc / uSZ);
  vec3 col = cb.a > 1e-4 ? cb.rgb / cb.a : vec3(0.0);
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, vec3(lum), uDesat);
  col = mix(col, uMilkCol, uMilk);
  vec2 rel = v / uHalf;
  vec2 L = normalize(uLight);
  vec2 g1 = rel - L * 0.5;
  col = screen(col, vec3(uSheen * exp(-dot(g1, g1) / 0.16)));
  float ang = atan(n.y, n.x) / 6.2831853;
  float band = 1.0 - smoothstep(0.0, max(uRimB, 1.0), max(d, 0.0));
  vec3 rb = 0.5 + 0.5 * cos(6.2831853 * (ang * 2.0 + max(d, 0.0) / max(uRimB, 1.0) * 0.5 + vec3(0.0, 0.33, 0.67)));
  col = mix(col, col * (0.7 + 0.6 * rb), uIrid * band);
  vec2 g2 = rel + L * 0.62;
  col = screen(col, (0.5 + 0.5 * rb.zxy) * uIrid * 0.55 * exp(-dot(g2, g2) / 0.12));
  float dd = max(d, 0.0);
  col *= 1.0 - uEdgeDark * exp(-pow((dd - 3.0 * uRimW) / (1.6 * uRimW), 2.0));
  float dl = abs(dot(n, L));
  col = mix(col, vec3(1.0), clamp(uRimLight * exp(-pow(dd / uRimW, 2.0)) * (0.3 + 0.7 * dl * dl), 0.0, 1.0));
  col = clamp(col, 0.0, 1.0);
  o = outside * (1.0 - m) + vec4(col, 1.0) * m;
}`;

  /* 렌즈 엔진. draw(st) 한 번 = 한 프레임. st:
     {old, nw, out: 원본(canvas|img), key: 올리기 캐시 키(보통 f),
      shape: 0|1, c:[x,y], half:[hx,hy], corner, lens: 0|1(굴절 켬), mag, rimB, disp, pow, chroma,
      w, newMode: 0|1, newZ:[r,g,b], settle:[M,k2,norm],
      sigma, blurDir:[x,y], sigma2(앞 방향 σ, 끌림 흐림), outMode, outZoom, alpha, plain, shadow:[a,dy,sc,σ],
      look: {milkCol:[r,g,b] 0..1, milk, desat, sheen, rimLight, rimW, irid, edgeDark, light:[x,y]}} */
  KCG.Lens = function (G) {
    const gl = G.gl, W = G.W, H = G.H;
    const pC = G.prog(FS_CONTENT), pB = G.prog(FS_BLUR), pF = G.prog(FS_FINAL);
    const tOld = G.tex(), tNew = G.tex(), tOut = G.tex();
    const tC = G.tex(W, H, true), tT = G.tex(W, H, true), tB = G.tex(W, H, true);
    const fC = G.fbo(tC), fT = G.fbo(tT), fB = G.fbo(tB);
    const setShape = (p, st) => {
      gl.uniform2f(p.u.uSZ, W, H);
      gl.uniform1i(p.u.uShape, st.shape | 0);
      gl.uniform2f(p.u.uC, st.c[0], st.c[1]);
      gl.uniform2f(p.u.uHalf, Math.max(st.half[0], 1e-3), Math.max(st.half[1], 1e-3));
      gl.uniform1f(p.u.uCorner, st.corner || 0);
    };
    function draw(st) {
      gl.viewport(0, 0, W, H);
      gl.disable(gl.BLEND);
      const hasOld = G.upload(tOld, st.old, st.key);
      if (st.nw) G.upload(tNew, st.nw, st.key);
      if (st.out && st.out !== st.old) G.upload(tOut, st.out, st.key);
      const tOutUse = st.out && st.out !== st.old ? tOut : tOld;
      const s1 = Math.max(st.sigma || 0, st.sigma2 || 0), s2 = st.sigma || 0;
      const blur = s1 >= 0.3;
      const mg = blur ? Math.ceil(3 * s1) + 2 : 2;
      const hx = st.half[0], hy = st.half[1];
      const box = st.plain ? null : [st.c[0] - hx - 2, st.c[1] - hy - 2, st.c[0] + hx + 2, st.c[1] + hy + 2];
      const grow = (b, k) => (b ? [b[0] - k, b[1] - k, b[2] + k, b[3] + k] : null);
      // 1) 내용
      gl.useProgram(pC);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fC);
      G.scissor(grow(box, 2 * mg));
      if (!hasOld) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
      setShape(pC, st);
      G.bindTex(0, tOld, pC, "uOld"); G.bindTex(1, st.nw ? tNew : tOld, pC, "uNew");
      gl.uniform1f(pC.u.uLensOn, st.lens ? 1 : 0);
      gl.uniform1f(pC.u.uMag, st.mag || 1); gl.uniform1f(pC.u.uRimB, st.rimB || 1); gl.uniform1f(pC.u.uDisp, st.disp || 0);
      gl.uniform1f(pC.u.uPow, st.pow || 1); gl.uniform1f(pC.u.uChroma, st.chroma || 0);
      gl.uniform1f(pC.u.uW, st.nw ? st.w || 0 : 0); gl.uniform1i(pC.u.uNewMode, st.newMode | 0);
      const z = st.newZ || [1, 1, 1], se = st.settle || [1, 0, 540];
      gl.uniform3f(pC.u.uNewZ, z[0], z[1], z[2]); gl.uniform3f(pC.u.uSettle, se[0], se[1], se[2]);
      if (hasOld || st.nw) G.draw();
      let src = tC;
      // 2·3) 흐림(σ1은 blurDir 방향, σ2는 그 수직 — 끌림 흐림이 없으면 가로·세로)
      if (blur) {
        const dir = st.blurDir || [1, 0];
        gl.useProgram(pB); gl.uniform2f(pB.u.uSZ, W, H);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fT); G.scissor(grow(box, mg + 2));
        G.bindTex(0, tC, pB, "uSrc"); gl.uniform2f(pB.u.uDir, dir[0], -dir[1]); gl.uniform1f(pB.u.uSig, s1); G.draw();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fB); G.scissor(grow(box, 4));
        G.bindTex(0, tT, pB, "uSrc"); gl.uniform2f(pB.u.uDir, -dir[1], -dir[0]); gl.uniform1f(pB.u.uSig, Math.max(s2, 0.3)); G.draw();
        src = tB;
      }
      // 4) 합성
      gl.useProgram(pF);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      G.scissor(null);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      setShape(pF, st);
      G.bindTex(0, src, pF, "uCont"); G.bindTex(1, tOutUse, pF, "uOut");
      gl.uniform1i(pF.u.uOutMode, st.outMode | 0); gl.uniform1f(pF.u.uOutZoom, st.outZoom || 1);
      gl.uniform1f(pF.u.uAlpha, st.alpha === undefined ? 1 : st.alpha); gl.uniform1f(pF.u.uPlain, st.plain ? 1 : 0);
      const sh = st.shadow || [0, 0, 1, 10];
      gl.uniform4f(pF.u.uShadow, sh[0], sh[1], sh[2], sh[3]);
      const L = st.look || {};
      const mc = L.milkCol || [1, 1, 1];
      gl.uniform3f(pF.u.uMilkCol, mc[0], mc[1], mc[2]);
      gl.uniform1f(pF.u.uMilk, L.milk || 0); gl.uniform1f(pF.u.uDesat, L.desat || 0); gl.uniform1f(pF.u.uSheen, L.sheen || 0);
      gl.uniform1f(pF.u.uRimLight, L.rimLight || 0); gl.uniform1f(pF.u.uRimW, L.rimW || 1.5); gl.uniform1f(pF.u.uRimB, st.rimB || 1);
      gl.uniform1f(pF.u.uIrid, L.irid || 0); gl.uniform1f(pF.u.uEdgeDark, L.edgeDark || 0);
      const lt = L.light || [-0.6, -0.8];
      gl.uniform2f(pF.u.uLight, lt[0], lt[1]);
      if (hasOld || st.outMode === 1) G.draw();
      gl.flush();
    }
    return { draw, G };
  };

  /* ---------- 사영 변환·배럴 휘기 (WebGL2) ----------
     화면 화소 p → (배럴이면 u = c + (p−c)(1 + j1ρ² + j2ρ⁴), ρ² = (dx² + (dy/ay)²)/1e6) → 원본 좌표 q = Hinv·u. 밖은 투명.
     begin(src, key) → pass(Hm, weight, {dist:[j1,j2,cx,cy,ay]})×N(ONE·ONE 더하기 = 셔터 사본 평균) → 결과는 G.cv(또는 end로 흐림) */
  const FS_WARP = HEAD + `
uniform sampler2D uTex; uniform vec2 uTexSize; uniform mat3 uHinv; uniform float uWeight; uniform int uMode;
uniform vec4 uDist; uniform float uAy;
out vec4 o;
void main() {
  vec2 p = vec2(gl_FragCoord.x, uSZ.y - gl_FragCoord.y);
  if (uMode == 1) {
    vec2 d = p - uDist.zw;
    float r2 = (d.x * d.x + (d.y / uAy) * (d.y / uAy)) / 1e6;
    p = uDist.zw + d * (1.0 + uDist.x * r2 + uDist.y * r2 * r2);
  }
  vec3 q = uHinv * vec3(p, 1.0);
  vec2 uv = q.xy / q.z / uTexSize;
  if (q.z <= 0.0 || uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { o = vec4(0.0); return; }
  o = texture(uTex, uv) * uWeight;
}`;
  KCG.Warp = function (G) {
    const gl = G.gl, W = G.W, H = G.H;
    const pW = G.prog(FS_WARP), pB = G.prog(FS_BLUR), pCopy = G.prog(HEAD + `uniform sampler2D uSrc; out vec4 o; void main(){ o = texture(uSrc, gl_FragCoord.xy / uSZ); }`);
    const tS = G.tex(), tA = G.tex(W, H, true), tT = G.tex(W, H, true);
    const fA = G.fbo(tA), fT = G.fbo(tT);
    let sw = 1, sh = 1;
    return {
      // target: null = 화면, "acc" = 화면 밖 누적(흐림을 따로 걸 때)
      begin(src, key, target) {
        gl.viewport(0, 0, W, H); G.scissor(null);
        G.upload(tS, src, key);
        sw = src.width; sh = src.height;
        gl.bindFramebuffer(gl.FRAMEBUFFER, target === "acc" ? fA : null);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(pW); gl.uniform2f(pW.u.uSZ, W, H);
        G.bindTex(0, tS, pW, "uTex");
      },
      pass(Hm, weight, opt) {
        opt = opt || {};
        const Hi = KCG.inv3(Hm);
        gl.blendFunc(gl.ONE, opt.add ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
        gl.uniformMatrix3fv(pW.u.uHinv, false, new Float32Array([Hi[0], Hi[3], Hi[6], Hi[1], Hi[4], Hi[7], Hi[2], Hi[5], Hi[8]]));
        gl.uniform2f(pW.u.uTexSize, sw, sh);
        gl.uniform1f(pW.u.uWeight, weight === undefined ? 1 : weight);
        if (opt.dist) { gl.uniform1i(pW.u.uMode, 1); gl.uniform4f(pW.u.uDist, opt.dist[0], opt.dist[1], opt.dist[2], opt.dist[3]); gl.uniform1f(pW.u.uAy, opt.dist[4]); }
        else gl.uniform1i(pW.u.uMode, 0);
        G.draw();
      },
      // 누적(acc)을 (σx, σy) 흐림으로 화면에 얹음(미리 곱한 알파 덮기). sx·sy < 0.3이면 그대로. box = 화면 위 0 기준 내용 상자(시저로 빠르게)
      end(sx, sy, box) {
        gl.disable(gl.BLEND);
        sx = Math.min(sx || 0, 32); sy = Math.min(sy || 0, 32);
        const bb = box ? [box[0] - 3 * sx - 4, box[1] - 3 * sy - 4, box[2] + 3 * sx + 4, box[3] + 3 * sy + 4] : null;
        if (sx >= 0.3 || sy >= 0.3) {
          gl.useProgram(pB); gl.uniform2f(pB.u.uSZ, W, H);
          gl.bindFramebuffer(gl.FRAMEBUFFER, fT); G.scissor(null);
          gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
          G.scissor(bb);
          G.bindTex(0, tA, pB, "uSrc"); gl.uniform2f(pB.u.uDir, 1, 0); gl.uniform1f(pB.u.uSig, Math.max(sx, 0.3)); G.draw();
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          G.bindTex(0, tT, pB, "uSrc"); gl.uniform2f(pB.u.uDir, 0, 1); gl.uniform1f(pB.u.uSig, Math.max(sy, 0.3));
          gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          G.draw();
        } else {
          gl.useProgram(pCopy); gl.uniform2f(pCopy.u.uSZ, W, H);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null); G.scissor(bb);
          G.bindTex(0, tA, pCopy, "uSrc");
          gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          G.draw();
        }
        gl.disable(gl.BLEND); G.scissor(null);
      },
      clear() { gl.bindFramebuffer(gl.FRAMEBUFFER, null); G.scissor(null); gl.viewport(0, 0, W, H); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); },
    };
  };

  /* ---------- 3×3 행렬(행 우선) — homog·inv3·mul3 ---------- */
  KCG.homog = function (src, dst) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i], [u, v] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    for (let c = 0; c < 8; c++) {
      let p = c;
      for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
      for (let r = 0; r < 8; r++) {
        if (r === c) continue;
        const k = A[r][c] / A[c][c];
        for (let q = c; q < 8; q++) A[r][q] -= k * A[c][q];
        b[r] -= k * b[c];
      }
    }
    const h = b.map((v, i) => v / A[i][i]);
    return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  };
  KCG.inv3 = function (m) {
    const [a, b, c, d, e, f, g, h, i] = m;
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
    return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
  };
  KCG.mul3 = function (m, n) {
    const o = new Array(9);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = m[r * 3] * n[c] + m[r * 3 + 1] * n[3 + c] + m[r * 3 + 2] * n[6 + c];
    return o;
  };
  // 해독 글자: p(0..1)만큼 앞에서부터 진짜 글자, 나머지는 시드 난수 글자(p를 8단계로 끊어 바뀜 — 깜빡임이 아니라 '해독' 걸음). 결정적
  KCG.decode = function (str, p, seed) {
    const pool = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789+-.%";
    const n = str.length, k = Math.floor(Math.max(0, Math.min(1, p)) * n + 1e-6);
    if (k >= n) return str;
    const R = KC.rng((seed || 1) * 7919 + Math.floor(p * 8));
    let o = str.slice(0, k);
    for (let i = k; i < n; i++) { const c = str[i], r = R(); o += c === " " ? " " : (r < 0.35 ? " " : pool[Math.floor(R() * pool.length)]); }
    return o;
  };
  // 색 입력 → [r,g,b] 0..1 (sRGB 그대로 — 셰이더도 sRGB 값으로 섞는다)
  KCG.rgb01 = (c) => { const q = KC.color(c); return [q[0] / 255, q[1] / 255, q[2] / 255]; };

  window.KCG = KCG;
})();
