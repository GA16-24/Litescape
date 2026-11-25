package dev.ga16.litweb.client;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.reflect.TypeToken;
import dev.ga16.litweb.LitWeb;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Stream;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.level.storage.LevelResource;
import org.jspecify.annotations.Nullable;

/**
 * Servers this client has joined with the server mod. Their shared-schematic lists and the schematics
 * already downloaded are kept on disk, so the page can still show them after you leave.
 */
final class Servers {
	record Id(String key, String name, String address) {}

	private static final class Entry {
		String name = "", address = "";
		long seen;
		/** The shared list as the server last sent it to this player, so it only holds what they may see. */
		String shared = "[]";
	}

	private static final Gson GSON = new Gson();
	private static final Path DIR = FabricLoader.getInstance().getConfigDir().resolve("litweb-servers");
	private static final Path FILE = DIR.resolve("servers.json");
	private static final Map<String, Entry> known = load();

	/** The server or world the client is in, or null in the menus. Client thread. */
	static @Nullable Id current() {
		Minecraft mc = Minecraft.getInstance();
		if (mc.getConnection() == null) return null;
		ServerData sd = mc.getCurrentServer();
		if (sd != null) return new Id("server:" + sd.ip.toLowerCase(Locale.ROOT), sd.name, sd.ip);
		MinecraftServer sp = mc.getSingleplayerServer();
		if (sp == null) return null;
		Path world = sp.getWorldPath(LevelResource.ROOT).toAbsolutePath().normalize();
		return new Id("world:" + world, sp.getWorldData().getLevelName(), "Singleplayer");
	}

	/** Called with every shared list the current server sends. Client thread. */
	static synchronized void remember(String sharedJson) {
		Id id = current();
		if (id == null) return;
		Entry e = known.computeIfAbsent(id.key(), k -> new Entry());
		e.name = id.name();
		e.address = id.address();
		e.seen = System.currentTimeMillis();
		e.shared = sharedJson;
		Set<String> ids = new HashSet<>();
		for (var s : JsonParser.parseString(sharedJson).getAsJsonArray()) ids.add(s.getAsJsonObject().get("id").getAsString());
		try {
			Files.createDirectories(DIR);
			Path tmp = DIR.resolve("servers.json.tmp");
			Files.writeString(tmp, GSON.toJson(known));
			Files.move(tmp, FILE, java.nio.file.StandardCopyOption.REPLACE_EXISTING, java.nio.file.StandardCopyOption.ATOMIC_MOVE);
			// Drop saved copies of schematics that were unshared or are no longer visible to this player.
			Path blobs = blobDir(id.key());
			if (Files.isDirectory(blobs)) try (Stream<Path> files = Files.list(blobs)) {
				for (Path f : (Iterable<Path>) files::iterator) {
					if (!ids.contains(f.getFileName().toString().replace(".bin", ""))) Files.delete(f);
				}
			}
		} catch (IOException ex) {
			LitWeb.LOG.warn("Could not save the remembered server list", ex);
		}
	}

	/** Every remembered server, most recently visited first; `shared` is what the page shows while you're elsewhere. */
	static synchronized JsonArray json() {
		JsonArray out = new JsonArray();
		known.entrySet().stream().sorted((a, b) -> Long.compare(b.getValue().seen, a.getValue().seen)).forEach(en -> {
			JsonObject o = new JsonObject();
			o.addProperty("key", en.getKey());
			o.addProperty("name", en.getValue().name);
			o.addProperty("address", en.getValue().address);
			o.addProperty("seen", en.getValue().seen);
			o.add("shared", JsonParser.parseString(en.getValue().shared));
			out.add(o);
		});
		return out;
	}

	static void saveBlob(String key, String id, byte[] blob) {
		try {
			Files.createDirectories(blobDir(key));
			Files.write(blobDir(key).resolve(UUID.fromString(id) + ".bin"), blob);
		} catch (IOException | IllegalArgumentException e) {
			LitWeb.LOG.warn("Could not save a copy of shared schematic {}", id, e);
		}
	}

	/** The schematic as last downloaded from that server, or null if it never was. */
	static byte @Nullable [] blob(String key, String id) throws IOException {
		Path f = blobDir(key).resolve(UUID.fromString(id) + ".bin");
		return Files.exists(f) ? Files.readAllBytes(f) : null;
	}

	private static Path blobDir(String key) {
		return DIR.resolve(UUID.nameUUIDFromBytes(key.getBytes(StandardCharsets.UTF_8)).toString());
	}

	private static Map<String, Entry> load() {
		try {
			if (Files.exists(FILE)) {
				Map<String, Entry> m = GSON.fromJson(Files.readString(FILE), new TypeToken<LinkedHashMap<String, Entry>>() {}.getType());
				if (m != null) return m;
			}
		} catch (Exception e) {
			LitWeb.LOG.warn("Could not read the remembered server list", e);
		}
		return new LinkedHashMap<>();
	}

	private Servers() {}
}
