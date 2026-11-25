package dev.ga16.litweb.mixin;

import dev.ga16.litweb.LitWeb;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.context.BlockPlaceContext;
import net.minecraft.world.level.block.state.BlockState;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Fabric API has no block-placed event, so count placements where BlockItem actually puts the block down. */
@Mixin(BlockItem.class)
abstract class BlockItemMixin {
	@Inject(method = "placeBlock", at = @At("RETURN"))
	private void litweb$placed(BlockPlaceContext ctx, BlockState state, CallbackInfoReturnable<Boolean> cir) {
		if (cir.getReturnValueZ() && ctx.getPlayer() instanceof ServerPlayer player) {
			LitWeb.onPlaced(player, ctx.getClickedPos(), ctx.getLevel().getBlockState(ctx.getClickedPos()));
		}
	}
}
