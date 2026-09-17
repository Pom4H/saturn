import { AppError, type ReportTask, type ReportArtifact, type SqlDatabase } from './types';
const limits = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
function fields(cron: string): Set<number>[] {
    if (typeof cron !== 'string' || cron.length > 120)
        throw new AppError('Invalid cron');
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5)
        throw new AppError('Cron needs five fields (UTC)');
    return parts.map((part, i) => { const [min, max] = limits[i], out = new Set<number>(); for (const item of part.split(',')) {
        const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(item);
        if (!m)
            throw new AppError(`Invalid cron field: ${part}`);
        let from = min, to = max;
        if (m[1] !== '*') {
            const range = m[1].split('-').map(Number);
            from = range[0];
            to = range[1] ?? (m[2] ? max : from);
        }
        const step = Number(m[2] ?? 1);
        if (from < min || to > max || to < from || step < 1 || step > max - min + 1)
            throw new AppError(`Invalid cron range: ${part}`);
        for (let v = from; v <= to; v += step)
            out.add(i === 4 && v === 7 ? 0 : v);
    } return out; });
}
const cronCache = new Map<string, Set<number>[]>();
export function validateCron(cron: string): void { fields(cron); }
export function cronMatches(cron: string, time: number): boolean { let f = cronCache.get(cron); if (!f) {
    f = fields(cron);
    if (cronCache.size > 200)
        cronCache.clear();
    cronCache.set(cron, f);
} const d = new Date(time), values = [d.getUTCMinutes(), d.getUTCHours(), d.getUTCDate(), d.getUTCMonth() + 1, d.getUTCDay()]; if (!f[0].has(values[0]) || !f[1].has(values[1]) || !f[3].has(values[3]))
    return false; const parts = cron.trim().split(/\s+/), dom = f[2].has(values[2]), dow = f[4].has(values[4]); return parts[2].startsWith('*') || parts[4].startsWith('*') ? dom && dow : dom || dow; }
export const escape = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function chartSVG(rows: Record<string, unknown>[], x: string, y: string): string {
    const points = rows.map((r, i) => ({ x: Number(r[x] ?? i), y: r[y] === null ? null : Number(r[y]) })).filter(p => Number.isFinite(p.x));
    const good = points.filter(p => p.y !== null && Number.isFinite(p.y));
    if (!good.length)
        return '<p>Нет достоверных данных для графика.</p>';
    const x0 = Math.min(...good.map(p => p.x)), x1 = Math.max(...good.map(p => p.x)), y0 = Math.min(0, ...good.map(p => p.y!)), y1 = Math.max(...good.map(p => p.y!));
    let path = '', pen = false;
    for (const p of points) {
        if (p.y === null || !Number.isFinite(p.y)) {
            pen = false;
            continue;
        }
        const px = 50 + (p.x - x0) / Math.max(1, x1 - x0) * 680, py = 190 - (p.y - y0) / Math.max(.001, y1 - y0) * 160;
        path += `${pen ? 'L' : 'M'}${px.toFixed(2)},${py.toFixed(2)} `;
        pen = true;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 220" role="img" aria-label="${escape(y)}"><path d="M50 20V190H740" fill="none" stroke="#8795a2"/><path d="${path}" fill="none" stroke="#087f8c" stroke-width="2"/><text x="3" y="28" font-size="12">${y1.toFixed(2)}</text><text x="3" y="192" font-size="12">${y0.toFixed(2)}</text></svg>`;
}
/** Runs ONLY against a fresh in-memory data capsule, never the operational database. */
export function executeReport(task: ReportTask, db: SqlDatabase): ReportArtifact {
    try {
        const sql = task.report.sql.trim().replace(/;\s*$/, '');
        if (!/^SELECT\b/i.test(sql) || sql.includes(';') || /\b(attach|detach|pragma|insert|delete|update|create|drop|alter|vacuum|replace|recursive|load_extension|readfile|writefile|randomblob|zeroblob|printf|format)\b/i.test(sql))
            throw new AppError('Reports support one read-only SELECT');
        db.exec('CREATE TABLE samples(signal TEXT,time INTEGER,value REAL,quality TEXT); CREATE TABLE segments(signal TEXT,start INTEGER,end INTEGER,value REAL,quality TEXT);');
        db.transaction(() => { for (const s of task.data.samples)
            db.exec('INSERT INTO samples VALUES(?,?,?,?)', [s.signal, s.time, s.value, s.quality]); for (const s of task.data.segments)
            db.exec('INSERT INTO segments VALUES(?,?,?,?,?)', [s.signal, s.start, s.end, s.value, s.quality]); });
        db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;');
        const named: Record<string, number> = { from: task.from, to: task.to, ...task.inputs }, params: Record<string, number> = {};
        for (const match of sql.matchAll(/:([A-Za-z][A-Za-z0-9_]*)/g)) {
            if (!(match[1] in named))
                throw new AppError(`Unknown report parameter: ${match[1]}`);
            params[`:${match[1]}`] = named[match[1]];
        }
        const rows = db.all<Record<string, unknown>>(`SELECT * FROM (${sql}) LIMIT 2001`, params);
        if (rows.length > 2000 || JSON.stringify(rows).length > 1000000)
            throw new AppError('Report result exceeds budget');
        const report = task.report;
        const table = `<table><thead><tr>${report.columns.map(c => `<th>${escape(c.title)}${c.unit ? ` (${escape(c.unit)})` : ''}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${report.columns.map(c => `<td>${escape(typeof row[c.key] === 'number' ? Number(row[c.key]).toFixed(3) : row[c.key])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
        const chart = report.chart ? `<h2>${escape(report.chart.title)}</h2>${chartSVG(rows, report.chart.x, report.chart.y)}` : '';
        const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'"><title>${escape(report.title)}</title><style>body{font:15px system-ui;color:#203040;max-width:1000px;margin:40px auto;padding:24px}h1{font-size:28px}table{width:100%;border-collapse:collapse}td,th{padding:12px;text-align:left;border-bottom:1px solid #d7dfe7}svg{width:100%;max-height:300px}small{color:#586675}@media print{body{margin:0}tr{break-inside:avoid}}</style></head><body><small>SCADA / СИМУЛЯЦИЯ / ${escape(task.id)}</small><h1>${escape(report.title)}</h1><p>${escape(new Date(task.from).toISOString())} — ${escape(new Date(task.to).toISOString())}</p>${table}${chart}<p><small>Ревизия ${escape(task.revision)} · Прогон ${escape(task.runId)} · ${escape(task.trigger)} · ${escape(task.actor)}. Интервалы неизвестного качества не равны нулю. Время данных — модельное.</small></p></body></html>`;
        return { html, rows };
    }
    finally {
        db.close();
    }
}
