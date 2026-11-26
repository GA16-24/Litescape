package dev.ga16.litweb.client;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import dev.ga16.litweb.LitWeb;
import dev.ga16.litweb.Volume;
import dev.ga16.litweb.client.shaders.ShaderApi;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.BindException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import java.util.zip.GZIPOutputStream;
import java.util.zip.InflaterInputStream;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.core.BlockPos;
import net.minecraft.resources.Identifier;
import org.jspecify.annotations.Nullable;

/** Local HTTP server for the web app. Binds to loopback only. */
final class WebServer {
	static final int CLIENT_READ_MAX = 4_194_304;
	private static final Minecraft mc = Minecraft.getInstance();
	static int port;
	private static @Nullable HttpServer server;
	/** null until the server has answered a region read; reset on disconnect. */
	static volatile @Nullable Boolean regionRead;

	/**
	 * terrainFrom: first palette index of the surroundings (-1 = none); inner: the schematic's box inside volume;
	 * contents: what its chests and hoppers hold, when the share came with its Litematica placement.
	 */
	private record Cached(String key, Volume volume, int terrainFrom, int @Nullable [] inner, @Nullable JsonObject contents) {
		Cached(String key, Volume volume) {
			this(key, volume, -1, null, null);
		}
	}
	/** Iris shader packs for the web renderer; uses the same shaderpacks folder as Iris. */
	private static final ShaderApi shaders = new ShaderApi(
		net.fabricmc.loader.api.FabricLoader.getInstance().getGameDir().resolve("shaderpacks"),
		net.fabricmc.loader.api.FabricLoader.getInstance().getConfigDir().resolve("litweb-shaders.json"),
		net.fabricmc.loader.api.FabricLoader.getInstance().getModContainer("minecraft").map(m -> m.getMetadata().getVersion().getFriendlyString()).orElse(""),
		dir -> mc.execute(() -> com.mojang.blaze3d.Blaze3D.openPath(dir)));
	private static volatile @Nullable Cached placementCache, sharedCache;

