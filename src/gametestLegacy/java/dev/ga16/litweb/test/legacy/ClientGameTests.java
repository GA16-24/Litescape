package dev.ga16.litweb.test.legacy;

import java.util.concurrent.CompletionException;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.function.Predicate;
import java.util.function.Supplier;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.minecraft.client.CloudStatus;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.GenericMessageScreen;
import net.minecraft.client.gui.screens.LevelLoadingScreen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.client.gui.screens.worldselection.CreateWorldScreen;
import net.minecraft.client.gui.screens.worldselection.WorldCreationUiState;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.contents.TranslatableContents;
import net.minecraft.client.tutorial.TutorialSteps;
import net.minecraft.server.MinecraftServer;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.level.GameRules;
import net.minecraft.world.level.levelgen.presets.WorldPresets;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The part of Fabric's client game test API that EndToEndTest uses, for Minecraft before 1.21.4, whose Fabric API
 * doesn't have it. The test runs on its own thread and reaches the game through the client and server task queues.
 * Worlds are made the way Fabric's TestWorldBuilder makes them, so the test sees the same flat world on every version.
 */
public final class ClientGameTests {
	private static final Logger LOG = LoggerFactory.getLogger("litweb-gametest");
	private static final int WORLD_LOAD_TICKS = 20 * 60 * 5;
	private static volatile long ticks;

	public interface FabricClientGameTest {
		void runTest(ClientGameTestContext ctx);
	}

	/** Runs the test once the game has finished loading, then quits: exit code 0 if it passed, 1 if not. */
	public static void start(FabricClientGameTest test) {
		ClientTickEvents.END_CLIENT_TICK.register(new ClientTickEvents.EndTick() {
			private boolean started;

			@Override
			public void onEndTick(Minecraft mc) {
				ticks++;
				if (started || mc.getOverlay() != null || mc.screen == null) return;
				started = true;
				// The options Fabric's runner sets: no tutorial or onboarding, no clouds or sound, and a short render
				// distance so chunk rendering finishes sooner.
				mc.options.tutorialStep = TutorialSteps.NONE;
				mc.options.onboardAccessibility = false;
				mc.options.cloudStatus().set(CloudStatus.OFF);
				mc.options.renderDistance().set(5);
				mc.options.getSoundSourceOptionInstance(SoundSource.MASTER).set(0.0);
				Thread thread = new Thread(() -> {
					try {
						test.runTest(new ClientGameTestContext(mc));
					} catch (Throwable t) {
						LOG.error("Client gametests failed with an exception", t);
						System.exit(1);
					}
					mc.execute(mc::stop);
				}, "Test thread");
				thread.setDaemon(true);
				thread.start();
			}
		});
	}

	public static final class ClientGameTestContext {
		private final Minecraft mc;

		ClientGameTestContext(Minecraft mc) {
			this.mc = mc;
		}

		public void runOnClient(Consumer<Minecraft> action) {
			computeOnClient(c -> {
				action.accept(c);
				return null;
			});
		}

		public <T> T computeOnClient(Function<Minecraft, T> fn) {
			return join(() -> mc.submit(() -> fn.apply(mc)).join());
		}

		public void waitTicks(int n) {
			long until = ticks + n;
			while (ticks < until) sleep();
		}

		public void waitFor(Predicate<Minecraft> done, int timeoutTicks) {
			long until = ticks + timeoutTicks;
			while (!computeOnClient(done::test)) {
				if (ticks > until) throw new AssertionError("Timed out after " + timeoutTicks + " ticks");
				waitTicks(1);
			}
		}

		public void takeScreenshot(String name) {
			runOnClient(c -> Screenshot.grab(c.gameDirectory, name + ".png", c.getMainRenderTarget(), message -> {}));
		}

		public WorldBuilder worldBuilder() {
			return new WorldBuilder(this);
		}
	}

	public static final class WorldBuilder {
		private final ClientGameTestContext ctx;

		WorldBuilder(ClientGameTestContext ctx) {
			this.ctx = ctx;
		}

