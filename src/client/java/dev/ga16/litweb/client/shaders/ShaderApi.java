package dev.ga16.litweb.client.shaders;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;
import org.jspecify.annotations.Nullable;

/** The /api/shaders endpoints. Free of Minecraft classes so the web dev server can run it on its own. */
public final class ShaderApi {
	public record Response(int code, String type, byte[] body) {}

	/** Popular packs offered for one-click download, in the order shown. {modrinth slug, name, author, words to spot it locally}. */
	static final List<String[]> FEATURED = List.of(
		new String[] {"complementary-reimagined", "Complementary Reimagined", "EminGT", "complementaryreimagined"},
		new String[] {"bsl-shaders", "BSL Shaders", "capttatsu", "bsl"},
		new String[] {"complementary-unbound", "Complementary Unbound", "EminGT", "complementaryunbound"},
		new String[] {"makeup-ultra-fast-shaders", "MakeUp Ultra Fast", "XavierFST", "makeup"},
		new String[] {"sildurs-vibrant-shaders", "Sildur's Vibrant Shaders", "Sildur", "sildursvibrant"},
		new String[] {"solas-shader", "Solas Shader", "Septonious", "solas"},
		new String[] {"super-duper-vanilla", "Super Duper Vanilla", "Eldeston", "superdupervanilla"});
	private static final long MAX_DOWNLOAD = 64L << 20;

