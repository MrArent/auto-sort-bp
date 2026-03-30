import { world, system } from "@minecraft/server";
import { ActionFormData, MessageFormData, ModalFormData } from "@minecraft/server-ui";
import { PARTICLE_OPTIONS, SCAN_MODES } from "./config.js";
import { loadAll, loadSettings, saveSettings, registerChest, unregisterChest, findRegistered, notify, getStats } from "./persistence.js";
import { getContainer, findOutputChests } from "./blocks.js";
import { showRadiusPreview } from "./preview.js";

/**
 * @typedef {import("./persistence.js").InputChest} InputChest
 * @typedef {{ x: number, y: number, z: number, dimension: string }} Loc
 */

/**
 * Main entry-point form shown when a player sneaks + right-clicks a chest.
 * Body and buttons vary by whether the clicked chest is registered, unregistered, or absent.
 * @param {import("@minecraft/server").Player} player @param {Loc | null} clickedLoc
 */
export const showManageForm = (player, clickedLoc) => {
  const all = loadAll();
  const clicked = clickedLoc ? findRegistered(clickedLoc) : null;
  const isRegistered = !!clicked;
  const settings = loadSettings();
  const totalSorted = all.reduce((sum, c) => sum + (getStats(c).totalSorted ?? 0), 0);

  const form = new ActionFormData()
    .title("Auto Chest Sorter")
    .body(
      clickedLoc
        ? isRegistered
          ? `${clicked.label} at §b${clickedLoc.x}, ${clickedLoc.y}, ${clickedLoc.z}§r\nRadius: §b${clicked.radius}§r blocks\nMode: §b${clicked.scanMode}§r\nNetwork: §b${clicked.networkId ?? "none"}§r\nStatus: ${clicked.enabled ? "§aActive§r" : "§cPaused§r"}\n${all.length} chest(s) registered.\nTotal sorted: §e${totalSorted}`
          : `Unregistered chest at §b${clickedLoc.x}, ${clickedLoc.y}, ${clickedLoc.z}§r\n${all.length} chest(s) registered.\nTotal sorted: §e${totalSorted}`
        : `${all.length} chest(s) registered.\nTotal sorted: §e${totalSorted}\nNotifications: ${settings.notifications ? "§aOn§r" : "§cOff§r"}`
    );

  /** @type {string[]} */
  const actions = [];
  if (clickedLoc && !isRegistered) { form.button("Set as Input Chest",        "textures/blocks/chest_front"); actions.push("set"); }
  if (clickedLoc && isRegistered)  { form.button("Preview Radius",             "textures/blocks/chest_front"); actions.push("preview"); }

  // ADDED: Live Preview toggle button, placed directly below "Preview Radius" to group the two
  // preview-related actions together. Label reflects current state (green ON / gray OFF).
  // Old: there was no livePreview button here; "Preview Radius" was immediately followed by "Edit".

  if (clickedLoc && isRegistered)  { form.button(clicked.livePreview ? "§aLive Preview: ON§r" : "§7Live Preview: OFF§r", "textures/blocks/chest_front"); actions.push("livePreview"); }
  if (clickedLoc && isRegistered)  { form.button("Edit Label / Radius / Mode", "textures/blocks/chest_front"); actions.push("edit"); }
  if (clickedLoc && isRegistered)  { form.button(clicked.enabled ? "§cPause Sorting§r" : "§aResume Sorting§r", "textures/blocks/chest_front"); actions.push("toggle"); }
  if (clickedLoc && isRegistered)  { form.button("View Stats",                 "textures/blocks/chest_front"); actions.push("stats"); }
  if (all.length > 0)              { form.button("Manage All Chests",           "textures/blocks/chest_front"); actions.push("manage"); }
  form.button("Settings",  "textures/blocks/chest_front"); actions.push("settings");
  form.button("Cancel",    "textures/blocks/chest_front"); actions.push("cancel");

  form.show(player).then((res) => {
    if (res.canceled) return;
    const action = actions[/** @type {number} */ (res.selection)];
    if (action === "set")      system.run(() => showRegisterForm(player, /** @type {any} */ (clickedLoc)));
    if (action === "preview")  system.run(() => showRadiusPreview(/** @type {any} */ (clicked)));

    // ADDED: livePreview handler — flips chest.livePreview, saves, reopens this form so the
    // button label updates immediately to reflect the new state.
    // Old: no "livePreview" action existed; actions array went set → preview → edit → toggle → stats.

    if (action === "livePreview") {
      const updated = { .../** @type {InputChest} */ (clicked), livePreview: !clicked.livePreview };
      registerChest(updated);
      notify(player, `[AutoSorter] Live preview ${updated.livePreview ? "§aenabled§r" : "§cdisabled§r"} for "${updated.label}".`);
      system.run(() => showManageForm(player, clickedLoc));
    }
    if (action === "edit")     system.run(() => showRegisterForm(player, /** @type {any} */ (clickedLoc), /** @type {any} */ (clicked)));
    if (action === "toggle") {
      const updated = { .../** @type {InputChest} */ (clicked), enabled: !clicked.enabled };
      registerChest(updated);
      notify(player, `[AutoSorter] "${updated.label}" ${updated.enabled ? "§aResumed§r" : "§cPaused§r"}.`);
      system.run(() => showManageForm(player, clickedLoc));
    }
    if (action === "stats")    system.run(() => showStatsForm(player, /** @type {any} */ (clicked), clickedLoc));
    if (action === "manage")   system.run(() => showAllChestsForm(player, clickedLoc));
    if (action === "settings") system.run(() => showSettingsForm(player, clickedLoc));
  }).catch(() => {});
};

