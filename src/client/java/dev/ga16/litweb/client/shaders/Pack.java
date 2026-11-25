package dev.ga16.litweb.client.shaders;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import org.jspecify.annotations.Nullable;

/** A shader pack (zip or folder) read fully into memory. Paths are relative to its shaders/ folder. */
public final class Pack {
	private static final long MAX_BYTES = 64L << 20;
	public final String id;
	public final long stamp;
	private final Map<String, byte[]> files = new HashMap<>();

	private Pack(String id, long stamp) {
		this.id = id;
		this.stamp = stamp;
	}

	/** Pack ids are file names inside the shaderpacks folder; anything else is rejected. */
	public static Path resolve(Path dir, String id) throws IOException {
		if (id.isEmpty() || id.contains("/") || id.contains("\\") || id.startsWith(".")) throw new IOException("Unknown shader pack");
		Path p = dir.resolve(id);
		if (!p.normalize().getParent().equals(dir.normalize()) || !Files.exists(p)) throw new IOException("Unknown shader pack");
		return p;
	}

	public static List<String> list(Path dir) throws IOException {
		List<String> out = new ArrayList<>();
		if (!Files.isDirectory(dir)) return out;
		try (Stream<Path> s = Files.list(dir)) {
			for (Path p : s.sorted().toList()) {
				String n = p.getFileName().toString();
				if (n.startsWith(".")) continue;
				if (Files.isDirectory(p) ? Files.isDirectory(p.resolve("shaders")) : n.toLowerCase().endsWith(".zip")) out.add(n);
			}
		}
		return out;
	}

	public static Pack open(Path dir, String id) throws IOException {
		return read(resolve(dir, id), id);
	}

	static Pack read(Path p, String id) throws IOException {
		Pack pack = new Pack(id, Files.getLastModifiedTime(p).toMillis());
		long total = 0;
		if (Files.isDirectory(p)) {
			Path root = p.resolve("shaders");
			try (Stream<Path> s = Files.walk(root)) {
				for (Path f : s.filter(Files::isRegularFile).toList()) {
					total += Files.size(f);
					if (total > MAX_BYTES) throw new IOException("Shader pack is too large");
					pack.files.put(root.relativize(f).toString().replace('\\', '/'), Files.readAllBytes(f));
				}
			}
		} else {
			try (ZipFile zip = new ZipFile(p.toFile())) {
				String prefix = null;
				// Some zips wrap everything in one extra folder; find the shaders/ directory either way.
				for (ZipEntry e : zip.stream().toList()) {
					String n = e.getName();
					int i = n.indexOf("shaders/");
					if (i >= 0 && (i == 0 || n.charAt(i - 1) == '/') && n.substring(0, i).chars().filter(c -> c == '/').count() <= 1) {
						String pre = n.substring(0, i + 8);
						if (prefix == null || pre.length() < prefix.length()) prefix = pre;
					}
				}
				if (prefix == null) throw new IOException("This zip has no shaders folder, so it isn't a shader pack");
				for (ZipEntry e : zip.stream().toList()) {
					if (e.isDirectory() || !e.getName().startsWith(prefix)) continue;
					try (InputStream in = zip.getInputStream(e)) {
						byte[] data = in.readNBytes((int) (MAX_BYTES - total + 1)); // sizes in zip headers can lie
						total += data.length;
						if (total > MAX_BYTES) throw new IOException("Shader pack is too large");
						pack.files.put(e.getName().substring(prefix.length()), data);
					}
				}
			}
		}
		return pack;
	}

	public boolean has(String path) {
		return files.containsKey(normalize(path));
	}

	public byte @Nullable [] bytes(String path) {
		return files.get(normalize(path));
	}

	public @Nullable String text(String path) {
		byte[] b = bytes(path);
		if (b == null) return null;
		String s = new String(b, StandardCharsets.UTF_8);
		return s.startsWith("﻿") ? s.substring(1) : s;
	}

	/** Case-insensitive lookup, for lang files that ship as en_US.lang or en_us.lang. */
	public @Nullable String textIgnoreCase(String path) {
		for (String k : files.keySet()) if (k.equalsIgnoreCase(path)) return text(k);
		return null;
	}

	public Iterable<String> paths() {
		return files.keySet();
	}

	/** Resolves "." and ".." so includes like ../lib/x.glsl work; never escapes the pack. */
	public static String normalize(String path) {
		List<String> parts = new ArrayList<>();
		for (String s : path.replace('\\', '/').split("/")) {
			if (s.isEmpty() || s.equals(".")) continue;
			if (s.equals("..")) {
				if (!parts.isEmpty()) parts.removeLast();
			} else parts.add(s);
		}
		return String.join("/", parts);
	}
}
