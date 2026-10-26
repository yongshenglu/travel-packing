"""生成应用图标：拉杆箱（方案 D）。

用法：
    python make_icons.py

输出到 icons/，覆盖 manifest.json 与 index.html 引用的那几个文件。
"""
from PIL import Image, ImageDraw
import os

OUT = 'icons'
os.makedirs(OUT, exist_ok=True)

S = 4                      # 超采样倍数，缩小后边缘才顺滑
BG = (13, 148, 136)        # --accent #0D9488
FG = (255, 255, 255)


def draw_icon(d, N):
    """在 N×N 的画布上画拉杆箱（背景由调用方决定画不画）"""
    # 拉杆
    lw = int(N * 0.032)
    for x in (int(N * 0.38), int(N * 0.62)):
        d.line([(x, int(N * 0.14)), (x, int(N * 0.30))], fill=FG, width=lw)
    d.rounded_rectangle([int(N * 0.32), int(N * 0.11), int(N * 0.68), int(N * 0.16)],
                        radius=int(N * 0.025), fill=FG)
    # 箱体
    bx0, by0 = int(N * 0.22), int(N * 0.30)
    bx1, by1 = int(N * 0.78), int(N * 0.84)
    d.rounded_rectangle([bx0, by0, bx1, by1], radius=int(N * 0.07), fill=FG)
    # 前袋分隔线
    d.line([(bx0, int(N * 0.52)), (bx1, int(N * 0.52))], fill=BG, width=int(N * 0.028))
    # 轮子
    for x in (int(N * 0.32), int(N * 0.68)):
        r = int(N * 0.045)
        d.ellipse([x - r, by1 - int(N * 0.01), x + r, by1 + int(N * 0.08)], fill=FG)


def render(size, maskable=False, rounded=True):
    n = size * S
    img = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable:
        # maskable 要满幅方形底，系统自己切成圆/圆角方；
        # 图形缩到中央安全区，避免被切掉
        d.rectangle([0, 0, n - 1, n - 1], fill=BG + (255,))
        inner = Image.new('RGBA', (n, n), (0, 0, 0, 0))
        draw_icon(ImageDraw.Draw(inner), int(n * 0.78))
        img.alpha_composite(inner, (int(n * 0.11), int(n * 0.11)))
    else:
        if rounded:
            d.rounded_rectangle([0, 0, n - 1, n - 1], radius=int(n * 0.22), fill=BG + (255,))
        else:
            d.rectangle([0, 0, n - 1, n - 1], fill=BG + (255,))
        draw_icon(d, n)
    return img.resize((size, size), Image.LANCZOS)


def save(img, name):
    img.save(os.path.join(OUT, name))
    print('%-24s %s' % (name, img.size))


if __name__ == '__main__':
    save(render(192), 'icon-192.png')
    save(render(512), 'icon-512.png')
    save(render(512, maskable=True), 'icon-maskable-512.png')
    save(render(180, rounded=False), 'apple-touch-icon.png')
    save(render(32, rounded=False), 'favicon-32.png')
    print('done ->', OUT)