/**
 * Form for registering a new input chest or editing an existing one.
 * Fields: label, network ID, scan radius, scan mode, max fill %.
 * @param {import("@minecraft/server").Player} player @param {Loc} loc @param {InputChest | null} [existing] @param {(() => void) | null} [onBack]
 */
export const showRegisterForm = (player, loc, existing = null, onBack = null) => {
  const modeIndex = existing ? Math.max(0, SCAN_MODES.indexOf(existing.scanMode)) : 0;

  new ModalFormData()
    .title(existing ? "Edit Input Chest" : "Register Input Chest")
    .textField("Label", `Chest ${loc.x},${loc.y},${loc.z}`, { defaultValue: existing?.label ?? "" })
    .textField("Network ID (optional)", "e.g. network1", { defaultValue: existing?.networkId ?? "" })
    .slider("Scan Radius (blocks)", 1, 20, { valueStep: 1, defaultValue: existing?.radius ?? 5 })
    .dropdown("Scan Mode", SCAN_MODES, { defaultValueIndex: modeIndex })
    .slider("Max Fill % (output chests)", 10, 100, { valueStep: 5, defaultValue: existing?.maxFill ?? 100 })
    .show(player)
    .then((res) => {
      if (res.canceled || !res.formValues) { system.run(() => onBack ? onBack() : showManageForm(player, loc)); return; }
      const label     = (/** @type {string} */ (res.formValues[0])).trim() || `${loc.x},${loc.y},${loc.z}`;
      const networkId = (/** @type {string} */ (res.formValues[1])).trim() || null;
      const radius    = /** @type {number} */ (res.formValues[2]);
      const scanMode  = SCAN_MODES[/** @type {number} */ (res.formValues[3])];
      const maxFill   = /** @type {number} */ (res.formValues[4]);

      // CHANGED: livePreview field added to the chest object.
      // Old: const chest = { ...loc, label, networkId, radius, scanMode, maxFill, enabled: existing?.enabled ?? true };
      // existing?.livePreview preserves the flag when editing; ?? false defaults new chests to off.

      const chest     = { ...loc, label, networkId, radius, scanMode, maxFill, enabled: existing?.enabled ?? true, livePreview: existing?.livePreview ?? false };
      registerChest(chest);
      notify(player, `[AutoSorter] "${label}" ${existing ? "updated" : "§aregistered§r"} (r:§b${radius}§r, ${scanMode}, fill:§b${maxFill}%§r${networkId ? `, net:§b${networkId}§r` : ""})`);
      system.run(() => { showRadiusPreview(chest); onBack ? onBack() : showManageForm(player, loc); });
    }).catch(() => {});
};

