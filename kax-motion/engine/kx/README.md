# kx 엔진 — 글자 단위 키네틱

캔버스 2D 하나에 글자를 **서체 윤곽 Path2D + 글자마다 프레임별 2×3 행렬**로 그린다. HTML 글자·CSS 애니메이션을 쓰지 않아 가변 축·자간·서브픽셀 자리가 렌더마다 같다. HyperFrames는 시간축만 맡는다(드라이버 트윈 하나가 `KX.render(F)`를 부른다). 예시 `meta.engine`이 `kx`이면 이 엔진을 쓴다. 화면은 16:9(1920×1080)만 된다.

| 파일 | 하는 일 | 입력 | 출력 |
|---|---|---|---|
| `glyphs.py` | 서체 가변 인스턴스 윤곽 → `glyphs.js` | `spec.json`(서체 경로 + 쓸 글자·축) | `window.KG[inst][ch] = {d, adv}`, `window.KGM[inst]`(cap·x높이) |
| `core.js` (`KX`) | 렌더러: 바탕·층·글자·자르기·그라데이션·도형·움직임 번짐·화면 부드럽게 | `KX.init`, `KX.layoutWord`, `KX.wordFill`, `KX.title`, `KX.layer` | 캔버스 `#cv` |
| `presets.js` (`KXP`) | `motion.json` 표 → 글자·묶음 변환 | `KXP.load(motion)`, `KXP.letters`, `KXP.group`, `KXP.bounce`, `KXP.bounceWords`, `KXP.swing3d` | `KX.title`의 `motions` 항목 |
| `grid.js` (`KXG`) | 3×3 칸 가운데·자르기 상자·1/3 배율·박 간격 | 칸 번호 1~9(왼쪽 위 → 오른쪽 아래) | `center(n)`, `cellBox(n)`, `starts(f0, beat)`, `precompScale` |

## 준비
1. 이 폴더(`engine/kx/`)를 작업 폴더 `engine/`으로 복사한다. GSAP은 이 스킬 `vendor/gsap.min.js`를 작업 폴더 `vendor/`로(렌더 중 네트워크 금지).
2. **서체**: 이 스킬 `fonts/`(OFL)에서 쓸 것만 작업 폴더 `fonts/`로. 축 값을 다 적는다 — Big Shoulders는 `opsz`(72 또는 40/60)까지, Archivo는 `wdth`(100 또는 112)까지. 축을 빼면 기본값이 들어가 폭·획이 달라진다.
3. **글자 윤곽**: `spec.json`에 서체와 쓸 글자를 **전부**(공백·구두점 포함) 넣고 뽑는다. 빠진 글자가 있으면 `KG에 글자 없음` 오류로 렌더가 멈춘다.
   ```json
   {"fonts": {"AR": "fonts/Archivo[wdth,wght].ttf", "PR": "fonts/PretendardVariable.ttf"},
    "uses": [{"font": "AR", "axes": {"wdth": 100, "wght": 850}, "text": "LOOP"},
             {"font": "PR", "axes": {"wght": 800}, "text": "오늘 동네 빵집 새 메뉴 3초 영상"}]}
   ```
   `python3 -I engine/glyphs.py spec.json glyphs.js` — `fonttools`가 필요하다(없으면 사용자 승인 뒤 설치). 인스턴스 이름은 서체 키 + 축(태그 알파벳 순): `KX.inst("AR", {wdth: 100, wght: 850})` → `"AR_wdth100_wght850"`. 커닝은 넣지 않는다(키네틱은 자간을 직접 정함).
4. **움직임 표**: 이름 프리셋은 예시 `motion.json`에서 온다. 스크립트로 감싼다: `(printf "window.MOTION="; cat example/motion.json; printf ";") > motion.js` → `KXP.load(window.MOTION)`.
   - `KXP.bounce`·`KXP.bounceWords`는 `letter_toss_wobble`·`letter_stretch_pop` 표로 만든다. 그 둘이 없는 예시면 `get_motion_presets`로 받아 넣는다 — 받은 표는 `keys.rows`가 행 목록이라 `MOTION.presets[이름] = Object.assign({}, 받은 것, {keys: 받은 것.keys.rows})`.

