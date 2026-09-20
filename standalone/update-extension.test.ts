import { describe, expect, test } from 'bun:test';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { compareVersions, updateSignaturePayload, verifyUpdateArtifact, type UpdateManifest } from './update';
import { parseExtensionSpecifier, validateExtensionPackage } from './extensions';

describe('standalone update trust', () => {
    test('signed artifact metadata verifies and tampering fails', () => {
        const { privateKey, publicKey } = generateKeyPairSync('ed25519');
        const manifest: UpdateManifest = {
            schema: 1,
            version: '0.2.0',
            channel: 'stable',
            publishedAt: new Date().toISOString(),
            artifacts: {
                'windows-x64': {
                    url: 'https://updates.example/saturn.exe',
                    sha256: createHash('sha256').update('artifact').digest('hex'),
                    signature: '',
                },
            },
        };
        const artifact = manifest.artifacts['windows-x64'];
        artifact.signature = sign(null, updateSignaturePayload(manifest, 'windows-x64', artifact), privateKey).toString('base64url');
        expect(verifyUpdateArtifact(manifest, 'windows-x64', publicKey.export({ type: 'spki', format: 'pem' }).toString())).toBe(artifact);
        const tampered = structuredClone(manifest);
        tampered.artifacts['windows-x64'].url = 'https://evil.example/saturn.exe';
        expect(() => verifyUpdateArtifact(tampered, 'windows-x64', publicKey.export({ type: 'spki', format: 'pem' }).toString())).toThrow(/signature/);
    });

    test('version ordering rejects accidental downgrade logic', () => {
        expect(compareVersions('0.1.0', '0.2.0')).toBeLessThan(0);
        expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
        expect(compareVersions('1.0.0-preview.1', '1.0.0')).toBeLessThan(0);
    });
});

describe('extension package contract', () => {
    test('parses scoped packages and exact versions', () => {
        expect(parseExtensionSpecifier('@factory/equipment@1.4.2')).toEqual({ name: '@factory/equipment', selector: '1.4.2' });
        expect(parseExtensionSpecifier('@factory/equipment')).toEqual({ name: '@factory/equipment', selector: 'latest' });
    });

    test('accepts a bundled custom element pack and rejects transitive runtime deps', () => {
        const pkg: any = {
            name: '@factory/equipment',
            version: '1.4.2',
            saturn: {
                api: 1,
                entry: 'dist/index.js',
                capabilities: ['elements'],
                elements: [{ type: 'factory.motor', title: 'Motor', tag: 'factory-motor' }],
            },
        };
        expect(validateExtensionPackage(pkg).entry).toBe('dist/index.js');
        pkg.dependencies = { leftpad: '1.0.0' };
        expect(() => validateExtensionPackage(pkg)).toThrow(/self-contained/);
    });
});
