package dev.ga16.litweb;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;
import com.google.gson.reflect.TypeToken;
import dev.ga16.litweb.Net.Reply;
import dev.ga16.litweb.Net.Req;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.io.Reader;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.UUID;
import java.util.zip.DeflaterOutputStream;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;
import net.fabricmc.fabric.api.networking.v1.ServerPlayNetworking;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.Identifier;
import net.minecraft.resources.ResourceKey;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.permissions.Permissions;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.chunk.LevelChunk;
import net.minecraft.world.level.storage.LevelResource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Server half: reads world regions for the web viewer, stores schematics that players
 * choose to share, and diffs them against the live world to report build progress.
 */
public final class LitWeb implements ModInitializer {
	public static final Logger LOG = LoggerFactory.getLogger("litweb");
	/** Region reads run on the server thread, so they get a smaller cap than local views. */
	static final int SERVER_READ_MAX = 4_194_304;
	static final int MAX_UPLOAD_BYTES = 32 << 20;
	/** Players one schematic can be shared with by name; keeps index.json and the list push small. */
	static final int MAX_PLAYERS = 100;
	private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

	/** Metadata for one shared schematic; the blocks live in <id>.bin. */
	public static final class Shared {
		public String id, name, owner, ownerName, dim, author;
		public int[] origin, size;
		public long updated;
		/** Who can see it besides the owner and operators: everyone | players | private. Null (older index.json) = everyone. */
		public @org.jspecify.annotations.Nullable String access;
		/** Player UUID -> name; the players who can see it when access is "players". */
		public Map<String, String> players = new LinkedHashMap<>();
		/** Player UUID -> blocks they placed that match the schematic, counted since it was shared. */
		public Map<String, Contributor> contributors = new LinkedHashMap<>();
		/** Blocks of terrain captured around it (0 = none); the snapshot lives in <id>.terrain.bin. */
		public int margin;
		/** When the surroundings were captured, and how many of their chunks the server had loaded then. */
		public long captured;
		public int chunks, chunksCaptured;
	}

	public static final class Contributor {
		public String name;
		public int placed;
		public long last;
	}

	private static @org.jspecify.annotations.Nullable LitWeb instance;
	private @org.jspecify.annotations.Nullable MinecraftServer server;
	private boolean contributorsDirty;
	/** Positions already credited, so breaking and re-placing a block doesn't count twice. Saved as <id>.credited. */
	private final Map<String, java.util.BitSet> credited = new HashMap<>();
	private final Set<String> creditedDirty = new HashSet<>();

	private final Map<String, Shared> shared = new LinkedHashMap<>();
	private final Map<String, Volume> loaded = new HashMap<>();
	private final Map<UUID, ByteArrayOutputStream> uploads = new HashMap<>();
	private final Map<UUID, Long> lastStatus = new HashMap<>();
	private final Properties config = new Properties();
	private Path dir;

	@Override
	public void onInitialize() {
		PayloadTypeRegistry.serverboundPlay().register(Req.TYPE, Req.CODEC);
		PayloadTypeRegistry.clientboundPlay().register(Reply.TYPE, Reply.CODEC);
		instance = this;
		ServerLifecycleEvents.SERVER_STARTED.register(this::load);
		ServerLifecycleEvents.SERVER_STOPPING.register(s -> flushContributors());
		// Contribution counts change on every placed block; save and push them at most every 5 seconds.
		net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents.END_SERVER_TICK.register(s -> {
			if (s.getTickCount() % 100 == 0) flushContributors();
		});
		ServerPlayConnectionEvents.DISCONNECT.register((h, s) -> {
			uploads.remove(h.player.getUUID());
			lastStatus.remove(h.player.getUUID());
		});
		ServerPlayNetworking.registerGlobalReceiver(Req.TYPE, (req, ctx) -> {
			ServerPlayer player = ctx.player();
			try {
				handle(ctx.server(), player, req);
			} catch (IOException e) { // expected refusals: permission, limits, missing schematic
				send(player, req.req(), e.getMessage(), new byte[0]);
			} catch (Exception e) {
				LOG.warn("Request {} from {} failed", req.op(), player.getPlainTextName(), e);
				send(player, req.req(), e.getMessage() == null ? e.toString() : e.getMessage(), new byte[0]);
			}
		});
	}

