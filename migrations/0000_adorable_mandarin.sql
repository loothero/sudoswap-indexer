CREATE TABLE "pool_nfts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pool_address" text NOT NULL,
	"token_id" numeric(78, 0) NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL,
	"block_number" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pool_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pool_address" text NOT NULL,
	"update_type" text NOT NULL,
	"old_value" text,
	"new_value" text NOT NULL,
	"block_number" bigint NOT NULL,
	"transaction_hash" text NOT NULL,
	"event_index" integer NOT NULL,
	"timestamp" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"address" text NOT NULL,
	"nft_address" text NOT NULL,
	"token_address" text NOT NULL,
	"bonding_curve" text NOT NULL,
	"pool_type" text NOT NULL,
	"nft_type" text NOT NULL,
	"property_checker" text,
	"erc1155_id" numeric(78, 0),
	"spot_price" numeric(78, 0) NOT NULL,
	"delta" numeric(78, 0) NOT NULL,
	"fee" numeric(78, 0) NOT NULL,
	"owner" text NOT NULL,
	"asset_recipient" text,
	"token_balance" numeric(78, 0) DEFAULT '0' NOT NULL,
	"nft_count" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"block_number" bigint NOT NULL,
	"transaction_hash" text NOT NULL,
	CONSTRAINT "pools_address_unique" UNIQUE("address")
);
--> statement-breakpoint
CREATE TABLE "protocol_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"setting_type" text NOT NULL,
	"address" text,
	"value" text NOT NULL,
	"block_number" bigint NOT NULL,
	"transaction_hash" text NOT NULL,
	"event_index" integer NOT NULL,
	"timestamp" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "swaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pool_address" text NOT NULL,
	"direction" text NOT NULL,
	"token_amount" numeric(78, 0) NOT NULL,
	"nft_count" integer NOT NULL,
	"nft_ids" text,
	"block_number" bigint NOT NULL,
	"transaction_hash" text NOT NULL,
	"event_index" integer NOT NULL,
	"timestamp" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "pool_nfts_pool_token_idx" ON "pool_nfts" USING btree ("pool_address","token_id");--> statement-breakpoint
CREATE INDEX "pool_nfts_token_id_idx" ON "pool_nfts" USING btree ("token_id");--> statement-breakpoint
CREATE INDEX "pool_nfts_pool_added_idx" ON "pool_nfts" USING btree ("pool_address","added_at");--> statement-breakpoint
CREATE INDEX "pool_nfts_block_number_idx" ON "pool_nfts" USING btree ("block_number");--> statement-breakpoint
CREATE UNIQUE INDEX "pool_updates_block_tx_event_idx" ON "pool_updates" USING btree ("block_number","transaction_hash","event_index");--> statement-breakpoint
CREATE INDEX "pool_updates_pool_address_idx" ON "pool_updates" USING btree ("pool_address");--> statement-breakpoint
CREATE INDEX "pool_updates_update_type_idx" ON "pool_updates" USING btree ("update_type");--> statement-breakpoint
CREATE INDEX "pool_updates_timestamp_idx" ON "pool_updates" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "pool_updates_block_number_idx" ON "pool_updates" USING btree ("block_number");--> statement-breakpoint
CREATE INDEX "pools_nft_address_idx" ON "pools" USING btree ("nft_address");--> statement-breakpoint
CREATE INDEX "pools_token_address_idx" ON "pools" USING btree ("token_address");--> statement-breakpoint
CREATE INDEX "pools_owner_idx" ON "pools" USING btree ("owner");--> statement-breakpoint
CREATE INDEX "pools_bonding_curve_idx" ON "pools" USING btree ("bonding_curve");--> statement-breakpoint
CREATE INDEX "pools_nft_type_idx" ON "pools" USING btree ("nft_type");--> statement-breakpoint
CREATE INDEX "pools_pool_type_idx" ON "pools" USING btree ("pool_type");--> statement-breakpoint
CREATE INDEX "pools_is_active_idx" ON "pools" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "pools_created_at_idx" ON "pools" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "pools_nft_active_idx" ON "pools" USING btree ("nft_address","is_active");--> statement-breakpoint
CREATE INDEX "pools_nft_type_active_idx" ON "pools" USING btree ("nft_type","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "protocol_settings_block_tx_event_idx" ON "protocol_settings" USING btree ("block_number","transaction_hash","event_index");--> statement-breakpoint
CREATE INDEX "protocol_settings_setting_type_idx" ON "protocol_settings" USING btree ("setting_type");--> statement-breakpoint
CREATE INDEX "protocol_settings_block_number_idx" ON "protocol_settings" USING btree ("block_number");--> statement-breakpoint
CREATE UNIQUE INDEX "swaps_block_tx_event_idx" ON "swaps" USING btree ("block_number","transaction_hash","event_index");--> statement-breakpoint
CREATE INDEX "swaps_pool_address_idx" ON "swaps" USING btree ("pool_address");--> statement-breakpoint
CREATE INDEX "swaps_timestamp_idx" ON "swaps" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "swaps_direction_idx" ON "swaps" USING btree ("direction");--> statement-breakpoint
CREATE INDEX "swaps_block_number_idx" ON "swaps" USING btree ("block_number");--> statement-breakpoint
CREATE INDEX "swaps_pool_timestamp_idx" ON "swaps" USING btree ("pool_address","timestamp");