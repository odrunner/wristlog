#!/usr/bin/env python3
import http.server, socketserver, os

os.chdir('/Users/ozgurdogan/Documents/Claude project/watch tracker')
PORT = 3456
Handler = http.server.SimpleHTTPRequestHandler
Handler.log_message = lambda *a: None  # quiet
with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"Serving http://localhost:{PORT}", flush=True)
    httpd.serve_forever()
