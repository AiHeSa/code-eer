import type { Capability, Methods } from './contract.js';

export function resolveCapability<M extends Methods>(common: Capability<M>,
  language?: Capability<M>, framework?: Capability<M>): Readonly<M> {
  if (common.base !== null) throw new TypeError('Common capability must be a root definition');
  for (const specialization of [language, framework])
    if (specialization && specialization.base !== common)
      throw new TypeError('Specialization must inherit from the selected common capability');
  return Object.freeze({ ...common.methods, ...language?.overrides, ...framework?.overrides });
}
