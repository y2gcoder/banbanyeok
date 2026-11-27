#!/usr/bin/env python3
"""Check sitemap crawl rules and sample indexable responses without following redirects."""

import argparse
from html.parser import HTMLParser
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.parse import urlsplit
import xml.etree.ElementTree as ET


SITEMAP_NS = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
PAIR = re.compile(r"/meet/[0-9a-z]{3}-[0-9a-z]{3}")
LOOPBACK = ("localhost", "127.0.0.1", "::1")


class SeoTags(HTMLParser):
    def __init__(self):
        super().__init__()
        self.canonicals = []
        self.noindex = False

    def handle_starttag(self, tag, attrs):
        attrs = {name: value or "" for name, value in attrs}
        if tag == "link" and "canonical" in attrs.get("rel", "").lower().split():
            self.canonicals.append(attrs.get("href", ""))
        if tag == "meta" and attrs.get("name", "").lower() in ("robots", "googlebot"):
            directives = re.split(r"[,\s]+", attrs.get("content", "").lower())
            self.noindex |= "noindex" in directives or "none" in directives


def get(base, path, body_file):
    args = ["curl", "-q", "--globoff", "-sS", "--max-time", "10", "-D", "-", "-o", str(body_file),
            "-w", "\n__STATUS__%{http_code}"]
    if base.hostname in LOOPBACK:
        args.extend(("--noproxy", "*"))
    result = subprocess.run(
        args + [base.geturl() + path], capture_output=True, text=True, errors="replace",
    )
    headers, _, status = result.stdout.rpartition("__STATUS__")
    if result.returncode or status != "200":
        raise ValueError(f"{path} status={status or '000'} (curl={result.returncode}, 기대: 200)")
    return headers, body_file.read_bytes()


def robot_rules(text):
    # Google merges groups with the same agent, then chooses Googlebot over *.
    groups, sitemaps = {}, []
    agents = []
    seen_rule = False
    for line in text.splitlines():
        field, _, value = line.split("#", 1)[0].partition(":")
        field, value = field.strip().lower(), value.strip()
        if field == "sitemap":
            sitemaps.append(value)
        elif field == "user-agent" and value:
            if seen_rule:
                agents, seen_rule = [], False
            agent = re.match(r"[a-z_-]+|\*", value.lower())
            if agent:
                agents.append(agent[0])
                groups.setdefault(agent[0], [])
        elif field in ("allow", "disallow") and value.startswith("/"):
            seen_rule = True
            prefix = re.escape(value.removesuffix("$")).replace(r"\*", ".*")
            pattern = re.compile(prefix + (r"\Z" if value.endswith("$") else ""))
            for agent in agents:
                groups[agent].append((len(value), field == "allow", pattern))
    wildcard = groups.get("*", [])
    return groups.get("googlebot", wildcard), wildcard, sitemaps


def crawlable(path, rules):
    # For matching paths, a longer rule wins. At equal lengths Allow wins.
    return max(((length, allow) for length, allow, pattern in rules if pattern.match(path)),
               default=(0, True))[1]


def sitemap_paths(xml, site):
    root = ET.fromstring(xml)
    if root.tag != SITEMAP_NS + "urlset":
        raise ValueError("sitemap.xml에 urlset이 없습니다")
    paths = []
    for entry in root.findall(SITEMAP_NS + "url"):
        url = urlsplit(entry.findtext(SITEMAP_NS + "loc", "").strip())
        if (url.scheme, url.netloc) != (site.scheme, site.netloc) or url.fragment:
            raise ValueError(f"사이트맵 URL 출처 또는 fragment를 확인하세요 (기대 출처: {site.geturl()})")
        paths.append((url.path or "/") + ("?" + url.query if url.query else ""))
    if len(set(paths)) != len(paths):
        raise ValueError("사이트맵 URL이 중복됩니다")
    return paths


def check_page(base, site, path, body_file):
    headers, body = get(base, path, body_file)
    tags = SeoTags()
    tags.feed(body.decode("utf-8"))
    expected = site.geturl() + path
    valid_canonicals = {expected}
    if path == "/":
        valid_canonicals.add(site.geturl())
    if len(tags.canonicals) != 1 or tags.canonicals[0] not in valid_canonicals:
        raise ValueError(f"{path} self-canonical이 아닙니다 (기대: {expected})")
    if tags.noindex:
        raise ValueError(f"{path} meta robots에 noindex 또는 none이 있습니다")
    if re.search(r"^x-robots-tag:", headers, re.I | re.M):
        raise ValueError(f"{path} X-Robots-Tag가 있습니다")


def check(base, site, all_pages, body_file):
    _, robots = get(base, "/robots.txt", body_file)
    googlebot, wildcard, sitemaps = robot_rules(robots.decode("utf-8-sig"))
    if site.geturl() + "/sitemap.xml" not in sitemaps:
        raise ValueError("robots.txt Sitemap이 정식 절대 주소를 안내하지 않습니다")
    if crawlable("/api/", wildcard) or crawlable("/api/", googlebot):
        raise ValueError("robots.txt가 /api/를 차단하지 않습니다")
    _, xml = get(base, "/sitemap.xml", body_file)
    paths = sitemap_paths(xml, site)
    pair = next((path for path in paths if PAIR.fullmatch(path)), None)
    if "/" not in paths or "/meet" not in paths or pair is None:
        raise ValueError("사이트맵에 홈·허브·조합 URL이 필요합니다")
    for path in ["/sitemap.xml", *paths]:
        if not crawlable(path, googlebot):
            raise ValueError(f"{path} robots.txt 차단 (Googlebot)")
    checked = paths if all_pages else ["/", "/meet", pair]
    for path in checked:
        check_page(base, site, path, body_file)
    print(f"ok   sitemap 색인 검사: URL 응답 {len(checked)}/{len(paths)}, robots 허용 {len(paths)}/{len(paths)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base_url", help="검사 요청을 보낼 출처")
    parser.add_argument("site_url", help="사이트맵과 canonical에 나와야 할 정식 출처")
    parser.add_argument("--all", action="store_true", help="루프백에서 사이트맵 URL 응답 전체 확인")
    args = parser.parse_args()
    base, site = (urlsplit(url.rstrip("/")) for url in (args.base_url, args.site_url))
    for url in (base, site):
        if url.scheme not in ("http", "https") or not url.hostname or url.username is not None or url.path or url.query or url.fragment:
            parser.error("주소는 http(s) 출처여야 합니다")
    if args.all and base.hostname not in LOOPBACK:
        parser.error("--all은 루프백에서만 사용할 수 있습니다")
    try:
        with tempfile.TemporaryDirectory() as tmp:
            check(base, site, args.all, Path(tmp) / "body")
    except (ValueError, OSError, ET.ParseError) as exc:
        print(f"FAIL {exc}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
