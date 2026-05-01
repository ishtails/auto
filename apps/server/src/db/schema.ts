import { relations } from "drizzle-orm";
import {
	index,
	integer,
	pgEnum,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";

// ─── Enums ───────────────────────────────────────────────────────

export const vaultStatusEnum = pgEnum("vault_status", [
	"queued",
	"submitted",
	"active",
	"failed",
]);

export const deploymentStatusEnum = pgEnum("deployment_status", [
	"queued",
	"submitted",
	"active",
	"failed",
]);

// ─── Users ───────────────────────────────────────────────────────

export const users = pgTable("users", {
	id: uuid("id").defaultRandom().primaryKey(),
	privyUserId: text("privy_user_id").notNull().unique(),
	primaryWalletAddress: text("primary_wallet_address").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true })
		.defaultNow()
		.notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.defaultNow()
		.notNull()
		.$onUpdate(() => new Date()),
});

export const usersRelations = relations(users, ({ many }) => ({
	vaults: many(vaults),
}));

// ─── Vaults ──────────────────────────────────────────────────────

export const vaults = pgTable(
	"vaults",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id),
		ownerAddress: text("owner_address").notNull(),
		vaultAddress: text("vault_address"),
		factoryAddress: text("factory_address").notNull(),
		chainId: integer("chain_id").notNull(),
		status: vaultStatusEnum("status").notNull().default("queued"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.notNull()
			.$onUpdate(() => new Date()),
	},
	(table) => [index("vaults_user_id_idx").on(table.userId)]
);

export const vaultsRelations = relations(vaults, ({ one, many }) => ({
	user: one(users, {
		fields: [vaults.userId],
		references: [users.id],
	}),
	agentProfile: one(agentProfiles),
	deployments: many(vaultDeployments),
}));

// ─── Agent Profiles ──────────────────────────────────────────────

export const agentProfiles = pgTable("agent_profiles", {
	id: uuid("id").defaultRandom().primaryKey(),
	vaultId: uuid("vault_id")
		.notNull()
		.unique()
		.references(() => vaults.id),
	name: text("name").notNull(),
	geminiSystemPrompt: text("gemini_system_prompt").notNull(),
	maxTradeBps: integer("max_trade_bps").notNull(),
	maxSlippageBps: integer("max_slippage_bps").notNull(),
	tokenIn: text("token_in").notNull(), // hex address
	tokenOut: text("token_out").notNull(), // hex address
	memoryPointer: text("memory_pointer").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true })
		.defaultNow()
		.notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.defaultNow()
		.notNull()
		.$onUpdate(() => new Date()),
});

export const agentProfilesRelations = relations(agentProfiles, ({ one }) => ({
	vault: one(vaults, {
		fields: [agentProfiles.vaultId],
		references: [vaults.id],
	}),
}));

// ─── Vault Deployments ───────────────────────────────────────────

export const vaultDeployments = pgTable(
	"vault_deployments",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		vaultId: uuid("vault_id")
			.notNull()
			.references(() => vaults.id),
		status: deploymentStatusEnum("status").notNull().default("queued"),
		txHash: text("tx_hash"),
		signedConfigHash: text("signed_config_hash").notNull(),
		ownerSignature: text("owner_signature").notNull(),
		error: text("error"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.notNull()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		index("vault_deployments_status_idx").on(table.status),
		unique("vault_deployments_active_unique").on(table.vaultId),
	]
);

export const vaultDeploymentsRelations = relations(
	vaultDeployments,
	({ one }) => ({
		vault: one(vaults, {
			fields: [vaultDeployments.vaultId],
			references: [vaults.id],
		}),
	})
);
