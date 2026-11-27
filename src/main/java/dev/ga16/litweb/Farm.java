package dev.ga16.litweb;

// The desktop app runs its test server and reads its block table on the newest Minecraft line only.
//? if >=26.3 {

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojang.authlib.GameProfile;
import com.mojang.brigadier.Command;
import com.mojang.serialization.Dynamic;
import com.mojang.serialization.JsonOps;
import io.netty.channel.ChannelFutureListener;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.minecraft.SharedConstants;
import net.minecraft.commands.Commands;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.NbtOps;
import net.minecraft.nbt.NbtUtils;
import net.minecraft.nbt.Tag;
import net.minecraft.network.Connection;
import net.minecraft.network.protocol.Packet;
import net.minecraft.network.protocol.PacketFlow;
import net.minecraft.resources.Identifier;
import net.minecraft.resources.ResourceKey;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.commands.FillBiomeCommand;
import net.minecraft.server.level.ClientInformation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.CommonListenerCookie;
import net.minecraft.server.network.ServerGamePacketListenerImpl;
import net.minecraft.util.datafix.DataFixers;
import net.minecraft.util.datafix.fixes.References;
import net.minecraft.world.Container;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.GameType;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.biome.Biome;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.ButtonBlock;
import net.minecraft.world.level.block.LeverBlock;
import net.minecraft.world.level.block.entity.AbstractFurnaceBlockEntity;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.levelgen.structure.BoundingBox;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;
import org.jspecify.annotations.Nullable;

/**
 * The farm test, on the Litescape app's own test server (desktop/localserver.js). The app writes a job to
 * litweb-farm/job.json and runs {@code litweb-farm run}: this pastes the build, puts a stand-in player at its AFK spot,
 * pulls the chosen levers and buttons, fast-forwards with the game's own sprint and counts what the build's containers
 * gained. Progress goes to the console as {@code LITWEB-FARM {json}} lines, and server load as {@code LITWEB-LOAD {json}}.
 * It overwrites the world where the build goes, so it only exists on servers started with -Dlitweb.farmServer=true.
 * Everything here runs on the server thread except {@link #status()}.
 */
public final class Farm {
	public static final String PROPERTY = "litweb.farmServer";
	private static final Path JOB = Path.of("litweb-farm", "job.json");
	/** Where the last test stood, so the next one clears it, even after a restart: {dimension, box: [x0, y0, z0, x1, y1, z1]}. */
	private static final Path LAST = Path.of("litweb-farm", "last.json");
	/** How long pasting may hold the server thread per tick. */
	private static final long PASTE_NANOS = 20_000_000L;
	/** Ticks the server is timed for before the build goes in, fast-forwarded like the test so the two compare. */
	private static final int BASELINE_TICKS = 200;
	/** Mobs spawn up to 8 chunks from a player, so ticking further out only costs time. */
	private static final int SPAWN_CHUNKS = 8;
	private static final GameProfile STAND_IN = new GameProfile(UUID.nameUUIDFromBytes("litweb:farm_test".getBytes()), "Stand-in");

	private static @Nullable Farm current;
	private static volatile String status = "{}";
	private static long tickStart, lastLoad, loadTicks;

	private final MinecraftServer server;
	private final ServerLevel level;
	private final String id;
	private final Volume v;
	private final List<BlockPos> flips;
	/** Containers kept full of an item, like a storage system feeding the farm; what they hold isn't the farm's output. */
	private final Map<BlockPos, Item> feed = new LinkedHashMap<>(); // in pick order, for the results
	private final @Nullable Vec3 afk;
	private final ResourceKey<Biome> biome;
	private final long target;
	private @Nullable StandIn stand;
	/** The last test's build and what it left lying around, cleared first. */
	private @Nullable ServerLevel lastLevel;
	private @Nullable BoundingBox lastBox;
	private String state = "clearing";
	private int pasted, baselineTicks, clearingTicks;
	private long ticks, baselineNanos, runNanos, runningSince, publishedAt;
	private @Nullable Map<Item, Integer> before;

