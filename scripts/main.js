import { world, system } from "@minecraft/server";
import { CONFIG } from "./config.js";

// CHANGED: replaced { recordSort, incrementSortRun } with { recordSortBatch }.
// Old: import { loadAll, loadSettings, findRegistered, recordSort, incrementSortRun } from "./persistence.js";
// recordSort wrote stats once per item moved; incrementSortRun wrote again at the end of each pass.
// That was up to (slots + 1) separate dynamic-property read/write pairs per chest per tick.
// recordSortBatch does one read and one write for the whole pass regardless of how many items moved.

import { loadAll, loadSettings, findRegistered, recordSortBatch } from "./persistence.js";
import { getContainer, findOutputChests, addToContainer } from "./blocks.js";
import { showManageForm, showBreakConfirmForm } from "./form.js";

// ADDED: showRadiusPreview imported here so the live preview loop in worldLoad can call it.
// Old: preview.js was only imported inside form.js; main.js had no direct dependency on it.

import { showRadiusPreview } from "./preview.js";

// Per-player cooldown to prevent the manage form opening multiple times in rapid succession.

const formCooldown = new Set();

// ── Interact event ────────────────────────────────────────────────────────────
// Opens the manage form when a player sneaks + right-clicks a chest.
// Skipped if the held item is a frame or chest (allows normal placement).
// ev.cancel stops the chest UI; system.run() defers the form out of beforeEvents.

world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
  const { player, block } = ev;
  if (!player.isSneaking || !CONFIG.CHEST_TYPES.has(block.typeId)) return;
  const inv = player.getComponent("inventory")?.container;
  const held = inv?.getItem(player.selectedSlotIndex) ?? ev.itemStack;
  if (held && CONFIG.FRAME_TYPES.has(held.typeId)) return;
  if (held && CONFIG.CHEST_TYPES.has(held.typeId)) return;

  if (formCooldown.has(player.id)) return;
  const loc = { ...block.location, dimension: player.dimension.id };
  ev.cancel = true;
  formCooldown.add(player.id);
  system.run(() => {
    showManageForm(player, loc);
    system.runTimeout(() => formCooldown.delete(player.id), 10);
  });
});

// ── Block break event ─────────────────────────────────────────────────────────
// Intercepts breaks on registered input chests; cancels the break and shows a
// confirmation form so the player can keep or delete the registration.

world.beforeEvents.playerBreakBlock.subscribe((ev) => {
  const { player, block } = ev;
  if (!CONFIG.CHEST_TYPES.has(block.typeId)) return;
  const loc = { ...block.location, dimension: player.dimension.id };
  if (!findRegistered(loc)) return;
  ev.cancel = true;
  const permutation = block.permutation; // captured before the block is modified
  system.run(() => showBreakConfirmForm(player, loc, permutation));
});

// ── Sort loop + live preview loop ────────────────────────────────────────────
// CHANGED: worldLoad now starts two intervals instead of one.
// Old header: "// ── Sort loop ─────────────────────────────────────────────────────────────────"
// Old worldLoad only set up the sort interval; preview was purely player-triggered (one-shot buttons).
// The new runLivePreviews interval re-fires showRadiusPreview every previewTicks for any chest with
// livePreview:true. showRadiusPreview runs for previewTicks then expires, so re-firing at that same
// cadence chains previews back-to-back with no visible gap.
// Both intervals use the same self-restart pattern: if the relevant setting changes, clear and
// re-schedule at the new rate.

