import { describe, expect, test } from 'bun:test';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { compareVersions, updateSignaturePayload, verifyUpdateArtifact, type UpdateManifest } from './update';

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

