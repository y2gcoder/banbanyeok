type Nullable<T> = T | null | undefined
declare function KtSingleton<T>(): T & (abstract new() => any);
export declare function rankFair(ids: Array<string>, times: Array<Int32Array>): Array<string>;