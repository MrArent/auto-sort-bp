# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Added
- **Overflow chest** — designate a fallback output chest per network ID. Items with no matching route are sent there instead of staying in the input chest. Registered via "Set as Overflow Chest" in the sneak+right-click form, which appears only for unregistered chests when at least one network has no overflow assigned. A dropdown selects the target network. Breaking an overflow chest automatically unregisters it.
- **Output chest cache** — `findOutputChests` results are now cached across sort ticks and only rebuilt on a cache miss. Misses are triggered by: chest placed/broken within radius, item frame placed/broken within radius, frame contents changed, or chest config edited. On stable worlds with no block changes, the per-tick block scan cost drops to zero.

### Fixed
- **New networked chest missing its output pool on first sort** — registering a new input chest into an existing network did not invalidate the network's output cache, so the new chest sorted using the stale cache built without it. Its outputs were only discovered after a frame interaction happened to trigger a cache invalidation. Cache is now always invalidated on registration.

---

## [1.1.0] - 2026-03-30

### Added
- **Live preview toggle** per chest — particles continuously outline the scan radius until toggled off, replacing the one-shot timed preview. Accessible from both the sneak+right-click form and the Manage All Chests form. State is saved per chest and persists across world reloads.

### Fixed
- **Multiple item frames on one output chest** — only the first frame was ever read due to a `break` in the face scan loop. All frames on a chest are now collected and each registers its item type in the routing map independently.

### Changed
- **Sort loop — `loadAll()` called once per tick** instead of N+1 times. The chest registry (`JSON.parse` of the entire stored array) was being deserialized once for the outer loop and again inside the loop for every networked chest. The parsed array is now stored before the loop and reused for network grouping.
- **Network filtering — O(N²) → O(N)** by replacing per-chest `allChests.filter()` with a single pre-built `Map<networkId, InputChest[]>`. Previously each of the N networked chests scanned the full chest list to find its group members; the map is now built in one pass and each lookup inside the loop is O(1).
- **Routing map — built once per unique networkId** instead of once per chest. All chests sharing a networkId produce an identical routing map (same output pool). These maps are now computed once into a cache before the sort loop and reused via O(1) lookup, eliminating M²−M redundant `findOutputChests` block-read sweeps for a network of M chests.
- **Sort stats — batched into a single write per pass** instead of one read/write per item moved. The old `recordSort` (called per item) and `incrementSortRun` (called once per pass) each did a full dynamic property read and write. These are replaced by `recordSortBatch`, which accumulates all item counts during the sort loop and performs a single read and write at the end of each pass.
- **`getCandidateLocations` — mode-specific iteration** instead of always running the full O((2r+1)³) triple-nested loop and filtering. The original code iterated every position in a cube and skipped invalid ones with `if` checks regardless of scan mode. Each mode now uses its own loop structure, eliminating wasted iterations:
  - Cube: O((2r+1)³) — unchanged
  - Flat: O((2r+1)²) — 41× fewer iterations at r=20
  - Line X / Z / Y: O(2r) — 1,723× fewer iterations at r=20

---

## [1.0.1] - 2026-03-30

### Fixed
- **Placing a chest while sneaking** — sneaking + right-clicking while holding a chest or item frame now allows normal block placement instead of opening the sorter form.

### Changed
- **API versions updated for Realms and current Minecraft compatibility** — `@minecraft/server` changed from `2.6.0-beta` to `2.6.0` and `@minecraft/server-ui` changed from `2.1.0-beta` to `2.0.0`. Beta API experiment flag no longer required.

---

## [1.0.0] - 2026-03-30

### Added
- Initial release
- Input chest registration via sneak + right-click with configurable label, scan radius, scan mode, max fill %, and network ID
- Output chest detection by scanning the area around an input chest
- Item frame tagging — place a frame on an output chest to designate accepted item types
- Untagged output chest support — routes items by current chest contents
- Five scan modes: Cube, Flat, Line X, Line Z, Line Y
- Configurable sort interval (default 2 seconds)
- Network ID support — link multiple input chests to share a pool of output chests
- One-shot radius preview using configurable particles
- Sort statistics per chest — total items sorted, sort runs, and per-type breakdowns
- Pause / Resume per chest
- Global settings form — particle type, preview duration, sort interval, chat notifications
- Break protection — intercepts breaking a registered chest and prompts to keep or delete registration
