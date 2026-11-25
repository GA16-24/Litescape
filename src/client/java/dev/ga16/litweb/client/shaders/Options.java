package dev.ga16.litweb.client.shaders;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;

/**
 * Pack options, found the way Iris and OptiFine find them: {@code #define NAME} toggles (commented out when off),
 * {@code #define NAME VALUE // [a b c]} choices and {@code const type NAME = VALUE; // [a b c]} constants.
 */
public final class Options {
	public enum Kind { BOOL, VALUE, CONST }

	public static final class Option {
		public final String name;
		public final Kind kind;
		public final String def;
		public final List<String> values;
		public String comment;

		Option(String name, Kind kind, String def, List<String> values, String comment) {
			this.name = name;
			this.kind = kind;
			this.def = def;
			this.values = values;
			this.comment = comment;
		}
	}

	private static final Pattern BOOL = Pattern.compile("^\\s*(//)?\\s*#define\\s+(\\w+)\\s*(?://\\s*(.*))?$");
	private static final Pattern VALUE = Pattern.compile("^\\s*#define\\s+(\\w+)\\s+([^\\s/]+)\\s*//(.*)$");
	private static final Pattern CONST = Pattern.compile("^\\s*const\\s+(int|float|bool)\\s+(\\w+)\\s*=\\s*([^;\\s]+)\\s*;\\s*//(.*)$");
	private static final Pattern LIST = Pattern.compile("\\[([^\\]]*)\\]");
	private static final Pattern IFDEF = Pattern.compile("#\\s*(?:ifdef|ifndef)\\s+(\\w+)|defined\\s*\\(?\\s*(\\w+)");

	public final Map<String, Option> all = new LinkedHashMap<>();
	/** Current values: "true"/"false" for toggles. */
	public final Map<String, String> values = new LinkedHashMap<>();

	public static Options scan(Pack pack) {
		Options o = new Options();
		Set<String> tested = new HashSet<>();
		List<String> files = new ArrayList<>();
		// Any source file counts, whatever its extension (Sildur's keeps settings in shaders.settings).
		for (String p : pack.paths()) if (!p.matches("(?i).*\\.(properties|lang|png|jpe?g|txt|md|json|dat|bin|zip|ogg|mcmeta|ttf)$")) files.add(p);
		files.sort(null);
		for (String f : files) {
			Matcher m = IFDEF.matcher(pack.text(f));
			while (m.find()) tested.add(m.group(1) != null ? m.group(1) : m.group(2));
		}
		for (String f : files) {
			String[] lines = pack.text(f).split("\r?\n");
			String prev = "";
			for (String line : lines) {
				o.scanLine(line, prev, tested);
				if (!line.isBlank()) prev = line.strip();
			}
		}
		for (Option opt : o.all.values()) o.values.put(opt.name, opt.def);
		return o;
	}

	private void scanLine(String line, String prev, Set<String> tested) {
		if (!line.contains("#define") && !line.contains("const")) return;
		Matcher m = VALUE.matcher(line);
		if (m.matches()) {
			Matcher list = LIST.matcher(m.group(3));
			if (list.find()) add(m.group(1), Kind.VALUE, m.group(2), list.group(1), m.group(3).replace(list.group(0), ""));
			return;
		}
		m = CONST.matcher(line);
		if (m.matches()) {
			Matcher list = LIST.matcher(m.group(4));
			if (list.find()) add(m.group(2), Kind.CONST, m.group(3), list.group(1), m.group(4).replace(list.group(0), ""));
			return;
		}
		m = BOOL.matcher(line);
		if (m.matches()) {
			String name = m.group(2);
			// An include guard (#ifndef X / #define X) is not a setting.
			if (!tested.contains(name) || prev.matches("#\\s*ifndef\\s+" + name + "\\b.*")) return;
			add(name, Kind.BOOL, m.group(1) == null ? "true" : "false", "", m.group(3) == null ? "" : m.group(3));
		}
	}

	private final Set<String> ambiguous = new HashSet<>();

	private void add(String name, Kind kind, String def, String list, String comment) {
		if (ambiguous.contains(name)) return;
		Option prev = all.get(name);
		if (prev != null) {
			// Defined with different defaults in different files (like a per-dimension switch): not a user setting.
			if (prev.kind != kind || !prev.def.equals(def)) {
				all.remove(name);
				ambiguous.add(name);
			}
			return;
		}
		List<String> vals = new ArrayList<>();
		if (kind != Kind.BOOL) {
			for (String v : list.trim().split("\\s+")) if (!v.isEmpty() && !v.equals("...") && !vals.contains(v)) vals.add(v);
			if (!vals.contains(def)) vals.addFirst(def);
		}
		all.put(name, new Option(name, kind, def, vals, comment.replaceAll("^[\\s/\\-]+|\\s+$", "")));
	}

	/** Applies one saved value, ignoring names and values the pack doesn't offer. */
	public void set(String name, String value) {
		Option o = all.get(name);
		if (o == null) return;
		if (o.kind == Kind.BOOL ? value.equals("true") || value.equals("false") : o.values.contains(value)) values.put(name, value);
	}

	/** Rewrites a source line so the GLSL compiler sees the chosen values. */
	public String apply(String line) {
		if (!line.contains("#define") && !line.contains("const")) return line;
		Matcher m = VALUE.matcher(line);
		if (m.matches()) {
			String v = chosen(m.group(1), Kind.VALUE);
			return v == null ? line : line.substring(0, m.start(2)) + v + line.substring(m.end(2));
		}
		m = CONST.matcher(line);
		if (m.matches()) {
			String v = chosen(m.group(2), Kind.CONST);
			return v == null ? line : line.substring(0, m.start(3)) + v + line.substring(m.end(3));
		}
		m = BOOL.matcher(line);
		if (m.matches()) {
			String v = chosen(m.group(2), Kind.BOOL);
			if (v == null) return line;
			String rest = line.substring(line.indexOf("#define"));
			return v.equals("true") ? rest : "//" + rest;
		}
		return line;
	}

	private @Nullable String chosen(String name, Kind kind) {
		Option o = all.get(name);
		return o == null || o.kind != kind ? null : values.get(name);
	}

	/** Macros for preprocessing shaders.properties and evaluating program.*.enabled. */
	public Map<String, String> macros() {
		Map<String, String> m = new LinkedHashMap<>();
		values.forEach((k, v) -> {
			Option o = all.get(k);
			if (o.kind == Kind.BOOL) {
				if (v.equals("true")) m.put(k, "1");
			} else m.put(k, v);
		});
		return m;
	}

	/** Profile tokens: NAME, !NAME, NAME=VALUE and profile.OTHER (inherited first). */
	public static Map<String, String> profile(Map<String, String> props, String name, int depth) {
		Map<String, String> out = new LinkedHashMap<>();
		String def = props.get("profile." + name);
		if (def == null || depth > 8) return out;
		for (String t : def.trim().split("\\s+")) {
			if (t.isEmpty()) continue;
			if (t.startsWith("profile.")) out.putAll(profile(props, t.substring(8), depth + 1));
			else if (t.startsWith("!")) out.put(t.substring(1), "false");
			else if (t.contains("=") || t.contains(":")) {
				int i = t.contains("=") ? t.indexOf('=') : t.indexOf(':');
				out.put(t.substring(0, i), t.substring(i + 1));
			} else out.put(t, "true");
		}
		return out;
	}
}
