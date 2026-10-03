import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { canonical, pieces, move, solved, createModel } from '../public/engine.js';
const data=JSON.parse(fs.readFileSync(new URL('../public/graph.json',import.meta.url)));
const m=createModel(data);
test('所有节点唯一，起点、解集和最短解可复现',()=>{
  assert.equal(m.nodes.length,25955);assert.equal(m.index.size,25955);assert.equal(m.solutionCount,964);assert.equal(m.distances[m.initial],112);
  let board=data.initial;
  for(const target of m.path(m.initial).slice(1)){
    board=m.boardForNeighbor(board,target);assert.ok(board,'路径的每一步都必须是合法单格移动');
  }
  assert.ok(solved(board));
});
test('整个图的边与独立棋盘规则一致，无遗漏、越界或错误连接',()=>{
  m.nodes.forEach((n,i)=>{
    const board=n[0],ps=pieces(board);assert.equal(board.length,20);assert.equal([...board].filter(c=>c==='.').length,2);
    const expected=new Set();
    for(const p of ps){
      assert.equal(p.cells.length,p.w*p.h,'棋子必须是矩形');
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
        const next=move(board,p.id,dx,dy);if(!next)continue;
        const j=m.index.get(canonical(next));assert.notEqual(j,undefined,'合法局面必须存在于数据中');expected.add(j);
      }
    }
    assert.deepEqual(new Set(n[4]),expected,`节点 ${i} 的所有邻边必须与合法移动完全匹配`);
    for(const j of n[4]){assert.ok(m.nodes[j][4].includes(i));assert.ok(Math.abs(m.distances[i]-m.distances[j])<=1);}
  });
});
test('移动拒绝越界、斜移、碰撞，棋子身份变化不影响局面键',()=>{
  assert.equal(move(data.initial,'b',0,-1),null);assert.equal(move(data.initial,'b',1,0),null);assert.equal(move(data.initial,'b',1,1),null);
  const renamed=[...data.initial].map(c=>c==='.'?'.':String.fromCharCode(c.charCodeAt(0)+10)).join('');assert.equal(canonical(renamed),canonical(data.initial));
});
