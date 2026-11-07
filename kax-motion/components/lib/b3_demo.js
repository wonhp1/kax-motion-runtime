/* KCB3Demo — 전환 부품 데모에서만 쓰는 중립 장면 그리기(가상의 앱 화면 3가지). 부품이 아니다(부품 .js는 이 파일을 부르지 않는다).
 * 글자는 KTypo 역할, 색은 인자. 그림자 없음(평평한 면 + 옅은 테).
 *   KCB3Demo.ready  = KTypo.ready() 뒤 true로 바꿔 둔다(그 전에는 글자 없이 면만 그림)
 *   KCB3Demo.card(ctx, f, o)   o = {bg, panel, ink, sub, accent, title, value, unit, note, x, y, w, h, prog}
 *   KCB3Demo.list(ctx, f, o)   o = {bg, panel, ink, sub, accent, title, rows: [[제목, 값], ...]}
 *   KCB3Demo.title(ctx, f, o)  o = {bg, ink, sub, text, small, y}
 */
(function () {
  "use strict";
  const D = { ready: false };
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
  }
  function txt(ctx, s, role, x, y, size, color, align) {
    if (!D.ready || !s) return;
    ctx.fillStyle = color;
    KTypo.canvas(ctx, s, role, x, y, size, { align: align || "left" });
  }
  D.rr = rr;
  D.card = function (ctx, f, o) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    ctx.fillStyle = o.bg; ctx.fillRect(0, 0, W, H);
    const x = o.x === undefined ? 600 : o.x, y = o.y === undefined ? 250 : o.y, w = o.w || 720, h = o.h || 580;
    ctx.fillStyle = o.panel; rr(ctx, x, y, w, h, 56); ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.06)"; ctx.lineWidth = 2; rr(ctx, x, y, w, h, 56); ctx.stroke();
    txt(ctx, o.title, "ui_body", x + 64, y + 110, 40, o.sub);
    txt(ctx, o.value, "numeric_hero", x + 64, y + 270, 140, o.ink);
    txt(ctx, o.unit, "ui_title", x + w - 64, y + 270, 52, o.sub, "right");
    // 진행 막대
    const by = y + h - 150, bw = w - 128;
    ctx.fillStyle = "rgba(0,0,0,0.08)"; rr(ctx, x + 64, by, bw, 24, 12); ctx.fill();
    ctx.fillStyle = o.accent; rr(ctx, x + 64, by, bw * (o.prog === undefined ? 0.68 : o.prog), 24, 12); ctx.fill();
    txt(ctx, o.note, "ui_body", x + 64, by + 84, 34, o.sub);
  };
  D.list = function (ctx, f, o) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    ctx.fillStyle = o.bg; ctx.fillRect(0, 0, W, H);
    txt(ctx, o.title, "ui_title", 560, 250, 72, o.ink);
    (o.rows || []).forEach((r, i) => {
      const y = 330 + i * 150;
      ctx.fillStyle = o.panel; rr(ctx, 560, y, 800, 120, 36); ctx.fill();
      ctx.fillStyle = i === 0 ? o.accent : "rgba(0,0,0,0.12)";
      ctx.beginPath(); ctx.arc(630, y + 60, 26, 0, Math.PI * 2); ctx.fill();
      txt(ctx, r[0], "ui_body", 690, y + 74, 40, o.ink);
      txt(ctx, r[1], "numeric", 1310, y + 74, 40, o.sub, "right");
    });
  };
  D.title = function (ctx, f, o) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    ctx.fillStyle = o.bg; ctx.fillRect(0, 0, W, H);
    txt(ctx, o.text, "ui_title", W / 2, o.y || 560, o.size || 112, o.ink, "center");
    txt(ctx, o.small, "ui_body", W / 2, (o.y || 560) + 100, 44, o.sub || o.ink, "center");
  };
  window.KCB3Demo = D;
})();
