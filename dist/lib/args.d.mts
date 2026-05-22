export type ParsedOptionValue = boolean | string;
export interface ParseArgsConfig {
    valueOptions?: readonly string[];
    booleanOptions?: readonly string[];
    aliasMap?: Readonly<Record<string, string>>;
}
export interface ParsedArgs {
    options: Record<string, ParsedOptionValue>;
    positionals: string[];
}
export declare function splitRawArgumentString(raw: unknown): string[];
export declare function parseArgs(argv: readonly string[], config?: ParseArgsConfig): ParsedArgs;
