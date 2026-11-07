/* KXG — 3×3 칸 배치·자르기 상자(예시 패키지 design.json layout.grid의 잰 값). 칸 번호 1(왼쪽 위) ~ 9(오른쪽 아래). */
(function () {
  "use strict";
  const G = {
    cx: [425, 960, 1495], cy: [318, 585, 850],
    colRight: [712.5, 1248.5, 1783.5], rowBottom: [481.5, 745.5, 1008.5],
    boxW: 577, boxH: [275, 326, 269],
  };
  const rc = (n) => [Math.floor((n - 1) / 3), (n - 1) % 3];
  G.center = (n) => { const [r, c] = rc(n); return [G.cx[c], G.cy[r]]; };
  // 칸 자르기 상자 [x0,y0,x1,y1] — 퇴장·마스크 때만 보이는 선. 새 작품에서 칸 간격을 바꾸면 같은 비율로.
  G.cellBox = (n) => { const [r, c] = rc(n); return [G.colRight[c] - G.boxW, G.rowBottom[r] - G.boxH[r], G.colRight[c], G.rowBottom[r]]; };
  // 칸 안에 놓을 '프리컴프 1/3' 배율: 1920×1080 화면용으로 디자인한 크기에 이 값을 곱한다(0.30~0.33)
  G.precompScale = 0.315;
  // 칸 등장 시작 프레임(1박 ≈ 9.47프레임 @152BPM): 판 첫 칸 시작 f0부터
  G.starts = (f0, beat) => Array.from({ length: 9 }, (_, i) => Math.round(f0 + i * (beat || 9.47)));
  window.KXG = G;
})();
