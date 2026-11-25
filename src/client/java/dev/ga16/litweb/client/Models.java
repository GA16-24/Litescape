package dev.ga16.litweb.client;

import com.google.gson.JsonArray;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import net.minecraft.client.Minecraft;
import net.minecraft.client.color.block.BlockTintSource;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.renderer.block.FluidModel;
import net.minecraft.client.renderer.block.dispatch.BlockStateModel;
import net.minecraft.client.renderer.block.dispatch.BlockStateModelPart;
import net.minecraft.client.renderer.texture.TextureAtlasSprite;
import net.minecraft.client.model.geom.builders.UVPair;
import net.minecraft.client.resources.model.geometry.BakedQuad;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.util.RandomSource;
import net.minecraft.world.level.EmptyBlockGetter;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.Property;
import net.minecraft.world.level.material.FluidState;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.shapes.VoxelShape;
import org.jspecify.annotations.Nullable;
import org.joml.Vector3fc;

/**
 * Turns palette block states into the geometry the web app meshes: the baked model quads
 * with UVs relative to each sprite, so the browser can rebuild its own texture atlas.
 * Must run on the client thread.
 */
final class Models {
	private final Minecraft mc = Minecraft.getInstance();
	private final ClientLevel level;
	private final BlockPos tintPos;
	private final Map<TextureAtlasSprite, Integer> textures = new HashMap<>();
	private final JsonArray tex = new JsonArray();

	Models(ClientLevel level, BlockPos tintPos) {
		this.level = level;
		this.tintPos = tintPos;
	}

	/** Adds "palette" and "tex" to the response. */
	void export(List<@Nullable BlockState> palette, JsonObject out) {
		JsonArray list = new JsonArray();
		for (BlockState s : palette) list.add(s == null ? JsonNull.INSTANCE : block(s));
		out.add("palette", list);
		out.add("tex", tex);
	}

	private JsonObject block(BlockState state) {
		JsonObject o = new JsonObject();
		o.addProperty("n", BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString());
		StringBuilder props = new StringBuilder();
		for (Property<?> p : state.getProperties()) {
			if (!props.isEmpty()) props.append(',');
			props.append(p.getName()).append('=').append(name(state, p));
		}
		o.addProperty("p", props.toString());
		o.addProperty("air", state.isAir());
		if (state.isAir()) return o;
		o.addProperty("opaque", state.isSolidRender());
		o.addProperty("selfCull", state.skipRendering(state, Direction.UP));
		o.addProperty("light", state.getLightEmission());

		JsonArray quads = new JsonArray();
		BlockStateModel model = mc.getModelManager().getBlockStateModelSet().get(state);
		List<BlockStateModelPart> parts = new ArrayList<>();
		model.collectParts(RandomSource.create(42L), parts);
		for (BlockStateModelPart part : parts) {
			for (Direction d : Direction.values()) for (BakedQuad q : part.getQuads(d)) quads.add(quad(state, q, d));
			for (BakedQuad q : part.getQuads(null)) quads.add(quad(state, q, null));
		}
		FluidState fluid = state.getFluidState();
		if (quads.isEmpty() && fluid.isEmpty()) boxFallback(state, model, quads);
		o.add("q", quads);

		if (!fluid.isEmpty()) {
			FluidModel fm = mc.getModelManager().getFluidStateModelSet().get(fluid);
			JsonObject f = new JsonObject();
			f.addProperty("k", BuiltInRegistries.FLUID.getKey(fluid.getType()).getPath().replace("flowing_", ""));
			f.addProperty("t", texture(fm.stillMaterial().sprite()));
			f.addProperty("c", fm.tintSource() == null ? -1 : tint(fm.tintSource(), state));
			f.addProperty("h", fluid.getOwnHeight());
			f.addProperty("l", fm.layer().ordinal());
			o.add("f", f);
		}
		return o;
	}

	@SuppressWarnings({"unchecked", "rawtypes"})
	private static String name(BlockState state, Property p) {
		return p.getName(state.getValue(p));
	}

