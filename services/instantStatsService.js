const UserSettings =
    require("../models/UserSettings");

const GoogleAccount =
    require("../models/GoogleAccount");

const DailySheet =
    require("../models/DailySheet");

const {
    getLocalDate
} =
    require("./dailySheetService");

const {
    readCleanTransactions
} =
    require("./dailySheetDataService");


// ======================================
// TYPES
// ======================================

const TABLE1_TYPES = [

    "Dépôt",

    "Retrait",

    "Transf. International",

    "Transfère Unité",

    "Paiement facture"

];


const TABLE2_TYPES = [

    "Recharge",

    "U.V en espèce",

    "Bonus"

];


const OPERATORS = [

    "Orange Money",

    "MTN Money",

    "Moov Money",

    "Wave"

];


// ======================================
// NORMALISER TYPE
// ======================================

function normalizeType(type) {

    return String(type || "")
        .trim();

}


// ======================================
// NORMALISER OPERATEUR
// ======================================

function normalizeOperator(operator) {

    return String(operator || "")
        .trim();

}


// ======================================
// CLE DATE/HEURE TRANSACTION
// ======================================

function transactionDateTimeKey(transaction) {

    const rawDate = String(transaction?.date || "").trim();
    const rawTime = String(transaction?.time || "").trim();

    // Format Trackzo principal : dd-MM-yyyy / HH:mm:ss
    const dateMatch = rawDate.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/);
    const timeMatch = rawTime.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);

    if (dateMatch) {
        const day = Number(dateMatch[1]);
        const month = Number(dateMatch[2]);
        const year = Number(dateMatch[3]);
        const hour = timeMatch ? Number(timeMatch[1]) : 0;
        const minute = timeMatch ? Number(timeMatch[2]) : 0;
        const second = timeMatch && timeMatch[3] ? Number(timeMatch[3]) : 0;

        return Date.UTC(year, month - 1, day, hour, minute, second);
    }

    // Compatibilité avec une éventuelle date ISO yyyy-MM-dd.
    const isoMatch = rawDate.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (isoMatch) {
        const year = Number(isoMatch[1]);
        const month = Number(isoMatch[2]);
        const day = Number(isoMatch[3]);
        const hour = timeMatch ? Number(timeMatch[1]) : 0;
        const minute = timeMatch ? Number(timeMatch[2]) : 0;
        const second = timeMatch && timeMatch[3] ? Number(timeMatch[3]) : 0;

        return Date.UTC(year, month - 1, day, hour, minute, second);
    }

    // L'onglet Aujourd'hui contient normalement une seule date.
    // Si la date est illisible, l'heure reste suffisante pour conserver
    // un ordre utile sans éliminer la transaction.
    if (timeMatch) {
        return (Number(timeMatch[1]) * 3600) +
            (Number(timeMatch[2]) * 60) +
            (timeMatch[3] ? Number(timeMatch[3]) : 0);
    }

    return 0;
}


// ======================================
// GENERER STATS
// ======================================

async function generateInstantStats(
    userId
) {

    const settings =
        await UserSettings.findOne({

            where: {
                userId:
                    userId
            }

        });


    if (!settings) {

        throw new Error(
            "Paramètres utilisateur introuvables"
        );

    }


    const timezone =
        settings.timezone ||
        "Africa/Abidjan";


    const localDate =
        getLocalDate(
            timezone
        );


    const dailySheet =
        await DailySheet.findOne({

            where: {

                userId:
                    userId,

                date:
                    localDate

            }

        });


    if (!dailySheet) {

        return {

            available:
                false,

            exists:
                false,

            date:
                localDate,

            transactionCount:
                0,

            totalAmount:
                0,

            recentTransactions:
                []

        };

    }


    const googleAccount =
        await GoogleAccount.findOne({

            where: {

                userId:
                    userId

            }

        });


    if (!googleAccount) {

        throw new Error(
            "Compte Google non connecté"
        );

    }


    const transactions =
        await readCleanTransactions(

            googleAccount.refreshToken,

            dailySheet.spreadsheetId

        );


    // ==================================
    // STATS
    // ==================================

    const table1 =
        createTable(
            TABLE1_TYPES,
            transactions
        );


    const table2 =
        createTable(
            TABLE2_TYPES,
            transactions
        );


    const totalAmount =
        transactions.reduce(

            (
                total,
                transaction
            ) => {

                return total +
                    transaction.amount;

            },

            0

        );


    // ==================================
    // TRANSACTIONS RECENTES
    // ==================================

    // Toutes les transactions du journalier sont renvoyées à l'application.
    // L'ancienne limite `.slice(-10)` faisait croire que le scroll était
    // bloqué alors que les lignes au-delà des 10 dernières n'étaient jamais
    // envoyées par l'API.
    // Toujours trier explicitement par date + heure.
    // Ne jamais dépendre de l'ordre physique des lignes Google Sheets :
    // certains anciens chemins ajoutaient en bas, les nouveaux insèrent en haut.
    // Aucune limite artificielle : toutes les transactions du jour sont renvoyées.
    const recentTransactions =
        transactions
            .slice()
            .sort((a, b) => {
                const aKey = transactionDateTimeKey(a);
                const bKey = transactionDateTimeKey(b);

                if (aKey !== bKey) {
                    return bKey - aKey;
                }

                // Tri stable et déterministe si deux opérations ont exactement
                // la même seconde. On conserve leur ordre d'origine.
                return 0;
            });


    return {

        available:
            true,

        exists:
            true,

        date:
            localDate,

        spreadsheetId:
            dailySheet.spreadsheetId,

        spreadsheetName:
            dailySheet.spreadsheetName,

        url:
            dailySheet.url,

        transactionCount:
            transactions.length,

        totalAmount:
            totalAmount,

        table1:
            table1,

        table2:
            table2,

        recentTransactions:
            recentTransactions

    };

}


// ======================================
// CREER TABLEAU
// ======================================

function createTable(
    types,
    transactions
) {

    const rows =
        OPERATORS.map(
            operator => {

                const values = {};


                types.forEach(
                    type => {

                        values[type] =
                            transactions

                                .filter(
                                    transaction =>

                                        normalizeOperator(
                                            transaction.operator
                                        ) === operator &&

                                        normalizeType(
                                            transaction.type
                                        ) === type

                                )

                                .reduce(
                                    (
                                        total,
                                        transaction
                                    ) =>
                                        total +
                                        transaction.amount,

                                    0
                                );

                    }
                );


                return {

                    operator:
                        operator,

                    values:
                        values

                };

            }
        );


    const totals = {};


    types.forEach(
        type => {

            totals[type] =
                transactions

                    .filter(
                        transaction =>

                            normalizeType(
                                transaction.type
                            ) === type

                    )

                    .reduce(
                        (
                            total,
                            transaction
                        ) =>
                            total +
                            transaction.amount,

                        0
                    );

        }
    );


    const grandTotal =
        Object.values(totals)
            .reduce(
                (
                    total,
                    value
                ) =>
                    total +
                    value,

                0
            );


    return {

        types:
            types,

        operators:
            rows,

        totals:
            totals,

        grandTotal:
            grandTotal

    };

}


module.exports = {

    generateInstantStats

};