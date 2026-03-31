import { world, system } from "@minecraft/server";
import { CONFIG } from "./config.js";
import { loadAll, loadSettings, findRegistered, recordSortBatch, findOverflowChest, loadOverflowChests, unregisterOverflowChest } from "./persistence.js";
import { getContainer, findOutputChests, addToContainer } from "./blocks.js";
import { showManageForm, showBreakConfirmForm } from "./form.js";
import { outputCache, cacheKey, invalidateFor } from "./cache.js";
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
// worldLoad starts two intervals: one for sorting, one for live radius previews.
// Both use the same self-restart pattern to pick up setting changes mid-session.

world.afterEvents.worldLoad.subscribe(() => {
  let settings = loadSettings();
  let currentInterval = settings.sortInterval;
  let intervalId = system.runInterval(runSort, currentInterval);

  let currentPreviewTicks = settings.previewTicks;
  let previewIntervalId = system.runInterval(runLivePreviews, currentPreviewTicks);

  function runLivePreviews() {
    const s = loadSettings();
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

    // loadAll() called once — array reused for cache miss handling below.

    const allChests = loadAll();

    // tickRoutingCache: built from outputCache each tick, keyed by cacheKey.
    // outputCache stores {loc, dimension, acceptedItem}[] across ticks (plain data only —
    // Container objects are tick-scoped and cannot be held across ticks).
    // findOutputChests is only called on a cache miss; hits skip all block reads.
    // routingMap is rebuilt each tick because Containers are tick-scoped and
    // untagged chest routing must reflect current chest contents.

    /** @type {Map<string, Map<string, import("@minecraft/server").Container>>} */
    const tickRoutingCache = new Map();

    for (const inputChest of allChests) {
      if (!inputChest.enabled) continue;
      try {
        const dim = world.getDimension(inputChest.dimension);
        const inputContainer = getContainer(inputChest, dim);
        if (!inputContainer) continue;

        const key = cacheKey(inputChest);

        // Populate cache on miss. Networked chests scan all members and merge results
        // under one shared key — so the scan only runs once per networkId per miss.

        if (!outputCache.has(key)) {
          /** @type {{ loc: {x:number,y:number,z:number}, dimension: string, acceptedItem: string|null }[]} */
          const entries = [];
          const members = inputChest.networkId
            ? allChests.filter(c => c.networkId === inputChest.networkId)
            : [inputChest];
          for (const member of members) {
            const memberDim = world.getDimension(member.dimension);
            for (const { loc, acceptedItem } of findOutputChests(member, memberDim)) {
              entries.push({ loc, dimension: member.dimension, acceptedItem });
            }
          }
          outputCache.set(key, entries);
        }

        // Build tick-local routingMap from cached locations. Shared per key so all
        // chests in a network build the map only once per tick.

        if (!tickRoutingCache.has(key)) {
          /** @type {Map<string, import("@minecraft/server").Container>} */
          const routingMap = new Map();
          for (const { loc, dimension: entryDim, acceptedItem } of outputCache.get(key)) {
            const container = getContainer(loc, world.getDimension(entryDim));
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
          tickRoutingCache.set(key, routingMap);
        }

        const routingMap = tickRoutingCache.get(key);

        // Overflow container: fetched fresh each tick (tick-scoped). Receives items
        // with no matching route. Null if no overflow chest is registered for this network.

        const overflowEntry = findOverflowChest(inputChest.networkId);
        const overflowContainer = overflowEntry
          ? getContainer(overflowEntry, world.getDimension(overflowEntry.dimension))
          : null;

        /** @type {Record<string, number>} */
        const sortedItems = {};
        for (let i = 0; i < inputContainer.size; i++) {
          const item = inputContainer.getItem(i);
          if (!item) continue;

          // Route to matched output chest, or fall back to overflow. If neither exists, skip.

          const dest = routingMap.get(item.typeId) ?? overflowContainer ?? null;
          if (!dest) continue;

          const leftover = addToContainer(dest, item.clone(), inputChest.maxFill ?? 100);
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

        if (Object.keys(sortedItems).length > 0) recordSortBatch(inputChest, sortedItems);
      } catch (e) { console.warn("[AutoSorter]", e); }
    }
  }
});

// ── Cache invalidation events ─────────────────────────────────────────────────
// playerPlaceBlock / playerBreakBlock: invalidate any input chest whose radius covers
// the affected block, but only for chest or frame types (the only blocks that affect routing).
// playerBreakBlock also auto-unregisters an overflow chest if the broken block was one.
// playerInteractWithBlock (frame): deferred one tick via system.run() so the cache is
// cleared after the engine commits the frame's new contents.

world.afterEvents.playerPlaceBlock.subscribe((ev) => {
  const typeId = ev.block.typeId;
  if (!CONFIG.CHEST_TYPES.has(typeId) && !CONFIG.FRAME_TYPES.has(typeId)) return;
  invalidateFor(ev.block.location, ev.player.dimension.id);
});

world.afterEvents.playerBreakBlock.subscribe((ev) => {
  const typeId = ev.brokenBlockPermutation.type.id;
  if (!CONFIG.CHEST_TYPES.has(typeId) && !CONFIG.FRAME_TYPES.has(typeId)) return;

  const { location } = ev.block;
  const dimId = ev.player.dimension.id;

  if (CONFIG.CHEST_TYPES.has(typeId)) {
    const match = loadOverflowChests().find(
      o => o.x === location.x && o.y === location.y && o.z === location.z && o.dimension === dimId
    );
    if (match) unregisterOverflowChest(match.networkId);
  }

  invalidateFor(location, dimId);
});

world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
  if (!CONFIG.FRAME_TYPES.has(ev.block.typeId)) return;
  const loc = { ...ev.block.location };
  const dimId = ev.player.dimension.id;
  system.run(() => invalidateFor(loc, dimId));
});
