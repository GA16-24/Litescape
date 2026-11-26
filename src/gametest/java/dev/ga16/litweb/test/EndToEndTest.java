package dev.ga16.litweb.test;

import com.buildprint.api.BuildprintBlueprints;
import com.buildprint.api.BuildprintSelection;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.ga16.litweb.client.LitWebClient;
import fi.dy.masa.litematica.data.DataManager;
import fi.dy.masa.litematica.schematic.LitematicaSchematic;
import fi.dy.masa.litematica.schematic.placement.SchematicPlacement;
import fi.dy.masa.litematica.selection.AreaSelection;
import fi.dy.masa.litematica.util.PositionUtils;
import fi.dy.masa.litematica.selection.Box;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import net.fabricmc.fabric.api.client.gametest.v1.FabricClientGameTest;
import net.fabricmc.fabric.api.client.gametest.v1.context.ClientGameTestContext;
import net.fabricmc.fabric.api.client.gametest.v1.context.TestServerContext;
import net.fabricmc.fabric.api.client.gametest.v1.context.TestSingleplayerContext;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.context.UseOnContext;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;

/**
 * Boots the real client, builds a cottage, drives Litematica, and calls the web API
 * end to end. Responses and textures land in <run dir>/litweb-fixtures for web-dev/serve.mjs.
 */
public class EndToEndTest implements FabricClientGameTest {
	private static final HttpClient HTTP = HttpClient.newHttpClient();
	private final Path out = FabricLoader.getInstance().getGameDir().resolve("litweb-fixtures");
	private final Set<String> textures = new HashSet<>();