	/**
	 * The last test's progress as JSON: {id, state, progress, ticks, target, seconds, msBase, msTick, mobs, items: [[id, name, gained]],
	 * fed: [name of an item the test fed it], afk: whether a stand-in waited, smelting: {furnaces, smelted, top}, error}; top is how many items the furnaces could smelt an hour at most.
	 */
	public static String status() {
		return status;
	}

	/** Called once at startup: the command, the tick hooks and the load report, only on the app's test server. */
	static void init() {
		if (!Boolean.getBoolean(PROPERTY)) return;
		CommandRegistrationCallback.EVENT.register((dispatcher, registries, env) -> dispatcher.register(Commands.literal("litweb-farm")
			.requires(Commands.hasPermission(Commands.LEVEL_OWNERS))
			.then(Commands.literal("run").executes(ctx -> {
				try {
					start(ctx.getSource().getServer(), Files.readString(JOB));
				} catch (IOException | RuntimeException e) {
					fail(e.getMessage() == null ? e.toString() : e.getMessage());
				}
				return Command.SINGLE_SUCCESS;
			}))
			.then(Commands.literal("stop").executes(ctx -> {
				stop();
				return Command.SINGLE_SUCCESS;
			}))));
		ServerTickEvents.START_SERVER_TICK.register(s -> tickStart = System.nanoTime());
		ServerTickEvents.END_SERVER_TICK.register(Farm::tick);
	}

	/** Replaces any running test with the job's: {id, origin, size, palette, dataVersion, blocks, afk, flips, feed: [[x, y, z, item]], ticks, biome, dimension}. */
	public static void start(MinecraftServer server, String job) {
		stop();
		current = new Farm(server, JsonParser.parseString(job).getAsJsonObject());
		current.publish();
	}

	/** Ends the running test; its last counts stay in {@link #status()}. */
	public static void stop() {
		Farm f = current;
		if (f != null) f.finish("stopped", null);
	}

	private static void fail(String error) {
		JsonObject o = new JsonObject();
		o.addProperty("state", "error");
		o.addProperty("error", error);
		status = o.toString();
		LitWeb.LOG.info("LITWEB-FARM {}", status);
	}

	private Farm(MinecraftServer server, JsonObject job) {
		this.server = server;
		id = job.get("id").getAsString();
		ResourceKey<Level> dim = ResourceKey.create(Registries.DIMENSION, Identifier.parse(job.get("dimension").getAsString()));
		ServerLevel l = server.getLevel(dim);
		if (l == null) throw new IllegalArgumentException("No dimension " + dim.identifier());
		level = l;
		biome = ResourceKey.create(Registries.BIOME, Identifier.parse(job.get("biome").getAsString()));
		int[] o = ints(job.get("origin")), s = ints(job.get("size"));
		v = new Volume(o[0], o[1], o[2], s[0], s[1], s[2]);
		// Schematics from older versions name some blocks differently; the game's own upgrade renames them.
		int from = job.get("dataVersion").getAsInt(), to = SharedConstants.getCurrentVersion().dataVersion().version();
		List<Short> ids = new ArrayList<>();
		for (JsonElement e : job.getAsJsonArray("palette")) ids.add(v.idOf(state(e.getAsJsonObject(), from, to)));
		ByteBuffer raw = ByteBuffer.wrap(Base64.getDecoder().decode(job.get("blocks").getAsString())).order(ByteOrder.LITTLE_ENDIAN);
		if (raw.remaining() != v.blocks.length * 2) throw new IllegalArgumentException("The job's blocks don't match its size");
		for (int i = 0; i < v.blocks.length; i++) v.blocks[i] = ids.get(raw.getShort());
		flips = new ArrayList<>();
		for (JsonElement e : job.getAsJsonArray("flips")) {
			int[] p = ints(e);
			flips.add(new BlockPos(p[0], p[1], p[2]));
		}
		if (job.has("feed")) for (JsonElement e : job.getAsJsonArray("feed")) {
			JsonArray f = e.getAsJsonArray();
			feed.put(new BlockPos(f.get(0).getAsInt(), f.get(1).getAsInt(), f.get(2).getAsInt()), BuiltInRegistries.ITEM.getValue(Identifier.parse(f.get(3).getAsString())));
		}
		JsonElement a = job.get("afk");
		afk = a == null || a.isJsonNull() ? null : Vec3.atBottomCenterOf(new BlockPos(ints(a)[0], ints(a)[1], ints(a)[2]));
		target = job.get("ticks").getAsLong();
		try {
			if (Files.exists(LAST)) {
				JsonObject last = JsonParser.parseString(Files.readString(LAST)).getAsJsonObject();
				lastLevel = server.getLevel(ResourceKey.create(Registries.DIMENSION, Identifier.parse(last.get("dimension").getAsString())));
				int[] b = ints(last.get("box"));
				lastBox = new BoundingBox(b[0], b[1], b[2], b[3], b[4], b[5]);
			}
		} catch (IOException | RuntimeException e) {
			LitWeb.LOG.warn("Could not read where the last farm test was", e);
		}
	}

