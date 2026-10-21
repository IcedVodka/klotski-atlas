import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createModel, describeMove, move } from '../public/engine.js';
import { GraphView } from '../public/graph.js';

const data = JSON.parse(fs.readFileSync(new URL('../public/graph.json', import.meta.url)));
const model = createModel(data);

// 使用真实图和真实更新逻辑，仅把 GPU 上传替换为记录器。
function viewFixture() {
  const view = Object.create(GraphView.prototype);
  Object.assign(view, {
    model,
    positions: model.positions.map((point) => [...point]),
    current: model.initial,
    options: { color: 'structure', solutions: true, path: true, local: false },
    maxDistance: Math.max(...model.distances),
    edges: model.nodes.flatMap((node, i) => node.neighbors.filter((j) => j > i).map((j) => [i, j])),
    uploads: [],
    upload(index, vertices) {
      this.uploads.push({ index, vertices });
    },
  });
  return view;
}

test('切换布局保留原始坐标、拓扑和最短距离，且不持有输入的可变引用', () => {
  const view = viewFixture();
  const original = structuredClone(model.positions);
  const candidate = original.map(([x, y, z]) => [z, y, -x]);
  const distances = model.distances.slice();
  const path = model.path(model.initial);
  view.setPositions(candidate);
  assert.deepEqual(model.positions, original);
  assert.deepEqual(model.distances, distances);
  assert.deepEqual(model.path(model.initial), path);
  assert.deepEqual(view.positions, candidate);
  candidate[0][0] = 999;
  assert.notEqual(view.positions[0][0], 999);
  assert.deepEqual(
    view.uploads.map((item) => item.index),
    [0, 1, 2],
  );
});

test('拒绝无效布局时保留当前视图', () => {
  const view = viewFixture();
  const positions = view.positions;
  for (const invalid of [null, [], positions.map(() => [NaN, 0, 0]), positions.map(() => null)]) {
    assert.throws(() => view.setPositions(invalid), /布局坐标不完整/);
    assert.equal(view.positions, positions);
  }
  assert.equal(view.uploads.length, 0);
});

test('全局视图移动只上传路径，八步局部视图移动会刷新边和解集', () => {
  const view = viewFixture();
  view.update(view.current, {}, true);
  view.uploads = [];
  const [start, next, following] = model.path(model.initial);
  view.update(next);
  assert.deepEqual(
    view.uploads.map((item) => item.index),
    [2],
  );
  assert.equal(view.neighborhood, undefined);
  view.uploads = [];
  view.update(next);
  assert.equal(view.uploads.length, 0);
  view.update(next, { local: true });
  assert.ok(view.neighborhood.has(start));
  assert.ok(view.neighborhood.has(next));
  assert.ok(view.neighborhood.size < model.nodes.length);
  view.uploads = [];
  view.update(following);
  assert.deepEqual(
    view.uploads.map((item) => item.index),
    [0, 1, 2],
  );
  view.uploads = [];
  view.update(following, { local: false });
  assert.deepEqual(
    view.uploads.map((item) => item.index),
    [0, 1],
  );
});

test('移动说明使用棋盘位移，覆盖四个方向并保留棋子身份', () => {
  const board = '..................a.';
  assert.equal(describeMove(board, move(board, 'a', -1, 0)), '小方块向左移动一格');
  assert.equal(describeMove(board, move(board, 'a', 1, 0)), '小方块向右移动一格');
  assert.equal(describeMove(board, move(board, 'a', 0, -1)), '小方块向上移动一格');
  const above = move(board, 'a', 0, -1);
  assert.equal(describeMove(above, board), '小方块向下移动一格');
  assert.equal(describeMove(board, board), '');
});
