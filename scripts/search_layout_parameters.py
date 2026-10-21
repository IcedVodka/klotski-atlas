"""Bounded reconstruction experiments, aligned by board identity (no XYZ warm start)."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

import numpy as np
from generate_layout import ROOT

PROFILES = {
    'release-seed1': ['--seed','1'],
    'release-3d': ['--growth-dimension','3','--settle-dimension','3'],
    'release-long': ['--settle-steps','60000','--flat-steps','5000'],
    'release-decay92': ['--decay','.92'],
    'cpu-sqrty': ['--force-law','cpu-2024-sqrty','--decay','.9','--speed-limit','3','--growth-dimension','3','--settle-dimension','3'],
    'cpu-quartic': ['--force-law','cpu-2024-quartic','--decay','.9','--speed-limit','3','--growth-dimension','3','--settle-dimension','3'],
}


def align(candidate, reference):
    """Least-squares uniform scale + orthogonal transform, including reflection."""
    x = candidate - candidate.mean(0)
    y = reference - reference.mean(0)
    u, singular, vt = np.linalg.svd(x.T@y)
    scale = singular.sum()/np.sum(x*x)
    return x@(u@vt)*scale + reference.mean(0)


def diagnostics(candidate, reference, edges, pairs):
    aligned = align(candidate,reference)
    y = reference-reference.mean(0)
    a = np.linalg.norm(candidate[edges[:,0]]-candidate[edges[:,1]],axis=1)
    b = np.linalg.norm(reference[edges[:,0]]-reference[edges[:,1]],axis=1)
    pd = lambda p: np.linalg.norm(p[pairs[:,0]]-p[pairs[:,1]],axis=1)
    return dict(procrustesNrmse=float(np.linalg.norm(aligned-reference)/np.linalg.norm(y)),
                edgeLengthCorrelation=float(np.corrcoef(a,b)[0,1]),
                pairDistanceCorrelation=float(np.corrcoef(pd(candidate),pd(reference))[0,1]))


def plot_comparison(datasets, reference, edges, output):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib.collections import LineCollection
    from matplotlib.font_manager import FontProperties
    font = FontProperties(fname=subprocess.check_output(['fc-match','Noto Sans CJK SC','-f','%{file}'],text=True))
    fig, axes = plt.subplots(2,len(datasets),figsize=(5*len(datasets),8),squeeze=False)
    limits = [(reference[:,c].min()-.05, reference[:,c].max()+.05) for c in range(3)]
    for col,(name,xyz) in enumerate(datasets):
        xyz = align(xyz,reference)
        for row,coords in enumerate([(0,1),(2,1)]):
            ax = axes[row,col]
            xy = xyz[:,coords]
            ax.add_collection(LineCollection(xy[edges],linewidths=.25,colors='#26395b',alpha=.45))
            ax.set_xlim(limits[coords[0]]);ax.set_ylim(limits[coords[1]][::-1]);ax.set_aspect('equal');ax.axis('off')
            ax.set_title(name+(' / 正面' if row==0 else ' / 侧面'),fontproperties=font)
    fig.suptitle('按同一局面对齐 · 已消除整体平移、旋转／反射和统一缩放的差异',fontproperties=font)
    fig.tight_layout();fig.savefig(output,dpi=150);plt.close(fig)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--profiles',nargs='+',choices=PROFILES,default=list(PROFILES))
    ap.add_argument('--reuse',action='store_true',help='Reuse completed experiment JSON files')
    args = ap.parse_args()
    directory = ROOT/'research/runs/parameter-search'
    directory.mkdir(parents=True,exist_ok=True)
    graph = json.loads((ROOT/'public/graph.json').read_text())
    reference = np.array([n[1:4] for n in graph['nodes']])
    edges = np.array([(i,j) for i,n in enumerate(graph['nodes']) for j in n[4] if j>i])
    pairs = np.random.default_rng(20261012).integers(0,len(reference),size=(100000,2))
    baseline = np.array(json.loads((ROOT/'public/layout-rebuilt.json').read_text())['positions'])
    results = [dict(profile='previous-baseline',**diagnostics(baseline,reference,edges,pairs))]
    datasets = {'previous-baseline':baseline}
    for name in args.profiles:
        path = directory/f'{name}.json'
        command = [sys.executable,str(ROOT/'scripts/generate_layout.py'),*PROFILES[name],'--output',str(path)]
        if not (args.reuse and path.exists()):
            print(f'Running {name}',flush=True)
            with (directory/f'{name}.log').open('w') as log:
                subprocess.run(command,cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,check=True)
        result = json.loads(path.read_text())
        xyz = np.array(result['positions'])
        if xyz.shape!=reference.shape or not np.isfinite(xyz).all():
            raise ValueError(f'Invalid coordinates for {name}')
        if result['metadata']['sourceGraphSha256'] != hashlib.sha256((ROOT/'public/graph.json').read_bytes()).hexdigest():
            raise ValueError(f'Stale topology for {name}')
        datasets[name]=xyz
        row = dict(profile=name,arguments=PROFILES[name],metadata=result['metadata'],**diagnostics(xyz,reference,edges,pairs))
        results.append(row)
        print(json.dumps({k:v for k,v in row.items() if k!='metadata'}),flush=True)
        (ROOT/'research/parameter-search.json').write_text(json.dumps(results,indent=2)+'\n')
    best = min(results,key=lambda x:x['procrustesNrmse'])['profile']
    selected = [('作者公开坐标',reference),('原有重算',baseline),(f'本轮最佳：{best}',datasets[best])]
    plot_comparison(selected,reference,edges,ROOT/'research/parameter-search.png')
    # Save best NEW experiment as a separate reviewable asset; do not replace the UI default.
    best_new = min(results[1:],key=lambda x:x['procrustesNrmse'])['profile']
    source = directory/f'{best_new}.json'
    target = ROOT/'public/layout-candidate.json'
    target.write_bytes(source.read_bytes())
    print(f'Best overall: {best}; best new candidate: {best_new}',flush=True)


if __name__=='__main__': main()