	private BlockState state(JsonObject e, int from, int to) {
		CompoundTag tag = (CompoundTag) JsonOps.INSTANCE.convertTo(NbtOps.INSTANCE, e);
		if (from < to) tag = (CompoundTag) DataFixers.getDataFixer().update(References.BLOCK_STATE, new Dynamic<>(NbtOps.INSTANCE, tag), from, to).getValue();
		// Older files call them Name and Properties; the game reads id and properties.
		if (!tag.contains("id") && tag.get("Name") instanceof Tag name) {
			tag.put("id", name);
			if (tag.get("Properties") instanceof Tag props) tag.put("properties", props);
		}
		return NbtUtils.readBlockState(level.holderLookup(Registries.BLOCK), tag); // air for blocks from mods that aren't here
	}

	private static int[] ints(JsonElement e) {
		JsonArray a = e.getAsJsonArray();
		int[] out = new int[a.size()];
		for (int i = 0; i < out.length; i++) out[i] = a.get(i).getAsInt();
		return out;
	}

	private static void tick(MinecraftServer server) {
		long now = System.nanoTime(), took = now - tickStart;
		loadTicks++;
		if (now - lastLoad >= 1_000_000_000L) {
			JsonObject o = new JsonObject();
			o.addProperty("mspt", server.getAverageTickTimeNanos() / 1e6);
			o.addProperty("tps", loadTicks * 1e9 / (now - lastLoad));
			o.addProperty("sprinting", server.tickRateManager().isSprinting());
			Runtime rt = Runtime.getRuntime();
			o.addProperty("heapMb", (rt.totalMemory() - rt.freeMemory()) >> 20);
			o.addProperty("maxMb", rt.maxMemory() >> 20);
			LitWeb.LOG.info("LITWEB-LOAD {}", o);
			lastLoad = now;
			loadTicks = 0;
		}
		Farm f = current;
		if (f == null) return;
		try {
			f.step(took);
		} catch (RuntimeException e) {
			LitWeb.LOG.warn("The farm test stopped", e);
			f.finish("error", e.getMessage() == null ? e.toString() : e.getMessage());
		}
	}

