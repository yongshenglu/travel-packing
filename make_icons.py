"""生成几个候选图标，供挑选。"""
from PIL import Image, ImageDraw
import os

OUT = 'icon-options'
os.makedirs(OUT, exist_ok=True)

S = 4          # 超采样倍数，缩小后边缘才顺滑
SIZE = 512
N = SIZE * S   # 实际绘制尺寸

BG = (13, 148, 136)     # --accent #0D9488
FG = (255, 255, 255)
INK = (10, 92, 85)      # 深一点的青，用于白底上的细节


def canvas():
    img = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # 圆角方形底
    d.rounded_rectangle([0, 0, N - 1, N - 1], radius=int(N * 0.22), fill=BG + (255,))
    return img, d


def finish(img, name):
    img = img.resize((SIZE, SIZE), Image.LANCZOS)
    img.save(os.path.join(OUT, name + '.png'))
    print(name)


def check(d, x0, y0, x1, y1, w, color):
    """画一个勾，(x0,y0) 左上角起笔，(x1,y1) 右下角收笔"""
    pts = [
        (x0, y0 + (y1 - y0) * 0.52),
        (x0 + (x1 - x0) * 0.34, y1),
        (x1, y0),
    ]
    d.line(pts, fill=color, width=w, joint='curve')
    # 端点圆头
    for p in (pts[0], pts[2]):
        d.ellipse([p[0] - w / 2, p[1] - w / 2, p[0] + w / 2, p[1] + w / 2], fill=color)


def icon_suitcase_check():
    """A 行李箱 + 勾"""
    img, d = canvas()
    cx = N // 2
    # 提手：描边的圆环，不要填成方块
    hw, hh = int(N * 0.14), int(N * 0.12)
    top = int(N * 0.24)
    d.rounded_rectangle([cx - hw, top - hh, cx + hw, top + int(N * 0.03)],
                        radius=int(N * 0.045), outline=FG, width=int(N * 0.05))
    # 箱体
    bx0, by0 = int(N * 0.16), top
    bx1, by1 = int(N * 0.84), int(N * 0.80)
    d.rounded_rectangle([bx0, by0, bx1, by1], radius=int(N * 0.08), fill=FG)
    # 捆带
    my = int(N * 0.38)
    d.line([(bx0, my), (bx1, my)], fill=BG, width=int(N * 0.04))
    # 勾，放在捆带下方的空白区
    check(d, int(N * 0.32), int(N * 0.48), int(N * 0.68), int(N * 0.70), int(N * 0.095), BG)
    finish(img, 'a-suitcase-check')


