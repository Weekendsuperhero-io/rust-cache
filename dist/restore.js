import { e as error, g as getCacheProvider, a as getInput, b as exportVariable, C as CacheConfig, i as info, w as warning, c as cleanTargetDir, r as reportError, s as setOutput } from './cleanup-B9MWY_wk.js';
import 'os';
import 'crypto';
import 'fs';
import 'path';
import 'http';
import 'https';
import 'net';
import 'tls';
import 'events';
import 'assert';
import 'util';
import 'node:assert';
import 'node:net';
import 'node:http';
import 'node:stream';
import 'node:buffer';
import 'node:util';
import 'node:querystring';
import 'node:events';
import 'node:diagnostics_channel';
import 'node:tls';
import 'node:zlib';
import 'node:perf_hooks';
import 'node:util/types';
import 'node:worker_threads';
import 'node:url';
import 'node:async_hooks';
import 'node:console';
import 'node:dns';
import 'string_decoder';
import 'child_process';
import 'timers';
import 'stream';
import 'fs/promises';

process.on("uncaughtException", (e) => {
    error(e.message);
    if (e.stack) {
        error(e.stack);
    }
});
async function run() {
    const cacheProvider = await getCacheProvider();
    if (!cacheProvider.cache.isFeatureAvailable()) {
        setCacheHitOutput(false);
        return;
    }
    try {
        var cacheOnFailure = getInput("cache-on-failure").toLowerCase();
        if (cacheOnFailure !== "true") {
            cacheOnFailure = "false";
        }
        var lookupOnly = getInput("lookup-only").toLowerCase() === "true";
        const refresh = getInput("refresh").toLowerCase() === "true";
        exportVariable("CACHE_ON_FAILURE", cacheOnFailure);
        exportVariable("CARGO_INCREMENTAL", 0);
        const config = await CacheConfig.new();
        config.printInfo(cacheProvider);
        info("");
        info(`... ${lookupOnly ? "Checking" : "Restoring"} cache ...`);
        const key = config.cacheKey;
        // Pass a copy of cachePaths to avoid mutating the original array as reported by:
        // https://github.com/actions/toolkit/pull/1378
        // TODO: remove this once the underlying bug is fixed.
        const restore = (only) => cacheProvider.cache.restoreCache(config.cachePaths.slice(), key, config.restoreKeys.slice(), {
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
            warning(`Found cache key "${found}" but could not restore it. Trying once more.`);
            await new Promise((resolve) => setTimeout(resolve, 5000));
            restoreKey = await restore(false);
        }
        if (!restoreKey && found && sameKey(found, key) && !refresh) {
            warning(`Cache key "${key}" exists but could not be restored. Building without it, and not saving over it.`);
            // No saveState: the post step must not replace an entry that other
            // jobs can still restore.
            setCacheHitOutput(false);
        }
        else if (restoreKey) {
            const match = sameKey(restoreKey, key);
            info(`${lookupOnly ? "Found" : "Restored from"} cache key "${restoreKey}" full match: ${match}.`);
            if (!match) {
                // pre-clean the target directory on cache mismatch
                for (const workspace of config.workspaces) {
                    try {
                        await cleanTargetDir(workspace.target, [], true);
                    }
                    catch { }
                }
                // We restored the cache but it is not a full match.
                config.saveState();
            }
            else if (refresh) {
                // A full match never saves, so the entry would keep the build of the
                // commit that first wrote it. Refresh saves this run's build over it,
                // on a backend where a later save replaces an entry (Bitrise's).
                info(`Refresh is on: this run's build will replace "${key}".`);
                config.saveState();
            }
            setCacheHitOutput(match);
        }
        else {
            info(found ? `Could not restore cache key "${found}".` : "No cache found.");
            config.saveState();
            setCacheHitOutput(false);
        }
    }
    catch (e) {
        setCacheHitOutput(false);
        reportError(e);
    }
    process.exit();
}
function sameKey(a, b) {
    return a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;
}
function setCacheHitOutput(cacheHit) {
    setOutput("cache-hit", cacheHit.toString());
}
run();
