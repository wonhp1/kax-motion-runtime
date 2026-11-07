# 한글 서체 키트 쓰는 법

한 줄 안에 한글·라틴·숫자가 섞일 때 서체 짝·크기·기준선·자간·회전 중심을 잰 값으로 입히는 법이다. 규칙(무엇을 언제 쓰나)은 `references/rules.md` — 한글 타이포 A4, 강조 T1, 격자 T2, 크기 재기 T3, 데이터 UI R9, 굵은 한글 키네틱 R10.

| 파일 | 하는 일 |
|---|---|
| `typography/pairs.json` | 역할 9개의 라틴↔한글 짝 + 잰 보정값(`measured`). 서체 파일 경로(`fonts`) |
| `typography/pairs.js` | 같은 내용을 `window.KTYPO_PAIRS`로(브라우저가 file://에서 JSON을 못 읽어서) |
| `typography/mixed_text.js` | `KTypo` — 구간 나누기, DOM·캔버스·kx 엔진에 짝 입히기 |
| `typography/tools/roles.json`·`typography/tools/measure.py` | 역할별 서체 지정과, 윤곽을 재서 `pairs.json`·`pairs.js`를 다시 만드는 도구(`fonttools` 필요). 짝 표는 손으로 고치지 않고 이 둘로 다시 만든다 |

## 1. 역할 9개

한 화면은 역할 2~3개만 쓴다(A4). 아래 값은 `pairs.json`의 `measured`에 들어 있고 `KTypo`가 저절로 입힌다.

| 역할 | 쓰는 곳 | 라틴 | 한글 | 한글 배율 | 자간 라틴/한글 | 줄 간격 |
|---|---|---|---|---|---|---|
| `ui_body` | UI 본문·설명·라벨 | Inter 400 | Pretendard 400 | ×1.029 | 0 / −0.5% | 1.45 |
| `ui_title` | UI 제목·카드 제목 | Inter 700 | Pretendard 700 | ×1.005 | −2.5 / −2.5% | 1.16 |
| `kinetic_heavy` | 키네틱 타이틀 기본 | Archivo 850 (wdth 100) | Pretendard 850 | ×0.909 | −3 / −4% | 0.93 |
| `kinetic_wide` | 로고·끝맺음(넓은 라틴) | Unbounded 800 | Pretendard 900 | ×0.988 | −2 / −3% | 1.02 |
| `kinetic_condensed` | 압축 포스터형, 한글이 주인공 | Archivo 900 (wdth 75) | Black Han Sans | ×1.077 | −1 / −2.8% | 0.93 |
| `display_serif` | 세리프 강조·인용·큰 한 줄 | Instrument Serif | Noto Serif KR 500 | ×0.918 | −1 / −3.2% | 1.11 |
| `serif_bold` | 굵은 제목 안 한 낱말을 같은 무게 세리프로 | Instrument Serif Italic | Hahmlet 600 | ×0.983 | −1 / −4% | 1.11 |
| `numeric` | 날짜·시각·통계 줄 | Inter 600 + 표 숫자(tnum) | Pretendard 600 | ×1.013 | −1 / −1.5% | 1.16 |
| `numeric_hero` | 숫자 하나가 주인공 | Big Shoulders 800 | Pretendard 800, 숫자 뒤 단위 ×0.5 | ×1.096 | 0 / −2.5% | 1.18 |

- 짝을 고른 까닭: `ui_*`·`numeric`은 Inter를 바탕으로 만든 한글(Pretendard)이라 획 끝·x높이·간격이 한 집안이다. 키네틱 짝은 그로테스크 블랙끼리, `kinetic_wide`는 넓은 라틴 옆에서 한글을 한 단계 굵게 해 무게를 맞춘다. `display_serif`는 산세리프 제목 안 가벼운 세리프 전환(T1의 4번 강조)에 쓴다.
- **Noto Sans KR**은 Pretendard를 못 쓸 때의 대체다. 간격이 성겨 자간을 Pretendard보다 −2.65% 더 조여야 한다. **Do Hyeon·Gasoek One**은 장식 한정이다(기본 짝에 없음, A4 금지 1).
- 밝은 바탕을 고를 때의 기본 취향: 따뜻한 오프화이트 천 결(`references/texture.md` 3장) + 산세리프 제목 안 **세리프 전환 강조**(`display_serif`).

보정값의 뜻(`pairs.json` `measured`):
- `scale` — 같은 font-size에서 한글 구간에 곱할 배율. 목표 비는 Pretendard 안의 관계(한글 높이 = 라틴 대문자 × 1.228, 가운데 = 대문자 가운데). 큰 키네틱 제목은 견본 판을 보고 1.19로 둔다(1.228이면 긴 한글 줄이 라틴보다 커 보였다).
- `baseline_shift_em` — 한글 구간을 올릴 양(+가 위), 라틴 font-size의 em.
- `tracking_em` — 역할 기본 자간 + 밀도 보정(그 한글 서체 글자 사이 빈칸을 같은 굵기 Pretendard와 같게).
- `glyph_center` — 글자 상자 가운데 [가로: advance의 비, 세로: 기준선 위 em]. 회전·크기 변환 중심.

## 2. `KTypo`로 섞어 쓰기

### 서체 등록
작업 폴더에 `typography/pairs.js`·`typography/mixed_text.js`와, **쓰는 역할의 서체 파일만** `fonts/`로 복사한다. `pairs.json`의 서체 경로는 `fonts/…`이므로 작업 폴더 뿌리를 기준 경로로 준다. `ready`에는 쓰는 역할을 넘긴다 — 그 역할의 서체만 등록·로드한다.

```html
<script src="typography/pairs.js"></script>
<script src="typography/mixed_text.js"></script>
<script>
  KTypo.load(window.KTYPO_PAIRS, "./");             // 둘째 인자: 서체 경로 앞에 붙일 기준 경로
  await KTypo.ready(["ui_title", "ui_body", "numeric"]);  // 쓰는 역할만 @font-face 등록 + 로드 대기. 첫 프레임 전에 반드시
</script>
```

| 역할 | 복사할 서체 파일(이 스킬 `fonts/` → 작업 폴더 `fonts/`) |
|---|---|
| `ui_body`·`ui_title`·`numeric` | `Inter-var.ttf`, `PretendardVariable.ttf` |
| `kinetic_heavy` | `Archivo[wdth,wght].ttf`, `PretendardVariable.ttf` |
| `kinetic_wide` | `Unbounded[wght].ttf`, `PretendardVariable.ttf` |
| `kinetic_condensed` | `Archivo[wdth,wght].ttf`, `BlackHanSans-Regular.ttf` |
| `display_serif` | `InstrumentSerif-Regular.ttf`, `NotoSerifKR[wght].ttf`(23MB) |
| `serif_bold` | `InstrumentSerif-Italic.ttf`, `Hahmlet[wght].ttf` |
| `numeric_hero` | `BigShoulders[opsz,wght].ttf`, `PretendardVariable.ttf` |

- 역할 = 내가 쓰는 역할 + 쓰는 부품들의 `requires.font_roles`(`get_component`). 같은 목록을 브라우저에서 `KTypo.fontFiles(역할들)`로도 얻는다. 공백·기호도 라틴 서체로 그리므로 한글만 쓰는 줄도 라틴 서체 파일이 있어야 한다.
- `ready(역할들)`: 그 역할의 서체 파일이 없으면 어느 파일인지 적힌 오류로 거부한다. `ready`에 넣지 않은 역할로 그리면 그 자리에서 오류가 난다(대체 서체로 몰래 그리지 않음 — `KC.toHF`면 빨간 띠). 여러 번 부르면 합친다.
- 인자 없는 `ready()`(예전 호출)도 그대로 돈다: 모든 역할을 불러 보되 파일이 없는 서체는 건너뛰고 경고만 낸다(그 역할로 그릴 때만 오류). 다만 없는 파일마다 404 요청이 생기니 새로 짤 때는 역할을 넘긴다.
- kx 엔진(`KTypo.d2Layout`)은 잰 값만 읽고 글자는 `glyphs.js` 윤곽으로 그리므로, kx로만 쓰는 역할은 `ready`에 넣지 않아도 된다(윤곽 뽑기는 `engine/kx/README.md` '준비').
- 렌더 중 네트워크로 서체를 받지 않는다(A4 금지 7).
- 글꼴 목록(`font-family`)에는 `@font-face`로 넣은 서체와 일반 이름만 적는다(`references/render.md` 2장).

### DOM 글자
```js
KTypo.dom(el, "가계부 Pro로 정리", "ui_title", { size: 72 });          // 구간마다 <span class="kt-ko|kt-latin|kt-digit">
const g = KTypo.dom(el, "LOOP 3초 영상", "kinetic_heavy", { size: 160, split: true });
gsap.from(g, { rotate: -30, yPercent: 60, opacity: 0, stagger: 0.04 }); // g = 글자 span 배열, transform-origin이 이미 글자 상자 가운데
```
- 입력: `{size(px, 라틴 기준), split(글자마다 inline-block), color, tracking(더할 em), lineHeight}`.
- `split: true`의 회전 중심은 기준선을 0크기 표식으로 재서 정한다. 변환을 걸기 **전에** 정해지므로, 글자 크기를 바꾼 뒤에는 `KTypo.setOrigins(el)`를 다시 부른다.
- 한 줄에 역할 둘(산세리프 제목 안 세리프 한 낱말): 바깥 `<div style="font-size:80px">` 안에 `<span>` 둘을 두고 각각 `KTypo.dom(span1, …, "ui_title")`, `KTypo.dom(span2, "하루", "display_serif")`.

### 캔버스
```js
KTypo.canvas(ctx, "수 · 오후 3:00 치과", "numeric", 960, 540, 64, { align: "center", tabular: true });  // 그린 폭을 돌려줌
const L = KTypo.layout(ctx, "LOOP 3초 영상", "kinetic_heavy", 960, 540, 160, { align: "center" });
// L.items[i] = {ch, font, stretch, x, y(기준선), adv, center:[x, y]} — 글자 단위 움직임은 이걸로 직접 그린다
for (const it of L.items) {
  ctx.save(); ctx.translate(...it.center); ctx.rotate(a); ctx.translate(-it.center[0], -it.center[1]);
  ctx.font = it.font; ctx.fontStretch = it.stretch; ctx.fillText(it.ch, it.x, it.y); ctx.restore();
}
```
- 캔버스 2D에는 `font-variation-settings`가 없다. 굵기는 `font`의 숫자, 폭(wdth)은 `ctx.fontStretch` 키워드(75 = condensed …)로만. 축 값이 자유로워야 하면 kx 엔진을 쓴다.
- `tabular: true`는 숫자를 같은 칸 폭 가운데에 놓는다(캔버스는 `tnum`을 못 켬). 글자를 하나씩 그려 커닝은 빠진다.

### kx 엔진(글자 윤곽 엔진)에서 한글
kx 엔진은 서체 윤곽을 Path2D로 그린다. 한글도 그대로 된다.

1. `spec.json`에 한글 서체와 쓸 글자를 **전부** 넣고 `engine/glyphs.py`로 `glyphs.js`를 만든다(쓰는 법 `engine/kx/README.md`). 빠진 글자가 있으면 렌더가 멈춘다.
2. `KX.layoutWord` 대신 `KTypo.d2Layout`으로 줄을 짠다. 한글 글자만 `size × scale`, 기준선 이동, 역할 자간, 글자마다 `anchorEm`(회전 중심)이 들어간다.
   ```js
   KTypo.load(window.KTYPO_PAIRS); KTypo.patchD2(KXP);   // KXP.letterAnchor가 it.anchorEm을 쓰게(라틴 글자는 원래 규칙)
   const ins = { latin: KX.inst("AR", { wdth: 100, wght: 850 }), ko: KX.inst("PR", { wght: 850 }) };
   const w = KTypo.d2Layout(KX, ins, "LOOP 3초 영상", 150, 960, 330, { align: "center", role: "kinetic_heavy" });
   KX.title({ z: 1, items: w, motions: [KXP.letters("letter_spin_land", 0)] });
   ```
3. 손으로 맞출 때의 같은 보정: 한글 글자 `size = 라틴 em × scale`, `pen.y = 기준선 − baseline_shift_em × 라틴 em`, 회전 중심 = `pen + (glyph_center[0] × adv, −glyph_center[1] × size)`.
   - kx 기본 기준점 `pen + (0.3em, −0.36em)`은 라틴 대문자용이다. 한글은 advance가 0.86~0.97em이라 가로 0.3em이 글자 왼쪽 1/3이 되어 비뚤게 돈다 → `KTypo.patchD2` 또는 위 값(가로 ≈ 0.5 × adv, 세로 0.35~0.38em).
   - `KX.wordFill`의 `cap`(기본 0.72)은 한글 줄이면 한글 윗선으로: `cap = top_em × scale + baseline_shift_em`(`kinetic_heavy` ≈ 0.75).
4. 굵기 700 이상 한글은 글자 단위 대신 낱말 묶음으로 움직인다(R10, `KXP.bounceWords`).

### 구간 나누기 (`KTypo.segments`)
- 한글(음절·자모) → `ko`, A–Z·라틴 확장 → `latin`, 0–9 → `digit`.
- 숫자 사이의 `: . , /`, 숫자 뒤 `%`, 공백 뒤 부호(`+30 −12`) → 숫자 구간(표 숫자가 같이 걸림). `D-3`의 `-`는 라틴.
- 공백은 늘 라틴 서체(Black Han Sans 공백은 넓어 낱말 사이가 벌어진다).
- 한글 뒤 쉼표·마침표는 한글 서체, `· | /` 같은 구분 기호는 라틴 서체.
- 숫자 바로 뒤 한글(12,480**명**)은 역할에 `ko_unit_scale`이 있으면 그 배율로 작게, 글자 바닥을 기준선에 붙이고 0.06em 띄운다(`numeric_hero` = 0.5).

## 3. 크기 대비 재기 — `review/type_spec.md`
T3의 점검 기록이다. 키프레임 승인 전과 비평 전에 샷마다 대표 프레임 1장으로 채운다. 비평가에게는 주지 않는다.

| 샷 | 프레임 | 역할(서체·굵기) | 글자 크기 단계(px, 큰→작은) | 주인공:곁 비율 | 강조 1개(종류·낱말) | 칸·줄 안 처리 수 | 같은 낱말 반복 |
|---|---|---|---|---|---|---|---|

데이터 UI 화면(R9)은 줄을 더한다: 역할 3개(칸 제목·축 머리·보조)의 크기(px), 28px 미만 글자 수(0이어야 함), 상태 표시 모양(테두리·밑줄·채움).

재는 법:
1. 렌더 프레임에서 잰다. 코드의 font-size를 적지 않는다.
   ```bash
   python3 -I <이 스킬>/critic/tools/measure_motion.py out/draft.mp4 --out review/measure --text --frames 96,180
   ```
   `review/measure/text/fNNNN.jpg` 겹침 그림에 줄마다 `cap_1920`(가로 1920 환산 대문자 높이)이 적힌다(초록 ≥ 28, 주황 20~28, 빨강 < 20).
2. 눈으로 한 번 더 본다. 도구는 근거 자료일 뿐이다.
   - 한글이 자모 조각으로 쪼개진 줄, 흐린 글자·바탕과 색 차가 작은 글자, 화면 높이 20%보다 큰 글자는 값이 틀릴 수 있다 → 그 줄은 버리고 프레임을 확대해 직접 잰다.
   - 도형 줄(아이콘·점 줄·표 선)이 글자로 잡히면 뺀다.
   - 28·20 경계 근처(±4px)는 360px 사본(`--contact`의 `phone360.png`)으로 확인한다.
3. 통과선(T3)을 못 채운 샷은 고친 뒤 넘어간다. 고칠 때 자간을 벌려 맞추지 않는다(R10).
