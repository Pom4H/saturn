import { resolve } from 'node:path';
import { models } from '../plant/models';
import { compileProject } from '../plant/compiler';
import { installEquipment, sceneFor } from '../plant/equipment';
import { executeReport } from '../plant/workflows';
import type { Report, ReportData } from '../plant/types';
import { BunSql } from './bun-sql';
import { localizedDslEntities, localizedDslOperators } from '../plant/dsl-i18n';
import { modelTitle } from '../plant/i18n';
import { formatDiagnostic, SaturnDiagnosticError, type SaturnLocale } from '../plant/diagnostics';
import { catalog } from '../src/core';
import { ExtensionManager } from './extensions';
import { loadProjectDirectory } from './project-loader';

export interface IdeCatalogItem {
    type: string;
    title: string;
    source: string;
    visual?: string;
    tag?: string;
}

export interface IdeCatalogGroup {
    id: string;
    title: string;
    source: string;
    items: IdeCatalogItem[];
}

export interface IdeCatalogDocument {
    schema: 1;
    catalogs: IdeCatalogGroup[];
}

export interface IdeReportSummary {
    id: string;
    title: string;
    window: number;
    signals: string[];
    schedule: string[];
    manual: boolean;
}

export interface IdeReportsDocument {
    schema: 1;
    project: { id: string; title: string; directory: string };
    reports: IdeReportSummary[];
}

export interface IdeReportPreviewDocument {
    schema: 1;
    project: { id: string; title: string; directory: string };
    report: IdeReportSummary;
    html: string;
    rows: Record<string, unknown>[];
}

export interface IdeDocsDocument {
    schema: 1;
    locale: SaturnLocale;
    entities: ReturnType<typeof localizedDslEntities>;
    operators: ReturnType<typeof localizedDslOperators>;
}

export interface IdeCheckDiagnostic {
    code: string;
    severity: 'error' | 'warning' | 'info';
    message: string;
    messageKey: string;
    data?: Record<string, unknown>;
    source?: { path: string; from: number; to: number; line: number; character: number };
}

export interface IdeCheckDocument {
    schema: 1;
    locale: SaturnLocale;
    diagnostics: IdeCheckDiagnostic[];
}

export interface IdeDiagramDocument {
    schema: 1;
    project: { id: string; title: string; directory: string };
    scene: ReturnType<typeof sceneFor>;
    definitions: Record<string, { label: string; width: number; height: number }>;
}

export function ideDocs(locale: SaturnLocale): IdeDocsDocument {
    return { schema: 1, locale, entities: localizedDslEntities(locale), operators: localizedDslOperators() };
}

export async function ideCheck(projectPath: string, locale: SaturnLocale): Promise<IdeCheckDocument> {
    const loaded = await loadProjectDirectory(projectPath);
    try {
        compileProject(loaded.files);
        return { schema: 1, locale, diagnostics: [] };
    } catch (error) {
        if (error instanceof SaturnDiagnosticError) {
            const source = error.diagnostic.data?.source as IdeCheckDiagnostic['source'] | undefined;
            return {
                schema: 1,
                locale,
                diagnostics: [{
                    code: error.diagnostic.code,
                    severity: error.diagnostic.severity,
                    message: formatDiagnostic(error.diagnostic, locale),
                    messageKey: error.diagnostic.message.key,
                    ...(error.diagnostic.data ? { data: error.diagnostic.data } : {}),
                    ...(source ? { source } : {}),
                }],
            };
        }
        throw error;
    }
}

export async function ideCatalog(appData: string, locale: SaturnLocale = 'en'): Promise<IdeCatalogDocument> {
    const core: IdeCatalogGroup = {
        id: 'core',
        title: 'Saturn Core',
        source: '@saturn/core',
        items: models()
            .map(item => ({ type: item.kind, title: modelTitle(item.kind, locale), source: '@saturn/core', visual: item.visual }))
            .sort((a, b) => a.title.localeCompare(b.title)),
    };

    const extensions = await new ExtensionManager(resolve(appData, 'extensions')).list();
    const catalogs: IdeCatalogGroup[] = [core];
    for (const extension of extensions) {
        if (!extension.elements.length)
            continue;
        catalogs.push({
            id: extension.name,
            title: extension.name,
            source: `${extension.name}@${extension.version}`,
            items: extension.elements.map(element => ({
                type: element.type,
                title: element.title,
                source: extension.name,
                ...(element.tag ? { tag: element.tag } : {}),
            })),
        });
    }
    return { schema: 1, catalogs };
}

