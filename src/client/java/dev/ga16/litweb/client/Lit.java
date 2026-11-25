package dev.ga16.litweb.client;

import dev.ga16.litweb.Volume;
import fi.dy.masa.litematica.data.DataManager;
import fi.dy.masa.litematica.schematic.LitematicaSchematic;
import fi.dy.masa.litematica.schematic.container.LitematicaBlockStateContainer;
import fi.dy.masa.litematica.schematic.placement.SchematicPlacement;
import fi.dy.masa.litematica.schematic.placement.SubRegionPlacement;
import fi.dy.masa.litematica.selection.AreaSelection;
import fi.dy.masa.litematica.selection.Box;
import fi.dy.masa.litematica.util.PositionUtils;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.List;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Vec3i;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.Mirror;
import net.minecraft.world.level.block.Rotation;
import net.minecraft.world.level.block.state.BlockState;
import org.jspecify.annotations.Nullable;

/** Everything that touches Litematica. Call on the client thread. */
final class Lit {
	record Selection(String name, List<int[]> boxes) {}

	static @Nullable Selection selection() {
		AreaSelection sel = DataManager.getSelectionManager().getCurrentSelection();
		if (sel == null) return null;
		List<int[]> boxes = boxes(sel.getAllSubRegionBoxes());
		// Litematica's untouched simple-mode selection is one block at 0,0,0; treat it as "nothing selected".
		if (boxes.size() == 1 && Arrays.equals(boxes.get(0), new int[6])) return null;
		return new Selection(sel.getName(), boxes);
	}

	static List<SchematicPlacement> placements() {
		return DataManager.getSchematicPlacementManager().getAllSchematicsPlacements();
	}

	static @Nullable SchematicPlacement placement(String hashId) {
		for (SchematicPlacement p : placements()) if (p.getHashId().toString().equals(hashId)) return p;
		return null;
	}

	static List<int[]> boxes(SchematicPlacement p) {
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

	/** The placement's blocks in world coordinates; mirrors SchematicPlacingUtils.placeBlocksWithinChunk. */
	static Volume volume(SchematicPlacement sp) {
		Volume v = Volume.ofBoxes(boxes(sp));
		LitematicaSchematic schematic = sp.getSchematic();
		BlockPos origin = sp.getOrigin();
		BlockPos.MutableBlockPos rel = new BlockPos.MutableBlockPos();
		for (SubRegionPlacement placement : sp.getAllSubRegionsPlacements()) {
			String name = placement.getName();
			LitematicaBlockStateContainer container = schematic.getSubRegionContainer(name);
			Vec3i regionSize = schematic.getAreaSizeAsVec3i(name);
			if (!placement.isEnabled() || container == null || regionSize == null) continue;

			BlockPos regionPos = placement.getPos();
			BlockPos posEndRel = PositionUtils.getRelativeEndPositionFromAreaSize(regionSize).offset(regionPos);
			BlockPos posMinRel = PositionUtils.getMinCorner(regionPos, posEndRel);
			BlockPos regionOffset = PositionUtils.getTransformedBlockPos(regionPos, sp.getMirror(), sp.getRotation()).offset(origin);
			Rotation rotation = sp.getRotation().getRotated(placement.getRotation());
			Mirror mirrorMain = sp.getMirror();
			Mirror mirrorSub = placement.getMirror();
			if (mirrorSub != Mirror.NONE && (sp.getRotation() == Rotation.CLOCKWISE_90 || sp.getRotation() == Rotation.COUNTERCLOCKWISE_90)) {
				mirrorSub = mirrorSub == Mirror.FRONT_BACK ? Mirror.LEFT_RIGHT : Mirror.FRONT_BACK;
			}
			int ox = posMinRel.getX() - regionPos.getX(), oy = posMinRel.getY() - regionPos.getY(), oz = posMinRel.getZ() - regionPos.getZ();
			Vec3i size = container.getSize();
			for (int y = 0; y < size.getY(); y++)
				for (int z = 0; z < size.getZ(); z++)
					for (int x = 0; x < size.getX(); x++) {
						BlockState state = container.get(x, y, z);
						if (state.isAir() || state.is(Blocks.STRUCTURE_VOID)) continue;
						BlockPos pos = PositionUtils.getTransformedPlacementPosition(rel.set(ox + x, oy + y, oz + z), sp, placement).offset(regionOffset);
						if (mirrorMain != Mirror.NONE) state = state.mirror(mirrorMain);
						if (mirrorSub != Mirror.NONE) state = state.mirror(mirrorSub);
						if (rotation != Rotation.NONE) state = state.rotate(rotation);
						int lx = pos.getX() - v.x0, ly = pos.getY() - v.y0, lz = pos.getZ() - v.z0;
						if (lx >= 0 && ly >= 0 && lz >= 0 && lx < v.sx && ly < v.sy && lz < v.sz) v.blocks[v.at(lx, ly, lz)] = v.idOf(state);
					}
		}
		return v;
	}

	private Lit() {}
}
