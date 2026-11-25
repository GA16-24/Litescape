package dev.ga16.litweb.client.shaders;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;

/** Turns a pack plus chosen options into everything the browser needs to run it. */
public final class Pipeline {
	/** Programs the web renderer runs (iris.js). Entities, hand, clouds and particles have no geometry here. */
	private static final List<String> GBUFFERS = List.of("gbuffers_basic", "gbuffers_textured", "gbuffers_textured_lit", "gbuffers_skybasic",
		"gbuffers_terrain", "gbuffers_terrain_solid", "gbuffers_water", "shadow", "shadow_solid", "final");
	private static final String[] PASSES = {"begin", "prepare", "deferred", "composite"};
	private static final Pattern DRAWBUFFERS = Pattern.compile("DRAWBUFFERS\\s*:\\s*(\\d+)");
	private static final Pattern RENDERTARGETS = Pattern.compile("RENDERTARGETS\\s*:\\s*([\\d\\s,]+)");
	private static final Pattern FORMAT = Pattern.compile("const\\s+int\\s+(\\w+)Format\\s*=\\s*(\\w+)\\s*;");
	private static final Pattern CLEAR = Pattern.compile("const\\s+bool\\s+(\\w+)Clear\\s*=\\s*(true|false)\\s*;");
	private static final Pattern CLEAR_COLOR = Pattern.compile("const\\s+vec4\\s+(\\w+)ClearColor\\s*=\\s*vec4\\s*\\(([^)]*)\\)\\s*;");
	private static final Pattern MIPMAP = Pattern.compile("const\\s+bool\\s+(\\w+)MipmapEnabled\\s*=\\s*true\\s*;");
	private static final Pattern CONST = Pattern.compile("const\\s+(?:int|float|bool)\\s+(shadowMapResolution|shadowDistance|sunPathRotation|shadowHardwareFiltering[01]?|shadowIntervalSize"
		+ "|shadowDistanceRenderMul|ambientOcclusionLevel|noiseTextureResolution|eyeBrightnessHalflife|centerDepthHalflife|wetnessHalflife|drynessHalflife"
		+ "|shadow(?:tex|color)[01]?(?:Mipmap|Nearest)|generateShadowMipmap|generateShadowColorMipmap|shadowcolor[01]?Clear)\\s*=\\s*([^;]+);");
	private static final Pattern INCLUDE = Pattern.compile("^\\s*#\\s*include\\s+[\"<]([^\">]+)[\">]");

	/** The browser's limits are close to macOS OpenGL 4.1, and packs already have fallbacks for that. */
	public static Map<String, String> standardMacros() {
		Map<String, String> m = new LinkedHashMap<>();
		m.put("MC_VERSION", "260300");
		m.put("MC_GL_VERSION", "410");
		m.put("MC_GLSL_VERSION", "410");
		m.put("MC_OS_MAC", "1");
		m.put("MC_GL_VENDOR_OTHER", "1");
		m.put("MC_GL_RENDERER_OTHER", "1");
		m.put("IS_IRIS", "1");
		m.put("IRIS_VERSION", "11103");
		m.put("MC_RENDER_QUALITY", "1.0");
		m.put("MC_SHADOW_QUALITY", "1.0");
		m.put("MC_HAND_DEPTH", "0.125");
		m.put("MC_NORMAL_MAP", "1");
		m.put("MC_SPECULAR_MAP", "1");
		String[] stages = {"NONE", "SKY", "SUNSET", "CUSTOM_SKY", "SUN", "MOON", "STARS", "VOID", "TERRAIN_SOLID", "TERRAIN_CUTOUT_MIPPED", "TERRAIN_CUTOUT", "ENTITIES",
			"BLOCK_ENTITIES", "DESTROY", "OUTLINE", "DEBUG", "HAND_SOLID", "TERRAIN_TRANSLUCENT", "TRIPWIRE", "PARTICLES", "CLOUDS", "RAIN_SNOW", "WORLD_BORDER", "HAND_TRANSLUCENT"};
		for (int i = 0; i < stages.length; i++) m.put("MC_RENDER_STAGE_" + stages[i], String.valueOf(i));
		return m;
	}

