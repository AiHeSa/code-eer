import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export const digest = (text) => createHash('sha256').update(text).digest('hex');

export function inside(root, path) {
    const value = relative(root, path);
    return !isAbsolute(value) && value !== '..' && !value.startsWith(`..${sep}`);
}

export function localPath(root, name) {
    if (!name || isAbsolute(name) || name.split(/[\\/]/).some((part) => part === '..' || part === '.'))
        throw new Error(`Invalid relative path: ${name}`);
    const path = resolve(root, name);
    if (!inside(root, path) || path === root) throw new Error(`Path escapes root: ${name}`);
    return path;
}

export async function optionalText(path) {
    try {
        return await readFile(path, 'utf8');
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
    }
}

export async function sourceText(root, name) {
    const path = localPath(root, name);
    if (!inside(await realpath(root), await realpath(path))) throw new Error(`Source symlink escapes root: ${name}`);
    return readFile(path, 'utf8');
}

export async function rejectSymlinks(root, name) {
    localPath(root, name);
    const parts = name.split('/');
    for (let index = 1; index <= parts.length; index++) {
        const path = resolve(root, ...parts.slice(0, index));
        try {
            const stat = await lstat(path);
            if (stat.isSymbolicLink()) throw new Error(`Refusing managed symlink: ${name}`);
            if (index < parts.length && !stat.isDirectory()) throw new Error(`Parent is not a directory: ${name}`);
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
    }
}
