package dev.ga16.litweb.client.shaders;

import static org.lwjgl.util.shaderc.Shaderc.*;
import static org.lwjgl.util.spvc.Spvc.*;

import java.nio.ByteBuffer;
import java.nio.IntBuffer;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;
import org.lwjgl.PointerBuffer;
import org.lwjgl.system.MemoryStack;
import org.lwjgl.system.MemoryUtil;

/**
 * Desktop pack GLSL to WebGL2 GLSL ES 3.00. Compatibility-profile built-ins are rewritten to plain
 * inputs and uniforms first, then glslang (shaderc) compiles to SPIR-V, which takes care of implicit
 * conversions and overloads, and SPIRV-Cross (spvc) writes it back out as ES. Both ship with Minecraft.
 */
public final class Translator {
	public static final class Failure extends Exception {
		Failure(String message) {
			super(message);
		}
	}

	private static final Pattern VERSION = Pattern.compile("^\\s*#\\s*version\\s+(\\d+)\\s*(\\w*)");
	private static final Pattern EXTENSION = Pattern.compile("^\\s*#\\s*extension\\s+(\\w+)\\s*:\\s*(\\w+)");
	private static final Pattern MAIN = Pattern.compile("\\bvoid\\s+main\\s*\\(\\s*(?:void)?\\s*\\)");
	private static final Pattern TEXCOORD = Pattern.compile("\\bgl_TexCoord\\s*\\[\\s*(\\d)\\s*\\]");
	private static final Pattern FRAGDATA = Pattern.compile("\\bgl_FragData\\s*\\[\\s*(\\d+)\\s*\\]");
	private static final Pattern TEXMAT = Pattern.compile("\\bgl_TextureMatrix\\s*\\[\\s*(\\d)\\s*\\]");
	private static final Pattern IRIS_OUT = Pattern.compile("\\biris_FragData(\\d+)\\b");
	/** Extensions whose functions are core in the version we compile at; "require" on them would fail. */
	private static final Set<String> DROP_EXT = Set.of("GL_EXT_gpu_shader4", "GL_ARB_shader_texture_lod", "GL_ARB_explicit_attrib_location", "GL_EXT_gpu_shader4_1");

	/** The compatibility varyings a program uses in either stage, so both stages declare the same set. */
	public static Set<String> builtinVaryings(String vs, String fs) {
		Set<String> s = new TreeSet<>();
		if (fs.contains("gl_Color") || vs.contains("gl_FrontColor")) s.add("iris_FrontColor");
		if (vs.contains("gl_FogFragCoord") || fs.contains("gl_FogFragCoord")) s.add("iris_FogFragCoord");
		for (String src : new String[] {vs, fs}) {
			Matcher m = TEXCOORD.matcher(src);
			while (m.find()) s.add("iris_TexCoord" + m.group(1));
		}
		return s;
	}

	/** Patched desktop GLSL plus, per output line, the pack file and line it came from (null for added lines). */
	public record Patched(String text, List<Cpp.@Nullable Line> map, int outputs) {}