	/** Blocks drawn by special renderers (chests, signs, beds...) get their outline box in the particle texture. */
	private void boxFallback(BlockState state, BlockStateModel model, JsonArray quads) {
		VoxelShape shape = state.getShape(EmptyBlockGetter.INSTANCE, BlockPos.ZERO);
		if (shape.isEmpty()) return;
		AABB b = shape.bounds();
		int t = texture(model.particleMaterial().sprite());
		float x0 = (float) b.minX, y0 = (float) b.minY, z0 = (float) b.minZ, x1 = (float) b.maxX, y1 = (float) b.maxY, z1 = (float) b.maxZ;
		float[][] faces = {
			{x0, y0, z1, x0, y0, z0, x1, y0, z0, x1, y0, z1}, // down
			{x0, y1, z0, x0, y1, z1, x1, y1, z1, x1, y1, z0}, // up
			{x1, y1, z0, x1, y0, z0, x0, y0, z0, x0, y1, z0}, // north
			{x0, y1, z1, x0, y0, z1, x1, y0, z1, x1, y1, z1}, // south
			{x0, y1, z0, x0, y0, z0, x0, y0, z1, x0, y1, z1}, // west
			{x1, y1, z1, x1, y0, z1, x1, y0, z0, x1, y1, z0}, // east
		};
		float[] uv = {0, 0, 0, 1, 1, 1, 1, 0};
		for (Direction d : Direction.values()) {
			JsonArray a = header(t, -1, -1, 0, d);
			float[] f = faces[d.get3DDataValue()];
			for (int v = 0; v < 4; v++) {
				for (int k = 0; k < 3; k++) a.add(round(f[v * 3 + k]));
				a.add(uv[v * 2]);
				a.add(uv[v * 2 + 1]);
			}
			quads.add(a);
		}
	}

	/** [texture, cullFace, tint, layer, shadeDir, then 4 × (x, y, z, u, v)]. */
	private JsonArray quad(BlockState state, BakedQuad q, @Nullable Direction cull) {
		BakedQuad.MaterialInfo m = q.materialInfo();
		TextureAtlasSprite s = m.sprite();
		int tint = -1;
		if (m.isTinted()) {
			BlockTintSource src = mc.getBlockColors().getTintSource(state, m.tintIndex());
			if (src != null) tint = tint(src, state);
		}
		Direction shade = m.shadeDirectionOverride() != null ? m.shadeDirectionOverride() : q.direction();
		JsonArray a = header(texture(s), cull == null ? -1 : cull.get3DDataValue(), tint, m.layer().ordinal(), shade);
		float du = s.getU1() - s.getU0(), dv = s.getV1() - s.getV0();
		for (int v = 0; v < 4; v++) {
			Vector3fc p = q.position(v);
			a.add(round(p.x()));
			a.add(round(p.y()));
			a.add(round(p.z()));
			a.add(round((UVPair.unpackU(q.packedUV(v)) - s.getU0()) / du));
			a.add(round((UVPair.unpackV(q.packedUV(v)) - s.getV0()) / dv));
		}
		return a;
	}

	private static JsonArray header(int tex, int cull, int tint, int layer, Direction shade) {
		JsonArray a = new JsonArray();
		a.add(tex);
		a.add(cull);
		a.add(tint);
		a.add(layer);
		a.add(shade.get3DDataValue());
		return a;
	}

	private int tint(BlockTintSource src, BlockState state) {
		return src.colorInWorld(state, level, tintPos) & 0xFFFFFF;
	}

	private int texture(TextureAtlasSprite s) {
		return textures.computeIfAbsent(s, k -> {
			JsonObject t = new JsonObject();
			t.addProperty("id", k.contents().name().toString());
			t.addProperty("w", k.contents().width());
			t.addProperty("h", k.contents().height());
			tex.add(t);
			return tex.size() - 1;
		});
	}

	private static float round(float f) {
		return Math.round(f * 10000f) / 10000f;
	}
}
