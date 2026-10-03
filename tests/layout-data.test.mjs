import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createModel } from '../public/engine.js';
const raw=fs.readFileSync(new URL('../public/graph.json',import.meta.url));
const data=JSON.parse(raw);
const rebuilt=JSON.parse(fs.readFileSync(new URL('../public/layout-rebuilt.json',import.meta.url)));
test('重算坐标完整、有限，并匹配当前图版本',()=>{
  assert.equal(rebuilt.positions.length,data.nodes.length);
  assert.equal(rebuilt.metadata.sourceGraphSha256,crypto.createHash('sha256').update(raw).digest('hex'));
  for(const p of rebuilt.positions){assert.equal(p.length,3);assert.ok(p.every(v=>Number.isFinite(v)&&Math.abs(v)<=1.000001));}
});
test('替换全部坐标后，起点、解集、最短距离和路径不变',()=>{
  const before=createModel(data);
  const copy=structuredClone(data);
  copy.nodes.forEach((n,i)=>n.splice(1,3,...rebuilt.positions[i]));
  const after=createModel(copy);
  assert.equal(before.initial,after.initial);assert.equal(before.solutionCount,after.solutionCount);
  assert.deepEqual(before.distances,after.distances);
  assert.deepEqual(before.path(before.initial),after.path(after.initial));
});