	public static Patched patch(List<Cpp.Line> lines, boolean vertex, Set<String> varyings, boolean alphaTest, java.util.Map<String, String> defines) {
		int version = 120;
		String profile = "";
		List<String> extensions = new ArrayList<>();
		StringBuilder body = new StringBuilder();
		for (Cpp.Line l : lines) {
			Matcher v = VERSION.matcher(l.text());
			Matcher e = EXTENSION.matcher(l.text());
			if (v.find()) {
				version = Integer.parseInt(v.group(1));
				profile = v.group(2);
				body.append('\n');
			} else if (e.find()) {
				if (!DROP_EXT.contains(e.group(1))) extensions.add("#extension " + e.group(1) + " : " + (e.group(2).equals("require") ? "enable" : e.group(2)));
				body.append('\n');
			} else {
				body.append(l.text()).append('\n');
			}
		}
		String s = body.toString();
		boolean compat = version < 140 || profile.equals("compatibility");
		if (version < 130) s = s.replaceAll("\\btexture\\b", "gtexture"); // the atlas used to be called "texture"
		s = s.replaceAll("\\btexture2DLod(ARB)?\\b", "textureLod")
			.replaceAll("\\btexture2DGrad(ARB)?\\b", "textureGrad")
			.replaceAll("\\btexture(2D|3D|Cube)\\b", "texture")
			.replaceAll("\\btexture(3D|Cube)Lod\\b", "textureLod")
			.replaceAll("\\btexture2DProj\\b", "textureProj")
			.replaceAll("\\btexelFetch2D\\b", "texelFetch")
			.replaceAll("\\bshadow2DLod\\b", "iris_shadow2D_lod")
			.replaceAll("\\bshadow2D\\b", "iris_shadow2D");
		// WebGL has no noperspective; packs use it on full-screen passes, where it changes nothing.
		s = s.replaceAll("\\bnoperspective\\b", "");
		if (vertex) s = s.replaceAll("\\battribute\\b", "in");
		s = s.replaceAll("\\bvarying\\b", vertex ? "out" : "in");
		if (compat) {
			s = s.replace("ftransform()", "(iris_ProjectionMatrix * (iris_ModelViewMatrix * iris_Vertex))")
				.replaceAll("\\bgl_ModelViewProjectionMatrix\\b", "(iris_ProjectionMatrix * iris_ModelViewMatrix)")
				.replaceAll("\\bgl_(ModelViewMatrix|ModelViewMatrixInverse|ProjectionMatrix|ProjectionMatrixInverse|NormalMatrix)\\b", "iris_$1")
				.replaceAll("\\bgl_Fog\\.(\\w+)", "iris_Fog_$1")
				.replaceAll("\\bgl_FogFragCoord\\b", "iris_FogFragCoord");
			s = TEXMAT.matcher(s).replaceAll(m -> m.group(1).equals("0") ? "iris_TextureMatrix0" : "iris_TextureMatrix1");
			s = TEXCOORD.matcher(s).replaceAll("iris_TexCoord$1");
			if (vertex) {
				s = s.replaceAll("\\bgl_(Vertex|Normal|Color|MultiTexCoord0)\\b", "iris_$1")
					.replaceAll("\\bgl_MultiTexCoord[12]\\b", "iris_MultiTexCoord1")
					.replaceAll("\\bgl_MultiTexCoord[3-7]\\b", "vec4(0.0, 0.0, 0.0, 1.0)")
					.replaceAll("\\bgl_(FrontColor|BackColor)\\b", "iris_FrontColor");
			} else {
				s = s.replaceAll("\\bgl_Color\\b", "iris_FrontColor")
					.replaceAll("\\bgl_FragColor\\b", "iris_FragData0");
				s = FRAGDATA.matcher(s).replaceAll("iris_FragData$1");
			}
		}

		if (!vertex) s = locateOutputs(s);

		List<String> head = new ArrayList<>();
		head.add("#version " + Math.max(330, version >= 400 ? version : 330) + " core");
		head.addAll(extensions);
		defines.forEach((k, v) -> head.add("#define " + k + " " + v));
		decl(head, s, "uniform mat4", "iris_ModelViewMatrix", "iris_ModelViewMatrixInverse", "iris_ProjectionMatrix", "iris_ProjectionMatrixInverse", "iris_TextureMatrix0", "iris_TextureMatrix1");
		decl(head, s, "uniform mat3", "iris_NormalMatrix");
		decl(head, s, "uniform vec4", "iris_Fog_color");
		decl(head, s, "uniform float", "iris_Fog_density", "iris_Fog_start", "iris_Fog_end", "iris_Fog_scale");
		int outputs = 0;
		if (vertex) {
			decl(head, s, "in vec4", "iris_Vertex", "iris_Color", "iris_MultiTexCoord0", "iris_MultiTexCoord1");
			decl(head, s, "in vec3", "iris_Normal");
			for (String v : varyings) head.add("out " + (v.equals("iris_FogFragCoord") ? "float " : "vec4 ") + v + ";");
		} else {
			for (String v : varyings) head.add("in " + (v.equals("iris_FogFragCoord") ? "float " : "vec4 ") + v + ";");
			Matcher m = IRIS_OUT.matcher(s);
			TreeSet<Integer> outs = new TreeSet<>();
			while (m.find()) outs.add(Integer.parseInt(m.group(1)));
			for (int i : outs) head.add("layout(location = " + i + ") out vec4 iris_FragData" + i + ";");
			outputs = outs.isEmpty() ? 0 : outs.last() + 1;
			if (alphaTest && outs.contains(0)) {
				s = MAIN.matcher(s).replaceFirst("void iris_main()");
				s += "uniform float iris_alphaTestRef;\nvoid main() { iris_main(); if (!(iris_FragData0.a > iris_alphaTestRef)) discard; }\n";
			}
		}
		if (s.contains("textureGather")) {
			// GLSL ES 3.00 has no textureGather: fetch the four texels of the bilinear footprint instead.
			s = s.replaceAll("\\btextureGather(Offset)?\\b", "iris_textureGather$1");
			head.add("vec4 iris_textureGather(sampler2D s, vec2 uv, int c) { ivec2 m = textureSize(s, 0) - 1; ivec2 i = ivec2(floor(uv * vec2(textureSize(s, 0)) - 0.5));"
				+ " return vec4(texelFetch(s, clamp(i + ivec2(0, 1), ivec2(0), m), 0)[c], texelFetch(s, clamp(i + ivec2(1, 1), ivec2(0), m), 0)[c],"
				+ " texelFetch(s, clamp(i + ivec2(1, 0), ivec2(0), m), 0)[c], texelFetch(s, clamp(i, ivec2(0), m), 0)[c]); }");
			head.add("vec4 iris_textureGather(sampler2D s, vec2 uv) { return iris_textureGather(s, uv, 0); }");
			head.add("vec4 iris_textureGatherOffset(sampler2D s, vec2 uv, ivec2 o, int c) { return iris_textureGather(s, uv + vec2(o) / vec2(textureSize(s, 0)), c); }");
			head.add("vec4 iris_textureGatherOffset(sampler2D s, vec2 uv, ivec2 o) { return iris_textureGatherOffset(s, uv, o, 0); }");
		}
		if (s.contains("iris_shadow2D")) {
			head.add("vec4 iris_shadow2D(sampler2DShadow s, vec3 c) { return vec4(texture(s, c)); }");
			head.add("vec4 iris_shadow2D(sampler2D s, vec3 c) { return vec4(step(c.z, texture(s, c.xy).r)); }");
			head.add("vec4 iris_shadow2D_lod(sampler2DShadow s, vec3 c, float l) { return vec4(texture(s, c)); }");
			head.add("vec4 iris_shadow2D_lod(sampler2D s, vec3 c, float l) { return vec4(step(c.z, textureLod(s, c.xy, l).r)); }");
		}

		List<Cpp.@Nullable Line> map = new ArrayList<>();
		for (int i = 0; i < head.size(); i++) map.add(null);
		map.addAll(lines);
		return new Patched(String.join("\n", head) + "\n" + s, map, outputs);
	}

