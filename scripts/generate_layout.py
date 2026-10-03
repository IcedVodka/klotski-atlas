"""Regenerate positions from topology only, using the author's release force laws.

Requires Python + NumPy, NVIDIA GPU and nvcc. No original XYZ is read for initialization.
"""
import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
RELEASE = '2c7d90dda292ea12245ed90115eb20002fbc3c26'


def canonical(board):
    ids = {}
    return ''.join('.' if c == '.' else ids.setdefault(c, chr(65 + len(ids))) for c in board)


def build_topology(data):
    """Deliberately access only board strings and adjacency, never source XYZ."""
    nodes = data['nodes']
    index = {canonical(n[0]): i for i, n in enumerate(nodes)}
    start = index[canonical(data['initial'])]
    order, parent, seen = [start], [-1], {start}
    for i in order:
        for j in nodes[i][4]:
            if j not in seen:
                seen.add(j)
                order.append(j)
                parent.append(i)
    if len(order) != len(nodes):
        raise ValueError('Expected one connected component')
    inverse = np.empty(len(order), np.int32)
    inverse[order] = np.arange(len(order))
    parent = np.array([-1] + [inverse[p] for p in parent[1:]], np.int32)
    degree = max(len(n[4]) for n in nodes)
    adjacency = np.full((len(nodes), degree), -1, np.int32)
    mirrors = np.full(len(nodes), -1, np.int32)
    for k, i in enumerate(order):
        adjacency[k, :len(nodes[i][4])] = [inverse[j] for j in nodes[i][4]]
        b = nodes[i][0]
        mirrored = ''.join(b[r:r+4][::-1] for r in range(0, 20, 4))
        j = index.get(canonical(mirrored))
        if j is not None:
            mirrors[k] = inverse[j]
    return np.array(order), parent, adjacency, mirrors


def load_kernel():
    directory = ROOT / 'research/runs'
    directory.mkdir(parents=True, exist_ok=True)
    library = directory / 'layout_kernel.so'
    source = ROOT / 'scripts/layout_kernel.cu'
    if not library.exists() or library.stat().st_mtime < source.stat().st_mtime:
        temporary = library.with_name(f'layout_kernel.{os.getpid()}.so')
        try:
            subprocess.run(['nvcc', '-O3', '-shared', '-Xcompiler', '-fPIC', str(source), '-o', str(temporary)], check=True)
            temporary.replace(library)
        finally:
            temporary.unlink(missing_ok=True)
    lib = ctypes.CDLL(str(library))
    func = lib.run_layout
    pointer = ctypes.c_void_p
    func.argtypes = [pointer]*4 + [ctypes.c_int]*3 + [ctypes.c_float]*5 + [ctypes.c_int, ctypes.c_char_p]
    func.restype = ctypes.c_int
    return func


def simulate(func, positions, velocities, adjacency, mirrors, steps, dimension=3.98, decay=.65, mirror=.003, exact=None):
    n = len(positions)
    error = ctypes.create_string_buffer(1024)
    arrays = [positions, velocities, adjacency, mirrors]
    assert all(a.flags.c_contiguous for a in arrays)
    result = func(*(a.ctypes.data for a in arrays), n, adjacency.shape[1], steps, 1., 1., decay, dimension, mirror, int(n < 5000 if exact is None else exact), error)
    if result:
        raise RuntimeError(error.value.decode())
    if not np.isfinite(positions).all() or not np.isfinite(velocities).all():
        raise ValueError('Non-finite simulation state')


