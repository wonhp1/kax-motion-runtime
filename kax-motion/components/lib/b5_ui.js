/* B5 — AI·대화·입력 부품이 같이 쓰는 도우미. kc.js 다음, 이 도우미를 쓰는 부품 .js보다 먼저 읽는다.
 *
 *   B5.icon(name, size, color, stroke)  코드로 그린 선 아이콘 SVG 문자열. 이름: spark·book·check·search·
 *                                        file·image·folder·plus·mic·arrow_up·arrow_right·chev_right·chev_down·bolt·mail·clock·
 *                                        branch·sliders·globe·doc
 *   B5.cursor(kind, size)               커서 SVG 문자열 — "arrow"(검정 면 + 흰 테) | "hand"(가리키는 손) | "grab"(쥔 손)
 *   B5.el(tag, css, parent, html)       요소 만들기(mount에서만)
 *   B5.text(el, text, role, size, color, opt)  KTypo가 있으면 역할로, 없으면 시스템 서체로 글자 넣기(mount에서만)
 *   B5.normalize(root)                  mount 끝에: style 글을 브라우저 꼴로 다시 씀(자가 시험 지문 안정)
 *   B5.prime([el...])                   mount 끝에: render가 바꿀 속성을 미리 넣어 둠(style 글 안정)
 *   B5.vis(el, on)                      visibility "inherit" | "hidden"(속성 순서가 안 바뀜)
 *   B5.settle(n, a, r, delay)           expo_settle에 늦춤(프레임) — 첫 프레임이 한 박자 늦게 움직이는 곡선
 *   B5.lin(n, N)                        0..1 직선 진행
 *   B5.blur(px)                         filter 문자열("none" | "blur(..px)")
 * 결정적: 모두 순수 함수 또는 mount에서만 부르는 요소 만들기. 난수·시계 없음.
 */
