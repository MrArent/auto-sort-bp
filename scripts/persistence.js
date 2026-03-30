import { world } from "@minecraft/server";
import { CONFIG, DEFAULT_SETTINGS } from "./config.js";

// CHANGED: InputChest typedef gains the livePreview field.
// Old: @typedef {{ ... maxFill: number }} InputChest
// New: @typedef {{ ... maxFill: number, livePreview: boolean }} InputChest
// livePreview defaults to false for new chests (set in showRegisterForm).
// Existing saved chests without this field will read it as undefined, which is falsy,
// so they behave as if livePreview is off — no migration needed.

/**
 * @typedef {{ x: number, y: number, z: number, dimension: string, label: string, radius: number, scanMode: string, enabled: boolean, networkId: string | null, maxFill: number, livePreview: boolean }} InputChest
 * @typedef {{ particle: string, previewTicks: number, notifications: boolean, sortInterval: number }} Settings
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

// CHANGED: recordSort and incrementSortRun replaced by recordSortBatch.
//
// Old recordSort — called once per item moved; each call did a full read-modify-write cycle:
//   export const recordSort = (chest, itemType, amount) => {
//     const stats = getStats(chest);                            // JSON.parse
//     stats.totalSorted += amount;
//     stats.itemCounts[itemType] = (stats.itemCounts[itemType] ?? 0) + amount;
//     world.setDynamicProperty(statsKey(chest), JSON.stringify(stats)); // JSON.stringify + write
//   };
//
// Old incrementSortRun — called once per sort pass; another full read-modify-write cycle:
//   export const incrementSortRun = (chest) => {
//     const stats = getStats(chest);                            // JSON.parse again
//     stats.sortRuns = (stats.sortRuns ?? 0) + 1;
//     world.setDynamicProperty(statsKey(chest), JSON.stringify(stats)); // JSON.stringify + write again
//   };
//
// Together they caused up to (itemsInChest + 1) separate parse/stringify pairs per chest
// per sort tick — 28 for a full 27-slot chest. recordSortBatch collapses all of that
// into a single getStats call and a single setDynamicProperty call per sort pass.

/**
 * Records all items moved in one sort pass and increments the run counter.
 * Replaces the old per-item recordSort + per-pass incrementSortRun with a
 * single dynamic-property read and write for the entire pass.
 * @param {InputChest} chest
 * @param {Record<string, number>} itemAmounts  map of itemTypeId → total amount moved this pass
 */
export const recordSortBatch = (chest, itemAmounts) => {
  try {
    const stats = getStats(chest);                       // one read
    stats.sortRuns = (stats.sortRuns ?? 0) + 1;
    for (const [itemType, amount] of Object.entries(itemAmounts)) {
      stats.totalSorted += amount;
      stats.itemCounts[itemType] = (stats.itemCounts[itemType] ?? 0) + amount;
    }
    world.setDynamicProperty(statsKey(chest), JSON.stringify(stats)); // one write
  } catch (e) { console.warn("[AutoSorter] recordSortBatch error: " + e); }
};
