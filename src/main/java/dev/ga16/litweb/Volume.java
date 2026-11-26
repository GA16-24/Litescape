package dev.ga16.litweb;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.zip.DeflaterOutputStream;
import java.util.zip.InflaterInputStream;
import net.minecraft.commands.arguments.blocks.BlockStateParser;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;
import org.jspecify.annotations.Nullable;

/**
 * A box of blocks: palette + one short per voxel, index = (y * sz + z) * sx + x.
 * Palette entry 0 is always air; a null entry means "unknown" (chunk not loaded).
 */
public final class Volume {
	public static final int MAX_VOLUME = 16_777_216;
	/** Per-voxel build status codes, shared with the web app. */
	public static final byte NONE = 0, OK = 1, MISSING = 2, WRONG_BLOCK = 3, WRONG_STATE = 4, UNKNOWN = 5;

	public final int x0, y0, z0, sx, sy, sz;
	public final List<@Nullable BlockState> palette = new ArrayList<>();
	public final short[] blocks;
	private final Map<@Nullable BlockState, Short> index = new HashMap<>();

	public Volume(int x0, int y0, int z0, int sx, int sy, int sz) {
		if (sx <= 0 || sy <= 0 || sz <= 0 || (long) sx * sy * sz > MAX_VOLUME) {
			throw new IllegalArgumentException("Area is " + sx + "×" + sy + "×" + sz + "; the limit is " + MAX_VOLUME + " blocks");
		}
		this.x0 = x0; this.y0 = y0; this.z0 = z0; this.sx = sx; this.sy = sy; this.sz = sz;
		this.blocks = new short[sx * sy * sz];
		idOf(Blocks.AIR.defaultBlockState());
	}

	public static Volume ofBoxes(List<int[]> boxes) {
		int[] b = union(boxes);
		return new Volume(b[0], b[1], b[2], b[3] - b[0] + 1, b[4] - b[1] + 1, b[5] - b[2] + 1);
	}

	/** Boxes are {x0,y0,z0,x1,y1,z1} with any corner order; returns the normalized union. */
	public static int[] union(List<int[]> boxes) {
		int[] u = {Integer.MAX_VALUE, Integer.MAX_VALUE, Integer.MAX_VALUE, Integer.MIN_VALUE, Integer.MIN_VALUE, Integer.MIN_VALUE};
		for (int[] b : boxes) {
			for (int i = 0; i < 3; i++) {
				u[i] = Math.min(u[i], Math.min(b[i], b[i + 3]));
				u[i + 3] = Math.max(u[i + 3], Math.max(b[i], b[i + 3]));
			}
		}
		if (boxes.isEmpty()) throw new IllegalArgumentException("Selection has no complete boxes");
		return u;
	}

	public short idOf(@Nullable BlockState state) {
		return index.computeIfAbsent(state, s -> {
			palette.add(s);
			return (short) (palette.size() - 1);
		});
	}

	public int at(int x, int y, int z) {
		return (y * sz + z) * sx + x;
	}

	public void set(BlockPos pos, @Nullable BlockState state) {
		blocks[at(pos.getX() - x0, pos.getY() - y0, pos.getZ() - z0)] = idOf(state);
	}

	/** Fills every voxel inside the boxes from the reader (null = unknown). */
	public void fill(List<int[]> boxes, Function<BlockPos, @Nullable BlockState> reader) {
		BlockPos.MutableBlockPos pos = new BlockPos.MutableBlockPos();
		for (int[] b : boxes) {
			for (int y = Math.min(b[1], b[4]); y <= Math.max(b[1], b[4]); y++)
				for (int z = Math.min(b[2], b[5]); z <= Math.max(b[2], b[5]); z++)
					for (int x = Math.min(b[0], b[3]); x <= Math.max(b[0], b[3]); x++)
						set(pos.set(x, y, z), reader.apply(pos));
		}
	}

