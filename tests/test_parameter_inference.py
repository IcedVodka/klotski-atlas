"""Validate forensic fields and historical-force ports against independent NumPy."""
import sys
from pathlib import Path
import unittest
import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from infer_layout_parameters import load_fields, force_fields
from generate_layout import load_kernel, simulate
from search_layout_parameters import align


def numpy_fields(p, adj, law):
    d = p[:,None,:]-p[None,:,:]
    r2 = np.sum(d*d,axis=2)
    if law==0:
        f = 1/(np.sqrt(np.maximum(r2,1e-30))*(10*(r2+1)+2))
    elif law==1:
        f = .5/(r2+.1)
    else:
        f = .0025/(r2+.1)**2
    np.fill_diagonal(f,0)
    repulsion = np.sum(d*f[:,:,None],axis=1)
    attraction = np.zeros_like(p)
    for i,js in enumerate(adj):
        for j in js:
            if j<0: break
            q = p[i]-p[j]
            r2 = q@q
            if law==0:
                t = .05*(r2+1)**3
                f = .2*(t-1)/(t+1)-.1
            elif law==1:
                f = .5*r2/(r2+1)
            else:
                f = 1/(r2+1)+r2-1
            attraction[i] -= q*f
    return repulsion,attraction


class ParameterInferenceTest(unittest.TestCase):
    def test_fields_and_cpu_law_integration(self):
        field_kernel, integration = load_fields(), load_kernel()
        rng = np.random.default_rng(3)
        p = rng.normal(size=(24,3))*2
        adj = np.array([[(i+1)%24,(i+1)%24,(i-1)%24] for i in range(24)],np.int32)
        sample = np.array([7,2,23,0],np.int32)
        for law in range(3):
            with self.subTest(law=law):
                r,a = numpy_fields(p*1.7,adj,law)
                actual = force_fields(field_kernel,p,sample,adj,1.7,law)
                np.testing.assert_allclose(actual[0],r[sample],rtol=1e-10,atol=1e-10)
                np.testing.assert_allclose(actual[1],a[sample],rtol=1e-10,atol=1e-10)
                pos = np.zeros((24,4),np.float32);pos[:,:3]=p*1.7
                vel = np.zeros_like(pos)
                expected_v = .7*r+1.3*a
                expected_v *= (.9*np.minimum(1,3/np.linalg.norm(expected_v,axis=1)))[:,None]
                simulate(integration,pos,vel,adj,np.full(24,-1,np.int32),1,
                         dimension=3,mirror=0,exact=True,repel=.7,attract=1.3,
                         decay=.9,speed_limit=3,law=law)
                np.testing.assert_allclose(vel[:,:3],expected_v,rtol=3e-5,atol=3e-6)
                np.testing.assert_allclose(pos[:,:3],p*1.7+expected_v,rtol=3e-5,atol=3e-6)

    def test_alignment_removes_only_global_similarity_transform(self):
        rng = np.random.default_rng(8)
        reference = rng.normal(size=(100,3))
        rotation,_ = np.linalg.qr(rng.normal(size=(3,3)))
        candidate = 4*reference@rotation + [7,3,-2]
        np.testing.assert_allclose(align(candidate,reference),reference,atol=1e-12)
        shuffled = candidate[rng.permutation(len(candidate))]
        self.assertGreater(np.linalg.norm(align(shuffled,reference)-reference),10)


if __name__=='__main__': unittest.main()
