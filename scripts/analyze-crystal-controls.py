"""Compare native stripes transmitted through plates against opaque controls."""
from pathlib import Path
from PIL import Image
import json, statistics
root=Path(__file__).resolve().parents[1]/'reports'/'crystal-controls'
results=[]
for record in json.loads((root/'geometry.json').read_text(encoding='utf-8')):
    tone=record['tone']
    crystal=Image.open(root/f'{tone}-crystal.png').convert('RGB')
    opaque=Image.open(root/f'{tone}-opaque-control.png').convert('RGB')
    for index,b in enumerate(record['buttons']):
        # Bottom inner strip avoids labels, border, corner rounding and shadow.
        y=round(b['y']+b['height']-9)
        left,right=round(b['x']+18),round(b['x']+b['width']-18)
        def variation(im):
            return statistics.pstdev([sum(im.getpixel((x,y)))/3 for x in range(left,right)])
        measured,control=variation(crystal),variation(opaque)
        assert measured>control+3,(tone,index,measured,control)
        levels=[sum(crystal.getpixel((x,y)))/3 for x in range(left,right)]
        sharpness=max(abs(a-b) for a,b in zip(levels,levels[1:]))
        assert sharpness>(10 if tone=='light' else 5),(tone,index,sharpness)
        results.append({'tone':tone,'button':index,'transmittedStripeStdDev':round(measured,2),'opaqueStdDev':round(control,2),'maxAdjacentStripeDelta':round(sharpness,2)})
(root/'pixel-analysis.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
print(json.dumps(results,indent=2))
