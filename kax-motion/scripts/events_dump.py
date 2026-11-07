#!/usr/bin/env python3
"""부품 사건 프레임 뽑기: 작업 폴더 index.html을 헤드리스 크롬으로 열어, 그 페이지가 만든 부품(KC.make)의 events()를 JSON으로 쓴다.

  python3 -I <이 스킬>/scripts/events_dump.py                               # 지금 폴더 index.html → audio/parts_events.json + 표
  python3 -I <이 스킬>/scripts/events_dump.py --plan audio/events.json \\
          --first appear --signature chip_land                               # + 효과음 계획 초안(references/sound.md 1장 꼴)
  python3 -I <이 스킬>/scripts/events_dump.py --expr "bw.events()"          # 부품이 아닌 사건(kx 낱말 튐 등)을 함께

왜: KC.events는 브라우저 안에서만 돈다. 렌더 페이지를 그대로 열어 값을 받으면 부품 입력·서체·차례가 렌더와 같다
  (node에 가짜 캔버스를 두는 길은 부품·키트가 새 캔버스 함수를 부를 때마다 막히고, 서체를 재는 부품은 값이 달라진다).
하는 일:
  1. 작업 폴더(index.html이 있는 폴더)를 127.0.0.1의 빈 포트로 읽기만 하는 웹 서버로 낸다. 파일을 쓰거나 고치지 않는다.
  2. index.html <head> 맨 앞에 갈고리 한 줄을 끼운 사본(메모리 안)을 연다 — window.KC가 생기는 순간 KC.make·toHF·toKM·toKX를 감싸
     만든 인스턴스(차례대로)와 어댑터에 넘긴 인스턴스를 적는다. 부품 안에서 만든 하위 부품(KC.make 안의 KC.make)은 '안쪽'으로 따로.
  3. 페이지 load + 서체 준비 + --settle ms 뒤 KC.events(맨 바깥 인스턴스 전부)와 KC.retier(그 사건, {first, signature})를 꺼낸다.
     toHF 목록에 안 넣고 under에서 직접 그린 부품(cal.draw(ctx, f))도 만든 것이면 잡힌다 — 만들고 안 쓴 부품은 표에서 빼거나 --only로.
출력:
  --out(기본 audio/parts_events.json): {"fps", "kc_version", "parts": [{k, id, adapters, inner, f0}], "events": [KC.events 그대로 +
    k(부품 번호)], "retiered": [KC.retier 결과], "expr_events", "page_errors"}
  --plan 파일: 효과음 계획 초안 {"fps", "events": [{frame, type, tier, what, visual?, onset, land, hint, id}]} — frame = 부품 사건 f
    (휙 사건은 f = onset, 앉음·누름은 f = land — 부품 README '출력'), tier = retier 뒤 값, f = land인 사건은 visual "land".
    **초안이다**: 소리 종류·크기(gain_db)·뺄 사건을 정하고 렌더에서 잰 프레임(D4)과 대 본 뒤 audio/events.json으로 쓴다.
    이미 있는 파일은 --force 없이 덮지 않는다(손으로 고친 계획을 지키려고).
브라우저: --chrome → 환경 변수 CHROME → kax_paths.json browser(glob 꼴) → HyperFrames가 받은 헤드리스 크롬(~/.cache/hyperframes/chrome/…)
  → PATH의 chrome-headless-shell·chromium. 없으면 `npx hyperframes@0.8.188 browser ensure`(렌더에 쓰는 것과 같은 브라우저를 받음).
끝 코드: 0 = 됨, 1 = 페이지 오류·KC나 부품이 없음·사건 0개, 2 = 부르는 꼴이 틀림·브라우저 없음.
표준 라이브러리만 쓴다(스레드: 웹 서버 하나 + 본 스레드).
"""
import argparse
import base64
import glob
import html
import http.server
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading

SKILL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = "/__kc_events_dump__.html"
MARK = "__kc_events_dump__"

