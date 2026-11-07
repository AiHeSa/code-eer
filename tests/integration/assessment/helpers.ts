import assert from 'node:assert/strict';
import { AstService } from '../../../services/code-review/internal/ast/service.js';
import { analyzeParamsSchema } from '../../../services/code-review/internal/ast/protocol.js';
import { collectAssessment } from '../../../services/code-review/internal/assessment/service.js';
import { withFiles } from '../ast/helpers.js';

export async function withAssessment(
    source: string,
    run: (file: Awaited<ReturnType<typeof collectAssessment>>['files'][number]) => void,
    name = 'sample.ts',
    configuration: unknown = {},
): Promise<void> {
    await withFiles({ [name]: source }, async (root) => {
        const service = new AstService();
        try {
            const report = await collectAssessment(
                service,
                'js-ts',
                analyzeParamsSchema.parse({ root, files: [name] }),
                configuration,
            );
            assert.deepEqual(report.errors, []);
            assert.equal(report.files.length, 1);
            const file = report.files[0]!;
            const scopes = new Map(file.evidence.scopes.map((item) => [item.id, item]));
            assert.equal(
                scopes.size,
                file.evidence.scopes.length,
                'scope IDs must distinguish nodes with the same span',
            );
            for (const scope of scopes.values()) {
                const seen = new Set([scope.id]);
                let parent = scope.parentId;
                while (parent !== null) {
                    assert.ok(!seen.has(parent), 'scope ancestry must be acyclic');
                    seen.add(parent);
                    assert.ok(scopes.has(parent));
                    parent = scopes.get(parent)!.parentId;
                }
            }
            run(file);
        } finally {
            service.close();
        }
    });
}
