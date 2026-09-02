#!/usr/bin/env python3
"""Dumps the reference ITA for every test image, for port verification.

    python scripts/dump-ita-reference.py [out.json]

WHY THIS EXISTS

server/skin-tone.ts is a port of the ITA estimator in
measure-skin-tone-performance.py, so that production submissions can be binned
the same way the test set was. If the two implementations disagree even
slightly, production bins stop being comparable to the published per-bin
sensitivities while still looking comparable — which is worse than not
measuring at all.

This writes what the reference implementation says, so
scripts/verify-skin-tone-port.mjs can check the port against it on real images
rather than on three synthetic patches.

Deliberately imports the estimator from the measurement script rather than
copying it: a verification that compares a copy against a copy verifies nothing.
"""
import importlib.util
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEST_DIR = os.path.join(ROOT, 'dataset', 'dataset', 'data', 'test')
DEFAULT_OUT = os.path.join(ROOT, 'dataset', 'data', 'ita_reference.json')

spec = importlib.util.spec_from_file_location(
    'tone_ref', os.path.join(ROOT, 'scripts', 'measure-skin-tone-performance.py')
)
tone_ref = importlib.util.module_from_spec(spec)
# The module runs main() only under __main__, so importing it is side-effect free.
spec.loader.exec_module(tone_ref)

from PIL import Image  # noqa: E402


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUT
    results = {}

    for cls in ('benign', 'malignant'):
        directory = os.path.join(TEST_DIR, cls)
        if not os.path.isdir(directory):
            print(f'missing {directory}', file=sys.stderr)
            continue
        names = sorted(
            f for f in os.listdir(directory)
            if f.lower().endswith(('.jpg', '.jpeg', '.png'))
        )
        for name in names:
            path = os.path.join(directory, name)
            try:
                ita = tone_ref.estimate_ita(Image.open(path))
            except Exception as exc:  # noqa: BLE001
                print(f'  {name}: {exc}', file=sys.stderr)
                continue
            results[f'{cls}/{name}'] = {
                'ita': None if ita is None else round(float(ita), 6),
                'bin': None if ita is None else tone_ref.tone_bin(ita),
            }

    with open(out_path, 'w') as f:
        json.dump(results, f, indent=1)
        f.write('\n')

    estimated = sum(1 for v in results.values() if v['ita'] is not None)
    print(f'Wrote {out_path}: {len(results)} images, {estimated} with an ITA estimate',
          file=sys.stderr)


if __name__ == '__main__':
    main()
