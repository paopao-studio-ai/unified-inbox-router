// Checks every node in the demo workflows against the installed n8n-nodes-base package:
// type exists and typeVersion is one the node actually supports; connections point at real nodes.
// Usage: N8N_NODES_BASE=/path/to/node_modules/n8n-nodes-base node test/validate_nodes.js [workflow.json ...]
const fs = require('fs'), path = require('path');
const base = process.env.N8N_NODES_BASE || '/tmp/n8nrun/node_modules/n8n-nodes-base';
const pkg = require(path.join(base, 'package.json'));
const index = {};
for (const f of pkg.n8n.nodes) {
  try {
    const mod = require(path.join(base, f));
    const Cls = Object.values(mod).find(v => typeof v === 'function');
    const inst = new Cls();
    const d = inst.description || {};
    const versions = inst.nodeVersions ? Object.keys(inst.nodeVersions).map(Number) : [].concat(d.version || 1);
    index[d.name] = versions;
  } catch (e) { /* some nodes need optional deps; skip */ }
}
let bad = 0;
const repo = path.join(__dirname, '..');
const files = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(repo).filter(f => f.endsWith('.workflow.json')).map(f => path.join(repo, f));
for (const file of files) {
  const wf = JSON.parse(fs.readFileSync(file, 'utf8'));
  const names = new Set(wf.nodes.map(n => n.name));
  if (names.size !== wf.nodes.length) { console.log('DUPLICATE node names in', file); bad++; }
  for (const n of wf.nodes) {
    const short = n.type.replace(/^n8n-nodes-base\./, '');
    const v = index[short];
    if (!v) { console.log(`✗ ${file}: unknown type ${n.type} (${n.name})`); bad++; continue; }
    if (!v.includes(n.typeVersion)) { console.log(`✗ ${file}: ${n.type} v${n.typeVersion} not in [${v}] (${n.name})`); bad++; }
  }
  for (const [from, c] of Object.entries(wf.connections)) {
    if (!names.has(from)) { console.log(`✗ connection from missing node ${from}`); bad++; }
    for (const out of c.main) for (const t of out) if (!names.has(t.node)) { console.log(`✗ connection to missing node ${t.node}`); bad++; }
  }
  console.log(`${bad ? '…' : '✓'} ${path.basename(file)}: ${wf.nodes.length} nodes, types: ${[...new Set(wf.nodes.map(n => n.type.replace('n8n-nodes-base.', '') + '@' + n.typeVersion))].join(', ')}`);
}
console.log(`n8n-nodes-base ${pkg.version}; ${Object.keys(index).length} node types indexed`);
process.exit(bad ? 1 : 0);