	@Override
	public void runTest(ClientGameTestContext ctx) {
		try {
			Files.createDirectories(out);
			// The singleplayer host isn't an operator, and surroundings default to operators only; allow them like an admin would.
			Files.writeString(FabricLoader.getInstance().getConfigDir().resolve("litweb-server.properties"), "terrain-capture=everyone\n");
			try (TestSingleplayerContext sp = ctx.worldBuilder().create()) {
				sp.getConnection().waitForChunksRender();
				buildCottage(sp.getServer());
				ctx.waitTicks(20);

				ctx.runOnClient(mc -> {
					// Litematica defaults to "simple" mode: one selection with one box.
					AreaSelection sel = DataManager.getSelectionManager().getCurrentSelection();
					sel.setName("Cottage");
					Box box = sel.getAllSubRegionBoxes().get(0);
					sel.setSubRegionCornerPos(box, PositionUtils.Corner.CORNER_1, new BlockPos(1, -63, 1));
					sel.setSubRegionCornerPos(box, PositionUtils.Corner.CORNER_2, new BlockPos(20, -50, 19));
				});
				JsonObject state = json(save("state-1.json", call(ctx, "GET", "/api/state")));
				check(state.getAsJsonObject("selection").get("name").getAsString().equals("Cottage"), "selection name");
				check(state.get("serverMod").getAsBoolean(), "integrated server runs the mod");

				JsonObject sel = json(save("view-selection.json", call(ctx, "GET", "/api/view?type=selection")));
				check(sel.getAsJsonArray("size").toString().equals("[20,14,19]"), "selection size " + sel.get("size"));
				collectTextures(sel);

				ctx.runOnClient(mc -> {
					AreaSelection area = DataManager.getSelectionManager().getCurrentSelection();
					LitematicaSchematic schem = LitematicaSchematic.createFromWorld(mc.level, area,
						new LitematicaSchematic.SchematicSaveInfo(false, false), "test", msg -> {});
					SchematicPlacement p = SchematicPlacement.createFor(schem, new BlockPos(31, -63, 1), "Cottage copy", true, true);
					DataManager.getSchematicPlacementManager().addSchematicPlacement(p, false);
				});
				// Build the bottom of the copy, with one wrong block and one wrong state.
				sp.getServer().runCommand("clone 1 -63 1 20 -58 19 31 -63 1");
				sp.getServer().runCommand("setblock 36 -60 6 stone");
				sp.getServer().runCommand("setblock 40 -59 14 air");
				sp.getServer().runCommand("setblock 40 -60 14 oak_door[facing=north,half=lower]");
				sp.getServer().runCommand("setblock 40 -59 14 oak_door[facing=north,half=upper]");
				ctx.waitTicks(10);

				state = json(save("state-2.json", call(ctx, "GET", "/api/state")));
				String placement = state.getAsJsonArray("placements").get(0).getAsJsonObject().get("id").getAsString();
				collectTextures(json(save("view-placement.json", call(ctx, "GET", "/api/view?type=placement&id=" + placement))));
				JsonObject st = json(save("status-placement.json", call(ctx, "GET", "/api/status?type=placement&id=" + placement)));
				JsonArray c = st.getAsJsonArray("counts");
				check(c.get(1).getAsInt() > 0 && c.get(2).getAsInt() > 0 && c.get(3).getAsInt() == 1 && c.get(4).getAsInt() >= 1, "placement status counts " + c);

				check(state.getAsJsonObject("terrain").get("capture").getAsBoolean(), "the host may capture surroundings: " + state.get("terrain"));
				// Share with 8 blocks of surroundings: the view is the schematic set into the terrain around it.
				String shared = json(call(ctx, "POST", "/api/share?id=" + placement + "&margin=8")).get("id").getAsString();
				String st3 = "";
				for (int i = 0; i < 40 && !st3.contains("\"sharedId\":\"" + shared); i++, ctx.waitTicks(5)) st3 = call(ctx, "GET", "/api/state");
				check(st3.contains("\"sharedId\":\"" + shared), "shared list push reached the client");
				check(st3.contains("\"access\":\"private\""), "a new share starts private");
				save("state-3.json", st3);
				JsonObject sv = json(save("view-shared.json", call(ctx, "GET", "/api/view?type=shared&id=" + shared)));
				collectTextures(sv);
				// The copy sits at 31 -63 1 and is 20×14×19; 8 blocks below it is under the world floor (-64).
				check(sv.getAsJsonArray("size").toString().equals("[36,23,35]"), "view with surroundings " + sv.get("size"));
				check(sv.getAsJsonArray("inner").toString().equals("[8,1,8,20,14,19]"), "schematic inside its surroundings " + sv.get("inner"));
				check(sv.get("terrainFrom").getAsInt() > 1, "surroundings palette follows the schematic's");
				check(st3.contains("\"margin\":8") && st3.contains("\"chunksCaptured\""), "shared list carries the capture");
				JsonObject sst = json(save("status-shared.json", call(ctx, "GET", "/api/status?type=shared&id=" + shared)));
				check(sst.getAsJsonArray("counts").toString().equals(c.toString()), "server status " + sst.get("counts") + " matches client " + c);

				// Access: limit it to one player, see the server store and push it back, keep it on Update copy, refuse junk.
				String alice = "b6d1f0f2-0000-4000-8000-00000000a1ce";
				call(ctx, "POST", "/api/access", "{\"id\":\"" + shared + "\",\"access\":\"players\",\"players\":{\"" + alice + "\":\"Alice_Mines\"}}");
				String limited = "";
				for (int i = 0; i < 40 && !limited.contains("\"access\":\"players\""); i++, ctx.waitTicks(5)) limited = call(ctx, "GET", "/api/state");
				check(limited.contains("\"access\":\"players\"") && limited.contains(alice), "access change reached the client");
				call(ctx, "POST", "/api/share?id=" + placement + "&margin=8");
				String updated = call(ctx, "GET", "/api/state");
				check(updated.contains("\"access\":\"players\""), "Update copy keeps access");
				check(updated.contains("\"margin\":8"), "Update copy keeps the surroundings");
				call(ctx, "POST", "/api/capture?id=" + shared + "&margin=0");
				String bare = "";
				for (int i = 0; i < 40 && !bare.contains("\"margin\":0"); i++, ctx.waitTicks(5)) bare = call(ctx, "GET", "/api/state");
				check(bare.contains("\"margin\":0"), "surroundings removed");
				check(!json(call(ctx, "GET", "/api/view?type=shared&id=" + shared)).has("inner"), "view without surroundings is just the schematic");
				String tooFar = "";
				try {
					call(ctx, "POST", "/api/capture?id=" + shared + "&margin=65");
				} catch (AssertionError e) {
					tooFar = e.getMessage();
				}
				check(tooFar.contains("at most"), "margin over the server's limit refused: " + tooFar);
				call(ctx, "POST", "/api/capture?id=" + shared + "&margin=8"); // back to the shared state the fixtures show
				String refused = "";
				try {
					call(ctx, "POST", "/api/access", "{\"id\":\"" + shared + "\",\"access\":\"friends\",\"players\":{}}");
				} catch (AssertionError e) {
					refused = e.getMessage();
				}
				check(refused.contains("Unknown access"), "bad access refused: " + refused);
				call(ctx, "POST", "/api/access", "{\"id\":\"" + shared + "\",\"access\":\"private\",\"players\":{}}"); // back to the default for the fixtures
				// The world is remembered with its shared list and the copy downloaded above, for viewing after leaving.
				JsonObject here = json(call(ctx, "GET", "/api/state")).getAsJsonArray("servers").get(0).getAsJsonObject();
				check(here.getAsJsonArray("shared").toString().contains(shared), "remembered server lists the shared schematic");
				try (var files = Files.walk(FabricLoader.getInstance().getConfigDir().resolve("litweb-servers"))) {
					check(files.anyMatch(f -> f.getFileName().toString().equals(shared + ".bin")), "downloaded copy saved for later");
				}
				String notSaved = "";
				try {
					call(ctx, "GET", "/api/view?type=shared&id=" + shared + "&server=server:elsewhere.example");
				} catch (AssertionError e) {
					notSaved = e.getMessage();
				}
				check(notSaved.contains("404") && notSaved.contains("not-saved"), "another server without a saved copy: " + notSaved);

				// The player places one block the copy needs and one it doesn't: only the first counts.
				sp.getServer().runOnServer(server -> {
					ServerPlayer player = server.getPlayerList().getPlayers().getFirst();
					place(player, Items.OAK_PLANKS, new BlockPos(37, -58, 6), Direction.UP); // lands on 37 -57 6, a wall block
					place(player, Items.STONE, new BlockPos(37, -57, 6), Direction.SOUTH); // lands on 37 -57 7, which should stay air
					server.overworld().destroyBlock(new BlockPos(37, -57, 6), false);
					place(player, Items.OAK_PLANKS, new BlockPos(37, -58, 6), Direction.UP); // same spot again: no extra credit
				});
				JsonObject contrib = null;
				for (int i = 0; i < 60 && contrib == null; i++, ctx.waitTicks(10)) {
					for (JsonElement e : json(call(ctx, "GET", "/api/state")).getAsJsonArray("shared")) {
						JsonObject cs = e.getAsJsonObject().getAsJsonObject("contributors");
						if (e.getAsJsonObject().get("id").getAsString().equals(shared) && cs != null && !cs.isEmpty()) contrib = cs;
					}
				}
				save("state-3.json", call(ctx, "GET", "/api/state"));
				// Contributor faces: the test player plus the two example players web-dev/serve.mjs adds.
				List<String> faces = new ArrayList<>(contrib.keySet());
				faces.addAll(List.of("b6d1f0f2-0000-4000-8000-00000000a1ce", "5c2e7a10-0000-4000-8000-000000000b0b"));
				for (String uuid : faces) {
					CompletableFuture<HttpResponse<byte[]>> f = HTTP.sendAsync(req("GET", "/api/skin?uuid=" + uuid), HttpResponse.BodyHandlers.ofByteArray());
					ctx.waitFor(mc -> f.isDone(), 600);
					byte[] png = f.join().body();
					check(f.join().statusCode() == 200 && png.length > 8 && png[1] == 'P' && png[2] == 'N' && png[3] == 'G', "skin for " + uuid);
					Files.createDirectories(out.resolve("skins"));
					Files.write(out.resolve("skins/" + uuid + ".png"), png);
				}
				check(contrib != null && contrib.size() == 1, "one contributor " + contrib);
				check(contrib.entrySet().iterator().next().getValue().getAsJsonObject().get("placed").getAsInt() == 1, "only the matching block counts " + contrib);

				for (String t : textures) {
					int colon = t.indexOf(':');
					String path = "/tex/" + t.substring(0, colon) + "/" + t.substring(colon + 1);
					CompletableFuture<HttpResponse<byte[]>> f = HTTP.sendAsync(req("GET", path), HttpResponse.BodyHandlers.ofByteArray());
					ctx.waitFor(mc -> f.isDone(), 200);
					check(f.join().statusCode() == 200, "texture " + path);
					Path file = out.resolve(path.substring(1) + ".png");
					Files.createDirectories(file.getParent());
					Files.write(file, f.join().body());
				}
				buildPrint(ctx, sp);
				shaderPack(ctx);
				ctx.takeScreenshot("litweb-scene");
			}
		} catch (IOException e) {
			throw new RuntimeException(e);
		}
	}

