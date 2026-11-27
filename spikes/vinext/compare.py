#!/usr/bin/env python3
"""같은 입력을 두 Worker(기준 A, 후보 B)에 보내 응답을 비교한다. 표준 라이브러리만 쓴다.

    python3 -B spikes/vinext/compare.py --a opennext=http://localhost:18787 --b vinext=http://localhost:18788 \
        --out spikes/vinext/results/compare.md

비교: 상태, 캐시·보안 헤더, HTML head 메타(title·canonical·og·twitter·robots)와 h1, JSON은 파싱한 값, PNG는 크기와 픽셀 차이.
API는 합성 데이터로만 부른다(X-Banbanyeok-Synthetic, Origin 포함). 두 Worker에 각각 방을 만들고 참여·결과를 본 뒤 지운다.
방장 토큰·응답 본문은 출력하지 않는다.
"""
import argparse
import hashlib
import html.parser
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request

HEADERS = [
    "content-type", "cache-control", "cdn-cache-control", "cloudflare-cdn-cache-control", "location", "vary",
    "content-security-policy", "strict-transport-security", "x-content-type-options", "x-frame-options",
    "referrer-policy", "permissions-policy", "cross-origin-opener-policy", "x-robots-tag", "x-powered-by",
]
HERE = os.path.dirname(os.path.abspath(__file__))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


OPENER = urllib.request.build_opener(NoRedirect, urllib.request.ProxyHandler({}))


def request(base, path, method="GET", body=None, headers=None):
    h = {"User-Agent": "banbanyeok-vinext-spike"}
    if method != "GET":
        h["Origin"] = base
    if path.startswith("/api/"):
        h["X-Banbanyeok-Synthetic"] = "1"
    h.update(headers or {})
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        h["content-type"] = "application/json"
    req = urllib.request.Request(base + path, data=data, method=method, headers=h)
    try:
        with OPENER.open(req, timeout=60) as r:
            return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read()