## 쓰는 예
```html
<div id="root" data-composition-id="main" data-start="0" data-duration="4.5" data-fps="24" data-width="1920" data-height="1080">
  <canvas id="cv" width="1920" height="1080"></canvas>
</div>
<script src="vendor/gsap.min.js"></script><script src="glyphs.js"></script><script src="motion.js"></script>
<script src="engine/core.js"></script><script src="engine/presets.js"></script><script src="engine/grid.js"></script>
<script src="typography/pairs.js"></script><script src="typography/mixed_text.js"></script>
<script>
  KXP.load(window.MOTION);
  KTypo.load(window.KTYPO_PAIRS); KTypo.patchD2(KXP);              // 한글 회전·눌림 중심 = 글자 상자 가운데
  KX.init({ canvas: document.getElementById("cv"), bg: "rgb(243,239,232)", blur: 0.5,
            motionBlur: { samples: 0, shutter: 0.5, center: "space", cap: 0.5, gap: 1.5 } });

  // 라틴 낱말: 칸 8에 글자 단위 등장
  const box = KXG.cellBox(8), em = 136;
  const word = KX.layoutWord(KX.inst("AR", { wdth: 100, wght: 850 }), "LOOP", em, KXG.center(8)[0], box[3] - 0.7 * em, { align: "center", tracking: -0.03 });
  KX.wordFill(word, { dir: "v", stops: [[254, 136, 18], [249, 170, 18]] });        // 글자에 붙어 움직이는 그라데이션
  KX.title({ z: 10, items: word, motions: [KXP.letters("letter_spin_land", 6)], clip: () => KX.rect(...box) });

  // 굵은 한글 문장: 낱말 묶음으로 떨어져 튐(R10), 강조 낱말 하나만 글자 단위
  const TEXT = "오늘 동네 빵집 새 메뉴";
  const ins = { latin: KX.inst("AR", { wdth: 100, wght: 850 }), ko: KX.inst("PR", { wght: 800 }) };
  const line = KTypo.d2Layout(KX, ins, TEXT, 150, 960, 600, { align: "center", role: "kinetic_heavy" });
  const bw = KXP.bounceWords(4, { words: TEXT, stagger: 6, drop: "offscreen", tempo: 1.2, focus: { word: 4, stagger: 2, squash: 0.15 } });
  KX.title({ z: 11, items: line, motions: [bw] });

  const FPS = 24, N = 108, DUR = N / FPS;
  const tl = gsap.timeline({ paused: true }), drv = { t: 0 };
  tl.to(drv, { t: DUR, duration: DUR, ease: "none", onUpdate: () => KX.render(Math.min(N - 1, drv.t * FPS)) });
  window.__timelines = window.__timelines || {};
  window.__timelines["main"] = tl;
  // 효과음 시각: bw.landFrames() — 낱말마다 [첫 착지, 튐 착지 …] 절대 프레임, bw.events() — 사건 목록(R12)
</script>
```
- 루트 `data-fps="24"`, 렌더 `--fps 24`. 23.976이나 `30000/1001`을 섞지 않는다(프레임 번호가 밀린다). `data-duration` = 프레임 수 ÷ 24.
- `window.__timelines["main"] = tl` 줄은 HTML 안에 글자 그대로. 렌더 전 `npx hyperframes@0.8.188 lint` 오류 0, 렌더는 `--workers 2`(스킬의 `references/render.md`).

