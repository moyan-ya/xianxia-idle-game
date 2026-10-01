#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
生成站点图标（favicon）—— 仙侠放置 · 一念千年

    python scripts/make-icon.py

产物全部落在 client/public/ 下：
    favicon.ico            多尺寸（16/24/32/48/64/128/256），每个尺寸单独渲染，不是缩放的
    favicon-16x16.png      favicon-32x32.png
    apple-touch-icon.png   180x180，iOS 加到主屏用
    icon-192.png           安卓/PWA
    icon-512.png
（另有一张 scripts/icon-preview.png 是尺寸预览图，属于排查用，不放进 public）

设计：暗色圆角方底 + 青玉描边与光环 + 「仙」字金色渐变。
小尺寸会省略光环并把字放大，保证 16px 下依然认得出 —— 所以每个尺寸都是原生渲染，
而不是把大图缩小（缩小的字在小尺寸下会糊成一团）。
"""
import io
import os
import struct
from PIL import Image, ImageDraw, ImageFilter, ImageFont

# ---------- 主题色 ----------
INK_TOP = (20, 38, 57)
INK_BOTTOM = (7, 13, 22)
JADE = (53, 179, 154)
JADE_LIGHT = (120, 233, 206)
GOLD_TOP = (255, 241, 190)
GOLD_BOTTOM = (196, 148, 62)

FONT_PATH = r'C:\Windows\Fonts\simhei.ttf'
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public')
SS = 4  # 超采样倍数：先画大图再缩，等于手动抗锯齿


def _vgradient(size, top, bottom):
    """竖向渐变"""
    img = Image.new('RGB', (1, size))
    px = img.load()
    for y in range(size):
        t = y / max(1, size - 1)
        px[0, y] = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    return img.resize((size, size), Image.BILINEAR)


def _radial_glow(size, center, radius, color, strength):
    """径向光晕，用来做"灵气"氛围"""
    img = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(img)
    steps = 48
    for i in range(steps, 0, -1):
        r = radius * i / steps
        a = int(strength * 255 * (1 - i / steps) ** 1.6)
        d.ellipse([center[0] - r, center[1] - r, center[0] + r, center[1] + r], fill=a)
    img = img.filter(ImageFilter.GaussianBlur(size * 0.03))
    layer = Image.new('RGB', (size, size), color)
    return layer, img


def draw_icon(size):
    """按目标尺寸原生渲染一张图标"""
    S = size * SS
    canvas = Image.new('RGBA', (S, S), (0, 0, 0, 0))

    # ---------- 圆角方底 ----------
    radius = round(S * 0.22)
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=radius, fill=255)

    bg = _vgradient(S, INK_TOP, INK_BOTTOM).convert('RGBA')
    layer, glow_mask = _radial_glow(S, (S * 0.5, S * 0.16), S * 0.75, JADE, 0.30)
    bg = Image.composite(layer, bg, glow_mask)
    canvas.paste(bg, (0, 0), mask)

    d = ImageDraw.Draw(canvas)

    # ---------- 青玉内描边 ----------
    bw = max(1, round(S * 0.018))
    d.rounded_rectangle([bw / 2, bw / 2, S - 1 - bw / 2, S - 1 - bw / 2],
                        radius=radius - bw / 2, outline=JADE + (150,), width=bw)

    small = size < 48

    # ---------- 光环（小尺寸省略，否则 16px 会糊）----------
    if not small:
        r = S * 0.325
        ring_w = max(1, round(S * 0.016))
        cx = cy = S * 0.5
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=JADE + (95,), width=ring_w)
        r2 = r + S * 0.045
        d.ellipse([cx - r2, cy - r2, cx + r2, cy + r2], outline=JADE + (45,), width=max(1, round(S * 0.008)))

    # ---------- 字底压暗，给金字留出对比 ----------
    vig = Image.new('L', (S, S), 0)
    ImageDraw.Draw(vig).ellipse(
        [S * 0.5 - S * 0.40, S * 0.5 - S * 0.40, S * 0.5 + S * 0.40, S * 0.5 + S * 0.40], fill=110)
    vig = vig.filter(ImageFilter.GaussianBlur(S * 0.10))
    canvas.alpha_composite(Image.merge('RGBA', (
        Image.new('L', (S, S), 4), Image.new('L', (S, S), 9), Image.new('L', (S, S), 16), vig)))

    # ---------- 「仙」字 ----------
    glyph_ratio = 0.78 if small else 0.66
    font_size = round(S * glyph_ratio)
    font = ImageFont.truetype(FONT_PATH, font_size)
    stroke = max(1, round(S * 0.013))

    text_mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(text_mask).text((S / 2, S / 2 + S * 0.012), '仙', font=font, fill=255,
                                   anchor='mm', stroke_width=stroke, stroke_fill=255)

    # 字的投影：让金字在暗底上更立体
    shadow = text_mask.filter(ImageFilter.GaussianBlur(S * 0.022)).point(lambda v: int(v * 0.75))
    shadow_layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    shadow_layer.putalpha(shadow)
    shadow_layer = shadow_layer.transform(
        shadow_layer.size, Image.AFFINE, (1, 0, 0, 0, 1, -S * 0.010), resample=Image.BILINEAR)
    canvas.alpha_composite(shadow_layer)

    # 金色渐变透过字形的蒙版
    gold = _vgradient(S, GOLD_TOP, GOLD_BOTTOM).convert('RGBA')
    canvas.paste(gold, (0, 0), text_mask)

    # 字缘再叠一层很淡的玉色辉光，显得"有灵气"（压得太重会把金色洗淡）
    halo = text_mask.filter(ImageFilter.GaussianBlur(S * 0.025)).point(lambda v: int(v * 0.18))
    halo_layer = Image.new('RGBA', (S, S), JADE_LIGHT + (255,))
    halo_layer.putalpha(halo)
    canvas.alpha_composite(halo_layer)

    return canvas.resize((size, size), Image.LANCZOS)


def write_ico(path, images):
    """
    手写 ICO：Pillow 自带的 ICO 保存会把同一张图缩放到各个尺寸，
    这里要的是"每个尺寸各自原生渲染"，所以自己拼文件头。
    ICO 允许内嵌 PNG（Vista 以后全支持）。
    """
    n = len(images)
    header = struct.pack('<HHH', 0, 1, n)
    entries = b''
    blobs = b''
    offset = 6 + 16 * n
    for size, im in images:
        buf = io.BytesIO()
        im.save(buf, format='PNG', optimize=True)
        png = buf.getvalue()
        dim = 0 if size >= 256 else size
        entries += struct.pack('<BBBBHHII', dim, dim, 0, 0, 1, 32, len(png), offset)
        offset += len(png)
        blobs += png
    with open(path, 'wb') as f:
        f.write(header + entries + blobs)


def main():
    out = os.path.normpath(OUT_DIR)
    os.makedirs(out, exist_ok=True)

    ico_sizes = [16, 24, 32, 48, 64, 128, 256]
    rendered = {s: draw_icon(s) for s in ico_sizes}
    write_ico(os.path.join(out, 'favicon.ico'), [(s, rendered[s]) for s in ico_sizes])
    print('favicon.ico          ', ', '.join(f'{s}x{s}' for s in ico_sizes))

    for s in (16, 32):
        rendered[s].save(os.path.join(out, f'favicon-{s}x{s}.png'))
        print(f'favicon-{s}x{s}.png')

    draw_icon(180).save(os.path.join(out, 'apple-touch-icon.png'))
    print('apple-touch-icon.png   180x180')
    for s in (192, 512):
        draw_icon(s).save(os.path.join(out, f'icon-{s}.png'))
        print(f'icon-{s}.png')

    # ---------- 预览图：上排原始像素，下排 16/24/32 放大 8 倍，方便肉眼检查 ----------
    preview_sizes = [16, 24, 32, 48, 64, 128, 256]
    pad = 14
    row_gap = 18
    native_h = max(preview_sizes)
    big = {s: rendered[s].resize((s * 8, s * 8), Image.NEAREST) for s in preview_sizes if s <= 32}
    big_h = max(im.height for im in big.values())

    top_w = sum(rendered[s].width for s in preview_sizes) + pad * (len(preview_sizes) + 1)
    bot_w = sum(big[s].width for s in preview_sizes if s in big) + pad * (len(big) + 1)
    sheet = Image.new('RGB', (max(top_w, bot_w), pad + native_h + row_gap + big_h + pad), (22, 24, 28))

    x = pad
    for s in preview_sizes:
        sheet.paste(rendered[s], (x, pad + (native_h - s) // 2), rendered[s])
        x += rendered[s].width + pad

    x = pad
    for s in preview_sizes:
        if s not in big:
            continue
        im = big[s]
        sheet.paste(im, (x, pad + native_h + row_gap + (big_h - im.height) // 2), im)
        x += im.width + pad

    sheet.save(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'icon-preview.png'))
    print('scripts/icon-preview.png  尺寸预览（下排为 16/24/32 放大 8 倍）')


if __name__ == '__main__':
    main()