world.afterEvents.worldLoad.subscribe(() => {
  let settings = loadSettings();
  let currentInterval = settings.sortInterval;
  let intervalId = system.runInterval(runSort, currentInterval);

  // ── Live preview loop ──────────────────────────────────────────────────────
  // ADDED: entire block below is new. Old worldLoad had no second interval.
  // Old:
  //   world.afterEvents.worldLoad.subscribe(() => {
  //     let settings = loadSettings();
  //     let currentInterval = settings.sortInterval;
  //     let intervalId = system.runInterval(runSort, currentInterval);
  //     function runSort() { ... }
  //   });

  let currentPreviewTicks = settings.previewTicks;
  let previewIntervalId = system.runInterval(runLivePreviews, currentPreviewTicks);

  function runLivePreviews() {
    const s = loadSettings();

    // If previewTicks changed in settings, restart this interval at the new rate.

    if (s.previewTicks !== currentPreviewTicks) {
      system.clearRun(previewIntervalId);
      currentPreviewTicks = s.previewTicks;
      previewIntervalId = system.runInterval(runLivePreviews, currentPreviewTicks);
      return;
    }
    for (const chest of loadAll()) {
      if (chest.livePreview) showRadiusPreview(chest);
    }
  }

  function runSort() {
    settings = loadSettings();

    if (settings.sortInterval !== currentInterval) {
      system.clearRun(intervalId);
      currentInterval = settings.sortInterval;
      intervalId = system.runInterval(runSort, currentInterval);
      return;
    }

    // CHANGED: loadAll() is now called once before the loop and stored in allChests.
    // Old: for (const inputChest of loadAll()) { ... loadAll().filter(...) }
    // The original code called loadAll() (JSON.parse of the entire chest registry) once for
    // the outer for-of, then called it AGAIN inside the loop for every chest that had a networkId.
    // With N networked chests that was N+1 full deserializations per sort tick.
    // Now the single parsed array is reused for network grouping below.

    const allChests = loadAll();

    // CHANGED: Build networkGroups Map once before the outer loop — O(N) total.
    // Old: const networkChests = allChests.filter(c => c.networkId === inputChest.networkId)
    // That filter ran inside the loop, so each of the N networked chests scanned all N chests
    // to find its group members — O(N) per chest = O(N²) total.
    // The Map is built in one O(N) pass; each lookup inside the loop is O(1).

    /** @type {Map<string, import("./persistence.js").InputChest[]>} */
    const networkGroups = new Map();

    for (const chest of allChests) {
      if (!chest.networkId) continue;
      if (!networkGroups.has(chest.networkId)) networkGroups.set(chest.networkId, []);
      networkGroups.get(chest.networkId).push(chest);
    }

    // CHANGED: Build routingCache Map once per unique networkId — O(unique_networks × M × R³) block reads.
    // Old: routingMap was rebuilt inside the loop for every input chest. For a network of M chests,
    // findOutputChests was called M times per chest = M² calls total, each scanning up to R³ blocks.
    // All M chests in the same network produce an identical routingMap (same networkId → same output pool),
    // so the M²−M redundant builds were pure waste.
    // Now each unique networkId's routingMap is built exactly once and reused via O(1) cache lookup.

    /** @type {Map<string, Map<string, import("@minecraft/server").Container>>} */
    const routingCache = new Map();

    for (const [networkId, members] of networkGroups) {
      /** @type {Map<string, import("@minecraft/server").Container>} */
      const routingMap = new Map();

      for (const netChest of members) {
        const netDim = world.getDimension(netChest.dimension);

        for (const { loc, acceptedItem } of findOutputChests(netChest, netDim)) {
          const container = getContainer(loc, netDim);
          if (!container) continue;

          if (acceptedItem) {
            if (!routingMap.has(acceptedItem)) routingMap.set(acceptedItem, container);
          } else {
            for (let i = 0; i < container.size; i++) {
              const item = container.getItem(i);
              if (item && !routingMap.has(item.typeId)) routingMap.set(item.typeId, container);
            }
          }
        }
      }

      routingCache.set(networkId, routingMap);
    }

    for (const inputChest of allChests) {
      if (!inputChest.enabled) continue;
      try {
        const dim = world.getDimension(inputChest.dimension);
        const inputContainer = getContainer(inputChest, dim);
        if (!inputContainer) continue;

        // CHANGED: routingMap is now retrieved from routingCache for networked chests (O(1)),
        // or built inline for standalone chests (no networkId). The old networkChests array and
        // inner for-of loop have been replaced by the pre-built cache above.
        //
        // Old:
        //   const routingMap = new Map();
        //   const networkChests = inputChest.networkId
        //     ? allChests.filter(c => c.networkId === inputChest.networkId)
        //     : [inputChest];
        //   for (const netChest of networkChests) {
        //     const netDim = world.getDimension(netChest.dimension);
        //     for (const { loc, acceptedItem } of findOutputChests(netChest, netDim)) {
        //       const container = getContainer(loc, netDim);
        //       if (!container) continue;
        //       if (acceptedItem) {
        //         if (!routingMap.has(acceptedItem)) routingMap.set(acceptedItem, container);
        //       } else {
        //         for (let i = 0; i < container.size; i++) {
        //           const item = container.getItem(i);
        //           if (item && !routingMap.has(item.typeId)) routingMap.set(item.typeId, container);
        //         }
        //       }
        //     }
        //   }

        let routingMap;

        if (inputChest.networkId) {

          // Networked chest: reuse the pre-built map for this networkId — O(1) lookup.

          routingMap = routingCache.get(inputChest.networkId);
        } else {

          // Standalone chest: build its routingMap inline (no sharing, no cache needed).

          routingMap = new Map();
          const netDim = world.getDimension(inputChest.dimension);

          for (const { loc, acceptedItem } of findOutputChests(inputChest, netDim)) {
            const container = getContainer(loc, netDim);
            if (!container) continue;

            if (acceptedItem) {

              // Tagged chest: first tag for a given item type wins.

              if (!routingMap.has(acceptedItem)) routingMap.set(acceptedItem, container);
            } else {

              // Untagged chest: infer accepted types from current contents.

              for (let i = 0; i < container.size; i++) {
                const item = container.getItem(i);
                if (item && !routingMap.has(item.typeId)) routingMap.set(item.typeId, container);
              }
            }
          }
        }

        // CHANGED: stats are now accumulated in sortedItems and written once after the loop.
        // Old code called recordSort(chest, typeId, amount) for every item moved, then
        // incrementSortRun(chest) at the end. Each of those did getStats() → JSON.parse,
        // modified one field, then setDynamicProperty() → JSON.stringify. For a full 27-slot
        // chest that was 28 read/write pairs per chest per tick just for stats.
        // Now sortedItems collects { typeId: totalMoved } during the loop, and recordSortBatch
        // does a single getStats/setDynamicProperty at the end regardless of item count.
        //
        // Old:
        //   recordSort(inputChest, item.typeId, item.amount);   // per item — N reads + N writes
        //   ...
        //   if (moved > 0) { recordSort(inputChest, item.typeId, moved); didSort = true; }
        //   ...
        //   if (didSort) incrementSortRun(inputChest);          // +1 read + 1 write

        /** @type {Record<string, number>} */
        const sortedItems = {};
        for (let i = 0; i < inputContainer.size; i++) {
          const item = inputContainer.getItem(i);
          if (!item) continue;
          const target = routingMap.get(item.typeId);
          if (!target) continue;
          const leftover = addToContainer(target, item.clone(), inputChest.maxFill ?? 100);
          if (leftover === 0) {
            inputContainer.setItem(i, undefined);
            sortedItems[item.typeId] = (sortedItems[item.typeId] ?? 0) + item.amount;
          } else {
            const moved = item.amount - leftover;
            if (moved > 0) sortedItems[item.typeId] = (sortedItems[item.typeId] ?? 0) + moved;
            const updated = item.clone();
            updated.amount = leftover;
            inputContainer.setItem(i, updated);
          }
        }

        // Single write: 1 read + 1 write instead of (items + 1) read/write pairs.

        if (Object.keys(sortedItems).length > 0) recordSortBatch(inputChest, sortedItems);
      } catch (e) { console.warn("[AutoSorter]", e); }
    }
  }
});