	/** A BuildPrint build and selection show up like Litematica's: listed, viewable and compared with the world. */
	private static void buildPrint(ClientGameTestContext ctx, TestSingleplayerContext sp) {
		ctx.waitFor(_ -> BuildprintBlueprints.isAvailable(), 200);
		ctx.runOnClient(_ -> {
			String why = BuildprintBlueprints.problem("litweb-test");
			check(why == null, "BuildPrint refuses the test blueprint: " + why);
			check(BuildprintBlueprints.set("litweb-test", "Test tower", new int[] {50, -60, 1, 50, -59, 1, 51, -60, 1},
				new String[] {"minecraft:stone", "minecraft:oak_planks", "minecraft:oak_stairs[facing=east,half=bottom,shape=straight,waterlogged=false]"}) != null, "blueprint written");
		});
		sp.getServer().runCommand("setblock 50 -60 1 stone");
		sp.getServer().runCommand("setblock 51 -60 1 oak_stairs[facing=west]");
		ctx.waitTicks(10);
		JsonObject p = null;
		for (int i = 0; i < 40 && p == null; i++, ctx.waitTicks(5))
			for (JsonElement e : json(call(ctx, "GET", "/api/state")).getAsJsonArray("placements"))
				if (e.getAsJsonObject().get("name").getAsString().equals("Test tower")) p = e.getAsJsonObject();
		check(p != null && p.get("id").getAsString().startsWith("buildprint:"), "BuildPrint build listed: " + p);
		String id = java.net.URLEncoder.encode(p.get("id").getAsString(), java.nio.charset.StandardCharsets.UTF_8);
		JsonObject view = json(call(ctx, "GET", "/api/view?type=placement&id=" + id));
		check(view.getAsJsonArray("size").toString().equals("[2,2,1]"), "BuildPrint build size " + view.get("size"));
		JsonArray c = json(call(ctx, "GET", "/api/status?type=placement&id=" + id)).getAsJsonArray("counts");
		// One correct, one missing, one with the wrong state.
		check(c.get(1).getAsInt() == 1 && c.get(2).getAsInt() == 1 && c.get(4).getAsInt() == 1, "BuildPrint status counts " + c);

		// The same build loaded a second time in the same spot gets its own row.
		ctx.runOnClient(_ -> check(BuildprintBlueprints.set("litweb-test-2", "Test tower", new int[] {50, -60, 1, 50, -59, 1, 51, -60, 1},
			new String[] {"minecraft:stone", "minecraft:oak_planks", "minecraft:oak_stairs[facing=east,half=bottom,shape=straight,waterlogged=false]"}) != null, "second blueprint written"));
		Set<String> towers = new HashSet<>();
		for (int i = 0; i < 40 && towers.size() < 2; i++, ctx.waitTicks(5)) {
			towers.clear();
			for (JsonElement e : json(call(ctx, "GET", "/api/state")).getAsJsonArray("placements"))
				if (e.getAsJsonObject().get("name").getAsString().equals("Test tower")) towers.add(e.getAsJsonObject().get("id").getAsString());
		}
		check(towers.size() == 2 && towers.stream().allMatch(t -> t.contains("#")), "two same-named builds in one spot have distinct ids " + towers);

		// With Litematica's selection back at its untouched default, BuildPrint's is the one shown.
		ctx.runOnClient(_ -> {
			AreaSelection area = DataManager.getSelectionManager().getCurrentSelection();
			Box box = area.getAllSubRegionBoxes().get(0);
			area.setSubRegionCornerPos(box, PositionUtils.Corner.CORNER_1, BlockPos.ZERO);
			area.setSubRegionCornerPos(box, PositionUtils.Corner.CORNER_2, BlockPos.ZERO);
			BuildprintSelection.add(new int[] {1, -63, 1, 4, -60, 3});
		});
		JsonObject sel = json(call(ctx, "GET", "/api/state")).getAsJsonObject("selection");
		check(sel != null && sel.getAsJsonArray("boxes").toString().equals("[[1,-63,1,4,-60,3]]"), "BuildPrint selection " + sel);
		check(json(call(ctx, "GET", "/api/view?type=selection")).getAsJsonArray("size").toString().equals("[4,4,3]"), "BuildPrint selection view");
	}

