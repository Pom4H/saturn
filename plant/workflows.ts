import { bindPresentation, renderPresentation, presentationCss, type Presentation, type ViewNode } from './presentation';
import type { Report, Sample } from './types';
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
export { escape, chartSVG } from './graphics';
import { escape, chartSVG } from './graphics';

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: 'UTC',
});
const reportDate = (time: number) => dateFormatter.format(new Date(time)).replace(' в ', ' · ');
const metricValue = (rows: Record<string, unknown>[], metric: NonNullable<Report['summary']>[number]): number | null => {
    const values = rows.map(row => row[metric.key]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    if (!values.length) return null;
    switch (metric.aggregate) {
        case 'sum': return values.reduce((sum, value) => sum + value, 0);
        case 'avg': return values.reduce((sum, value) => sum + value, 0) / values.length;
        case 'min': return Math.min(...values);
        case 'max': return Math.max(...values);
        case 'last': return values.at(-1) ?? null;
    }
};
const formatMetric = (value: number, digits: number) => new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
}).format(value);
const reportSummary = (report: Report, rows: Record<string, unknown>[]): string => {
    if (!report.summary?.length) return '';
    return `<section class="report-metrics" aria-label="Ключевые показатели">${report.summary.map(metric => {
        const value = metricValue(rows, metric);
        const digits = metric.digits ?? 1;
        return `<div class="report-metric ${metric.emphasis === 'primary' ? 'report-metric-primary' : ''}" data-report-metric="${escape(metric.key)}"><span class="report-metric-label">${escape(metric.label)}</span><strong class="report-metric-value">${value === null ? '—' : escape(formatMetric(value, digits))}</strong>${metric.unit ? `<span class="report-metric-unit">${escape(metric.unit)}</span>` : ''}</div>`;
    }).join('')}</section>`;
};

