const { QueryTypes } = require("sequelize");

async function tableExists(sequelize, tableName) {
  const rows = await sequelize.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=:tableName LIMIT 1`,
    { replacements: { tableName }, type: QueryTypes.SELECT }
  );
  return rows.length > 0;
}

async function columnExists(sequelize, tableName, columnName) {
  const rows = await sequelize.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=:tableName AND column_name=:columnName LIMIT 1`,
    { replacements: { tableName, columnName }, type: QueryTypes.SELECT }
  );
  return rows.length > 0;
}

async function addColumnIfMissing(sequelize, tableName, columnName, definition) {
  if (!(await tableExists(sequelize, tableName))) return;
  if (await columnExists(sequelize, tableName, columnName)) return;
  await sequelize.query(`ALTER TABLE "${tableName}" ADD COLUMN "${columnName}" ${definition}`);
  console.log(`✅ Colonne compte ajoutée: ${tableName}.${columnName}`);
}

async function finalizeAccountSchema(sequelize) {
  console.log("🔐 Vérification du schéma comptes/abonnements...");

  await addColumnIfMissing(sequelize, "users", "phoneVerified", `BOOLEAN NOT NULL DEFAULT FALSE`);
  await addColumnIfMissing(sequelize, "users", "emailVerified", `BOOLEAN NOT NULL DEFAULT FALSE`);
  await addColumnIfMissing(sequelize, "users", "status", `VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'`);
  await addColumnIfMissing(sequelize, "users", "disabledReason", `TEXT`);
  await addColumnIfMissing(sequelize, "users", "disabledAt", `TIMESTAMP WITH TIME ZONE`);

  // Les utilisateurs existants ont déjà été admis par l'ancien système sur leur téléphone.
  // On ne prétend pas que leur email est vérifié. Leur téléphone reste non vérifié jusqu'à OTP.
  if (await tableExists(sequelize, "users")) {
    await sequelize.query(`CREATE INDEX IF NOT EXISTS users_status_idx ON "users" ("status")`);
    const duplicateEmails = await sequelize.query(
      `SELECT LOWER("email") FROM "users" WHERE "email" IS NOT NULL GROUP BY LOWER("email") HAVING COUNT(*) > 1 LIMIT 1`,
      { type: QueryTypes.SELECT }
    );
    if (duplicateEmails.length === 0) {
      await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique ON "users" (LOWER("email")) WHERE "email" IS NOT NULL`);
    } else {
      console.warn("⚠️ Emails dupliqués historiquement: unicité email non activée.");
    }
  }

  await addColumnIfMissing(sequelize, "subscriptions", "startsAt", `TIMESTAMP WITH TIME ZONE`);
  await addColumnIfMissing(sequelize, "subscriptions", "notes", `TEXT`);
  if (await tableExists(sequelize, "subscriptions")) {
    await sequelize.query(`UPDATE "subscriptions" SET "startsAt" = COALESCE("startsAt", "createdAt", CURRENT_TIMESTAMP) WHERE "startsAt" IS NULL`);
    await sequelize.query(`ALTER TABLE "subscriptions" ALTER COLUMN "startsAt" SET DEFAULT CURRENT_TIMESTAMP`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS subscriptions_status_expires_idx ON "subscriptions" ("status", "expiresAt")`);
    const duplicates = await sequelize.query(
      `SELECT "userId" FROM "subscriptions" GROUP BY "userId" HAVING COUNT(*) > 1 LIMIT 1`,
      { type: QueryTypes.SELECT }
    );
    if (duplicates.length === 0) {
      await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_user_unique ON "subscriptions" ("userId")`);
    } else {
      console.warn("⚠️ Doublons historiques dans subscriptions: index unique non créé. Corriger avant d'activer l'unicité.");
    }
  }

  if (await tableExists(sequelize, "sessions")) {
    await sequelize.query(`CREATE INDEX IF NOT EXISTS sessions_user_idx ON "sessions" ("userId")`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS sessions_device_idx ON "sessions" ("deviceId")`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS sessions_active_idx ON "sessions" ("expiresAt", "revokedAt")`);
  }
  if (await tableExists(sequelize, "verification_codes")) {
    await sequelize.query(`CREATE INDEX IF NOT EXISTS verification_user_purpose_idx ON "verification_codes" ("userId", "purpose", "createdAt")`);
  }
  if (await tableExists(sequelize, "payments")) {
    await sequelize.query(`CREATE INDEX IF NOT EXISTS payments_user_idx ON "payments" ("userId")`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS payments_reference_idx ON "payments" ("paymentReference") WHERE "paymentReference" IS NOT NULL`);
  }
  if (await tableExists(sequelize, "subscription_events")) {
    await sequelize.query(`CREATE INDEX IF NOT EXISTS subscription_events_user_idx ON "subscription_events" ("userId", "createdAt" DESC)`);
  }

  console.log("✅ Schéma comptes/abonnements à jour");
}

module.exports = { finalizeAccountSchema };
