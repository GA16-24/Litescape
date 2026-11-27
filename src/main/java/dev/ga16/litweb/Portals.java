package dev.ga16.litweb;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import dev.ga16.litweb.LitWeb.Shared;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.Identifier;
import net.minecraft.resources.ResourceKey;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.ai.village.poi.PoiManager;
import net.minecraft.world.entity.ai.village.poi.PoiRecord;
import net.minecraft.world.entity.ai.village.poi.PoiTypes;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.BlockStateProperties;
import net.minecraft.world.level.border.WorldBorder;
import net.minecraft.world.level.chunk.LevelChunk;
import net.minecraft.world.level.dimension.DimensionType;
import net.minecraft.world.level.levelgen.Heightmap;
import org.jspecify.annotations.Nullable;

/**
 * Where the Nether and End portals in shared schematics send the items and mobs that go through them, worked out
 * the way the game does it: NetherPortalBlock and PortalForcer.findClosestPortalPosition for Nether portals,
 * EndPortalBlock for End portals. The other side's portals come from the game's portal index, which it keeps on disk,
 * plus the portals the connected parts plan to build. The game's own search would load every chunk in range first,
 * so this repeats its rule over the index instead and never loads a chunk.
 */
final class Portals {
	/** More portal blocks than this in one schematic and the rest are left out. */
	private static final int MAX_BLOCKS = 4096;

	/** Portal blocks of one kind that touch: one portal, in one part. */
	private record Portal(Shared part, boolean end, List<BlockPos> blocks) {}

	private Portals() {}

	/** One entry per portal in the parts, in part order. Server thread. */
	static JsonArray check(MinecraftServer server, List<Shared> parts, Map<String, Volume> volumes) {
		Map<String, List<Portal>> portals = new HashMap<>(); // each part scanned once: a schematic can hold millions of blocks
		for (Shared p : parts) portals.put(p.id, find(p, volumes.get(p.id)));
		JsonArray out = new JsonArray();
		for (Shared p : parts) {
			ServerLevel from = level(server, p.dim);
			if (from == null) continue;
			for (Portal portal : portals.get(p.id)) out.add(portal.end ? end(server, from, portal, parts) : nether(server, from, portal, parts, portals));
		}
		return out;
	}

