// World height boundaries used to clamp particle spawn positions

export const WORLD_MIN_Y = -64;
export const WORLD_MAX_Y = 320;

// Particle effect options the player can choose for radius preview visualization

export const PARTICLE_OPTIONS = [
  "minecraft:villager_happy",
  "minecraft:basic_flame_particle",
  "minecraft:basic_smoke_particle",
  "minecraft:totem_particle",
  "minecraft:endrod",
  "minecraft:water_splash_particle",
];

// Scan mode labels shown in the register/edit form; each restricts which directions the sorter scans.

export const SCAN_MODES = [
  "Cube (all directions)",   // [0] Full 3D cube around the input chest
  "Flat (same Y level only)", // [1] Only chests on the same horizontal plane
  "Line X (east/west)",       // [2] Only chests along the X axis
  "Line Z (north/south)",     // [3] Only chests along the Z axis
  "Line Y (up/down)",         // [4] Only chests directly above/below
];

// Default global settings applied when no saved settings exist

export const DEFAULT_SETTINGS = Object.freeze({
  particle: PARTICLE_OPTIONS[0],  // Particle type used for preview
  previewTicks: 100,              // How many game ticks the preview runs (100t = 5s)
  notifications: true,            // Whether chat messages are sent to the player
  sortInterval: 40,               // Ticks between each sort pass (40t = 2s)
});

// Core runtime constants used across multiple modules

export const CONFIG = Object.freeze({
  PROP_CHESTS:    "autosort:input_chests",    // Dynamic property key storing all registered input chests (JSON array)
  PROP_SETTINGS:  "autosort:settings",        // Dynamic property key storing global settings (JSON object)
  PROP_OVERFLOW:  "autosort:overflow_chests", // Dynamic property key storing overflow chests per networkId (JSON array)
  CHEST_TYPES: new Set(["minecraft:chest", "minecraft:trapped_chest"]), // Block type IDs treated as sortable chests
  FRAME_TYPES: new Set(["minecraft:item_frame", "minecraft:glow_item_frame", "minecraft:frame", "minecraft:glow_frame"]), // Item frame type IDs used to tag output chests
  PREVIEW_PULSE: 15,      // Ticks between each particle pulse during preview (15t = 0.75s)
  PARTICLE_STEP: 0.75,    // Spacing (in blocks) between particles drawn along preview edges
});

// Unit vectors for all 6 cardinal faces, used to check each neighbor of an output chest for a tag frame.

export const FACES = Object.freeze([
  { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 },
]);

// Minecraft color/format code shortcuts for building chat and form text

export const C = Object.freeze({
  green:  "§a",
  red:    "§c",
  yellow: "§e",
  aqua:   "§b",
  gray:   "§7",
  white:  "§f",
  bold:   "§l",
  reset:  "§r",
});