const reportCss = `
:root{color-scheme:light;--report-ink:#152129;--report-muted:#68757e;--report-line:#dde4e7;--report-soft:#f4f6f7;--report-accent:#087f8c;--report-paper:#fff}
*{box-sizing:border-box}
html{background:#eef1f2}
body{margin:0;color:var(--report-ink);background:#eef1f2;font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14px;line-height:1.5;text-rendering:optimizeLegibility}
.report-sheet{width:min(1120px,calc(100% - 48px));margin:32px auto;padding:58px 64px 46px;background:var(--report-paper);box-shadow:0 20px 65px rgba(26,42,51,.08);border-radius:2px}
.report-masthead{display:flex;align-items:center;justify-content:space-between;padding-bottom:18px;border-bottom:1px solid var(--report-line)}
.report-brand{font-size:13px;font-weight:760;letter-spacing:.2em;text-transform:uppercase}
.report-kind{font-size:11px;color:var(--report-muted);letter-spacing:.12em;text-transform:uppercase}
.report-header{padding:38px 0 30px}
.report-header h1{max-width:820px;margin:0;font-size:38px;line-height:1.08;letter-spacing:-.035em;font-weight:660}
.report-description{max-width:720px;margin:14px 0 0;color:var(--report-muted);font-size:15px}
.report-period{margin-top:22px;color:var(--report-muted);font-size:13px;font-variant-numeric:tabular-nums}
.report-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:0;border-top:1px solid var(--report-line);border-bottom:1px solid var(--report-line);margin:0 0 38px}
.report-metric{min-width:0;padding:22px 22px 22px 0}
.report-metric+.report-metric{padding-left:22px;border-left:1px solid var(--report-line)}
.report-metric-label{display:block;margin-bottom:8px;color:var(--report-muted);font-size:12px}
.report-metric-value{display:inline;font-size:28px;line-height:1;font-weight:620;letter-spacing:-.035em;font-variant-numeric:tabular-nums}
.report-metric-primary .report-metric-value{font-size:42px;font-weight:650}
.report-metric-unit{margin-left:7px;color:var(--report-muted);font-size:13px}
.report-body{min-width:0}
.report-sheet .presentation{color:var(--report-ink)}
.report-sheet .pv-group{border:0;border-radius:0;margin:0;padding:0}
.report-sheet .pv-group h3{font-size:18px;letter-spacing:-.02em}
.report-sheet .pv-children{gap:34px}
.report-sheet .pv-column>.pv-children{display:flex;flex-direction:column}
.report-sheet .pv-chart{order:-1}
.report-sheet figure{width:100%}
.report-sheet figcaption{margin:0 0 14px;font-size:18px;font-weight:620;letter-spacing:-.018em}
.report-sheet svg{display:block;width:100%;max-height:320px}
.report-sheet .pv-scroll{width:100%;overflow:auto}
.report-sheet table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
.report-sheet th{padding:11px 10px 11px 0;border-bottom:1px solid #bcc8ce;color:var(--report-muted);font-size:11px;font-weight:650;text-align:left;white-space:nowrap}
.report-sheet td{padding:11px 10px 11px 0;border-bottom:1px solid #e5eaed;font-size:13px}
.report-sheet th:last-child,.report-sheet td:last-child{padding-right:0}
.report-sheet .pv-number{text-align:right}
.report-sheet .pv-unit{font-weight:450;color:#849098}
.report-sheet .pv-value strong{color:var(--report-accent);font-weight:630}
.report-sheet .pv-text{color:var(--report-muted)}
.report-footer{display:grid;grid-template-columns:1fr auto;gap:8px 24px;margin-top:44px;padding-top:18px;border-top:1px solid var(--report-line);color:var(--report-muted);font-size:10px;line-height:1.5}
.report-footer .report-note{grid-column:1/-1;max-width:760px}
@media(max-width:720px){
 html,body{background:#fff}.report-sheet{width:100%;margin:0;padding:32px 22px;box-shadow:none}
 .report-header{padding:30px 0 24px}.report-header h1{font-size:31px}
 .report-metrics{grid-template-columns:1fr 1fr}.report-metric:nth-child(odd){padding-left:0;border-left:0}.report-metric:nth-child(even){padding-left:18px;border-left:1px solid var(--report-line)}
 .report-footer{grid-template-columns:1fr}
}
@page{size:A4;margin:13mm}
@media print{
 html,body{background:#fff}.report-sheet{width:auto;margin:0;padding:0;box-shadow:none}
 .report-masthead{padding-top:0}.report-header{padding-top:28px}
 .report-metrics,.pv-chart,.pv-value{break-inside:avoid}
 table{break-inside:auto}thead{display:table-header-group}tr{break-inside:avoid;break-after:auto}
 .report-footer{margin-top:28px}
}
`;

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
        const defaultNodes:ViewNode[]=[];
        if(report.chart)defaultNodes.push({kind:'chart',...report.chart});
        defaultNodes.push({kind:'table',columns:report.columns});
        const view:Presentation=report.view??{id:report.id,title:report.title,bindings:{},body:{kind:'group',direction:'column',children:defaultNodes}};
        const observations:Record<string,Sample>=Object.create(null);
        for(const sample of task.data.samples){
            if(report.signals.includes(sample.signal)&&sample.time<=task.to&&(!observations[sample.signal]||observations[sample.signal].time<=sample.time))observations[sample.signal]={value:sample.value,time:sample.time,quality:sample.quality==='good'?'good':'bad'};
        }
        const rendered=renderPresentation(view,{values:bindPresentation(view,observations,task.to),rows,interactive:false});
        const summary=reportSummary(report,rows);
        const description=report.description ? `<p class="report-description">${escape(report.description)}</p>` : '';
        const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'"><title>${escape(report.title)}</title><style>${presentationCss}${reportCss}</style></head><body><main class="report-sheet"><div class="report-masthead"><span class="report-brand">Saturn</span><span class="report-kind">Engineering report</span></div><header class="report-header"><h1>${escape(report.title)}</h1>${description}<div class="report-period">${escape(reportDate(task.from))} — ${escape(reportDate(task.to))} · UTC</div></header>${summary}<section class="report-body">${rendered}</section><footer class="report-footer"><span>Revision ${escape(task.revision)} · Run ${escape(task.runId)}</span><span>${escape(task.trigger)} · ${escape(task.actor)}</span><span class="report-note">Неизвестные и недостоверные интервалы не приравниваются к нулю. Отчёт построен из зафиксированного набора данных и не читает live-состояние после запуска.</span></footer></main></body></html>`;
        return { html, rows };
    }
    finally {
        db.close();
    }
}
