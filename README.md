<h1 align="center">Litescape</h1>

<p align="center">Litematica, but in a browser tab, and your friends can watch you build.</p>

<p align="center"><a href="https://litescapemc.pages.dev">litescapemc.pages.dev</a> has a live demo of the viewer.</p>

<p align="center">
  <img alt="Minecraft 1.21.1 to 26.3" src="https://img.shields.io/badge/Minecraft-1.21.1%E2%80%9326.3-555?style=flat-square">
  <img alt="Fabric Loader 0.20.1+" src="https://img.shields.io/badge/Fabric_Loader-0.20.1%2B-555?style=flat-square">
  <img alt="Litematica 0.29.1" src="https://img.shields.io/badge/Litematica-0.29.1-555?style=flat-square">
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-555?style=flat-square"></a>
</p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/viewer-dark.png">
  <img alt="A cottage placement about 80% built. Placed blocks render normally, the unbuilt roof shows as see-through ghost blocks, and the side panel shows build progress and who can see the shared schematic." src="docs/images/viewer-light.png">
</picture>

Litescape is a Fabric mod for Minecraft 1.21.1 to 26.3. It shows your Litematica selection and placements (and [BuildPrint](https://modrinth.com/mod/buildprint) builds) as 3D models in a browser tab. Share a placement on a server that runs the mod and everyone can watch the roof not get built.

## What you get

- **A real 3D view.** Select an area in Litematica and it shows up at `http://127.0.0.1:8723/` with your resource pack's textures.
- **Build progress.** Correct blocks look normal, missing ones are ghosts, wrong blocks are red, wrong orientation is amber, and redstone set up wrong (a backwards observer, a repeater on the wrong delay) is purple so it doesn't hide among cosmetic mistakes. "88 left" updates every 2 seconds.
- **Build order.** The Order layer mode walks a schematic in survival order, one stage at a time, with the materials for each stage. Water waits for what holds it, and lava goes last so nobody makes obsidian by accident. It doesn't plan scaffolding or walking routes.
- **Farm test.** In the app, open a schematic file, click the AFK spot and the levers to pull, and press Run. A test server in the background fast-forwards the farm and tells you its items per hour and how many milliseconds it adds to every tick. Minecraft can stay closed. See [Farm test](#farm-test).
- **Mob spawning.** A panel marks every block in view the dimension's farm mob could spawn on: a zombie in the Overworld, a zombified piglin in the Nether (torches don't stop those) and an enderman in the End. Handy for spawnproofing a farm. It only sees as far as the view, and it's off while a shader pack is on.
- **Cross-dimension farms.** Connect the parts of a farm that live in different dimensions, like a gold farm on the Nether roof and its storage in the Overworld. The Portals panel shows where every portal really leads, by the game's own rules, and flags the ones that would send your items somewhere else.
- **Sharing.** Click Share and other players with the mod can follow along. It's opt-in per placement. Only the owner or an op can unshare. Share a placement over one of your own shares and the two become one, so nobody sees the same spot listed twice.
- **Share requests.** Someone shares with you, you Accept or Deny. The server remembers. You can hide it again later.
- **Access control.** Everyone, only the players you pick, or only you (the default). The server enforces it.
- **Load in Litematica.** One click drops a shared schematic into your game at its coordinates, chests and hoppers included.
- **Surroundings.** Snapshot the land 8, 16 or 32 blocks around the build so it doesn't float in the void. Greyed out by default.
- **Contributors.** Who placed how many matching blocks, with their Minecraft face. Buckets, pistons and `/fill` don't count. We checked for cheaters.
- **Many servers.** The switcher remembers every server you've joined, per Minecraft account.
- **Shader packs.** Iris and OptiFine packs, rendered in WebGL 2 (see below).
- **Viewer things.** Layer slicing, hover to identify a block, click to isolate a material, screenshots, a <kbd>⌘K</kbd> command palette, light and dark themes, and 10 languages.

Type `/litweb` in game, or click the link in chat.

## Install

Get the Litescape app. It finds your Minecraft instances, installs the mod and its dependencies, or makes you a ready-to-play instance.

```sh
brew install --cask GA16-24/tap/litescape   # macOS and Linux
```

On Windows, run the `.exe` from the [releases page](https://github.com/GA16-24/homebrew-tap/releases) (`win-arm64` on ARM). Linux without Homebrew: grab the `.AppImage`, `.deb` or `.rpm` there.

The app reads the Minecraft Launcher, Prism, the Modrinth App and CurseForge. Click Install next to an instance, then start the game from it. Install pulls Fabric API, MaLiLib and Litematica if they're missing. It works on Fabric with Minecraft 1.21.1 to 26.3 and installs the jar built for that version. "Create Litescape instance" makes a launcher profile with everything in it; close the Minecraft Launcher first or it may overwrite the profile.

The macOS build isn't notarized yet. The cask clears the quarantine flag. If you use the `.dmg`, allow it under System Settings → Privacy & Security.

### Without the app

One jar per Minecraft version, both sides. Drop it in `mods/` yourself.

| Where             | Needs                                                                                                                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client            | Fabric Loader 0.20.1+, Fabric API, Litematica (and MaLiLib) or BuildPrint 0.1.46, this mod                                                                                                                      |
| Server (optional) | Fabric server with the [jar from Modrinth](https://modrinth.com/mod/litescape) and [Fabric API](https://modrinth.com/mod/fabric-api) in `mods/`. No Litematica needed. See [Server settings](#server-settings). |

There's one jar for each Litematica release line. Pick the one for your Minecraft version:

| Jar ends in | Minecraft              |
| ----------- | ---------------------- |
| `+1.21.1`   | 1.21.1                 |
| `+1.21.2`   | 1.21.2, 1.21.3         |
| `+1.21.4`   | 1.21.4                 |
| `+1.21.5`   | 1.21.5                 |
| `+1.21.6`   | 1.21.6, 1.21.7, 1.21.8 |
| `+1.21.9`   | 1.21.9, 1.21.10        |
| `+1.21.11`  | 1.21.11                |
| `+26.1`     | 26.1, 26.1.1, 26.1.2   |
| `+26.2`     | 26.2                   |
| `+26.3`     | 26.3                   |

The jars before 26.2 are about 20 MB, because they carry the shader compiler (LWJGL's shaderc and SPIRV-Cross) that newer Minecraft ships itself.

Without the server part, the client reads whatever chunks it has loaded and tells you how much of the area that covers.

## Farm test

Click **Test a farm** on the app's waiting screen, or use the app menu (<kbd>⌘⇧F</kbd>). The window lists the `.litematic` files in each instance's `schematics` folder, and **Open file…** adds any other. Pick one and the Farm test panel asks for:

- **AFK spot.** Click Choose in 3D, then the block you'd stand on. A stand-in player waits there so mobs spawn and despawn like they would around you. Leave it empty for farms that don't need you nearby. If something is in the way, the app marks it red and names it.
- **Levers and buttons.** Click Choose in 3D, then each one to use. The test pulls or presses each once, after the farm is built.
- **Containers to keep full.** For farms that need feeding, like a furnace array: click Choose in 3D, then the chests, barrels or hoppers to fill, and pick an item for each, such as raw iron or coal. Each pick gets a numbered label in the 3D view that matches its row. The test tops them up all the time.
- **Run for** 10 minutes, an hour or a day of game time, plus the dimension and biome to test in.

Press **Run test**. The first run downloads the server from Fabric and Mojang, and Fabric API from Modrinth, which takes a minute. After that, Litescape on that server pastes the farm into an empty world, pulls your levers and fast-forwards with `/tick sprint`. An hour of game time takes under a second for a simple farm and up to about 20 seconds for one full of mobs. You get what the farm's chests and hoppers collected, per hour, and the **server cost**: how many of the 50 milliseconds a tick may take the farm adds. With furnaces, smokers or blast furnaces in the build, you also see how many items they smelted per hour and how close that is to their top speed. If your server's ticks already take 45 ms, a farm that adds 6 will make it lag.

What it can't do yet: containers you don't keep full start empty, block data like a spawner's mob isn't copied, mobs and minecarts in the schematic are left out, and there's no terrain around the farm, so mob farm rates are a best case. The cost is measured on your computer, not your server's.

The app learns how blocks look from the mod, so start Minecraft 26.3 with Litescape once before using it.

## Test server

The farm test runs on it, and you can use it yourself: open **Test server** from the waiting screen or the app menu (<kbd>⌘⇧S</kbd>). It's a Fabric server with Litescape and Fabric API and an empty world, listening on `127.0.0.1` only, so nobody else can join. Join it at `localhost`. The window shows the server's tick time, ticks per second and memory, buttons for day, clear weather, `/tick sprint 1d` and freezing ticks, and a console for any other command. It runs Minecraft 26.3, the newest version the app has a jar for, and needs Java 25, which the app takes from your launcher once you've started Minecraft 26.3 there, or from `JAVA_HOME`. Open folder shows the world and `server.properties`. Quitting the app saves the world and stops the server.

## Shader packs

Open the Shaders tab or press <kbd>V</kbd>. Packs come from your Iris `shaderpacks` folder; with none, the tab downloads popular ones from Modrinth. Pack settings, profiles and sliders are all there. Time of day, weather and resolution are under Scene.

Tested: Complementary Reimagined and Unbound, BSL, MakeUp Ultra Fast, Sildur's Vibrant, Solas, Super Duper Vanilla, Bliss. Photon runs, but its sky comes out black.

The mod preprocesses a pack like Iris does, compiles it with glslang, converts it with SPIRV-Cross, and the page runs the pass chain in WebGL 2. A browser isn't a GPU, so: no compute or geometry shaders, terrain only (no entities, clouds or particles), biome is always plains, and LabPBR maps aren't loaded yet.

## Server settings

`config/litweb-server.properties` appears on first start.

| Key                     | Default    | Meaning                                                                                                |
| ----------------------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| `region-read`           | `ops`      | Who may read areas for the selection view (`ops`, `everyone`, `none`). Others use their loaded chunks. |
| `shared-progress`       | `everyone` | Who may request progress on shared schematics. Set `ops` if you worry about scouting.                  |
| `max-shared-per-player` | `20`       | How many schematics one player can share at once.                                                      |
| `terrain-capture`       | `ops`      | Who may include surroundings (`ops`, `everyone`, `none`). They can reveal ores and bases.              |
| `terrain-max-margin`    | `32`       | Max blocks of surroundings, up to 64.                                                                  |

Shares live in `<world>/litweb/`. Server reads only touch loaded chunks, so nobody can stall the server with a far-away selection.

## Privacy and security

The web server binds to `127.0.0.1` and rejects any `Host` or `Origin` that isn't the local page, so other websites can't read your world.

The server switcher keeps copies of what you opened in `~/.litescape/<your player UUID>/`. Other accounts on the computer can't see them. A copy is deleted once it's unshared or you lose access and you next visit that server. Removing someone's access doesn't un-download what they already have.

The Shaders tab asks Modrinth for icons and download counts, and downloads the pack you pick. Nothing else leaves your computer.

## Limits

- Views max out at 16,777,216 blocks (256×256×256). World reads max out at 4,194,304 because they run on the game thread, so big schematics get small margins.
- Chests and signs show as outline boxes.
- Biome tint is sampled once at the center.
- The selection view refreshes when the selection changes or on <kbd>R</kbd>, not on edits inside it.

## Development

```sh
./gradlew build                       # one mod jar per Minecraft version in build/libs/
./gradlew :26.3:runClientGameTest     # boots the real client and tests the whole thing
./gradlew productionTest -Ptest_minecraft=1.21.7  # the release jar in a real client on 1.21.7, plus a server boot
node web-dev/serve.mjs                # web app on :8194 from the game test's fixtures
./gradlew :26.3:shaderDev -Ppacks=<folder>  # shader API on :8195 without Minecraft
node web-dev/expr.test.mjs            # custom-uniform expression tests
node web-dev/ui-tokens.test.mjs       # colors, font sizes and radii stay on the tokens
cd desktop && npm ci && npm start     # desktop app (run ./gradlew build first)
node --test desktop/*.test.mjs
```

`/dev?mode=offline|noworld|empty|full` switches the dev page between states. The web app is plain ES modules with vendored three.js r170. No build step.

To release the desktop app, bump `version` in `desktop/package.json`, merge, and push a `desktop-v<version>` tag. See [CONTRIBUTING.md](CONTRIBUTING.md) for the rest.

## Thanks

[T3 Code](https://github.com/pingdotgg/t3code) was the reference for the viewer's look, themes and command palette. We copied their homework and they know it.
