"""本地预览服务器：强制不缓存，改完代码刷新即生效。

用法：
    python serve.py          # 默认 8010 端口
    python serve.py 9000     # 指定端口
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8010


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # 安静模式


if __name__ == "__main__":
    handler = partial(NoCacheHandler, directory=sys.path[0] or ".")
    with ThreadingHTTPServer(("127.0.0.1", PORT), handler) as httpd:
        print(f"预览: http://127.0.0.1:{PORT}  (改代码后刷新即可看到)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n已停止")
