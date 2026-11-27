package dev.ga16.litweb.client;

// The desktop app runs its test server and reads its block table on the newest Minecraft line only.
//? if >=26.3 {

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import dev.ga16.litweb.LitWeb;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.List;
import java.util.zip.GZIPOutputStream;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.SharedConstants;
import net.minecraft.client.Minecraft;
import net.minecraft.core.BlockPos;
import net.minecraft.resources.Identifier;
import net.minecraft.util.Util;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;

/**
 * How every block looks, saved for the desktop app so it can show schematic files while Minecraft is closed:
 * ~/.litescape/blocks/&lt;version&gt;/states.json.gz holds the viewer's palette entry for each block state, keyed
 * "minecraft:lever[face=floor,facing=east,powered=false]", and tex/ holds their textures. Written again when the mod
 * version or the resource packs change.
 */
final class BlockTable {
	private static final Path DIR = Path.of(System.getProperty("user.home"), ".litescape", "blocks", SharedConstants.getCurrentVersion().name());
	/** Block states turned into models per tick, so the title screen doesn't stall. */
	private static final int PER_TICK = 2000;
	/** Goes up when the entries change, so tables saved by an older build are written again. */
	private static final int FORMAT = 2;

	private static String saved = "";
	private static List<BlockState> states = List.of();
	private static int next = -1;
	private static Models models;
	private static JsonObject out;

	static void init() {
		try {
			saved = Files.readString(DIR.resolve("key.txt"));
		} catch (IOException e) {
			// not exported yet
		}
		ClientTickEvents.END_CLIENT_TICK.register(BlockTable::tick);
	}

	private static String key(Minecraft mc) {
		String mod = FabricLoader.getInstance().getModContainer("litweb").map(m -> m.getMetadata().getVersion().getFriendlyString()).orElse("");
		return FORMAT + " " + mod + " " + String.join(",", mc.getResourcePackRepository().getSelectedIds());
	}

	private static void tick(Minecraft mc) {
		if (mc.gui.overlay() != null) {
			next = -1; // resources are (re)loading; start over once they're in
			return;
		}
		if (next < 0) {
			if (mc.level != null || saved.equals(key(mc))) return; // only from the menus, where nothing else needs the frame
			states = new ArrayList<>();
			for (BlockState s : Block.BLOCK_STATE_REGISTRY) states.add(s);
			models = new Models(null, BlockPos.ZERO, Models.SpawnRule.of(null, null));
			out = new JsonObject();
			next = 0;
		}
		JsonObject list = out.has("states") ? out.getAsJsonObject("states") : new JsonObject();
		out.add("states", list);
		for (int end = Math.min(states.size(), next + PER_TICK); next < end; next++) {
			JsonObject e = models.block(states.get(next));
			String p = e.get("p").getAsString();
			list.add(e.get("n").getAsString() + (p.isEmpty() ? "" : "[" + p + "]"), e);
		}
		if (next < states.size()) return;
		out.add("tex", models.tex());
		String key = key(mc);
		saved = key;
		JsonObject done = out;
		next = -1;
		Util.ioPool().execute(() -> write(mc, key, done));
	}

	/** Writes to a temporary folder first, so the app never reads half a table. */
	private static void write(Minecraft mc, String key, JsonObject table) {
		Path tmp = DIR.resolveSibling(DIR.getFileName() + ".tmp");
		try {
			delete(tmp);
			Files.createDirectories(tmp);
			try (Writer w = new java.io.OutputStreamWriter(new GZIPOutputStream(Files.newOutputStream(tmp.resolve("states.json.gz"))), StandardCharsets.UTF_8)) {
				w.write(table.toString());
			}
			for (JsonElement t : table.getAsJsonArray("tex")) {
				Identifier id = Identifier.parse(t.getAsJsonObject().get("id").getAsString());
				var res = mc.getResourceManager().getResource(id.withPath(p -> "textures/" + p + ".png"));
				if (res.isEmpty()) continue;
				Path file = tmp.resolve("tex").resolve(id.getNamespace()).resolve(id.getPath() + ".png");
				Files.createDirectories(file.getParent());
				try (InputStream in = res.get().open(); OutputStream o = Files.newOutputStream(file)) {
					in.transferTo(o);
				}
			}
			Files.writeString(tmp.resolve("key.txt"), key);
			delete(DIR);
			Files.move(tmp, DIR, StandardCopyOption.ATOMIC_MOVE);
		} catch (IOException | RuntimeException e) {
			LitWeb.LOG.warn("Could not save the block table for the desktop app", e);
		}
	}

	private static void delete(Path dir) throws IOException {
		if (Files.notExists(dir)) return;
		try (var files = Files.walk(dir)) {
			for (Path p : files.sorted(java.util.Comparator.reverseOrder()).toList()) Files.delete(p);
		}
	}
}
//?}