	private static JsonObject nether(MinecraftServer server, ServerLevel from, Portal portal, List<Shared> parts, Map<String, List<Portal>> portals) {
		ResourceKey<Level> toKey = from.dimension() == Level.NETHER ? Level.OVERWORLD : Level.NETHER;
		JsonObject o = base(portal, toKey);
		ServerLevel to = server.getLevel(toKey);
		if (to == null) return o;
		boolean toNether = toKey == Level.NETHER;
		int radius = toNether ? 16 : 128;
		double scale = DimensionType.getTeleportationScale(from.dimensionType(), to.dimensionType());
		WorldBorder border = to.getWorldBorder();
		List<BlockPos> exits = new ArrayList<>();
		for (BlockPos b : portal.blocks) exits.add(border.clampToBounds((b.getX() + 0.5) * scale, b.getY(), (b.getZ() + 0.5) * scale));

		// Every portal any exit could reach: the game's index around them all, and the portals the parts plan there.
		int x0 = Integer.MAX_VALUE, z0 = Integer.MAX_VALUE, x1 = Integer.MIN_VALUE, z1 = Integer.MIN_VALUE;
		for (BlockPos e : exits) {
			x0 = Math.min(x0, e.getX()); z0 = Math.min(z0, e.getZ());
			x1 = Math.max(x1, e.getX()); z1 = Math.max(z1, e.getZ());
		}
		BlockPos mid = new BlockPos((x0 + x1) >> 1, 0, (z0 + z1) >> 1);
		Set<BlockPos> planned = new LinkedHashSet<>();
		for (Shared q : parts)
			if (q.dim.equals(name(toKey)))
				for (Portal p : portals.get(q.id)) if (!p.end) planned.addAll(p.blocks);
		Set<BlockPos> built = new LinkedHashSet<>();
		to.getPoiManager().getInSquare(t -> t.is(PoiTypes.NETHER_PORTAL), mid, radius + Math.max(x1 - x0, z1 - z0) / 2 + 1, PoiManager.Occupancy.ANY)
			.map(PoiRecord::getPos).filter(p -> stillPortal(to, p)).forEach(built::add);
		Set<BlockPos> candidates = new LinkedHashSet<>(built);
		candidates.addAll(planned);

		// The game's pick for each block of the portal: inside the square, inside the border, nearest, then lowest.
		Map<BlockPos, Integer> landed = new HashMap<>();
		int nowhere = 0;
		for (BlockPos e : exits) {
			BlockPos best = candidates.stream()
				.filter(c -> Math.abs(c.getX() - e.getX()) <= radius && Math.abs(c.getZ() - e.getZ()) <= radius && border.isWithinBounds(c))
				.min(Comparator.<BlockPos>comparingDouble(c -> c.distSqr(e)).thenComparingInt(BlockPos::getY)).orElse(null);
			if (best == null) nowhere++;
			else landed.merge(best, 1, Integer::sum);
		}
		var top = landed.entrySet().stream().max(Map.Entry.comparingByValue()).orElse(null);
		if (top == null || nowhere > top.getValue()) {
			o.addProperty("lands", "new"); // the game builds a portal of its own near the exit
			o.add("at", ints(exits.get(0)));
			o.addProperty("others", portal.blocks.size() - nowhere);
		} else {
			o.addProperty("lands", "portal");
			o.add("at", ints(top.getKey()));
			String in = partAt(parts, toKey, top.getKey(), false);
			if (in != null) o.addProperty("in", in);
			o.addProperty("built", built.contains(top.getKey())); // false: a part's portal that isn't in the world yet
			o.addProperty("others", portal.blocks.size() - top.getValue());
		}
		return o;
	}

	/** Into the End: the obsidian platform. Out of the End: the world spawn, on top of the highest block. */
	private static JsonObject end(MinecraftServer server, ServerLevel from, Portal portal, List<Shared> parts) {
		if (from.dimension() != Level.END) {
			JsonObject o = base(portal, Level.END);
			o.addProperty("lands", "platform");
			o.add("at", ints(ServerLevel.END_SPAWN_POINT));
			String in = partAt(parts, Level.END, ServerLevel.END_SPAWN_POINT, false);
			if (in != null) o.addProperty("in", in);
			return o;
		}
		//? if >=1.21.9 {
		var spawn = server.getRespawnData();
		ResourceKey<Level> toKey = spawn.dimension() == Level.END ? Level.OVERWORLD : spawn.dimension();
		BlockPos at = spawn.pos();
		//?} else {
		/*ResourceKey<Level> toKey = Level.OVERWORLD;
		BlockPos at = server.overworld().getSharedSpawnPos();
		*///?}
		JsonObject o = base(portal, toKey);
		o.addProperty("lands", "spawn");
		ServerLevel to = server.getLevel(toKey);
		LevelChunk chunk = to == null ? null : to.getChunkSource().getChunkNow(at.getX() >> 4, at.getZ() >> 4);
		// The height only shows when the spawn chunk is loaded; it is the top of the highest block either way.
		int y = chunk == null ? Integer.MIN_VALUE : chunk.getHeight(Heightmap.Types.MOTION_BLOCKING_NO_LEAVES, at.getX() & 15, at.getZ() & 15) + 1;
		JsonArray pos = ints(at);
		if (y == Integer.MIN_VALUE) pos.set(1, com.google.gson.JsonNull.INSTANCE);
		else pos.set(1, new com.google.gson.JsonPrimitive(y));
		o.add("at", pos);
		String in = partAt(parts, toKey, at, true);
		if (in != null) o.addProperty("in", in);
		return o;
	}

