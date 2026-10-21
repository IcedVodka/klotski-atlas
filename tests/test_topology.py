"""CPU-only topology checks; no NVIDIA GPU or CUDA toolkit required."""
import copy
import json
from pathlib import Path
import sys
import unittest
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from generate_layout import ROOT, build_topology


class TopologyTest(unittest.TestCase):
    def test_topology_does_not_depend_on_original_coordinates(self):
        data=json.loads((ROOT/'public/graph.json').read_text())
        first=build_topology(data)
        poisoned=copy.deepcopy(data)
        for n in poisoned['nodes']:
            n[1:4]=[None, None, None]
        second=build_topology(poisoned)
        for a,b in zip(first,second):
            np.testing.assert_array_equal(a,b)
        order,parent,adj,mirrors=first
        self.assertEqual(len(order),25955)
        self.assertTrue(np.all(mirrors>=0))
        np.testing.assert_array_equal(mirrors[mirrors],np.arange(len(order)))
        self.assertTrue(all(p<i for i,p in enumerate(parent)))


if __name__ == '__main__':
    unittest.main()
