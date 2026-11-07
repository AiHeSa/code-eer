export type Methods = Record<string, (...args: any[]) => any>;

type Overrides<M extends Methods, O extends object> = O & { [K in keyof O]: K extends keyof M ? M[K] : never };

export interface Capability<M extends Methods> {
    readonly base: Capability<M> | null;
    readonly methods: Readonly<M>;
    readonly overrides: Readonly<Partial<M>>;
    specialize<const O extends object>(overrides: Overrides<M, O>): Capability<M>;
}

function methodEntries(methods: object): [string, Methods[string]][] {
    return Reflect.ownKeys(methods).map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(methods, key)!;
        if (typeof key !== 'string' || !('value' in descriptor) || typeof descriptor.value !== 'function')
            throw new TypeError('Capability entries must be named methods');
        return [key, descriptor.value];
    });
}

function createCapability<M extends Methods>(
    methods: M,
    base: Capability<M> | null,
    overrides: Partial<M>,
): Capability<M> {
    const capability: Capability<M> = {
        base,
        methods: Object.freeze(methods),
        overrides: Object.freeze(overrides),
        specialize: (entries) => {
            if (base) throw new TypeError('Specializations must inherit directly from the common capability');
            for (const [name] of methodEntries(entries))
                if (!Object.hasOwn(methods, name)) throw new TypeError(`Unknown capability method: ${name}`);
            return createCapability({ ...methods, ...entries }, capability, { ...entries });
        },
    };
    return Object.freeze(capability);
}

export function defineCapability<M extends Methods>(methods: M): Capability<M> {
    return createCapability(Object.fromEntries(methodEntries(methods)) as M, null, {});
}