class Head(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.meta = {}
        self._title = False
        self._h1 = False
        self.h1 = ""

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "meta":
            key = a.get("property") or a.get("name")
            if key and (key.startswith(("og:", "twitter:")) or key in ("description", "robots", "viewport", "theme-color")
                        or key.startswith("naver")):
                self.meta.setdefault("meta " + key, []).append(a.get("content", ""))
        elif tag == "link" and a.get("rel") in ("canonical", "alternate", "icon", "apple-touch-icon", "manifest"):
            self.meta.setdefault("link " + a["rel"], []).append(a.get("href", ""))
        elif tag == "title":
            self._title = True
        elif tag == "h1":
            self._h1 = True
        elif tag == "html":
            self.meta["html lang"] = [a.get("lang", "")]

    def handle_endtag(self, tag):
        if tag == "title":
            self._title = False
        if tag == "h1":
            self._h1 = False

    def handle_data(self, data):
        if self._title:
            self.meta.setdefault("title", [""])[0] += data
        if self._h1:
            self.h1 += data


def head_of(body):
    p = Head()
    p.feed(body.decode("utf-8", "replace"))
    # 아이콘 주소의 쿼리(빌드가 붙이는 해시)는 도구마다 형식이 달라 경로만 비교한다(형식 차이는 보고서에 따로 적는다).
    out = {k: sorted(x.split("?")[0] for x in v) if k.startswith(("link icon", "link apple")) else v for k, v in p.meta.items()}
    out["h1"] = [p.h1.strip()]
    return out


def png_diff(a, b):
    with tempfile.TemporaryDirectory() as d:
        pa, pb = os.path.join(d, "a.png"), os.path.join(d, "b.png")
        open(pa, "wb").write(a)
        open(pb, "wb").write(b)
        r = subprocess.run(["node", os.path.join(HERE, "png-diff.mjs"), pa, pb], capture_output=True, text=True)
        return json.loads(r.stdout) if r.returncode == 0 else {"error": r.stderr.strip()[:200]}


def describe(status, headers, body):
    ctype = headers.get("content-type", "")
    d = {"status": status, "headers": {k: headers.get(k) for k in HEADERS if headers.get(k) is not None}}
    if "vary" in d["headers"]:
        d["headers"]["vary"] = ", ".join(sorted(x.strip().lower() for x in d["headers"]["vary"].split(",")))
    if "html" in ctype:
        d["head"] = head_of(body)
    elif "json" in ctype:
        try:
            d["json"] = json.loads(body)
        except ValueError:
            d["text"] = body[:200].decode("utf-8", "replace")
    elif ctype.startswith("image/"):
        d["sha256"] = hashlib.sha256(body).hexdigest()[:16]
        d["bytes"] = len(body)
    else:
        d["text"] = body.decode("utf-8", "replace")
    return d


def diff_dicts(x, y, prefix=""):
    out = []
    for k in sorted(set(x) | set(y)):
        a, b = x.get(k), y.get(k)
        if isinstance(a, dict) and isinstance(b, dict) and k != "json":
            out += diff_dicts(a, b, prefix + k + ".")
        elif a != b:
            out.append((prefix + k, a, b))
    return out


def short(v, n=140):
    s = json.dumps(v, ensure_ascii=False) if not isinstance(v, str) else v
    return s if len(s) <= n else s[: n - 1] + "…"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--a", required=True)
    ap.add_argument("--b", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    (na, ua), (nb, ub) = (s.split("=", 1) for s in (args.a, args.b))

    st, _, sm = request(ua, "/sitemap.xml")
    pair = re.search(r"<loc>https?://[^/<]+(/meet/[0-9a-z]{3}-[0-9a-z]{3})</loc>", sm.decode()).group(1)
    a_code, b_code = pair.removeprefix("/meet/").split("-")
    _, _, home = request(ua, "/")
    site_og = re.search(r'property="og:image" content="https?://[^/"]+([^"]+)"', home.decode()).group(1)
    _, _, pair_html = request(ua, pair)
    pair_og = re.search(r'property="og:image" content="https?://[^/"]+([^"]+)"', pair_html.decode()).group(1)
    slug = "/problems/invalid-station"
    pages = [
        "/", "/privacy", "/meet", pair, pair_og.replace("&amp;", "&"), site_og.replace("&amp;", "&"),
        "/sitemap.xml", "/robots.txt", "/manifest.webmanifest", "/favicon.ico", "/icon.svg", "/apple-icon.png",
        "/problems", slug, "/r/new", "/r/abcdefghjk", "/does-not-exist",
        f"/result?v=2&o={a_code}.{b_code}&m=f&t=weekday-day",
        f"/s?v=1&o={a_code}.{b_code}&m=f", f"/s/og?v=1&o={a_code}.{b_code}&m=f",
        "/s?v=1&o=zzz.zzz&m=f", "/s/og?v=1&o=zzz.zzz&m=f",
        "/api/healthz", "/api/v1/manifest", "/api/v1/rooms/abcdefghjk",
    ]

    rows = []
    for path in pages:
        ra, rb = request(ua, path), request(ub, path)
        da, db = describe(*ra), describe(*rb)
        diffs = diff_dicts(da, db)
        if "sha256" in da and "sha256" in db and da["sha256"] != db["sha256"]:
            diffs = [d for d in diffs if d[0] not in ("sha256", "bytes")]
            pix = png_diff(ra[2], rb[2])
            if pix.get("diffPixels") != 0:
                diffs.append(("png", pix, None))
        rows.append((path, da["status"], db["status"], diffs))

    # API 흐름: 같은 입력으로 각 Worker에 방을 만들고 참여·결과·방 화면·방 그림을 본 뒤 지운다.
    api_rows = []
    rooms = {}
    for name, base in ((na, ua), (nb, ub)):
        res = {}
        for mode in ({"mode": "fair"}, {"mode": "fast"}, {"mode": "favor", "favorIndex": 0}):
            s, _, body = request(base, "/api/v1/recommend", "POST", {"origins": [a_code, b_code], **mode})
            res["recommend " + mode["mode"]] = (s, hashlib.sha256(body).hexdigest()[:12])
        s, _, body = request(base, "/api/v1/rooms", "POST", {"mode": "fair", "expectedCount": 2, "host": {"originCode": a_code}})
        created = json.loads(body) if s in (200, 201) else {}
        room, token = created.get("roomId"), created.get("hostToken")
        res["room create"] = (s, None)
        if room:
            s, _, _ = request(base, f"/api/v1/rooms/{room}/participants", "POST", {"originCode": b_code})
            res["room join"] = (s, None)
            s, _, body = request(base, f"/api/v1/rooms/{room}/result")
            res["room result"] = (s, len(json.loads(body).get("candidates", [])) if s == 200 else None)
            s, _, body = request(base, f"/api/v1/rooms/{room}")
            sv = json.loads(body).get("shareVersion") if s == 200 else None
            s, h, page = request(base, f"/r/{room}?sv={sv}&pv=4")
            og = re.search(r'property="og:image" content="https?://[^/"]+([^"]+)"', page.decode())
            og_path = og.group(1).replace("&amp;", "&") if og else None
            res["room page"] = (s, re.sub(r"/r/[0-9a-z]+/", "/r/<id>/", og_path or "-"))
            if og_path:
                s, h, png = request(base, og_path)
                res["room og (현재 버전)"] = (s, h.get("cache-control"), h.get("content-type"))
                rooms.setdefault("png", {})[name] = png
            s, h, png = request(base, f"/r/{room}/og")
            res["room og (버전 없음 → 기본 그림)"] = (s, h.get("cache-control"))
            rooms.setdefault("default", {})[name] = png
            s, h, _ = request(base, f"/r/{room}/og?sv=999&dv=x")
            res["room og (옛 버전 → 기본 그림)"] = (s, h.get("cache-control"))
            s, _, _ = request(base, f"/api/v1/rooms/{room}", "DELETE", headers={"Authorization": f"Bearer {token}"})
            res["room delete"] = (s, None)
        api_rows.append((name, res))

    lines = [f"# 응답 비교: {na} 대 {nb}", "", f"같은 로컬 Ktor 서버·같은 빌드 값. 조합 `{pair}`, 조합 그림 `{pair_og}`, 사이트 그림 `{site_og}`.", ""]
    same = [r for r in rows if not r[3]]
    lines += [f"## 페이지·자산 {len(rows)}개 중 차이 없음 {len(same)}개", "", "| 경로 | " + na + " | " + nb + " | 차이 |", "|---|---|---|---|"]
    for path, sa, sb, diffs in rows:
        cell = "없음" if not diffs else "<br>".join(f"`{k}`: {short(a)} → {short(b)}" for k, a, b in diffs[:6])
        if len(diffs) > 6:
            cell += f"<br>외 {len(diffs) - 6}건"
        lines.append(f"| `{path}` | {sa} | {sb} | {cell} |")
    lines += ["", "## 합성 API·방 흐름(각 Worker에 따로 만든 방)", "", f"| 단계 | {na} | {nb} |", "|---|---|---|"]
    keys = list(api_rows[0][1])
    for k in keys:
        lines.append(f"| {k} | {short(api_rows[0][1].get(k))} | {short(api_rows[1][1].get(k))} |")
    for kind in ("png", "default"):
        pngs = rooms.get(kind, {})
        if len(pngs) == 2:
            lines.append(f"\n방 그림({kind}) 픽셀 비교: {json.dumps(png_diff(pngs[na], pngs[nb]))}")
    open(args.out, "w").write("\n".join(lines) + "\n")
    print("\n".join(lines[:6]))
    print(f"diffs: {sum(1 for r in rows if r[3])} of {len(rows)} pages")


if __name__ == "__main__":
    sys.exit(main())
