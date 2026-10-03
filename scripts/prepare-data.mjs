// Upstream dataset is trusted project data; parsing never executes its JavaScript.
import { readFileSync, writeFileSync } from 'node:fs';
const source = readFileSync(process.argv[2], 'utf8');
const raw = JSON.parse(source.slice(source.indexOf('{'), source.indexOf('\n}\n') + 2));
const names = Object.keys(raw), indices = new Map(names.map((k, i) => [k, i]));
const nodes = names.map(k => raw[k]);
const center = ['x', 'y', 'z'].map(k => (Math.min(...nodes.map(n => n[k])) + Math.max(...nodes.map(n => n[k]))) / 2);
const scale = Math.max(...nodes.flatMap(n => ['x', 'y', 'z'].map((k, i) => Math.abs(n[k] - center[i]))));
const initial = source.match(/var board_string = "([^"]+)"/)[1];
const output = {
  source: 'https://github.com/2swap/Klotski-Webpage',
  initial,
  nodes: nodes.map(n => [n.representation, ...['x','y','z'].map((k,i) => +( (n[k]-center[i])/scale ).toFixed(6)), [...new Set(n.neighbors.map(k => indices.get(k)))], n.solution_dist, n.dist])
};
writeFileSync('public/graph.json', JSON.stringify(output));
console.log(`Prepared ${nodes.length} states.`);