	private static final ExecutorService POOL = Executors.newFixedThreadPool(Math.max(2, Math.min(6, Runtime.getRuntime().availableProcessors() - 1)), r -> {
		Thread t = new Thread(r, "litweb-shaders");
		t.setDaemon(true);
		return t;
	});
	/** Compiled stages by a hash of their source, so changing one option only recompiles the programs it touches. */
	private static final Map<String, Object> CACHE = java.util.Collections.synchronizedMap(new LinkedHashMap<>(128, 0.75f, true) {
		@Override
		protected boolean removeEldestEntry(Map.Entry<String, Object> e) {
			return size() > 160; // about two packs' worth; sources are large, so key by hash
		}
	});

	public static JsonObject build(Pack pack, Options opts) throws Exception {
		Map<String, String> macros = standardMacros();
		macros.putAll(opts.macros());
		Cpp propsCpp = new Cpp(macros, false);
		Map<String, String> props = properties(pack, "shaders.properties", propsCpp);
		JsonObject locked = lockPinned(opts, macros, propsCpp);
		String world = hasFolder(pack, "world0") ? "world0/" : "";

		// Which programs exist and are enabled.
		List<String> names = new ArrayList<>(GBUFFERS);
		for (String p : PASSES) {
			names.add(p);
			for (int i = 1; i < 100; i++) names.add(p + i);
		}
		Map<String, Future<JsonObject>> jobs = new LinkedHashMap<>();
		for (String n : names) {
			String base = pack.has(world + n + ".fsh") ? world + n : pack.has(n + ".fsh") ? n : null;
			if (base == null) continue;
			String en = props.getOrDefault("program." + world + n + ".enabled", props.get("program." + n + ".enabled"));
			if (en != null && !new Cpp(macros, false).eval(en)) continue;
			String fbase = base;
			jobs.put(n, POOL.submit(() -> program(pack, opts, n, fbase, props)));
		}

		JsonObject programs = new JsonObject();
		JsonObject consts = new JsonObject();
		JsonObject formats = new JsonObject(), clear = new JsonObject(), clearColor = new JsonObject();
		for (var e : jobs.entrySet()) {
			JsonObject p = e.getValue().get();
			JsonObject found = p.remove("found").getAsJsonObject();
			for (String k : found.keySet()) {
				JsonObject src = found.getAsJsonObject(k);
				JsonObject dst = switch (k) {
					case "format" -> formats;
					case "clear" -> clear;
					case "clearColor" -> clearColor;
					default -> consts;
				};
				for (String kk : src.keySet()) if (!dst.has(kk)) dst.add(kk, src.get(kk));
			}
			programs.add(e.getKey(), p);
		}

		JsonObject out = new JsonObject();
		out.addProperty("pack", pack.id);
		out.add("programs", programs);
		JsonObject buffers = new JsonObject();
		buffers.add("format", formats);
		buffers.add("clear", clear);
		buffers.add("clearColor", clearColor);
		out.add("buffers", buffers);
		out.add("consts", consts);
		JsonObject pj = new JsonObject();
		props.forEach(pj::addProperty);
		out.add("props", pj);
		out.add("locked", locked);
		out.add("blocks", blocks(pack, world, macros));
		return out;
	}

	private static boolean hasFolder(Pack pack, String folder) {
		for (String p : pack.paths()) if (p.startsWith(folder + "/")) return true;
		return false;
	}

	private static JsonObject program(Pack pack, Options opts, String name, String base, Map<String, String> props) {
		JsonObject o = new JsonObject();
		JsonObject found = new JsonObject();
		o.add("found", found);
		try {
			if (pack.has(base + ".gsh")) throw new Translator.Failure("Uses a geometry shader, which WebGL doesn't have");
			if (!pack.has(base + ".vsh")) throw new Translator.Failure("Has no vertex shader (" + base + ".vsh)");
			Cpp vcpp = new Cpp(standardMacros(), true), fcpp = new Cpp(standardMacros(), true);
			List<Cpp.Line> vs = vcpp.run(inline(pack, base + ".vsh", opts));
			List<Cpp.Line> fs = fcpp.run(inline(pack, base + ".fsh", opts));
			String vsText = join(vs), fsText = join(fs);
			scan(fsText, fcpp, found, o);
			scan(vsText, vcpp, found, null);

			boolean gbuffers = name.startsWith("gbuffers_");
			String at = props.get("alphaTest." + name);
			boolean alphaTest = gbuffers && !name.equals("gbuffers_water") && !name.startsWith("gbuffers_sky") && (at == null || !at.strip().equalsIgnoreCase("off"));
			var varyings = Translator.builtinVaryings(vsText, fsText);
			Translator.Patched pv = Translator.patch(vs, true, varyings, false, standardMacros());
			Translator.Patched pf = Translator.patch(fs, false, varyings, alphaTest, standardMacros());
			o.addProperty("vs", compile(pv, true, base + ".vsh"));
			o.addProperty("fs", compile(pf, false, base + ".fsh"));
			if (!o.has("drawBuffers")) {
				JsonArray db = new JsonArray();
				for (int i = 0; i < Math.max(1, pf.outputs()); i++) db.add(i);
				o.add("drawBuffers", db);
			}
		} catch (Translator.Failure e) {
			o.addProperty("error", e.getMessage());
		} catch (Exception e) {
			o.addProperty("error", e.toString());
		}
		return o;
	}