	private void load(MinecraftServer server) {
		this.server = server;
		shared.clear();
		loaded.clear();
		credited.clear();
		creditedDirty.clear();
		Path cfg = FabricLoader.getInstance().getConfigDir().resolve("litweb-server.properties");
		config.setProperty("region-read", "ops");
		config.setProperty("shared-progress", "everyone");
		config.setProperty("max-shared-per-player", "20");
		config.setProperty("terrain-capture", "ops");
		config.setProperty("terrain-max-margin", "32");
		try {
			if (Files.exists(cfg)) {
				try (Reader r = Files.newBufferedReader(cfg)) {
					config.load(r);
				}
			} else {
				try (Writer w = Files.newBufferedWriter(cfg)) {
					config.store(w, "Litescape. region-read / shared-progress / terrain-capture: ops | everyone | none");
				}
			}
			dir = server.getWorldPath(LevelResource.ROOT).resolve("litweb");
			Files.createDirectories(dir);
			Path index = dir.resolve("index.json");
			if (Files.exists(index)) {
				List<Shared> list = GSON.fromJson(Files.readString(index), new TypeToken<List<Shared>>() {}.getType());
				if (list != null) for (Shared s : list) {
					if (s.contributors == null) s.contributors = new LinkedHashMap<>(); // index.json from before contributors existed
					if (s.players == null) s.players = new LinkedHashMap<>(); // index.json from before access existed
					shared.put(s.id, s);
				}
			}
		} catch (IOException e) {
			LOG.error("Could not load litweb data", e);
		}
	}

	private boolean allowed(ServerPlayer player, String key) {
		return switch (config.getProperty(key, "ops")) {
			case "everyone" -> true;
			case "ops" -> player.permissions().hasPermission(Permissions.COMMANDS_GAMEMASTER);
			default -> false;
		};
	}

	private static boolean isOp(ServerPlayer player) {
		return player.permissions().hasPermission(Permissions.COMMANDS_GAMEMASTER);
	}

	static boolean canManage(ServerPlayer player, Shared s) {
		return s.owner.equals(player.getStringUUID()) || isOp(player);
	}

	static boolean canSee(ServerPlayer player, Shared s) {
		if (s.access == null || s.access.equals("everyone") || canManage(player, s)) return true;
		return s.access.equals("players") && s.players.containsKey(player.getStringUUID());
	}

