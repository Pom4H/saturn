import { componentRegistry, type Scene } from '../../src/core';

/** Explicit, deliberately simple series-circuit DEMO. Not a hydraulic solver. */
export function simulate(scene: Scene): { flows: Map<string, number | null>; notes: string[] } {
  const flows = new Map<string, number | null>();
  const notes: string[] = [];
  const physical = scene.nodes.filter(n => !componentRegistry.schematic(n.kind).instrument);
  const visited = new Set<string>();
  for (const root of physical) {
    if (visited.has(root.id)) continue;
    const ids = new Set([root.id]); const queue = [root.id];
    while (queue.length) {
      const id = queue.shift()!; visited.add(id);
      for (const edge of scene.links) {
        const other = edge.from.node === id ? edge.to.node : edge.to.node === id ? edge.from.node : null;
        if (other && !ids.has(other)) { ids.add(other); queue.push(other); }
      }
    }
    const nodes = physical.filter(n => ids.has(n.id));
    const edges = scene.links.filter(l => ids.has(l.from.node));
    if (!edges.length) continue;
    const pumps = nodes.filter(n => n.kind === 'pump');
    const degree = (id: string) => edges.filter(l => l.from.node === id || l.to.node === id).length;
    const complete = nodes.every(n => degree(n.id) === (n.kind === 'tank' || n.kind === 'outlet' ? 1 : 2)) && nodes.filter(n => n.kind === 'tank').length === 1 && nodes.filter(n => n.kind === 'outlet').length === 1 && pumps.length === 1;
    let flow: number | null = null;
    if (!complete) { notes.push('Незамкнутая или разветвлённая линия: демо-расход не рассчитывается.'); }
    else if (nodes.some(n => n.props.quality !== 'good')) { flow = null; notes.push('Качество данных не good: движение остановлено, расход неизвестен.'); }
    else if (nodes.some(n => (n.kind === 'pump' || n.kind === 'valve') && n.props.alarm === 'trip') || nodes.some(n => n.kind === 'tank' && Number(n.props.level) <= 0)) { flow = 0; }
    else {
      flow = 12 * Number(pumps[0].props.rpm) / 1500;
      for (const n of nodes.filter(n => n.kind === 'valve')) flow *= Number(n.props.opening) / 100;
      if (Math.abs(flow) < .001) flow = 0;
    }
    for (const n of nodes) flows.set(n.id, flow);
    for (const l of edges) flows.set(l.id, flow);
  }
  return { flows, notes: [...new Set(notes)] };
}


