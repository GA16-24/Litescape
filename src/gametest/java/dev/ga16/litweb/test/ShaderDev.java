package dev.ga16.litweb.test;

import com.sun.net.httpserver.HttpServer;
import dev.ga16.litweb.client.shaders.ShaderApi;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.Executors;

/** Serves /api/shaders without Minecraft for web-dev/serve.mjs: ./gradlew shaderDev [-Ppacks=dir] */
public final class ShaderDev {
	public static void main(String[] args) throws Exception {
		int port = Integer.parseInt(args[0]);
		ShaderApi api = new ShaderApi(Path.of(args[1]), Path.of(args[2]), "26.3", dir -> {
			try {
				java.awt.Desktop.getDesktop().open(dir.toFile());
			} catch (Exception e) {
				throw new IllegalStateException("Can't open folders here. The packs are in " + dir);
			}
		});
		HttpServer server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), port), 0);
		server.setExecutor(Executors.newFixedThreadPool(4));
		server.createContext("/", ex -> {
			try (ex) {
				Map<String, String> q = new HashMap<>();
				String raw = ex.getRequestURI().getRawQuery();
				if (raw != null) for (String kv : raw.split("&")) {
					int i = kv.indexOf('=');
					if (i > 0) q.put(URLDecoder.decode(kv.substring(0, i), StandardCharsets.UTF_8), URLDecoder.decode(kv.substring(i + 1), StandardCharsets.UTF_8));
				}
				ShaderApi.Response r;
				try {
					r = api.handle(ex.getRequestMethod(), ex.getRequestURI().getPath(), q, ex.getRequestBody().readAllBytes());
				} catch (Exception e) {
					com.google.gson.JsonObject o = new com.google.gson.JsonObject();
					o.addProperty("error", String.valueOf(e.getMessage()));
					r = new ShaderApi.Response(500, "application/json", o.toString().getBytes(StandardCharsets.UTF_8));
				}
				if (r == null) r = new ShaderApi.Response(404, "application/json", "{\"error\":\"Not found\"}".getBytes(StandardCharsets.UTF_8));
				ex.getResponseHeaders().set("Content-Type", r.type());
				ex.sendResponseHeaders(r.code(), r.body().length);
				ex.getResponseBody().write(r.body());
			}
		});
		server.start();
		System.out.println("shader api on http://127.0.0.1:" + port + "/api/shaders");
	}
}
