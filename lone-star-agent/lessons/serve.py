#!/usr/bin/env python3
"""Tiny course server: serves the lesson files and accepts submissions.

GET  /*            -> static files (index.html, data/*.json)
POST /submit       -> save the posted JSON to data/submission.json
                      (the instructor reads that, writes data/feedback.json back)
"""
import http.server, socketserver, os, json
from urllib.parse import urlparse, parse_qs

HERE = os.path.dirname(os.path.abspath(__file__))
AGENT_ROOT = os.path.dirname(HERE)  # the lone-star-agent dir (parent of lessons/)
os.chdir(HERE)
PORT = 8787

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # never cache — so new feedback.json shows up on the next poll
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/code":
            rel = (parse_qs(parsed.query).get("path") or [""])[0]
            full = os.path.normpath(os.path.join(AGENT_ROOT, rel))
            # stay inside the agent dir; only serve source files
            if (not full.startswith(AGENT_ROOT + os.sep)
                    or not os.path.isfile(full)
                    or not full.endswith((".ts", ".md", ".json", ".js"))):
                self.send_error(404); return
            with open(full, "rb") as f:
                data = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write(data)
            return
        return super().do_GET()

    def do_POST(self):
        if self.path.split("?")[0] != "/submit":
            self.send_error(404); return
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        os.makedirs("data", exist_ok=True)
        try:
            parsed = json.loads(body or b"{}")
        except Exception:
            parsed = {"raw": body.decode("utf-8", "replace")}
        with open("data/submission.json", "w") as f:
            json.dump(parsed, f, indent=2)
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def log_message(self, *a):
        pass

class Server(socketserver.TCPServer):
    allow_reuse_address = True

with Server(("127.0.0.1", PORT), Handler) as httpd:
    print(f"course server on http://localhost:{PORT}")
    httpd.serve_forever()
