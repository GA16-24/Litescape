package dev.ga16.litweb.client;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import dev.ga16.litweb.Volume;
import fi.dy.masa.litematica.data.DataManager;
import fi.dy.masa.litematica.data.SchematicHolder;
import fi.dy.masa.litematica.schematic.LitematicaSchematic;
import fi.dy.masa.litematica.schematic.container.LitematicaBlockStateContainer;
import fi.dy.masa.litematica.schematic.placement.SchematicPlacement;
import fi.dy.masa.litematica.schematic.placement.SubRegionPlacement;
import fi.dy.masa.litematica.selection.AreaSelection;
import fi.dy.masa.litematica.selection.Box;
import fi.dy.masa.litematica.util.PositionUtils;
import fi.dy.masa.malilib.util.data.tag.CompoundData;
import fi.dy.masa.malilib.util.data.tag.converter.DataConverterNbt;
import fi.dy.masa.malilib.util.data.tag.util.DataFileUtils;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.item.ItemStackRenderState;
import net.minecraft.core.BlockPos;
import net.minecraft.core.HolderLookup;
import net.minecraft.core.Vec3i;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.NbtAccounter;
import net.minecraft.nbt.NbtIo;
import net.minecraft.nbt.NbtOps;
import net.minecraft.nbt.Tag;
import net.minecraft.util.RandomSource;
import net.minecraft.world.item.ItemDisplayContext;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.Mirror;
import net.minecraft.world.level.block.Rotation;
import net.minecraft.world.level.block.state.BlockState;
import org.jspecify.annotations.Nullable;

/** Everything that touches Litematica. Call on the client thread. */
final class Lit {
	static Schematics.@Nullable Selection selection() {
		AreaSelection sel = DataManager.getSelectionManager().getCurrentSelection();
		if (sel == null) return null;
		List<int[]> boxes = boxes(sel.getAllSubRegionBoxes());
		// Litematica's untouched simple-mode selection is one block at 0,0,0; treat it as "nothing selected".
		if (boxes.size() == 1 && Arrays.equals(boxes.get(0), new int[6])) return null;
		return new Schematics.Selection(sel.getName(), boxes);
	}

	static List<Schematics.Placement> placements() {
		List<Schematics.Placement> out = new ArrayList<>();
		for (SchematicPlacement p : DataManager.getSchematicPlacementManager().getAllSchematicsPlacements()) {
			List<int[]> boxes = boxes(p);
			String version = boxes.stream().map(Arrays::toString).toList() + "" + p.getRotation() + p.getMirror() + p.getSchematic().hashCode();
			BlockPos o = p.getOrigin();
			out.add(new Schematics.Placement(p.getHashId().toString(), p.getName(), p.isEnabled(), author(p), boxes, version, () -> volume(p),
				new int[] {o.getX(), o.getY(), o.getZ()}, sharedIdOf(p)));
		}
		return out;
	}

	private static @Nullable SchematicPlacement find(String id) {
		for (SchematicPlacement p : DataManager.getSchematicPlacementManager().getAllSchematicsPlacements()) {
			if (p.getHashId().toString().equals(id)) return p;
		}
		return null;
	}

	/** What the placement's chests and hoppers hold, or null when it isn't a Litematica placement. */
	static @Nullable JsonObject contents(String id, HolderLookup.Provider registries) {
		SchematicPlacement p = find(id);
		return p == null ? null : contents(p, registries);
	}

	/** Moves the placement's origin; returns why it couldn't, or null once it's there. */
	static @Nullable String move(String id, BlockPos to) {
		SchematicPlacement p = find(id);
		if (p == null) return "Only Litematica placements can be moved here";
		if (to.equals(p.getOrigin())) return null;
		if (p.isLocked()) return "The placement is locked in Litematica. Unlock it to move it."; // setOrigin would refuse silently
		p.setOrigin(to, msg -> {});
		return null;
	}

	/** The placement with its schematic, block entities included, as compressed NBT; null when it isn't a Litematica placement. */
	static byte @Nullable [] placementBlob(String id) throws IOException {
		SchematicPlacement p = find(id);
		return p == null ? null : placementBlob(p);
	}

	private static List<int[]> boxes(SchematicPlacement p) {
		return boxes(p.getSubRegionBoxes(SubRegionPlacement.RequiredEnabled.PLACEMENT_ENABLED).values());
	}

	private static List<int[]> boxes(Collection<Box> in) {
		List<int[]> out = new ArrayList<>();
		for (Box b : in) {
			BlockPos a = b.getPos1(), c = b.getPos2();
			if (a != null && c != null) out.add(new int[] {a.getX(), a.getY(), a.getZ(), c.getX(), c.getY(), c.getZ()});
		}
		return out;
	}

