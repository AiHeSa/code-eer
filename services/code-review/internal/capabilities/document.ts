import { posix } from 'node:path';

export interface CapabilityDocument {
    path: string;
    preamble: string;
    extends: string | null;
    entries: Map<string, string>;
}

function inheritedPath(frontmatter: string | undefined, path: string): string | null {
    const declarations = frontmatter?.split(/\r?\n/).filter((line) => /^extends\s*:/.test(line)) ?? [];
    if (declarations.length > 1) throw new Error(`${path}: duplicate extends declaration`);
    return (
        declarations[0]
            ?.replace(/^extends\s*:\s*/, '')
            .trim()
            .replace(/^(['"])(.*)\1$/, '$2') ?? null
    );
}

function entryHeadings(source: string, path: string): { name: string; offset: number }[] {
    const headings: { name: string; offset: number }[] = [];
    let fence: string | undefined;
    let offset = 0;
    for (const line of source.split(/(?<=\n)/)) {
        const delimiter = line.match(/^ {0,3}(`{3,}|~{3,})(.*)/);
        if (delimiter) {
            if (!fence) fence = delimiter[1]!;
            else if (delimiter[1]![0] === fence[0] && delimiter[1]!.length >= fence.length && !delimiter[2]!.trim())
                fence = undefined;
        } else if (!fence) {
            const heading = line.trimEnd().match(/^##\s+([a-z][a-z0-9-]*)\s*$/);
            if (heading) headings.push({ name: heading[1]!, offset });
            else if (/^##(?:\s|$)/.test(line))
                throw new Error(`${path}: level-two headings must be stable entry identifiers`);
        }
        offset += line.length;
    }
    if (new Set(headings.map((entry) => entry.name)).size !== headings.length)
        throw new Error(`${path}: duplicate document entry`);
    return headings;
}

export function parseCapabilityDocument(path: string, source: string): CapabilityDocument {
    const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    const body = source.slice(frontmatter?.[0].length ?? 0);
    const headings = entryHeadings(body, path);
    return {
        path,
        extends: inheritedPath(frontmatter?.[1], path),
        preamble: source.slice(0, (frontmatter?.[0].length ?? 0) + (headings[0]?.offset ?? body.length)),
        entries: new Map(
            headings.map((entry, index) => [
                entry.name,
                body.slice(entry.offset, headings[index + 1]?.offset ?? body.length),
            ]),
        ),
    };
}

export function validateDocumentInheritance(common: CapabilityDocument, special: CapabilityDocument): void {
    if (common.extends !== null) throw new Error(`${common.path}: common document must be a root definition`);
    if (
        !special.extends?.startsWith('./') ||
        posix.normalize(posix.join(posix.dirname(special.path), special.extends)) !== common.path
    )
        throw new Error(`${special.path}: declare extends: ./${posix.basename(common.path)}`);
    const extra = [...special.entries.keys()].filter((name) => !common.entries.has(name));
    if (extra.length) throw new Error(`${special.path}: unknown common entries: ${extra.join(', ')}`);
}

/** 按通用条目顺序整段覆盖；专项前言不参与继承，缺项沿用通用正文。 */
export function resolveDocument(common: CapabilityDocument, special?: CapabilityDocument): string {
    if (common.extends !== null) throw new Error(`${common.path}: common document must be a root definition`);
    if (special) validateDocumentInheritance(common, special);
    return (
        [
            common.preamble.trimEnd(),
            ...[...common.entries].map(([name, content]) => (special?.entries.get(name) ?? content).trimEnd()),
        ]
            .filter(Boolean)
            .join('\n\n') + '\n'
    );
}
