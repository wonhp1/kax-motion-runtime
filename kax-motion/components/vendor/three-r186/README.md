# three.js r186 (npm three 0.186.1) — 고정판

- 출처: npm `three@0.186.1` 배포본의 파일을 필요한 것만 복사했다. 렌더 중 네트워크로 받지 않는다.
- 라이선스: MIT — `LICENSE`(Copyright © 2010-2026 three.js authors, md5 b3fc5f5e…). `three.core.js` 머리에도 @license.
- 들어 있는 것(필요한 것만, 약 2.1MB): `build/three.module.js`(md5 3f776a49922e8a0b0e491c2c5fe641f1, `three.core.js`를 import), `build/three.core.js`(md5 6bdce60e9b22a09cbd6815f58e63f1c6),
  `examples/jsm/environments/RoomEnvironment.js`, `examples/jsm/geometries/RoundedBoxGeometry.js`, `examples/jsm/utils/BufferGeometryUtils.js`, `package.json`(판 확인용).
- 넣지 않은 것: examples/jsm의 나머지(EffectComposer 등 — 부품이 import하지 않음, 후처리는 `fx.post_stack_webgl`), three.webgpu·tsl·cjs.
- 쓰는 법(데모 index.html, 뿌리 기준 경로): `<script type="importmap">{"imports": {"three": "./components/vendor/three-r186/build/three.module.js", "three/addons/": "./components/vendor/three-r186/examples/jsm/"}}</script>`
  + 모듈에서 `KC3.install(THREE, {RoomEnvironment, ...})`(components/lib/b9_three.js). `components/tools/stage.py`는 importmap 경로를 복사하지만 three.module.js가 부르는 three.core.js는 따로 못 보므로, 부품 데모 폴더의 stage.json에 `"copy": ["components/vendor/three-r186"]`을 둔다.
