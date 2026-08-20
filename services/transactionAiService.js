// services/transactionAiService.js

const {
    parseTransaction
} = require("./transactionParser");

const OLLAMA_URL =
    process.env.OLLAMA_URL ||
    "http://127.0.0.1:11434";

const OLLAMA_MODEL =
    process.env.OLLAMA_MODEL ||
    "qwen2.5:3b";


// ======================================
// CLASSIFICATION IA
// ======================================

async function classifyMessage(message) {

    const fallback =
        fallbackClassification(message);


    if (
        process.env.AI_ENABLED !== "true"
    ) {

        return fallback;

    }


    try {

        const controller =
            new AbortController();

        const timeout =
            setTimeout(
                () => controller.abort(),
                8000
            );


        const prompt = `
Tu es le système de classification financière de Trackzo.

Analyse entièrement le SMS ci-dessous.

OBJECTIF :
Déterminer s'il s'agit d'une VRAIE transaction financière exécutée
ou d'un message non transactionnel.

Une vraie transaction est une opération effectivement réalisée :
- dépôt
- retrait
- transfert
- recharge
- paiement de facture
- transfert d'unité
- transfert international
- bonus effectivement crédité

NE considère PAS comme transaction :
- promotion
- publicité
- offre commerciale
- objectif commercial
- félicitation
- message de bienvenue
- solde simple
- invitation à payer
- invitation à recharger
- lien promotionnel
- message informatif sans opération effectuée.

IMPORTANT :
Lis tout le message.
Ne te limite pas à la présence de "FCFA", "recharge", "bonus", etc.

Réponds UNIQUEMENT avec un JSON valide :

{
  "isTransaction": true,
  "confidence": 0.95,
  "category": "Dépôt",
  "reason": "..."
}

MESSAGE :
${message}
`;


        const response =
            await fetch(
                `${OLLAMA_URL}/api/generate`,
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify({

                            model:
                                OLLAMA_MODEL,

                            prompt,

                            stream:
                                false,

                            format:
                                "json",

                            options: {
                                temperature: 0
                            }

                        }),

                    signal:
                        controller.signal

                }
            );


        clearTimeout(timeout);


        if (!response.ok) {

            throw new Error(
                `Ollama HTTP ${response.status}`
            );

        }


        const data =
            await response.json();


        const result =
            JSON.parse(
                data.response
            );


        return normalizeAiResult(
            result,
            fallback
        );

    }
    catch (error) {

        console.warn(
            "⚠️ IA indisponible:",
            error.message
        );

        return fallback;

    }

}


// ======================================
// FALLBACK
// ======================================

function fallbackClassification(message) {

    const parsed =
        parseTransaction(message);


    const text =
        String(message || "")
            .toLowerCase();


    const nonTransactional = [

        /objectif.*pdv/i,

        /votre objectif/i,

        /solde de votre compte/i,

        /félicitation/i,

        /felicitation/i,

        /\bpromo\b/i,

        /offre spéciale/i,

        /offre speciale/i,

        /bon plan/i,

        /payez.*en ligne/i,

        /recharge.*via.*lien/i,

        /gagnant avec/i

    ];


    if (
        nonTransactional.some(
            regex => regex.test(text)
        )
    ) {

        return {

            isTransaction:
                false,

            confidence:
                0.99,

            category:
                "Non transactionnel",

            reason:
                "Message promotionnel ou informatif"

        };

    }


    const valid =
        parsed.amount > 0 &&
        parsed.operator !== "Inconnu" &&
        parsed.type !== "Autre";


    return {

        isTransaction:
            valid,

        confidence:
            valid
                ? 0.80
                : 0.60,

        category:
            valid
                ? parsed.type
                : "Inconnu",

        reason:
            valid
                ? "Transaction détectée par analyse structurée"
                : "Transaction non suffisamment identifiable"

    };

}


// ======================================
// NORMALISATION
// ======================================

function normalizeAiResult(
    result,
    fallback
) {

    if (
        !result ||
        typeof result !== "object"
    ) {

        return fallback;

    }


    const confidence =
        Math.min(
            1,
            Math.max(
                0,
                Number(result.confidence) || 0
            )
        );


    return {

        isTransaction:
            Boolean(
                result.isTransaction
            ),

        confidence,

        category:
            String(
                result.category ||
                "Inconnu"
            ),

        reason:
            String(
                result.reason ||
                fallback.reason ||
                ""
            ),

        // ======================================
        // DONNÉES STRUCTURÉES
        // ======================================

        amount:
            fallback.amount,

        operator:
            fallback.operator,

        type:
            fallback.type,

        reference:
            fallback.reference

    };

}


module.exports = {
    classifyMessage
};