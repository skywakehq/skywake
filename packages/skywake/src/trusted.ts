import { DefenseInDepthBox } from "just-bash";

export function trusted<T>(call: () => Promise<T>): Promise<T> {
  return DefenseInDepthBox.runTrustedAsync(call);
}
