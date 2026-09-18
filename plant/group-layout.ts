import type { SceneGroup } from '../src/core';
import type { Project } from './types';

/** Derived presentation only. Membership comes from system(); positions remain authored TS. */
export function groupLayout(project: Pick<Project, 'systems' | 'devices'>, size: (type: string) => { width: number; height: number }): SceneGroup[] {
    const groups: SceneGroup[] = [];
    const visiting = new Set<string>();
    const visit = (id: string, depth: number): SceneGroup | undefined => {
        if (visiting.has(id)) throw new Error(`Cyclic visual group: ${id}`);
        visiting.add(id);
        const system = project.systems.find(s => s.id === id)!;
        const members = project.devices.filter(d => d.system === id);
        const children = project.systems.filter(s => s.parent === id).map(s => visit(s.id, depth + 1)).filter((s): s is SceneGroup => !!s);
        visiting.delete(id);
        const rectangles = [...children, ...members.map(d => {
            const box = size(d.type);
            // Include the existing equipment ID above the body and status below it.
            return { x: d.layout.x - 8, y: d.layout.y - 48, width: box.width + 16, height: box.height + 76 };
        })];
        if (!rectangles.length) return undefined;
        const x = Math.min(...rectangles.map(r => r.x)) - 24;
        const y = Math.min(...rectangles.map(r => r.y)) - 76;
        const right = Math.max(...rectangles.map(r => r.x + r.width)) + 24;
        const bottom = Math.max(...rectangles.map(r => r.y + r.height)) + 24;
        const result: SceneGroup = { id, title: system.title, parent: system.parent, depth, x, y, width: Math.max(214, right - x), height: bottom - y,
            count: members.length + children.reduce((n, c) => n + c.count, 0) };
        groups.push(result);
        return result;
    };
    for (const root of project.systems.filter(s => !s.parent)) visit(root.id, 0);
    return groups.sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id, 'en'));
}