/**
 * Lists all registered input chests as buttons. Selecting one opens showChestActionsForm.
 * @param {import("@minecraft/server").Player} player @param {Loc | null} returnLoc
 */
export const showAllChestsForm = (player, returnLoc) => {
  const all = loadAll();
  if (!all.length) { player.sendMessage("§c[AutoSorter]§r No input chests registered."); return; }

  const form = new ActionFormData()
    .title("Registered Input Chests")
    .body(`${all.length} input chest(s). Select one to manage.`);

  all.forEach(c => form.button(
    `${c.enabled ? "§a" : "§c"}${c.label}§r  r:${c.radius}  ${c.scanMode.split(" ")[0]}${c.networkId ? `  §bnet:${c.networkId}§r` : ""}\n§7${c.x}, ${c.y}, ${c.z}`,
    "textures/blocks/chest_front"
  ));
  form.button("Back");

  form.show(player).then((res) => {
    if (res.canceled) { system.run(() => showManageForm(player, returnLoc)); return; }
    if (res.selection === all.length) { system.run(() => showManageForm(player, returnLoc)); return; }
    system.run(() => showChestActionsForm(player, all[/** @type {number} */ (res.selection)], returnLoc));
  }).catch(() => {});
};

/**
 * Detailed action form for a single chest: shows live stats and buttons for all actions.
 * @param {import("@minecraft/server").Player} player @param {InputChest} chest @param {Loc | null} returnLoc
 */
export const showChestActionsForm = (player, chest, returnLoc) => {
  const dim = world.getDimension(chest.dimension);
  const outputChests = findOutputChests(chest, dim);
  const inputContainer = getContainer(chest, dim);
  const inputCount = inputContainer
    ? (() => { let n = 0; for (let i = 0; i < inputContainer.size; i++) if (inputContainer.getItem(i)) n++; return n; })()
    : 0;
  const inputSize = inputContainer?.size ?? 27;
  const stats = getStats(chest);

  new ActionFormData()
    .title(chest.label)
    .body(
      `§b${chest.x}, ${chest.y}, ${chest.z}§r\n` +
      `Radius: §b${chest.radius}§r blocks\n` +
      `Mode: §b${chest.scanMode}§r\n` +
      `Network: §b${chest.networkId ?? "none"}§r\n` +
      `Max Fill: §b${chest.maxFill ?? 100}%§r\n` +
      `Status: ${chest.enabled ? "§aActive§r" : "§cPaused§r"}\n` +
      `Dimension: §b${chest.dimension}§r\n` +
      `Input slots used: §b${inputCount}/${inputSize}§r\n` +
      `Output chests found: §b${outputChests.length}§r\n` +
      `Tagged (item frame): §b${outputChests.filter(o => o.acceptedItem).length}§r\n` +
      `Total items sorted: §e${stats.totalSorted}§r`
    )

    // CHANGED: "Live Preview: ON/OFF" button inserted at index 1 (after "Preview Radius").
    // All buttons that followed shifted down by one, so their res.selection values increased by 1.
    // Old button order and selection indices:
    //   0: "Preview Radius"
    //   1: "Edit Label / Radius / Mode"
    //   2: "View Stats"
    //   3: Pause / Resume
    //   4: "§cDelete§r"
    //   5: "Back"
    // New button order:
    //   0: "Preview Radius"          (unchanged)
    //   1: "Live Preview: ON/OFF"    (ADDED)
    //   2: "Edit Label / Radius / Mode"
    //   3: "View Stats"
    //   4: Pause / Resume
    //   5: "§cDelete§r"
    //   6: "Back"

    .button("Preview Radius")
    .button(chest.livePreview ? "§aLive Preview: ON§r" : "§7Live Preview: OFF§r")
    .button("Edit Label / Radius / Mode")
    .button("View Stats")
    .button(chest.enabled ? "§cPause Sorting§r" : "§aResume Sorting§r")
    .button("§cDelete§r")
    .button("Back")
    .show(player)
    .then((res) => {
      if (res.canceled) { system.run(() => showAllChestsForm(player, returnLoc)); return; }
      if (res.selection === 0) system.run(() => { showRadiusPreview(chest); player.sendMessage(`[AutoSorter] Showing radius for "${chest.label}".`); });

      // ADDED: selection 1 handler — flips livePreview, saves, reopens form with updated state.
      // Old selection 1 was "Edit Label / Radius / Mode" (now shifted to selection 2).

      if (res.selection === 1) {
        const updated = { ...chest, livePreview: !chest.livePreview };
        registerChest(updated);
        notify(player, `[AutoSorter] Live preview ${updated.livePreview ? "§aenabled§r" : "§cdisabled§r"} for "${updated.label}".`);
        system.run(() => showChestActionsForm(player, updated, returnLoc));
      }

      // CHANGED: was selection 1, now selection 2.

      if (res.selection === 2) system.run(() => showRegisterForm(player, chest, chest, () => showChestActionsForm(player, chest, returnLoc)));

      // CHANGED: was selection 2, now selection 3.

      if (res.selection === 3) system.run(() => showStatsForm(player, chest, returnLoc, () => showChestActionsForm(player, chest, returnLoc)));

      // CHANGED: was selection 3, now selection 4.

      if (res.selection === 4) {
        const updated = { ...chest, enabled: !chest.enabled };
        registerChest(updated);
        notify(player, `[AutoSorter] "${chest.label}" ${updated.enabled ? "§aResumed§r" : "§cPaused§r"}.`);
        system.run(() => showChestActionsForm(player, updated, returnLoc));
      }

      // CHANGED: was selection 4, now selection 5.

      if (res.selection === 5) system.run(() => showDeleteConfirm(player, chest, returnLoc));

      // CHANGED: was selection 5, now selection 6.

      if (res.selection === 6) system.run(() => showAllChestsForm(player, returnLoc));
    }).catch(() => {});
};