	/**
	 * Compares this (a schematic) against the world. Returns one status byte per voxel;
	 * counts[code] receives the number of voxels with each status.
	 */
	public byte[] diff(Function<BlockPos, @Nullable BlockState> world, int[] counts) {
		byte[] out = new byte[blocks.length];
		BlockPos.MutableBlockPos pos = new BlockPos.MutableBlockPos();
		for (int y = 0, i = 0; y < sy; y++)
			for (int z = 0; z < sz; z++)
				for (int x = 0; x < sx; x++, i++) {
					BlockState want = palette.get(blocks[i]);
					if (want == null || want.isAir()) continue;
					BlockState have = world.apply(pos.set(x0 + x, y0 + y, z0 + z));
					byte s = have == null ? UNKNOWN
						: have == want ? OK
						: have.isAir() || have.canBeReplaced() && !have.is(want.getBlock()) ? MISSING
						: have.is(want.getBlock()) ? WRONG_STATE : WRONG_BLOCK;
					out[i] = s;
					counts[s]++;
				}
		return out;
	}

	/**
	 * This schematic set into the terrain captured around it. The palette holds the schematic's states first and
	 * the terrain's from index schematic.palette.size() on, duplicates and all, so the viewer can tell them apart.
	 * Returns null when the terrain doesn't contain the schematic or the palettes don't fit together.
	 */
	public static @Nullable Volume around(Volume s, Volume t) {
		int dx = s.x0 - t.x0, dy = s.y0 - t.y0, dz = s.z0 - t.z0, off = s.palette.size();
		if (dx < 0 || dy < 0 || dz < 0 || dx + s.sx > t.sx || dy + s.sy > t.sy || dz + s.sz > t.sz || off + t.palette.size() > 65535) return null;
		Volume v = new Volume(t.x0, t.y0, t.z0, t.sx, t.sy, t.sz);
		v.palette.clear(); // idOf() would dedupe across the two halves; nothing calls it on this volume
		v.index.clear();
		v.palette.addAll(s.palette);
		v.palette.addAll(t.palette);
		for (int i = 0; i < t.blocks.length; i++) v.blocks[i] = (short) ((t.blocks[i] & 0xFFFF) + off);
		for (int y = 0, i = 0; y < s.sy; y++)
			for (int z = 0; z < s.sz; z++)
				for (int x = 0; x < s.sx; x++, i++) {
					BlockState want = s.palette.get(s.blocks[i]);
					if (want != null && !want.isAir()) v.blocks[v.at(x + dx, y + dy, z + dz)] = s.blocks[i];
				}
		return v;
	}

	public byte[] encode() {
		ByteArrayOutputStream bytes = new ByteArrayOutputStream();
		try (DataOutputStream out = new DataOutputStream(new DeflaterOutputStream(bytes))) {
			for (int v : new int[] {x0, y0, z0, sx, sy, sz}) out.writeInt(v);
			out.writeInt(palette.size());
			for (BlockState s : palette) out.writeUTF(s == null ? "?" : BlockStateParser.serialize(s));
			for (short b : blocks) out.writeShort(b);
		} catch (IOException e) {
			throw new IllegalStateException(e);
		}
		return bytes.toByteArray();
	}

	public static Volume decode(byte[] data) throws IOException {
		try (DataInputStream in = new DataInputStream(new InflaterInputStream(new ByteArrayInputStream(data)))) {
			Volume v = new Volume(in.readInt(), in.readInt(), in.readInt(), in.readInt(), in.readInt(), in.readInt());
			int n = in.readInt();
			if (n < 1 || n > 65535) throw new IOException("Bad palette size " + n);
			v.palette.clear();
			v.index.clear();
			for (int i = 0; i < n; i++) v.palette.add(parse(in.readUTF()));
			for (int i = 0; i < v.blocks.length; i++) {
				short b = in.readShort();
				if ((b & 0xFFFF) >= n) throw new IOException("Bad palette index");
				v.blocks[i] = b;
			}
			for (int i = 0; i < n; i++) v.index.putIfAbsent(v.palette.get(i), (short) i);
			return v;
		}
	}

	public static @Nullable BlockState parse(String s) {
		if (s.equals("?")) return null;
		try {
			return BlockStateParser.parseForBlock(BuiltInRegistries.BLOCK, s, false).blockState();
		} catch (Exception e) {
			return Blocks.AIR.defaultBlockState(); // block from a mod that isn't installed here
		}
	}
}
