# typography/ — 한글 타이포 키트

한 줄 안에 한글·라틴·숫자가 섞일 때 **서체 짝·크기·기준선·자간·회전 중심을 실측값으로 자동으로 입히는** 키트.
규칙(무엇을 언제 쓰나)은 `references/typography.md`, 여기는 쓰는 법.

| 파일 | 하는 일 |
|---|---|
| `pairs.json` / `pairs.js` | 역할 9개의 라틴↔한글 짝 + 실측 보정값. `pairs.js` 는 같은 내용을 `window.KTYPO_PAIRS` 로(file:// 에서 JSON 을 못 읽어서). **손으로 고치지 말고** `tools/roles.json` 을 고친 뒤 다시 만든다 |
| `mixed_text.js` | `KTypo` — 구간 나누기, DOM·캔버스·kx 글자 엔진에 짝 입히기 |
| `tools/roles.json` | 역할별 서체 지정(사람이 고르는 곳) |
| `tools/measure.py` | fonttools 로 윤곽을 재서 `pairs.json`·`pairs.js` 를 만든다 |
| `tools/specimen.py` | 견본 판 렌더(헤드리스 Chromium 스크린샷, 결과는 typography 아래 specimens 폴더) |
| `tools/roles_candidates.json` | 견본 판 비교에 쓴 후보 짝(탈락 포함) |

## 다시 만들기

```bash
cd <스킬 뿌리>
mkdir -p typography/specimens/src                                                    # 견본 판 자리(처음 한 번)
python3 typography/tools/measure.py --build typography/tools/roles.json            # → typography/pairs.json, pairs.js
python3 typography/tools/specimen.py final_kinetic final_ui final_serif calibration  # → typography/specimens/*.png (최종 짝 견본 판)
python3 typography/tools/measure.py --dump                                          # 서체별 원측정값(tools/fonts_to_measure.json)
python3 typography/tools/measure.py --build typography/tools/roles_candidates.json typography/specimens/candidates_pairs.json   # 후보 표(후보 비교 판용)
```
필요: `pip install fonttools`. 견본 판은 헤드리스 Chromium — 환경 변수 `CHROME`, 없으면 스킬 뿌리 `kax_paths.json`의 `browser`, 그다음 PATH의 `chrome-headless-shell`·`chromium`. 판 왼쪽의 기준 그림은 `kax_paths.json`의 `refs` 폴더(공개 기본: 작업 폴더 `review/refs/`)에서 판의 유형으로 찾고, 없으면 그림 없이 그린다.
후보 비교 판(`kinetic`·`ui`·`serif`·`numeric`)은 위 마지막 줄로 만든 후보 표를 쓴다.

## 보정값은 어떻게 쟀나

모두 `fonttools` 로 가변 인스턴스 윤곽 상자(BoundsPen)를 잰 값. 한글 표본 53음절(받침 있음/없음 섞음)의 **중앙값**.

- **목표 비율** = Pretendard(Inter 를 바탕으로 한글을 맞춰 설계한 서체) 안의 관계: 한글 상자 높이 = **라틴 대문자 높이 × 1.228**, 한글 상자 가운데 = 대문자 가운데(차 +0.002). 다른 짝도 이 관계가 되도록 배율·기준선을 구한다.
  - 본문(`ui_body`, `mode: "x"`)은 대문자 대신 x높이 기준(Pretendard 의 한글/x높이 비).
  - 큰 키네틱 제목은 견본 판(1.15 / 1.228 비교)을 보고 **1.19** 로(`display_ratio`) — 1.15 는 한글이 가벼워 보이고, 1.228 은 '모션그래픽'처럼 한글이 긴 줄에서 라틴보다 커 보였다.
- **scale** = 목표 한글 높이 ÷ 그 한글 서체의 실측 한글 높이. 한글 구간 font-size 에 곱한다.
- **baseline_shift_em** = (목표 가운데 − 실측 가운데×scale), 라틴 font-size 의 em, + 가 위.
- **tracking_em** = 역할 기본 자간 + **밀도 보정**: 그 한글 서체의 글자 사이 빈칸(advance − 윤곽 폭)/높이 를 같은 굵기 Pretendard 와 같게 맞추는 값. 예) Noto Sans KR 은 Pretendard 보다 성겨 −2.65% 가 더 붙는다.
- **line_height** = 한글 높이(배율 뒤) × (1 + 줄 사이 빈칸 비) — 본문 0.62, 제목 0.3, 키네틱 0.14.
- **glyph_center** = [가로: advance 의 비, 세로: 기준선 위 em] — 한글 글자 상자 가운데. 회전·크기 변환 중심.

