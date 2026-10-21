// 棋盘为按行排列的 20 个字符；相同字符属于同一棋子，'.' 表示空格。
export const BOARD_WIDTH = 4;
export const BOARD_HEIGHT = 5;
export const DIRECTIONS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function pieces(board) {
  const map = new Map();
  [...board].forEach((id, i) => {
    if (id === '.') return;
    if (!map.has(id))
      map.set(id, { id, x: BOARD_WIDTH, y: BOARD_HEIGHT, right: 0, bottom: 0, cells: [] });
    const piece = map.get(id);
    const x = i % BOARD_WIDTH;
    const y = Math.floor(i / BOARD_WIDTH);
    piece.x = Math.min(piece.x, x);
    piece.y = Math.min(piece.y, y);
    piece.right = Math.max(piece.right, x + 1);
    piece.bottom = Math.max(piece.bottom, y + 1);
    piece.cells.push(i);
  });
  return [...map.values()].map((piece) => ({
    ...piece,
    w: piece.right - piece.x,
    h: piece.bottom - piece.y,
  }));
}

// 按首次出现的顺序重新命名，消除棋子 ID 的差异，保留形状和占格关系。
export function canonical(board) {
  const ids = new Map();
  return [...board]
    .map((id) => {
      if (id === '.') return '.';
      if (!ids.has(id)) ids.set(id, String.fromCharCode(65 + ids.size));
      return ids.get(id);
    })
    .join('');
}

export function move(board, id, dx, dy) {
  if (Math.abs(dx) + Math.abs(dy) !== 1) return null;
  const piece = pieces(board).find((piece) => piece.id === id);
  if (
    !piece ||
    piece.x + dx < 0 ||
    piece.y + dy < 0 ||
    piece.right + dx > BOARD_WIDTH ||
    piece.bottom + dy > BOARD_HEIGHT
  )
    return null;
  const shift = dx + dy * BOARD_WIDTH;
  if (piece.cells.some((i) => board[i + shift] !== '.' && board[i + shift] !== id)) return null;
  const result = [...board];
  piece.cells.forEach((i) => (result[i] = '.'));
  piece.cells.forEach((i) => (result[i + shift] = id));
  return result.join('');
}

export function solved(board) {
  return pieces(board).some(
    (piece) => piece.w === 2 && piece.h === 2 && piece.x === 1 && piece.y === 3,
  );
}

// 只用于保留棋子身份的相邻棋盘；跳转节点时不推断移动。
export function describeMove(before, after) {
  const nextPieces = new Map(pieces(after).map((piece) => [piece.id, piece]));
  for (const piece of pieces(before)) {
    const next = nextPieces.get(piece.id);
    if (!next || (next.x === piece.x && next.y === piece.y)) continue;
    const name =
      piece.w === 2 && piece.h === 2
        ? '目标块'
        : piece.w === 2
          ? '横条'
          : piece.h === 2
            ? '竖条'
            : '小方块';
    const direction =
      next.x > piece.x ? '右' : next.x < piece.x ? '左' : next.y > piece.y ? '下' : '上';
    return `${name}向${direction}移动一格`;
  }
  return '';
}

export function createModel(data) {
  // 紧凑传输格式只在入口解包。算法使用有名字的字段，不读取 xyz。
  const nodes = data.nodes.map((row) => ({ board: row[0], neighbors: [...row[4]] }));
  const positions = data.nodes.map((row) => row.slice(1, 4));
  const index = new Map(nodes.map((node, i) => [canonical(node.board), i]));
  const distances = new Int32Array(nodes.length).fill(-1);
  const queue = [];
  nodes.forEach((node, i) => {
    if (solved(node.board)) {
      distances[i] = 0;
      queue.push(i);
    }
  });
  const solutionCount = queue.length;
  // 多源 BFS：同时从所有出口局面出发，一次得到每个局面距最近解的步数。
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    for (const j of nodes[i].neighbors) {
      if (distances[j] !== -1) continue;
      distances[j] = distances[i] + 1;
      queue.push(j);
    }
  }
  function path(from) {
    const result = [from];
    while (distances[from] > 0) {
      from = nodes[from].neighbors.find((j) => distances[j] === distances[from] - 1);
      if (from === undefined) throw Error('路径数据不完整');
      result.push(from);
    }
    return result;
  }
  function boardForNeighbor(board, target) {
    // 保留屏幕上棋子的身份，避免使用规范化字符串导致颜色跳变。
    for (const piece of pieces(board)) {
      for (const [dx, dy] of DIRECTIONS) {
        const next = move(board, piece.id, dx, dy);
        if (next && index.get(canonical(next)) === target) return next;
      }
    }
    return null;
  }
  return {
    nodes,
    positions,
    index,
    distances,
    solutionCount,
    path,
    boardForNeighbor,
    initial: index.get(canonical(data.initial)),
  };
}
