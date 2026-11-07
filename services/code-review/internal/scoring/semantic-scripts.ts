import { parse } from '@vue/compiler-sfc';

export function semanticScripts(path: string, source: string) {
    if (!path.endsWith('.vue')) return { complete: true, scripts: [{ path, source, offset: 0, prefix: '' }] };
    const { descriptor, errors } = parse(source, { filename: path });
    let complete = !errors.length;
    const scripts: { path: string; source: string; offset: number; prefix: string }[] = [];
    for (const block of [descriptor.script, descriptor.scriptSetup]) {
        if (!block) continue;
        if (block.src || (block.lang && !['js', 'ts', 'jsx', 'tsx'].includes(block.lang))) {
            complete = false;
            continue;
        }
        scripts.push({
            path: `${path}.${block.lang ?? 'js'}`,
            source: block.content,
            offset: block.loc.start.offset,
            prefix: `script:${block.loc.start.offset}:`,
        });
    }
    return { complete, scripts };
}
