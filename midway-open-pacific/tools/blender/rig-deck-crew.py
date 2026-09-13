"""Rebuild Midway's sailor through the reusable, measured humanoid pipeline.

blender -b -P tools/blender/rig-deck-crew.py -- <UAL1.glb> <UAL2.glb> <original.glb> <out.glb>
"""
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).parent))
from rig_humanoid import main as rig_humanoid


def main(ual1, ual2, model, out):
    measurements = json.loads(Path(__file__).with_name('navy-sailor.json').read_text())
    rig_humanoid(ual1, ual2, model, out, measurements)


if __name__ == '__main__':
    main(*sys.argv[sys.argv.index('--') + 1:])