| 역할 | 라틴 | 한글 | 한글 배율 | 기준선(em) | 자간 % 라틴/한글 | 줄 간격 | 회전 중심 |
|---|---|---|---|---|---|---|---|
| ui_body | Inter 400 | Pretendard 400 | ×1.029 | 0 | 0 / −0.5 | 1.45 | (0.50·adv, 0.355em) |
| ui_title | Inter 700 | Pretendard 700 | ×1.005 | +0.009 | −2.5 / −2.5 | 1.16 | (0.50·adv, 0.355em) |
| kinetic_heavy | Archivo 850 wdth100 | Pretendard 850 | ×0.909 | +0.021 | −3 / −4 | 0.93 | (0.50·adv, 0.355em) |
| kinetic_wide | Unbounded 800 | Pretendard 900 | ×0.988 | +0.024 | −2 / −3 | 1.02 | (0.50·adv, 0.355em) |
| kinetic_condensed | Archivo 900 wdth75 | Black Han Sans | ×1.077 | −0.065 | −1 / −2.8 | 0.93 | (0.50·adv, 0.380em) |
| display_serif | Instrument Serif | Noto Serif KR 500 | ×0.918 | +0.019 | −1 / −3.2 | 1.11 | (0.50·adv, 0.373em) |
| serif_bold | Instrument Serif Italic | Hahmlet 600 | ×0.983 | +0.020 | −1 / −4 | 1.11 | (0.50·adv, 0.348em) |
| numeric | Inter 600 (숫자 tnum) | Pretendard 600 | ×1.013 | +0.006 | −1 / −1.5 | 1.16 | (0.50·adv, 0.355em) |
| numeric_hero | Big Shoulders 800 | Pretendard 800 (숫자 뒤 단위 ×0.5) | ×1.096 | +0.013 | 0 / −2.5 | 1.18 | (0.50·adv, 0.355em) |

"한글을 늘 1.08~1.12배 키운다" 같은 한 가지 배율은 맞지 않는다: 실측하면 Archivo 굵은 제목 옆 Pretendard 는 오히려 0.91배로 줄여야 하고, Big Shoulders 옆 Do Hyeon 은 1.2~1.3배를 키워야 맞는다(배율 1.215~1.298). 짝마다 값이 다르니 표에서 읽는다.

## 쓰는 법

### 1) 서체 등록
```html
<script src="typography/pairs.js"></script>
<script src="typography/mixed_text.js"></script>
<script>
  KTypo.load(window.KTYPO_PAIRS, "./");             // 둘째 인자: pairs.json 의 서체 경로(fonts/…) 앞에 붙일 기준 경로
  await KTypo.ready(["ui_title", "numeric"]);       // 쓰는 역할의 서체만 @font-face 등록 + 로드 대기. 렌더(첫 프레임) 전에 반드시
</script>
```
HyperFrames 프로젝트에 복사해 쓸 때는 **쓰는 역할의 서체 파일만** 프로젝트 `fonts/` 로 복사하고(`KTypo.fontFiles(역할들)` = 그 경로 목록, 역할별 파일 표는 `references/typography.md` 2장) `load` 의 기준 경로를 맞춘다. `pairs.json`·`pairs.js` 는 고치지 않는다. 렌더 중 네트워크로 서체를 받지 않는다.