/**
 * Displays sort statistics for a chest. "Reset Stats" clears the chest's stats property.
 * @param {import("@minecraft/server").Player} player @param {InputChest} chest @param {Loc | null} returnLoc @param {(() => void) | null} [onBack]
 */
export const showStatsForm = (player, chest, returnLoc, onBack = null) => {
  const stats = getStats(chest);
  const topItems = Object.entries(stats.itemCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  let body = `§lStats for "${chest.label}"§r\n\n`;
  body += `§7Total sorts run: §e${stats.sortRuns}§r\n`;
  body += `§7Total items sorted: §e${stats.totalSorted}§r\n\n`;
  body += `§7Top items:\n`;
  if (topItems.length === 0) {
    body += `§8No items sorted yet.`;
  } else {
    for (const [item, count] of topItems) {
      body += `§f${item.replace("minecraft:", "")}: §e${count}§r\n`;
    }
  }

  new ActionFormData()
    .title("Chest Stats")
    .body(body)
    .button("§cReset Stats")
    .button("Back")
    .show(player)
    .then((res) => {
      if (res.canceled) { system.run(() => onBack ? onBack() : showManageForm(player, returnLoc)); return; }
      if (res.selection === 0) {
        world.setDynamicProperty(`autosort:stats:${chest.x}:${chest.y}:${chest.z}:${chest.dimension}`, undefined);
        player.sendMessage(`§c[AutoSorter]§r Stats reset for "${chest.label}".`);
        system.run(() => showManageForm(player, returnLoc));
      }
      if (res.selection === 1) system.run(() => onBack ? onBack() : showManageForm(player, returnLoc));
    }).catch(() => {});
};

/**
 * Confirmation dialog before breaking a chest. Unregisters it and drops it as an item via setblock destroy.
 * @param {import("@minecraft/server").Player} player @param {InputChest} chest @param {Loc | null} returnLoc
 */
export const showDeleteConfirm = (player, chest, returnLoc) => {
  new MessageFormData()
    .title("Delete Chest")
    .body(`Delete "${chest.label}" at §b${chest.x}, ${chest.y}, ${chest.z}§r?\n\nThe chest will drop as an item and its registration will be removed.`)
    .button1("Cancel")
    .button2("§cBreak Chest§r")
    .show(player)
    .then((res) => {
      if (res.canceled || res.selection === 0) { system.run(() => showChestActionsForm(player, chest, returnLoc)); return; }
      unregisterChest(chest);
      player.sendMessage(`§c[AutoSorter]§r "${chest.label}" removed.`);
      system.run(() => {
        try { world.getDimension(chest.dimension).runCommand(`setblock ${chest.x} ${chest.y} ${chest.z} air destroy`); } catch {}
        showAllChestsForm(player, returnLoc);
      });
    }).catch(() => {});
};

/**
 * Global settings form: particle type, preview duration, sort interval, notifications.
 * Durations are displayed in seconds but stored as ticks (×20).
 * @param {import("@minecraft/server").Player} player @param {Loc | null} returnLoc
 */
export const showSettingsForm = (player, returnLoc) => {
  const s = loadSettings();
  const particleIndex = Math.max(0, PARTICLE_OPTIONS.indexOf(s.particle));

  new ModalFormData()
    .title("Auto Sorter Settings")
    .dropdown("Preview Particle", PARTICLE_OPTIONS, { defaultValueIndex: particleIndex })
    .slider("Preview Duration (seconds)", 1, 30, { valueStep: 1, defaultValue: Math.round(s.previewTicks / 20) })
    .slider("Sort Interval (seconds)", 1, 10, { valueStep: 1, defaultValue: Math.round(s.sortInterval / 20) })
    .toggle("Chat Notifications", { defaultValue: s.notifications })
    .show(player)
    .then((res) => {
      if (res.canceled || !res.formValues) { system.run(() => showManageForm(player, returnLoc)); return; }
      const particle      = PARTICLE_OPTIONS[/** @type {number} */ (res.formValues[0])];
      const previewTicks  = /** @type {number} */ (res.formValues[1]) * 20; // seconds → ticks
      const sortInterval  = /** @type {number} */ (res.formValues[2]) * 20; // seconds → ticks
      const notifications = /** @type {boolean} */ (res.formValues[3]);
      saveSettings({ particle, previewTicks, sortInterval, notifications });
      notify(player, `[AutoSorter] Settings saved (sort:§b${res.formValues[2]}s§r, notifs:${notifications ? "§aon§r" : "§coff§r"})`);
      system.run(() => showManageForm(player, returnLoc));
    }).catch(() => {});
};

/**
 * Shown when a player tries to break a registered input chest (break is pre-cancelled).
 * Keep Chest restores the block via setPermutation; Break Chest unregisters it and drops it via setblock destroy.
 * @param {import("@minecraft/server").Player} player @param {Loc} loc @param {import("@minecraft/server").BlockPermutation} permutation
 */
export const showBreakConfirmForm = (player, loc, permutation) => {
  const chest = findRegistered(loc);
  if (!chest) return;
  new MessageFormData()
    .title("Auto Chest Sorter")
    .body(`"${chest.label}" at §b${loc.x}, ${loc.y}, ${loc.z}§r is a registered input chest.\n\nDelete its registration?`)
    .button1("§aKeep Chest§r")
    .button2("§cBreak Chest§r")
    .show(player)
    .then((res) => {
      if (res.canceled || res.selection === 0) {
        system.run(() => { try { world.getDimension(loc.dimension).getBlock(loc)?.setPermutation(permutation); } catch {} });
      } else {
        unregisterChest(loc);
        player.sendMessage(`§c[AutoSorter]§r "${chest.label}" deleted.`);
        system.run(() => {
          try { world.getDimension(loc.dimension).runCommand(`setblock ${loc.x} ${loc.y} ${loc.z} air destroy`); } catch {}
        });
      }
    }).catch(() => {});
};
