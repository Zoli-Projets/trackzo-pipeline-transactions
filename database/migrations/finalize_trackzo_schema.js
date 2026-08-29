const { QueryTypes } = require("sequelize");

async function columnExists(sequelize, tableName, columnName) {
    const result = await sequelize.query(
        `
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = :tableName
          AND column_name = :columnName
        LIMIT 1
        `,
        {
            replacements: {
                tableName,
                columnName
            },
            type: QueryTypes.SELECT
        }
    );

    return result.length > 0;
}

async function addColumnIfMissing(
    sequelize,
    tableName,
    columnName,
    definition
) {
    const exists = await columnExists(
        sequelize,
        tableName,
        columnName
    );

    if (exists) {
        console.log(
            `✓ ${tableName}.${columnName} existe déjà`
        );
        return;
    }

    await sequelize.query(
        `
        ALTER TABLE "${tableName}"
        ADD COLUMN "${columnName}" ${definition}
        `
    );

    console.log(
        `✅ Colonne ajoutée: ${tableName}.${columnName}`
    );
}

async function finalizeTrackzoSchema(sequelize) {

    console.log(
        "🔧 Vérification du schéma Trackzo..."
    );

    // ==========================================
    // DEVICES / AUTHENTIFICATION
    // ==========================================

    await addColumnIfMissing(
        sequelize,
        "devices",
        "authTokenHash",
        `VARCHAR(64)`
    );


    await sequelize.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS devices_auth_token_hash_unique
        ON "devices" ("authTokenHash")
        WHERE "authTokenHash" IS NOT NULL
    `);

    // ==========================================
    // USER SETTINGS
    // ==========================================

    await addColumnIfMissing(
        sequelize,
        "user_settings",
        "country",
        `VARCHAR(255) DEFAULT 'CI'`
    );

    await addColumnIfMissing(
        sequelize,
        "user_settings",
        "openingTime",
        `VARCHAR(255) DEFAULT '08:00'`
    );

    await addColumnIfMissing(
        sequelize,
        "user_settings",
        "closingTime",
        `VARCHAR(255) DEFAULT '22:00'`
    );

    await addColumnIfMissing(
        sequelize,
        "user_settings",
        "dailySheetCreation",
        `VARCHAR(255) DEFAULT '00:05'`
    );

    await addColumnIfMissing(
        sequelize,
        "user_settings",
        "timezone",
        `VARCHAR(255) DEFAULT 'Africa/Abidjan'`
    );

    await addColumnIfMissing(
        sequelize,
        "user_settings",
        "scriptId",
        `VARCHAR(255)`
    );

    await addColumnIfMissing(
        sequelize,
        "user_settings",
        "agentToken",
        `TEXT`
    );

    await addColumnIfMissing(
        sequelize,
        "user_settings",
        "sheetId",
        `VARCHAR(255)`
    );

    await addColumnIfMissing(
        sequelize,
        "user_settings",
        "sheetUrl",
        `TEXT`
    );

    await addColumnIfMissing(
        sequelize,
        "user_settings",
        "sheetName",
        `VARCHAR(255)`
    );

    await addColumnIfMissing(
        sequelize,
        "user_settings",
        "sheetCreated",
        `BOOLEAN DEFAULT FALSE`
    );

    await addColumnIfMissing(
        sequelize,
        "user_settings",
        "lastTemplateVersion",
        `VARCHAR(255) DEFAULT '1.0'`
    );

    await addColumnIfMissing(
        sequelize,
        "user_settings",
        "templateId",
        `UUID`
    );


    // ==========================================
    // SMS RECEIPTS
    // ==========================================

    await addColumnIfMissing(
        sequelize,
        "sms_receipts",
        "message",
        `TEXT`
    );


    // ==========================================
    // DAILY SHEETS
    // ==========================================

    await addColumnIfMissing(
        sequelize,
        "daily_sheets",
        "url",
        `TEXT`
    );

    await addColumnIfMissing(
        sequelize,
        "daily_sheets",
        "scriptId",
        `VARCHAR(255)`
    );


    // ==========================================
    // GOOGLE ACCOUNTS
    // ==========================================

    await addColumnIfMissing(
        sequelize,
        "google_accounts",
        "accessToken",
        `TEXT`
    );

    await addColumnIfMissing(
        sequelize,
        "google_accounts",
        "expiryDate",
        `BIGINT`
    );

    await addColumnIfMissing(
        sequelize,
        "google_accounts",
        "expiresAt",
        `TIMESTAMP WITH TIME ZONE`
    );

    await addColumnIfMissing(
        sequelize,
        "google_accounts",
        "trackzoFolderId",
        `VARCHAR(255)`
    );

    await addColumnIfMissing(
        sequelize,
        "google_accounts",
        "dailyFolderId",
        `VARCHAR(255)`
    );

    await addColumnIfMissing(
        sequelize,
        "google_accounts",
        "reportsFolderId",
        `VARCHAR(255)`
    );


    console.log(
        "✅ Schéma Trackzo finalisé"
    );
}


module.exports = {
    finalizeTrackzoSchema
};