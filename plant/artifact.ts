import { compileProject, validateProject } from './compiler';
import type { Project } from './types';

export interface BuildProvenance {
  packageName?: string;
  sourceRevision?: string;
  lockHash?: string;
  files: ReadonlyArray<{ path: string; sha256: string }>;
}

export interface BuildArtifact {
  schema: 'saturn.build@1';
  hash: string;
  project: Project;
  provenance: BuildProvenance;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const object = value as Record<string, unknown>;
  return '{' + Object.keys(object).sort().filter(key => object[key] !== undefined)
    .map(key => JSON.stringify(key) + ':' + canonical(object[key])).join(',') + '}';
}

async function digest(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function buildArtifact(
  sources: Readonly<Record<string, string>>,
  options: { entry?: string; packageName?: string; sourceRevision?: string; lockHash?: string } = {},
): Promise<BuildArtifact> {
  const files = await Promise.all(Object.entries(sources).sort(([a], [b]) => a.localeCompare(b)).map(async ([path, source]) => ({
    path,
    sha256: await digest(source),
  })));
  const project = compileProject({ ...sources }, options.entry);
  const provenance: BuildProvenance = {
    files,
    ...(options.packageName ? { packageName: options.packageName } : {}),
    ...(options.sourceRevision ? { sourceRevision: options.sourceRevision } : {}),
    ...(options.lockHash ? { lockHash: options.lockHash } : {}),
  };
  const payload = { schema: 'saturn.build@1' as const, project, provenance };
  const hash = 'sha256:' + await digest(canonical(payload));
  return { ...payload, hash };
}

export async function verifyBuildArtifact(value: unknown): Promise<BuildArtifact> {
  validateBuildArtifact(value);
  const artifact = value as BuildArtifact;
  const expected = 'sha256:' + await digest(canonical({
    schema: artifact.schema,
    project: artifact.project,
    provenance: artifact.provenance,
  }));
  if (artifact.hash !== expected) throw new Error('Saturn build artifact hash mismatch');
  return artifact;
}

export function validateBuildArtifact(value: unknown): asserts value is BuildArtifact {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Saturn build artifact');
  const artifact = value as BuildArtifact;
  if (artifact.schema !== 'saturn.build@1' || !/^sha256:[a-f0-9]{64}$/.test(artifact.hash))
    throw new Error('Invalid Saturn build artifact identity');
  if (!artifact.provenance || !Array.isArray(artifact.provenance.files) ||
      artifact.provenance.files.some(file => !file || typeof file.path !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)))
    throw new Error('Invalid Saturn build provenance');
  validateProject(artifact.project);
}

export function artifactSourceRevision(artifact: BuildArtifact): string | null {
  return artifact.provenance.sourceRevision ?? null;
}
