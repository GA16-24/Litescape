# Litematica Web Viewer

A Fabric mod for Minecraft 26.3 that shows your Litematica selection and schematic placements as 3D models in a browser tab. On a server that also runs the mod, players can share a placement so everyone can watch it get built.

## What it does

- Select an area with Litematica's area selection tool and it appears at `http://127.0.0.1:8723/`, with the textures from your current resource pack. The view reloads when you move a corner.
- Open one of your placements to compare it with the world. Correct blocks render normally, missing blocks show as ghosts, a wrong block is tinted red and a wrong orientation or state is tinted amber. The counts and the material list ("88 left") update every 2 seconds.
- Click Share on a placement to upload it to the server. Other players with the mod see it under "Shared on this server" and can follow progress from anywhere. The server compares it against the world using whatever chunks it has loaded. Sharing is opt-in per placement, and only the owner or an operator can stop sharing.
- The viewer also has layer slicing (all, up to a layer, single layer), hover to identify a block, click to isolate a material, a filter for remaining blocks or problems, screenshots, and a <kbd>⌘K</kbd> command palette. Light and dark themes follow your system.

Type `/litweb` in game to open the page. The link is also posted in chat when you join a world.

## Install

| Where | Needs |
| --- | --- |
| Client | Fabric Loader 0.20.1+, Fabric API, Litematica 0.29.1 (and MaLiLib), this mod |
| Server (optional) | Fabric Loader, Fabric API, this mod. The server doesn't need Litematica. |

It's one jar for both sides. Without the server part, the client reads blocks from the chunks it has loaded and the page tells you what percentage of the area is covered.

## Server settings

`config/litweb-server.properties` is created on first start:

| Key | Default | Meaning |
| --- | --- | --- |
| `region-read` | `ops` | Who may read areas from the server for the selection view (`ops`, `everyone`, `none`). Everyone else falls back to their own loaded chunks. |
| `shared-progress` | `everyone` | Who may request build progress for shared schematics. Progress reveals whether each position matches, so set `ops` if you worry about players using it to scout. |
| `max-shared-per-player` | `20` | How many schematics one player can share at once. |

Shared schematics are stored in `<world>/litweb/`.

Server reads only touch chunks that are already loaded. They never load or generate terrain, so a far-away selection can't stall the server.

## Privacy and security

The web server binds to `127.0.0.1` only. It rejects requests whose `Host` or `Origin` isn't the local page, so other websites can't read your world or share on your behalf.

## Limits

- Views are capped at 16,777,216 blocks (for example 256×256×256). Reads from the world are capped at 4,194,304 blocks because they run on the game thread.
- Blocks drawn by special renderers without a block model (chests, signs) show as their outline box in their particle texture.
- Biome tint (grass, leaves, water) is sampled once at the center of the view.
- The selection view refreshes when the selection changes or when you press <kbd>R</kbd>. It doesn't watch for block edits inside an unchanged selection.

## Development

```sh
./gradlew build              # mod jar in build/libs/
./gradlew runClientGameTest  # boots the real client, builds a test house, checks the HTTP API end to end
node web-dev/serve.mjs       # web app on :8194 using the fixtures the game test recorded
```

The game test writes its API responses and textures to `build/run/clientGameTest/litweb-fixtures/`. The dev server replays them and simulates a build in progress, so you can work on the UI without Minecraft running. `/dev?mode=offline|noworld|empty|full` switches between the page's states.

The web app is plain ES modules with a vendored copy of three.js r170 (MIT). It has no build step.