	private void handle(MinecraftServer server, ServerPlayer player, Req req) throws IOException {
		switch (req.op()) {
			case "list" -> send(player, req.req(), "", listJson(player));
			case "config" -> {
				JsonObject o = new JsonObject();
				o.addProperty("capture", allowed(player, "terrain-capture"));
				o.addProperty("maxMargin", maxMargin());
				send(player, req.req(), "", GSON.toJson(o).getBytes(StandardCharsets.UTF_8));
			}
			case "terrain" -> {
				Shared s = require(player, req.arg());
				Path file = dir.resolve(s.id + ".terrain.bin");
				if (s.margin == 0 || !Files.exists(file)) throw new IOException("No surroundings were captured for this schematic");
				send(player, req.req(), "", Files.readAllBytes(file));
			}
			case "capture" -> { // Recapture, or change how much surrounding terrain to keep
				JsonObject a = GSON.fromJson(req.arg(), JsonObject.class);
				Shared s = require(player, a.get("id").getAsString());
				if (!canManage(player, s)) throw new IOException("Only " + s.ownerName + " or an operator can recapture its surroundings");
				ServerLevel level = server.getLevel(ResourceKey.create(Registries.DIMENSION, Identifier.parse(s.dim)));
				if (level == null) throw new IOException("Dimension " + s.dim + " does not exist");
				capture(player, s, volume(s), level, a.get("margin").getAsInt());
				saveIndexAndBroadcast(server);
				send(player, req.req(), "", new byte[0]);
			}
			case "region" -> {
				if (!allowed(player, "region-read")) throw new IOException("no-permission");
				List<int[]> boxes = readBoxes(req.data());
				int[] u = Volume.union(boxes);
				long volume = (long) (u[3] - u[0] + 1) * (u[4] - u[1] + 1) * (u[5] - u[2] + 1);
				if (volume > SERVER_READ_MAX) throw new IOException("Area is too large for a server read (" + volume + " > " + SERVER_READ_MAX + " blocks)");
				ServerLevel level = player.level();
				Volume v = Volume.ofBoxes(boxes);
				v.fill(boxes, loadedOnly(level));
				send(player, req.req(), "", v.encode());
			}
			case "get" -> {
				Shared s = require(player, req.arg());
				send(player, req.req(), "", Files.readAllBytes(dir.resolve(s.id + ".bin")));
			}
			case "status" -> {
				if (!allowed(player, "shared-progress")) throw new IOException("no-permission");
				long now = System.currentTimeMillis();
				if (now - lastStatus.getOrDefault(player.getUUID(), 0L) < 750) throw new IOException("rate-limited");
				lastStatus.put(player.getUUID(), now);
				Shared s = require(player, req.arg());
				ServerLevel level = server.getLevel(ResourceKey.create(Registries.DIMENSION, Identifier.parse(s.dim)));
				if (level == null) throw new IOException("Dimension " + s.dim + " does not exist");
				send(player, req.req(), "", status(volume(s), level));
			}
			case "upload" -> upload(server, player, req);
			case "access" -> {
				JsonObject a = GSON.fromJson(req.arg(), JsonObject.class);
				Shared s = require(player, a.get("id").getAsString());
				if (!canManage(player, s)) throw new IOException("Only " + s.ownerName + " or an operator can change who sees this schematic");
				String access = a.get("access").getAsString();
				if (!List.of("everyone", "players", "private").contains(access)) throw new IOException("Unknown access " + access);
				Map<String, String> players = new LinkedHashMap<>();
				for (var e : a.getAsJsonObject("players").entrySet()) {
					String name = e.getValue().getAsString();
					if (players.size() >= MAX_PLAYERS || !name.matches("[\\w.]{1,32}")) throw new IOException("Bad player list");
					players.put(UUID.fromString(e.getKey()).toString(), name); // throws on a bad UUID
				}
				s.access = access;
				s.players = players;
				saveIndexAndBroadcast(server);
				send(player, req.req(), "", new byte[0]);
			}
			case "delete" -> {
				Shared s = require(player, req.arg());
				if (!canManage(player, s)) throw new IOException("Only " + s.ownerName + " or an operator can stop sharing this schematic");
				shared.remove(s.id);
				loaded.remove(s.id);
				credited.remove(s.id);
				creditedDirty.remove(s.id);
				Files.deleteIfExists(dir.resolve(s.id + ".bin"));
				Files.deleteIfExists(dir.resolve(s.id + ".credited"));
				Files.deleteIfExists(dir.resolve(s.id + ".terrain.bin"));
				saveIndexAndBroadcast(server);
				send(player, req.req(), "", new byte[0]);
			}
			default -> throw new IOException("Unknown op " + req.op());
		}
	}

