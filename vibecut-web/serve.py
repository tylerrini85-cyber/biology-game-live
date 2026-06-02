"""Tiny static server for deploying VibeCut Studio (Railway / any PaaS).

Serves this folder; `/` -> studio.html. Binds 0.0.0.0:$PORT (Railway sets PORT).
Stdlib only — no dependencies. Run locally: `python serve.py` (defaults to 8000).
"""
import http.server
import os

DIR = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT", "8000"))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIR, **kwargs)

    def do_GET(self):
        if self.path in ("", "/"):
            self.path = "/studio.html"
        elif self.path in ("/demo", "/demo/"):
            self.path = "/index.html"
        return super().do_GET()

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    print(f"VibeCut Studio serving on 0.0.0.0:{PORT}")
    http.server.ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
