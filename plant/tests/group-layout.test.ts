import test from 'node:test';
import assert from 'node:assert/strict';
import { compileProject } from '../compiler';
import { demoFiles } from "../../examples/plant/files";
import { groupLayout } from '../group-layout';
import { groupTitleLines } from '../../src/group-style';
import { Kernel } from '../kernel';
const size = () => ({ width: 150, height: 118 });
const contains = (a: {x:number;y:number;width:number;height:number}, b: {x:number;y:number;width:number;height:number}) => a.x <= b.x && a.y <= b.y && a.x + a.width >= b.x + b.width && a.y + a.height >= b.y + b.height;
test('all system backplates include their direct devices and nested systems', () => {
    const project = compileProject(demoFiles), groups = groupLayout(project, size);
    assert.equal(groups.length, project.systems.length);
    assert.equal(groups.find(g => g.id === 'site')?.count, project.devices.length);
    assert.equal(groups.find(g => g.id === 'coreA')?.count, 6);
    for (const device of project.devices) {
        const group = groups.find(g => g.id === device.system)!;
        assert.ok(contains(group, { ...device.layout, ...size() }), device.id);
        assert.ok(device.layout.y - 48 >= group.y + 76, `header clearance: ${device.id}`);
    }
    for (const group of groups.filter(g => g.parent)) {
        const parent = groups.find(g => g.id === group.parent)!;
        assert.ok(contains(parent, group), `${parent.id} contains ${group.id}`);
        assert.ok(group.y >= parent.y + 76, `${parent.id} header is outside ${group.id}`);
        assert.equal(group.depth, parent.depth + 1);
    }
});
test('demo sibling backplates do not cover one another or unrelated equipment', () => {
    const project = compileProject(demoFiles), groups = groupLayout(project, size);
    for (const a of groups) for (const b of groups) {
        if (a.id >= b.id || a.parent !== b.parent) continue;
        const intersection = a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
        assert.equal(intersection, false, `${a.id} overlaps ${b.id}`);
    }
});
test('group envelopes follow authored position edits without mutating the project', () => {
    const project = compileProject(demoFiles), saved = JSON.stringify(project), first = groupLayout(project, size);
    assert.equal(JSON.stringify(project), saved);
    const moved = structuredClone(project); moved.devices.find(d => d.id === 'AUX-TANK')!.layout.x += 100;
    const next = groupLayout(moved, size);
    assert.notDeepEqual(first.find(g => g.id === 'aux-water'), next.find(g => g.id === 'aux-water'));
    assert.deepEqual(first.find(g => g.id === 'coreA'), next.find(g => g.id === 'coreA'));
});
test('empty systems are not represented by invented equipment or zero-sized plates', () => {
    assert.deepEqual(groupLayout({ systems: [{id:'empty',title:'Empty'}], devices: [] }, size), []);
});
test('group title wrapping stays bounded and preserves a two-line header', () => {
    assert.ok(groupTitleLines('Циркуляция и теплоотвод', 214).length <= 2);
    assert.ok(groupTitleLines('Очень длинное название технологической системы установки', 214).every(line => line.length <= 20));
});
test('layout-only organization leaves simulation models and signal bindings identical', () => {
    const project = compileProject(demoFiles), moved = structuredClone(project);
    for (const n of moved.simulations) { n.layout.x += 100; n.layout.y -= 50; }
    for (const n of moved.devices) { n.layout.x += 100; n.layout.y -= 50; }
    const a = new Kernel(project, 'revision', 'layout-test', 0), b = new Kernel(moved, 'revision', 'layout-test', 0);
    for (let i = 0; i < 20; i++) { a.step(); b.step(); }
    assert.deepEqual(a.state, b.state);
});