## 핵심 규칙
- **`KX.title({z, items, motions, clip, until})`**: `motions` 각 항목은 `{from, to, fn, hold, entry}`. `fn(F, i, item)` → `{T: 화면 상대 행렬, a}` 또는 `null`(숨김). 최종 = 마지막 동작 ∘ … ∘ 첫 동작 ∘ 정착. 뒤에 쌓은 동작이 바깥(나중에 곱함)이다.
- **등장·퇴장**: 등장 동작은 `from` 전에 숨는다(entry), 퇴장(`exit…`)·`hold_…` 동작과 첫 줄이 정착 자세인 표(모프 등)는 `from` 전에는 건너뛴다. 판정은 표 첫 줄로(`KXP.entryOf`), `opt.entry`로 직접 정해도 된다. 퇴장 뒤 숨기려면 `{hide: true}` 또는 `title.until`.
- **기준점**: 글자 = 펜 + (0.3em, −0.36em), 묶음 = 그 평균. 표의 이동은 em 단위라 글자 크기가 달라도 그대로 맞는다. 0.3em은 라틴용이다 → 한글은 `KTypo.patchD2(KXP)` + `KTypo.d2Layout`(글자마다 `anchorEm`).
- **스태거**: `KXP.letters`는 잰 스태거(`stagger_frames`)를 쓰고 글자가 더 많으면 평균 간격으로 늘린다. `{stagger: 1}`처럼 숫자로, `{order: "rtl" | "center"}`.
- **진폭**: `{amp: {move: 0.8, rot: 1.2, scale: 1, shear: 1}}` — 새 디자인에 맞게 조금씩만(0.7~1.3). 곡선 모양(프레임 수·넘침 비)은 바꾸지 않는다. 한글 글자 단위는 회전·크기 0~0.5배(R7).
- **넘침만 따로**: `amp.over`(위치)·`amp.rotOver`(회전)·`amp.scaleOver`(배율) — 정착값을 지나친 쪽만 곱한다. `KXP.overshootOf(이름, "dy" | "rot" | …)`가 표의 넘침 비를 준다. 예: `letter_spin_rise_overshoot`를 0.8em 솟고 9%만 넘치게 → `{amp: {move: 1.03, over: 0.09 / KXP.overshootOf("letter_spin_rise_overshoot", "dy")}}`.
- **자르기**: `KX.rect(x0, y0, x1, y1)`, `KX.above(y)`(기준선 마스크: y 위만 보임), `KX.below(y)`, `KX.leftOf(x)`·`KX.rightOf(x)`, 직접 `[[nx, ny, d], …]`(nx·x + ny·y ≤ d 쪽 보임). 마스크선은 프레임마다 바꿔도 된다(`clip(F)`). 보이지 않는 마스크선이 글자를 조각내면 안 된다(R10) — 선을 화면에 보이는 바닥선·판 가장자리와 맞춘다.
- **도형·자유 그리기**: `KX.layer(z, (ctx, F) => …)`. `KX.shapes.rect`·`bent(ctx, xc, L, ye, b, T, fill, alpha)`(휘는 막대 — 표 `bar_*`는 최종 상자 비율이라 새 크기에 곱해 씀)·`vgrad`·`hgrad`.
- **3D 줄 회전**: `KXP.swing3d(t0, t1, F => phi(F), axisX, cellCenter, 300)` — φ는 `line_3d_swing_in` 표의 마지막 열을 보간해 쓴다.
- **바탕 결**: `KX.under = (c, F) => …`(장면 맨 밑에 그림, 스킬의 `references/texture.md` 1장).
- **칸 박자**: `KXG.starts(f0, beat)`·`KXP.cellStarts(first, n, beatFrames)` — 칸 등장 간격 = 한 박(24fps·152BPM이면 9.47프레임). `KXG.precompScale`(0.315) = 1920 화면용으로 디자인한 크기를 칸에 넣을 때 곱하는 값.
- **가짜 이탤릭**: `layoutWord`의 `skew`(밀림 0.15~0.25). 진짜 이탤릭 서체는 모양이 달라 섞지 않는다. 한글에는 기울임을 쓰지 않는다.

## 움직임 번짐 — `KX.init({motionBlur: {samples, shutter, center, cap, gap}})`
| 칸 | 기본 | 뜻 |
|---|---|---|
| `samples` | 0(끔) | 서브프레임 표본 수. 1보다 크면 F 둘레 표본을 정확한 평균으로 섞는다(렌더 시간 × 표본 수) |
| `shutter` | 0.5 | 번짐 시간 폭(장면 프레임 단위) |
| `center` | `"space"` | 표본을 가장 빠른 글자 묶음이 **지나간 길**을 따라 F 자리 앞뒤로 반씩 고르게 — 움직임 방향 가운데 기준(R13). `"time"` = 시각으로 고르게(빨라지거나 멈추는 움직임에서 한쪽 진한 꼬리가 됨) |
| `cap` | 0.5 | 번짐 길이 ≤ cap × 그 묶음 화면 위 짧은 변(잉크 상자). 0이면 상한 없음 |
| `gap` | 0 | > 0이고 `KX.mbSamples`가 없으면 표본 수를 스스로: 번짐 길이 ÷ gap(px) + 1(최대 64). 사본 간격 2px 이하면 `gap: 1.5`~2(E5) |

