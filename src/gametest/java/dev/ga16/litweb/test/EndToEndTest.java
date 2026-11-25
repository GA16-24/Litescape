package dev.ga16.litweb.test;

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
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import net.fabricmc.fabric.api.client.gametest.v1.FabricClientGameTest;
import net.fabricmc.fabric.api.client.gametest.v1.context.ClientGameTestContext;
import net.fabricmc.fabric.api.client.gametest.v1.context.TestServerContext;
import net.fabricmc.fabric.api.client.gametest.v1.context.TestSingleplayerContext;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.core.BlockPos;

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

				String shared = json(call(ctx, "POST", "/api/share?id=" + placement)).get("id").getAsString();
				String st3 = "";
				for (int i = 0; i < 40 && !st3.contains("\"sharedId\":\"" + shared); i++, ctx.waitTicks(5)) st3 = call(ctx, "GET", "/api/state");
				check(st3.contains("\"sharedId\":\"" + shared), "shared list push reached the client");
				save("state-3.json", st3);
				collectTextures(json(save("view-shared.json", call(ctx, "GET", "/api/view?type=shared&id=" + shared))));
				JsonObject sst = json(save("status-shared.json", call(ctx, "GET", "/api/status?type=shared&id=" + shared)));
				check(sst.getAsJsonArray("counts").toString().equals(c.toString()), "server status " + sst.get("counts") + " matches client " + c);

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
				ctx.takeScreenshot("litweb-scene");
			}
		} catch (IOException e) {
			throw new RuntimeException(e);
		}
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

	private static JsonObject json(String s) {
		return JsonParser.parseString(s).getAsJsonObject();
	}

	private static void check(boolean ok, String what) {
		if (!ok) throw new AssertionError("Failed: " + what);
	}

	private static HttpRequest req(String method, String path) {
		return HttpRequest.newBuilder(URI.create(LitWebClient.url() + path.substring(1)))
			.method(method, HttpRequest.BodyPublishers.noBody()).build();
	}

	/** The HTTP handlers hop onto the client thread, so keep ticking while waiting. */
	private static String call(ClientGameTestContext ctx, String method, String path) {
		CompletableFuture<HttpResponse<String>> f = HTTP.sendAsync(req(method, path), HttpResponse.BodyHandlers.ofString());
		ctx.waitFor(mc -> f.isDone(), 2400);
		HttpResponse<String> r = f.join();
		if (r.statusCode() != 200) throw new AssertionError(method + " " + path + " -> " + r.statusCode() + " " + r.body());
		return r.body();
	}
}
