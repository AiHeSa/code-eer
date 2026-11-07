import { randomUUID } from 'node:crypto';
import { realpath, mkdir, writeFile, rename } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AstService } from '../ast/service.js';
import { languageSchema } from '../ast/schema.js';
import { analyzeParamsSchema, ProtocolError } from '../ast/protocol.js';
import { collectAssessment } from '../assessment/service.js';
import { evaluationInputSchema, type EvaluationInput } from './config.js';
import { loadPolicy, policySchema, type ScoringPolicy } from './policy.js';
import { snapshot, verifySnapshot, digest, gitHead, type SnapshotFile } from './snapshot.js';
import { deriveSemantics } from './semantics.js';
import { projectGraph, type ProjectFile } from './project.js';
import { evaluateProject } from './engine.js';
import { statistics } from './statistics.js';
import { grade } from './composite.js';
import { evaluationReportSchema, type EvaluationReport } from './report-model.js';
import { completeProjectSemantics } from './semantic-project.js';
import { deriveNativeSemantics } from './native-semantics.js';

interface Options {
    signal?: AbortSignal;
    timeoutMs?: number;
    persist?: boolean;
    policy?: ScoringPolicy;
}

function checkpoint(options: Options, deadline: number): void {
    if (options.signal?.aborted) throw new ProtocolError('CANCELLED', 'Evaluation cancelled');
    if (Date.now() > deadline) throw new ProtocolError('TIMEOUT', 'Evaluation deadline exceeded');
}

async function collectProject(
    ast: AstService,
    input: EvaluationInput,
    sources: SnapshotFile[],
    options: Options,
    deadline: number,
) {
    const project: ProjectFile[] = sources.map((source) => ({
        snapshot: source,
        collected: null,
        semantics: null,
        errors: [],
    }));
    const versions: Record<string, string> = {};

    // 逐后端限制为四文件批次，避免语义分析同时启动过多编译器或语言服务器。
    for (const backend of languageSchema.options) {
        const members = project.filter((file) => file.snapshot.language === backend);
        for (let offset = 0; offset < members.length; offset += 4) {
            const batch = members.slice(offset, offset + 4);
            checkpoint(options, deadline);
            try {
                const params = analyzeParamsSchema.parse({
                    root: input.root,
                    files: batch.map((file) => file.snapshot.path),
                    include: input.include,
                    exclude: input.exclude,
                    tests: input.tests,
                });
                const collection = await collectAssessment(
                    ast,
                    backend,
                    params,
                    { modules: input.configuration.modules },
                    {
                        timeoutMs: Math.max(1, deadline - Date.now()),
                        semantic: true,
                        ...(options.signal ? { signal: options.signal } : {}),
                    },
                );
                versions[backend] = collection.astVersion;
                for (const member of batch) {
                    member.collected =
                        collection.files.find(
                            (file) =>
                                relative(input.root, fileURLToPath(file.uri)).split('\\').join('/') ===
                                member.snapshot.path,
                        ) ?? null;
                    if (!member.collected)
                        member.errors.push(
                            ...collection.errors.map((error) => `${error.code}: ${error.message}`),
                            'No AST result for manifest member',
                        );
                    else if (member.collected.digest !== member.snapshot.digest)
                        throw new ProtocolError('SOURCE_CHANGED', member.snapshot.path);
                    else if (!member.collected.evidence.coverage.complete)
                        member.errors.push(
                            ...collection.diagnostics
                                .filter((item) => item.file === member.collected!.uri)
                                .map((item) => item.message),
                        );
                }
            } catch (error) {
                if (error instanceof ProtocolError && ['SOURCE_CHANGED', 'CANCELLED', 'TIMEOUT'].includes(error.code))
                    throw error;
                for (const member of batch) member.errors.push(String(error));
            }
        }
    }
    // 采集与派生分开；部分文件不可解析时仍保留清单成员和失败原因。
    for (const member of project) {
        checkpoint(options, deadline);
        if (member.collected) {
            try {
                member.semantics =
                    member.snapshot.language === 'js-ts'
                        ? await deriveSemantics(member.snapshot.path, member.snapshot.source)
                        : await deriveNativeSemantics(member.collected, member.snapshot.source, input.root);
            } catch (error) {
                member.errors.push(`Semantic extraction: ${String(error)}`);
            }
        }
    }
    await completeProjectSemantics(project, () => checkpoint(options, deadline));
    return { project, versions };
}