HOOK = r"""<script>/* events_dump.py 갈고리 — 작업 폴더 파일에는 없는 줄 */
(function () {
  var made = [], inner = [], used = [], errs = [], depth = 0, K;
  window.addEventListener("error", function (e) { errs.push(String(e.message || e) + (e.filename ? " @ " + e.filename.split("/").pop() + ":" + e.lineno : "")); });
  window.addEventListener("unhandledrejection", function (e) { var r = e.reason; errs.push("promise: " + String(r && r.message || r)); });
  function wrap(KC) {
    if (!KC || KC.__dumpWrapped) return;
    KC.__dumpWrapped = true;
    var mk = KC.make;
    if (typeof mk === "function") KC.make = function () {
      depth++;
      var inst;
      try { inst = mk.apply(this, arguments); } finally { depth--; }
      (depth > 0 ? inner : made).push(inst);
      return inst;
    };
    ["toHF", "toKM", "toKX"].forEach(function (n) {
      var g = KC[n];
      if (typeof g !== "function") return;
      KC[n] = function (list) {
        var L = Array.isArray(list) ? list : [list];
        L.forEach(function (c) { if (c && typeof c.events === "function") used.push([c, n]); });
        return g.apply(this, arguments);
      };
    });
  }
  Object.defineProperty(window, "KC", { configurable: true, enumerable: true,
    get: function () { return K; },
    set: function (v) { K = v; try { wrap(v); } catch (e) { errs.push("갈고리: " + e.message); } } });
  window.__KCDUMP = { made: made, inner: inner, used: used, errs: errs };
})();
</script>"""

COLLECT = r"""<script>/* events_dump.py 수집 */
(function () {
  var CONF = __CONF__;
  function enc(o) { var s = JSON.stringify(o); return btoa(unescape(encodeURIComponent(s))); }
  function put(o) {
    var el = document.createElement("pre"); el.id = "__MARK__"; el.textContent = enc(o);
    (document.body || document.documentElement).appendChild(el);
  }
  function num(v) { return typeof v === "number" && isFinite(v) ? Math.round(v * 1000) / 1000 : v === undefined ? null : v; }
  function clean(e, k) {
    var o = {};
    for (var key in e) { var v = e[key]; if (typeof v === "function") continue; o[key] = typeof v === "number" ? num(v) : v; }
    if (k !== undefined) o.k = k;
    return o;
  }
  function collect() {
    var D = window.__KCDUMP || { made: [], inner: [], used: [], errs: ["갈고리가 안 돌았음"] };
    var out = { page_errors: D.errs.slice(), kc_version: null, fps: null, parts: [], events: [], retiered: null, expr_events: null };
    try {
      var KC = window.KC;
      if (!KC) { out.page_errors.push("window.KC 없음 — components/kc.js를 읽지 않는 페이지"); put(out); return; }
      out.kc_version = KC.version || null;
      if (window.KC_DRAW_ERROR) out.page_errors.push("KC_DRAW_ERROR: " + window.KC_DRAW_ERROR);
      var list = D.made;
      if (CONF.only && CONF.only.length) list = list.filter(function (c, i) { return CONF.only.indexOf(c.id) >= 0 || CONF.only.indexOf(String(i)) >= 0; });
      var all = D.made.concat(D.inner);
      all.forEach(function (c, i) {
        var ad = D.used.filter(function (u) { return u[0] === c; }).map(function (u) { return u[1]; });
        var sp = null;
        try { sp = c.span ? c.span().map(num) : null; } catch (e) { sp = null; }
        out.parts.push({ k: i, id: c.id, inner: i >= D.made.length, used: list.indexOf(c) >= 0, adapters: ad,
                         f0: num(c.opts && c.opts.f0), span: sp, renderer: c.renderer });
      });
      var env = (D.made[0] || D.inner[0] || {}).env;
      out.fps = env ? num(env.fps) : null;
      var evs = [];
      list.forEach(function (c) {
        var k = all.indexOf(c), es = [];
        try { es = c.events(); } catch (e) { out.page_errors.push(c.id + ".events(): " + e.message); }
        es.forEach(function (e) { evs.push(clean(e, k)); });
      });
      evs.sort(function (a, b) { return a.f - b.f || a.k - b.k; });
      out.events = evs;
      if (typeof KC.retier === "function") {
        var opt = {};
        if (CONF.first !== null) opt.first = CONF.first;
        if (CONF.signature !== null) opt.signature = CONF.signature;
        try { out.retiered = KC.retier(evs, opt).map(function (e) { return clean(e); }); }
        catch (e) { out.retier_error = String(e.message); out.page_errors.push("KC.retier: " + e.message); }
      }
      if (CONF.expr) {
        try {
          var r = (0, eval)(CONF.expr);
          if (r && typeof r.then === "function") { r.then(function (v) { out.expr_events = (v || []).map(function (e) { return clean(e); }); put(out); },
                                                         function (e) { out.page_errors.push("--expr: " + (e && e.message || e)); put(out); }); return; }
          out.expr_events = Array.isArray(r) ? r.map(function (e) { return clean(e); }) : null;
          if (!Array.isArray(r)) out.page_errors.push("--expr 결과가 배열이 아님");
        } catch (e) { out.page_errors.push("--expr: " + e.message); }
      }
    } catch (e) { out.page_errors.push("수집: " + e.message); }
    put(out);
  }
  function later() {
    var f = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    f.then(function () { setTimeout(collect, CONF.settle); }, function () { setTimeout(collect, CONF.settle); });
  }
  if (document.readyState === "complete") later(); else window.addEventListener("load", later);
})();
</script>"""


