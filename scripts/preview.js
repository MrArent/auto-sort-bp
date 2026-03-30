import { world, system } from "@minecraft/server";
import { WORLD_MIN_Y, WORLD_MAX_Y, SCAN_MODES, CONFIG } from "./config.js";
import { loadSettings } from "./persistence.js";

/**
 * Clamps y so particles are never spawned outside the world's valid height range.
 * @param {number} y @returns {number}
 */
const clampY = (y) => Math.max(WORLD_MIN_Y + 1, Math.min(WORLD_MAX_Y - 1, y));

/**
 * Spawns a single particle at (px, py, pz), clamping Y first. Silently ignores errors.
 * @param {import("@minecraft/server").Dimension} dim
 * @param {string} particle
 * @param {number} px @param {number} py @param {number} pz
 */
const spawn = (dim, particle, px, py, pz) => {
  const cy = clampY(py);
  try { dim.spawnParticle(particle, { x: px, y: cy, z: pz }); } catch {}
};

/**
 * Visualizes the scan radius by spawning particles along the boundary every PREVIEW_PULSE ticks.
 * Shape matches scanMode: Flat (square outline), Line X/Z/Y (single line), Cube (12 box edges).
 * @param {{ x: number, y: number, z: number, dimension: string, radius: number, scanMode: string }} center
 */
export const showRadiusPreview = (center) => {
  const settings = loadSettings();
  const dim = world.getDimension(center.dimension);
  const r = center.radius + 0.5;
  const s = CONFIG.PARTICLE_STEP;
  const { x, y, z, scanMode } = center;
  let elapsed = 0;

  const id = system.runInterval(() => {
    if (scanMode === SCAN_MODES[1]) {
      // Flat: square outline at the same Y level
      for (let t = -r; t <= r; t += s) {
        spawn(dim, settings.particle, x+t, y, z-r);
        spawn(dim, settings.particle, x+t, y, z+r);
        spawn(dim, settings.particle, x-r, y, z+t);
        spawn(dim, settings.particle, x+r, y, z+t);
      }
    } else if (scanMode === SCAN_MODES[2]) {
      // Line X
      for (let t = -r; t <= r; t += s) spawn(dim, settings.particle, x+t, y, z);
    } else if (scanMode === SCAN_MODES[3]) {
      // Line Z
      for (let t = -r; t <= r; t += s) spawn(dim, settings.particle, x, y, z+t);
    } else if (scanMode === SCAN_MODES[4]) {
      // Line Y
      for (let t = -r; t <= r; t += s) spawn(dim, settings.particle, x, y+t, z);
    } else {
      // Cube: all 12 edges of the bounding box
      for (let t = -r; t <= r; t += s) {
        // Bottom face
        spawn(dim, settings.particle, x+t, y-r, z-r);
        spawn(dim, settings.particle, x+t, y-r, z+r);
        spawn(dim, settings.particle, x-r, y-r, z+t);
        spawn(dim, settings.particle, x+r, y-r, z+t);
        // Top face
        spawn(dim, settings.particle, x+t, y+r, z-r);
        spawn(dim, settings.particle, x+t, y+r, z+r);
        spawn(dim, settings.particle, x-r, y+r, z+t);
        spawn(dim, settings.particle, x+r, y+r, z+t);
        // Vertical edges
        spawn(dim, settings.particle, x-r, y+t, z-r);
        spawn(dim, settings.particle, x-r, y+t, z+r);
        spawn(dim, settings.particle, x+r, y+t, z-r);
        spawn(dim, settings.particle, x+r, y+t, z+r);
      }
    }

    elapsed += CONFIG.PREVIEW_PULSE;
    if (elapsed >= settings.previewTicks) system.clearRun(id);
  }, CONFIG.PREVIEW_PULSE);
};
