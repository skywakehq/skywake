import { createRequire } from "node:module";

const native = createRequire(import.meta.url)("./engine.node");

/** An error from the engine. `kind` says what went wrong. */
export class EngineError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = "EngineError";
    this.kind = kind;
  }
}

// The engine starts each message with its kind, such as `[not_found] ...`.
function translate(error) {
  const found = /^\[(\w+)\] ([\s\S]*)$/.exec(error?.message ?? "");
  return found ? new EngineError(found[1], found[2]) : error;
}

function guard(call) {
  try {
    const result = call();
    return result instanceof Promise
      ? result.catch((error) => {
          throw translate(error);
        })
      : result;
  } catch (error) {
    throw translate(error);
  }
}

// Wraps every method so its errors become `EngineError`s, and so do
// those of an export it returns.
function wrap(engine) {
  return new Proxy(engine, {
    get(target, name) {
      const value = target[name];
      if (typeof value !== "function") return value;
      return (...args) => {
        const result = guard(() => value.apply(target, args));
        return result instanceof Promise
          ? result.then((out) =>
              out instanceof native.IndexExport || out instanceof native.IndexParquetExport
                ? wrap(out)
                : out,
            )
          : result;
      };
    },
  });
}

export const Engine = {
  open: (location) => wrap(guard(() => native.Engine.open(location))),
};

export const Index = {
  open: (location, options) => wrap(guard(() => native.Index.open(location, options))),
};

export const blake3 = native.blake3;
export const validName = native.validName;
