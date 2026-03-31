import { world } from "@minecraft/server";
import { CONFIG, DEFAULT_SETTINGS } from "./config.js";

/**
 * @typedef {{ x: number, y: number, z: number, dimension: string, label: string, radius: number, scanMode: string, enabled: boolean, networkId: string | null, maxFill: number, livePreview: boolean }} InputChest
 * @typedef {{ particle: string, previewTicks: number, notifications: boolean, sortInterval: number }} Settings
 * @typedef {{ networkId: string, x: number, y: number, z: number, dimension: string }} OverflowChest
 */

// Per-chest dynamic property key for sort statistics.

const statsKey = (chest) => `autosort:stats:${chest.x}:${chest.y}:${chest.z}:${chest.dimension}`;

/**
 * Loads all registered input chests from world dynamic properties.
 * @returns {InputChest[]}
 */
export const loadAll = () => {
  try {
    const r = world.getDynamicProperty(CONFIG.PROP_CHESTS);
    return r ? JSON.parse(/** @type {string} */ (r)) : [];
  } catch { return []; }
};

/** @param {InputChest[]} chests */
export const saveAll = (chests) =>
  world.setDynamicProperty(CONFIG.PROP_CHESTS, JSON.stringify(chests));

/**
 * Adds or replaces a chest in the registry, matched by coordinates and dimension.
 * @param {InputChest} chest
 */
export const registerChest = (chest) =>
  saveAll([
    ...loadAll().filter(c => !(c.x === chest.x && c.y === chest.y && c.z === chest.z && c.dimension === chest.dimension)),
    chest,
  ]);

/**
 * Removes a chest from the registry by coordinates and dimension.
 * @param {{ x: number, y: number, z: number, dimension: string }} loc
 */
export const unregisterChest = (loc) =>
  saveAll(loadAll().filter(c => !(c.x === loc.x && c.y === loc.y && c.z === loc.z && c.dimension === loc.dimension)));

/**
 * Returns the registered chest at the given location, or null.
 * @param {{ x: number, y: number, z: number, dimension: string }} loc
 * @returns {InputChest | null}
 */
export const findRegistered = (loc) =>
  loadAll().find(c => c.x === loc.x && c.y === loc.y && c.z === loc.z && c.dimension === loc.dimension) ?? null;

/**
 * Loads global settings, merged over defaults so missing keys always have a value.
 * @returns {Settings}
 */
export const loadSettings = () => {
  try {
    const r = world.getDynamicProperty(CONFIG.PROP_SETTINGS);
    return r ? { ...DEFAULT_SETTINGS, ...JSON.parse(/** @type {string} */ (r)) } : { ...DEFAULT_SETTINGS };
  } catch { return { ...DEFAULT_SETTINGS }; }
};

/** @param {Settings} s */
export const saveSettings = (s) =>
  world.setDynamicProperty(CONFIG.PROP_SETTINGS, JSON.stringify(s));

/**
 * Sends a chat message to the player if notifications are enabled.
 * @param {import("@minecraft/server").Player} player
 * @param {string} msg
 */
export const notify = (player, msg) => {
  if (loadSettings().notifications) player.sendMessage(msg);
};

/**
 * Loads sort statistics for a chest. Returns zeroed stats if none recorded yet.
 * @param {InputChest} chest
 */
export const getStats = (chest) => {
  try {
    const data = world.getDynamicProperty(statsKey(chest));
    return data ? JSON.parse(/** @type {string} */ (data)) : { totalSorted: 0, sortRuns: 0, itemCounts: {} };
  } catch { return { totalSorted: 0, sortRuns: 0, itemCounts: {} }; }
};

/**
 * Records all items moved in one sort pass and increments the run counter.
 * Replaces the old per-item recordSort + per-pass incrementSortRun — one read and one write
 * per pass regardless of item count (was up to 28 read/write pairs for a full chest).
 * @param {InputChest} chest
 * @param {Record<string, number>} itemAmounts  map of itemTypeId → total amount moved this pass
 */
export const recordSortBatch = (chest, itemAmounts) => {
  try {
    const stats = getStats(chest);
    stats.sortRuns = (stats.sortRuns ?? 0) + 1;
    for (const [itemType, amount] of Object.entries(itemAmounts)) {
      stats.totalSorted += amount;
      stats.itemCounts[itemType] = (stats.itemCounts[itemType] ?? 0) + amount;
    }
    world.setDynamicProperty(statsKey(chest), JSON.stringify(stats));
  } catch (e) { console.warn("[AutoSorter] recordSortBatch error: " + e); }
};

// ── Overflow chest storage ────────────────────────────────────────────────────
// One overflow chest per networkId. Items with no matching route are sent here
// instead of staying in the input chest. Only networked chests support overflow.

/**
 * Loads all registered overflow chests from world dynamic properties.
 * @returns {OverflowChest[]}
 */
export const loadOverflowChests = () => {
  try {
    const r = world.getDynamicProperty(CONFIG.PROP_OVERFLOW);
    return r ? JSON.parse(/** @type {string} */ (r)) : [];
  } catch { return []; }
};

/** @param {OverflowChest[]} overflows */
const saveOverflowChests = (overflows) =>
  world.setDynamicProperty(CONFIG.PROP_OVERFLOW, JSON.stringify(overflows));

/**
 * Registers an overflow chest for a networkId, replacing any existing one for that network.
 * @param {OverflowChest} overflow
 */
export const registerOverflowChest = (overflow) =>
  saveOverflowChests([
    ...loadOverflowChests().filter(o => o.networkId !== overflow.networkId),
    overflow,
  ]);

/**
 * Removes the overflow chest registered for a given networkId.
 * @param {string} networkId
 */
export const unregisterOverflowChest = (networkId) =>
  saveOverflowChests(loadOverflowChests().filter(o => o.networkId !== networkId));

/**
 * Returns the overflow chest for a given networkId, or null if none registered.
 * @param {string | null} networkId
 * @returns {OverflowChest | null}
 */
export const findOverflowChest = (networkId) => {
  if (!networkId) return null;
  return loadOverflowChests().find(o => o.networkId === networkId) ?? null;
};