	private void step(long took) {
		switch (state) {
			case "clearing" -> {
				ServerLevel l = lastLevel;
				BoundingBox box = lastBox;
				if (l != null && box != null) {
					if (clearingTicks++ == 0) forceLast(true);
					// Its mobs load with its chunks, in the background; clear once they're in, or after 10 seconds.
					if (!lastLoaded(l, box) && clearingTicks < 200) break;
					for (BlockPos p : BlockPos.betweenClosed(box.minX(), box.minY(), box.minZ(), box.maxX(), box.maxY(), box.maxZ()))
						l.setBlock(p, Blocks.AIR.defaultBlockState(), Block.UPDATE_CLIENTS | Block.UPDATE_KNOWN_SHAPE);
					for (Entity e : l.getEntities((Entity) null, AABB.of(box).inflate(32), e -> !(e instanceof Player))) e.discard();
					forceLast(false);
				}
				state = "baseline";
			}
			case "baseline" -> {
				// What the server costs before the build is in, so the farm's own cost is the difference.
				if (baselineTicks++ == 0) server.tickRateManager().requestGameToSprint(BASELINE_TICKS);
				else baselineNanos += took; // the first tick includes clearing the last test
				if (baselineTicks > BASELINE_TICKS) {
					server.tickRateManager().stopSprinting();
					forceChunks(true);
					state = "pasting";
				}
			}
			case "pasting" -> {
				long end = System.nanoTime() + PASTE_NANOS;
				BlockPos.MutableBlockPos pos = new BlockPos.MutableBlockPos();
				while (pasted < v.blocks.length && System.nanoTime() < end) {
					int i = pasted++;
					BlockState s = v.palette.get(v.blocks[i]);
					pos.set(v.x0 + i % v.sx, v.y0 + i / (v.sx * v.sz), v.z0 + i / v.sx % v.sz);
					// Litematica's own paste flags: no neighbour or shape updates, so every block keeps its saved state.
					if (s != null) level.setBlock(pos, s, Block.UPDATE_CLIENTS | Block.UPDATE_KNOWN_SHAPE);
				}
				if (pasted == v.blocks.length) {
					setBiome();
					if (afk != null) {
						stand = new StandIn(server, level, afk);
						level.addNewPlayer(stand);
					}
					state = "loading";
				}
			}
			case "loading" -> {
				// Hoppers wait for their chunk's entities, which load in the background; switch the farm on once all is in.
				if (!loaded()) break;
				feed();
				before = count();
				for (BlockPos p : flips) flip(p);
				server.tickRateManager().requestGameToSprint((int) Math.min(Integer.MAX_VALUE, target));
				runningSince = System.nanoTime();
				state = "running";
			}
			case "running" -> {
				runNanos += took;
				feed();
				if (++ticks >= target) {
					server.tickRateManager().stopSprinting();
					finish("done", null);
					return;
				}
			}
			default -> {}
		}
		publish();
	}

	/** Loads or lets go of the last test's chunks and those around them, where its mobs may have wandered. */
	private void forceLast(boolean on) {
		ServerLevel l = lastLevel;
		BoundingBox b = lastBox;
		if (l == null || b == null) return;
		for (int cx = (b.minX() - 16) >> 4; cx <= (b.maxX() + 16) >> 4; cx++)
			for (int cz = (b.minZ() - 16) >> 4; cz <= (b.maxZ() + 16) >> 4; cz++) l.setChunkForced(cx, cz, on);
	}

	private static boolean lastLoaded(ServerLevel l, BoundingBox b) {
		for (int cx = (b.minX() - 16) >> 4; cx <= (b.maxX() + 16) >> 4; cx++)
			for (int cz = (b.minZ() - 16) >> 4; cz <= (b.maxZ() + 16) >> 4; cz++)
				if (!l.areEntitiesActuallyLoadedAndTicking(new ChunkPos(cx, cz))) return false;
		return true;
	}

	private void forceChunks(boolean on) {
		for (int cx = v.x0 >> 4; cx <= (v.x0 + v.sx - 1) >> 4; cx++)
			for (int cz = v.z0 >> 4; cz <= (v.z0 + v.sz - 1) >> 4; cz++) level.setChunkForced(cx, cz, on);
	}

	/** The chosen biome in and around the build, since what spawns depends on it. Done in slices under the game's /fillbiome limit. */
	private void setBiome() {
		var holder = level.registryAccess().lookupOrThrow(Registries.BIOME).getOrThrow(biome);
		int m = 8, x1 = v.x0 + v.sx + m, y1 = v.y0 + v.sy + m, z1 = v.z0 + v.sz + m;
		for (int x = v.x0 - m; x < x1; x += 32)
			for (int y = v.y0 - m; y < y1; y += 32)
				for (int z = v.z0 - m; z < z1; z += 32)
					FillBiomeCommand.fill(level, new BlockPos(x, y, z), new BlockPos(Math.min(x + 31, x1 - 1), Math.min(y + 31, y1 - 1), Math.min(z + 31, z1 - 1)), holder);
	}

	/** Whether every chunk of the build has its entities loaded and ticks them and its block entities, like a farm a player stands by. */
	private boolean loaded() {
		for (int cx = v.x0 >> 4; cx <= (v.x0 + v.sx - 1) >> 4; cx++)
			for (int cz = v.z0 >> 4; cz <= (v.z0 + v.sz - 1) >> 4; cz++)
				if (!level.areEntitiesActuallyLoadedAndTicking(new ChunkPos(cx, cz))) return false;
		return true;
	}