	private void upload(MinecraftServer server, ServerPlayer player, Req req) throws IOException {
		JsonObject meta = GSON.fromJson(req.arg(), JsonObject.class);
		int part = meta.get("part").getAsInt(), parts = meta.get("parts").getAsInt();
		ByteArrayOutputStream buf = part == 0 ? new ByteArrayOutputStream() : uploads.get(player.getUUID());
		if (buf == null) throw new IOException("Upload out of order");
		if (buf.size() + req.data().length > MAX_UPLOAD_BYTES) {
			uploads.remove(player.getUUID());
			throw new IOException("Schematic is too large to share");
		}
		buf.write(req.data());
		uploads.put(player.getUUID(), buf);
		if (part < parts - 1) return; // the client waits for the reply to the last part only
		uploads.remove(player.getUUID());

		byte[] data = buf.toByteArray();
		Volume v = Volume.decode(data); // validates before anything touches disk
		String owner = player.getStringUUID();
		String id = UUID.nameUUIDFromBytes((owner + ":" + meta.get("key").getAsString()).getBytes(StandardCharsets.UTF_8)).toString();
		long mine = shared.values().stream().filter(s -> s.owner.equals(owner) && !s.id.equals(id)).count();
		if (mine >= Integer.parseInt(config.getProperty("max-shared-per-player", "20"))) {
			throw new IOException("You are already sharing " + mine + " schematics. Stop sharing one first.");
		}
		Shared s = new Shared();
		s.id = id;
		s.name = meta.get("name").getAsString();
		s.owner = owner;
		s.ownerName = player.getPlainTextName();
		s.dim = player.level().dimension().identifier().toString();
		s.origin = new int[] {v.x0, v.y0, v.z0};
		s.size = new int[] {v.sx, v.sy, v.sz};
		s.updated = System.currentTimeMillis();
		if (meta.has("author")) s.author = meta.get("author").getAsString().substring(0, Math.min(64, meta.get("author").getAsString().length()));
		s.access = "private"; // new shares stay with the owner until they choose who else sees them
		Shared old = shared.get(id);
		if (old != null) { // "Update copy" keeps who helped so far and who can see it
			s.contributors = old.contributors;
			s.access = old.access;
			s.players = old.players;
		}
		// Old clients send no margin; they get no surroundings rather than stale ones from before a move.
		int margin = meta.has("margin") ? meta.get("margin").getAsInt() : 0;
		if (old != null && old.margin > 0 && margin == old.margin && !allowed(player, "terrain-capture")) {
			// Someone who may no longer capture keeps the snapshot while the schematic stays put; a move would leave it in the wrong place.
			if (!Arrays.equals(old.origin, s.origin) || !Arrays.equals(old.size, s.size)) {
				throw new IOException("This server no longer lets you capture surroundings, so they can't follow the move. Remove them in the Surroundings panel first.");
			}
			s.margin = old.margin;
			s.captured = old.captured;
			s.chunks = old.chunks;
			s.chunksCaptured = old.chunksCaptured;
		} else capture(player, s, v, player.level(), margin);
		Files.write(dir.resolve(id + ".bin"), data);
		shared.put(id, s);
		loaded.put(id, v);
		saveIndexAndBroadcast(server);
		send(player, req.req(), "", id.getBytes(StandardCharsets.UTF_8));
	}

	private int maxMargin() {
		try {
			return Math.max(0, Math.min(64, Integer.parseInt(config.getProperty("terrain-max-margin", "32").trim())));
		} catch (NumberFormatException e) {
			return 32;
		}
	}

	/**
	 * Snapshots the terrain up to margin blocks around a shared schematic, from loaded chunks only, minus the
	 * schematic's own blocks: progress there comes from the live world. margin 0 drops any earlier snapshot.
	 */
	private void capture(ServerPlayer player, Shared s, Volume schem, ServerLevel level, int margin) throws IOException {
		Path file = dir.resolve(s.id + ".terrain.bin");
		if (margin == 0) {
			Files.deleteIfExists(file);
			s.margin = 0;
			s.captured = 0;
			s.chunks = s.chunksCaptured = 0;
			return;
		}
		if (margin < 0 || margin > maxMargin()) throw new IOException("Surroundings can reach at most " + maxMargin() + " blocks on this server");
		if (!allowed(player, "terrain-capture")) throw new IOException("This server doesn't let you capture surroundings");
		int[] box = {schem.x0 - margin, Math.max(level.getMinY(), schem.y0 - margin), schem.z0 - margin,
			schem.x0 + schem.sx - 1 + margin, Math.min(level.getMaxY(), schem.y0 + schem.sy - 1 + margin), schem.z0 + schem.sz - 1 + margin};
		long volume = (long) (box[3] - box[0] + 1) * Math.max(0, box[4] - box[1] + 1) * (box[5] - box[2] + 1);
		if (box[4] < box[1] || volume > SERVER_READ_MAX) {
			throw new IOException("Surroundings of " + margin + " blocks are too large to capture (" + volume + " > " + SERVER_READ_MAX + " blocks)");
		}
		var world = loadedOnly(level);
		BlockState air = net.minecraft.world.level.block.Blocks.AIR.defaultBlockState();
		Volume t = Volume.ofBoxes(List.of(box));
		t.fill(List.of(box), pos -> {
			int x = pos.getX() - schem.x0, y = pos.getY() - schem.y0, z = pos.getZ() - schem.z0;
			if (x >= 0 && y >= 0 && z >= 0 && x < schem.sx && y < schem.sy && z < schem.sz) {
				BlockState want = schem.palette.get(schem.blocks[schem.at(x, y, z)]);
				if (want != null && !want.isAir()) return air;
			}
			return world.apply(pos);
		});
		int chunks = 0, loaded = 0;
		for (int cx = box[0] >> 4; cx <= box[3] >> 4; cx++)
			for (int cz = box[2] >> 4; cz <= box[5] >> 4; cz++, chunks++)
				if (level.getChunkSource().getChunkNow(cx, cz) != null) loaded++;
		Files.write(file, t.encode());
		s.margin = margin;
		s.captured = System.currentTimeMillis();
		s.chunks = chunks;
		s.chunksCaptured = loaded;
	}

