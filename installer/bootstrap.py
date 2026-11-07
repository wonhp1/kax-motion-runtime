#!/usr/bin/env python3
"""Official KAX public runtime installer. No private production assets are cached.
Run: python3 -I bootstrap-v1.py --descriptor runtime.json [--cache-dir PATH]
The descriptor must come from the authenticated KAX MCP tool; verify this script's
SHA-256 against that response BEFORE executing it. Never log the signed URL.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import tempfile
import time
import urllib.request
import uuid
import zipfile

HOST = "github.com"
REPOSITORY = "wonhp1/kax-motion-runtime"
REDIRECT_HOST = "release-assets.githubusercontent.com"
MAX_ARCHIVE = 64 * 1024 * 1024
MAX_UNPACKED = 160 * 1024 * 1024
MAX_FILES = 1000


def digest_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def validate_descriptor(d):
    if not isinstance(d, dict) or not re.fullmatch(r"\d+\.\d+\.\d+", str(d.get("version", ""))):
        raise ValueError("invalid runtime version")
    if not re.fullmatch(r"[a-f0-9]{64}", str(d.get("sha256", ""))):
        raise ValueError("invalid archive hash")
    for key, maximum in (("bytes", MAX_ARCHIVE), ("unpackedBytes", MAX_UNPACKED), ("files", MAX_FILES)):
        if type(d.get(key)) is not int or not 0 < d[key] <= maximum:
            raise ValueError("invalid archive bounds")


def validate_url(url, redirected=False):
    from urllib.parse import urlsplit
    u = urlsplit(url)
    if u.scheme != "https" or u.username or u.password or u.port not in (None, 443) or u.fragment:
        raise ValueError("runtime URL must use official HTTPS sources")
    if redirected and u.hostname == REDIRECT_HOST:
        return
    pattern = r"/" + re.escape(REPOSITORY) + r"/releases/download/runtime-([0-9]+\.[0-9]+\.[0-9]+)/kax-motion-\1\.zip"
    if u.hostname != HOST or u.query or not re.fullmatch(pattern, u.path):
        raise ValueError("runtime URL must use the official GitHub repository release")


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        validate_url(newurl, redirected=True)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def download(url, target, maximum):
    validate_url(url)
    opener = urllib.request.build_opener(SafeRedirect())
    with opener.open(url, timeout=60) as source, open(target, "wb") as dest:
        total = 0
        while True:
            block = source.read(1024 * 1024)
            if not block:
                break
            total += len(block)
            if total > maximum:
                raise ValueError("archive exceeds expected size")
            dest.write(block)


def members(archive, d):
    items = archive.infolist()
    seen = set()
    files = []
    for item in items:
        name = item.filename
        path = PurePosixPath(name)
        if ("\\" in name or ":" in name or path.is_absolute() or
                any(x in (".", "..", "") for x in name.rstrip("/").split("/")) or
                not path.parts or path.parts[0] != "kax-motion" or name.casefold() in seen):
            raise ValueError("unsafe or duplicate ZIP path")
        seen.add(name.casefold())
        mode = item.external_attr >> 16
        if stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR)):
            raise ValueError("ZIP links or special files are forbidden")
        if not item.is_dir():
            files.append(item)
    if len(files) != d["files"] or sum(x.file_size for x in files) != d["unpackedBytes"]:
        raise ValueError("ZIP inventory differs from trusted descriptor")
    if len(items) > MAX_FILES * 2 or any(x.file_size > MAX_UNPACKED for x in files):
        raise ValueError("ZIP extraction limit exceeded")
    return files


def valid_tree(root, archive, files):
    expected = {x.filename for x in files}
    actual = set()
    for p in root.rglob("*"):
        if p.is_symlink():
            return False
        if p.is_file():
            actual.add(p.relative_to(root).as_posix())
    if actual != expected:
        return False
    for item in files:
        p = root / item.filename
        if p.stat().st_size != item.file_size:
            return False
        if hashlib.sha256(archive.read(item)).hexdigest() != digest_file(p):
            return False
    return True


def install(d, cache, archive_path=None):
    validate_descriptor(d)
    cache = Path(cache).expanduser().resolve()
    cache.mkdir(parents=True, exist_ok=True, mode=0o700)
    key = d["version"] + "-" + d["sha256"]
    final = cache / key
    lock = cache / (key + ".lock")
    until = time.monotonic() + 120
    while True:
        try:
            lock.mkdir(mode=0o700)
            break
        except FileExistsError:
            if time.monotonic() > until:
                raise ValueError("runtime install lock timed out; check other installer processes")
            time.sleep(0.1)
    try:
        with tempfile.TemporaryDirectory(prefix=".prepare-", dir=cache) as tmp:
            tmp = Path(tmp)
            saved = final / "package.zip"
            candidate = tmp / "package.zip"
            if saved.is_file() and not saved.is_symlink() and saved.stat().st_size == d["bytes"] and digest_file(saved) == d["sha256"]:
                shutil.copyfile(saved, candidate)
            elif archive_path:
                shutil.copyfile(archive_path, candidate)
            else:
                download(d["url"], candidate, d["bytes"])
            if candidate.stat().st_size != d["bytes"] or digest_file(candidate) != d["sha256"]:
                raise ValueError("runtime archive size or SHA-256 mismatch")
            with zipfile.ZipFile(candidate) as archive:
                files = members(archive, d)
                tree = final / "files"
                reused = not final.is_symlink() and tree.is_dir() and not tree.is_symlink() and valid_tree(tree, archive, files)
                if not reused:
                    extracted = tmp / "files"
                    extracted.mkdir()
                    archive.extractall(extracted)
                    entry = extracted / "kax-motion" / "SKILL.md"
                    if not entry.is_file() or (extracted / "kax-motion" / "VERSION").read_text(encoding="utf-8").strip() != d["version"]:
                        raise ValueError("runtime entrypoint missing")
            if not reused:
                if final.exists() or final.is_symlink():
                    final.rename(cache / (key + ".quarantine-" + uuid.uuid4().hex))
                # Close ZIP handles before publishing (also required on Windows).
                # Both paths are on the same filesystem; publish only complete verified trees.
                tmp.rename(final)
            runtime = final / "files" / "kax-motion"
            return {"ok": True, "version": d["version"], "sha256": d["sha256"], "reused": reused,
                    "runtimePath": str(runtime), "instructionsPath": str(runtime / "SKILL.md"),
                    "requirements": {"node": ">=22", "ffmpeg": True, "python": ["numpy", "scipy", "Pillow"], "hyperframes": "0.8.188"}}
    finally:
        lock.rmdir()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--descriptor", required=True)
    p.add_argument("--cache-dir", default=str(Path.home() / ".cache" / "kax-motion" / "runtime"))
    p.add_argument("--archive", help="Optional previously downloaded official ZIP; still verifies trusted hash")
    a = p.parse_args()
    try:
        d = json.loads(Path(a.descriptor).read_text(encoding="utf-8"))
        print(json.dumps(install(d, a.cache_dir, a.archive), ensure_ascii=True))
    except Exception:
        # urllib exceptions can embed signed URLs. Do not expose exception text or secrets.
        print(json.dumps({"ok": False, "error": "Runtime preparation failed. Check the descriptor, network and archive integrity. Obtain a fresh descriptor with kax_prepare_runtime; do not bypass verification."}))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
