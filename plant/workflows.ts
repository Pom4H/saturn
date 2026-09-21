import { bindPresentation, renderPresentation, presentationCss, type Presentation, type ViewNode } from './presentation';
import type { Sample } from './types';
import type { ReportTask, ReportArtifact, SqlDatabase } from './types';
import { failCode } from './diagnostics';
const limits = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
function fields(cron: string): Set<number>[] {
    if (typeof cron !== 'string' || cron.length > 120)
        failCode('SATURN_CRON_INVALID',{reason:'malformed'});
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5)
        failCode('SATURN_CRON_INVALID',{reason:'malformed'},{expectedFields:5});
    return parts.map((part, i) => { const [min, max] = limits[i], out = new Set<number>(); for (const item of part.split(',')) {
        const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(item);
        if (!m)
            failCode('SATURN_CRON_INVALID',{reason:'invalid'},{field:part});
        let from = min, to = max;
        if (m[1] !== '*') {
            const range = m[1].split('-').map(Number);
            from = range[0];
            to = range[1] ?? (m[2] ? max : from);
        }
        const step = Number(m[2] ?? 1);
        if (from < min || to > max || to < from || step < 1 || step > max - min + 1)
            failCode('SATURN_CRON_INVALID',{reason:'range'},{field:part,min,max,from,to,step});
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
export { escape, chartSVG } from './graphics';
import { escape, chartSVG } from './graphics';
/** Runs ONLY against a fresh in-memory data capsule, never the operational database. */
export function executeReport(task: ReportTask, db: SqlDatabase): ReportArtifact {
    try {
        const sql = task.report.sql.trim().replace(/;\s*$/, '');
        if (!/^SELECT\b/i.test(sql) || sql.includes(';') || /\b(attach|detach|pragma|insert|delete|update|create|drop|alter|vacuum|replace|recursive|load_extension|readfile|writefile|randomblob|zeroblob|printf|format)\b/i.test(sql))
            failCode('SATURN_SQL_INVALID',{reason:'readOnlySelect'},{report:task.report.id});
        db.exec('CREATE TABLE samples(signal TEXT,time INTEGER,value REAL,quality TEXT); CREATE TABLE segments(signal TEXT,start INTEGER,end INTEGER,value REAL,quality TEXT);');
        db.transaction(() => { for (const s of task.data.samples)
            db.exec('INSERT INTO samples VALUES(?,?,?,?)', [s.signal, s.time, s.value, s.quality]); for (const s of task.data.segments)
            db.exec('INSERT INTO segments VALUES(?,?,?,?,?)', [s.signal, s.start, s.end, s.value, s.quality]); });
        db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;');
        const named: Record<string, number> = { from: task.from, to: task.to, ...task.inputs }, params: Record<string, number> = {};
        for (const match of sql.matchAll(/:([A-Za-z][A-Za-z0-9_]*)/g)) {
            if (!(match[1] in named))
                failCode('SATURN_REPORT_INVALID',{report:task.report.id,reason:'unknown'},{parameter:match[1]});
            params[`:${match[1]}`] = named[match[1]];
        }
        const rows = db.all<Record<string, unknown>>(`SELECT * FROM (${sql}) LIMIT 2001`, params);
        if (rows.length > 2000 || JSON.stringify(rows).length > 1000000)
            failCode('SATURN_LIMIT',{resource:'report.rows',reason:'rowBudget'},{report:task.report.id,maxRows:2000,maxBytes:1000000});
        const report = task.report;
        for (const field of report.schema ?? []) for (const row of rows) {
            const value = row[field.key];
            if (value === null || value === undefined) continue;
            const valid = field.type === 'number' ? typeof value === 'number' && Number.isFinite(value)
                : field.type === 'boolean' ? typeof value === 'boolean' || value === 0 || value === 1
                : field.type === 'datetime' ? typeof value === 'number' || typeof value === 'string'
                : typeof value === 'string';
            if (!valid) failCode('SATURN_REPORT_INVALID',{report:task.report.id,reason:'schema'},{field:field.key,expectedType:field.type,actualType:typeof value});
        }
        const defaultNodes:ViewNode[]=[{kind:'table',columns:report.columns}];
        if(report.chart)defaultNodes.push({kind:'chart',...report.chart});
        const view:Presentation=report.view??{id:report.id,title:report.title,bindings:{},body:{kind:'group',direction:'column',children:defaultNodes}};
        const observations:Record<string,Sample>=Object.create(null);
        for(const sample of task.data.samples){
            if(report.signals.includes(sample.signal)&&sample.time<=task.to&&(!observations[sample.signal]||observations[sample.signal].time<=sample.time))observations[sample.signal]={value:sample.value,time:sample.time,quality:sample.quality==='good'?'good':'bad'};
        }
        const content=renderPresentation(view,{values:bindPresentation(view,observations,task.to),rows,interactive:false});
        const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'"><title>${escape(report.title)}</title><style>body{font:15px system-ui;color:#203040;max-width:1000px;margin:40px auto;padding:24px}h1{font-size:28px}table{width:100%;border-collapse:collapse}td,th{padding:12px;text-align:left;border-bottom:1px solid #d7dfe7}svg{width:100%;max-height:300px}small{color:#586675}@media print{body{margin:0}tr{break-inside:avoid}}${presentationCss}</style></head><body><small>SCADA / СИМУЛЯЦИЯ / ${escape(task.id)}</small><h1>${escape(report.title)}</h1><p>${escape(new Date(task.from).toISOString())} — ${escape(new Date(task.to).toISOString())}</p>${content}<p><small>Ревизия ${escape(task.revision)} · Прогон ${escape(task.runId)} · ${escape(task.trigger)} · ${escape(task.actor)}. Интервалы неизвестного качества не равны нулю. Время данных — модельное.</small></p></body></html>`;
        return { html, rows };
    }
    finally {
        db.close();
    }
}