	private static void place(ServerPlayer player, Item item, BlockPos on, Direction face) {
		player.setItemInHand(InteractionHand.MAIN_HAND, new ItemStack(item));
		BlockHitResult hit = new BlockHitResult(Vec3.atCenterOf(on).relative(face, 0.5), face, on, false);
		check(player.getMainHandItem().useOn(new UseOnContext(player, InteractionHand.MAIN_HAND, hit)).consumesAction(), "placed " + item);
	}

	private static void buildCottage(TestServerContext s) {
		String[] cmds = {
			"fill 6 -61 6 14 -61 14 oak_planks",
			"fill 6 -60 6 14 -57 14 oak_planks hollow",
			"fill 6 -60 6 6 -57 6 oak_log", "fill 14 -60 6 14 -57 6 oak_log",
			"fill 6 -60 14 6 -57 14 oak_log", "fill 14 -60 14 14 -57 14 oak_log",
			"fill 9 -59 6 11 -58 6 glass", "fill 9 -59 14 11 -58 14 light_blue_stained_glass",
			"fill 6 -59 9 6 -58 11 glass", "fill 14 -59 9 14 -58 11 glass",
			"setblock 10 -60 14 oak_door[facing=south,half=lower]", "setblock 10 -59 14 oak_door[facing=south,half=upper]",
			"setblock 7 -60 7 chest[facing=south]", "setblock 8 -60 7 crafting_table", "setblock 9 -60 7 furnace[facing=south,lit=true]",
			"setblock 10 -58 7 wall_torch[facing=south]", "setblock 12 -60 9 red_bed[part=head,facing=south]",
			"setblock 12 -60 8 red_bed[part=foot,facing=south]", "setblock 12 -60 12 lantern",
			"fill 2 -61 7 4 -61 11 water",
			"fill 17 -60 3 17 -56 3 oak_log", "fill 15 -56 1 19 -55 5 oak_leaves[persistent=true] replace air",
			"setblock 17 -54 3 oak_leaves[persistent=true]",
			"setblock 8 -60 16 poppy", "setblock 12 -60 16 dandelion", "setblock 9 -60 17 short_grass",
			"fill 10 -61 15 10 -61 18 dirt_path", "setblock 14 -60 17 oak_fence", "setblock 14 -59 17 lantern",
		};
		for (String c : cmds) s.runCommand(c);
		for (int i = 0; i < 5; i++) {
			int y = -56 + i;
			s.runCommand("fill 5 " + y + " " + (5 + i) + " 15 " + y + " " + (5 + i) + " spruce_stairs[facing=south]");
			s.runCommand("fill 5 " + y + " " + (15 - i) + " 15 " + y + " " + (15 - i) + " spruce_stairs[facing=north]");
			if (i < 4) {
				s.runCommand("fill 6 " + y + " " + (6 + i) + " 6 " + y + " " + (14 - i) + " oak_planks");
				s.runCommand("fill 14 " + y + " " + (6 + i) + " 14 " + y + " " + (14 - i) + " oak_planks");
			}
		}
		s.runCommand("fill 5 -51 10 15 -51 10 spruce_slab");
	}