	/** Called by the BlockItem mixin on the server thread after a player places a block. */
	public static void onPlaced(ServerPlayer player, BlockPos pos, BlockState placed) {
		if (instance != null) instance.placed(player, pos, placed);
	}

	private void placed(ServerPlayer player, BlockPos pos, BlockState placed) {
		String dim = player.level().dimension().identifier().toString();
		for (Shared s : shared.values()) {
			int x = pos.getX() - s.origin[0], y = pos.getY() - s.origin[1], z = pos.getZ() - s.origin[2];
			if (!s.dim.equals(dim) || x < 0 || y < 0 || z < 0 || x >= s.size[0] || y >= s.size[1] || z >= s.size[2]) continue;
			BlockState want;
			try {
				Volume v = volume(s);
				want = v.palette.get(v.blocks[v.at(x, y, z)]);
			} catch (IOException e) {
				continue;
			}
			// The right block counts even if its orientation still needs fixing.
			if (want == null || want.isAir() || want.getBlock() != placed.getBlock()) continue;
			java.util.BitSet done = credited.computeIfAbsent(s.id, this::readCredited);
			int index = (y * s.size[2] + z) * s.size[0] + x;
			if (done.get(index)) continue;
			done.set(index);
			creditedDirty.add(s.id);
			Contributor c = s.contributors.computeIfAbsent(player.getStringUUID(), k -> new Contributor());
			c.name = player.getPlainTextName();
			c.placed++;
			c.last = System.currentTimeMillis();
			contributorsDirty = true;
		}
	}

	private void flushContributors() {
		if (!contributorsDirty || server == null || dir == null) return;
		contributorsDirty = false;
		try {
			for (String id : creditedDirty) {
				if (shared.containsKey(id)) Files.write(dir.resolve(id + ".credited"), credited.get(id).toByteArray());
			}
			creditedDirty.clear();
			saveIndexAndBroadcast(server);
		} catch (IOException e) {
			LOG.warn("Could not save contribution counts", e);
		}
	}

	private java.util.BitSet readCredited(String id) {
		Path file = dir.resolve(id + ".credited");
		try {
			return Files.exists(file) ? java.util.BitSet.valueOf(Files.readAllBytes(file)) : new java.util.BitSet();
		} catch (IOException e) {
			LOG.warn("Could not read credited blocks for {}", id, e);
			return new java.util.BitSet();
		}
	}

	/** A schematic the player can't see reads as gone, so its existence doesn't leak. */
	private Shared require(ServerPlayer player, String id) throws IOException {
		Shared s = shared.get(id);
		if (s == null || !canSee(player, s)) throw new IOException("That schematic is no longer shared");
		return s;
	}