	private final Path packsDir, settingsFile;
	private final String mcVersion;
	private final Consumer<Path> openFolder;
	private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).followRedirects(HttpClient.Redirect.NORMAL).build();
	private volatile @Nullable Pack lastPack;
	private volatile @Nullable JsonArray featuredCache;
	private volatile long featuredAt;

	public ShaderApi(Path packsDir, Path settingsFile, String mcVersion, Consumer<Path> openFolder) {
		this.packsDir = packsDir;
		this.settingsFile = settingsFile;
		this.mcVersion = mcVersion;
		this.openFolder = openFolder;
	}

	public @Nullable Response handle(String method, String path, Map<String, String> q, byte[] body) throws Exception {
		boolean post = method.equals("POST");
		return switch (path) {
			case "/api/shaders" -> json(index());
			case "/api/shaders/featured" -> json(featured());
			case "/api/shaders/install" -> post ? json(install(q.getOrDefault("slug", ""))) : error(405, "Use POST");
			case "/api/shaders/load" -> post ? json(load(JsonParser.parseString(new String(body, StandardCharsets.UTF_8)).getAsJsonObject())) : error(405, "Use POST");
			case "/api/shaders/settings" -> post ? json(saveSettings(body)) : error(405, "Use POST");
			case "/api/shaders/open-folder" -> {
				if (!post) yield error(405, "Use POST");
				Files.createDirectories(packsDir);
				openFolder.accept(packsDir);
				yield json(new JsonObject());
			}
			case "/api/shaders/file" -> file(q.getOrDefault("pack", ""), q.getOrDefault("path", ""));
			default -> null;
		};
	}

	private JsonObject index() throws IOException {
		JsonObject o = new JsonObject();
		o.addProperty("dir", packsDir.toAbsolutePath().toString());
		JsonArray packs = new JsonArray();
		for (String id : Pack.list(packsDir)) {
			JsonObject p = new JsonObject();
			p.addProperty("id", id);
			p.addProperty("name", displayName(id));
			String f = featuredSlug(id);
			if (f != null) p.addProperty("slug", f);
			packs.add(p);
		}
		o.add("packs", packs);
		o.add("settings", settings());
		JsonArray featured = new JsonArray();
		for (String[] f : FEATURED) featured.add(featuredJson(f));
		o.add("featured", featured);
		return o;
	}

	/** Known packs get their real name plus the version from the file ("MakeUp Ultra Fast 9.6a"); others lose the .zip and underscores. */
	static String displayName(String id) {
		String base = id.replaceFirst("(?i)\\.zip$", "");
		String slug = featuredSlug(id);
		if (slug != null) {
			java.util.regex.Matcher v = java.util.regex.Pattern.compile("(?i)[vr]?\\d+(?:\\.\\d+)+[a-z]?").matcher(base);
			String name = FEATURED.stream().filter(f -> f[0].equals(slug)).findFirst().orElseThrow()[1];
			return v.find() ? name + " " + base.substring(v.start()).replace('_', ' ').strip() : name; // keeps editions like "v2.02 Extreme"
		}
		String n = base.replace('_', ' ').replaceAll("\\s+", " ").strip();
		return n.isEmpty() ? id : n;
	}

	private static @Nullable String featuredSlug(String id) {
		String key = id.toLowerCase().replaceAll("[^a-z0-9]", "");
		for (String[] f : FEATURED) if (key.contains(f[3])) return f[0];
		return null;
	}

	private static JsonObject featuredJson(String[] f) {
		JsonObject o = new JsonObject();
		o.addProperty("slug", f[0]);
		o.addProperty("name", f[1]);
		o.addProperty("author", f[2]);
		return o;
	}

	/** Live download counts and icons from Modrinth, cached for an hour. Falls back to names only. */
	private JsonObject featured() {
		JsonObject o = new JsonObject();
		JsonArray cached = featuredCache;
		if (cached == null || System.currentTimeMillis() - featuredAt > 3_600_000) {
			try {
				StringBuilder ids = new StringBuilder("[");
				for (String[] f : FEATURED) ids.append(ids.length() > 1 ? "," : "").append('"').append(f[0]).append('"');
				String url = "https://api.modrinth.com/v2/projects?ids=" + java.net.URLEncoder.encode(ids.append(']').toString(), StandardCharsets.UTF_8);
				JsonArray res = JsonParser.parseString(get(url)).getAsJsonArray();
				JsonArray out = new JsonArray();
				for (String[] f : FEATURED) {
					JsonObject j = featuredJson(f);
					for (JsonElement e : res) {
						JsonObject p = e.getAsJsonObject();
						if (!f[0].equals(str(p, "slug"))) continue;
						j.addProperty("description", str(p, "description"));
						j.addProperty("icon", str(p, "icon_url"));
						if (p.has("downloads")) j.addProperty("downloads", p.get("downloads").getAsLong());
					}
					out.add(j);
				}
				featuredCache = cached = out;
				featuredAt = System.currentTimeMillis();
			} catch (Exception e) {
				o.addProperty("offline", true);
			}
		}
		o.add("featured", cached == null ? new JsonArray() : cached);
		return o;
	}

	/** Downloads a featured pack's newest Iris build from Modrinth into the shaderpacks folder. */
	private JsonObject install(String slug) throws Exception {
		if (FEATURED.stream().noneMatch(f -> f[0].equals(slug))) throw new IOException("Not a featured pack");
		JsonArray versions = JsonParser.parseString(get("https://api.modrinth.com/v2/project/" + slug + "/version")).getAsJsonArray();
		JsonObject file = null;
		// Prefer a build for this Minecraft version, else the newest one.
		for (int pass = 0; pass < 2 && file == null; pass++) {
			for (JsonElement e : versions) {
				JsonObject v = e.getAsJsonObject();
				boolean iris = v.getAsJsonArray("loaders").toString().contains("\"iris\"");
				boolean fits = v.getAsJsonArray("game_versions").toString().contains("\"" + mcVersion + "\"");
				if (!iris || pass == 0 && !fits) continue;
				for (JsonElement fe : v.getAsJsonArray("files")) {
					JsonObject f = fe.getAsJsonObject();
					if (file == null || f.get("primary").getAsBoolean()) file = f;
				}
				break;
			}
		}
		if (file == null) throw new IOException("Modrinth has no Iris build of this pack");
		String url = str(file, "url"), name = str(file, "filename");
		URI uri = URI.create(url);
		if (!"https".equals(uri.getScheme()) || !"cdn.modrinth.com".equals(uri.getHost())) throw new IOException("Unexpected download location");
		if (name.isEmpty() || name.contains("/") || name.contains("\\") || name.startsWith(".") || !name.toLowerCase().endsWith(".zip")) throw new IOException("Unexpected file name");
		Files.createDirectories(packsDir);
		Path target = packsDir.resolve(name);
		if (!Files.exists(target)) {
			HttpResponse<InputStream> r = http.send(request(url), HttpResponse.BodyHandlers.ofInputStream());
			if (r.statusCode() != 200) throw new IOException("Download failed (" + r.statusCode() + ")");
			Path tmp = Files.createTempFile(packsDir, ".download", ".zip");
			try (InputStream in = r.body()) {
				byte[] data = in.readNBytes((int) MAX_DOWNLOAD + 1);
				if (data.length > MAX_DOWNLOAD) throw new IOException("Download is too large");
				Files.write(tmp, data);
				Pack.read(tmp, name); // throws unless it really is a shader pack
			} catch (IOException e) {
				Files.deleteIfExists(tmp);
				throw e;
			}
			Files.move(tmp, target, StandardCopyOption.ATOMIC_MOVE);
		}
		JsonObject o = new JsonObject();
		o.addProperty("id", name);
		return o;
	}

	private JsonObject load(JsonObject req) throws Exception {
		String id = str(req, "pack");
		Path p = Pack.resolve(packsDir, id);
		long stamp = Files.getLastModifiedTime(p).toMillis();
		Pack pack = lastPack;
		if (pack == null || !pack.id.equals(id) || pack.stamp != stamp) lastPack = pack = Pack.open(packsDir, id);
		Options opts = Options.scan(pack);
		JsonObject chosen = req.has("options") && req.get("options").isJsonObject() ? req.getAsJsonObject("options") : irisOptions(id);
		for (String k : chosen.keySet()) opts.set(k, chosen.get(k).getAsString());

		JsonObject out = Pipeline.build(pack, opts);
		JsonArray list = new JsonArray();
		for (Options.Option o : opts.all.values()) {
			JsonObject j = new JsonObject();
			j.addProperty("n", o.name);
			j.addProperty("t", o.kind == Options.Kind.BOOL ? "b" : "v");
			j.addProperty("d", o.def);
			j.addProperty("v", opts.values.get(o.name));
			if (o.kind != Options.Kind.BOOL) {
				JsonArray vals = new JsonArray();
				o.values.forEach(vals::add);
				j.add("vals", vals);
			}
			if (!o.comment.isEmpty()) j.addProperty("c", o.comment);
			list.add(j);
		}
		out.add("options", list);
		out.add("lang", Pipeline.lang(pack));
		return out;
	}

	/** Iris keeps a pack's settings in shaderpacks/<pack>.txt; start from those so the web view matches the game. */
	private JsonObject irisOptions(String id) {
		JsonObject o = new JsonObject();
		try {
			Path f = packsDir.resolve(id + ".txt");
			if (!Files.isRegularFile(f)) return o;
			for (String line : Files.readAllLines(f, StandardCharsets.UTF_8)) {
				int eq = line.indexOf('=');
				if (eq > 0 && !line.startsWith("#")) o.addProperty(line.substring(0, eq).strip(), line.substring(eq + 1).strip());
			}
		} catch (IOException ignored) {
			// unreadable: use the pack defaults
		}
		return o;
	}

	private JsonObject settings() {
		try {
			if (Files.isRegularFile(settingsFile)) return JsonParser.parseString(Files.readString(settingsFile)).getAsJsonObject();
		} catch (Exception ignored) {
			// corrupt or unreadable: start fresh
		}
		return new JsonObject();
	}

	private JsonObject saveSettings(byte[] body) throws IOException {
		if (body.length > 1 << 20) throw new IOException("Settings are too large");
		JsonObject o = JsonParser.parseString(new String(body, StandardCharsets.UTF_8)).getAsJsonObject();
		Files.createDirectories(settingsFile.getParent());
		Path tmp = settingsFile.resolveSibling(settingsFile.getFileName() + ".tmp");
		Files.writeString(tmp, o.toString());
		Files.move(tmp, settingsFile, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
		return new JsonObject();
	}

	private Response file(String id, String path) throws IOException {
		Pack pack = lastPack;
		if (pack == null || !pack.id.equals(id)) lastPack = pack = Pack.open(packsDir, id);
		byte[] b = pack.bytes(path);
		if (b == null) return error(404, "Not found");
		String type = path.toLowerCase().endsWith(".png") ? "image/png" : "application/octet-stream";
		return new Response(200, type, b);
	}

	private String get(String url) throws Exception {
		HttpResponse<String> r = http.send(request(url), HttpResponse.BodyHandlers.ofString());
		if (r.statusCode() != 200) throw new IOException("Modrinth answered " + r.statusCode());
		return r.body();
	}

	private static HttpRequest request(String url) {
		return HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(60)).header("User-Agent", "litematica-web-viewer").GET().build();
	}

	private static String str(JsonObject o, String k) {
		return o.has(k) && !o.get(k).isJsonNull() ? o.get(k).getAsString() : "";
	}

	private static Response json(JsonObject o) {
		return new Response(200, "application/json", o.toString().getBytes(StandardCharsets.UTF_8));
	}

	private static Response error(int code, String message) {
		JsonObject o = new JsonObject();
		o.addProperty("error", message);
		return new Response(code, "application/json", o.toString().getBytes(StandardCharsets.UTF_8));
	}
}
