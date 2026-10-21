"""CPU reference checks for the release force laws and the CUDA port."""
from pathlib import Path
import sys
import unittest
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from generate_layout import load_kernel, simulate


def reference_step(p, v, adj, mirrors, dimension, mirror, binned=False):
    p, v = p.astype(float), v.astype(float)
    bins = np.minimum(9, np.maximum(0, ((p[:,:3]-p[:,:3].min(0))/np.maximum(np.ptp(p[:,:3],axis=0),1e-6)*10).astype(int)))
    groups = {}
    for i, b in enumerate(bins):
        groups.setdefault(tuple(b), []).append(i)
    force = np.zeros_like(p)
    for i in range(len(p)):
        groups_to_use = []
        if binned:
            for b, ids in groups.items():
                if np.max(np.abs(np.array(b)-bins[i])) <= 1:
                    groups_to_use.extend((p[j], 1) for j in ids if j != i)
                else:
                    groups_to_use.append((p[ids].mean(0), len(ids)))
        else:
            groups_to_use = [(p[j], 1) for j in range(len(p)) if j != i]
        for q, mass in groups_to_use:
            diff = p[i] - q
            norm = np.linalg.norm(diff)
            if norm > 1e-8:
                force[i] += mass*diff/norm/(10*(norm*norm+1)+2)
        for j in adj[i]:
            if j < 0:
                break
            diff = p[i]-p[j]
            t = .05*(np.dot(diff,diff)+1)**3
            force[i] -= diff*(.2*(t-1)/(t+1)-.1)
    v += force
    speed = np.linalg.norm(v,axis=1)
    v *= (np.minimum(1,20/np.maximum(speed,1e-12))*.65)[:,None]
    out = p.copy()
    for i,j in enumerate(mirrors):
        if mirror>.001 and j>=0 and j!=i:
            target=p[j].copy(); target[0]*=-1
            out[i,:3] += mirror*(target[:3]-p[i,:3])
    out += v
    out[:,2] *= np.clip(dimension-2,0,1)
    out[:,3] *= np.clip(dimension-3,0,1)
    return out,v


class LayoutTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.func = staticmethod(load_kernel())

    def test_gpu_matches_independent_cpu_reference(self):
        for binned in [False,True]:
            with self.subTest(binned=binned):
                rng=np.random.default_rng(12)
                p=rng.normal(size=(80,4)).astype(np.float32)*3
                v=rng.normal(size=(80,4)).astype(np.float32)*.1
                adj=np.array([[(i-1)%80,(i+1)%80] for i in range(80)],np.int32)
                mirrors=np.arange(79,-1,-1,dtype=np.int32)
                expected,ev=reference_step(p,v,adj,mirrors,3.95,.003,binned)
                simulate(self.func,p,v,adj,mirrors,1,dimension=3.95,exact=not binned)
                np.testing.assert_allclose(p,expected,rtol=3e-5,atol=3e-6)
                np.testing.assert_allclose(v,ev,rtol=3e-5,atol=3e-6)

    def test_projection_and_coincident_points_remain_finite(self):
        p=np.zeros((2,4),np.float32);v=np.zeros_like(p)
        adj=np.array([[1],[0]],np.int32);mirrors=np.array([1,0],np.int32)
        simulate(self.func,p,v,adj,mirrors,3,dimension=3,exact=True)
        self.assertTrue(np.isfinite(p).all());self.assertTrue(np.all(p[:,3]==0))


if __name__=='__main__':
    unittest.main()
