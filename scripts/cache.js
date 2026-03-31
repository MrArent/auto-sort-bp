import { loadAll } from "./persistence.js";

const NET_PREFIX   = "net:";
const CHEST_PREFIX = "chest:";

/**
 * Persistent output chest cache — survives across sort ticks within a session.
 * Keys: "net:<networkId>" for networked chests, "chest:x:y:z:dim" for standalone.
 * Values: { loc, dimension, acceptedItem }[] — plain data only; Container objects
 * are tick-scoped and must never be stored here.
 * @type {Map<string, { loc: {x:number,y:number,z:number}, dimension: string, acceptedItem: string|null }[]>}
 */
export const outputCache = new Map();

/**
 * Returns the cache key for a chest. Networked chests share one key so all
 * members reuse the same cached output pool.
 * @param {{ networkId: string|null, x: number, y: number, z: number, dimension: string }} chest
 * @returns {string}
 */
export const cacheKey = (chest) =>
  chest.networkId
    ? NET_PREFIX + chest.networkId
    : `${CHEST_PREFIX}${chest.x}:${chest.y}:${chest.z}:${chest.dimension}`;

/**
 * Returns true if loc is within radius+1 blocks of chest on all axes.
 * The +1 margin covers item frames adjacent to chests at the exact radius boundary.
 * Mode-agnostic — may produce false-positive invalidations for Line/Flat modes,
 * but never false-negatives. False-positive cost is one extra scan.
 * @param {{ x: number, y: number, z: number }} loc
 * @param {{ x: number, y: number, z: number, radius: number }} chest
 * @returns {boolean}
 */
export const isWithinInvalidationRange = (loc, chest) => {
  const r = chest.radius + 1;
  return (
    Math.abs(loc.x - chest.x) <= r &&
    Math.abs(loc.y - chest.y) <= r &&
    Math.abs(loc.z - chest.z) <= r
  );
};

/**
 * Deletes cache entries for every registered input chest whose scan area covers blockLoc.
 * O(N) over registered chests — acceptable since events are player-paced and N is small.
 * @param {{ x: number, y: number, z: number }} blockLoc
 * @param {string} dimensionId
 */
export const invalidateFor = (blockLoc, dimensionId) => {
  for (const chest of loadAll()) {
    if (chest.dimension !== dimensionId) continue;
    if (isWithinInvalidationRange(blockLoc, chest)) outputCache.delete(cacheKey(chest));
  }
};

/**
 * Deletes the cache entry for a specific chest.
 * Called on config changes and unregistration.
 * @param {{ networkId: string|null, x: number, y: number, z: number, dimension: string }} chest
 */
export const invalidateChest = (chest) => {
  outputCache.delete(cacheKey(chest));
};