def kax_paths():
    try:
        with open(os.path.join(SKILL, "kax_paths.json"), encoding="utf-8") as f:
            t = json.load(f)
        return t if isinstance(t, dict) else {}
    except (OSError, ValueError):
        return {}


def find_chrome(arg):
    if arg:
        return arg
    if os.environ.get("CHROME"):
        return os.environ["CHROME"]
    pats = []
    if kax_paths().get("browser"):
        pats.append(kax_paths()["browser"])
    pats += ["~/.cache/hyperframes/chrome/chrome-headless-shell/*/chrome-headless-shell-*/chrome-headless-shell",
             "~/.cache/hyperframes/chrome/chrome-headless-shell/*/chrome-headless-shell-*/chrome-headless-shell.exe"]
    for pat in pats:
        hits = sorted(glob.glob(os.path.expanduser(pat)))
        if hits:
            return hits[-1]
    for name in ("chrome-headless-shell", "chromium", "chromium-browser"):
        p = shutil.which(name)
        if p:
            return p
    return None


def inject(src, conf):
    """index.html 글 → 갈고리(<head> 맨 앞)·수집(</body> 앞)을 끼운 글. 원본 파일은 그대로."""
    hook = HOOK
    col = COLLECT.replace("__CONF__", json.dumps(conf, ensure_ascii=False)).replace("__MARK__", MARK)
    m = re.search(r"<head[^>]*>", src, re.I)
    if m:
        src = src[:m.end()] + hook + src[m.end():]
    else:
        m = re.search(r"<html[^>]*>", src, re.I)
        at = m.end() if m else 0
        src = src[:at] + hook + src[at:]
    i = src.lower().rfind("</body>")
    return src[:i] + col + src[i:] if i >= 0 else src + col


