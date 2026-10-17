"""Compare only the validated, fixture-owned flat patch with and without tint."""
import json
from pathlib import Path
from PIL import Image

out = Path('reports/smoked-glass')
metadata = json.loads((out / 'acceptance.json').read_text(encoding='utf-8'))
region = metadata['region']
box = tuple(region[k] for k in ('left', 'top', 'right', 'bottom'))


def brightness(filename):
    with Image.open(out / filename) as image:
        patch = image.convert('RGB').crop(box)
        return sum(patch.tobytes()), patch.width * patch.height


tinted, pixels = brightness('black-ten-percent.png')
control, control_pixels = brightness('no-tint-control.png')
assert pixels == control_pixels and pixels > 0 and control > 0
ratio = tinted / control
assert .89 < ratio < .91, f'Expected about 90% background brightness, got {ratio}'
assert metadata['fill'] == 'rgba(0, 0, 0, 0.1)'
assert metadata['textOpacity'] == metadata['rootOpacity'] == '1'
assert metadata['filter'] == 'none'
result = {'tintOpacity': .10, 'region': region, 'pixelCount': pixels,
          'brightnessRatio': ratio, 'textOpacity': metadata['textOpacity'],
          'rootOpacity': metadata['rootOpacity'], 'noAddedBackdropBlur': True}
(out / 'pixel-analysis.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps(result))