| 부르는 꼴 | 하는 일 |
|---|---|
| `KTypo.ready(["ui_title", …])` (역할 하나면 문자열도 됨) | 그 역할들의 서체만 등록·로드. 그 서체 파일이 없으면 파일 이름이 적힌 오류로 거부. ready에 넣지 않은 역할(서체)로 `dom`·`layout`·`canvas`·`spec`을 부르면 오류(대체 서체로 몰래 그리지 않음). 여러 번 부르면 합침 |
| `KTypo.ready()` | 예전 호출 그대로: 모든 서체를 등록·로드해 보되, 못 읽은(404) 서체는 건너뛰고 `console.warn` — 그 서체를 쓰는 역할로 그릴 때만 오류. 서체가 다 있으면 예전과 같은 그림(v0.6.4 전체 회귀로 확인) |
| `KTypo.fontFiles(역할들)`·`KTypo.fontKeys(역할들)` | 역할들에 필요한 서체 파일 경로·키(인자 없음 = 전부) |
| `KTypo.missing()` | 못 읽은 서체 `[{font, path}]` |

오류에는 `e.ktypo = true` 가 붙는다(`components/lib/b5_ui.js` 의 `B5.text` 는 이 오류를 대체 서체로 덮지 않고 다시 던진다). `KTypo.d2Layout`(kx 엔진)은 잰 값만 읽으므로(글자는 `glyphs.js` 윤곽) 그 역할을 ready에 넣지 않아도 된다.

### 2) DOM 글자
```js
KTypo.dom(el, "Memo로 정리하는 일정", "ui_title", { size: 72 });         // 구간마다 <span class="kt-ko|kt-latin|kt-digit">
const g = KTypo.dom(el, "UX로 만드는 화면", "kinetic_heavy", { size: 160, split: true });
gsap.from(g, { rotate: -30, yPercent: 60, opacity: 0, stagger: 0.04 });   // g = 글자 span 배열, transform-origin 이 이미 글자 상자 가운데
```
- 한글 구간: `font-size: scale em`, `position:relative; top: −shift/scale em`(줄 상자 높이는 그대로), `letter-spacing: tracking em`.
- `split:true` 의 회전 중심은 **기준선을 0크기 inline-block 표식으로 재서** 정한다(서체마다 다른 ascent/descent·line-height 계산에 기대지 않음). 변환을 걸기 **전에** 정해지므로, 글자 크기를 바꾼 뒤에는 `KTypo.setOrigins(el)` 을 다시 부른다.
- 같은 줄에 역할을 둘 섞기(산세리프 제목 안 세리프 한 단어): 바깥 `<div style="font-size:80px">` 안에 `<span>` 두 개를 두고 각각 `KTypo.dom(span, …, "ui_title")`, `KTypo.dom(span2, "일정", "display_serif")`.

### 3) 캔버스
```js
KTypo.canvas(ctx, "수 · 오후 3:00 회의", "numeric", 960, 540, 64, { align: "center", tabular: true });
const L = KTypo.layout(ctx, "UX로 만드는 화면", "kinetic_heavy", 960, 540, 160, { align: "center" });
// L.items[i] = {ch, font, stretch, x, y(기준선), adv, center:[x,y]} — 글자 단위 애니메이션은 이걸로 직접 그린다:
for (const it of L.items) { ctx.save(); ctx.translate(...it.center); ctx.rotate(a); ctx.translate(-it.center[0], -it.center[1]);
  ctx.font = it.font; ctx.fontStretch = it.stretch; ctx.fillText(it.ch, it.x, it.y); ctx.restore(); }
```
- 캔버스 2D 에는 `font-variation-settings` 가 없다: 굵기는 `font` 의 숫자, 폭(wdth)은 `ctx.fontStretch` 키워드(75 = condensed, 87.5 = semi-condensed …)로만. 그래서 `kinetic_condensed` 는 wdth 75 로 정했다. 축 값이 자유로워야 하면 kx 글자 엔진(아래)을 쓴다.
- `tabular:true` 는 숫자를 같은 칸 폭에 가운데 놓는다(캔버스는 `tnum` 을 못 켬). 글자를 하나씩 그리므로 커닝은 빠진다(제목 자간을 직접 정하는 키네틱에는 문제없음).

