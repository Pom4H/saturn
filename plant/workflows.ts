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
const reportDate = (time: number) => new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'UTC'}).format(new Date(time)).replace(' в ',' · ');
const metricValue = (rows: Record<string, unknown>[], metric: NonNullable<import('./types').Report['summary']>[number]): number | null => {
    const values=rows.map(row=>row[metric.key]).filter((value):value is number=>typeof value==='number'&&Number.isFinite(value));
    if(!values.length)return null;
    switch(metric.aggregate){case'sum':return values.reduce((a,b)=>a+b,0);case'avg':return values.reduce((a,b)=>a+b,0)/values.length;case'min':return Math.min(...values);case'max':return Math.max(...values);case'last':return values.at(-1)??null;}
};
const reportSummary=(report:import('./types').Report,rows:Record<string,unknown>[]):string=>!report.summary?.length?'':`<section class="report-metrics" aria-label="Ключевые показатели">${report.summary.map(metric=>{const value=metricValue(rows,metric),digits=metric.digits??1;return `<div class="report-metric ${metric.emphasis==='primary'?'report-metric-primary':''}" data-report-metric="${escape(metric.key)}"><span class="report-metric-label">${escape(metric.label)}</span><strong class="report-metric-value">${value===null?'—':escape(new Intl.NumberFormat('ru-RU',{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(value))}</strong>${metric.unit?`<span class="report-metric-unit">${escape(metric.unit)}</span>`:''}</div>`;}).join('')}</section>`;
const reportCss=`:root{color-scheme:light;--ink:#152129;--muted:#68757e;--line:#dde4e7;--accent:#087f8c}*{box-sizing:border-box}html,body{margin:0;background:#eef1f2;color:var(--ink);font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.report-sheet{width:min(210mm,calc(100% - 24px));margin:24px auto;padding:15mm 14mm 12mm;background:#fff;box-shadow:0 20px 65px rgba(26,42,51,.08);overflow:hidden}.report-masthead{display:flex;justify-content:space-between;padding-bottom:18px;border-bottom:1px solid var(--line)}.report-brand{font-size:13px;font-weight:760;letter-spacing:.2em;text-transform:uppercase}.report-kind{font-size:11px;color:var(--muted);letter-spacing:.12em;text-transform:uppercase}.report-header{padding:38px 0 30px}.report-header h1{margin:0;font-size:38px;line-height:1.08;letter-spacing:-.035em;font-weight:660}.report-description,.report-period,.report-footer{color:var(--muted)}.report-description{margin:14px 0 0;font-size:15px}.report-period{margin-top:22px;font-size:13px;font-variant-numeric:tabular-nums}.report-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(0,1fr));border-top:1px solid var(--line);border-bottom:1px solid var(--line);margin-bottom:34px}.report-metric{padding:22px 22px 22px 0}.report-metric+.report-metric{padding-left:22px;border-left:1px solid var(--line)}.report-metric-label{display:block;margin-bottom:8px;color:var(--muted);font-size:12px}.report-metric-value{font-size:28px;font-weight:620;font-variant-numeric:tabular-nums}.report-metric-primary .report-metric-value{font-size:40px}.report-metric-unit{margin-left:7px;color:var(--muted);font-size:13px}.report-footer{display:grid;grid-template-columns:1fr auto;gap:8px 24px;margin-top:44px;padding-top:18px;border-top:1px solid var(--line);font-size:10px}.report-note{grid-column:1/-1}@page{size:A4 portrait;margin:12mm}@media print{html,body{background:#fff}.report-sheet{width:auto;margin:0;padding:0;box-shadow:none}.report-metrics,.pv-chart,.pv-value{break-inside:avoid}thead{display:table-header-group}tr{break-inside:avoid}}`;
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
        const defaultNodes:ViewNode[]=[];
        if(report.chart)defaultNodes.push({kind:'chart',...report.chart});
        defaultNodes.push({kind:'table',columns:report.columns});
        const view:Presentation=report.view??{id:report.id,title:report.title,bindings:{},body:{kind:'group',direction:'column',children:defaultNodes}};
        const observations:Record<string,Sample>=Object.create(null);
        for(const sample of task.data.samples){
            if(report.signals.includes(sample.signal)&&sample.time<=task.to&&(!observations[sample.signal]||observations[sample.signal].time<=sample.time))observations[sample.signal]={value:sample.value,time:sample.time,quality:sample.quality==='good'?'good':'bad'};
        }
        const content=renderPresentation(view,{values:bindPresentation(view,observations,task.to),rows,interactive:false});
        const summary=reportSummary(report,rows),description=report.description?`<p class="report-description">${escape(report.description)}</p>`:'';
        const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'"><title>${escape(report.title)}</title><style>${presentationCss}${reportCss}</style></head><body><main class="report-sheet"><div class="report-masthead"><span class="report-brand">Saturn</span><span class="report-kind">Engineering report</span></div><header class="report-header"><h1>${escape(report.title)}</h1>${description}<div class="report-period">${escape(reportDate(task.from))} — ${escape(reportDate(task.to))} · UTC</div></header>${summary}<section class="report-body">${content}</section><footer class="report-footer"><span>Revision ${escape(task.revision)} · Run ${escape(task.runId)}</span><span>${escape(task.trigger)} · ${escape(task.actor)}</span><span class="report-note">Неизвестные и недостоверные интервалы не приравниваются к нулю. Отчёт построен из зафиксированного набора данных и не читает live-состояние после запуска.</span></footer></main></body></html>`;
        return { html, rows };
    }
    finally {
        db.close();
    }
}
