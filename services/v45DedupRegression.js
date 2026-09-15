// Régression documentaire V45.
// La logique réelle est dans dailySheetProcessorService.js.
//
// Ces deux notifications doivent produire la même clé sémantique car elles ont
// même montant, opérateur, type, numéro et exactement 11:24:20.
// La notification avec ID Transaction doit gagner grâce au score de complétude.
const shortSms =
  "Vous avez envoye 1000 FCFA au 2250502862978 le 2026-09-15 11:24:20.";
const completeSms =
  "Vous avez envoye 1000 FCFA au 2250502862978 le 15-09-2026 11:24:20. " +
  "Votre nouveau solde est de: 204482 FCFA. ID Transaction: 17893915992.";

module.exports = { shortSms, completeSms };