def serve(root, page_bytes):
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=root, **k)

        def do_GET(self):
            if self.path.split("?")[0] == PAGE:
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(page_bytes)))
                self.end_headers()
                self.wfile.write(page_bytes)
                return
            return super().do_GET()

        def do_POST(self):
            self.send_error(405)

        def log_message(self, *a):
            pass

    H.extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map,
                            **{".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json",
                               ".wasm": "application/wasm", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf"})
    srv = http.server.HTTPServer(("127.0.0.1", 0), H)
    th = threading.Thread(target=srv.serve_forever, daemon=True)
    th.start()
    return srv


def fps_str(v):
    if v is None:
        return None
    for num, den in ((30000, 1001), (24000, 1001), (60000, 1001)):
        if abs(v - num / den) < 1e-3:
            return f"{num}/{den}"
    return int(v) if abs(v - round(v)) < 1e-6 else v


def run(args):
    index = os.path.abspath(args.index)
    if not os.path.isfile(index):
        print(f"index.html 없음: {index}", file=sys.stderr)
        return 2
    root = os.path.dirname(index)
    chrome = find_chrome(args.chrome)
    if not chrome:
        print("헤드리스 크롬을 못 찾음 — `npx hyperframes@0.8.188 browser ensure`로 받거나 --chrome·환경 변수 CHROME에 경로를 준다",
              file=sys.stderr)
        return 2
    conf = {"settle": args.settle, "first": args.first, "signature": args.signature, "expr": args.expr,
            "only": [s.strip() for s in (args.only or "").split(",") if s.strip()]}
    for k in ("first", "signature"):   # 숫자면 배열 번호(KC.retier 규칙)
        if conf[k] is not None and re.fullmatch(r"\d+", conf[k]):
            conf[k] = int(conf[k])
    page = inject(open(index, encoding="utf-8").read(), conf).encode("utf-8")
    srv = serve(root, page)
    url = f"http://127.0.0.1:{srv.server_address[1]}{PAGE}"
    prof = tempfile.mkdtemp(prefix="kc_events_dump_")
    try:
        cmd = [chrome, "--headless", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
               "--mute-audio", f"--user-data-dir={prof}", f"--window-size={args.width},{args.height}",
               f"--virtual-time-budget={args.budget}", "--dump-dom", url]
        try:
            r = subprocess.run(cmd, capture_output=True, timeout=args.timeout)
        except subprocess.TimeoutExpired:
            print(f"브라우저가 {args.timeout}초 안에 끝나지 않음", file=sys.stderr)
            return 1
    finally:
        srv.shutdown()
        srv.server_close()
        shutil.rmtree(prof, ignore_errors=True)
    dom = r.stdout.decode("utf-8", "replace")
    m = re.search(r'<pre id="' + MARK + r'">([^<]*)</pre>', dom)
    if not m:
        err = r.stderr.decode("utf-8", "replace").strip().splitlines()[-5:]
        print("페이지에서 값을 못 받음(load·서체 준비가 --budget 안에 안 끝났거나 페이지가 멈춤). 브라우저 끝 줄:\n  "
              + "\n  ".join(err), file=sys.stderr)
        return 1
    out = json.loads(base64.b64decode(html.unescape(m.group(1))).decode("utf-8"))
    out = {"source": "events_dump.py — " + os.path.relpath(index), **out}
    out["fps"] = fps_str(out.get("fps"))

    parts = out["parts"]
    print(f"부품 {sum(1 for p in parts if not p['inner'])}개(안쪽 {sum(1 for p in parts if p['inner'])}개) · "
          f"사건 {len(out['events'])}개 · fps {out['fps']} · KC {out['kc_version']}")
    for p in parts:
        tag = "안쪽" if p["inner"] else ("어댑터 " + ",".join(p["adapters"]) if p["adapters"] else "직접 그림(어댑터 없음)")
        print(f"  [{p['k']}] {p['id']:<28} f0 {p['f0']}  {tag}{'' if p['used'] or p['inner'] else '  (--only로 뺌)'}")
    ret = out.get("retiered") or out["events"]
    print(f"  {'f':>8} {'onset':>8} {'land':>8}  {'tier':<9} {'hint':<9} type (부품)")
    for e in ret:
        print(f"  {e.get('f', ''):>8} {str(e.get('onset', '')):>8} {str(e.get('land', '')):>8}  {e.get('tier', ''):<9} "
              f"{str(e.get('hint') or ''):<9} {e.get('type', '')} ({e.get('id', '')})")
    if out.get("expr_events") is not None:
        print(f"  --expr 사건 {len(out['expr_events'])}개")
    for e in out["page_errors"]:
        print("  페이지 오류:", e, file=sys.stderr)

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print("썼음:", args.out)

    if args.plan and out.get("retier_error"):
        print("KC.retier가 실패해 계획 초안을 쓰지 않음 — --first·--signature를 고친다", file=sys.stderr)
        return 1
    if args.plan:
        if os.path.exists(args.plan) and not args.force:
            print(f"{args.plan}이 이미 있어 쓰지 않음(손으로 고친 계획일 수 있음) — 다른 이름으로 쓰거나 --force", file=sys.stderr)
            return 1
        rows = []
        src = list(ret) + [dict(e, id=e.get("id") or "expr") for e in (out.get("expr_events") or [])]
        for e in sorted(src, key=lambda e: e.get("f", 0)):
            if e.get("f") is None:
                continue
            row = {"frame": e["f"], "type": e.get("type", ""), "tier": e.get("tier", "normal"),
                   "what": f"{e.get('id', '')} {e.get('type', '')}".strip()}
            if e.get("land") is not None and abs(float(e["land"]) - float(e["f"])) < 1e-3:
                row["visual"] = "land"
            for k in ("onset", "land", "hint", "id"):
                if e.get(k) is not None:
                    row[k] = e[k]
            rows.append(row)
        plan = {"fps": out["fps"], "_draft": "events_dump.py 초안 — 소리 종류·gain_db를 정하고 렌더에서 잰 프레임(D4)과 대 본 뒤 쓴다",
                "events": rows}
        os.makedirs(os.path.dirname(os.path.abspath(args.plan)), exist_ok=True)
        with open(args.plan, "w", encoding="utf-8") as f:
            json.dump(plan, f, ensure_ascii=False, indent=1)
        print(f"계획 초안 썼음: {args.plan} (사건 {len(rows)}개)")

    if out["page_errors"] or not out["events"]:
        if not out["events"]:
            print("사건 0개 — 부품을 만들지 않았거나(KC.make) 부품에 events()가 없음", file=sys.stderr)
        return 1
    return 0


def main():
    ap = argparse.ArgumentParser(description="작업 폴더 index.html의 부품 events()를 헤드리스 크롬에서 뽑아 JSON으로")
    ap.add_argument("index", nargs="?", default="index.html", help="작업 폴더 index.html(기본: 지금 폴더)")
    ap.add_argument("--out", default="audio/parts_events.json", help="뽑은 값(기본 audio/parts_events.json)")
    ap.add_argument("--plan", help="효과음 계획 초안을 쓸 파일(예: audio/events.json — 있으면 --force 없이 안 덮음)")
    ap.add_argument("--force", action="store_true", help="--plan 파일이 있어도 덮음")
    ap.add_argument("--first", help="KC.retier first: 사건 type 이름 또는 번호(안 주면 hint first가 붙은 가장 이른 사건)")
    ap.add_argument("--signature", help="KC.retier signature: 사건 type 이름 또는 번호")
    ap.add_argument("--only", help="이 부품만(쉼표로 id 또는 번호 k) — 만들고 안 쓰는 부품을 뺄 때")
    ap.add_argument("--expr", help="페이지 전역에서 돌릴 JS 식 → 사건 배열(예: \"bw.events()\") — expr_events로 따로 적음")
    ap.add_argument("--settle", type=int, default=500, help="load·서체 준비 뒤 더 기다릴 ms(가상 시간, 기본 500)")
    ap.add_argument("--budget", type=int, default=20000, help="크롬 가상 시간 한도 ms(기본 20000)")
    ap.add_argument("--timeout", type=int, default=120, help="브라우저 실제 시간 한도 초(기본 120)")
    ap.add_argument("--width", type=int, default=1920)
    ap.add_argument("--height", type=int, default=1080)
    ap.add_argument("--chrome", help="크롬 실행 파일")
    sys.exit(run(ap.parse_args()))


if __name__ == "__main__":
    main()
