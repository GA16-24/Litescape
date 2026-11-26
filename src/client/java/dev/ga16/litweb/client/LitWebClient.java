package dev.ga16.litweb.client;

import dev.ga16.litweb.LitWeb;
import dev.ga16.litweb.Net.Reply;
import java.io.IOException;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.command.v2.ClientCommandRegistrationCallback;
import net.fabricmc.fabric.api.client.command.v2.ClientCommands;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientLifecycleEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.network.chat.ClickEvent;
import net.minecraft.network.chat.Component;
import net.minecraft.ChatFormatting;
import com.mojang.blaze3d.Blaze3D;

public final class LitWebClient implements ClientModInitializer {
	private boolean announced;
	/** Exists once the desktop app has connected on this machine, so the game opens the app instead of a browser tab. */
	private static final Path APP_MARKER = FabricLoader.getInstance().getConfigDir().resolve("litweb-desktop-app");
	private static volatile long appSeen;

	/** The web app URL, or null when the viewer is disabled. */
	public static String url() {
		return WebServer.port == 0 ? null : WebServer.url();
	}

	@Override
	public void onInitializeClient() {
		if (!FabricLoader.getInstance().isModLoaded("litematica")) {
			LitWeb.LOG.warn("Litematica is not installed; the web viewer is disabled on this client");
			return;
		}
		WebServer.start();
		if (WebServer.port == 0) return;
		ClientLifecycleEvents.CLIENT_STOPPING.register(mc -> WebServer.stop());
		ClientPlayNetworking.registerGlobalReceiver(Reply.TYPE, (reply, ctx) -> Bridge.onReply(reply));
		ClientPlayConnectionEvents.JOIN.register((handler, sender, mc) -> {
			if (Bridge.serverMod()) Bridge.refreshList();
			if (!announced && mc.player != null) {
				announced = true;
				mc.player.sendSystemMessage(Component.literal("Litescape: ")
					.append(Component.literal(WebServer.url()).withStyle(s -> s.withClickEvent(new ClickEvent.RunCommand("litweb"))
						.withColor(ChatFormatting.AQUA).withUnderlined(true)))
					.append(Component.translatable("litweb.chat.or_command").withStyle(ChatFormatting.GRAY)));
			}
		});
		ClientPlayConnectionEvents.DISCONNECT.register((handler, mc) -> {
			Bridge.reset();
			WebServer.regionRead = null;
		});
		ClientCommandRegistrationCallback.EVENT.register((dispatcher, registries) -> dispatcher.register(
			ClientCommands.literal("litweb").executes(ctx -> {
				ctx.getSource().sendFeedback(openViewer() ? Component.translatable("litweb.command.opening_app") : Component.translatable("litweb.command.opened", WebServer.url()));
				return 1;
			})));
	}

	/** Called for each request from the desktop app, which polls every 2 seconds while it runs. */
	static void appSeen() {
		appSeen = System.currentTimeMillis();
		if (Files.notExists(APP_MARKER)) try {
			Files.createFile(APP_MARKER);
		} catch (IOException e) {
			LitWeb.LOG.warn("Could not remember the desktop app", e);
		}
	}

	/** Opens the desktop app if it has been used here, else the browser. Returns whether it tried the app. */
	private static boolean openViewer() {
		URI web = URI.create(WebServer.url());
		if (Files.notExists(APP_MARKER)) {
			Blaze3D.openUri(web);
			return false;
		}
		long asked = System.currentTimeMillis();
		Blaze3D.openUri(URI.create("litescape://open"));
		// If the app never connects (uninstalled, or the link isn't registered), forget it and use the browser.
		CompletableFuture.delayedExecutor(10, TimeUnit.SECONDS).execute(() -> {
			if (appSeen >= asked) return;
			try {
				Files.deleteIfExists(APP_MARKER);
			} catch (IOException e) {
				LitWeb.LOG.warn("Could not forget the desktop app", e);
			}
			Blaze3D.openUri(web);
		});
		return true;
	}
}
