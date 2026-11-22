import { randomBytes } from "node:crypto";

import { NotFound, type Disk, type Skywake } from "@skywake/sdk";

import { shell as open, type Shell } from "../shell.ts";

const MAIN = "main";

export class Places {
  readonly #sky: Skywake;
  readonly #disk: string | undefined;
  readonly #fixed: string | undefined;
  readonly #working = new Map<string, Promise<string>>();
  readonly #shells = new Map<string, Shell>();
  readonly session = `mcp-${randomBytes(4).toString("hex")}`;

  constructor(sky: Skywake, disk: string | undefined, branch: string | undefined) {
    this.#sky = sky;
    this.#disk = disk;
    this.#fixed = branch;
  }

  name(asked?: string): string {
    const name = asked || this.#disk;
    if (!name) throw new Error("no disk: pass `disk`, or start the server with SKYWAKE_DISK");
    return name;
  }

  async reading(asked?: string): Promise<Disk> {
    const name = this.name(asked);
    // A branch forked to in this session wins over SKYWAKE_BRANCH: the agent moved there.
    const branch = (await this.#working.get(name)) ?? this.#fixed ?? MAIN;
    return this.#sky.disk(name, { branch });
  }

  async writing(asked?: string): Promise<Disk> {
    const name = this.name(asked);
    if (this.#fixed && !this.#working.has(name)) {
      return this.#sky.disk(name, { branch: this.#fixed });
    }
    let branch = this.#working.get(name);
    if (!branch) {
      branch = this.#fork(name);
      this.#working.set(name, branch);
      branch.catch(() => this.#working.delete(name));
    }
    return this.#sky.disk(name, { branch: await branch });
  }

  use(asked: string | undefined, branch: string) {
    this.#working.set(this.name(asked), Promise.resolve(branch));
  }

  async shell(asked: string | undefined, write: boolean): Promise<Shell> {
    const disk = write ? await this.writing(asked) : await this.reading(asked);
    const key = `${disk.name}@${disk.branch}`;
    let found = this.#shells.get(key);
    if (!found) {
      found = open(disk);
      this.#shells.set(key, found);
    }
    return found;
  }

  async #fork(name: string): Promise<string> {
    const main = this.#sky.disk(name);
    try {
      return (await main.fork(this.session)).branch;
    } catch (error) {
      if (!(error instanceof NotFound)) throw error;
      await this.#sky.createDisk(name);
      return (await main.fork(this.session)).branch;
    }
  }
}
