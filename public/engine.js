export function pieces(board) {
  const map = new Map();
  [...board].forEach((id, i) => {
    if (id === '.') return;
    if (!map.has(id)) map.set(id, { id, x: 4, y: 5, right: 0, bottom: 0, cells: [] });
    const p = map.get(id), x = i % 4, y = Math.floor(i / 4);
    p.x = Math.min(p.x, x); p.y = Math.min(p.y, y);
    p.right = Math.max(p.right, x + 1); p.bottom = Math.max(p.bottom, y + 1); p.cells.push(i);
  });
  return [...map.values()].map(p => ({ ...p, w: p.right - p.x, h: p.bottom - p.y }));
}
export function canonical(board) {
  const ids = new Map(); let next = 0;
  return [...board].map(c => c === '.' ? '.' : (ids.has(c) ? ids.get(c) : (ids.set(c, String.fromCharCode(65 + next++)), ids.get(c)))).join('');
}
export function move(board, id, dx, dy) {
  if (Math.abs(dx) + Math.abs(dy) !== 1) return null;
  const p = pieces(board).find(p => p.id === id);
  if (!p || p.x + dx < 0 || p.y + dy < 0 || p.right + dx > 4 || p.bottom + dy > 5) return null;
  const shift = dx + dy * 4;
  if (p.cells.some(i => board[i + shift] !== '.' && board[i + shift] !== id)) return null;
  const result = [...board]; p.cells.forEach(i => result[i] = '.'); p.cells.forEach(i => result[i + shift] = id);
  return result.join('');
}
export function solved(board) { return pieces(board).some(p => p.w === 2 && p.h === 2 && p.x === 1 && p.y === 3); }
export function createModel(data) {
  const nodes = data.nodes;
  const index = new Map(nodes.map((n, i) => [canonical(n[0]), i]));
  const distances = new Int32Array(nodes.length).fill(-1), queue = [];
  nodes.forEach((n, i) => { if (solved(n[0])) { distances[i] = 0; queue.push(i); } });
  const solutionCount = queue.length;
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    for (const j of nodes[i][4]) if (distances[j] === -1) { distances[j] = distances[i] + 1; queue.push(j); }
  }
  function path(from) {
    const result = [from];
    while (distances[from] > 0) {
      from = nodes[from][4].find(j => distances[j] === distances[from] - 1);
      if (from === undefined) throw Error('路径数据不完整');
      result.push(from);
    }
    return result;
  }
  function boardForNeighbor(board, target) {
    for (const p of pieces(board)) for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const next = move(board, p.id, dx, dy);
      if (next && index.get(canonical(next)) === target) return next;
    }
    return null;
  }
  return { nodes, index, distances, solutionCount, path, boardForNeighbor, initial: index.get(canonical(data.initial)) };
}
