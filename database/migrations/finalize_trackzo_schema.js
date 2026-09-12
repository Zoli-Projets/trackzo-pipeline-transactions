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

    await addColumnIfMissing(sequelize, "sms_receipts", "userId", `UUID`);
    await addColumnIfMissing(sequelize, "sms_receipts", "smsHash", `VARCHAR(64)`);
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

    // Compatibilité avec les anciennes versions : ces colonnes peuvent encore
    // exister dans PostgreSQL, mais les nouveaux SMS n'y écrivent plus rien.
    // DROP NOT NULL est une modification de métadonnées légère : aucun UPDATE
    // massif et aucune suppression d'historique au démarrage.
    for (const column of ["sender", "message", "receivedAt"]) {
        if (await columnExists(sequelize, "sms_receipts", column)) {
            await sequelize.query(
                `ALTER TABLE "sms_receipts" ALTER COLUMN "${column}" DROP NOT NULL`
            );
        }
    }

    // Conserve l'unicité déjà utilisée par la version stable. Pas de migration
    // destructive d'index pendant le démarrage du serveur.
    await sequelize.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS sms_receipts_sms_hash_unique
        ON "sms_receipts" ("smsHash")
        WHERE "smsHash" IS NOT NULL
    `);

    await sequelize.query(`
        CREATE INDEX IF NOT EXISTS sms_receipts_status_idx
        ON "sms_receipts" ("status")
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