	private static String compile(Translator.Patched p, boolean vertex, String name) throws Translator.Failure {
		String key = (vertex ? "v" : "f") + sha256(p.text());
		Object hit = CACHE.get(key);
		if (hit == null) {
			try {
				hit = Translator.toEs(p, vertex, name);
			} catch (Translator.Failure e) {
				hit = e;
			}
			CACHE.put(key, hit);
		}
		if (hit instanceof Translator.Failure f) throw f;
		return (String) hit;
	}

	private static String sha256(String s) {
		try {
			return java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(s.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
		} catch (java.security.NoSuchAlgorithmException e) {
			throw new IllegalStateException(e);
		}
	}

	/** Reads the directives Iris takes from comments and constants: draw buffers, buffer formats, shadow settings. */
	private static void scan(String text, Cpp cpp, JsonObject found, @Nullable JsonObject program) {
		if (program != null) {
			String rt = last(RENDERTARGETS, text), db = last(DRAWBUFFERS, text);
			if (rt != null || db != null) {
				JsonArray a = new JsonArray();
				if (rt != null) {
					for (String s : rt.split("[\\s,]+")) if (!s.isEmpty()) a.add(Integer.parseInt(s));
				} else for (char c : db.toCharArray()) a.add(c - '0');
				program.add("drawBuffers", a);
			}
			JsonArray mip = new JsonArray();
			Matcher m = MIPMAP.matcher(text);
			while (m.find()) mip.add(m.group(1));
			if (!mip.isEmpty()) program.add("mipmap", mip);
		}
		put(found, "format", FORMAT, text, cpp);
		put(found, "clear", CLEAR, text, cpp);
		put(found, "clearColor", CLEAR_COLOR, text, cpp);
		put(found, "const", CONST, text, cpp);
	}

	private static void put(JsonObject found, String key, Pattern p, String text, Cpp cpp) {
		JsonObject dst = found.has(key) ? found.getAsJsonObject(key) : new JsonObject();
		Matcher m = p.matcher(text);
		while (m.find()) {
			if (dst.has(m.group(1))) continue;
			String v = m.group(2).strip();
			// Constant values may be macros, like shadowMapResolution = SHADOW_RES.
			if (v.matches("[A-Za-z_]\\w*") && !key.equals("format") && !v.equals("true") && !v.equals("false")) {
				String mv = cpp.value(v);
				if (mv != null) v = mv.strip();
			}
			dst.addProperty(m.group(1), v);
		}
		if (!dst.isEmpty()) found.add(key, dst);
	}

	private static @Nullable String last(Pattern p, String text) {
		Matcher m = p.matcher(text);
		String r = null;
		while (m.find()) r = m.group(1);
		return r;
	}

	private static String join(List<Cpp.Line> lines) {
		StringBuilder b = new StringBuilder();
		for (Cpp.Line l : lines) b.append(l.text()).append('\n');
		return b.toString();
	}

	/** Inlines #include recursively (absolute paths start at shaders/), applying option values to every line. */
	static List<Cpp.Line> inline(Pack pack, String path, Options opts) throws Translator.Failure {
		List<Cpp.Line> out = new ArrayList<>();
		inline(pack, Pack.normalize(path), opts, out, 0);
		return out;
	}

	private static void inline(Pack pack, String path, Options opts, List<Cpp.Line> out, int depth) throws Translator.Failure {
		if (depth > 40) throw new Translator.Failure("Includes nest too deeply at " + path);
		String text = pack.text(path);
		if (text == null) throw new Translator.Failure("Missing file " + path);
		String[] lines = text.split("\r?\n", -1);
		String dir = path.contains("/") ? path.substring(0, path.lastIndexOf('/') + 1) : "";
		for (int i = 0; i < lines.length; i++) {
			Matcher m = INCLUDE.matcher(lines[i]);
			if (m.find()) {
				String target = m.group(1);
				String resolved = Pack.normalize(target.startsWith("/") ? target : dir + target);
				if (pack.has(resolved)) inline(pack, resolved, opts, out, depth + 1);
				else out.add(new Cpp.Line("#error \"missing include " + target.replace("\"", "") + "\"", path, i + 1));
			} else {
				out.add(new Cpp.Line(opts.apply(lines[i]), path, i + 1));
			}
		}
	}

	/**
	 * Packs pin options a platform can't run by redefining them in shaders.properties (Complementary:
	 * "#ifdef MC_OS_MAC / #define COLORED_LIGHTING 0"). Those values win over the user's choice, as the pack intends.
	 */
	static JsonObject lockPinned(Options opts, Map<String, String> before, Cpp after) {
		JsonObject locked = new JsonObject();
		for (Options.Option o : opts.all.values()) {
			String v;
			if (o.kind == Options.Kind.BOOL) {
				boolean on = after.macros.containsKey(o.name);
				if (on == before.containsKey(o.name)) continue;
				v = String.valueOf(on);
			} else {
				v = after.value(o.name);
				if (v == null || v.strip().equals(before.get(o.name))) continue;
				v = v.strip();
			}
			opts.values.put(o.name, v);
			locked.addProperty(o.name, v);
		}
		return locked;
	}

	/** shaders.properties after preprocessing: key=value with line continuations joined. */
	public static Map<String, String> properties(Pack pack, String file, Map<String, String> macros) {
		return properties(pack, file, new Cpp(macros, false));
	}

	static Map<String, String> properties(Pack pack, String file, Cpp cpp) {
		Map<String, String> out = new LinkedHashMap<>();
		String text = pack.text(file);
		if (text == null) return out;
		List<Cpp.Line> lines = new ArrayList<>();
		String[] raw = text.split("\r?\n");
		for (int i = 0; i < raw.length; i++) lines.add(new Cpp.Line(raw[i], file, i + 1));
		for (Cpp.Line l : cpp.run(lines)) {
			String t = l.text().strip();
			if (t.isEmpty() || t.startsWith("#") || t.startsWith("!")) continue;
			int eq = t.indexOf('=');
			if (eq <= 0) continue;
			out.put(t.substring(0, eq).strip(), t.substring(eq + 1).strip());
		}
		return out;
	}

	/** block.properties as {"minecraft:wheat": [[id, {"age": ["7"]}], ...]} for the mesher's mc_Entity. */
	private static JsonObject blocks(Pack pack, String world, Map<String, String> macros) {
		String file = pack.has(world + "block.properties") ? world + "block.properties" : "block.properties";
		JsonObject out = new JsonObject();
		properties(pack, file, macros).forEach((k, v) -> {
			if (!k.startsWith("block.")) return;
			int id;
			try {
				id = Integer.parseInt(k.substring(6).strip());
			} catch (NumberFormatException e) {
				return;
			}
			for (String entry : v.split("\\s+")) {
				if (entry.isEmpty() || entry.startsWith("%") || entry.startsWith("#")) continue; // tags aren't resolved here
				String[] parts = entry.split(":");
				int at;
				String key;
				if (parts.length >= 2 && !parts[1].contains("=")) {
					key = parts[0] + ":" + parts[1];
					at = 2;
				} else {
					key = "minecraft:" + parts[0];
					at = 1;
				}
				JsonObject state = new JsonObject();
				for (int i = at; i < parts.length; i++) {
					int eq = parts[i].indexOf('=');
					if (eq <= 0) continue;
					JsonArray vals = new JsonArray();
					for (String s : parts[i].substring(eq + 1).split(",")) vals.add(s);
					state.add(parts[i].substring(0, eq), vals);
				}
				JsonArray rule = new JsonArray();
				rule.add(id);
				rule.add(state);
				if (!out.has(key)) out.add(key, new JsonArray());
				out.getAsJsonArray(key).add(rule);
			}
		});
		return out;
	}

	/** lang/en_US.lang as a flat map. */
	public static JsonObject lang(Pack pack) {
		JsonObject o = new JsonObject();
		String t = pack.textIgnoreCase("lang/en_us.lang");
		if (t == null) return o;
		for (String line : t.split("\r?\n")) {
			String s = line.strip();
			if (s.isEmpty() || s.startsWith("#")) continue;
			int eq = s.indexOf('=');
			if (eq > 0) o.addProperty(s.substring(0, eq).strip(), s.substring(eq + 1).strip());
		}
		return o;
	}
}