	private static final Pattern LOCATED = Pattern.compile("layout\\s*\\(\\s*location\\s*=\\s*(\\d+)\\s*\\)\\s*out\\b");
	private static final Pattern UNLOCATED = Pattern.compile("(?m)^(\\s*)out(\\s+\\w+\\s+\\w+\\s*;)");

	/** Fragment outputs without a location get the free ones in declaration order, as desktop linkers do. */
	static String locateOutputs(String s) {
		Set<Integer> used = new TreeSet<>();
		Matcher m = LOCATED.matcher(s);
		while (m.find()) used.add(Integer.parseInt(m.group(1)));
		int[] next = {0};
		return UNLOCATED.matcher(s).replaceAll(r -> {
			while (used.contains(next[0])) next[0]++;
			used.add(next[0]);
			return Matcher.quoteReplacement(r.group(1) + "layout(location = " + next[0] + ") out" + r.group(2));
		});
	}

	private static void decl(List<String> head, String src, String type, String... names) {
		for (String n : names) if (Pattern.compile("\\b" + n + "\\b").matcher(src).find()) head.add(type + " " + n + ";");
	}

	// ---- shaderc + spvc ----

	private static final ThreadLocal<long[]> COMPILER = ThreadLocal.withInitial(() -> {
		long c = shaderc_compiler_initialize();
		long o = shaderc_compile_options_initialize();
		shaderc_compile_options_set_target_env(o, shaderc_target_env_opengl, shaderc_env_version_opengl_4_5);
		shaderc_compile_options_set_auto_map_locations(o, true);
		shaderc_compile_options_set_auto_bind_uniforms(o, true);
		shaderc_compile_options_set_optimization_level(o, shaderc_optimization_level_zero);
		return new long[] {c, o};
	});