(function () {
  "use strict";
  const B5 = {};
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // 24×24 상자 선 아이콘(stroke 2, 둥근 끝)
  const P = {
    spark: '<path d="M12 3.5 L13.9 10.1 L20.5 12 L13.9 13.9 L12 20.5 L10.1 13.9 L3.5 12 L10.1 10.1 Z"/>',
    book: '<path d="M12 6.2 Q8 4 3.5 4.6 V18.8 Q8 18.2 12 20.2 Q16 18.2 20.5 18.8 V4.6 Q16 4 12 6.2 Z"/><path d="M12 6.2 V20.2"/>',
    check: '<path d="M5 12.5 L10 17.2 L19 7.2"/>',
    search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15 L20 20"/>',
    file: '<path d="M6 3.5 H14 L18.5 8 V20.5 H6 Z"/><path d="M14 3.5 V8 H18.5"/>',
    image: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.7"/><path d="M4 17.5 L9.5 12.5 L13 15.5 L15.8 13 L20 16.8"/>',
    folder: '<path d="M3.5 7 Q3.5 5.5 5 5.5 H9.5 L11.5 7.5 H19 Q20.5 7.5 20.5 9 V17.5 Q20.5 19 19 19 H5 Q3.5 19 3.5 17.5 Z"/>',
    plus: '<path d="M12 4.5 V19.5 M4.5 12 H19.5"/>',
    mic: '<rect x="8.6" y="3.5" width="6.8" height="11" rx="3.4"/><path d="M5.5 11.5 Q5.5 17.5 12 17.5 Q18.5 17.5 18.5 11.5 M12 17.5 V20.5"/>',
    arrow_up: '<path d="M12 19 V5.5 M6.5 11 L12 5.5 L17.5 11"/>',
    arrow_right: '<path d="M5 12 H18.5 M13 6.5 L18.5 12 L13 17.5"/>',
    chev_right: '<path d="M9.5 5.5 L16 12 L9.5 18.5"/>',
    chev_down: '<path d="M6 9.5 L12 15.5 L18 9.5"/>',
    bolt: '<path d="M13.5 3 L5.5 13.5 H11.5 L10.5 21 L18.5 10.5 H12.5 Z"/>',
    mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M4 6.5 L12 12.8 L20 6.5"/>',
    clock: '<circle cx="12" cy="12" r="8.2"/><path d="M12 7.5 V12 L15.2 14"/>',
    branch: '<circle cx="6.5" cy="5.5" r="2"/><circle cx="6.5" cy="18.5" r="2"/><circle cx="17.5" cy="8.5" r="2"/><path d="M6.5 7.5 V16.5 M17.5 10.5 Q17.5 14 12 14 Q6.5 14 6.5 16.5"/>',
    sliders: '<path d="M4.5 7 H19.5 M4.5 17 H19.5"/><circle cx="9" cy="7" r="2.2"/><circle cx="15" cy="17" r="2.2"/>',
    globe: '<circle cx="12" cy="12" r="8.2"/><path d="M3.8 12 H20.2 M12 3.8 Q16 8 16 12 Q16 16 12 20.2 Q8 16 8 12 Q8 8 12 3.8"/>',
    doc: '<rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M8.5 8.5 H15.5 M8.5 12 H15.5 M8.5 15.5 H13"/>',
  };
  B5.icons = Object.keys(P);
  B5.icon = function (name, size, color, stroke) {
    const d = P[name];
    if (!d) throw new Error("B5.icon: 없는 아이콘 " + name + " (있는 것: " + B5.icons.join(",") + ")");
    const fill = name === "spark" || name === "bolt" ? color : "none";
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" overflow="visible" style="display:block"><g fill="${fill}" stroke="${color}" stroke-width="${stroke || 2}" stroke-linecap="round" stroke-linejoin="round">${d}</g></svg>`;
  };

  // 커서: 끝점(hotspot)이 SVG의 (0,0)에 오도록 그린다(바깥 묶음을 translate(x,y)).
  B5.cursor = function (kind, size) {
    const k = (size || 100) / 100;
    if (kind === "arrow") {
      return `<svg width="${80 * k}" height="${110 * k}" viewBox="-8 -8 80 110" overflow="visible" style="position:absolute;left:${-8 * k}px;top:${-8 * k}px"><path d="M0 0 L0 78 L19 60 L32 90 L46 84 L33 55 L58 55 Z" fill="#000" stroke="#fff" stroke-width="8" stroke-linejoin="round" paint-order="stroke"/></svg>`;
    }
    // 손: 검지 끝이 (0,0). hand = 펴서 가리킴, grab = 손가락을 오므림(쥠)
    const hand = "M0 4 Q0 -4 8 -4 Q16 -4 16 4 V40 Q20 34 27 35 Q33 36 34 42 Q38 37 45 38 Q51 40 51 46 Q55 42 61 44 Q67 47 67 55 V74 Q67 96 48 102 H22 Q11 102 5 92 L-14 62 Q-18 54 -12 50 Q-6 46 0 52 Z";
    const grab = "M-2 30 Q-2 22 6 22 Q13 22 14 29 Q16 24 23 24 Q31 25 32 32 Q35 27 42 28 Q49 30 49 37 Q53 33 59 35 Q66 38 66 46 V72 Q66 96 47 102 H22 Q11 102 5 92 L-10 66 Q-14 58 -8 54 Q-3 51 -2 56 Z";
    const lines = kind === "grab"
      ? '<path d="M14 30 V48 M32 32 V50 M49 37 V52" fill="none" stroke="#000" stroke-width="3.2" stroke-linecap="round"/>'
      : '<path d="M16 40 V58 M34 42 V60 M51 46 V62" fill="none" stroke="#000" stroke-width="3.2" stroke-linecap="round"/>';
    return `<svg width="${100 * k}" height="${125 * k}" viewBox="-20 -10 100 125" overflow="visible" style="position:absolute;left:${-20 * k}px;top:${-10 * k}px"><path d="${kind === "grab" ? grab : hand}" fill="#fff" stroke="#000" stroke-width="4" stroke-linejoin="round"/>${lines}</svg>`;
  };

  B5.el = function (tag, css, parent, html) {
    const e = document.createElement(tag);
    if (css) e.setAttribute("style", css);
    if (html !== undefined && html !== null) e.innerHTML = html;
    if (parent) parent.appendChild(e);
    return e;
  };
  B5.text = function (el, text, role, size, color, opt) {
    if (color) el.style.color = color;
    if (window.KTypo) {
      try { KTypo.dom(el, text, role, Object.assign({ size }, opt || {})); return el; } catch (e) {
        if (e && e.ktypo) throw e; // 서체를 못 읽었거나 ready(역할들)에 없는 역할 — 대체 서체로 몰래 그리지 않는다
        /* KTypo.load 전이거나 역할 없음 → 아래 */
      }
    }
    el.style.fontSize = size + "px";
    el.style.fontFamily = "system-ui, sans-serif";
    el.textContent = text;
    return el;
  };
  // mount 끝에 부른다: style 속성 글을 브라우저 꼴로 한 번 다시 써 둔다. 처음 쓴 글("left:16.0px")은 render가 같은 값을
  // 넣을 때 다시 쓰이지 않아, 다른 프레임을 다녀오면 글이 바뀐 것처럼 보였다(자가 시험 지문 어긋남 — chat_conversation에서 겪음).
  B5.normalize = function (root) {
    [root].concat(Array.from(root.querySelectorAll("[style]"))).forEach((e) => { if (e.getAttribute("style")) e.style.cssText = e.style.cssText; });
  };
  // mount 끝(normalize 전)에: render가 건드릴 속성(transform·opacity·filter·visibility)을 미리 넣어 둔다. 처음엔 없던 속성이
  // 다른 프레임을 다녀오면 생겨 style 글이 달라졌다(자가 시험 지문 어긋남 — drag_attach에서 겪음). 이미 있는 값은 그대로.
  B5.prime = function (els) {
    els.forEach((e) => {
      if (!e) return;
      if (!e.style.transform) e.style.transform = "none";
      if (!e.style.opacity) e.style.opacity = "1";
      if (!e.style.filter) e.style.filter = "none";
      if (!e.style.visibility) e.style.visibility = "inherit";
    });
  };
  // 보임/숨김: ""(속성 지움) 대신 "inherit"를 쓴다 — 지웠다 다시 넣으면 style 글에서 순서가 바뀌어 자가 시험 지문이 어긋났다.
  // "inherit"는 ""과 같은 뜻(부모를 따름)이라 바깥에서 숨긴 것을 되살리지 않는다.
  B5.vis = (el, on) => { el.style.visibility = on ? "inherit" : "hidden"; };
  B5.settle = function (n, a, r, delay) {
    n -= delay || 0;
    if (n <= 0) return 0;
    if (n < 1) return a * n;
    return 1 - (1 - a) * Math.pow(r, n - 1);
  };
  B5.lin = (n, N) => clamp(n / N, 0, 1);
  B5.blur = (px) => (px > 0.05 ? `blur(${px.toFixed(2)}px)` : "none");
  B5.clamp = clamp;

  window.B5 = B5;
})();
