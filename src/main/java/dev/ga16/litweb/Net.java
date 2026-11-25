package dev.ga16.litweb;

import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;

/** Two packets carry everything: a client request and a (possibly multi-part) server reply. */
public final class Net {
	/** Serverbound packets are capped at 32 KiB, clientbound at 1 MiB. */
	public static final int UP_PART = 30_000, DOWN_PART = 900_000;
	/** Reply.req for unsolicited pushes of the shared-schematic list. */
	public static final int PUSH_LIST = 0;

	/** op: list | config | region | get | terrain | status | upload | capture | access | delete. */
	public record Req(int req, String op, String arg, byte[] data) implements CustomPacketPayload {
		public static final Type<Req> TYPE = new Type<>(Identifier.fromNamespaceAndPath("litweb", "req"));
		public static final StreamCodec<RegistryFriendlyByteBuf, Req> CODEC = StreamCodec.composite(
			ByteBufCodecs.VAR_INT, Req::req, ByteBufCodecs.STRING_UTF8, Req::op, ByteBufCodecs.STRING_UTF8, Req::arg,
			ByteBufCodecs.byteArray(UP_PART + 1024), Req::data, Req::new);

		@Override
		public Type<Req> type() {
			return TYPE;
		}
	}

	/** error is empty on success; data is split into parts when large. */
	public record Reply(int req, int part, int parts, String error, byte[] data) implements CustomPacketPayload {
		public static final Type<Reply> TYPE = new Type<>(Identifier.fromNamespaceAndPath("litweb", "reply"));
		public static final StreamCodec<RegistryFriendlyByteBuf, Reply> CODEC = StreamCodec.composite(
			ByteBufCodecs.VAR_INT, Reply::req, ByteBufCodecs.VAR_INT, Reply::part, ByteBufCodecs.VAR_INT, Reply::parts,
			ByteBufCodecs.STRING_UTF8, Reply::error, ByteBufCodecs.byteArray(DOWN_PART + 1024), Reply::data, Reply::new);

		@Override
		public Type<Reply> type() {
			return TYPE;
		}
	}

	private Net() {}
}