	/** One enabled sub-region and how its schematic-relative positions map to the world; mirrors SchematicPlacingUtils.placeBlocksWithinChunk. */
	private record Region(String name, SubRegionPlacement placement, LitematicaBlockStateContainer container, BlockPos offset, BlockPos minRel,
		Rotation rotation, Mirror mirrorMain, Mirror mirrorSub) {
		BlockPos world(SchematicPlacement sp, BlockPos.MutableBlockPos rel, int x, int y, int z) {
			return PositionUtils.getTransformedPlacementPosition(rel.set(minRel.getX() + x, minRel.getY() + y, minRel.getZ() + z), sp, placement).offset(offset);
		}

		BlockState state(BlockState state) {
			if (mirrorMain != Mirror.NONE) state = state.mirror(mirrorMain);
			if (mirrorSub != Mirror.NONE) state = state.mirror(mirrorSub);
			return rotation == Rotation.NONE ? state : state.rotate(rotation);
		}
	}

	private static List<Region> regions(SchematicPlacement sp) {
		List<Region> out = new ArrayList<>();
		LitematicaSchematic schematic = sp.getSchematic();
		for (SubRegionPlacement placement : sp.getAllSubRegionsPlacements()) {
			String name = placement.getName();
			LitematicaBlockStateContainer container = schematic.getSubRegionContainer(name);
			Vec3i regionSize = schematic.getAreaSizeAsVec3i(name);
			if (!placement.isEnabled() || container == null || regionSize == null) continue;

			BlockPos regionPos = placement.getPos();
			BlockPos posEndRel = PositionUtils.getRelativeEndPositionFromAreaSize(regionSize).offset(regionPos);
			BlockPos posMinRel = PositionUtils.getMinCorner(regionPos, posEndRel);
			BlockPos regionOffset = PositionUtils.getTransformedBlockPos(regionPos, sp.getMirror(), sp.getRotation()).offset(sp.getOrigin());
			Mirror mirrorSub = placement.getMirror();
			if (mirrorSub != Mirror.NONE && (sp.getRotation() == Rotation.CLOCKWISE_90 || sp.getRotation() == Rotation.COUNTERCLOCKWISE_90)) {
				mirrorSub = mirrorSub == Mirror.FRONT_BACK ? Mirror.LEFT_RIGHT : Mirror.FRONT_BACK;
			}
			out.add(new Region(name, placement, container, regionOffset, posMinRel.subtract(regionPos),
				sp.getRotation().getRotated(placement.getRotation()), sp.getMirror(), mirrorSub));
		}
		return out;
	}

	/** The placement's blocks in world coordinates. */
	private static Volume volume(SchematicPlacement sp) {
		Volume v = Volume.ofBoxes(boxes(sp));
		BlockPos.MutableBlockPos rel = new BlockPos.MutableBlockPos();
		for (Region r : regions(sp)) {
			Vec3i size = r.container.getSize();
			for (int y = 0; y < size.getY(); y++)
				for (int z = 0; z < size.getZ(); z++)
					for (int x = 0; x < size.getX(); x++) {
						BlockState state = r.container.get(x, y, z);
						if (state.isAir() || state.is(Blocks.STRUCTURE_VOID)) continue;
						BlockPos pos = r.world(sp, rel, x, y, z);
						int lx = pos.getX() - v.x0, ly = pos.getY() - v.y0, lz = pos.getZ() - v.z0;
						if (lx >= 0 && ly >= 0 && lz >= 0 && lx < v.sx && ly < v.sy && lz < v.sz) v.blocks[v.at(lx, ly, lz)] = v.idOf(r.state(state));
					}
		}
		return v;
	}

	/** Container contents by world position "x,y,z": [[slot, count, item name, icon sprite], ...] in slot order. */
	private static JsonObject contents(SchematicPlacement sp, HolderLookup.Provider registries) {
		JsonObject out = new JsonObject();
		var ops = registries.createSerializationContext(NbtOps.INSTANCE);
		BlockPos.MutableBlockPos rel = new BlockPos.MutableBlockPos();
		for (Region r : regions(sp)) {
			var entities = sp.getSchematic().getBlockEntityMapForRegion(r.name);
			if (entities == null) continue;
			for (var e : entities.entrySet()) {
				JsonArray items = new JsonArray();
				for (Tag t : DataConverterNbt.toVanillaCompound(e.getValue()).getListOrEmpty("Items")) {
					if (!(t instanceof CompoundTag tag)) continue;
					ItemStack stack = ItemStack.CODEC.parse(ops, tag).result().orElse(ItemStack.EMPTY);
					if (stack.isEmpty()) continue;
					JsonArray item = new JsonArray();
					item.add(tag.getByteOr("Slot", (byte) 0));
					item.add(stack.getCount());
					item.add(stack.getHoverName().getString());
					item.add(icon(stack));
					items.add(item);
				}
				if (items.isEmpty()) continue;
				BlockPos pos = r.world(sp, rel, e.getKey().getX(), e.getKey().getY(), e.getKey().getZ());
				out.add(pos.getX() + "," + pos.getY() + "," + pos.getZ(), items);
			}
		}
		return out;
	}

