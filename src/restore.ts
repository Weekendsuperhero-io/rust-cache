import * as core from "@actions/core";

import { cleanTargetDir } from "./cleanup.js";
import { CacheConfig } from "./config.js";
import { getCacheProvider, reportError } from "./utils.js";

process.on("uncaughtException", (e) => {
  core.error(e.message);
  if (e.stack) {
    core.error(e.stack);
  }
});

async function run() {
  const cacheProvider = await getCacheProvider();

  if (!cacheProvider.cache.isFeatureAvailable()) {
    setCacheHitOutput(false);
    return;
  }

  try {
    var cacheOnFailure = core.getInput("cache-on-failure").toLowerCase();
    if (cacheOnFailure !== "true") {
      cacheOnFailure = "false";
    }
    var lookupOnly = core.getInput("lookup-only").toLowerCase() === "true";
    const refresh = core.getInput("refresh").toLowerCase() === "true";

    core.exportVariable("CACHE_ON_FAILURE", cacheOnFailure);
    core.exportVariable("CARGO_INCREMENTAL", 0);

    const config = await CacheConfig.new();
    config.printInfo(cacheProvider);
    core.info("");

    core.info(`... ${lookupOnly ? "Checking" : "Restoring"} cache ...`);
    const key = config.cacheKey;
    // Pass a copy of cachePaths to avoid mutating the original array as reported by:
    // https://github.com/actions/toolkit/pull/1378
    // TODO: remove this once the underlying bug is fixed.
    const restore = (only: boolean) =>
      cacheProvider.cache.restoreCache(config.cachePaths.slice(), key, config.restoreKeys.slice(), {
        lookupOnly: only,
      });

    // What the backend holds, asked before downloading anything. A download
    // that fails comes back from `restoreCache` as `undefined`, the same as a
    // miss, and a miss arms the save. GitHub refuses a save to a key it
    // already holds, but a backend that lets the later save win (Bitrise's
    // GitHub Actions cache does) would then keep whatever this job writes,
    // even a partial build, for every job after it.
    const found = lookupOnly ? undefined : await restore(true);
    let restoreKey = await restore(lookupOnly);
    if (!restoreKey && found) {
      core.warning(`Found cache key "${found}" but could not restore it. Trying once more.`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
      restoreKey = await restore(false);
    }
    if (!restoreKey && found && sameKey(found, key) && !refresh) {
      core.warning(
        `Cache key "${key}" exists but could not be restored. Building without it, and not saving over it.`,
      );
      // No saveState: the post step must not replace an entry that other
      // jobs can still restore.
      setCacheHitOutput(false);
    } else if (restoreKey) {
      const match = sameKey(restoreKey, key);
      core.info(`${lookupOnly ? "Found" : "Restored from"} cache key "${restoreKey}" full match: ${match}.`);
      if (!match) {
        // pre-clean the target directory on cache mismatch
        for (const workspace of config.workspaces) {
          try {
            await cleanTargetDir(workspace.target, [], true);
          } catch {}
        }

        // We restored the cache but it is not a full match.
        config.saveState();
      } else if (refresh) {
        // A full match never saves, so the entry would keep the build of the
        // commit that first wrote it. Refresh saves this run's build over it,
        // on a backend where a later save replaces an entry (Bitrise's).
        core.info(`Refresh is on: this run's build will replace "${key}".`);
        config.saveState();
      }

      setCacheHitOutput(match);
    } else {
      core.info(found ? `Could not restore cache key "${found}".` : "No cache found.");
      config.saveState();

      setCacheHitOutput(false);
    }
  } catch (e) {
    setCacheHitOutput(false);

    reportError(e);
  }
  process.exit();
}

function sameKey(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;
}

function setCacheHitOutput(cacheHit: boolean): void {
  core.setOutput("cache-hit", cacheHit.toString());
}

run();