def normalize(positions):
    xyz = positions[:, :3].astype(np.float64)
    xyz -= (xyz.min(axis=0) + xyz.max(axis=0)) / 2
    return xyz / max(np.abs(xyz).max(), 1e-9)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--seed', type=int, default=7)
    ap.add_argument('--growth-steps', type=int, default=80)
    ap.add_argument('--settle-steps', type=int, default=12000)
    ap.add_argument('--flat-steps', type=int, default=1000)
    ap.add_argument('--mirror-force', type=float, default=.003)
    ap.add_argument('--output', default='public/layout-rebuilt.json')
    args = ap.parse_args()
    if args.growth_steps < 1 or args.settle_steps < 0 or args.flat_steps < 0 or args.mirror_force < 0:
        ap.error('增长迭代需为正数，其余迭代数及镜像系数不能为负数')
    data = json.loads((ROOT / 'public/graph.json').read_text())
    order, parent, adjacency, mirrors = build_topology(data)
    n = len(order)
    rng = np.random.default_rng(args.seed)
    positions = np.zeros((n, 4), np.float32)
    velocities = np.zeros_like(positions)
    positions[0] = rng.uniform(-1, 1, 4)
    velocities[0] = rng.uniform(-1, 1, 4)
    func = load_kernel()
    begin = time.perf_counter()
    run_directory = ROOT / 'research/runs' / Path(args.output).stem
    run_directory.mkdir(parents=True, exist_ok=True)
    snapshots = []
    def snapshot(stage, count):
        # Keep research checkpoints outside public; release only final positions.
        np.savez_compressed(run_directory / f'{stage}.npz', positions=positions[:count], order=order[:count])
        snapshots.append({'stage':stage, 'nodes':count, 'seconds':round(time.perf_counter()-begin,2)})
        print(json.dumps(snapshots[-1]), flush=True)
    previous = 1
    for count in list(range(256, n, 1024)) + [n]:
        for i in range(previous, count):
            positions[i] = positions[parent[i]] + rng.uniform(-1, 1, 4)
            velocities[i] = velocities[parent[i]]
        simulate(func, positions[:count], velocities[:count], adjacency[:count], mirrors[:count], args.growth_steps, mirror=args.mirror_force)
        # Translation-invariant centering keeps the mirror plane at x=0.
        positions[:count] -= positions[:count].mean(axis=0)
        previous = count
        print(f'grow {count}/{n}', flush=True)
    snapshot('grown', n)
    for block in range(0, args.settle_steps, 250):
        simulate(func, positions, velocities, adjacency, mirrors, min(250,args.settle_steps-block), dimension=3.95, mirror=args.mirror_force)
        positions -= positions.mean(axis=0)
        print(f'settle {min(block+250,args.settle_steps)}/{args.settle_steps}', flush=True)
    snapshot('settled-4d', n)
    simulate(func, positions, velocities, adjacency, mirrors, args.flat_steps, dimension=3., mirror=args.mirror_force)
    snapshot('final-3d', n)
    coords = normalize(positions)[np.argsort(order)]
    lengths = []
    for i,node in enumerate(data['nodes']):
        for j in node[4]:
            if j > i:
                lengths.append(float(np.linalg.norm(coords[i]-coords[j])))
    mirror_diff = positions[mirrors].copy()
    mirror_diff[:,0] *= -1
    mirror_error = float(np.sqrt(np.mean((positions[:,:3]-mirror_diff[:,:3])**2)))
    metadata = {
        'algorithm':'2swap release force laws, refreshed uniform bins, double-buffered updates',
        'upstreamCommit':RELEASE, 'seed':args.seed, 'nodeCount':n,
        'initialization':'BFS parent + seeded random displacement; no input coordinates',
        'growthStepsPerBatch':args.growth_steps,'settleSteps':args.settle_steps,'flatSteps':args.flat_steps,
        'repel':1,'attract':1,'decay':.65,'mirrorForce':args.mirror_force,'dimensions':[3.98,3.95,3],
        'gridSize':10,'seconds':round(time.perf_counter()-begin,2),
        'edgeLengthMedian':float(np.median(lengths)), 'edgeLengthP95':float(np.percentile(lengths,95)),
        'mirrorRmsRaw':mirror_error, 'sourceGraphSha256':hashlib.sha256((ROOT/'public/graph.json').read_bytes()).hexdigest(),
        'checkpoints':snapshots,
    }
    result = {'metadata':metadata,'positions':np.round(coords,6).tolist()}
    output = ROOT / args.output
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(result,separators=(',',':')))
    print(json.dumps(metadata,indent=2))


if __name__ == '__main__':
    main()
