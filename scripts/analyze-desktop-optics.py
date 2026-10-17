"""Measure optical changes in blank rows over a real captured native backdrop."""
import json
from pathlib import Path
from PIL import Image

root=Path(__file__).resolve().parents[1]/'reports'/'desktop-optics'
a=Image.open(root/'refracted.png').convert('RGB')
b=Image.open(root/'zero.png').convert('RGB')
assert a.size==b.size
w,h=a.size
region=json.loads((root/'blank-region.json').read_text(encoding='utf-8'))
top,bottom=region['top'],region['bottom']
assert 0<=top<bottom<=h
changed=colored=zero_colored=0
for y in range(top,bottom):
    for x in range(12,w-12):
        p=a.getpixel((x,y));q=b.getpixel((x,y))
        changed+=max(abs(p[c]-q[c]) for c in range(3))>15
        colored+=max(p)-min(p)>30
        zero_colored+=max(q)-min(q)>30
def dark_groups(im):
    hits=[x for x in range(12,w-12) if max(im.getpixel((x,(top+bottom)//2)))<140]
    groups=[]
    for x in hits:
        if not groups or x>groups[-1][-1]+1:groups.append([x])
        else:groups[-1].append(x)
    return [sum(g)/len(g) for g in groups]
straight=dark_groups(b);bent=dark_groups(a)
assert len(straight)==len(bent),(straight,bent)
offsets=[round(p-q,2) for p,q in zip(bent,straight)]
assert changed>1000,changed
assert colored>200 and zero_colored<10,(colored,zero_colored)
assert max(abs(v) for v in offsets)>=4,offsets
result={'region':'blank middle rows; text/progress/status excluded','changedPixels':changed,'dispersedPixels':colored,'zeroDispersedPixels':zero_colored,'stripeOffsetsPhysicalPx':offsets,'maxStripeOffsetPhysicalPx':max(abs(v) for v in offsets),'verdict':'PASS: native captured stripes are displaced and split by RGB'}
(root/'pixel-analysis.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps(result,indent=2))
