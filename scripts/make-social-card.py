#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
生成 GitHub 社交预览图（Social preview）—— 仓库链接被分享到微信/Twitter/Slack 时显示的那张。

    python scripts/make-social-card.py

产物：docs/social-preview.png（1280x640，GitHub 推荐尺寸）

用法：仓库页 → Settings → Social preview → Upload an image

图标部分直接复用 make-icon.py 的 draw_icon()，保证卡片与站点图标不会走样。
"""
import importlib.util
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..'))

W, H = 1280, 640
INK_TOP = (20, 38, 57)
INK_BOTTOM = (7, 13, 22)
JADE = (53, 179, 154)
JADE_LIGHT = (120, 233, 206)
GOLD_TOP = (255, 241, 190)
GOLD_BOTTOM = (196, 148, 62)
TEXT = (223, 233, 243)
TEXT_DIM = (139, 161, 184)

FONT_BOLD = r'C:\Windows\Fonts\simhei.ttf'


def load_icon_module():
    """make-icon.py 的文件名带连字符，不能直接 import，用 importlib 按路径加载"""
    path = os.path.join(ROOT, 'client', 'scripts', 'make-icon.py')
    spec = importlib.util.spec_from_file_location('make_icon', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def vgradient(size, top, bottom):
    w, h = size
    img = Image.new('RGB', (1, h))
    px = img.load()
    for y in range(h):
        t = y / max(1, h - 1)
        px[0, y] = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    return img.resize((w, h), Image.BILINEAR)


def gradient_text(canvas, xy, text, font, top, bottom, anchor='la'):
    """把文字用竖向渐变填充（先做蒙版，再让渐变透过蒙版贴上去）"""
    mask = Image.new('L', canvas.size, 0)
    ImageDraw.Draw(mask).text(xy, text, font=font, fill=255, anchor=anchor)
    grad = vgradient(canvas.size, top, bottom).convert('RGBA')
    canvas.paste(grad, (0, 0), mask)


def main():
    out_dir = os.path.join(ROOT, 'docs')
    os.makedirs(out_dir, exist_ok=True)

    card = vgradient((W, H), INK_TOP, INK_BOTTOM).convert('RGBA')

    # 右上角一团灵气光晕
    glow = Image.new('L', (W, H), 0)
    gd = ImageDraw.Draw(glow)
    for i in range(40, 0, -1):
        r = 620 * i / 40
        gd.ellipse([W * 0.78 - r, H * 0.10 - r, W * 0.78 + r, H * 0.10 + r],
                   fill=int(60 * (1 - i / 40) ** 1.5))
    glow = glow.filter(ImageFilter.GaussianBlur(60))
    card.alpha_composite(Image.merge('RGBA', (
        Image.new('L', (W, H), JADE[0]), Image.new('L', (W, H), JADE[1]),
        Image.new('L', (W, H), JADE[2]), glow)))

    d = ImageDraw.Draw(card)

    # 左侧青玉竖条
    d.rectangle([0, 0, 6, H], fill=JADE + (255,))

    # ---------- 图标 ----------
    icon_mod = load_icon_module()
    icon = icon_mod.draw_icon(232)
    card.alpha_composite(icon, (96, (H - 232) // 2))

    # ---------- 文字 ----------
    x = 400
    f_title = ImageFont.truetype(FONT_BOLD, 74)
    f_sub = ImageFont.truetype(FONT_BOLD, 30)
    f_tech = ImageFont.truetype(FONT_BOLD, 25)
    f_foot = ImageFont.truetype(FONT_BOLD, 22)

    gradient_text(card, (x, 178), '仙侠放置 · 一念千年', f_title, GOLD_TOP, GOLD_BOTTOM)

    d.text((x, 286), '文字放置修仙 · 挂机攒灵石，服丹破境', font=f_sub, fill=JADE_LIGHT)
    d.text((x, 330), '洗练灵根，闯试炼塔，问鼎天榜', font=f_sub, fill=JADE_LIGHT)

    d.line([x, 396, x + 300, 396], fill=JADE + (200,), width=3)

    d.text((x, 424), 'Vue 2.6 · Element UI 2.15 · Node 16 · Express 4 · MySQL 8.0',
           font=f_tech, fill=TEXT)

    d.text((x, 474), '服务端权威 · 种子可复算战斗 · 惰性离线结算 · 逐灵根五行克制',
           font=f_foot, fill=TEXT_DIM)

    # 底部一行"测试徽章"式的说明
    badge_y = 528
    for label, color in (('对抗性探针 203 项', JADE), ('冒烟测试 59 项', JADE)):
        tw = d.textlength(label, font=f_foot)
        d.rounded_rectangle([x, badge_y, x + tw + 34, badge_y + 38], radius=19,
                            fill=(color[0], color[1], color[2], 40), outline=color + (170,), width=2)
        d.text((x + 17, badge_y + 8), label, font=f_foot, fill=JADE_LIGHT)
        x += tw + 34 + 16

    path = os.path.join(out_dir, 'social-preview.png')
    card.convert('RGB').save(path)
    print(f'已生成 {os.path.relpath(path, ROOT)}  ({W}x{H})')


if __name__ == '__main__':
    main()
