package dev.ga16.litweb.client;

import com.google.gson.JsonObject;
import dev.ga16.litweb.Net;
import dev.ga16.litweb.Net.Reply;
import dev.ga16.litweb.Net.Req;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.minecraft.client.Minecraft;

/** Request/reply over the two litweb packets. Replies arrive on the client thread. */
final class Bridge {
	private record Pending(CompletableFuture<byte[]> future, ByteArrayOutputStream buf) {}

	private static final Map<Integer, Pending> pending = new ConcurrentHashMap<>();
	private static final AtomicInteger nextReq = new AtomicInteger(1);
	/** Shared-schematic list JSON as last pushed by the server; "[]" when there is no server mod. */
	static volatile String sharedJson = "[]";
	private static final ByteArrayOutputStream pushed = new ByteArrayOutputStream();
	/** Serializes uploads: the server keeps one upload buffer per player. */
	private static CompletableFuture<?> uploadChain = CompletableFuture.completedFuture(null);

	/** Must be called on the client thread. */
	static boolean serverMod() {
		return Minecraft.getInstance().getConnection() != null && ClientPlayNetworking.canSend(Req.TYPE);
	}

	static CompletableFuture<byte[]> request(String op, String arg, byte[] data) {
		int req = nextReq.getAndIncrement();
		Pending p = new Pending(new CompletableFuture<>(), new ByteArrayOutputStream());
		pending.put(req, p);
		Minecraft.getInstance().execute(() -> {
			if (!serverMod()) p.future.completeExceptionally(new IllegalStateException("The server does not run Litematica Web Viewer"));
			else ClientPlayNetworking.send(new Req(req, op, arg, data));
		});
		return p.future.orTimeout(60, TimeUnit.SECONDS).whenComplete((r, e) -> pending.remove(req));
	}

	static synchronized CompletableFuture<byte[]> upload(String key, String name, String author, byte[] blob) {
		CompletableFuture<byte[]> result = uploadChain.handle((r, e) -> null).thenCompose(ignored -> {
			int req = nextReq.getAndIncrement();
			Pending p = new Pending(new CompletableFuture<>(), new ByteArrayOutputStream());
			pending.put(req, p);
			int parts = Math.max(1, (blob.length + Net.UP_PART - 1) / Net.UP_PART);
			Minecraft.getInstance().execute(() -> {
				if (!serverMod()) {
					p.future.completeExceptionally(new IllegalStateException("The server does not run Litematica Web Viewer"));
					return;
				}
				for (int i = 0; i < parts; i++) {
					JsonObject meta = new JsonObject();
					meta.addProperty("key", key);
					meta.addProperty("name", name);
					meta.addProperty("author", author);
					meta.addProperty("part", i);
					meta.addProperty("parts", parts);
					byte[] chunk = Arrays.copyOfRange(blob, i * Net.UP_PART, Math.min(blob.length, (i + 1) * Net.UP_PART));
					ClientPlayNetworking.send(new Req(req, "upload", meta.toString(), chunk));
				}
			});
			return p.future.orTimeout(120, TimeUnit.SECONDS).whenComplete((r, e) -> pending.remove(req));
		});
		uploadChain = result;
		return result;
	}

	static void onReply(Reply r) {
		if (r.req() == Net.PUSH_LIST) {
			// A list over one reply part arrives in several pushes.
			if (r.part() == 0) pushed.reset();
			pushed.writeBytes(r.data());
			if (r.part() == r.parts() - 1) sharedJson = pushed.toString(StandardCharsets.UTF_8);
			return;
		}
		Pending p = pending.get(r.req());
		if (p == null) return;
		if (!r.error().isEmpty()) {
			p.future.completeExceptionally(new IllegalStateException(r.error()));
			return;
		}
		p.buf.writeBytes(r.data());
		if (r.part() == r.parts() - 1) p.future.complete(p.buf.toByteArray());
	}

	static void reset() {
		sharedJson = "[]";
		pending.values().forEach(p -> p.future.completeExceptionally(new IllegalStateException("Disconnected")));
		pending.clear();
	}

	static void refreshList() {
		request("list", "", new byte[0]).thenAccept(b -> sharedJson = new String(b, StandardCharsets.UTF_8));
	}

	private Bridge() {}
}
