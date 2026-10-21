import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
const manifest = JSON.parse(
  fs.readFileSync(new URL('../docs/data-manifest.json', import.meta.url)),
);
test('发布数据与来源清单的 SHA-256、大小和拓扑统计一致', () => {
  for (const [name, expected] of Object.entries(manifest.files)) {
    const bytes = fs.readFileSync(new URL(`../${name}`, import.meta.url));
    assert.equal(bytes.length, expected.bytes, name);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.sha256, name);
  }
  const graph = JSON.parse(fs.readFileSync(new URL('../public/graph.json', import.meta.url)));
  assert.equal(graph.nodes.length, manifest.graph.nodes);
  assert.equal(
    graph.nodes.reduce((sum, node) => sum + node[4].length, 0) / 2,
    manifest.graph.undirectedEdges,
  );
  assert.equal(graph.initial, manifest.graph.initial);
});