- 갈고리: `KX.mbSamples(F)`(프레임마다 표본 수 — 주면 그 값), `KX.speedHints(F)`(도형 층 빠르기 px/프레임 — 엔진은 그리기 층의 길을 모름), `KX.speedAt(F)`, `KX.sampleTimes(F, n)`, `KX.blurGeom(F)`, `KX.inkBox(it)`·`KX.glyphBox(inst, ch)`, `KX.stateOf(title, F, i)`·`KX.pathOf(it)`(글자 모양 안 빛 지나감용), `KX._blur`(마지막 프레임 번짐 정보 — 측정용).
- 번짐을 켜면 표의 첫 1~3프레임 낮은 불투명도가 번짐과 겹쳐 너무 흐려진다 → `KXP.letters(…, {solid: true})`로 첫 프레임만 빼고 불투명도 1.
- 첫 프레임 앞·마지막 프레임 뒤 표본은 잘라 쓴다(`KX.lastFrame`을 주면 그 프레임까지).
- 공용 부품(`KC.toKX`)을 넣을 때 자기 번짐이 있는 부품은 엔진 번짐을 겹치지 않게 그린다(`components/README.md` '번짐 겹침').
- HyperFrames 자동 번짐(`data-motion-blur`)은 켜지 않는다(클립 밖에 칠해짐).

## 통통 튐 — `KXP.bounce(t0, opt)`
잰 곡선 두 개(`letter_toss_wobble` 솟음·낙하, `letter_stretch_pop` 눌림)로 만든다. 다른 프리셋 반쪽을 이어 붙이지 않는다(R8). 튐 높이 h → 시간은 √h에 비례한다(중력).

| 입력 | 기본 | 뜻 |
|---|---|---|
| `drop` | 1.5 | 처음 떨어지는 높이(em). 0 = 바닥에서 바로 튐. `"offscreen"` = 화면 위 밖에서 통째로 떨어져 들어옴 |
| `v0` | 없음 | 주면 이미 떨어지는 중으로 화면에 들어옴(낙하 표 v0칸부터) |
| `bounces`·`h1`·`decay` | 2 · drop × decay · 0.25 | 착지 뒤 튀는 횟수 · 첫 튐 높이(em) · 튐마다 높이 비(공처럼 오래 튀게 0.4~0.5) |
| `squash` | 0.75 | 눌림 세기(가장 깊을 때 세로 0.67배). 한글 키네틱은 0.3~0.5 |
| `rot` | 0.45 | 기울기 배수(꼭대기에서 ±5.8°). 자간 −2~−4% 한글은 0~0.5(R7) |
| `tempo` | 1 | 빠르기(1.3이면 30% 빨리) |
| `hops` | 없음 | `[{h, s}]` 직접 지정(위 셋 대신) |
| `stagger`·`order` | 2 · `"ltr"` | 글자 사이 프레임 · 차례 |
| `fallStretch` | 꺼짐(`"offscreen"`이면 켬) | 표(1.47em)보다 높은 낙하·튐을 표 전체를 √(h/1.47)배 늘려 씀 |

- `.landFrames()` → 글자별 절대 착지 프레임 → 효과음 시각에 그대로(D4). `"offscreen"`이면 `KX.title`로 묶은 뒤에 부른다(그 전엔 표가 없음).
- 박자에 맞춰 시작을 먼저 정하려면 `KXP.bounceKeys(Object.assign({}, opt, {drop: KXP.offscreenDrop(글자들)}))`의 `lands`(t 기준 착지 프레임)로 잰다. `KXP.offscreenDrop(items, pad)` = (가장 낮은 기준선 y + pad × em) ÷ em(em = 가장 큰 글자, pad 기본 0.3).
- 표만 필요하면 `KXP.bounceKeys(opt)` → `keys`(다른 프리셋과 같은 꼴 `[t, dx, dy, sx, sy, rot, sh, a]`), `keys.lands`.

## 낱말 묶음 튐 — `KXP.bounceWords(t0, opt)` (R10)
굵기 700 이상 한글은 글자 단위로 떨어뜨리거나 튀기지 않는다. 낱말(어절)마다 글자들이 **같은 변환 하나**로 떨어지고 튀며, 낱말끼리는 엇갈려 시작한다. 곡선은 `KXP.bounce`와 같은 표. 강조 낱말 하나만 글자 단위로 고를 수 있다.

