import { BlockInventoryComponent } from "@minecraft/server";
import { CONFIG, FACES, SCAN_MODES } from "./config.js";

/**
 * Returns the inventory Container for a chest at the given location, or null.
 * @param {{ x: number, y: number, z: number }} loc
 * @param {import("@minecraft/server").Dimension} dim
 * @returns {import("@minecraft/server").Container | null}
 */
export const getContainer = (loc, dim) => {
  try {
    const block = dim.getBlock(loc);
    if (!block || !CONFIG.CHEST_TYPES.has(block.typeId)) return null;
    return /** @type {BlockInventoryComponent} */ (block.getComponent("inventory"))?.container ?? null;
  } catch { return null; }
};

/**
 * Returns the item typeId displayed in a frame at the given location, or null.
 * Null is returned if the block is not a frame, the frame is empty, or it holds another frame.
 * @param {{ x: number, y: number, z: number }} loc
 * @param {import("@minecraft/server").Dimension} dim
 * @returns {string | null}
 */
export const getFrameItemType = (loc, dim) => {
  try {
    const block = dim.getBlock(loc);
    if (!block || !CONFIG.FRAME_TYPES.has(block.typeId)) return null;
    const item = block.getItemStack(1, true);
    return item && !CONFIG.FRAME_TYPES.has(item.typeId) ? item.typeId : null;
  } catch { return null; }
};

/**
 * Returns candidate block locations to scan based on origin position, radius, and scan mode.
 * Modes: Cube (full ±r³), Flat (dy==0), Line X (dz==0), Line Z (dx==0), Line Y (dx==0 && dz==0).
 * @param {{ x: number, y: number, z: number, radius: number, scanMode: string }} origin
 * @returns {{ x: number, y: number, z: number }[]}
 */

// CHANGED: getCandidateLocations now generates only valid positions for each scan mode
// instead of always running the full O((2r+1)³) triple-nested loop and filtering.
//
// Old code — one triple loop for every mode, skip unwanted positions with if-checks:
//   for (let dx = -r; dx <= r; dx++)
//     for (let dy = -r; dy <= r; dy++)
//       for (let dz = -r; dz <= r; dz++) {
//         if (!dx && !dy && !dz) continue;
//         if (scanMode === SCAN_MODES[1] && dy !== 0) continue;   // Flat
//         if (scanMode === SCAN_MODES[2] && dz !== 0) continue;   // Line X
//         if (scanMode === SCAN_MODES[3] && dx !== 0) continue;   // Line Z
//         if (scanMode === SCAN_MODES[4] && (dx !== 0 || dz !== 0)) continue; // Line Y
//         locs.push({ x: x+dx, y: y+dy, z: z+dz });
//       }
//
// At radius 20 that was always (2*20+1)³ = 68,921 loop iterations regardless of mode.
// The new code uses a separate loop structure per mode, so wasted iterations are eliminated:
//   Cube  → O((2r+1)³) unchanged — 68,921 at r=20
//   Flat  → O((2r+1)²)           —  1,681 at r=20  (41× fewer iterations)
//   Lines → O(2r)                —     40 at r=20  (1,723× fewer iterations)

export const getCandidateLocations = (origin) => {
  const { x, y, z, radius: r, scanMode } = origin;
  const locs = [];

  if (scanMode === SCAN_MODES[1]) {        // Flat (same Y): iterate XZ plane only — O((2r+1)²)
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        if (!dx && !dz) continue;
        locs.push({ x: x+dx, y, z: z+dz });
      }
  } else if (scanMode === SCAN_MODES[2]) { // Line X (east/west): iterate X axis only — O(2r)
    for (let dx = -r; dx <= r; dx++) {
      if (!dx) continue;
      locs.push({ x: x+dx, y, z });
    }
  } else if (scanMode === SCAN_MODES[3]) { // Line Z (north/south): iterate Z axis only — O(2r)
    for (let dz = -r; dz <= r; dz++) {
      if (!dz) continue;
      locs.push({ x, y, z: z+dz });
    }
  } else if (scanMode === SCAN_MODES[4]) { // Line Y (up/down): iterate Y axis only — O(2r)
    for (let dy = -r; dy <= r; dy++) {
      if (!dy) continue;
      locs.push({ x, y: y+dy, z });
    }
  } else {                                 // Cube (all directions): full 3D scan — O((2r+1)³)
    for (let dx = -r; dx <= r; dx++)
      for (let dy = -r; dy <= r; dy++)
        for (let dz = -r; dz <= r; dz++) {
          if (!dx && !dy && !dz) continue;
          locs.push({ x: x+dx, y: y+dy, z: z+dz });
        }
  }

  return locs;
};