	/** Pulls a lever or presses a button the way a player would. */
	private void flip(BlockPos pos) {
		BlockState s = level.getBlockState(pos);
		if (s.getBlock() instanceof LeverBlock lever) lever.pull(s, level, pos, null);
		else if (s.getBlock() instanceof ButtonBlock button && !s.getValue(ButtonBlock.POWERED)) button.press(s, level, pos, null);
	}

	/** Tops up the fed containers' slots that are empty or hold the item. Furnaces aren't fed, since their slots each have a job. */
	private void feed() {
		feed.forEach((pos, item) -> {
			if (!(level.getBlockEntity(pos) instanceof Container c) || c instanceof AbstractFurnaceBlockEntity) return;
			for (int i = 0; i < c.getContainerSize(); i++) {
				ItemStack s = c.getItem(i);
				if (s.isEmpty() || s.is(item) && s.getCount() < s.getMaxStackSize()) c.setItem(i, new ItemStack(item, item.getDefaultMaxStackSize()));
			}
		});
	}

	private List<BlockEntity> blockEntities() {
		List<BlockEntity> out = new ArrayList<>();
		for (int cx = v.x0 >> 4; cx <= (v.x0 + v.sx - 1) >> 4; cx++)
			for (int cz = v.z0 >> 4; cz <= (v.z0 + v.sz - 1) >> 4; cz++)
				for (BlockEntity be : level.getChunk(cx, cz).getBlockEntities().values()) if (inside(be.getBlockPos())) out.add(be);
		return out;
	}

	/** Every item in the build's chests, hoppers, barrels, furnaces and other containers, apart from the fed ones. */
	private Map<Item, Integer> count() {
		Map<Item, Integer> n = new HashMap<>();
		for (BlockEntity be : blockEntities())
			if (be instanceof Container c && !feed.containsKey(be.getBlockPos())) for (ItemStack s : c) if (!s.isEmpty()) n.merge(s.getItem(), s.getCount(), Integer::sum);
		return n;
	}

	/** How much the build's furnaces, smokers and blast furnaces smelted, and could at most: each counts what it smelts to pay out its experience later. */
	private @Nullable JsonObject smelting() {
		int furnaces = 0;
		long smelted = 0;
		double top = 0;
		for (BlockEntity be : blockEntities()) {
			if (!(be instanceof AbstractFurnaceBlockEntity f)) continue;
			furnaces++;
			CompoundTag tag = f.saveCustomOnly(level.registryAccess());
			CompoundTag used = tag.getCompoundOrEmpty("RecipesUsed");
			for (String k : used.keySet()) smelted += used.getIntOr(k, 0);
			// The time per item depends on the recipe and on the block's speed with its fuel; until one is in, a furnace's 10 seconds.
			int time = tag.getIntOr("cooking_total_time", 0);
			top += 72000.0 / (time > 0 ? time : 200);
		}
		if (furnaces == 0) return null;
		JsonObject o = new JsonObject();
		o.addProperty("furnaces", furnaces);
		o.addProperty("smelted", smelted);
		o.addProperty("top", Math.round(top));
		return o;
	}

	private boolean inside(BlockPos p) {
		return p.getX() >= v.x0 && p.getY() >= v.y0 && p.getZ() >= v.z0 && p.getX() < v.x0 + v.sx && p.getY() < v.y0 + v.sy && p.getZ() < v.z0 + v.sz;
	}