	private void collectTextures(JsonObject view) {
		for (JsonElement t : view.getAsJsonArray("tex")) textures.add(t.getAsJsonObject().get("id").getAsString());
	}

	private String save(String name, String body) throws IOException {
		Files.writeString(out.resolve(name), body);
		return body;
	}

	/** A tiny OptiFine-style pack: checks option discovery, profiles, program toggles and the GLSL ES translation in the real game. */
	private static void shaderPack(ClientGameTestContext ctx) throws IOException {
		Path pack = FabricLoader.getInstance().getGameDir().resolve("shaderpacks/litweb-test/shaders");
		Files.createDirectories(pack);
		Files.writeString(pack.resolve("shaders.properties"), "profile.LOW=!SHADOWS\nprofile.HIGH=SHADOWS\nscreen=SHADOWS STRENGTH\nprogram.composite.enabled=SHADOWS\n");
		Files.writeString(pack.resolve("block.properties"), "block.10001=minecraft:oak_planks oak_stairs:half=top\n");
		Files.writeString(pack.resolve("gbuffers_terrain.vsh"), """
			#version 120
			attribute vec4 mc_Entity;
			varying vec2 uv; varying vec2 lm; varying vec4 color;
			void main() { gl_Position = ftransform(); uv = gl_MultiTexCoord0.xy; lm = (gl_TextureMatrix[1] * gl_MultiTexCoord1).xy; color = gl_Color; if (mc_Entity.x == 10001) color.rgb *= 0.5; }
			""");
		Files.writeString(pack.resolve("gbuffers_terrain.fsh"), """
			#version 120
			#define STRENGTH 1.0 // [0.5 1.0 2.0]
			uniform sampler2D texture; uniform sampler2D lightmap;
			varying vec2 uv; varying vec2 lm; varying vec4 color;
			void main() { vec4 c = texture2D(texture, uv) * color * STRENGTH; c.rgb *= texture2D(lightmap, lm).rgb;
			/* DRAWBUFFERS:0 */ gl_FragData[0] = c; }
			""");
		String quad = "#version 120\nvarying vec2 tc;\nvoid main() { gl_Position = ftransform(); tc = gl_MultiTexCoord0.xy; }\n";
		Files.writeString(pack.resolve("composite.vsh"), quad);
		Files.writeString(pack.resolve("composite.fsh"), """
			#version 120
			#define SHADOWS // Sun shadows
			uniform sampler2D colortex0; uniform sampler2DShadow shadowtex0; varying vec2 tc;
			void main() { vec3 c = texture2D(colortex0, tc).rgb;
			#ifdef SHADOWS
			c *= shadow2D(shadowtex0, vec3(tc, 0.5)).r;
			#endif
			/* DRAWBUFFERS:0 */ gl_FragData[0] = vec4(c, 1); }
			""");
		Files.writeString(pack.resolve("final.vsh"), quad);
		Files.writeString(pack.resolve("final.fsh"), "#version 120\nuniform sampler2D colortex0; varying vec2 tc;\nvoid main() { gl_FragColor = texture2D(colortex0, tc); }\n");

		check(call(ctx, "GET", "/api/shaders").contains("\"id\":\"litweb-test\""), "test pack is listed");
		JsonObject on = json(call(ctx, "POST", "/api/shaders/load", "{\"pack\":\"litweb-test\"}"));
		JsonObject progs = on.getAsJsonObject("programs");
		for (String n : new String[] {"gbuffers_terrain", "composite", "final"}) {
			JsonObject p = progs.getAsJsonObject(n);
			check(p != null && !p.has("error") && p.get("fs").getAsString().startsWith("#version 300 es"), n + " translated: " + p);
		}
		check(on.toString().contains("\"n\":\"SHADOWS\",\"t\":\"b\"") && on.toString().contains("\"n\":\"STRENGTH\",\"t\":\"v\""), "options found " + on.get("options"));
		check(on.getAsJsonObject("blocks").has("minecraft:oak_stairs"), "block.properties parsed");
		JsonObject off = json(call(ctx, "POST", "/api/shaders/load", "{\"pack\":\"litweb-test\",\"options\":{\"SHADOWS\":\"false\",\"STRENGTH\":\"2.0\"}}"));
		check(!off.getAsJsonObject("programs").has("composite"), "program.composite.enabled follows the option");
		check(off.getAsJsonObject("programs").getAsJsonObject("gbuffers_terrain").get("fs").getAsString().contains("2.0"), "option value reaches the shader");
	}

	private static JsonObject json(String s) {
		return JsonParser.parseString(s).getAsJsonObject();
	}

	private static void check(boolean ok, String what) {
		if (!ok) throw new AssertionError("Failed: " + what);
	}

	private static HttpRequest req(String method, String path) {
		return req(method, path, null);
	}

	private static HttpRequest req(String method, String path, String body) {
		return HttpRequest.newBuilder(URI.create(LitWebClient.url() + path.substring(1)))
			.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body)).build();
	}

	/** The HTTP handlers hop onto the client thread, so keep ticking while waiting. */
	private static String call(ClientGameTestContext ctx, String method, String path) {
		return call(ctx, method, path, null);
	}

	private static String call(ClientGameTestContext ctx, String method, String path, String body) {
		CompletableFuture<HttpResponse<String>> f = HTTP.sendAsync(req(method, path, body), HttpResponse.BodyHandlers.ofString());
		ctx.waitFor(mc -> f.isDone(), 2400);
		HttpResponse<String> r = f.join();
		if (r.statusCode() != 200) throw new AssertionError(method + " " + path + " -> " + r.statusCode() + " " + r.body());
		return r.body();
	}
}
