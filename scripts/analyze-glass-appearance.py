"""Validate exported fixture-owned pixels; never captures desktop content."""
import json
from pathlib import Path
from PIL import Image

out = Path('reports/glass-appearance')
metadata = json.loads((out / 'acceptance.json').read_text(encoding='utf-8'))
r = metadata['region']
box = tuple(r[k] for k in ('left', 'top', 'right', 'bottom'))


def patch(name):
    with Image.open(out / name) as image:
        return image.convert('RGB').crop(box)


def rgb_mean(image):
    data = image.tobytes()
    return [sum(data[c::3]) / (image.width * image.height) for c in range(3)]


base, dim, bright = [rgb_mean(patch(f'brightness-{v}.png')) for v in (100, 50, 150)]
dim_ratio = sum(dim) / sum(base)
bright_ratio = sum(bright) / sum(base)
assert .47 < dim_ratio < .53, (base, dim)
assert 1.3 < bright_ratio < 1.55, (base, bright)
blue = rgb_mean(patch('blue-thirty.png'))
assert blue[0] < base[0] - 20 and blue[2] > base[2] + 10, (base, blue)
refracted, zero = patch('lens-bright-refracted.png'), patch('lens-bright-zero.png')
changed = colored = zero_colored = 0
for y in range(refracted.height):
    for x in range(refracted.width):
        a, b = refracted.getpixel((x, y)), zero.getpixel((x, y))
        changed += max(abs(a[c] - b[c]) for c in range(3)) > 15
        colored += max(a) - min(a) > 30
        zero_colored += max(b) - min(b) > 30
assert changed > 1000 and colored > 200 and zero_colored < 10, (changed, colored, zero_colored)
result = {'baselineRGB': base, 'dim50RGB': dim, 'bright150RGB': bright,
          'dimRatio': dim_ratio, 'brightRatio': bright_ratio, 'blue30RGB': blue,
          'lensAtBrightness125': {'changedPixels': changed, 'dispersedPixels': colored, 'zeroDispersedPixels': zero_colored},
          'verdict': 'PASS: real brightness/color pixels and retained native-input refraction/dispersion'}
(out / 'pixel-analysis.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps(result, indent=2))
