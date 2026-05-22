export function splitRawArgumentString(raw) {
    const input = String(raw ?? "");
    const parts = [];
    let current = "";
    let quote = null;
    let escaping = false;
    for (const char of input) {
        if (escaping) {
            current += char;
            escaping = false;
            continue;
        }
        if (char === "\\") {
            escaping = true;
            continue;
        }
        if (quote) {
            if (char === quote) {
                quote = null;
            }
            else {
                current += char;
            }
            continue;
        }
        if (char === '"' || char === "'") {
            quote = char;
            continue;
        }
        if (/\s/.test(char)) {
            if (current) {
                parts.push(current);
                current = "";
            }
            continue;
        }
        current += char;
    }
    if (escaping) {
        current += "\\";
    }
    if (quote) {
        throw new Error(`Unclosed ${quote} quote in arguments.`);
    }
    if (current) {
        parts.push(current);
    }
    return parts;
}
function normalizeArgv(argv) {
    if (argv.length === 1 && /\s/.test(argv[0] ?? "")) {
        return splitRawArgumentString(argv[0]);
    }
    return [...argv];
}
export function parseArgs(argv, config = {}) {
    const valueOptions = new Set(config.valueOptions ?? []);
    const booleanOptions = new Set(config.booleanOptions ?? []);
    const aliasMap = config.aliasMap ?? {};
    const normalized = normalizeArgv(argv);
    const options = {};
    const positionals = [];
    for (let i = 0; i < normalized.length; i += 1) {
        const token = normalized[i];
        if (token === undefined) {
            continue;
        }
        if (token === "--") {
            positionals.push(...normalized.slice(i + 1));
            break;
        }
        if (token.startsWith("--")) {
            const raw = token.slice(2);
            const eq = raw.indexOf("=");
            const key = eq >= 0 ? raw.slice(0, eq) : raw;
            if (!key) {
                positionals.push(token);
                continue;
            }
            if (eq >= 0) {
                options[key] = raw.slice(eq + 1);
            }
            else if (booleanOptions.has(key)) {
                options[key] = true;
            }
            else if (valueOptions.has(key)) {
                i += 1;
                if (i >= normalized.length) {
                    throw new Error(`Missing value for --${key}.`);
                }
                options[key] = normalized[i] ?? "";
            }
            else {
                options[key] = true;
            }
            continue;
        }
        if (token.startsWith("-") && token.length > 1) {
            const alias = token.slice(1);
            const key = aliasMap[alias] ?? alias;
            if (booleanOptions.has(key)) {
                options[key] = true;
            }
            else {
                i += 1;
                if (i >= normalized.length) {
                    throw new Error(`Missing value for -${alias}.`);
                }
                options[key] = normalized[i] ?? "";
            }
            continue;
        }
        positionals.push(token);
    }
    return { options, positionals };
}
