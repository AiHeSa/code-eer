import { z } from 'zod';

const projectPath = z.string().min(1).refine((value) => !value.includes('\\') && !value.startsWith('/')
  && !value.includes(':') && !value.split('/').includes('..') && !value.includes('//'), 'Use a project-relative POSIX path without parent traversal');
export const assessmentConfigSchema = z.strictObject({
  modules: z.array(z.strictObject({ id: z.string().min(1), root: projectPath,
    kind: z.enum(['public', 'business', 'unknown']), entries: z.array(projectPath).default([]) })).default([]),
}).superRefine(({ modules }, context) => {
  const ids = new Set<string>();
  const roots = new Set<string>();
  for (const module of modules) {
    if (ids.has(module.id) || roots.has(normalizePath(module.root)))
      context.addIssue({ code: 'custom', message: 'Module IDs and roots must be unique' });
    ids.add(module.id); roots.add(normalizePath(module.root));
    for (const entry of module.entries) if (!within(entry, module.root))
      context.addIssue({ code: 'custom', message: `Entry ${entry} is outside module ${module.id}` });
  }
});
export type AssessmentConfig = z.infer<typeof assessmentConfigSchema>;
export function normalizePath(value: string): string {
  return value.split('/').filter((part) => part && part !== '.').join('/');
}
export function within(path: string, root: string): boolean {
  const prefix = normalizePath(root);
  return !prefix || normalizePath(path) === prefix || normalizePath(path).startsWith(`${prefix}/`);
}
