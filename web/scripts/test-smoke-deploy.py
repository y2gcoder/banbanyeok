#!/usr/bin/env python3
"""Run the real smoke script with fake curl/sleep; never open a network socket."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("smoke-deploy.sh")
BASE = "https://smoke.example.invalid"
KAKAO = "https://kapi.kakao.com/v2/api/kakaolink/talk/template/default"


def fake_command():
    state = Path(os.environ["SMOKE_TEST_STATE"])
    if Path(sys.argv[0]).name == "sleep":
        with (state / "sleeps").open("a") as log:
            log.write(sys.argv[1] + "\n")
        return 0
    args = sys.argv[1:]
    urls = [arg for arg in args if arg.startswith("https://")]
    if len(urls) != 1 or not (urls[0].startswith(BASE + "/") or urls[0] == KAKAO):
        raise RuntimeError("Unexpected fake curl destination")
    url = urls[0]
    output = Path(args[args.index("-o") + 1])
    if url == KAKAO:
        calls = state / "calls"
        count = len(calls.read_text().splitlines())
        with calls.open("a") as log:
            log.write("template\n")
        status, rc, code = json.loads(os.environ["SMOKE_TEST_RESPONSES"])[count]
        # A 000 attempt deliberately leaves the output untouched, like curl failing
        # before receiving a body; the smoke script must clear the previous body.
        if status != "000":
            output.write_text(json.dumps({"code": code}))
        print(status, end="")
        return rc
    path = url.removeprefix(BASE)
    status = "200"
    content_type = "text/html"
    body = (
        '<html lang="ko"><h1>만날 개인정보</h1>'
        f'<meta property="og:image" content="{BASE}/opengraph-image?v=1234abcd">'
        '<meta name="robots" content="noindex">'
        f'<meta name="naver-site-verification" content="{"a" * 40}">'
        '<link rel="apple-touch-icon" href="/apple.png">'
    )
    if path == "/sitemap.xml":
        body = f"<urlset><loc>{BASE}/meet/001-002</loc></urlset>"
    elif path == "/meet/001-002":
        body = f'<h1>만날</h1><meta property="og:image" content="{BASE}/meet/001-002/opengraph-image?v=1234abcd">'
    elif "opengraph-image" in path or path == "/apple.png":
        content_type = "image/png"
        body = "fake png"
    elif path == "/favicon.ico":
        content_type = "image/x-icon"
    elif path == "/manifest.webmanifest":
        body = '{"display":"standalone","start_url":"/","icons":[{"src":"/apple.png"}]}'
    elif path == "/robots.txt":
        body = "Disallow: /"
    elif path == "/api/healthz":
        status = "503"
        body = "UPSTREAM_NOT_CONFIGURED"
    output.write_text(body)
    print(f"content-type: {content_type}\r")
    print("content-security-policy: script-src https://t1.kakaocdn.net/kakao_js_sdk/; form-action https://sharer.kakao.com https://accounts.kakao.com\r")
    print("x-content-type-options: nosniff\r\nreferrer-policy: same-origin\r\nx-frame-options: DENY\r")
    print(f"\n__STATUS__{status}", end="")
    return 0


class KakaoRetryTest(unittest.TestCase):
    def check_retry(self, responses, expected_exit, waits, message):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            for command in ("curl", "sleep"):
                (state / command).symlink_to(Path(__file__).resolve())
            (state / "calls").write_text("")
            (state / "sleeps").write_text("")
            # Use a fresh environment so local deployment settings and real keys
            # cannot enter the subprocess. Every curl invocation hits our fake.
            env = {
                "PATH": f"{state}:{os.environ['PATH']}",
                "BASE_URL": BASE,
                "SITE_URL": BASE,
                "SERVER_CONNECTED": "0",
                "SITE_INDEXABLE": "0",
                "KAKAO_JS_KEY": "fake-smoke-test-key",
                "SMOKE_TEST_STATE": str(state),
                "SMOKE_TEST_RESPONSES": json.dumps(responses),
            }
            result = subprocess.run(["bash", str(SCRIPT)], env=env, capture_output=True, text=True, timeout=20)
            self.assertEqual(result.returncode, expected_exit, result.stdout + result.stderr)
            self.assertEqual((state / "calls").read_text().splitlines(), ["template"] * len(responses))
            self.assertEqual((state / "sleeps").read_text().splitlines(), waits)
            self.assertIn(message, result.stdout)
            self.assertNotIn(env["KAKAO_JS_KEY"], result.stdout + result.stderr)

    def test_success_without_retry(self):
        self.check_retry([("200", 0, 0)], 0, [], "카카오가 이 앱 키")

    def test_transport_failure_then_success(self):
        self.check_retry([("000", 6, None), ("200", 0, 0)], 0, ["2"], "카카오가 이 앱 키")

    def test_two_transport_failures_then_success(self):
        self.check_retry([("000", 7, None), ("000", 35, None), ("200", 0, 0)], 0, ["2", "5"], "카카오가 이 앱 키")

    def test_transport_failures_exhausted(self):
        self.check_retry([("000", 6, None), ("000", 7, None), ("000", 28, None)], 1, ["2", "5"], "status=000 curl=28 (3번 시도")

    def test_http_failures_are_not_retried(self):
        for status, code in [("400", -401), ("400", -402), ("401", -401), ("500", -1)]:
            with self.subTest(status=status, code=code):
                self.check_retry([(status, 0, code)], 1, [], f"status={status} curl=0 code={code}")

    def test_http_failure_after_transport_failure_stops(self):
        self.check_retry([("000", 6, None), ("400", 0, -402)], 1, ["2"], "status=400 curl=0 code=-402")


if __name__ == "__main__":
    if Path(sys.argv[0]).name in ("curl", "sleep"):
        sys.exit(fake_command())
    unittest.main()