	/**
	 * The sprite the item's GUI model draws, such as "minecraft:item/redstone", for /tex/; "" when it has none.
	 * shortcut: block items get their particle texture and tinted items (potions, dyed armor) lose the tint; render real GUI icons if that bothers anyone.
	 */
	private static String icon(ItemStack stack) {
		Minecraft mc = Minecraft.getInstance();
		ItemStackRenderState state = new ItemStackRenderState();
		mc.getItemModelResolver().updateForTopItem(state, stack, ItemDisplayContext.GUI, mc.level, null, 0);
		var material = state.pickParticleMaterial(RandomSource.create(0));
		return material == null ? "" : material.sprite().contents().name().toString();
	}

	// ---- shared placements: the placement with its schematic (block entities included), as compressed NBT ----

	/** Shared schematics loaded into Litematica live here as <shared id>.litematic, so they survive a restart like any other. */
	private static Path sharedDir() {
		return DataManager.getSchematicsBaseDirectory().resolve("litescape");
	}

	private static byte[] placementBlob(SchematicPlacement sp) throws IOException {
		ByteArrayOutputStream out = new ByteArrayOutputStream();
		NbtIo.writeCompressed(DataConverterNbt.toVanillaCompound(sp.toData(true)), out);
		return out.toByteArray();
	}

	/**
	 * Another player's upload, so nothing in it is trusted: the NBT is size-bounded, and region sizes are checked
	 * before Litematica allocates a block array for each.
	 */
	private static CompoundData readBlob(byte[] blob) throws IOException {
		CompoundTag tag = NbtIo.readCompressed(new ByteArrayInputStream(blob), NbtAccounter.create(256L << 20));
		CompoundTag regions = tag.getCompoundOrEmpty("Schematics").getCompoundOrEmpty("Regions");
		long total = 0;
		for (String name : regions.keySet()) {
			CompoundTag size = regions.getCompoundOrEmpty(name).getCompoundOrEmpty("Size");
			total += Math.abs((long) size.getIntOr("x", 0) * size.getIntOr("y", 0) * size.getIntOr("z", 0));
			if (total > Volume.MAX_VOLUME) throw new IOException("Couldn't read the shared placement");
		}
		return DataConverterNbt.fromVanillaCompound(tag);
	}

	/** A placement that isn't added to Litematica, for reading what's in it. */
	private static SchematicPlacement readPlacement(byte[] blob) throws IOException {
		SchematicPlacement p = SchematicPlacement.createFromData(readBlob(blob));
		if (p == null) throw new IOException("Couldn't read the shared placement");
		return p;
	}

	/** Saves the shared schematic to the schematics folder and adds its placement, replacing an earlier load of it. */
	static void loadShared(String sharedId, byte[] blob) throws IOException {
		if (!isId(sharedId)) throw new IOException("That schematic is no longer shared");
		CompoundData data = readBlob(blob);
		Path dir = sharedDir();
		Files.createDirectories(dir);
		Path file = dir.resolve(sharedId + LitematicaSchematic.FILE_EXTENSION);
		unloadShared(sharedId);
		if (!DataFileUtils.writeCompoundDataToCompressedNbtFile(file, data.getCompound("Schematics"))) throw new IOException("Couldn't save the schematic");
		LitematicaSchematic schematic = LitematicaSchematic.createFromFile(dir, file.getFileName().toString());
		SchematicPlacement p = schematic == null ? null : SchematicPlacement.createFromData(schematic, data);
		if (p == null) throw new IOException("Couldn't read the shared placement");
		SchematicHolder.getInstance().addSchematic(schematic, false);
		DataManager.getSchematicPlacementManager().addSchematicPlacement(p, false);
	}

	/** Shared ids are UUIDs; anything else would be a path outside the shared folder. */
	private static boolean isId(String id) {
		try {
			return UUID.fromString(id).toString().equals(id);
		} catch (IllegalArgumentException e) {
			return false;
		}
	}

	/** Container contents of a shared placement downloaded from the server. */
	static JsonObject sharedContents(byte[] blob, HolderLookup.Provider registries) throws IOException {
		return contents(readPlacement(blob), registries);
	}

	static void unloadShared(String sharedId) {
		for (SchematicPlacement p : DataManager.getSchematicPlacementManager().getAllSchematicsPlacements()) {
			if (!sharedId.equals(sharedIdOf(p))) continue;
			DataManager.getSchematicPlacementManager().removeSchematicPlacement(p);
			SchematicHolder.getInstance().removeSchematic(p.getSchematic());
		}
	}

	/** The shared schematic this placement was loaded from, or null for the player's own placements. */
	private static @Nullable String sharedIdOf(SchematicPlacement p) {
		Path f = p.getSchematicFile();
		if (f == null || !sharedDir().toAbsolutePath().normalize().equals(f.toAbsolutePath().normalize().getParent())) return null;
		String name = f.getFileName().toString();
		return name.endsWith(LitematicaSchematic.FILE_EXTENSION) ? name.substring(0, name.length() - LitematicaSchematic.FILE_EXTENSION.length()) : null;
	}

	private Lit() {}

	/** The author saved in the schematic file, or "" when it has none. */
	private static String author(SchematicPlacement p) {
		String a = p.getSchematic().getMetadata().getAuthor();
		return a == null || a.isBlank() || a.equals("?") ? "" : a.strip();
	}
}