### 4) kx 글자 엔진에서 한글 쓰기
kx 엔진(`engine/kx/`)은 서체 윤곽을 Path2D 로 그린다. 한글도 그대로 된다 — 고칠 파일 없이:

1. `spec.json` 에 한글 서체·쓸 글자를 넣고 윤곽을 뽑는다(쓸 음절을 **전부** 넣을 것):
   ```json
   {"fonts": {"AR": "fonts/Archivo[wdth,wght].ttf", "PR": "fonts/PretendardVariable.ttf"},
    "uses": [{"font": "AR", "axes": {"wdth": 100, "wght": 850}, "text": "UX KAX"},
             {"font": "PR", "axes": {"wght": 850}, "text": "로 만드는화면모션그래픽"}]}
   ```
   `python3 engine/kx/glyphs.py spec.json glyphs.js` (가변 Pretendard 도 축 값 그대로 인스턴스가 된다. 음절 하나 ≈ 0.4KB).
2. `KX.layoutWord` 대신 `KTypo.d2Layout` 으로 줄을 짠다 — 한글 글자만 `size×scale`, 기준선 `−shift×size`, 역할 자간, 글자마다 `anchorEm`(회전 중심):
   ```js
   KTypo.load(window.KTYPO_PAIRS); KTypo.patchD2(KXP);      // KXP.letterAnchor 가 it.anchorEm 을 쓰게(라틴 글자는 원래 규칙 그대로)
   const ins = { latin: KX.inst("AR", { wdth: 100, wght: 850 }), ko: KX.inst("PR", { wght: 850 }) };
   const w = KTypo.d2Layout(KX, ins, "UX로 만드는 화면", 150, 960, 330, { align: "center", role: "kinetic_heavy" });
   KX.title({ z: 1, items: w, motions: [KXP.letters("letter_spin_land", 0)] });
   ```
3. 손으로 할 때의 같은 보정: 한글 글자 `size = 라틴 em × scale`, `pen.y = 기준선 − baseline_shift_em × 라틴 em`, 회전 중심 = `pen + (glyph_center[0] × adv, −glyph_center[1] × size)`.
   - kx 엔진 기본 기준점 `pen + (0.3em, −0.36em)` 은 **라틴 대문자용**이다. 한글은 advance 가 0.86~0.97em 이라 가로 0.3em 은 글자 왼쪽 1/3 이 되어 회전이 비뚤게 돈다 → 반드시 위 값(가로 ≈ 0.5·adv, 세로 0.35~0.38em).
   - `KX.wordFill` 의 `cap`(기본 0.72)은 한글 줄이면 한글 윗선으로: `cap = top_em × scale + baseline_shift_em`(kinetic_heavy ≈ 0.75).

## 구간 나누기 규칙 (`KTypo.segments`)
- 한글(음절·자모) → `ko`, A–Z·라틴 확장 → `latin`, 0–9 → `digit`.
- 숫자 사이의 `: . , /` 와 숫자 뒤 `%`, 공백 뒤 부호 `+30 −12` → 숫자 구간(표 숫자 tnum 이 같이 걸림). `D-3` 의 `-` 는 라틴.
- 공백은 늘 라틴 서체(Black Han Sans 공백이 넓어 낱말 사이가 벌어지던 것 — 견본 판에서 확인).
- 한글 뒤 쉼표·마침표는 한글 서체, `· | /` 같은 구분 기호는 라틴 서체(Inter 의 가운뎃점이 더 단정함).
- 숫자 바로 뒤 한글(12,480**명**)은 역할에 `ko_unit_scale` 이 있으면 그 배율로 작게, 글자 바닥을 기준선에 붙이고 0.06em 띄운다(`numeric_hero` = 0.5).
