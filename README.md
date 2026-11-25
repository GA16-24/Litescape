# Litescape

A Fabric mod for Minecraft 26.3 that shows your Litematica selection and schematic placements as 3D models in a browser tab. On a server that also runs the mod, players can share a placement so everyone can watch it get built.

## What it does

- Select an area with Litematica's area selection tool and it appears at `http://127.0.0.1:8723/`, with the textures from your current resource pack. The view reloads when you move a corner.
- Open one of your placements to compare it with the world. Correct blocks render normally, missing blocks show as ghosts, a wrong block is tinted red and a wrong orientation or state is tinted amber. The counts and the material list ("88 left") update every 2 seconds.
- Click Share on a placement to upload it to the server. Once you let them in from the Access panel, other players with the mod see it under "Shared on this server" and can follow progress from anywhere. The server compares it against the world using whatever chunks it has loaded. Sharing is opt-in per placement, and only the owner or an operator can stop sharing.
- The Access panel sets who can see a shared schematic: everyone on the server, only the players you pick, or only you. A new share starts as only you. Players can be picked while they're online or once they've helped build it. Operators can always see and manage every shared schematic. The server enforces this: a player without access doesn't get the schematic in their list and can't download it or its progress. Update copy keeps the access you set.
- The server switcher at the top of the sidebar lists every server you've joined with the mod. The one you're on is live. The others show what was shared with you on your last visit, and any schematic you opened there can still be viewed in 3D. Progress, placements and access changes need you to be on that server. Joining a server switches the page to it.
- A shared schematic lists its contributors: who placed blocks that match it, how many and when they were last active. Blocks count when a player places them by hand after the schematic was shared; buckets, pistons and commands like `/fill` don't count, and re-placing the same block counts once. Each player shows with their Minecraft face, cropped from their skin. The skin comes from Mojang the same way the game loads skins for player heads; players without one get their default skin. Everyone who can see the shared schematic can see this list. The schematic's author from the Litematica file is shown too.
- The viewer also has layer slicing (all, up to a layer, single layer), hover to identify a block, click to isolate a material, a filter for remaining blocks or problems, screenshots, and a <kbd>⌘K</kbd> command palette. Light and dark themes follow your system.

Type `/litweb` in game to open the page. The link is also posted in chat when you join a world.

## Shader packs

The viewer can render with Iris and OptiFine shader packs. Open the Shaders tab in the right panel, or press <kbd>V</kbd>.

- Packs come from your `shaderpacks` folder, the same one Iris uses. If you use Iris, the packs you already have show up, starting from the settings you picked in game.
- If you have none, the tab lists popular packs and downloads the one you pick from Modrinth into that folder.
- Each pack's own settings screens, profiles (Low, High, Ultra and so on) and sliders are there, with search. Changes recompile the pack in a second or two, and the old picture stays up until the new one is ready.
- The Scene controls set the time of day, the weather and the render resolution.

Packs tested so far: Complementary Reimagined and Unbound, BSL, MakeUp Ultra Fast, Sildur's Vibrant, Solas, Super Duper Vanilla and Bliss. Photon runs, but its sky and lighting come out wrong.

How it works: the mod preprocesses a pack the way Iris does, then compiles each program with glslang and converts it to WebGL's GLSL with SPIRV-Cross. Minecraft already ships both. The page then runs the pass chain in WebGL 2: shadow map, gbuffers, deferred, translucent, composite and final.

Browsers can't do everything a desktop GPU can, so some effects are missing:

- Compute shaders, geometry shaders and image storage don't exist in WebGL. Packs that use them for colored block light or voxel effects fall back to their simpler path, and the tab lists anything it had to leave out.
- Only terrain is drawn. There are no entities, hand, clouds, particles or sun and moon sprites.
- Light levels are computed from the blocks in view, and the biome is always plains.
- Resource pack normal and specular maps (LabPBR) aren't loaded yet.

It needs WebGL 2 with floating-point render targets, which current Chrome, Edge, Firefox and Safari all have.

## Install

| Where             | Needs                                                                        |
| ----------------- | ---------------------------------------------------------------------------- |
| Client            | Fabric Loader 0.20.1+, Fabric API, Litematica 0.29.1 (and MaLiLib), this mod |
| Server (optional) | Fabric Loader, Fabric API, this mod. The server doesn't need Litematica.     |

