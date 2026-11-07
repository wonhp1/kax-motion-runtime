// 빛나는 끝 카드(glow_endcard): 남색 바탕 + 흰 글자 + 글자 알파 ⊗ 가우시안 합 커널 글로우.
// 커널(σ·무게)은 실측 값(예시 패키지 design.json glow.endcard_kernel, 글자 100px 기준). 글로우 그림은 build 때 한 번 반 해상도 캔버스에 만든다.
// 움직임(glow_endcard_in / _exit)은 프레임마다 set({ s, bx, by, g }) 로 준다 — KM.EndcardMotion(n)이 기본 곡선을 돌려준다.
//
// 등장 옵션 entry — 기본 null(꺼짐)이면 DOM·그리기가 기본과 한 글자도 다르지 않다.
//   KM.GlowEndcard(el, { ..., entry: "focus_pull" | "radial_hit" | "center_fill", entry_dur: 초, fps })
//   render(f) { const n = f - f0; e.set(KM.EndcardMotion(n, N, { zoom: false }), n); }   ← set의 둘째 인자 n(샷 시작부터 프레임)이 있어야 등장이 돈다
//   focus_pull  흐린 글자가 밝아지다 '딱' 초점(가우스 σ 38→0) + 아래에서 조금 올라옴, 글로우는 늦게 천천히
//   radial_hit  화면보다 크게(entry_scale) 방사형 줌 흐림(글자 사본 여러 장)으로 때리고 줄어듦(서명 장면에 자주 쓰는 등장)
//   center_fill 가장자리 날카로운 채 반투명에서 가운데부터 차오름(원형 투명도)
//
// R13(움직임 번짐 모양): radial_hit 사본 퍼짐 옵션. 안 주면 아래 RH_CENTER·RH_CAP 기본값.
//   entry_blur_center  "space"(기본) 사본 8장을 지금 배율 둘레 −퍼짐/2 ~ +퍼짐/2에 고르게(움직임 방향 가운데 기준, 글자 = 가운데 장) — R13
//                      "behind" 사본 7장이 지금 배율보다 **큰 쪽(지나온 쪽)에만** 0 ~ +퍼짐 — 뒤쪽 꼬리
//   entry_blur_cap     0.5(기본, R13) | 0(상한 없음) | 비: 먼 모서리 번짐 길이(배율 퍼짐 × 가운데→먼 모서리 거리) ≤ cap × 글자 높이(짧은 변)
//   기본값은 아래 RH_CENTER·RH_CAP 두 값 — 바꾸면 부품 endcard.glow_entries 골든(f41·43·46)이 바뀐다.
(function () {
  const SIG = [1.5, 3, 6, 10, 16, 25, 38, 56, 80, 115, 165, 235, 330];
  const WGT = [71.2, 55.7, 31.0, 5.1, 56.9, 29.2, 21.2, 24.2, 102.2, 9.3, 168.0, 435.6, 48.2];
  const BASE = 11.86;

  // 등장 표(정규화 진행 u = 0..1에서 값 — 실측 곡선의 프레임별 값을 0→1 진행으로 늘인 것, 좌표표 아님)
  // focus_pull: 실측 13프레임(@30) — σ/38, 글자 밝기 a, 글로우 g, 아래 비켜남 dy/30
  const FP_SIG = [0.79, 0.89, 1, 0.95, 0.68, 0.58, 0.47, 0.37, 0.32, 0.21, 0.11, 0.016, 0];
  const FP_A = [0.05, 0.5, 1.1, 1.45, 1.5, 1.53, 1.6, 1.57, 1.56, 1.44, 1.26, 1, 1.016];
  const FP_G = [0.15, 0.06, 0.02, 0.02, 0.03, 0.06, 0.08, 0.15, 0.2, 0.37, 0.58, 0.9, 0.91];
  const FP_DY = [1, 1, 0.93, 0.67, 0.33, 0.07, 0, 0, 0, 0, 0, 0, 0];
  // center_fill: 실측 7.5프레임(@29.97) — 가운데(CF_IN)·가장자리(CF_OUT) 불투명도 [u, 값]
  const CF_IN = [[0, 0], [0.067, 0.2], [0.2, 0.55], [0.333, 0.8], [0.467, 0.95], [0.6, 1]];
  const CF_OUT = [[0, 0], [0.067, 0], [0.2, 0.12], [0.333, 0.15], [0.467, 0.35], [0.6, 0.62], [0.733, 0.82], [0.867, 0.95], [1, 1]];
  const ENTRY_DUR = { focus_pull: 0.4, radial_hit: 0.4, center_fill: 0.25 };
  const RH_K = 8; // radial_hit 글자 사본 수(behind: 사본 7 + 글자 = 8장, space: 사본 8 + 글자 = 9장)
  const RH_CENTER = "space", RH_CAP = 0.5; // radial_hit 퍼짐 기본값 — R13에 맞춰 가운데 기준·상한 0.5. 뒤쪽 꼬리 모양은 {entry_blur_center:"behind", entry_blur_cap:0}
  const tab = (T, u) => { const x = Math.max(0, Math.min(1, u)) * (T.length - 1), i = Math.min(T.length - 2, Math.floor(x)), t = x - i; return T[i] + (T[i + 1] - T[i]) * t; };
  const pts = (P, u) => { if (u <= P[0][0]) return P[0][1]; for (let i = 1; i < P.length; i++) if (u <= P[i][0]) { const a = P[i - 1], b = P[i]; return a[1] + (b[1] - a[1]) * (u - a[0]) / (b[0] - a[0]); } return P[P.length - 1][1]; };

  // opt: { text, font:"Inter", weight:600, size:100, tracking:-0.03, bg:"#080d12", cx:958, cy:532 }
  //      등장 옵션: entry(null), entry_dur(초, 모드 기본값), fps(30000/1001), entry_blur(38, 글자 100px 기준 σ),
  //                    entry_dy(0.3, ×size), entry_scale(3.2, radial_hit 출발 배율), fill_r([1.2, 4.5], center_fill 안·밖 반지름 ×size)
  function GlowEndcard(parent, opt) {
    const o = Object.assign({ font: "Inter", weight: 600, size: 100, tracking: -0.03, bg: "#080d12", cx: 958, cy: 532 }, opt);
    const u = KM.U;
    const bg = u.el("div", "full ab", `background:${o.bg}`, parent);
    // 등장 옵션이 있을 때만 감싸개를 하나 더 만든다(없으면 기본 DOM 그대로)
    const ent = o.entry || null;
    if (ent && !ENTRY_DUR[ent]) throw new Error("GlowEndcard: 모르는 entry " + ent);
    const host = ent ? u.el("div", "full ab", "", parent) : parent;
    const GW = 2600, GH = 1800, D = 2; // 글로우 판(반 해상도로 그려 2배로 늘림)
    const gwrap = u.el("div", "full ab", "", host);
    const gc = document.createElement("canvas");
    gc.width = GW / D; gc.height = GH / D;
    gc.className = "ab";
    gc.style.cssText = `width:${GW}px;height:${GH}px;transform-origin:${GW / 2}px ${GH / 2}px`;
    gwrap.appendChild(gc);
    const twrap = u.el("div", "full ab", "", host);
    const txCss = `width:1400px;height:${o.size}px;line-height:${o.size}px;text-align:center;color:#fff;font-family:${o.font};font-weight:${o.weight};font-size:${o.size}px;letter-spacing:${o.tracking}em;transform-origin:700px ${o.size / 2}px;font-variation-settings:"opsz" 32`;
    const tx = u.el("div", "ab nw", txCss, twrap, o.text);
    const clones = [];
    const rhCenter = o.entry_blur_center || RH_CENTER, rhCap = o.entry_blur_cap === undefined ? RH_CAP : o.entry_blur_cap;
    if (rhCenter !== "behind" && rhCenter !== "space") throw new Error("GlowEndcard: entry_blur_center는 behind | space — " + rhCenter);
    const nClone = rhCenter === "space" ? RH_K : RH_K - 1;
    if (ent === "radial_hit") for (let j = 0; j < nClone; j++) clones.push(u.el("div", "ab nw", txCss + ";opacity:0", twrap, o.text));
    // space: 사본 j의 퍼짐 자리(−1/2 ~ +1/2, 0은 글자 자신) — 같은 무게 평균이라 가운데가 지금 배율
    const rhOff = (j) => (rhCenter === "space" ? (j < RH_K / 2 ? j - RH_K / 2 : j - RH_K / 2 + 1) / RH_K : (j + 1) / (RH_K - 1));
    let textW = 0; // 글자 줄 폭(px, 배율 1) — 상한용, 글로우를 구울 때 잰다
    const E = ent ? {
      fps: o.fps || 30000 / 1001,
      dur: o.entry_dur || ENTRY_DUR[ent],
      blur: o.entry_blur === undefined ? 38 : o.entry_blur,
      dy: (o.entry_dy === undefined ? 0.3 : o.entry_dy) * o.size,
      sc: o.entry_scale === undefined ? 3.2 : o.entry_scale,
      fr: o.fill_r || [1.2, 4.5],
    } : null;
    let built = false;
    function buildGlow() {
      const c = gc.getContext("2d");
      const fnt = `${o.weight} ${o.size / D}px ${o.font}`;
      try { if (!document.fonts.check(fnt, o.text)) return false; } catch (e) {}
      c.clearRect(0, 0, gc.width, gc.height);
      c.globalCompositeOperation = "lighter";
      c.textAlign = "center"; c.textBaseline = "middle";
      c.font = fnt;
      try { c.letterSpacing = (o.tracking * o.size / D) + "px"; } catch (e) {}
      textW = c.measureText(o.text).width * D;
      const k = o.size / 100; // σ는 글자 크기에 비례
      for (let i = 0; i < SIG.length; i++) {
        let a = WGT[i] / (255 - BASE); // 바탕 위 밝기 증가 → 흰색 알파
        c.filter = `blur(${(SIG[i] * k / D).toFixed(2)}px)`;
        c.fillStyle = "#fff";
        while (a > 1e-3) { c.globalAlpha = Math.min(1, a); c.fillText(o.text, gc.width / 2, gc.height / 2); a -= 1; }
      }
      c.filter = "none"; c.globalAlpha = 1;
      return true;
    }
    // 등장 n프레임 상태 → {k: 배율 곱, dy, blur, ta: 글자 알파, gm: 글로우 곱, zoom: 사본 퍼짐, ain, aout}
    function entryState(n) {
      const N = E.dur * E.fps, uu = n / N;
      if (ent === "focus_pull") {
        if (uu >= 1) return { k: 1, dy: 0, blur: 0, ta: 1, gm: Math.min(1, 0.91 + 0.09 * (uu - 1)), zoom: 0 };
        const a = tab(FP_A, uu);
        return { k: 1, dy: E.dy * tab(FP_DY, uu), blur: E.blur * (o.size / 100) * tab(FP_SIG, uu), ta: Math.min(1, a), gm: tab(FP_G, uu) + Math.max(0, a - 1) * 0.6, zoom: 0 };
      }
      if (ent === "radial_hit") {
        const S = (m) => { const q = KM.curve.settle(m, 0.44, 0.884) / KM.curve.settle(N, 0.44, 0.884); return m >= N ? 1 : E.sc + (1 - E.sc) * Math.min(1, q); };
        const k = S(n), kp = S(n - 0.5 > 0 ? n - 0.5 : 0), kn = S(n + 0.5);
        let z = n > 0 ? Math.min(0.6, Math.max(0, (kp - kn) / k) * 1.2) : 0;
        if (rhCap > 0) { // 상한: 먼 모서리 번짐 k·z·R ≤ cap·(k·size) → z ≤ cap·size/R
          const w = textW || Array.from(o.text).length * 0.75 * o.size, R = Math.hypot(w / 2, o.size / 2);
          z = Math.min(z, (rhCap * o.size) / R);
        }
        return { k, dy: 0, blur: 0, ta: 1, gm: Math.min(1, 0.35 + 0.65 * Math.min(1, uu)), zoom: z };
      }
      // center_fill
      return { k: 1, dy: 0, blur: 0, ta: 1, gm: pts(CF_OUT, uu), zoom: 0, ain: pts(CF_IN, uu), aout: pts(CF_OUT, uu) };
    }
    function set(s, n) {
      if (!built) built = buildGlow();
      let sc = s.s || 1;
      let es = null;
      if (E && n !== undefined) { es = entryState(n); sc *= es.k; }
      const ty = es ? es.dy : 0;
      gc.style.transform = `translate(${(o.cx - GW / 2).toFixed(2)}px,${(o.cy - GH / 2 + ty).toFixed(2)}px) scale(${sc.toFixed(5)})`;
      const g0 = s.g === undefined ? 0.82 : s.g;
      gc.style.opacity = Math.max(0, Math.min(1, es ? g0 * es.gm : g0)).toFixed(4);
      tx.style.transform = `translate(${(o.cx - 700).toFixed(2)}px,${(o.cy - o.size / 2 + ty).toFixed(2)}px) scale(${sc.toFixed(5)})`;
      u.mblur(twrap, "kmEndT", s.bx || 0, s.by || 0);
      u.mblur(gwrap, "kmEndG", s.bx || 0, s.by || 0);
      if (!E) return;
      if (!es) { host.style.filter = "none"; return; }
      // 초점 흐림(감싸개 전체 — mblur와 따로)
      host.style.filter = es.blur > 0.05 ? `blur(${es.blur.toFixed(2)}px)` : "none";
      tx.style.opacity = Math.min(1, es.ta).toFixed(4); // 늘 값으로(""로 지우면 style 속성 순서가 바뀌어 자가 시험 지문이 흔들림)
      if (ent === "radial_hit") {
        const on = es.zoom > 0.015; // 아주 작은 퍼짐은 겹친 테두리로만 보여서 끔
        clones.forEach((c, j) => {
          const kk = rhCenter === "space" ? sc * (1 + es.zoom * rhOff(j)) : sc * (1 + es.zoom * (j + 1) / (RH_K - 1)); // behind = 뒤쪽 꼬리 식
          c.style.opacity = on ? (1 / (j + 2)).toFixed(4) : "0"; // 같은 무게로 평균(사본 j는 1/(j+2)), 안 쓸 때 0
          c.style.transform = `translate(${(o.cx - 700).toFixed(2)}px,${(o.cy - o.size / 2).toFixed(2)}px) scale(${kk.toFixed(5)})`;
        });
      }
      if (ent === "center_fill") {
        const full = es.ain >= 0.999 && es.aout >= 0.999;
        const m = full ? "none" : `radial-gradient(circle at ${o.cx.toFixed(1)}px ${o.cy.toFixed(1)}px, rgba(0,0,0,${es.ain.toFixed(4)}) ${(E.fr[0] * o.size).toFixed(1)}px, rgba(0,0,0,${es.aout.toFixed(4)}) ${(E.fr[1] * o.size).toFixed(1)}px)`;
        host.style.webkitMaskImage = m; host.style.maskImage = m;
      }
    }
    return { set, bg };
  }

  // 기본 움직임: n = 샷 시작부터 프레임, N = 샷 길이(예시 45). 마지막 11프레임 퇴장.
  // 배율 3.03 → (첫 프레임 44%, 0.884배씩) 정착, 흐림 가로 91→~0.8 · 세로 16→~1.5, 글로우 0.30→0.82
  // 셋째 인자 {zoom: false}면 들어오는 확대·흐림 없이 1.03 그대로(등장은 GlowEndcard entry가 맡음). 없으면 기본 움직임.
  const BX = [91.4, 10.9, 5.5, 3.6, 2.7, 2.1, 1.8, 1.5, 1.6, 1.2, 1.2, 1.2, 1.1, 1.1, 1.1, 1.0];
  const BY = [15.6, 6.75, 4.96, 3.85, 3.34, 3.01, 2.8, 2.43, 2.2, 2.17, 2.03, 1.89, 1.98, 1.94, 1.83, 1.79];
  const GL = [0.301, 0.498, 0.598, 0.655, 0.687, 0.709, 0.723, 0.744, 0.749, 0.762, 0.771, 0.776, 0.78, 0.783, 0.786, 0.791];
  function EndcardMotion(n, N, mo) {
    N = N || 45;
    const noZoom = !!(mo && mo.zoom === false);
    const exitN = 11, nx = N - exitN;
    const pick = (arr, tail) => (n < arr.length ? arr[Math.max(0, Math.floor(n))] : tail);
    let s;
    if (n < nx) s = noZoom ? 1.03 : 3.033 + (1.03 - 3.033) * KM.curve.settle(n, 0.437, 0.884) / KM.curve.settle(nx, 0.437, 0.884);
    else s = 1.03 + (0.572 - 1.03) * KM.curve.accel(n - nx, exitN, 1.36);
    const ex = n >= nx ? KM.curve.accel(n - nx, exitN, 1.36) : 0;
    return {
      s,
      bx: (noZoom ? 0 : pick(BX, 0.8)) + ex * 10.5,
      by: (noZoom ? 0 : pick(BY, 1.5)) + ex * 1.1,
      g: noZoom ? 0.82 - ex * 0.25 : Math.min(0.82, pick(GL, 0.8 + 0.02 * Math.min(1, (n - 16) / 15))) - ex * 0.25,
    };
  }

  window.KM = window.KM || {};
  Object.assign(KM, { GlowEndcard, EndcardMotion, GLOW_KERNEL: { SIG, WGT, BASE } });
})();