export async function ideDiagram(projectPath: string): Promise<IdeDiagramDocument> {
    const loaded = await loadProjectDirectory(projectPath);
    const project = compileProject(loaded.files);
    installEquipment(locale);
    const scene = sceneFor(project);
    const definitions = Object.fromEntries(
        [...new Set(scene.nodes.map(node => node.kind))]
            .map(kind => {
                const definition = catalog[kind];
                if (!definition)
                    throw new Error(`Missing visual definition for ${kind}`);
                return [kind, { label: definition.label, width: definition.width, height: definition.height }];
            }),
    );
    return {
        schema: 1,
        project: { id: loaded.id, title: loaded.title, directory: loaded.directory },
        scene,
        definitions,
    };
}

function reportSummary(report: Report): IdeReportSummary {
    return {
        id: report.id,
        title: report.title,
        window: report.window,
        signals: [...report.signals],
        schedule: report.on.schedule?.map(item => item.cron) ?? [],
        manual: !!report.on.workflow_dispatch,
    };
}

export async function ideReports(projectPath: string): Promise<IdeReportsDocument> {
    const loaded = await loadProjectDirectory(projectPath);
    const project = compileProject(loaded.files);
    return {
        schema: 1,
        project: { id: loaded.id, title: loaded.title, directory: loaded.directory },
        reports: project.reports.map(reportSummary),
    };
}

function previewData(report: Report, from: number, to: number): ReportData {
    const samples: ReportData['samples'] = [];
    const segments: ReportData['segments'] = [];
    const steps = 24;
    const span = Math.max(1000, to - from);
    for (let signalIndex = 0; signalIndex < report.signals.length; signalIndex++) {
        const signal = report.signals[signalIndex];
        for (let i = 0; i < steps; i++) {
            const start = from + Math.floor(span * i / steps);
            const end = from + Math.floor(span * (i + 1) / steps);
            const quality = i === 8 || i === 9 ? 'offline' : 'good';
            const wave = Math.sin((i / steps) * Math.PI * 3 + signalIndex * .7);
            const trend = i / Math.max(1, steps - 1);
            const value = quality === 'good' ? 10 + signalIndex * 7 + wave * 3 + trend * 4 : null;
            segments.push({ signal, start, end, value, quality });
            samples.push({ signal, time: start, value, quality });
        }
    }
    return { samples, segments };
}

export async function ideReportPreview(projectPath: string, reportId: string): Promise<IdeReportPreviewDocument> {
    const loaded = await loadProjectDirectory(projectPath);
    const project = compileProject(loaded.files);
    const report = project.reports.find(item => item.id === reportId);
    if (!report)
        throw new Error(`Unknown report: ${reportId}`);
    const to = Date.UTC(2026, 8, 21, 9, 0, 0);
    const from = to - report.window;
    const inputs = Object.fromEntries(Object.entries(report.on.workflow_dispatch?.inputs ?? {}).map(([name, value]) => [name, value.default]));
    const artifact = executeReport({
        id: `preview-${report.id}`,
        report,
        revision: 'preview',
        runId: 'preview',
        trigger: 'vscode-preview',
        actor: 'engineer',
        createdAt: to,
        from,
        to,
        inputs,
        data: previewData(report, from, to),
    }, new BunSql());
    return {
        schema: 1,
        project: { id: loaded.id, title: loaded.title, directory: loaded.directory },
        report: reportSummary(report),
        html: artifact.html,
        rows: artifact.rows,
    };
}

function option(args: string[], name: string): string | undefined {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
}

export async function runIdeCommand(args: string[], appData: string): Promise<void> {
    const positional = args.filter((arg, index) => arg !== '--json' && args[index - 1] !== '--project');
    const [action = 'catalog'] = positional;
    const locale = (option(args, '--locale') === 'ru' ? 'ru' : 'en') as SaturnLocale;
    if (action === 'catalog') {
        console.log(JSON.stringify(await ideCatalog(appData, locale)));
        return;
    }
    if (action === 'docs') {
        console.log(JSON.stringify(ideDocs(locale)));
        return;
    }
    if (action === 'check') {
        const project = option(args, '--project');
        if (!project)
            throw new Error('Usage: saturn ide check --project PATH --locale en|ru --json');
        console.log(JSON.stringify(await ideCheck(project, locale)));
        return;
    }
    if (action === 'diagram') {
        const project = option(args, '--project');
        if (!project)
            throw new Error('Usage: saturn ide diagram --project PATH --json');
        console.log(JSON.stringify(await ideDiagram(project)));
        return;
    }
    if (action === 'reports') {
        const project = option(args, '--project');
        if (!project)
            throw new Error('Usage: saturn ide reports --project PATH --json');
        console.log(JSON.stringify(await ideReports(project)));
        return;
    }
    if (action === 'report') {
        const project = option(args, '--project');
        const id = option(args, '--id');
        if (!project || !id)
            throw new Error('Usage: saturn ide report --project PATH --id REPORT --json');
        console.log(JSON.stringify(await ideReportPreview(project, id)));
        return;
    }
    throw new Error('Usage: saturn ide <catalog|docs|check|diagram|reports|report> [--project PATH] [--id REPORT] [--locale en|ru] --json');
}
