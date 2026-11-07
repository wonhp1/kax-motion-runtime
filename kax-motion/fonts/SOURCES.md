# 서체 출처 (fonts/)

모두 SIL Open Font License 1.1이다. 라이선스 원문은 같은 폴더의 `OFL_*.txt`(서체마다 하나). 서체 파일만 따로 팔거나 내놓지 않는다(OFL). 짝·용도는 `references/typography.md`, 보정값은 `typography/pairs.json`.

| 파일 | 받은 곳 | 크기(바이트) | sha256 앞 12자 | 라이선스 원문 | 쓰는 곳 |
|---|---|---:|---|---|---|
| PretendardVariable.ttf (v1.3.9, wght 45–930) | https://raw.githubusercontent.com/orioncactus/pretendard/main/packages/pretendard/dist/public/variable/PretendardVariable.ttf | 6,739,336 | 3090ccde0442 | OFL_pretendard.txt (RFN 'Pretendard') | 한글 기본: ui_body·ui_title·kinetic_heavy·kinetic_wide·numeric·numeric_hero |
| Inter-var.ttf (wght 100–900) | Google Fonts 가변 TTF(https://github.com/rsms/inter) — km 엔진 `engine/km/fonts/Inter-var.ttf`와 같은 파일 | 876,576 | 29160a80ff49 | OFL_inter.txt | 라틴 UI: ui_body·ui_title·numeric |
| Archivo[wdth,wght].ttf | https://github.com/google/fonts/raw/main/ofl/archivo/Archivo%5Bwdth,wght%5D.ttf | 658,596 | 0e094a7d3c7c | OFL_archivo.txt | 보통 폭 그로테스크: kinetic_heavy·kinetic_condensed(wdth 75) |
| Unbounded[wght].ttf | https://github.com/google/fonts/raw/main/ofl/unbounded/Unbounded%5Bwght%5D.ttf | 778,272 | 323b511be380 | OFL_unbounded.txt | 넓은 서체: kinetic_wide(섹션 카드·라벨·작은 두 줄) |
| BigShoulders[opsz,wght].ttf | https://github.com/google/fonts/raw/main/ofl/bigshoulders/BigShoulders%5Bopsz,wght%5D.ttf | 320,800 | 4b4b24aa6f79 | OFL_bigshoulders.txt | 좁은 주인공 단어·숫자: numeric_hero |
| SpaceGrotesk[wght].ttf | https://github.com/google/fonts/raw/main/ofl/spacegrotesk/SpaceGrotesk%5Bwght%5D.ttf | 136,676 | acad6de1fc93 | OFL_spacegrotesk.txt | 끝 카드 |
| InstrumentSerif-Regular.ttf | https://github.com/google/fonts/raw/main/ofl/instrumentserif/InstrumentSerif-Regular.ttf | 70,012 | 498efd461f6d | OFL_instrumentserif.txt | 라틴 세리프 짝: display_serif |
| InstrumentSerif-Italic.ttf | https://github.com/google/fonts/raw/main/ofl/instrumentserif/InstrumentSerif-Italic.ttf | 71,592 | 08939b8bdf53 | OFL_instrumentserif.txt | 라틴 세리프 짝: serif_bold |
| BlackHanSans-Regular.ttf | https://github.com/google/fonts/raw/main/ofl/blackhansans/BlackHanSans-Regular.ttf | 998,424 | 319608092840 | OFL_blackhansans.txt | kinetic_condensed(각진 압축 블랙) |
| Hahmlet[wght].ttf (wght 100–900) | https://github.com/google/fonts/raw/main/ofl/hahmlet/Hahmlet%5Bwght%5D.ttf | 3,559,144 | 892bffe53025 | OFL_hahmlet.txt | serif_bold(굵은 현대 세리프) |
| NotoSerifKR[wght].ttf (wght 200–900) | https://github.com/google/fonts/raw/main/ofl/notoserifkr/NotoSerifKR%5Bwght%5D.ttf | 23,795,420 | 11f8d5de6f1b | OFL_notoserifkr.txt | display_serif(가는 명조 강조) |
| NotoSansKR[wght].ttf | https://github.com/google/fonts/raw/main/ofl/notosanskr/NotoSansKR%5Bwght%5D.ttf | 10,414,588 | 194018e6b2b2 | OFL_notosanskr.txt | 한글 — Archivo 짝(굵기 축 100~900, 얇은/굵은 대비) |
| DoHyeon-Regular.ttf | https://github.com/google/fonts/raw/main/ofl/dohyeon/DoHyeon-Regular.ttf | 879,764 | 35644be7f28e | OFL_dohyeon.txt | 한글 — Big Shoulders 짝(좁고 굵은 주인공 단어) |
| GasoekOne-Regular.ttf | https://github.com/google/fonts/raw/main/ofl/gasoekone/GasoekOne-Regular.ttf | 1,061,372 | 73a6b8e0d12a | OFL_gasoekone.txt | 한글 — Unbounded 굵은 짝(넓고 무거운 끝맺음 단어) |

- Google Fonts 서체는 github.com/google/fonts(main 브랜치 `ofl/` 폴더)에서 로그인 없이 받았다(2026-10-27). 라이선스 원문은 각 폴더의 OFL.txt, Pretendard는 저장소의 LICENSE.
- 비교 뒤 뺀 것: Gowun Batang Bold(OFL) — Instrument Serif 옆에서 둥글고 무거워 뺐다(파일 없음, `typography/tools/roles_candidates.json`의 serif_gowun 줄만 남음).
- 쓰는 법: 부품·KTypo(`typography/`)는 `@font-face`로 서체 파일을 읽는다(`typography/pairs.json`의 경로). kx 엔진(`engine/kx/glyphs.py`)은 서체 윤곽만 뽑아 `glyphs.js`로 쓰고, 브라우저는 서체 파일을 읽지 않는다.
