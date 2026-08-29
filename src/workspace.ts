import * as core from "@actions/core";
import path from "path";

import { getCmdOutput } from "./utils.js";

const SAVE_TARGETS = new Set(["lib", "cdylib", "dylib", "rlib", "staticlib", "proc-macro"]);

export class Workspace {
  constructor(
    public root: string,
    public target: string,
  ) {}

  async getPackages(
    cmdFormat: string,
    filter: (p: Meta["packages"][0]) => boolean,
    extraArgs?: string,
  ): Promise<Packages> {
    const cmd = "cargo metadata --all-features --format-version 1" + (extraArgs ? ` ${extraArgs}` : "");
    let packages: Packages = [];
    try {
      core.debug(`collecting metadata for "${this.root}"`);
      const meta: Meta = JSON.parse(
        await getCmdOutput(cmdFormat, cmd, {
          cwd: this.root,
          env: { ...process.env, CARGO_ENCODED_RUSTFLAGS: "" },
        }),
      );
      core.debug(`workspace "${this.root}" has ${meta.packages.length} packages`);
      for (const pkg of meta.packages.filter(filter)) {
        const targets = pkg.targets.filter((t) => t.kind.some((kind) => SAVE_TARGETS.has(kind))).map((t) => t.name);
        packages.push({ name: pkg.name, version: pkg.version, targets, path: path.dirname(pkg.manifest_path) });
      }
    } catch (err) {
      console.error(err);
    }
    return packages;
  }

  public async getPackagesOutsideWorkspaceRoot(cmdFormat: string): Promise<Packages> {
    return await this.getPackages(cmdFormat, (pkg) => !pkg.manifest_path.startsWith(this.root));
  }

  public async getWorkspaceMembers(cmdFormat: string): Promise<Packages> {
    return await this.getPackages(cmdFormat, (_) => true, "--no-deps");
  }

  /**
   * Every package built from a local path rather than fetched from a registry.
   *
   * This is a strict superset of `getWorkspaceMembers`, and the difference is
   * the bug it exists to fix: a path dependency pointing INTO a directory that
   * `workspace.exclude` removes from the workspace is neither a member nor
   * "outside the workspace root", so it falls through both of the other
   * filters and its artifacts are pruned on every save - even though it is as
   * expensive to rebuild as any dependency, and is never a cheap-to-recompile
   * workspace crate.
   *
   * `source === null` is cargo's own marker for "local", so registry packages
   * are unaffected and keep being handled by getPackagesOutsideWorkspaceRoot.
   */
  public async getLocalPackages(cmdFormat: string): Promise<Packages> {
    return await this.getPackages(cmdFormat, (pkg) => pkg.source === null);
  }
}

export interface PackageDefinition {
  name: string;
  version: string;
  path: string;
  targets: Array<string>;
}

export type Packages = Array<PackageDefinition>;

interface Meta {
  packages: Array<{
    name: string;
    version: string;
    manifest_path: string;
    /** `null` for path/local packages; a registry URL otherwise. */
    source: string | null;
    targets: Array<{ kind: Array<string>; name: string }>;
  }>;
}