async function persist(report: EvaluationReport, project: ProjectFile[]): Promise<void> {
    if (!report.artifacts) return;
    const directory = join(report.manifest.root, '.cache/assessments', report.runId);
    const resolvedCalls = projectGraph(project).calls;
    await mkdir(directory, { recursive: true });
    await writeFile(
        report.artifacts.evidence,
        JSON.stringify(
            project.map((file) => ({
                path: file.snapshot.path,
                digest: file.snapshot.digest,
                collection: file.collected,
                errors: file.errors,
                derived: file.semantics
                    ? {
                          dependencies: file.semantics.dependencies.map((item) => ({
                              ...item,
                              id: `${file.snapshot.path}#${item.id}`,
                          })),
                          costs: [...file.semantics.costs].map(([id, cost]) => ({
                              id: `${file.snapshot.path}#${id}`,
                              ...cost,
                          })),
                          moduleCost: { id: `${file.snapshot.path}#module`, value: file.semantics.moduleCost },
                          imports: [...file.semantics.imports],
                          exports: [...file.semantics.exports],
                          primitiveBindings: [...file.semantics.primitiveBindings],
                          completeImports: file.semantics.completeImports,
                          exportsComplete: file.semantics.exportsComplete,
                          purity: [...file.semantics.purity],
                          localPure: [...file.semantics.localPure],
                          nativeModels: file.semantics.nativeModels ? [...file.semantics.nativeModels] : null,
                          resolvedCalls: (file.collected?.evidence.calls ?? []).flatMap((call) => {
                              const id = `${file.snapshot.path}#${call.id}`,
                                  target = resolvedCalls.get(id);
                              return target ? [{ id, target }] : [];
                          }),
                          links: {
                              aliases: [...file.semantics.links.aliases],
                              calls: [...file.semantics.links.calls],
                              objects: [...file.semantics.links.objects].map(([id, methods]) => [id, [...methods]]),
                              namespaces: [...file.semantics.links.namespaces],
                              exportBindings: [...file.semantics.links.exportBindings],
                              reexports: file.semantics.links.reexports,
                          },
                      }
                    : null,
            })),
        ) + '\n',
    );
    // 报告最后原子发布；调用者不会把尚未写完的 JSON 误认为一次完整评估。
    await writeFile(report.artifacts.report + '.tmp', JSON.stringify(report, null, 2) + '\n');
    await rename(report.artifacts.report + '.tmp', report.artifacts.report);
}

/** 对固定源码快照执行 internal 评估；未知事实保留区间，不伪造模型来源或正式等级。 */
export async function evaluateAssessment(
    ast: AstService,
    raw: unknown,
    options: Options = {},
): Promise<EvaluationReport> {
    const input = evaluationInputSchema.parse(raw);
    input.root = await realpath(input.root);
    const policy = policySchema.parse(options.policy ?? (await loadPolicy()));
    if (
        options.timeoutMs !== undefined &&
        (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0 || options.timeoutMs > 2147483647)
    )
        throw new ProtocolError('INVALID_TIMEOUT', 'Evaluation timeout must be a positive 32-bit integer');
    const startedAt = new Date().toISOString(),
        deadline = Date.now() + (options.timeoutMs ?? 600000),
        runId = randomUUID();
    const sources = await snapshot(input),
        head = await gitHead(input.root);

    // 所有分数必须对应同一份内容；Git HEAD 无法代表未提交的源码。
    const { project, versions } = await collectProject(ast, input, sources, options, deadline);
    checkpoint(options, deadline);
    const evaluation = evaluateProject(project, policy, input.configuration);
    await verifySnapshot(input, sources);
    checkpoint(options, deadline);

    const directory = join(input.root, '.cache/assessments', runId);
    const report = evaluationReportSchema.parse({
        schemaVersion: '1.0',
        engineVersion: 'scoring-engine-4',
        runId,
        source: 'internal',
        calibration: 'experimental-unvalidated',
        status: !project.some((file) => file.collected)
            ? 'failed'
            : evaluation.repository.composite.status === 'complete'
              ? 'complete'
              : 'partial',
        policy,
        configuration: input.configuration,
        manifest: {
            root: input.root,
            gitHead: head,
            sourceDigest: digest(JSON.stringify(sources.map(({ path, digest: hash }) => [path, hash]))),
            policyDigest: digest(JSON.stringify(policy)),
            configurationDigest: digest(JSON.stringify(input.configuration)),
            positionContextDigest: digest(
                JSON.stringify(
                    evaluation.files.map((file) => [
                        file.path,
                        file.units.map((unit) => [unit.id, unit.scope.details['positionWeighting'] ?? null]),
                    ]),
                ),
            ),
            selection: { files: input.files, include: input.include, exclude: input.exclude, tests: input.tests },
            files: sources.map(({ path, language, digest: hash }) => ({ path, language, digest: hash })),
            parserVersions: versions,
            startedAt,
            completedAt: new Date().toISOString(),
            stable: true,
        },
        ...evaluation,
        grade: grade(evaluation.repository.composite, policy),
        statistics: statistics(project, evaluation, policy),
        errors: project.flatMap((file) => file.errors.map((error) => `${file.snapshot.path}: ${error}`)),
        artifacts:
            options.persist === false
                ? null
                : { report: join(directory, 'report.json'), evidence: join(directory, 'evidence.json') },
    });
    checkpoint(options, deadline);
    await persist(report, project);
    return report;
}