	private Volume volume(Shared s) throws IOException {
		Volume v = loaded.get(s.id);
		if (v == null) {
			v = Volume.decode(Files.readAllBytes(dir.resolve(s.id + ".bin")));
			loaded.put(s.id, v);
		}
		return v;
	}

	static byte[] status(Volume v, ServerLevel level) {
		int[] counts = new int[6];
		byte[] st = v.diff(loadedOnly(level), counts);
		return encodeStatus(counts, st);
	}

	/**
	 * Reads only chunks that are already loaded (null = unknown). Loading on demand would
	 * block the server thread and could generate terrain for a far-away selection.
	 */
	static java.util.function.Function<BlockPos, BlockState> loadedOnly(ServerLevel level) {
		LevelChunk[] last = {null};
		return pos -> {
			int cx = pos.getX() >> 4, cz = pos.getZ() >> 4;
			LevelChunk c = last[0];
			if (c == null || c.getPos().x() != cx || c.getPos().z() != cz) {
				c = level.getChunkSource().getChunkNow(cx, cz);
				if (c == null) return null;
				last[0] = c;
			}
			return c.getBlockState(pos);
		};
	}

	private static byte[] encodeStatus(int[] counts, byte[] st) {
		ByteArrayOutputStream bytes = new ByteArrayOutputStream();
		try (DataOutputStream out = new DataOutputStream(new DeflaterOutputStream(bytes))) {
			for (int c : counts) out.writeInt(c);
			out.write(st);
		} catch (IOException e) {
			throw new IllegalStateException(e);
		}
		return bytes.toByteArray();
	}

	public static List<int[]> readBoxes(byte[] data) throws IOException {
		DataInputStream in = new DataInputStream(new ByteArrayInputStream(data));
		int n = in.readInt();
		if (n < 1 || n > 256) throw new IOException("Bad box count");
		List<int[]> boxes = new ArrayList<>();
		for (int i = 0; i < n; i++) {
			int[] b = new int[6];
			for (int j = 0; j < 6; j++) b[j] = in.readInt();
			boxes.add(b);
		}
		return boxes;
	}

	public static byte[] writeBoxes(List<int[]> boxes) {
		ByteArrayOutputStream bytes = new ByteArrayOutputStream();
		try (DataOutputStream out = new DataOutputStream(bytes)) {
			out.writeInt(boxes.size());
			for (int[] b : boxes) for (int v : b) out.writeInt(v);
		} catch (IOException e) {
			throw new IllegalStateException(e);
		}
		return bytes.toByteArray();
	}

	/** The schematics this player can see, each with whether they may manage it. */
	private byte[] listJson(ServerPlayer player) {
		com.google.gson.JsonArray list = new com.google.gson.JsonArray();
		for (Shared s : shared.values()) {
			if (!canSee(player, s)) continue;
			JsonObject o = GSON.toJsonTree(s).getAsJsonObject();
			o.addProperty("manage", canManage(player, s));
			list.add(o);
		}
		return GSON.toJson(list).getBytes(StandardCharsets.UTF_8);
	}

	private void saveIndexAndBroadcast(MinecraftServer server) throws IOException {
		Path tmp = dir.resolve("index.json.tmp");
		Files.writeString(tmp, GSON.toJson(shared.values()));
		Files.move(tmp, dir.resolve("index.json"), java.nio.file.StandardCopyOption.REPLACE_EXISTING, java.nio.file.StandardCopyOption.ATOMIC_MOVE);
		for (ServerPlayer p : server.getPlayerList().getPlayers()) {
			if (ServerPlayNetworking.canSend(p, Reply.TYPE)) send(p, Net.PUSH_LIST, "", listJson(p));
		}
	}

	static void send(ServerPlayer player, int req, String error, byte[] data) {
		int parts = Math.max(1, (data.length + Net.DOWN_PART - 1) / Net.DOWN_PART);
		for (int i = 0; i < parts; i++) {
			byte[] chunk = Arrays.copyOfRange(data, i * Net.DOWN_PART, Math.min(data.length, (i + 1) * Net.DOWN_PART));
			ServerPlayNetworking.send(player, new Reply(req, i, parts, error, chunk));
		}
	}
}
