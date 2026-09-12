const { QueryTypes } = require("sequelize");

async function tableExists(sequelize, tableName) {
    const rows = await sequelize.query(
        `SELECT 1
         FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name = :tableName
         LIMIT 1`,
        {
            replacements: { tableName },
            type: QueryTypes.SELECT
        }
    );
    return rows.length > 0;
}

async function columnExists(sequelize, tableName, columnName) {
    const rows = await sequelize.query(
        `SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = :tableName
           AND column_name = :columnName
         LIMIT 1`,
        {
            replacements: { tableName, columnName },
            type: QueryTypes.SELECT
        }
    );
    return rows.length > 0;
}

async function addColumnIfMissing(sequelize, tableName, columnName, definition) {
    if (!(await tableExists(sequelize, tableName))) return;

    if (await columnExists(sequelize, tableName, columnName)) {
        console.log(`✓ ${tableName}.${columnName} existe déjà`);
        return;
    }

    await sequelize.query(
        `ALTER TABLE "${tableName}" ADD COLUMN "${columnName}" ${definition}`
    );
    console.log(`✅ Colonne ajoutée: ${tableName}.${columnName}`);
}

async function ensureSmsReceiptSchema(sequelize) {
    if (!(await tableExists(sequelize, "sms_receipts"))) {
        return;
    }

    await addColumnIfMissing(
        sequelize, "sms_receipts", "userId", `UUID`
    );
    await addColumnIfMissing(
        sequelize, "sms_receipts", "smsHash", `VARCHAR(64)`
    );
    await addColumnIfMissing(
        sequelize, "sms_receipts", "status",
        `VARCHAR(20) NOT NULL DEFAULT 'PROCESSING'`
    );
    await addColumnIfMissing(
        sequelize, "sms_receipts", "createdAt",
        `TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP`
    );
    await addColumnIfMissing(
        sequelize, "sms_receipts", "updatedAt",
        `TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP`
    );

    // Les anciennes versions stockaient le contenu complet des SMS en SQL.
    // On garde ces colonnes uniquement pour compatibilité de schéma, mais
    // elles deviennent facultatives puis sont vidées immédiatement.
    for (const column of ["sender", "message", "receivedAt"]) {
        if (await columnExists(sequelize, "sms_receipts", column)) {
            await sequelize.query(
                `ALTER TABLE "sms_receipts" ALTER COLUMN "${column}" DROP NOT NULL`
            );
        }
    }

    if (await columnExists(sequelize, "sms_receipts", "sender")) {
        await sequelize.query(`UPDATE "sms_receipts" SET "sender" = NULL WHERE "sender" IS NOT NULL`);
    }
    if (await columnExists(sequelize, "sms_receipts", "message")) {
        await sequelize.query(`UPDATE "sms_receipts" SET "message" = NULL WHERE "message" IS NOT NULL`);
    }
    if (await columnExists(sequelize, "sms_receipts", "receivedAt")) {
        await sequelize.query(`UPDATE "sms_receipts" SET "receivedAt" = NULL WHERE "receivedAt" IS NOT NULL`);
    }

    // Les reçus terminés ne servent plus de stockage durable.
    // L'anti-doublon durable est assuré par le hash technique dans Google Sheets.
    await sequelize.query(`
        DELETE FROM "sms_receipts"
        WHERE "status" = 'COMPLETED'
    `);

    // Nettoyage d'éventuels doublons techniques par utilisateur/hash.
    await sequelize.query(`
        WITH ranked AS (
            SELECT
                ctid,
                ROW_NUMBER() OVER (
                    PARTITION BY "userId", "smsHash"
                    ORDER BY "createdAt" ASC, ctid ASC
                ) AS rn
            FROM "sms_receipts"
            WHERE "userId" IS NOT NULL
              AND "smsHash" IS NOT NULL
        )
        DELETE FROM "sms_receipts" s
        USING ranked r
        WHERE s.ctid = r.ctid
          AND r.rn > 1
    `);

    // Supprime l'ancien index global sur smsHash s'il existe.
    await sequelize.query(`
        DROP INDEX IF EXISTS sms_receipts_sms_hash_unique
    `);

    // Un verrou technique par utilisateur + hash.
    await sequelize.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS sms_receipts_user_hash_unique
        ON "sms_receipts" ("userId", "smsHash")
        WHERE "userId" IS NOT NULL AND "smsHash" IS NOT NULL
    `);

    await sequelize.query(`
        CREATE INDEX IF NOT EXISTS sms_receipts_status_idx
        ON "sms_receipts" ("status")
    `);

    // Nettoyage de sécurité : un verrou PROCESSING abandonné depuis plus de
    // 24 heures n'a plus d'utilité et ne doit pas occuper la base indéfiniment.
    await sequelize.query(`
        DELETE FROM "sms_receipts"
        WHERE "status" = 'PROCESSING'
          AND "updatedAt" < NOW() - INTERVAL '24 hours'
    `);
}

async function finalizeTrackzoSchema(sequelize) {
    console.log("🔧 Vérification du schéma Trackzo...");

    // ==========================
    // DEVICES
    // ==========================
    await addColumnIfMissing(sequelize, "devices", "authTokenHash", `VARCHAR(64)`);
    if (await tableExists(sequelize, "devices")) {
        await sequelize.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS devices_auth_token_hash_unique
            ON "devices" ("authTokenHash")
            WHERE "authTokenHash" IS NOT NULL
        `);
    }

    // ==========================
    // USER SETTINGS
    // ==========================
    const userSettingsColumns = [
        ["country", `VARCHAR(255) DEFAULT 'CI'`],
        ["openingTime", `VARCHAR(255) DEFAULT '08:00'`],
        ["closingTime", `VARCHAR(255) DEFAULT '22:00'`],
        ["dailySheetCreation", `VARCHAR(255) DEFAULT '00:05'`],
        ["timezone", `VARCHAR(255) DEFAULT 'Africa/Abidjan'`],
        ["scriptId", `VARCHAR(255)`],
        ["agentToken", `TEXT`],
        ["sheetId", `VARCHAR(255)`],
        ["sheetUrl", `TEXT`],
        ["sheetName", `VARCHAR(255)`],
        ["sheetCreated", `BOOLEAN DEFAULT FALSE`],
        ["lastTemplateVersion", `VARCHAR(255) DEFAULT '1.0'`],
        ["templateId", `UUID`]
    ];
    for (const [name, definition] of userSettingsColumns) {
        await addColumnIfMissing(sequelize, "user_settings", name, definition);
    }

    // ==========================
    // SMS RECEIPTS
    // ==========================
    await ensureSmsReceiptSchema(sequelize);

    // ==========================
    // DAILY SHEETS
    // ==========================
    await addColumnIfMissing(sequelize, "daily_sheets", "url", `TEXT`);
    await addColumnIfMissing(sequelize, "daily_sheets", "scriptId", `VARCHAR(255)`);

    if (await tableExists(sequelize, "daily_sheets")) {
        await sequelize.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS daily_sheets_user_date_unique
            ON "daily_sheets" ("userId", "date")
        `);
    }

    // ==========================
    // GOOGLE ACCOUNTS
    // ==========================
    const googleColumns = [
        ["accessToken", `TEXT`],
        ["expiryDate", `BIGINT`],
        ["expiresAt", `TIMESTAMP WITH TIME ZONE`],
        ["trackzoFolderId", `VARCHAR(255)`],
        ["dailyFolderId", `VARCHAR(255)`],
        ["reportsFolderId", `VARCHAR(255)`]
    ];
    for (const [name, definition] of googleColumns) {
        await addColumnIfMissing(sequelize, "google_accounts", name, definition);
    }

    console.log("✅ Schéma Trackzo finalisé");
}

module.exports = { finalizeTrackzoSchema };