	/** Compiles one stage to GLSL ES 3.00, or throws with errors pointing into the pack's files. */
	public static String toEs(Patched p, boolean vertex, String name) throws Failure {
		long[] co = COMPILER.get();
		// Pack sources are far bigger than LWJGL's 64 KB stack, so pass them from the heap.
		ByteBuffer src = MemoryUtil.memUTF8(p.text, false), file = MemoryUtil.memUTF8(name), entry = MemoryUtil.memUTF8("main");
		long r = shaderc_compile_into_spv(co[0], src, vertex ? shaderc_vertex_shader : shaderc_fragment_shader, file, entry, co[1]);
		MemoryUtil.memFree(src);
		MemoryUtil.memFree(file);
		MemoryUtil.memFree(entry);
		try {
			if (shaderc_result_get_compilation_status(r) != shaderc_compilation_status_success) throw new Failure(mapErrors(shaderc_result_get_error_message(r), p.map));
			ByteBuffer bytes = shaderc_result_get_bytes(r);
			if (bytes == null) throw new Failure("The compiler returned no code");
			return crossCompile(bytes);
		} finally {
			shaderc_result_release(r);
		}
	}

	private static String crossCompile(ByteBuffer spirv) throws Failure {
		try (MemoryStack st = MemoryStack.stackPush()) {
			PointerBuffer p = st.mallocPointer(1);
			if (spvc_context_create(p) != SPVC_SUCCESS) throw new Failure("Could not start SPIRV-Cross");
			long ctx = p.get(0);
			try {
				IntBuffer words = spirv.asIntBuffer();
				IntBuffer copy = MemoryUtil.memAllocInt(words.remaining());
				copy.put(words).flip();
				int parsed = spvc_context_parse_spirv(ctx, copy, copy.remaining(), p);
				MemoryUtil.memFree(copy);
				check(ctx, parsed);
				long ir = p.get(0);
				check(ctx, spvc_context_create_compiler(ctx, SPVC_BACKEND_GLSL, ir, SPVC_CAPTURE_MODE_TAKE_OWNERSHIP, p));
				long comp = p.get(0);
				check(ctx, spvc_compiler_create_compiler_options(comp, p));
				long opts = p.get(0);
				spvc_compiler_options_set_uint(opts, SPVC_COMPILER_OPTION_GLSL_VERSION, 300);
				spvc_compiler_options_set_bool(opts, SPVC_COMPILER_OPTION_GLSL_ES, true);
				spvc_compiler_options_set_bool(opts, SPVC_COMPILER_OPTION_GLSL_ES_DEFAULT_FLOAT_PRECISION_HIGHP, true);
				spvc_compiler_options_set_bool(opts, SPVC_COMPILER_OPTION_GLSL_ES_DEFAULT_INT_PRECISION_HIGHP, true);
				spvc_compiler_options_set_bool(opts, SPVC_COMPILER_OPTION_FLATTEN_MULTIDIMENSIONAL_ARRAYS, true);
				spvc_compiler_options_set_bool(opts, SPVC_COMPILER_OPTION_GLSL_EMIT_UNIFORM_BUFFER_AS_PLAIN_UNIFORMS, true);
				spvc_compiler_options_set_bool(opts, SPVC_COMPILER_OPTION_GLSL_FORCE_FLATTENED_IO_BLOCKS, true);
				check(ctx, spvc_compiler_install_compiler_options(comp, opts));
				check(ctx, spvc_compiler_compile(comp, p));
				return MemoryUtil.memUTF8(p.get(0));
			} finally {
				spvc_context_destroy(ctx);
			}
		}
	}

	private static void check(long ctx, int result) throws Failure {
		if (result != SPVC_SUCCESS) throw new Failure("WebGL can't express this shader: " + spvc_context_get_last_error_string(ctx));
	}

	private static final Pattern ERR = Pattern.compile("^[^:\\n]*:(\\d+): (error|warning): (.*)$", Pattern.MULTILINE);

	/** "x:120: error: ..." becomes "lib/water.glsl:31: ..." using the include map. */
	static String mapErrors(String raw, List<Cpp.@Nullable Line> map) {
		StringBuilder b = new StringBuilder();
		Matcher m = ERR.matcher(raw);
		while (m.find()) {
			if (!m.group(2).equals("error")) continue;
			int line = Integer.parseInt(m.group(1)) - 1;
			Cpp.Line src = line >= 0 && line < map.size() ? map.get(line) : null;
			if (!b.isEmpty()) b.append('\n');
			b.append(src == null ? "(generated)" : src.file() + ":" + src.line()).append(": ").append(m.group(3).strip());
		}
		return b.isEmpty() ? raw.strip() : b.toString();
	}
}