		/** A flat world on seed 1 without structures, daylight, weather or mob spawning, like Fabric's consistent settings. */
		public TestSingleplayerContext create() {
			ctx.runOnClient(mc -> {
				CreateWorldScreen.openFresh(mc, mc.screen);
				if (!(mc.screen instanceof CreateWorldScreen screen)) throw new AssertionError("CreateWorldScreen.openFresh didn't open it");
				WorldCreationUiState ui = screen.getUiState();
				ui.getNormalPresetList().stream().filter(e -> e.preset() != null && e.preset().is(WorldPresets.FLAT)).findFirst()
					.or(() -> ui.getAltPresetList().stream().filter(e -> e.preset() != null && e.preset().is(WorldPresets.FLAT)).findFirst())
					.ifPresentOrElse(ui::setWorldType, () -> { throw new AssertionError("No flat world preset"); });
				ui.setSeed("1");
				ui.setGenerateStructures(false);
				ui.getGameRules().getRule(GameRules.RULE_DAYLIGHT).set(false, null);
				ui.getGameRules().getRule(GameRules.RULE_WEATHER_CYCLE).set(false, null);
				ui.getGameRules().getRule(GameRules.RULE_DOMOBSPAWNING).set(false, null);
				press(screen, "selectWorld.create");
			});
			ctx.waitFor(mc -> mc.level != null && !(mc.screen instanceof LevelLoadingScreen), WORLD_LOAD_TICKS);
			return new TestSingleplayerContext(ctx, ctx.computeOnClient(Minecraft::getSingleplayerServer));
		}

		private static void press(CreateWorldScreen screen, String key) {
			for (var child : screen.children()) {
				if (child instanceof Button b && b.getMessage().getContents() instanceof TranslatableContents t && t.getKey().equals(key)) {
					b.onPress();
					return;
				}
			}
			throw new AssertionError("No " + key + " button");
		}
	}

	public static final class TestSingleplayerContext implements AutoCloseable {
		private final ClientGameTestContext ctx;
		private final TestServerContext server;

		TestSingleplayerContext(ClientGameTestContext ctx, MinecraftServer server) {
			this.ctx = ctx;
			this.server = new TestServerContext(server);
		}

		public TestClientWorldContext getClientWorld() {
			return new TestClientWorldContext(ctx);
		}

		public TestServerContext getServer() {
			return server;
		}

		/** Leaves the world and waits until the integrated server has saved and stopped. */
		@Override
		public void close() {
			ctx.runOnClient(mc -> {
				if (mc.level != null) mc.level.disconnect();
				mc.disconnect(new GenericMessageScreen(Component.translatable("menu.savingLevel")));
			});
			ctx.waitFor(mc -> mc.getSingleplayerServer() == null && mc.level == null, WORLD_LOAD_TICKS);
			ctx.runOnClient(mc -> mc.setScreen(new TitleScreen()));
		}
	}

	public static final class TestClientWorldContext {
		private final ClientGameTestContext ctx;

		TestClientWorldContext(ClientGameTestContext ctx) {
			this.ctx = ctx;
		}

		public void waitForChunksRender() {
			ctx.waitFor(mc -> mc.level != null && mc.levelRenderer.hasRenderedAllSections(), WORLD_LOAD_TICKS);
		}
	}

	public static final class TestServerContext {
		private final MinecraftServer server;

		TestServerContext(MinecraftServer server) {
			this.server = server;
		}

		public void runCommand(String command) {
			runOnServer(s -> s.getCommands().performPrefixedCommand(s.createCommandSourceStack(), command));
		}

		public void runOnServer(Consumer<MinecraftServer> action) {
			computeOnServer(s -> {
				action.accept(s);
				return null;
			});
		}

		public <T> T computeOnServer(Function<MinecraftServer, T> fn) {
			return join(() -> server.submit(() -> fn.apply(server)).join());
		}
	}

	/** Rethrows what failed on the game thread, so a failed check reads the same as in Fabric's runner. */
	private static <T> T join(Supplier<T> call) {
		try {
			return call.get();
		} catch (CompletionException e) {
			if (e.getCause() instanceof RuntimeException r) throw r;
			if (e.getCause() instanceof Error err) throw err;
			throw e;
		}
	}

	private static void sleep() {
		try {
			Thread.sleep(1);
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
			throw new AssertionError("Interrupted", e);
		}
	}

	private ClientGameTests() {}
}