	private void publish() {
		long now = System.nanoTime();
		boolean live = state.equals("clearing") || state.equals("baseline") || state.equals("pasting") || state.equals("loading") || state.equals("running");
		if (live && now - publishedAt < 500_000_000L) return;
		publishedAt = now;
		JsonObject o = new JsonObject();
		o.addProperty("id", id);
		o.addProperty("state", state);
		o.addProperty("progress", (double) pasted / v.blocks.length);
		o.addProperty("ticks", ticks);
		o.addProperty("target", target);
		o.addProperty("seconds", before == null ? 0 : (now - runningSince) / 1e9);
		if (baselineTicks > 1) o.addProperty("msBase", baselineNanos / 1e6 / (Math.min(baselineTicks, BASELINE_TICKS + 1) - 1));
		if (ticks > 0) o.addProperty("msTick", runNanos / 1e6 / ticks);
		o.addProperty("mobs", level.getEntities((Entity) null, new AABB(v.x0, v.y0, v.z0, v.x0 + v.sx, v.y0 + v.sy, v.z0 + v.sz).inflate(128), e -> e instanceof Mob).size());
		JsonArray items = new JsonArray();
		if (before != null) {
			Map<Item, Integer> gained = count();
			before.forEach((item, n) -> gained.merge(item, -n, Integer::sum));
			Set<Item> fed = new HashSet<>(feed.values()); // on their way to where they're used
			gained.entrySet().stream().filter(e -> e.getValue() != 0 && !fed.contains(e.getKey()))
				.sorted(Comparator.comparingInt((Map.Entry<Item, Integer> e) -> -Math.abs(e.getValue())))
				.forEach(e -> {
					JsonArray item = new JsonArray();
					item.add(BuiltInRegistries.ITEM.getKey(e.getKey()).toString());
					item.add(e.getKey().getDefaultInstance().getHoverName().getString());
					item.add(e.getValue());
					items.add(item);
				});
		}
		o.add("items", items);
		JsonArray fed = new JsonArray();
		for (Item item : new LinkedHashSet<>(feed.values())) fed.add(item.getDefaultInstance().getHoverName().getString());
		o.add("fed", fed);
		o.addProperty("afk", afk != null);
		if (before != null) o.add("smelting", smelting());
		status = o.toString();
		LitWeb.LOG.info("LITWEB-FARM {}", status);
	}

	private void finish(String end, @Nullable String error) {
		if (state.equals("running") && server.tickRateManager().isSprinting()) server.tickRateManager().stopSprinting();
		state = end;
		publish();
		if (error != null) {
			JsonObject o = JsonParser.parseString(status).getAsJsonObject();
			o.addProperty("error", error);
			status = o.toString();
			LitWeb.LOG.info("LITWEB-FARM {}", status);
		}
		current = null;
		if (stand != null) level.removePlayerImmediately(stand, Entity.RemovalReason.DISCARDED);
		forceChunks(false);
		JsonObject last = new JsonObject();
		last.addProperty("dimension", level.dimension().identifier().toString());
		JsonArray box = new JsonArray();
		for (int n : new int[] {v.x0, v.y0, v.z0, v.x0 + v.sx - 1, v.y0 + v.sy - 1, v.z0 + v.sz - 1}) box.add(n);
		last.add("box", box);
		try {
			Files.createDirectories(LAST.getParent());
			Files.writeString(LAST, last.toString());
		} catch (IOException e) {
			LitWeb.LOG.warn("Could not save where the farm test was", e);
		}
	}

	/**
	 * Stands at the AFK spot, so mobs spawn and despawn around it as around a player. It's in creative, so mobs leave it
	 * alone, and it never ticks. It isn't in the server's player list, so nobody sees it and nothing saves it.
	 */
	private static final class StandIn extends ServerPlayer {
		StandIn(MinecraftServer server, ServerLevel level, Vec3 at) {
			super(server, level, STAND_IN, ClientInformation.createDefault());
			GameType.CREATIVE.updatePlayerAbilities(getAbilities()); // so explosions and mobs can't hurt it
			snapTo(at.x, at.y, at.z, 0, 0);
			new ServerGamePacketListenerImpl(server, new Unplugged(), this, CommonListenerCookie.createInitial(STAND_IN, false));
		}

		@Override
		public void tick() {}

		/** Creative without switching to it, which would announce the stand-in to everyone. */
		@Override
		public GameType gameMode() {
			return GameType.CREATIVE;
		}
	}

	/** The stand-in's connection: what the game sends it goes nowhere instead of piling up. */
	private static final class Unplugged extends Connection {
		Unplugged() {
			super(PacketFlow.SERVERBOUND);
		}

		@Override
		public void send(Packet<?> packet, @Nullable ChannelFutureListener listener, boolean flush) {}
	}
}
//?}