/**
 * Scans the area around an input chest and returns all output chests found.
 * For each chest, adjacent faces are checked for an item frame tag:
 *   - acceptedItem: typeId of the framed item (targeted output chest)
 *   - acceptedItem === null: no tag (catch-all; routes by current contents)
 * Frames whose "behind" neighbor is also a chest are skipped (they tag that chest, not this one).
 * @param {{ x: number, y: number, z: number, radius: number, scanMode: string }} origin
 * @param {import("@minecraft/server").Dimension} dim
 * @returns {{ loc: { x: number, y: number, z: number }, acceptedItem: string | null }[]}
 */
export const findOutputChests = (origin, dim) => {
  const results = [];
  for (const loc of getCandidateLocations(origin)) {
    try {
      if (loc.x === origin.x && loc.y === origin.y && loc.z === origin.z) continue;
      const block = dim.getBlock(loc);
      if (!block || !CONFIG.CHEST_TYPES.has(block.typeId)) continue;

      // BUGFIX: was a single `let acceptedItem = null` with a `break` after finding the first
      // tagged frame. That meant only one frame per chest was ever read; all others were ignored.
      // Old code:
      //   let acceptedItem = null;
      //   for (const { x: fx, y: fy, z: fz } of FACES) {
      //     ...
      //     if (item && !CONFIG.FRAME_TYPES.has(item.typeId)) {
      //       acceptedItem = item.typeId;
      //       break;  // ← stopped after the first frame, rest were never checked
      //     }
      //   }
      //   results.push({ loc, acceptedItem });  // only one entry per chest
      //
      // Fix: collect every tagged frame on this chest into acceptedItems[], then push one
      // result entry per item type. The routing-map builder in main.js already handles
      // multiple entries for the same loc correctly (each maps its acceptedItem → container).
      // If no tagged frames exist, one null entry is pushed (catch-all by contents).

      const acceptedItems = [];

      for (const { x: fx, y: fy, z: fz } of FACES) {
        const frameLoc = { x: loc.x+fx, y: loc.y+fy, z: loc.z+fz };
        try {
          const frameBlock = dim.getBlock(frameLoc);
          if (!frameBlock || !CONFIG.FRAME_TYPES.has(frameBlock.typeId)) continue;

          // Skip frames whose backing block is another chest — they tag that chest, not this one.

          const behindLoc = { x: frameLoc.x+fx, y: frameLoc.y+fy, z: frameLoc.z+fz };
          const behindBlock = dim.getBlock(behindLoc);
          if (behindBlock && CONFIG.CHEST_TYPES.has(behindBlock.typeId)) continue;
          const item = frameBlock.getItemStack(1, true);
          if (item && !CONFIG.FRAME_TYPES.has(item.typeId)) {
            acceptedItems.push(item.typeId); // no break — keep scanning remaining faces
          }
        } catch { continue; }
      }

      if (acceptedItems.length > 0) {
        for (const acceptedItem of acceptedItems) results.push({ loc, acceptedItem });
      } else {
        results.push({ loc, acceptedItem: null }); // no frames → catch-all by contents
      }
    } catch { continue; }
  }
  return results;
};

/**
 * Adds itemStack into a container, capped at maxFillPercent of total slots.
 * Pass 1 tops up existing partial stacks; pass 2 fills empty slots up to the cap.
 * @param {import("@minecraft/server").Container} container
 * @param {import("@minecraft/server").ItemStack} itemStack
 * @param {number} maxFillPercent
 * @returns {number} Number of items that could not be placed.
 */
export const addToContainer = (container, itemStack, maxFillPercent = 100) => {
  const maxSlots = Math.floor((maxFillPercent / 100) * container.size);

  let usedSlots = 0;
  for (let i = 0; i < container.size; i++) {
    if (container.getItem(i)) usedSlots++;
  }

  let remaining = itemStack.amount;

  // Pass 1: top up existing partial stacks of the same type

  for (let i = 0; i < container.size && remaining > 0; i++) {
    const slot = container.getItem(i);
    if (!slot || slot.typeId !== itemStack.typeId || slot.amount >= slot.maxAmount) continue;
    const toAdd = Math.min(slot.maxAmount - slot.amount, remaining);
    slot.amount += toAdd;
    container.setItem(i, slot);
    remaining -= toAdd;
  }

  // Pass 2: fill empty slots up to the cap

  for (let i = 0; i < container.size && remaining > 0; i++) {
    if (container.getItem(i)) continue;
    if (usedSlots >= maxSlots) break;
    const toPlace = itemStack.clone();
    toPlace.amount = remaining;
    container.setItem(i, toPlace);
    usedSlots++;
    return 0;
  }

  return remaining;
};
