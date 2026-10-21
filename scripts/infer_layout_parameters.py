"""Test historical force laws against published coordinates; NOT seed recovery.

Fits scale and repel/attract ratio under a 3D, stationary, zero-gravity hypothesis.
Held-out nodes diagnose that hypothesis. Damping, iteration history and initial
conditions cannot be identified from a single position snapshot.
"""
import argparse
import ctypes
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.request

import numpy as np
from scipy.optimize import minimize_scalar
from generate_layout import ROOT, canonical

DATA_COMMIT = '069d99b393eb06c37402598393806d84a41813ae'
DATA_URL = f'https://raw.githubusercontent.com/2swap/Klotski-Webpage/{DATA_COMMIT}/data.json'
LAWS = ['release-2025', 'cpu-2024-sqrty', 'cpu-2024-quartic']


def load_fields():
    source = ROOT / 'scripts/layout_forensics.cu'
    library = ROOT / 'research/runs/layout_forensics.so'
    library.parent.mkdir(parents=True, exist_ok=True)
    if not library.exists() or source.stat().st_mtime > library.stat().st_mtime:
        subprocess.run(['nvcc', '-O3', '-shared', '-Xcompiler', '-fPIC', str(source), '-o', str(library)], check=True)
    func = ctypes.CDLL(str(library)).force_fields
    func.argtypes = [ctypes.c_void_p]*3 + [ctypes.c_int]*3 + [ctypes.c_double, ctypes.c_int, ctypes.c_void_p]
    func.restype = ctypes.c_int
    return func


def force_fields(func, xyz, sample, adjacency, scale, law):
    xyz = np.ascontiguousarray(xyz, dtype=np.float64)
    sample = np.ascontiguousarray(sample, dtype=np.int32)
    adjacency = np.ascontiguousarray(adjacency, dtype=np.int32)
    out = np.empty((len(sample), 6), np.float64)
    status = func(xyz.ctypes.data, sample.ctypes.data, adjacency.ctypes.data,
                  len(xyz), len(sample), adjacency.shape[1], scale, law, out.ctypes.data)
    if status or not np.isfinite(out).all():
        raise RuntimeError('Force-field CUDA evaluation failed')
    return out[:, :3], out[:, 3:]


def ratio_and_residual(r, a, ratio=None):
    if ratio is None:
        ratio = max(0., float(-np.sum(r*a)/np.sum(r*r)))
    residual = float(np.linalg.norm(ratio*r+a)/max(np.linalg.norm(a), 1e-30))
    return ratio, residual


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--samples', type=int, default=2048)
    ap.add_argument('--raw-data', type=Path, default=ROOT/'research/upstream/web-data.json')
    ap.add_argument('--output', type=Path, default=ROOT/'research/parameter-inference.json')
    ap.add_argument('--control', type=Path, help='Optional final-3d.npz from a release-law run, as a positive control')
    args = ap.parse_args()
    if not args.raw_data.exists():
        args.raw_data.parent.mkdir(parents=True, exist_ok=True)
        args.raw_data.write_bytes(urllib.request.urlopen(DATA_URL, timeout=60).read())
    raw_text = args.raw_data.read_text()
    raw = json.JSONDecoder().raw_decode(raw_text[raw_text.index('{'):])[0]
    names = list(raw)
    index = {k:i for i,k in enumerate(names)}
    xyz = np.array([[n[c] for c in 'xyz'] for n in raw.values()])
    # Verify state alignment with application data; do not silently compare wrong nodes.
    data = json.loads((ROOT/'public/graph.json').read_text())
    assert [canonical(n['representation']) for n in raw.values()] == [canonical(n[0]) for n in data['nodes']]
    n = len(xyz)
    if not 4 <= args.samples <= n:
        ap.error('--samples must be between 4 and the node count')
    sample = np.random.default_rng(20261012).choice(n, args.samples, replace=False).astype(np.int32)
    cut = len(sample)//2
    func = load_fields()
    results = []
    control = None
    for duplicates in [False, True]:
        neighbors = [[index[j] for j in (node['neighbors'] if duplicates else dict.fromkeys(node['neighbors']))] for node in raw.values()]
        adjacency = np.full((n,max(map(len,neighbors))), -1, np.int32)
        for i, js in enumerate(neighbors): adjacency[i,:len(js)] = js
        if not duplicates and args.control:
            checkpoint = np.load(args.control)
            assert np.array_equal(np.sort(checkpoint['order']), np.arange(n))
            control_xyz = checkpoint['positions'][np.argsort(checkpoint['order']),:3]
            r,a = force_fields(func,control_xyz,sample,adjacency,1.,0)
            ratio,train = ratio_and_residual(r[:cut],a[:cut])
            _,test = ratio_and_residual(r[cut:],a[cut:],ratio)
            control = dict(path=str(args.control),sha256=hashlib.sha256(args.control.read_bytes()).hexdigest(),
                           law=LAWS[0],scale=1.,repelAttractRatio=ratio,trainResidual=train,testResidual=test)
        for law, name in enumerate(LAWS):
            cache = {}
            def evaluate(log_scale):
                scale = float(10**log_scale)
                if scale not in cache:
                    r,a = force_fields(func, xyz, sample, adjacency, scale, law)
                    ratio, train = ratio_and_residual(r[:cut],a[:cut])
                    _, test = ratio_and_residual(r[cut:],a[cut:],ratio)
                    cache[scale] = dict(scale=scale,repelAttractRatio=ratio,trainResidual=train,testResidual=test)
                return cache[scale]
            grid = np.linspace(-5,1,25)
            scores = [evaluate(x)['trainResidual'] for x in grid]
            best = int(np.argmin(scores))
            low, high = grid[max(0,best-1)], grid[min(len(grid)-1,best+1)]
            fit = minimize_scalar(lambda x:evaluate(x)['trainResidual'],bounds=(low,high),method='bounded',options={'xatol':.005})
            result = {'law':name,'duplicateNeighbors':duplicates,**evaluate(fit.x),
                      'atRawScale':evaluate(0), 'coarseGrid':[evaluate(x) for x in grid],
                      'scaleSearchBoundary':best in [0,len(grid)-1]}
            results.append(result)
            print(json.dumps({k:v for k,v in result.items() if k not in ['coarseGrid','atRawScale']}),flush=True)
    report = dict(dataUrl=DATA_URL,rawSha256=hashlib.sha256(args.raw_data.read_bytes()).hexdigest(),
                  nodeCount=n,sampleSeed=20261012,trainingNodes=cut,heldOutNodes=len(sample)-cut,
                  hypothesis='3D stationary force balance, w=0; no gravity or hard projection',
                  residualDefinition='norm(ratio*repulsion + attraction) / norm(attraction)',
                  warning='Best fit is conditional evidence, not the original generation parameters. Damping, seed, time schedule and hidden w are unidentifiable here.',
                  positiveControl=control,results=results)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')


if __name__=='__main__': main()
