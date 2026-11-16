export interface Spec {
  flags: Record<string, string>;
  values: Record<string, string>;
}

export interface Parsed {
  flags: Set<string>;
  values: Map<string, string[]>;
  operands: string[];
}

export function parse(args: string[], spec: Spec): Parsed | null {
  const parsed: Parsed = { flags: new Set(), values: new Map(), operands: [] };
  const add = (key: string, value: string) =>
    parsed.values.set(key, [...(parsed.values.get(key) ?? []), value]);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--") {
      parsed.operands.push(...args.slice(i + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const [option, inline] = splitOnce(arg, "=");
      if (spec.flags[option] && inline === undefined) parsed.flags.add(spec.flags[option]);
      else if (spec.values[option]) {
        const value = inline ?? args[++i];
        if (value === undefined) return null;
        add(spec.values[option], value);
      } else return null;
    } else if (arg.startsWith("-") && arg.length > 1) {
      for (let j = 1; j < arg.length; j++) {
        const option = `-${arg[j]}`;
        if (spec.flags[option]) parsed.flags.add(spec.flags[option]);
        else if (spec.values[option]) {
          const value = j + 1 < arg.length ? arg.slice(j + 1) : args[++i];
          if (value === undefined) return null;
          add(spec.values[option], value);
          break;
        } else return null;
      }
    } else parsed.operands.push(arg);
  }
  return parsed;
}

function splitOnce(text: string, separator: string): [string, string | undefined] {
  const at = text.indexOf(separator);
  return at < 0 ? [text, undefined] : [text.slice(0, at), text.slice(at + 1)];
}
