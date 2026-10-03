"""Plot exported coordinates; compute geometry diagnostics without changing them."""
import json
from pathlib import Path
import subprocess
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.collections import LineCollection
from matplotlib.font_manager import FontProperties
from generate_layout import ROOT, build_topology

data=json.loads((ROOT/'public/graph.json').read_text())
rebuilt=json.loads((ROOT/'public/layout-rebuilt.json').read_text())
nodes=data['nodes']
edges=np.array([(i,j) for i,n in enumerate(nodes) for j in n[4] if j>i])
order,_,_,mirrors=build_topology(data)
original_mirrors=np.empty(len(order),int);original_mirrors[order]=order[mirrors]
datasets=[('作者公开坐标',np.array([n[1:4] for n in nodes])),('本地重算 · 镜像约束',np.array(rebuilt['positions']))]
ablation=ROOT/'research/runs/layout-no-mirror.json'
if ablation.exists():datasets.append(('本地重算 · 无镜像约束',np.array(json.loads(ablation.read_text())['positions'])))
try:
    font=FontProperties(fname=subprocess.check_output(['fc-match','Noto Sans CJK SC','-f','%{file}'],text=True))
except (OSError,subprocess.CalledProcessError):
    font=FontProperties(family='sans-serif')
fig,axes=plt.subplots(2,len(datasets),figsize=(6*len(datasets),10),facecolor='#0c1020',squeeze=False)
metrics={}
for col,(name,xyz) in enumerate(datasets):
    reflected=xyz[original_mirrors].copy();reflected[:,0]*=-1
    lengths=np.linalg.norm(xyz[edges[:,0]]-xyz[edges[:,1]],axis=1)
    metrics[name]={'nodes':len(xyz),'edgeMedian':float(np.median(lengths)),'edgeP95':float(np.percentile(lengths,95)),'mirrorRmsNormalized':float(np.sqrt(np.mean((xyz-reflected)**2)))}
    for row,yaw in enumerate([0,np.pi/2]):
        xy=np.stack([xyz[:,0]*np.cos(yaw)+xyz[:,2]*np.sin(yaw),xyz[:,1]],axis=1)
        ax=axes[row,col]
        ax.add_collection(LineCollection(xy[edges],colors='#a6b9e8',linewidths=.25,alpha=.45));ax.autoscale();ax.set_aspect('equal');ax.invert_yaxis();ax.set_facecolor('#0c1020');ax.axis('off')
        ax.set_title(name+(' / 正面' if row==0 else ' / 侧面'),fontproperties=font,color='white',fontsize=14)
fig.tight_layout();fig.savefig(ROOT/'research/layout-comparison.png',dpi=140)
(ROOT/'research/layout-metrics.json').write_text(json.dumps(metrics,ensure_ascii=False,indent=2))
print(json.dumps(metrics,ensure_ascii=False,indent=2))