| 입력 | 기본 | 뜻 |
|---|---|---|
| `words` | 스스로 | `"오늘 동네 빵집"`(그 글자 목록을 만든 문장 — 띄어쓰기로) \| `[2, 2, 2]`(낱말마다 글자 수, 공백 뺌) \| `[[0, 1], [2, 3]]`(글자 번호). 안 주면 글자 사이 틈 > `gapEm`(0.1em)·기준선 차이로 나눔 — 문장을 주는 것이 가장 확실 |
| `stagger` | 6 | 낱말 사이 시작 차(프레임). 배열 `[0, 6, 14, …]`이면 낱말마다 시작(t0 기준 — 박자에 맞출 때) |
| `order` | `"ltr"` | `"rtl"` \| `"center"` |
| `drop` | 1.5 | 처음 떨어지는 높이(낱말 em). `"offscreen"` = 화면 위 밖에서 통째로(보이지 않는 마스크가 글자를 조각내지 않게). `offscreenPad` 0.3em |
| `v0`·`bounces`·`h1`·`decay`·`tempo`·`hops` | –·2·0.35·0.3·1·– | `KXP.bounce`와 같은 뜻(낱말 em 기준) |
| `squash` · `rot` | 0.3 · 0 | 낱말 눌림·기울기(넓은 낱말이 기울면 끝이 바닥선 밑으로 내려가서 기본 0) |
| `focus` | 없음 | 강조 낱말 하나만 글자 단위: `{word: 번호, stagger: 2, squash: 0.15, h1, decay, bounces}` — 회전은 늘 0, 눌림은 0.2까지(넘게 주면 잘라 쓰고 경고). 숫자 하나(`focus: 4`)도 된다. 배열이면 오류(하나만) |
| `blurCap` | 0.22 | 이 동작 글자의 번짐 길이 ≤ blurCap × 그 묶음에서 가장 낮은 글자의 잉크 높이(R10 '25% 이하'에 여유). 0이면 이 상한 없음 |
| `fallStretch` | true | 표(1.47em)보다 높은 낙하를 √높이로 늘림 |

돌려주는 것:
- `.landFrames()` — 낱말마다 `[첫 착지, 튐 착지 …]` 절대 프레임(강조 낱말은 첫 글자 것). `.focusLandFrames()` — 강조 낱말 글자마다.
- `.events()` — `[{f, onset, land, type: "word_land" | "word_hop" | "letter_land" | "letter_hop", tier: "normal" | "detail", word, letter?, hint?}]`. 첫 낱말 첫 착지에 `hint: "first"`, 강조 낱말 첫 착지에 `hint: "signature"` → `KC.retier`가 영상 전체에서 하나씩 고른다(R12).
- `.words`(낱말별 글자 번호), `.keysOf(w)`.

예: 따뜻한 미색 바탕, Pretendard 800 150px 자간 −3% '오늘 동네 빵집 새 메뉴'를 낱말마다 화면 위 밖에서 6프레임 차로 떨어뜨려 두 번 튀게 하고 강조 '메뉴'만 글자 단위로 두면, 108프레임 내내 이웃 글자·낱말 잉크가 겹치지 않고(이웃 낱말 틈 최소 27px), 세로 번짐 길이는 글자 잉크 높이의 22% 안이다. 착지는 6프레임 간격, 튐은 착지 +9·+14프레임에 온다.

## 함정
- `glyphs.js`에 없는 글자를 쓰면 렌더가 멈춘다 → 쓸 글자를 `spec.json`에 모두(공백·구두점 포함).
- 브라우저 `font-variation-settings`에 기대지 않는다. 축 값은 `glyphs.py`로 뽑은 인스턴스로만.
- 자르기선은 화소로 잰다. 크롭 그림 가장자리를 칸 끝으로 잘못 읽기 쉽다. 칸 상자는 `KXG.cellBox`의 값.
- 줌 통과 퇴장은 낱말마다 깊이를 다르게 둔다. 묶음 하나로 키우면 어색하다.
- 정지 구간도 살아 있게: 큰 낱말이 프레임당 −0.2%씩 줄어드는 흐름(`hold_micro_drift` 같은 묶음 동작). 정지 흐름은 표 전체를 쓰고 시작 시각을 글자 등장 뒤로 둔다.
- 화면 전체를 σ 0.3~0.6px 부드럽게(`KX.init({blur})`)하면 날카로운 캔버스 가장자리가 덜 딱딱해 보인다.
- 빠른 정지 화면 확인: 헤드리스 브라우저로 `index.html?f=N`을 열고 `KX.render(N)` 뒤 `#cv.toDataURL()`을 저장한다. 렌더와 같은지는 렌더 초안 프레임으로 확인한다.