	private static JsonObject base(Portal portal, ResourceKey<Level> to) {
		JsonObject o = new JsonObject();
		o.addProperty("part", portal.part.id);
		o.addProperty("kind", portal.end ? "end" : "nether");
		o.add("from", ints(portal.blocks.get(0)));
		o.addProperty("blocks", portal.blocks.size());
		o.addProperty("to", name(to));
		return o;
	}

	/** A position from the index is a portal unless its chunk is loaded and shows something else (index not caught up). */
	private static boolean stillPortal(ServerLevel level, BlockPos p) {
		LevelChunk c = level.getChunkSource().getChunkNow(p.getX() >> 4, p.getZ() >> 4);
		return c == null || c.getBlockState(p).hasProperty(BlockStateProperties.HORIZONTAL_AXIS);
	}

	/** The id of the part in that dimension whose box holds the position; anyY for a spot whose height isn't known. */
	private static @Nullable String partAt(List<Shared> parts, ResourceKey<Level> dim, BlockPos p, boolean anyY) {
		for (Shared s : parts) {
			if (!s.dim.equals(name(dim))) continue;
			int x = p.getX() - s.origin[0], y = p.getY() - s.origin[1], z = p.getZ() - s.origin[2];
			if (x >= 0 && z >= 0 && x < s.size[0] && z < s.size[2] && (anyY || y >= 0 && y < s.size[1])) return s.id;
		}
		return null;
	}

	/** The portals in a part: Nether and End portal blocks, each touching group one portal, lowest block first. */
	private static List<Portal> find(Shared s, @Nullable Volume v) {
		List<Portal> out = new ArrayList<>();
		if (v == null) return out;
		boolean[] isPortal = new boolean[v.palette.size()], isEnd = new boolean[v.palette.size()];
		boolean any = false;
		for (int i = 0; i < isPortal.length; i++) {
			BlockState st = v.palette.get(i);
			isEnd[i] = st != null && st.is(Blocks.END_PORTAL);
			isPortal[i] = isEnd[i] || st != null && st.is(Blocks.NETHER_PORTAL);
			any |= isPortal[i];
		}
		if (!any) return out;
		boolean[] seen = new boolean[v.blocks.length];
		int total = 0;
		for (int i = 0; i < v.blocks.length && total < MAX_BLOCKS; i++) {
			if (seen[i] || !isPortal[v.blocks[i] & 0xFFFF]) continue; // palette indices are unsigned shorts
			boolean end = isEnd[v.blocks[i] & 0xFFFF];
			List<BlockPos> blocks = new ArrayList<>();
			ArrayDeque<Integer> queue = new ArrayDeque<>(List.of(i));
			seen[i] = true;
			while (!queue.isEmpty() && total < MAX_BLOCKS) {
				int j = queue.poll(), x = j % v.sx, z = (j / v.sx) % v.sz, y = j / (v.sx * v.sz);
				blocks.add(new BlockPos(v.x0 + x, v.y0 + y, v.z0 + z));
				total++;
				for (Direction d : Direction.values()) {
					int nx = x + d.getStepX(), ny = y + d.getStepY(), nz = z + d.getStepZ();
					if (nx < 0 || ny < 0 || nz < 0 || nx >= v.sx || ny >= v.sy || nz >= v.sz) continue;
					int k = v.at(nx, ny, nz);
					if (!seen[k] && isPortal[v.blocks[k] & 0xFFFF] && isEnd[v.blocks[k] & 0xFFFF] == end) {
						seen[k] = true;
						queue.add(k);
					}
				}
			}
			out.add(new Portal(s, end, blocks));
		}
		return out;
	}

	private static String name(ResourceKey<Level> dim) {
		//? if >=1.21.11 {
		return dim.identifier().toString();
		//?} else
		//return dim.location().toString();
	}

	static @Nullable ServerLevel level(MinecraftServer server, String dim) {
		return server.getLevel(ResourceKey.create(Registries.DIMENSION, Identifier.parse(dim)));
	}

	private static JsonArray ints(BlockPos p) {
		JsonArray a = new JsonArray();
		a.add(p.getX());
		a.add(p.getY());
		a.add(p.getZ());
		return a;
	}
}
