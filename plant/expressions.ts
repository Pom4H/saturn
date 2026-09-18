import type { Expr, Sample } from './types';
export function evaluate(expr: Expr, read: (id: string) => Sample, time: number): Sample {
    if (typeof expr === 'number' || typeof expr === 'boolean')
        return { value: Number(expr), quality: 'good', time };
    if ('ref' in expr)
        return read(expr.ref);
    const samples = expr.args.map(a => evaluate(a, read, time));
    const bad = samples.find(s => s.quality !== 'good' || s.value === null);
    if (bad)
        return { value: null, quality: bad.quality === 'good' ? 'bad' : bad.quality, time };
    const a = samples.map(s => s.value!);
    let value: number;
    switch (expr.op) {
        case 'add':
            value = a.reduce((x, y) => x + y, 0);
            break;
        case 'mul':
            value = a.reduce((x, y) => x * y, 1);
            break;
        case 'sub':
            value = a[0] - a[1];
            break;
        case 'div':
            value = a[0] / a[1];
            break;
        case 'max':
            value = Math.max(...a);
            break;
        case 'min':
            value = Math.min(...a);
            break;
        case 'gt':
            value = Number(a[0] > a[1]);
            break;
        case 'lt':
            value = Number(a[0] < a[1]);
            break;
        case 'and':
            value = Number(a.every(Boolean));
            break;
        case 'not':
            value = Number(!a[0]);
            break;
    }
    return { value: Number.isFinite(value) ? value : null, quality: Number.isFinite(value) ? 'good' : 'bad', time };
}
