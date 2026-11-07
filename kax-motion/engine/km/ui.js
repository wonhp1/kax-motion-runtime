// UI 부품(DOM): 채팅 입력창(KM.PromptBox), 화살표 커서(KM.Cursor), 생각 중 상태 줄(KM.StatusLine), 메뉴 카드(KM.MenuCard), 도구 알약(KM.Pill).
// 치수 기본값은 실측 값(예시 패키지 design.json). 위치는 모두 '쉬는 자리'(카메라 배율 1) 화면 좌표로 짜고, 움직임은 바깥 묶음에 transform 하나로 준다.
(function () {
  const U = () => KM.U;

  // ---------- 채팅 입력창 ----------
  // opt: { x, y(첫 줄 글자 윗변), w(묶음 폭, 기본 877), line1, font("Inter"), weight(500), fs(44), pitch(41.5), ink("#161616"),
  //        markHTML(작은 브랜드 마크 SVG 문자열, 26.5px), model("모델 이름"), mode("모드"), accent("#fe7438") }
  // 반환 객체 set({ typed, caret(bool), press(배율), glow(0~1), arrowDeg }) — 매 프레임 부른다.
  // (옵션 — 모두 기본 꺼짐, 안 주면 기본 DOM·그림 그대로. 부품 ui.prompt_box_plus와 같은 모양)
  //   theme:"dark"            어두운 판(글자·아이콘 밝게, 캐럿 흰색). 바탕은 장면이 깐다
  //   attachments:[{iconHTML,text}]  첫 줄 위 첨부 칩(테 두른 알약). set({attach: 0~1}) 나타남 진행
  //   chips:[{iconHTML,text}]  아랫줄 모델 이름 뒤 회색 알약
  //   splitButton:["Chat","Work"]  아랫줄 + 오른쪽 분할 단추(첫 칸 켜짐) — 있으면 마크·모델 글자는 그 뒤로 밀림
  //   sendMorph:true           보내기 단추가 알약(→)에서 둥근 네모(↑)로. set({morph: 0~1}) — 폭은 그대로 진행, 화살표 90°→0°
  //                            (곡선은 components/ui/prompt_box_plus/presets.json send_morph_width·arrow_rot)
  //   autogrow:true            둘째 줄이 폭을 넘으면 줄바꿈하고 아랫줄이 그만큼 내려감(글자 줄 간격 pitch)
  function PromptBox(parent, opt) {
    const o = Object.assign({ w: 877, font: "Inter", weight: 500, fs: 44, pitch: 41.5, ink: "#161616", accent: "#fe7438", model: "", mode: "" }, opt);
    const u = U();
    const dark = o.theme === "dark";
    if (dark && !(opt && opt.ink)) o.ink = "#f5f5f5";
    const icol = dark ? "#d8d6d4" : null; // 아이콘·작은 글자 색(밝은 판은 기본 값 그대로)
    const root = u.el("div", "ab", `transform:translate(${o.x}px,${o.y}px)`, parent);
    const txt = `font-family:${o.font};font-weight:${o.weight};font-size:${o.fs}px;line-height:${o.fs}px;color:${o.ink};white-space:pre;font-variation-settings:"opsz" 32`;
    // 글자 윗변을 y=0에 맞추려고 서체 위 여백(약 0.155em)만큼 올린다
    const off = -0.155 * o.fs;
    const l1 = u.el("div", "ab", txt + `;top:${off}px`, root, o.line1 || "");
    const l2 = u.el("div", "ab", txt + `;top:${off + o.pitch}px`, root, "");
    if (o.autogrow) { l2.style.whiteSpace = "pre-wrap"; l2.style.width = o.w + "px"; l2.style.lineHeight = o.pitch + "px"; }
    const caret = u.el("div", "ab", `width:3px;height:43px;background:${dark ? "#fff" : "#000"};top:${o.pitch - 3}px`, root);
    // 첨부 칩: 첫 줄 위 — 칩 높이 66, 첫 줄 글자 윗변에서 92px 위
    // 칩끼리는 flex 줄로 이어 놓음(만들 때 폭을 재면 서체가 늦게 읽혀 겹쳤다)
    const attRow = o.attachments && o.attachments.length ? u.el("div", "ab", "left:0;top:-92px;display:flex;gap:14px", root) : null;
    const att = (o.attachments || []).map((a) => u.el("div", "nw", `position:relative;flex:none;height:66px;display:flex;align-items:center;gap:12px;padding:0 26px 0 18px;border-radius:33px;` +
        `background:${dark ? "#262626" : "#fff"};box-shadow:inset 0 0 0 4px ${dark ? "#333" : "rgb(239,239,239)"};font-family:${o.font};font-weight:500;font-size:28px;color:${o.ink};transform-origin:0 50%;opacity:0`, attRow,
        (a.iconHTML || "") + `<span>${a.text || ""}</span>`));
    // 아랫줄(도구): 왼쪽 + · 마크 · 모델 이름 / 오른쪽 모드 ⌄ · 마이크 · 보내기 버튼 (오른쪽은 묶음 폭 기준)
    const rowY = 140.5;
    const tools = (o.autogrow) ? u.el("div", "ab", "left:0;top:0", root) : root; // autogrow면 아랫줄을 묶어 내림
    u.el("div", "ab", `left:0;top:${rowY}px`, tools,
      `<svg width="21" height="21" viewBox="0 0 20 20"><path d="M10 1.5V18.5M1.5 10H18.5" stroke="${icol || "#3a3836"}" stroke-width="2" stroke-linecap="round"/></svg>`);
    const hasSplit = o.splitButton && o.splitButton.length, hasChips = o.chips && o.chips.length;
    if (hasSplit || hasChips) {
      // 분할 단추·마크·모델·칩을 flex 줄 하나로(폭을 재지 않음). 줄 가운데 = 기본 마크 가운데(rowY + 13.5)
      const fr = u.el("div", "ab nw", `left:52px;top:${rowY + 13.5 - 30}px;height:60px;display:flex;align-items:center;gap:18px`, tools);
      if (hasSplit) u.el("div", "nw", `position:relative;flex:none;display:flex;padding:4px;border-radius:13px;background:${dark ? "rgb(33,33,33)" : "#f1efec"}`, fr,
        o.splitButton.map((t, i) => `<span style="padding:6px 16px;border-radius:10px;font-family:${o.font};font-weight:500;font-size:24px;line-height:28px;${i === 0 ? `background:${dark ? "#000" : "#1e1d1b"};color:#fff` : `color:${dark ? "rgb(150,148,148)" : "#8a8784"}`}">${t}</span>`).join(""));
      if (o.markHTML) u.el("div", "", "position:relative;flex:none;width:26.5px;height:26.5px", fr, o.markHTML);
      if (o.model) u.el("div", "nw", `position:relative;flex:none;font-family:${o.font};font-weight:600;font-size:30px;line-height:30px;color:${dark ? "#f5f5f5" : "#1e1d1b"}`, fr, o.model);
      (o.chips || []).forEach((cp) => u.el("div", "nw", `position:relative;flex:none;height:50px;display:flex;align-items:center;gap:8px;padding:0 20px 0 ${cp.iconHTML ? 14 : 20}px;border-radius:25px;background:${dark ? "rgb(33,33,33)" : "#f1efec"};font-family:${o.font};font-weight:500;font-size:24px;color:${dark ? "#f5f5f5" : "#1e1d1b"}`, fr,
        (cp.iconHTML || "") + `<span>${cp.text || ""}</span>`));
    } else {
      if (o.markHTML) u.el("div", "ab", `left:73px;top:${rowY + 0.3}px;width:26.5px;height:26.5px`, tools, o.markHTML);
      u.el("div", "ab nw", `left:115px;top:${rowY - 4.4 - 0.155 * 30}px;font-family:${o.font};font-weight:600;font-size:30px;line-height:30px;color:${dark ? "#f5f5f5" : "#1e1d1b"}`, tools, o.model);
    }
    const W = o.w;
    u.el("div", "ab nw", `left:${W - 277}px;top:${rowY - 6.7 - 0.155 * 27}px;font-family:${o.font};font-weight:400;font-size:27px;line-height:27px;color:${icol || "#2a2826"}`, tools, o.mode);
    u.el("div", "ab", `left:${W - 202}px;top:${rowY - 0.7}px`, tools,
      `<svg width="18" height="11" viewBox="0 0 18 11" overflow="visible"><path d="M1.5 1.5L9 9L16.5 1.5" fill="none" stroke="${icol || "#2a2826"}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`);
    u.el("div", "ab", `left:${W - 124}px;top:${rowY - 8}px`, tools,
      `<svg width="22" height="32" viewBox="0 0 22 32" overflow="visible"><rect x="6.5" y="1" width="9" height="17" rx="4.5" fill="none" stroke="${icol || "#2a2826"}" stroke-width="2"/><path d="M2 13.5a9 9 0 0 0 18 0M11 22.5V30M6 30.5H16" fill="none" stroke="${icol || "#2a2826"}" stroke-width="2" stroke-linecap="round"/></svg>`);
    const btn = u.el("div", "ab", `left:${W - 62}px;top:${rowY - 22}px;width:62px;height:61px;border-radius:13px;background:${o.accent};transform-origin:50% 50%;overflow:hidden`, tools);
    const glow = u.el("div", "ab", "width:62px;height:61px;opacity:0;background:radial-gradient(circle at 30% 25%, rgba(255,255,255,0.75), rgba(255,255,255,0) 70%)", btn);
    const arrow = u.el("div", "ab", "width:62px;height:61px;transform-origin:50% 50%", btn,
      o.sendMorph
        ? `<svg width="62" height="61" viewBox="0 0 62 62"><path d="M31 44V18M20 28.5L31 17.5L42 28.5" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
        : `<svg width="62" height="61" viewBox="0 0 62 62"><path d="M21 41L41 21M24 21H41V38" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`);
    let lastTyped = null;
    function set(s) {
      if (s.typed !== undefined && s.typed !== lastTyped) { l2.textContent = s.typed; lastTyped = s.typed; }
      caret.style.display = s.caret === false ? "none" : "block";
      const ws = s.worldScale || 1;
      if (o.autogrow) {
        // 줄바꿈된 둘째 줄: 마지막 글자 끝을 Range로 잼, 늘어난 줄 수만큼 아랫줄을 내림
        let cx = 0, cy = 0;
        if (lastTyped && l2.firstChild) {
          const r = document.createRange(); r.setStart(l2.firstChild, lastTyped.length - 1); r.setEnd(l2.firstChild, lastTyped.length);
          const rr = r.getBoundingClientRect(), b0 = l2.getBoundingClientRect();
          cx = (rr.right - b0.left) / ws + 3; cy = (rr.top - b0.top) / ws;
        }
        const extra = Math.max(0, Math.round(cy / o.pitch)) * o.pitch;
        caret.style.left = cx + "px";
        caret.style.transform = `translateY(${extra.toFixed(2)}px)`;
        tools.style.transform = `translateY(${extra.toFixed(2)}px)`;
      } else {
        const w2 = l2.getBoundingClientRect().width / ws;
        caret.style.left = (lastTyped ? w2 + 3 : 0) + "px";
      }
      if (att.length) {
        const a = s.attach === undefined ? 1 : s.attach;
        att.forEach((c) => { c.style.opacity = Math.min(1, a * 3).toFixed(3); c.style.transform = `scale(${(0.9 + 0.1 * a).toFixed(4)})`; });
      }
      let bw = 62, rot = s.arrowDeg || 0;
      if (o.sendMorph) {
        const m = s.morph === undefined ? 1 : s.morph;            // 0 알약 → 1 둥근 네모
        bw = 62 + (100 - 62) * (1 - m);                           // 실측 폭/높이 1.63 → 1
        rot = 90 * (1 - Math.max(0, Math.min(1, (m - 0.15) / 0.45))) + (s.arrowDeg || 0);
        btn.style.left = (W - bw) + "px"; btn.style.width = bw + "px";
        btn.style.borderRadius = (13 + 17.5 * (1 - m)) + "px";
        arrow.style.left = ((bw - 62) / 2) + "px";
      }
      btn.style.transform = `scale(${(s.press || 1).toFixed(4)})`;
      glow.style.opacity = (s.glow || 0).toFixed(3);
      arrow.style.transform = `rotate(${rot.toFixed(2)}deg)`;
    }
    // 보내기 버튼 가운데(묶음 좌표) — 스냅 줌 중심·커서 목표로 쓴다
    const buttonCenter = [o.x + W - 31, o.y + rowY - 22 + 30.5];
    return { el: root, set, buttonCenter, line1: l1, line2: l2 };
  }

  // ---------- 화살표 커서 ----------
  // 검정 면 + 흰 테(paint-order stroke). 끝점(hotspot)이 (x,y)에 오도록 set(x, y, scale, deg)
  const CURSOR_D = "M0 0 L0 78 L19 60 L32 90 L46 84 L33 55 L58 55 Z";
  function Cursor(parent, size) {
    const k = (size || 100) / 100;
    const u = U();
    const el = u.el("div", "ab", "transform-origin:0 0;display:none", parent,
      `<svg width="${80 * k}" height="${110 * k}" viewBox="-8 -8 80 110" overflow="visible"><path d="${CURSOR_D}" fill="#000" stroke="#fff" stroke-width="8" stroke-linejoin="round" paint-order="stroke"/></svg>`);
    return {
      el,
      set(x, y, sc, deg) {
        if (x === null || x === undefined) { el.style.display = "none"; return; }
        el.style.display = "block";
        el.style.transform = `translate(${(x - 8 * k).toFixed(2)}px,${(y - 8 * k).toFixed(2)}px) rotate(${(deg || 0).toFixed(2)}deg) scale(${(sc || 1).toFixed(4)})`;
        el.style.transformOrigin = `${8 * k}px ${8 * k}px`;
      },
    };
  }

  // ---------- 생각 중 상태 줄 ----------
  // 회색 공(또는 markHTML) + 라벨 + 작은 네모 점 3개(dots_wave). set({ ballX, ballY, ballD, labelX, labelY, f })
  // (옵션 — 기본 꺼짐, 안 주면 기본 DOM·그림 그대로. 공용 부품 type.loader_rewrite('점 고리가 커서처럼 지나가며 고쳐 씀', 카탈로그의 엔진 옵션))
  //   rewrite: { text:"새 문구", f0(set의 f 축 — 고리가 움직이기 시작), dur(초, 1.234), fps(30000/1001),
  //              ring:{ n:5, d(점 지름 px, fs×0.2), r(고리 반지름 px, fs×0.36), color(라벨 색) }, tint(새 글자 처음 색 — 없으면 불투명도만),
  //              lag(3), fade(10), erase(4) 프레임, spin(쉬는 동안 도/프레임 1.2), roll(가는 동안 더 도는 각 200°), grow(가는 동안 고리 커짐 0.16), blurCap(번짐 σ ≤ 고리 지름 × 0.2) }
  //   켜면: 공 대신 점 고리가 공 자리(ballX, ballY)에 있다가 f0부터 라벨 줄을 따라 새 문구 끝(+ 고리 반지름 1.6배)까지 간다(측정 곡선 bezier .768 .029 .019 .97).
  //   고리가 지난 옛 글자는 erase 프레임 동안 지워지고, 새 글자는 고리 뒤 lag 프레임에 나타나 fade 프레임 동안 tint → 라벨 색으로 진해진다. 점 물결 3개는 숨긴다.
  //   고리 가로 번짐은 U.mblur(가운데 대칭 가우스, 빠르기 × 0.35, 상한 blurCap — R13 움직임 번짐 모양). 잰 값은 engine/km/README.md의 엔진 옵션.
  function StatusLine(parent, opt) {
    const o = Object.assign({ label: "Thinking", font: "Schibsted Grotesk", fs: 60, color: "rgb(66,63,59)", ball: "rgb(148,148,148)" }, opt);
    const u = U();
    const ball = u.el("div", "ab", `width:100px;height:100px;border-radius:50%;background:${o.ball};transform-origin:0 0`, parent, o.markHTML || "");
    const lab = u.el("div", "ab nw", `font-family:"${o.font}";font-weight:400;font-size:${o.fs}px;line-height:${o.fs}px;color:${o.color}`, parent, `<span>${o.label}</span>`); // 글자를 span에 담아 폭을 잰다
    const dots = [0, 1, 2].map(() => u.el("div", "ab", `width:5.2px;height:5.2px;border-radius:1px;background:${o.color}`, lab));
    const RW = o.rewrite ? rewriteOf(u, o, ball, lab, dots, parent) : null;   // 없으면 아래 set이 기본 그대로(한 줄도 안 다름)
    function set(s) {
      if (RW) { RW.set(s); return; }
      ball.style.transform = `translate(${(s.ballX - s.ballD / 2).toFixed(2)}px,${(s.ballY - s.ballD / 2).toFixed(2)}px) scale(${(s.ballD / 100).toFixed(4)})`;
      lab.style.transform = `translate(${s.labelX.toFixed(2)}px,${s.labelY.toFixed(2)}px)`;
      const w = lab.firstChild ? lab.firstChild.offsetWidth : 0; // scrollWidth는 점(절대 위치 자식)까지 포함해 프레임마다 점이 오른쪽으로 밀려 나가므로 span 폭으로 잰다
      dots.forEach((d, i) => {
        // 물결: 진폭 5.5px, 점마다 1프레임 늦게, 주기 12프레임, 아래로 처졌다 돌아옴
        const ph = ((s.f - i) % 12 + 12) % 12;
        const dy = ph < 6 ? 5.5 * Math.sin((ph / 6) * Math.PI) : 0;
        d.style.left = (w + 6 + i * 11.2) + "px";
        d.style.top = (o.fs * 0.72 + dy).toFixed(2) + "px";
      });
    }
    return RW ? { set, ball, label: lab, ring: RW.ring, rewrite: RW } : { set, ball, label: lab };
  }

  // StatusLine rewrite: 점 고리 커서가 줄을 지나며 옛 글을 지우고 새 글을 씀 — 위 StatusLine 머리 주석
  let RW_ID = 0;
  function rewriteOf(u, o, ball, lab, dots, parent) {
    const fid = "kmRwRing" + RW_ID++;   // 번짐 필터 id(인스턴스마다)
    const R = Object.assign({ f0: 0, dur: 1.234, fps: 30000 / 1001, lag: 3, fade: 10, erase: 4, spin: 1.2, roll: 200, grow: 0.16, blurCap: 0.2, tint: null }, o.rewrite);
    const RG = Object.assign({ n: 5, d: o.fs * 0.2, r: o.fs * 0.36, color: o.color }, R.ring || {});
    const N = R.dur * R.fps;
    const bz = (x1, y1, x2, y2) => (t) => {   // cubic-bezier(진행) — curves.js와 같은 셈
      if (t <= 0) return 0; if (t >= 1) return 1;
      let v = t;
      for (let k = 0; k < 20; k++) {
        const bx = 3 * (1 - v) * (1 - v) * v * x1 + 3 * (1 - v) * v * v * x2 + v * v * v - t;
        const dx = 3 * (1 - v) * (1 - v) * x1 + 6 * (1 - v) * v * (x2 - x1) + 3 * v * v * (1 - x2);
        if (Math.abs(dx) < 1e-7) break;
        v = Math.min(1, Math.max(0, v - bx / dx));
      }
      return 3 * (1 - v) * (1 - v) * v * y1 + 3 * (1 - v) * v * v * y2 + v * v * v;
    };
    const P = bz(0.768, 0.029, 0.019, 0.97);   // 점 고리 x 실측 곡선(37프레임) rms 0.003
    const prog = (f) => P(Math.max(0, Math.min(1, (f - R.f0) / N)));
    // 옛 글·새 글을 글자 span으로(rewrite를 켰을 때만 DOM이 바뀜)
    const oldSpan = lab.firstChild;
    const oldCh = Array.from(o.label).map((ch) => `<span style="position:relative">${ch === " " ? "&nbsp;" : ch}</span>`).join("");
    oldSpan.innerHTML = oldCh;
    const oldEls = Array.from(oldSpan.children);
    const nw = u.el("span", "ab nw", "left:0;top:0", lab, Array.from(R.text).map((ch) => `<span style="position:relative;opacity:0">${ch === " " ? "&nbsp;" : ch}</span>`).join(""));
    const newEls = Array.from(nw.children);
    dots.forEach((d) => (d.style.display = "none"));
    ball.style.display = "none";
    const D = RG.r * 2 + RG.d;
    const ring = u.el("div", "ab", `width:${D}px;height:${D}px;transform-origin:${D / 2}px ${D / 2}px`, parent,
      Array.from({ length: RG.n }, (_, i) => {
        const a = (i / RG.n) * Math.PI * 2 - Math.PI / 2;
        return `<div style="position:absolute;left:${(D / 2 + RG.r * Math.cos(a) - RG.d / 2).toFixed(2)}px;top:${(D / 2 + RG.r * Math.sin(a) - RG.d / 2).toFixed(2)}px;width:${RG.d.toFixed(2)}px;height:${RG.d.toFixed(2)}px;border-radius:50%;background:${RG.color}"></div>`;
      }).join(""));
    const mix = (a, b, t) => { const A = parseC(a), B2 = parseC(b); return `rgb(${A.map((v, i) => Math.round(v + (B2[i] - v) * t)).join(",")})`; };
    function parseC(c) {
      const m = /rgba?\(([^)]+)\)/.exec(c); if (m) return m[1].split(",").slice(0, 3).map(parseFloat);
      let h = String(c).replace("#", ""); if (h.length === 3) h = h.split("").map((x) => x + x).join("");
      return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    }
    // 고리 가운데 x가 처음 X에 닿는 프레임(곡선이 늘 오름이라 반 나누기)
    function passFrame(x, x0, x1) {
      if (x <= x0) return R.f0;
      if (x >= x1) return R.f0 + N;
      let a = 0, b = 1;
      for (let k = 0; k < 30; k++) { const m = (a + b) / 2; if (x0 + (x1 - x0) * P(m) < x) a = m; else b = m; }
      return R.f0 + b * N;
    }
    function set(s) {
      const f = s.f, ws = s.worldScale || 1;
      lab.style.transform = `translate(${s.labelX.toFixed(2)}px,${s.labelY.toFixed(2)}px)`;
      const lb = lab.getBoundingClientRect();
      const L = (el) => { const r = el.getBoundingClientRect(); return [(r.left - lb.left) / ws, (r.right - lb.left) / ws]; };
      const newW = nw.offsetWidth;
      const x0 = s.ballX, x1 = s.labelX + newW + RG.r * 1.6;           // 고리 가운데: 공 자리 → 새 글 끝 뒤
      const p = prog(f), cx = x0 + (x1 - x0) * p, cy = s.labelY + o.fs * 0.5;
      // 옛 글자: 고리 오른쪽 끝이 글자 왼쪽에 닿은 뒤 erase 프레임 동안 지워짐
      oldEls.forEach((el) => {
        const [a] = L(el), fx = passFrame(s.labelX + a - RG.r, x0, x1);
        el.style.opacity = Math.max(0, Math.min(1, 1 - (f - fx) / R.erase)).toFixed(3);
      });
      // 새 글자: 고리 왼쪽 끝이 글자 오른쪽을 지나고 lag 뒤 나타나 fade 동안 진해짐(tint → 라벨 색)
      newEls.forEach((el) => {
        const [, b] = L(el), fx = passFrame(s.labelX + b + RG.r, x0, x1) + R.lag;
        const q = Math.max(0, Math.min(1, (f - fx) / R.fade));
        el.style.opacity = Math.min(1, q * 2).toFixed(3);
        el.style.color = R.tint ? mix(R.tint, o.color, q) : "";
      });
      const sc = 1 + R.grow * p, rot = R.spin * f + R.roll * p;
      ring.style.transform = `translate(${(cx - D / 2).toFixed(2)}px,${(cy - D / 2).toFixed(2)}px) rotate(${rot.toFixed(2)}deg) scale(${sc.toFixed(4)})`;
      const v = Math.abs((x1 - x0) * (prog(f + 0.5) - prog(f - 0.5)));      // 프레임당 이동 px
      u.mblur(ring, fid, Math.min(v * 0.35, D * R.blurCap), 0);
    }
    return { set, ring, passFrame, prog };
  }

  // ---------- 메뉴 카드(어두운 막 위) ----------
  // rows: [{ iconHTML, text }] (3줄 권장). set({ hl(0~1 강조 불투명도), inset(px, 눌림 수축), dy(카드 위로 이동) })
  function MenuCard(parent, opt) {
    const o = Object.assign({ x: 568, y: 371, w: 782, h: 339, font: "Inter", rows: [], dim: 0.464 }, opt);
    const u = U();
    const dim = u.el("div", "full", `background:#000;opacity:${o.dim}`, parent);
    const card = u.el("div", "ab", `left:${o.x}px;top:${o.y}px;width:${o.w}px;height:${o.h}px;border-radius:20px;background:#fdfdfd;overflow:hidden`, parent);
    const hl = u.el("div", "ab", "top:21px;height:90px;border-radius:16px;background:rgb(241,236,231);opacity:0", card);
    const rowEls = o.rows.map((r, i) => {
      const y = 50 + i * 105;
      const g = u.el("div", "ab", `left:0;top:0;width:${o.w}px;height:${o.h}px;transform-origin:${o.w / 2}px ${y + 16}px`, card);
      u.el("div", "ab", `left:42px;top:${y - 7}px;width:46px;height:46px`, g, r.iconHTML || "");
      u.el("div", "ab nw", `left:107px;top:${y - 0.155 * 43.6 - 2}px;font-family:${o.font};font-weight:500;font-size:43.6px;line-height:43.6px;color:#000`, g, r.text);
      return g;
    });
    function set(s) {
      const ins = s.inset || 0;
      hl.style.opacity = (s.hl || 0).toFixed(3);
      hl.style.left = (21 + ins) + "px";
      hl.style.width = (o.w - 42 - 2 * ins) + "px";
      hl.style.background = s.hlColor || "rgb(241,236,231)";
      if (rowEls[0]) rowEls[0].style.transform = `scale(${(1 - ins / (o.w - 42)).toFixed(4)})`;
      card.style.transform = `translateY(${(s.dy || 0).toFixed(2)}px)`;
      dim.style.opacity = s.dim === undefined ? o.dim : s.dim;
    }
    return { set, card, dim };
  }

  // ---------- 도구 알약(오른쪽 위, 아이콘 + 짧은 글자) ----------
  function Pill(parent, opt) {
    const o = Object.assign({ x: 1380, y: 66, h: 46, text: "", iconHTML: "", font: "Inter" }, opt);
    const u = U();
    const el = u.el("div", "ab nw", `left:${o.x}px;top:0;height:${o.h}px;padding:0 18px 0 ${o.iconHTML ? 14 : 18}px;border-radius:${o.h / 2}px;background:#fff;display:flex;align-items:center;gap:8px;font-family:${o.font};font-weight:500;font-size:19px;color:#1e1d1b;transform-origin:50% 50%`, parent, (o.iconHTML || "") + (o.text ? `<span>${o.text}</span>` : ""));
    return { el, set(y, sc) { el.style.transform = `translateY(${y.toFixed(2)}px) scale(${(sc || 1).toFixed(4)})`; } };
  }

  window.KM = window.KM || {};
  Object.assign(KM, { PromptBox, Cursor, StatusLine, MenuCard, Pill });
})();
