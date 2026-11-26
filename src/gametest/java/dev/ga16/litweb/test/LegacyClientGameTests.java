package dev.ga16.litweb.test;

import net.fabricmc.api.ClientModInitializer;

/** Fabric API before 1.21.4 has no client game tests; there, with -Dfabric.client.gametest, this runs EndToEndTest itself. */
public class LegacyClientGameTests implements ClientModInitializer {
	@Override
	public void onInitializeClient() {
		//? if <1.21.4
		//if (System.getProperty("fabric.client.gametest") != null) dev.ga16.litweb.test.legacy.ClientGameTests.start(new EndToEndTest());
	}
}
