package dev.ga16.litweb.client;

import dev.ga16.litweb.Volume;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Supplier;
import net.fabricmc.loader.api.FabricLoader;
import org.jspecify.annotations.Nullable;

/** The selection and placements from whichever of Litematica and BuildPrint are installed. Call on the client thread. */
final class Schematics {
	record Selection(String name, List<int[]> boxes) {}

	/** version changes whenever the placement's blocks would; volume builds them in world coordinates. */
	record Placement(String id, String name, boolean enabled, String author, List<int[]> boxes, String version, Supplier<Volume> volume) {}

	static final boolean LITEMATICA = FabricLoader.getInstance().isModLoaded("litematica");
	static final boolean BUILDPRINT = FabricLoader.getInstance().isModLoaded("buildprint");

	/** Litematica's selection, else BuildPrint's. */
	static @Nullable Selection selection() {
		Selection s = LITEMATICA ? Lit.selection() : null;
		return s == null && BUILDPRINT ? Bp.selection() : s;
	}

	static List<Placement> placements() {
		List<Placement> out = new ArrayList<>();
		if (LITEMATICA) out.addAll(Lit.placements());
		if (BUILDPRINT) out.addAll(Bp.placements());
		return out;
	}

	static @Nullable Placement placement(String id) {
		for (Placement p : placements()) if (p.id().equals(id)) return p;
		return null;
	}

	private Schematics() {}
}
