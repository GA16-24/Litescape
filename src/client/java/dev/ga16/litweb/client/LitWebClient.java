package dev.ga16.litweb.client;

import dev.ga16.litweb.LitWeb;
import dev.ga16.litweb.Net.Reply;
import java.net.URI;
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
				mc.player.sendSystemMessage(Component.literal("Litematica Web Viewer: ")
					.append(Component.literal(WebServer.url()).withStyle(s -> s.withClickEvent(new ClickEvent.OpenUrl(URI.create(WebServer.url())))
						.withColor(ChatFormatting.AQUA).withUnderlined(true)))
					.append(Component.literal(" (or /litweb)").withStyle(ChatFormatting.GRAY)));
			}
		});
		ClientPlayConnectionEvents.DISCONNECT.register((handler, mc) -> {
			Bridge.reset();
			WebServer.regionRead = null;
		});
		ClientCommandRegistrationCallback.EVENT.register((dispatcher, registries) -> dispatcher.register(
			ClientCommands.literal("litweb").executes(ctx -> {
				Blaze3D.openUri(URI.create(WebServer.url()));
				ctx.getSource().sendFeedback(Component.literal("Opened " + WebServer.url()));
				return 1;
			})));
	}
}
