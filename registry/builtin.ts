export interface RegistryItem {
  name: string;
  title: string;
  kind: 'equipment' | 'report' | 'target' | 'template';
  description: string;
  tags: readonly string[];
  files: Readonly<Record<string, string>>;
  dependencies?: Readonly<Record<string, string>>;
}

export const registryItems: readonly RegistryItem[] = [
  {
    name: 'pump',
    title: 'Centrifugal pump',
    kind: 'equipment',
    description: 'Project-owned pump factory built on the Saturn core model.',
    tags: ['pump', 'centrifugal', 'equipment'],
    files: {
      'src/equipment/pump.ts': `import { simulation, type Layout } from '@saturn/core';

export function pump<const ID extends string>(id: ID, system: string, at: Layout) {
  return simulation(id, 'pump', { system, at });
}
`,
    },
  },
  {
    name: 'hourly-water-report',
    title: 'Hourly water report',
    kind: 'report',
    description: 'Typed report factory for hourly flow aggregation.',
    tags: ['report', 'water', 'hourly'],
    files: {
      'src/reports/hourly-water.ts': `import { report, type SignalRef } from '@saturn/core';

export function hourlyWaterReport(
  name: string,
  flow: SignalRef<string, number, string>,
) {
  return report(name, {
    title: 'Hourly water consumption',
    on: { workflow_dispatch: {}, schedule: [{ cron: '0 * * * *' }] },
    signals: [flow],
    window: 60 * 60 * 1000,
    sql: \`SELECT
      CAST((start - :from) / 3600000 AS INTEGER) AS hour,
      SUM(CASE WHEN quality='good' THEN value * (end-start) / 3600000.0 END) AS value
      FROM segments
      WHERE signal='${flow.ref}'
      GROUP BY hour
      ORDER BY hour\`,
    columns: [
      { key: 'hour', title: 'Hour' },
      { key: 'value', title: 'Consumption', unit: flow.unit },
    ],
  });
}
`,
    },
  },
] as const;

export function registryItem(name: string): RegistryItem {
  const item = registryItems.find(item => item.name === name);
  if (!item) throw new Error(`Unknown Saturn registry item: ${name}`);
  return item;
}