It's one jar for both sides. Without the server part, the client reads blocks from the chunks it has loaded and the page tells you what percentage of the area is covered.

### Desktop app (optional)

If you'd rather have the viewer in its own window than a browser tab, install the desktop app:

```sh
brew install --cask GA16-24/tap/litescape   # macOS and Linux
```

On Windows, run `Litescape-<version>-win-x64.exe` from the [releases page](https://github.com/GA16-24/homebrew-tap/releases). Linux users without Homebrew can download the `.AppImage` from the same page.

The app shows "Waiting for Minecraft" until the game is running with the mod, then opens the viewer. If you quit the game it goes back to waiting, and it reconnects when you start the game again. Links to other sites open in your browser.

The macOS build isn't notarized yet. The Homebrew cask clears the download quarantine for you. If you install the `.dmg` by hand, macOS will block the first launch until you allow it under System Settings → Privacy & Security.

## Server settings

`config/litweb-server.properties` is created on first start:

| Key                     | Default    | Meaning                                                                                                                                                          |
| ----------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `region-read`           | `ops`      | Who may read areas from the server for the selection view (`ops`, `everyone`, `none`). Everyone else falls back to their own loaded chunks.                      |
| `shared-progress`       | `everyone` | Who may request build progress for shared schematics. Progress reveals whether each position matches, so set `ops` if you worry about players using it to scout. |
| `max-shared-per-player` | `20`       | How many schematics one player can share at once.                                                                                                                |

Shared schematics are stored in `<world>/litweb/`.

Server reads only touch chunks that are already loaded. They never load or generate terrain, so a far-away selection can't stall the server.

## Privacy and security

The web server binds to `127.0.0.1` only. It rejects requests whose `Host` or `Origin` isn't the local page, so other websites can't read your world or share on your behalf.

The server switcher keeps each server's shared list and the schematics you opened in `config/litweb-servers/`. A copy is deleted once it's unshared or you lose access and you next visit that server. Taking away someone's access doesn't remove a copy they already downloaded.

Opening the Shaders tab asks Modrinth for the popular packs' icons and download counts. Getting a pack downloads it from Modrinth. Nothing else leaves your computer, and these requests carry no account or world details. Shader settings are saved in `config/litweb-shaders.json`.

## Limits

- Views are capped at 16,777,216 blocks (for example 256×256×256). Reads from the world are capped at 4,194,304 blocks because they run on the game thread.
- Blocks drawn by special renderers without a block model (chests, signs) show as their outline box in their particle texture.
- Biome tint (grass, leaves, water) is sampled once at the center of the view.
- The selection view refreshes when the selection changes or when you press <kbd>R</kbd>. It doesn't watch for block edits inside an unchanged selection.

## Development

```sh
./gradlew build              # mod jar in build/libs/
./gradlew runClientGameTest  # boots the real client, builds a test house, checks the HTTP API and a small test shader pack end to end
node web-dev/serve.mjs       # web app on :8194 using the fixtures the game test recorded
./gradlew shaderDev -Ppacks=<folder>  # the shader API on :8195 without Minecraft; serve.mjs forwards /api/shaders to it
node web-dev/expr.test.mjs   # custom-uniform expression tests
node web-dev/ui-tokens.test.mjs  # style.css colors come from its tokens; font sizes and radii stay on the scale
cd desktop && npm ci && npm start  # the desktop app, against a running game
cd desktop && npm run dist         # desktop installers for this OS in desktop/dist/
```

To release the desktop app, bump `version` in `desktop/package.json`, merge, and push a matching `desktop-v<version>` tag. The Desktop release workflow builds macOS, Windows and Linux, publishes them as a release on the public [GA16-24/homebrew-tap](https://github.com/GA16-24/homebrew-tap) repo and updates the cask there. It needs a `TAP_TOKEN` secret in the `homebrew-tap` environment: a fine-grained token with Contents read and write on that repo. To sign and notarize the macOS app later, remove `identity` and `hardenedRuntime` from `desktop/package.json` and add the [electron-builder signing secrets](https://www.electron.build/code-signing-mac) to the build job.

The game test writes its API responses and textures to `build/run/clientGameTest/litweb-fixtures/`. The dev server replays them and simulates a build in progress, so you can work on the UI without Minecraft running. `/dev?mode=offline|noworld|empty|full` switches between the page's states.

The web app is plain ES modules with a vendored copy of three.js r170 (MIT). It has no build step.
