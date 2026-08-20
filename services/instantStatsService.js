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

    const recentTransactions =
        transactions
            .slice(-10)
            .reverse();


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