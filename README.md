<div align="center">

# Auto Sort BP

**A Minecraft Bedrock behavior pack that automatically sorts items from input chests into organized output chests**

[![Minecraft](https://img.shields.io/badge/Minecraft-Bedrock-brightgreen?style=for-the-badge)](https://www.minecraft.net/)
[![JavaScript](https://img.shields.io/badge/JavaScript-Scripting%20API-yellow?style=for-the-badge&logo=javascript)](https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/)
[![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)

</div>

---

## What is Auto Sort BP?

**Auto Sort BP** is a Minecraft Bedrock behavior pack powered by the Scripting API. It lets you designate an **input chest** that automatically pushes items into nearby **output chests** on a configurable timer — no redstone, hoppers, or commands required.

Tag output chests with **item frames** to target specific item types, or leave them untagged to route items by whatever is already inside. Multiple input chests can be linked into a **network** to share a single pool of output chests.

---

## Features

- **Automatic sorting** on a configurable interval (default: 2 seconds)
- **Item frame tagging** — place a frame on an output chest to designate what it accepts
- **Multi-frame support** — attach multiple frames to one chest to accept multiple item types
- **Scan modes** — Cube, Flat, Line X, Line Z, Line Y
- **Configurable scan radius** — up to 20 blocks
- **Max fill cap** — prevent output chests from being filled past a set percentage
- **Network IDs** — link multiple input chests to share the same output pool
- **Overflow chests** — assign a fallback chest per network for items that can't be routed
- **Live preview** — persistent particle border showing a chest's scan radius
- **Sort statistics** — track total items sorted per chest with per-type breakdowns
- **In-game UI** — all configuration done via sneak + right-click forms, no commands needed

---

## How to Use

### Setting Up an Input Chest

1. Place a chest in your world
2. **Sneak + right-click** the chest to open the management form
3. Click **"Set as Input Chest"** and configure the label, radius, and scan mode
4. Place output chests within the scan radius

### Tagging Output Chests (Optional)

- Place an **item frame** on the side of an output chest
- Put the item you want routed into that chest inside the frame
- The sorter will now route that item type to that chest
- Multiple frames on one chest = multiple accepted item types

### Untagged Output Chests

- Output chests with no item frame act as **catch-alls**
- They accept any item that already exists inside them

### Setting Up an Overflow Chest (Optional)

An overflow chest catches items that couldn't be routed to any output chest, preventing them from piling up in the input chest.

1. **Sneak + right-click** any unregistered chest
2. Select **"Set as Overflow Chest"** (only appears when a network exists without one)
3. Pick the network to assign it to from the dropdown

> Only one overflow chest can be assigned per network.

### Radius Preview

Live Preview keeps the radius particle border running continuously around an input chest

- Toggle it from the manage form: **Live Preview: ON / OFF**
- The one-shot **Preview Radius** button will bring it up temporarily

---

## Installation

1. Download the `.mcpack` file from [Releases](../../releases)
2. Double-click the file — Minecraft will import it automatically
3. Apply the pack to your world under **Behavior Packs** in world settings

---

## In-Game Settings

Access via **Sneak + Right-click** any registered input chest → **Settings**

| Setting | Default | Description |
|---------|---------|-------------|
| Sort Interval | 2s | How often the sorter runs |
| Preview Particle | Villager Happy | Particle used for radius preview |
| Preview Duration | 5s | How long the one-shot preview runs |
| Chat Notifications | On | Toggle chat messages for actions |

---

## Resources

| Resource | Link |
|----------|------|
| Minecraft Scripting API | [learn.microsoft.com](https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/) |
| Bedrock Creator Docs | [learn.microsoft.com/minecraft/creator](https://learn.microsoft.com/en-us/minecraft/creator/) |