def icon_checklist():
    """B 清单表"""
    img, d = canvas()
    bx0, by0 = int(N * 0.22), int(N * 0.22)
    bx1, by1 = int(N * 0.78), int(N * 0.84)
    d.rounded_rectangle([bx0, by0, bx1, by1], radius=int(N * 0.065), fill=FG)
    # 夹子：窄一些，贴在板子上沿
    cw, ch = int(N * 0.15), int(N * 0.085)
    d.rounded_rectangle([N // 2 - cw, by0 - int(N * 0.045),
                         N // 2 + cw, by0 + int(N * 0.075)],
                        radius=int(N * 0.03), fill=BG)
    rows_y = [int(N * 0.42), int(N * 0.58), int(N * 0.74)]
    box_w = int(N * 0.085)
    for i, y in enumerate(rows_y):
        bx = int(N * 0.32)
        on = i < 2
        d.rounded_rectangle([bx - box_w, y - box_w, bx + box_w, y + box_w],
                            radius=int(N * 0.02),
                            outline=BG if on else (186, 206, 202),
                            width=int(N * 0.026))
        if on:
            check(d, bx - box_w * 0.5, y - box_w * 0.1, bx + box_w * 0.55, y + box_w * 0.6,
                  int(N * 0.036), BG)
        # 文字行，向右留出更多空隙
        lx = bx + box_w + int(N * 0.075)
        lw = (int(N * 0.22) if on else int(N * 0.30))
        d.rounded_rectangle([lx, y - int(N * 0.022), lx + lw, y + int(N * 0.022)],
                            radius=int(N * 0.022), fill=(176, 200, 195) if on else (198, 218, 214))
    finish(img, 'b-checklist')


def icon_luggage_tag():
    """C 行李吊牌（呼应应用里的吊牌小标）"""
    img, d = canvas()
    bx0, by0 = int(N * 0.26), int(N * 0.26)
    bx1, by1 = int(N * 0.74), int(N * 0.84)
    d.rounded_rectangle([bx0, by0, bx1, by1], radius=int(N * 0.11), fill=FG)
    # 顶部一个小圆环（挂绳扣），比画线干净
    hx, hy = N // 2, int(N * 0.26)
    ro, ri = int(N * 0.075), int(N * 0.036)
    d.ellipse([hx - ro, hy - ro, hx + ro, hy + ro], fill=FG)
    d.ellipse([hx - ri, hy - ri, hx + ri, hy + ri], fill=BG)
    # 牌面：小行李箱
    sx0, sy0 = int(N * 0.35), int(N * 0.46)
    sx1, sy1 = int(N * 0.65), int(N * 0.72)
    d.rounded_rectangle([sx0, sy0, sx1, sy1], radius=int(N * 0.035), fill=BG)
    # 箱体提手
    shw = int(N * 0.055)
    d.rounded_rectangle([N // 2 - shw, sy0 - int(N * 0.035), N // 2 + shw, sy0 + int(N * 0.01)],
                        radius=int(N * 0.015), outline=BG, width=int(N * 0.022))
    # 箱体上的勾
    check(d, int(N * 0.40), int(N * 0.56), int(N * 0.60), int(N * 0.66), int(N * 0.045), FG)
    finish(img, 'c-luggage-tag')


def icon_roller():
    """D 拉杆箱"""
    img, d = canvas()
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
    py = int(N * 0.52)
    d.line([(bx0, py), (bx1, py)], fill=BG, width=int(N * 0.028))
    # 轮子
    for x in (int(N * 0.32), int(N * 0.68)):
        r = int(N * 0.045)
        d.ellipse([x - r, by1 - int(N * 0.01), x + r, by1 + int(N * 0.08)], fill=FG)
    finish(img, 'd-roller')


def icon_stacked():
    """E 叠放的行李"""
    img, d = canvas()
    # 下层大箱
    bx0, by0 = int(N * 0.14), int(N * 0.46)
    bx1, by1 = int(N * 0.86), int(N * 0.82)
    d.rounded_rectangle([bx0, by0, bx1, by1], radius=int(N * 0.06), fill=FG)
    # 下层捆带
    sx = int(N * 0.5)
    d.line([(sx, by0), (sx, by1)], fill=BG, width=int(N * 0.05))
    # 上层小箱
    tx0, ty0 = int(N * 0.26), int(N * 0.22)
    tx1, ty1 = int(N * 0.74), int(N * 0.44)
    d.rounded_rectangle([tx0, ty0, tx1, ty1], radius=int(N * 0.05), fill=FG)
    # 上层提手
    hw = int(N * 0.10)
    d.rounded_rectangle([sx - hw, ty0 - int(N * 0.07), sx + hw, ty0 + int(N * 0.02)],
                        radius=int(N * 0.025), outline=FG, width=int(N * 0.04))
    # 上层捆带
    d.line([(sx, ty0), (sx, ty1)], fill=BG, width=int(N * 0.04))
    finish(img, 'e-stacked')


def icon_parcel_check():
    """F 打包好的包裹 + 勾"""
    img, d = canvas()
    bx0, by0 = int(N * 0.18), int(N * 0.24)
    bx1, by1 = int(N * 0.82), int(N * 0.82)
    d.rounded_rectangle([bx0, by0, bx1, by1], radius=int(N * 0.07), fill=FG)
    # 顶盖：浅色，和箱体区分开
    lid = int(N * 0.42)
    d.rounded_rectangle([bx0, by0, bx1, lid + int(N * 0.03)], radius=int(N * 0.07), fill=(214, 240, 237))
    d.rounded_rectangle([bx0, lid - int(N * 0.02), bx1, lid + int(N * 0.04)], radius=0, fill=FG)
    d.line([(bx0, lid), (bx1, lid)], fill=BG, width=int(N * 0.032))
    # 竖向胶带只画在顶盖上，避开下方的勾
    sx = N // 2
    d.line([(sx, by0), (sx, lid)], fill=BG, width=int(N * 0.055))
    # 勾，放在下半区居中
    check(d, int(N * 0.36), int(N * 0.52), int(N * 0.64), int(N * 0.70), int(N * 0.08), BG)
    finish(img, 'f-parcel-check')


def icon_pin_suitcase():
    """G 行李箱 + 定位（旅行感更强）"""
    img, d = canvas()
    # 箱体整体缩小并左移，给定位针让出右上角
    bx0, by0 = int(N * 0.14), int(N * 0.34)
    bx1, by1 = int(N * 0.64), int(N * 0.80)
    d.rounded_rectangle([bx0, by0, bx1, by1], radius=int(N * 0.07), fill=FG)
    # 提手
    hw = int(N * 0.10)
    d.rounded_rectangle([int(N * 0.32) - hw, int(N * 0.26), int(N * 0.32) + hw, int(N * 0.36)],
                        radius=int(N * 0.028), outline=FG, width=int(N * 0.04))
    # 捆带
    d.line([(int(N * 0.42), by0), (int(N * 0.42), by1)], fill=BG, width=int(N * 0.032))
    # 定位针：独立在右上角，不与箱体重叠
    px, py, pr = int(N * 0.74), int(N * 0.28), int(N * 0.15)
    d.ellipse([px - pr, py - pr, px + pr, py + pr], fill=FG)
    d.polygon([(px - pr * 0.70, py + pr * 0.45), (px + pr * 0.70, py + pr * 0.45),
               (px, py + pr * 1.75)], fill=FG)
    hr = int(N * 0.052)
    d.ellipse([px - hr, py - hr, px + hr, py + hr], fill=BG)
    finish(img, 'g-pin-suitcase')


def icon_tag_check():
    """H 吊牌 + 勾（更简练的版本）"""
    img, d = canvas()
    # 牌身：上窄下宽的梯形感，用圆角矩形近似
    bx0, by0 = int(N * 0.30), int(N * 0.20)
    bx1, by1 = int(N * 0.70), int(N * 0.82)
    d.rounded_rectangle([bx0, by0, bx1, by1], radius=int(N * 0.12), fill=FG)
    # 打孔
    hx, hy, hr = N // 2, int(N * 0.31), int(N * 0.042)
    d.ellipse([hx - hr, hy - hr, hx + hr, hy + hr], fill=BG)
    # 勾
    check(d, int(N * 0.38), int(N * 0.48), int(N * 0.62), int(N * 0.66), int(N * 0.07), BG)
    finish(img, 'h-tag-check')


if __name__ == '__main__':
    icon_suitcase_check()
    icon_checklist()
    icon_luggage_tag()
    icon_roller()
    icon_stacked()
    icon_parcel_check()
    icon_pin_suitcase()
    icon_tag_check()
    print('done ->', OUT)
