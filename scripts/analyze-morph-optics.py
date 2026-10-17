"""Summarize native-window morph traces; these are not display-FPS claims."""
import json
from pathlib import Path

out = Path('reports/approval-morph')
result = {}
for label in ('before', 'after'):
    rows = json.loads((out / f'morph-{label}.json').read_text(encoding='utf-8'))
    summaries = []
    for row in rows:
        samples = row['samples']
        growing = [s for s in samples if s['height'] > 70 and s['mode'] == 'expanding']
        matched = [s for s in samples if s['height'] > 70 and s['visible'] and s['passes'] == 3
                   and abs(s['mapWidth'] - s['width']) <= 2 and abs(s['mapHeight'] - s['height']) <= 2]
        summary = {'action': row['action'], 'firstSizedRGBms': matched[0]['t'] if matched else None,
                   'morphEndMs': row['end'], 'blankSamples': sum(not s['visible'] for s in samples),
                   'growingRGBFraction': sum(s['passes'] == 3 for s in growing) / max(1, len(growing)),
                   'growingVisibleFraction': sum(s['visible'] for s in growing) / max(1, len(growing))}
        if label == 'after':
            assert summary['growingRGBFraction'] == summary['growingVisibleFraction'] == 1
            assert summary['firstSizedRGBms'] < summary['morphEndMs'] - 100
        summaries.append(summary)
    result[label] = summaries
(out / 'morph-comparison.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps(result, indent=2))
