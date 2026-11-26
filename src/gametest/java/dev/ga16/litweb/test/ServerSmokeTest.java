package dev.ga16.litweb.test;

import java.io.IOException;
import java.nio.file.Files;
import net.fabricmc.api.DedicatedServerModInitializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.loader.api.FabricLoader;

/** With -Dlitweb.serverSmokeTest=true, stops the dedicated server once it has started with the mod, leaving a marker the build checks. */
public class ServerSmokeTest implements DedicatedServerModInitializer {
	@Override
	public void onInitializeServer() {
		if (!Boolean.getBoolean("litweb.serverSmokeTest")) return;
		ServerLifecycleEvents.SERVER_STARTED.register(server -> {
			if (!FabricLoader.getInstance().isModLoaded("litweb")) throw new IllegalStateException("litweb is not loaded");
			try {
				Files.writeString(FabricLoader.getInstance().getGameDir().resolve("litweb-server-ok"), "");
			} catch (IOException e) {
				throw new RuntimeException(e);
			}
			server.halt(false);
		});
	}
}
