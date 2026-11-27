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
//? if >=26.1 {
import net.fabricmc.fabric.api.client.command.v2.ClientCommands;
//?} else
//import net.fabricmc.fabric.api.client.command.v2.ClientCommandManager;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientLifecycleEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.network.chat.ClickEvent;
import net.minecraft.network.chat.Component;
import net.minecraft.ChatFormatting;
//? if >=26.3 {
import com.mojang.blaze3d.Blaze3D;
//?} else {
/*import net.minecraft.util.Util;
*///?}

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
		//? if >=26.3 {
		BlockTable.init(); // for the desktop app, which needs it with or without Litematica
		//?}
		if (!Schematics.LITEMATICA && !Schematics.BUILDPRINT) {
			LitWeb.LOG.warn("Neither Litematica nor BuildPrint is installed; the web viewer is disabled on this client");
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
				Component message = Component.literal("Litescape: ")
					.append(Component.literal(WebServer.url()).withStyle(s -> s.withClickEvent(runLitweb()).withColor(ChatFormatting.AQUA).withUnderlined(true)))
					.append(Component.translatable("litweb.chat.or_command").withStyle(ChatFormatting.GRAY));
				//? if >=26.1 {
				mc.player.sendSystemMessage(message);
				//?} else
				//mc.player.displayClientMessage(message, false);
			}
		});
		ClientPlayConnectionEvents.DISCONNECT.register((handler, mc) -> {
			Bridge.reset();
			WebServer.regionRead = null;
		});
		ClientCommandRegistrationCallback.EVENT.register((dispatcher, registries) -> dispatcher.register(
			//? if >=26.1 {
			ClientCommands.literal("litweb").executes(ctx -> {
			//?} else
			//ClientCommandManager.literal("litweb").executes(ctx -> {
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
			openUri(web);
			return false;
		}
		long asked = System.currentTimeMillis();
		openUri(URI.create("litescape://open"));
		// If the app never connects (uninstalled, or the link isn't registered), forget it and use the browser.
		CompletableFuture.delayedExecutor(10, TimeUnit.SECONDS).execute(() -> {
			if (appSeen >= asked) return;
			try {
				Files.deleteIfExists(APP_MARKER);
			} catch (IOException e) {
				LitWeb.LOG.warn("Could not forget the desktop app", e);
			}
			openUri(web);
		});
		return true;
	}

	private static ClickEvent runLitweb() {
		//? if >=1.21.5 {
		return new ClickEvent.RunCommand("litweb");
		//?} else
		//return new ClickEvent(ClickEvent.Action.RUN_COMMAND, "/litweb");
	}

	private static void openUri(URI uri) {
		//? if >=26.3 {
		Blaze3D.openUri(uri);
		//?} else {
		/*Util.getPlatform().openUri(uri);
		*///?}
	}
}
