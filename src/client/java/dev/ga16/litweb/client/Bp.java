package dev.ga16.litweb.client;

import com.buildprint.api.BuildprintPlacements;
import com.buildprint.api.BuildprintSelection;
import dev.ga16.litweb.Volume;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import net.minecraft.client.Minecraft;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;
import org.jspecify.annotations.Nullable;

/** Everything that touches BuildPrint, through its public API. Call on the client thread. */
final class Bp {
	private static final Map<Integer, String> authors = new HashMap<>();

	static Schematics.@Nullable Selection selection() {
		if (!BuildprintSelection.isAvailable()) return null;
		int[] r = BuildprintSelection.regions(); // {minX, minY, minZ, maxX, maxY, maxZ} per box
		List<int[]> boxes = new ArrayList<>();
		for (int i = 0; i + 6 <= r.length; i += 6) boxes.add(Arrays.copyOfRange(r, i, i + 6));
		return boxes.isEmpty() ? null : new Schematics.Selection("BuildPrint selection", boxes);
	}

	/** The builds loaded in the player's dimension, oldest first. */
	static List<Schematics.Placement> placements() {
		List<Schematics.Placement> out = new ArrayList<>();
		var level = Minecraft.getInstance().level;
		if (level == null || !BuildprintPlacements.isAvailable()) return out;
		String dim = level.dimension().identifier().toString();
		Map<Integer, String> keys = new LinkedHashMap<>();
		Map<String, Integer> uses = new HashMap<>();
		for (int id : BuildprintPlacements.ids()) {
			if (!dim.equals(BuildprintPlacements.dimension(id))) continue;
			// BuildPrint gives a build a new id after a restart. Name and origin survive that, and no other build can take them over.
			String key = "buildprint:" + dim + "/" + BuildprintPlacements.name(id) + "@" + Arrays.toString(BuildprintPlacements.origin(id));
			keys.put(id, key);
			uses.merge(key, 1, Integer::sum);
		}
		keys.forEach((id, key) -> {
			// The same build loaded twice in one spot: tell the copies apart by id until only one is left.
			if (uses.get(key) > 1) key += "#" + id;
			int[] box = BuildprintPlacements.bounds(id);
			out.add(new Schematics.Placement(key, BuildprintPlacements.name(id), BuildprintPlacements.visible(id), author(id), List.of(box),
				id + ":" + BuildprintPlacements.version(id), () -> volume(id, box)));
		});
		return out;
	}

	/** The author saved in the build's file, or "". */
	private static String author(int id) {
		return authors.computeIfAbsent(id, i -> {
			Map<String, Object> s = BuildprintPlacements.snapshot(i); // null for very large builds
			return s != null && s.get("author") instanceof String a ? a.strip() : "";
		});
	}

	/** expectedIn already turns and flips each state the way the build is placed. */
	private static Volume volume(int id, int[] box) {
		Volume v = Volume.ofBoxes(List.of(box));
		Map<String, @Nullable BlockState> states = new HashMap<>();
		for (int y = box[1]; y <= box[4]; y++)
			for (int z = box[2]; z <= box[5]; z++)
				for (int x = box[0]; x <= box[3]; x++) {
					String s = BuildprintPlacements.expectedIn(id, x, y, z);
					if (s == null) continue;
					BlockState state = states.computeIfAbsent(s, Volume::parse);
					if (state == null || state.isAir() || state.is(Blocks.STRUCTURE_VOID)) continue;
					v.blocks[v.at(x - v.x0, y - v.y0, z - v.z0)] = v.idOf(state);
				}
		return v;
	}

	private Bp() {}
}
