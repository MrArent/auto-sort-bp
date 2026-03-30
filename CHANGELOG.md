# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [1.0.2] - 2026-03-30

### Added
- **Live preview toggle** per chest — particles continuously outline the scan radius until toggled off, replacing the one-shot timed preview. Accessible from both the sneak+right-click form and the Manage All Chests form. State is saved per chest and persists across world reloads.

### Fixed
- **Multiple item frames on one output chest** — only the first frame was ever read due to a `break` in the face scan loop. All frames on a chest are now collected and each registers its item type in the routing map independently.

### Changed
- Pack display name updated to `AUTO SORT BP [DEV]`

---

## [1.0.1] - 2026-03-30

### Changed
- **Sort loop — `loadAll()` called once per tick** instead of N+1 times. The chest registry (`JSON.parse` of the entire stored array) was being deserialized once for the outer loop and again inside the loop for every networked chest. The parsed array is now stored before the loop and reused for network filtering.
- **Sort stats — batched into a single write per pass** instead of one read/write per item moved. The old `recordSort` (called per item) and `incrementSortRun` (called once per pass) each did a full dynamic property read and write. These are replaced by `recordSortBatch`, which accumulates all item counts during the sort loop and performs a single read and write at the end of each pass.
- **`getCandidateLocations` — mode-specific iteration** instead of always running the full O((2r+1)³) triple-nested loop and filtering. The original code iterated every position in a cube and skipped invalid ones with `if` checks regardless of scan mode. Each mode now uses its own loop structure, eliminating wasted iterations:
  - Cube: O((2r+1)³) — unchanged
  - Flat: O((2r+1)²) — 41× fewer iterations at r=20
  - Line X / Z / Y: O(2r) — 1,723× fewer iterations at r=20

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
