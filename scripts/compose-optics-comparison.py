"""Compose the live optics A/B frames into one labeled comparison image."""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

src = Path(sys.argv[1] if len(sys.argv) > 1 else "reports/intro-shots")
out = Path(sys.argv[2] if len(sys.argv) > 2 else "reports/intro-shots/optics-comparison.png")

zero = Image.open(src / "optics-zero.png").convert("RGB")
on = Image.open(src / "optics-on.png").convert("RGB")

if zero.size != on.size:
    on = on.resize(zero.size, Image.LANCZOS)

label_h = 56
gap = 28
pad = 22
caption_h = 64
w, h = zero.size
canvas_w = pad * 2 + w * 2 + gap
canvas_h = pad * 2 + label_h + h + caption_h

canvas = Image.new("RGB", (canvas_w, canvas_h), "#ffffff")
draw = ImageDraw.Draw(canvas)

font_bold = ImageFont.truetype(r"C:\Windows\Fonts\msyhbd.ttc", 30)
font_small = ImageFont.truetype(r"C:\Windows\Fonts\msyh.ttc", 24)

y0 = pad + label_h
left = pad
right = pad + w + gap

draw.text((left, pad), "零位移：真实窗后条纹", font=font_bold, fill="#111827")
draw.text((right, pad), "开启折射与 RGB 色散", font=font_bold, fill="#111827")

canvas.paste(zero, (left, y0))
canvas.paste(on, (right, y0))

draw.rectangle([left - 1, y0 - 1, left + w, y0 + h], outline="#d1d5db", width=2)
draw.rectangle([right - 1, y0 - 1, right + w, y0 + h], outline="#d1d5db", width=2)

caption = "同一扇窗、同一组真实窗后条纹：左边零位移，右边被真实透镜压弯并带上彩虹边（实测，非效果图）"
draw.text((left, y0 + h + 16), caption, font=font_small, fill="#4b5563")

out.parent.mkdir(parents=True, exist_ok=True)
canvas.save(out)
print("wrote", out, canvas.size)
