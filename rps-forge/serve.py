# Dev server for rps-forge with caching fully disabled, so ES-module edits always
# reload. The stock http.server (a) is single-threaded and chokes when the browser
# opens/aborts parallel connections, and (b) honors If-Modified-Since and returns
# 304, letting the browser keep stale module code. We fix both: threaded server,
# strip conditional headers (never 304), and send no-store.
import functools
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5700
ROOT = os.path.dirname(os.path.abspath(__file__))


class NoCacheHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        # Drop conditional headers so the base handler never replies 304.
        for h in ("If-Modified-Since", "If-None-Match"):
            if h in self.headers:
                del self.headers[h]
        return super().send_head()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


handler = functools.partial(NoCacheHandler, directory=ROOT)
httpd = ThreadingHTTPServer(("", PORT), handler)
print(f"rps-forge no-cache server on http://localhost:{PORT} (root: {ROOT})")
httpd.serve_forever()
