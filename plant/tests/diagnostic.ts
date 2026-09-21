import assert from 'node:assert/strict';
import { SaturnDiagnosticError } from '../diagnostics';

export function diagnostic(code: string, data: Record<string, unknown> = {}) {
    return (error: unknown): boolean => {
        assert.ok(error instanceof SaturnDiagnosticError);
        assert.equal(error.diagnostic.code, code);
        for (const [key, value] of Object.entries(data))
            assert.deepEqual(error.diagnostic.data?.[key], value, `diagnostic.data.${key}`);
        return true;
    };
}