	static void start() {
		for (int p = 8723; p < 8733; p++) {
			try {
				server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), p), 0);
				server.setExecutor(Executors.newFixedThreadPool(8, r -> {
					Thread t = new Thread(r, "litweb-http");
					t.setDaemon(true);
					return t;
				}));
				server.createContext("/", WebServer::handle);
				server.start();
				port = p;
				LitWeb.LOG.info("Litescape at http://127.0.0.1:{}/", p);
				return;
			} catch (BindException e) {
				// port taken, try the next one
			} catch (IOException e) {
				LitWeb.LOG.error("Could not start the web viewer", e);
				return;
			}
		}
		LitWeb.LOG.error("Could not start the web viewer: ports 8723-8732 are all in use");
	}

	/** The dispatcher thread is not a daemon, so the game can't exit until this runs. */
	static void stop() {
		if (server != null) server.stop(0);
	}

	static String url() {
		return "http://127.0.0.1:" + port + "/";
	}

	private static void handle(HttpExchange ex) throws IOException {
		try (ex) {
			String host = ex.getRequestHeaders().getFirst("Host");
			String origin = ex.getRequestHeaders().getFirst("Origin");
			// Blocks DNS rebinding (Host) and cross-site POSTs (Origin) from other web pages.
			if (host == null || !(host.equals("127.0.0.1:" + port) || host.equals("localhost:" + port))
				|| origin != null && !(origin.equals("http://127.0.0.1:" + port) || origin.equals("http://localhost:" + port))) {
				send(ex, 403, "text/plain", "Forbidden".getBytes(StandardCharsets.UTF_8));
				return;
			}
			if (ex.getRequestHeaders().containsKey("X-Litescape-App")) LitWebClient.appSeen();
			String path = ex.getRequestURI().getPath();
			Map<String, String> q = query(ex.getRequestURI().getRawQuery());
			boolean post = ex.getRequestMethod().equals("POST");
			try {
				switch (path) {
					case "/api/state" -> json(ex, 200, onClient(WebServer::state));
					case "/api/view" -> json(ex, 200, view(q.getOrDefault("type", ""), q.getOrDefault("id", ""), q.getOrDefault("server", "")));
					case "/api/status" -> json(ex, 200, status(q.getOrDefault("type", ""), q.getOrDefault("id", "")));
					case "/api/share" -> {
						if (!post) throw new HttpError(405, "Use POST");
						json(ex, 200, share(q.getOrDefault("id", ""), margin(q), q.get("at")));
					}
					case "/api/load" -> {
						// Adds someone's shared schematic to this player's Litematica, at its shared position.
						if (!post) throw new HttpError(405, "Use POST");
						if (!Schematics.LITEMATICA) throw new HttpError(409, "Loading a shared schematic needs Litematica");
						String id = q.getOrDefault("id", "");
						byte[] blob = await(Bridge.request("placement", id, new byte[0]));
						onClient(() -> {
							try {
								Lit.loadShared(id, blob);
							} catch (IOException e) {
								throw new IllegalStateException(e.getMessage(), e);
							}
							return null;
						});
						json(ex, 200, new JsonObject());
					}
					case "/api/unload" -> {
						if (!post) throw new HttpError(405, "Use POST");
						String id = q.getOrDefault("id", "");
						if (Schematics.LITEMATICA) onClient(() -> {
							Lit.unloadShared(id);
							return null;
						});
						json(ex, 200, new JsonObject());
					}
					case "/api/capture" -> {
						if (!post) throw new HttpError(405, "Use POST");
						JsonObject body = new JsonObject();
						body.addProperty("id", q.getOrDefault("id", ""));
						body.addProperty("margin", margin(q));
						await(Bridge.request("capture", body.toString(), new byte[0]));
						json(ex, 200, new JsonObject());
					}
					case "/api/access" -> {
						if (!post) throw new HttpError(405, "Use POST");
						// {id, access: everyone | players | private, players: {uuid: name}}; the server validates it.
						JsonObject body = JsonParser.parseString(new String(ex.getRequestBody().readNBytes(64 << 10), StandardCharsets.UTF_8)).getAsJsonObject();
						await(Bridge.request("access", body.toString(), new byte[0]));
						json(ex, 200, new JsonObject());
					}
					case "/api/unshare" -> {
						if (!post) throw new HttpError(405, "Use POST");
						await(Bridge.request("delete", q.getOrDefault("id", ""), new byte[0]));
						json(ex, 200, new JsonObject());
					}
					default -> {
						ShaderApi.Response r = path.startsWith("/api/shaders")
							? shaders.handle(ex.getRequestMethod(), path, q, ex.getRequestBody().readNBytes(1 << 20)) : null;
						if (r != null) {
							ex.getResponseHeaders().set("Cache-Control", r.type().equals("application/json") ? "no-store" : "no-cache");
							send(ex, r.code(), r.type(), r.body());
						} else if (path.equals("/api/skin")) skin(ex, q.getOrDefault("uuid", ""));
						else if (path.startsWith("/tex/")) texture(ex, path.substring(5));
						else file(ex, path.equals("/") ? "/index.html" : path);
					}
				}
			} catch (HttpError e) {
				error(ex, e.code, e.getMessage());
			} catch (Exception e) {
				Throwable cause = e instanceof ExecutionException && e.getCause() != null ? e.getCause() : e;
				LitWeb.LOG.debug("Web request {} failed", path, cause);
				error(ex, 500, cause.getMessage() == null ? cause.toString() : cause.getMessage());
			}
		}
	}

	// ---- API ----

	private static JsonObject state() {
		JsonObject o = new JsonObject();
		ClientLevel level = mc.level;
		boolean inWorld = level != null && mc.player != null;
		o.addProperty("inWorld", inWorld);
		o.add("servers", Servers.json());
		if (!inWorld) return o;
		Servers.Id cur = Servers.current();
		if (cur != null) {
			JsonObject server = new JsonObject();
			server.addProperty("key", cur.key());
			server.addProperty("name", cur.name());
			server.addProperty("address", cur.address());
			o.add("server", server);
		}
		// Who can be picked when sharing with specific players.
		JsonArray online = new JsonArray();
		for (var info : mc.getConnection().getOnlinePlayers()) {
			if (info.getProfile().id().equals(mc.player.getUUID())) continue;
			JsonObject p = new JsonObject();
			p.addProperty("uuid", info.getProfile().id().toString());
			p.addProperty("name", info.getProfile().name());
			online.add(p);
		}
		o.add("online", online);
		String uuid = mc.player.getStringUUID();
		o.addProperty("player", mc.player.getPlainTextName());
		o.addProperty("dim", level.dimension().identifier().toString());
		o.addProperty("serverMod", Bridge.serverMod());
		o.addProperty("litematica", Schematics.LITEMATICA); // shared schematics load into Litematica
		o.addProperty("regionRead", regionRead == null ? "unknown" : regionRead ? "yes" : "no");
		o.addProperty("singleplayer", mc.hasSingleplayerServer());
		String terrain = Bridge.terrainJson;
		if (terrain != null) {
			JsonObject t = JsonParser.parseString(terrain).getAsJsonObject();
			t.add("y", ints(level.getMinY(), level.getMaxY())); // surroundings stop at the world's floor and ceiling
			o.add("terrain", t);
		}

		Schematics.Selection sel = Schematics.selection();
		if (sel != null) {
			JsonObject s = new JsonObject();
			s.addProperty("name", sel.name());
			s.add("boxes", boxes(sel.boxes()));
			o.add("selection", s);
		}

		JsonArray shared = JsonParser.parseString(Bridge.sharedJson).getAsJsonArray();
		java.util.Set<String> inGame = new java.util.HashSet<>();
		List<Schematics.Placement> placementList = Schematics.placements();
		for (Schematics.Placement p : placementList) if (p.shared() != null) inGame.add(p.shared());
		Map<String, JsonObject> sharedById = new HashMap<>();
		for (var e : shared) {
			JsonObject s = e.getAsJsonObject();
			s.addProperty("mine", s.get("owner").getAsString().equals(uuid));
			s.addProperty("inGame", inGame.contains(s.get("id").getAsString()));
			sharedById.put(s.get("id").getAsString(), s);
		}
		JsonArray placements = new JsonArray();
		for (Schematics.Placement p : placementList) {
			// Listed under the shared schematic it came from; once that's gone (unshared, access removed) it's just a placement.
			if (sharedById.containsKey(p.shared())) continue;
			JsonObject j = new JsonObject();
			String key = p.id();
			j.addProperty("id", key);
			j.addProperty("name", p.name());
			j.addProperty("enabled", p.enabled());
			j.addProperty("author", p.author());
			if (p.origin() != null) j.add("origin", ints(p.origin()));
			j.add("boxes", boxes(p.boxes()));
			String sharedId = sharedId(uuid, key);
			if (sharedById.containsKey(sharedId)) j.addProperty("sharedId", sharedId);
			placements.add(j);
		}
		o.add("placements", placements);
		o.add("shared", shared);
		return o;
	}

	private static String sharedId(String owner, String key) {
		return UUID.nameUUIDFromBytes((owner + ":" + key).getBytes(StandardCharsets.UTF_8)).toString();
	}

	private static JsonObject view(String type, String id, String serverKey) throws Exception {
		Volume v;
		Cached withTerrain = null;
		JsonObject contents = null;
		String source, name;
		switch (type) {
			case "selection" -> {
				Schematics.Selection sel = onClient(Schematics::selection);
				if (sel == null) throw new HttpError(404, "No area selection");
				if (sel.boxes().isEmpty()) throw new HttpError(404, "The selection has no complete boxes yet");
				name = sel.name();
				v = null;
				source = "server";
				if (onClient(Bridge::serverMod) && !Boolean.FALSE.equals(regionRead)) {
					try {
						v = Volume.decode(await(Bridge.request("region", "", LitWeb.writeBoxes(sel.boxes()))));
						regionRead = true;
					} catch (Exception e) {
						if (!"no-permission".equals(e.getMessage())) throw e;
						regionRead = false;
					}
				}
				if (v == null) {
					source = "client";
					v = onClient(() -> clientRead(sel.boxes()));
				}
			}
			case "placement" -> {
				source = "placement";
				Object[] r = onClient(() -> {
					Schematics.Placement p = Schematics.placement(id);
					return p == null ? null : new Object[] {p.name(), placementVolume(p), Schematics.LITEMATICA ? Lit.contents(id, mc.level.registryAccess()) : null};
				});
				if (r == null) throw new HttpError(404, "That placement no longer exists");
				name = (String) r[0];
				v = (Volume) r[1];
				contents = (JsonObject) r[2];
			}
			case "shared" -> {
				source = "shared";
				name = "";
				Servers.Id cur = onClient(Servers::current);
				if (serverKey.isEmpty() || cur != null && cur.key().equals(serverKey)) {
					withTerrain = sharedVolume(id, cur);
					v = withTerrain.volume();
					contents = withTerrain.contents();
				} else {
					// A remembered server: show the copy saved when it was last opened there.
					byte[] blob = Servers.blob(serverKey, id);
					if (blob == null) throw new HttpError(404, "not-saved");
					v = Volume.decode(blob);
				}
			}
			default -> throw new HttpError(400, "Unknown view type");
		}
		JsonObject out = new JsonObject();
		out.addProperty("type", type);
		out.addProperty("id", id);
		out.addProperty("name", name);
		out.addProperty("source", source);
		out.add("origin", ints(v.x0, v.y0, v.z0));
		out.add("size", ints(v.sx, v.sy, v.sz));
		if (withTerrain != null && withTerrain.inner() != null) {
			out.addProperty("terrainFrom", withTerrain.terrainFrom());
			out.add("inner", ints(withTerrain.inner()));
		}
		if (contents != null) out.add("contents", contents);
		ByteBuffer buf = ByteBuffer.allocate(v.blocks.length * 2).order(ByteOrder.LITTLE_ENDIAN);
		buf.asShortBuffer().put(v.blocks);
		out.addProperty("blocks", Base64.getEncoder().encodeToString(buf.array()));
		Volume fv = v;
		onClient(() -> {
			BlockPos center = new BlockPos(fv.x0 + fv.sx / 2, fv.y0 + fv.sy / 2, fv.z0 + fv.sz / 2);
			new Models(mc.level, center).export(fv.palette, out);
			return null;
		});
		return out;
	}

	private static JsonObject status(String type, String id) throws Exception {
		int[] counts = new int[6];
		byte[] st;
		switch (type) {
			case "placement" -> {
				st = onClient(() -> {
					Schematics.Placement p = Schematics.placement(id);
					if (p == null) return null;
					ClientLevel level = mc.level;
					return placementVolume(p).diff(pos -> level.hasChunk(pos.getX() >> 4, pos.getZ() >> 4) ? level.getBlockState(pos) : null, counts);
				});
				if (st == null) throw new HttpError(404, "That placement no longer exists");
			}
			case "shared" -> {
				byte[] blob = await(Bridge.request("status", id, new byte[0]));
				try (DataInputStream in = new DataInputStream(new InflaterInputStream(new java.io.ByteArrayInputStream(blob)))) {
					for (int i = 0; i < counts.length; i++) counts[i] = in.readInt();
					st = in.readAllBytes();
				}
			}
			default -> throw new HttpError(400, "Unknown status type");
		}
		JsonObject out = new JsonObject();
		out.add("counts", ints(counts));
		out.addProperty("status", Base64.getEncoder().encodeToString(st));
		return out;
	}

	/** at: "x,y,z" to move the placement's origin there first, or null to share it where it is. */
	private static JsonObject share(String key, int margin, @Nullable String at) throws Exception {
		BlockPos origin = null;
		if (at != null) {
			String[] xyz = at.split(",");
			try {
				if (xyz.length != 3) throw new NumberFormatException();
				origin = new BlockPos(Integer.parseInt(xyz[0].strip()), Integer.parseInt(xyz[1].strip()), Integer.parseInt(xyz[2].strip()));
			} catch (NumberFormatException e) {
				throw new HttpError(400, "Bad coordinates");
			}
		}
		BlockPos to = origin;
		Object[] r = onClient(() -> {
			Schematics.Placement p = Schematics.placement(key);
			if (p == null) return null;
			if (to != null) {
				String why = Schematics.LITEMATICA ? Lit.move(key, to) : "Only Litematica placements can be moved here";
				if (why != null) return new Object[] {why};
				p = Schematics.placement(key); // its boxes and version changed with the move
				if (p == null) return null;
			}
			try {
				byte[] placement = Schematics.LITEMATICA ? Lit.placementBlob(key) : null;
				return new Object[] {p.name(), placementVolume(p), p.author(), placement == null ? new byte[0] : placement};
			} catch (IOException e) {
				throw new IllegalStateException(e.getMessage(), e);
			}
		});
		if (r == null) throw new HttpError(404, "That placement no longer exists");
		if (r.length == 1) throw new HttpError(409, (String) r[0]);
		byte[] vol = ((Volume) r[1]).encode(), placement = (byte[]) r[3];
		byte[] blob = java.util.Arrays.copyOf(vol, vol.length + placement.length);
		System.arraycopy(placement, 0, blob, vol.length, placement.length);
		byte[] id = await(Bridge.upload(key, (String) r[0], (String) r[2], margin, placement.length, blob));
		JsonObject out = new JsonObject();
		out.addProperty("id", new String(id, StandardCharsets.UTF_8));
		return out;
	}

	/** Client thread. Unloaded chunks become unknown (null) voxels. */
	private static Volume clientRead(List<int[]> boxes) {
		int[] u = Volume.union(boxes);
		long volume = (long) (u[3] - u[0] + 1) * (u[4] - u[1] + 1) * (u[5] - u[2] + 1);
		if (volume > CLIENT_READ_MAX) throw new IllegalArgumentException("Selection is too large to read here (" + volume + " > " + CLIENT_READ_MAX + " blocks)");
		ClientLevel level = mc.level;
		Volume v = Volume.ofBoxes(boxes);
		v.fill(boxes, pos -> level.hasChunk(pos.getX() >> 4, pos.getZ() >> 4) ? level.getBlockState(pos) : null);
		return v;
	}

	/** Client thread. Rebuilding a big placement is slow, so keep the last one until it moves or changes. */
	private static Volume placementVolume(Schematics.Placement p) {
		String key = p.id() + p.version();
		Cached c = placementCache;
		if (c == null || !c.key.equals(key)) placementCache = c = new Cached(key, p.volume().get());
		return c.volume;
	}

	/** The shared schematic, set into its captured surroundings when it has them. */
	private static Cached sharedVolume(String id, Servers.@Nullable Id server) throws Exception {
		String version = "";
		int margin = 0;
		boolean hasPlacement = false;
		for (var e : JsonParser.parseString(Bridge.sharedJson).getAsJsonArray()) {
			JsonObject s = e.getAsJsonObject();
			if (!s.get("id").getAsString().equals(id)) continue;
			margin = s.has("margin") ? s.get("margin").getAsInt() : 0;
			hasPlacement = s.has("placement") && s.get("placement").getAsBoolean();
			version = s.get("updated").getAsString() + ":" + (s.has("captured") ? s.get("captured").getAsString() : "");
		}
		Cached c = sharedCache;
		if (c == null || !c.key.equals(id + version)) {
			byte[] blob = await(Bridge.request("get", id, new byte[0]));
			Volume v = Volume.decode(blob);
			c = new Cached(id + version, v);
			if (margin > 0) {
				Volume t = Volume.decode(await(Bridge.request("terrain", id, new byte[0])));
				Volume all = Volume.around(v, t);
				if (all != null) c = new Cached(id + version, all, v.palette.size(), new int[] {v.x0 - t.x0, v.y0 - t.y0, v.z0 - t.z0, v.sx, v.sy, v.sz}, null);
			}
			if (hasPlacement && Schematics.LITEMATICA) {
				try {
					byte[] placement = await(Bridge.request("placement", id, new byte[0]));
					JsonObject contents = onClient(() -> {
						try {
							return Lit.sharedContents(placement, mc.level.registryAccess());
						} catch (IOException e) {
							throw new IllegalStateException(e.getMessage(), e);
						}
					});
					c = new Cached(c.key, c.volume, c.terrainFrom, c.inner, contents);
				} catch (Exception e) {
					LitWeb.LOG.debug("No container contents for shared {}", id, e); // the blocks still show without them
				}
			}
			sharedCache = c;
			// shortcut: saved copies for other servers keep only the schematic; cache the terrain too if people miss it offline.
			if (server != null) Servers.saveBlob(server.key(), id, blob);
		}
		return c;
	}

	private static int margin(Map<String, String> q) throws HttpError {
		try {
			return Integer.parseInt(q.getOrDefault("margin", "0"));
		} catch (NumberFormatException e) {
			throw new HttpError(400, "Bad margin");
		}
	}

	// ---- player skins, for contributor faces ----

	private static final Map<UUID, byte[]> skins = new java.util.concurrent.ConcurrentHashMap<>();
	private static final java.net.http.HttpClient skinHttp = java.net.http.HttpClient.newBuilder().connectTimeout(java.time.Duration.ofSeconds(8)).build();

	private static void skin(HttpExchange ex, String id) throws Exception {
		UUID uuid;
		try {
			uuid = UUID.fromString(id);
		} catch (IllegalArgumentException e) {
			throw new HttpError(400, "Bad player id");
		}
		byte[] png = skins.get(uuid);
		if (png == null) skins.put(uuid, png = loadSkin(uuid));
		ex.getResponseHeaders().set("Cache-Control", "max-age=3600");
		send(ex, 200, "image/png", png);
	}

	/**
	 * The player's skin from Mojang, found the way the game finds skins for player heads (the online player list,
	 * else a profile lookup), or their default skin when there is none. The page crops the face.
	 */
	private static byte[] loadSkin(UUID uuid) throws Exception {
		com.mojang.authlib.GameProfile profile = onClient(() -> {
			var conn = mc.getConnection();
			var info = conn == null ? null : conn.getPlayerInfo(uuid);
			return info == null ? null : info.getProfile();
		});
		var session = mc.services().sessionService();
		try {
			if (profile == null || session.getTextures(profile).skin() == null) {
				var result = session.fetchProfile(uuid, false);
				if (result != null) profile = result.profile();
			}
			var tex = profile == null ? null : session.getTextures(profile).skin();
			if (tex != null) {
				URI url = URI.create(tex.getUrl().replaceFirst("^http:", "https:"));
				if ("textures.minecraft.net".equals(url.getHost())) {
					var r = skinHttp.send(java.net.http.HttpRequest.newBuilder(url).timeout(java.time.Duration.ofSeconds(10)).build(), java.net.http.HttpResponse.BodyHandlers.ofByteArray());
					if (r.statusCode() == 200) return r.body();
				}
			}
		} catch (Exception e) {
			LitWeb.LOG.debug("No skin for {}", uuid, e); // offline server or Mojang unreachable: use the default skin
		}
		Identifier path = net.minecraft.client.resources.DefaultPlayerSkin.get(uuid).body().texturePath();
		try (InputStream in = mc.getResourceManager().open(path)) {
			return in.readAllBytes();
		}
	}

	// ---- static files and textures ----

	private static void texture(HttpExchange ex, String path) throws IOException {
		// /tex/<namespace>/<path> where the sprite id is <namespace>:<path>
		int slash = path.indexOf('/');
		if (slash < 0 || path.contains("..")) throw new HttpError(404, "Not found");
		Identifier id = Identifier.tryBuild(path.substring(0, slash), "textures/" + path.substring(slash + 1) + ".png");
		if (id == null) throw new HttpError(404, "Not found");
		var res = mc.getResourceManager().getResource(id);
		if (res.isEmpty()) throw new HttpError(404, "Not found");
		try (InputStream in = res.get().open()) {
			ex.getResponseHeaders().set("Cache-Control", "no-cache");
			send(ex, 200, "image/png", in.readAllBytes());
		}
	}

	private static void file(HttpExchange ex, String path) throws IOException {
		if (path.contains("..")) throw new HttpError(404, "Not found");
		try (InputStream in = WebServer.class.getResourceAsStream("/web" + path)) {
			if (in == null) throw new HttpError(404, "Not found");
			String type = path.endsWith(".html") ? "text/html; charset=utf-8"
				: path.endsWith(".js") ? "text/javascript; charset=utf-8"
				: path.endsWith(".css") ? "text/css; charset=utf-8"
				: path.endsWith(".svg") ? "image/svg+xml" : "application/octet-stream";
			ex.getResponseHeaders().set("Cache-Control", "no-cache");
			send(ex, 200, type, in.readAllBytes());
		}
	}

	// ---- helpers ----

	private static final class HttpError extends IOException {
		private static final long serialVersionUID = 1L;

		final int code;

		HttpError(int code, String message) {
			super(message);
			this.code = code;
		}
	}

	private static <T> T onClient(Supplier<T> task) throws Exception {
		return mc.submit(task).get(30, TimeUnit.SECONDS);
	}

	private static byte[] await(java.util.concurrent.CompletableFuture<byte[]> f) throws Exception {
		try {
			return f.get();
		} catch (ExecutionException e) {
			throw e.getCause() instanceof Exception c ? c : e;
		}
	}

	private static JsonArray boxes(List<int[]> boxes) {
		JsonArray a = new JsonArray();
		for (int[] b : boxes) a.add(ints(b));
		return a;
	}

	private static JsonArray ints(int... v) {
		JsonArray a = new JsonArray();
		for (int i : v) a.add(i);
		return a;
	}

	private static Map<String, String> query(@Nullable String raw) {
		Map<String, String> m = new HashMap<>();
		if (raw == null) return m;
		for (String kv : raw.split("&")) {
			int i = kv.indexOf('=');
			if (i > 0) m.put(URLDecoder.decode(kv.substring(0, i), StandardCharsets.UTF_8), URLDecoder.decode(kv.substring(i + 1), StandardCharsets.UTF_8));
		}
		return m;
	}

	private static void json(HttpExchange ex, int code, JsonObject body) throws IOException {
		ex.getResponseHeaders().set("Cache-Control", "no-store");
		send(ex, code, "application/json", body.toString().getBytes(StandardCharsets.UTF_8));
	}

	private static void error(HttpExchange ex, int code, String message) throws IOException {
		JsonObject o = new JsonObject();
		o.addProperty("error", message);
		json(ex, code, o);
	}

	private static void send(HttpExchange ex, int code, String type, byte[] body) throws IOException {
		ex.getResponseHeaders().set("Content-Type", type);
		String accept = ex.getRequestHeaders().getFirst("Accept-Encoding");
		if (body.length > 1024 && accept != null && accept.contains("gzip") && !type.startsWith("image/")) {
			ByteArrayOutputStream z = new ByteArrayOutputStream();
			try (GZIPOutputStream gz = new GZIPOutputStream(z)) {
				gz.write(body);
			}
			body = z.toByteArray();
			ex.getResponseHeaders().set("Content-Encoding", "gzip");
		}
		ex.sendResponseHeaders(code, body.length);
		try (OutputStream out = ex.getResponseBody()) {
			out.write(body);
		}
	}

	private WebServer() {}
}
