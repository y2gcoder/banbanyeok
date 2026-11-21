"""test-worker-version.sh 2부가 쓰는 루프백 가짜 Cloudflare API(127.0.0.1, 빈 포트). 실제 Cloudflare를 부르지 않는다.

사용: python3 -I test-worker-version-api.py <상태 디렉터리> <포트를 적을 파일>
상태 디렉터리의 파일:
  mode     single | split | empty | missing | auth   (요청마다 다시 읽는다)
  current  single에서 100%인 버전 id, split에서 60%인 버전 id
  tag      versions/<id> 응답의 workers/tag (비면 annotations 없음)
POST .../deployments(wrangler rollback)를 받으면 그 버전을 100%로 바꾸고 mode를 single로 둔다.
응답 형식은 Cloudflare API v4 봉투({success, errors, messages, result})와 wrangler 4.158.0이 읽는 필드를 따른다.
"""
import json
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

STATE = sys.argv[1]
OTHER = "33333333-3333-4333-8333-333333333333"
SCRIPT = re.compile(r"^/client/v4/accounts/[^/]+/workers/scripts/[^/]+/(deployments|versions/([0-9a-f-]+))(\?.*)?$")


def read(name, default=""):
    try:
        with open(os.path.join(STATE, name), encoding="utf-8") as f:
            return f.read().strip()
    except FileNotFoundError:
        return default


def write(name, value):
    with open(os.path.join(STATE, name), "w", encoding="utf-8") as f:
        f.write(value)


def deployment(versions):
    return {
        "id": "dep-1",
        "source": "wrangler",
        "strategy": "percentage",
        "author_email": "someone@example.invalid",
        "annotations": {"workers/triggered_by": "deployment"},
        "versions": versions,
        "created_on": "2026-11-20T00:00:00Z",
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.command, self.path))

    def reply(self, code, result=None, errors=None):
        body = json.dumps({"success": not errors, "errors": errors or [], "messages": [], "result": result}).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def common_errors(self):
        mode = read("mode", "single")
        if mode == "missing":
            self.reply(404, errors=[{"code": 10007, "message": "This Worker does not exist on your account."}])
            return True
        if mode == "auth":
            self.reply(403, errors=[{"code": 10000, "message": "Authentication error"}])
            return True
        return False

    def do_GET(self):
        m = SCRIPT.match(self.path)
        if not m:
            # 인증 오류 뒤 wrangler가 토큰 확인 등을 부를 수 있다. 실패로 답한다.
            return self.reply(404, errors=[{"code": 7003, "message": "No route for that URI"}])
        if self.common_errors():
            return None
        mode = read("mode", "single")
        current = read("current")
        if m.group(1) == "deployments":
            if mode == "empty":
                return self.reply(200, {"deployments": []})
            if mode == "split":
                versions = [{"version_id": current, "percentage": 60}, {"version_id": OTHER, "percentage": 40}]
            else:
                versions = [{"version_id": current, "percentage": 100}]
            return self.reply(200, {"deployments": [deployment(versions)]})
        version_id = m.group(2)
        tag = read("tag")
        annotations = {"workers/tag": tag, "workers/message": tag} if tag else {}
        return self.reply(200, {
            "id": version_id,
            "number": 7,
            "metadata": {"created_on": "2026-11-20T00:00:00Z", "source": "wrangler", "author_email": "someone@example.invalid"},
            "annotations": annotations,
            "resources": {"bindings": [], "script": {"etag": "e", "handlers": ["fetch"]}, "script_runtime": {}},
        })

    def do_POST(self):
        m = SCRIPT.match(self.path)
        if not m or m.group(1) != "deployments":
            return self.reply(404, errors=[{"code": 7003, "message": "No route for that URI"}])
        if self.common_errors():
            return None
        body = json.loads(self.rfile.read(int(self.headers.get("content-length", "0"))) or b"{}")
        versions = body.get("versions") or []
        if len(versions) != 1 or versions[0].get("percentage") != 100:
            return self.reply(400, errors=[{"code": 10021, "message": "test API: expected one version at 100%"}])
        write("current", versions[0]["version_id"])
        write("mode", "single")
        return self.reply(200, deployment(versions))


server = HTTPServer(("127.0.0.1", 0), Handler)
with open(sys.argv[2], "w", encoding="utf-8") as f:
    f.write(str(server.server_address[1]))
server.serve_forever()
