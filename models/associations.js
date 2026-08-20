const User = require("./User");
const Device = require("./Device");
const Subscription = require("./Subscription");
const UserSettings = require("./UserSettings");
const Template = require("./Template");
const GoogleAccount = require("./GoogleAccount");
const DailySheet = require("./DailySheet");



// ==========================
// USER → GOOGLE ACCOUNT
// Un utilisateur possède un compte Google Drive lié
// ==========================

User.hasOne(
    GoogleAccount,
    {
        foreignKey:"userId",
        as:"googleAccount",
        onDelete:"CASCADE"
    }
);


GoogleAccount.belongsTo(
    User,
    {
        foreignKey:"userId",
        as:"user"
    }
);


User.hasMany(
    Device,
    {
        foreignKey:"userId",
        as:"devices",
        onDelete:"CASCADE"
    }
);

User.hasMany(
    DailySheet,
    {
        foreignKey: "userId",
        as: "dailySheets",
        onDelete: "CASCADE"
    }
);

DailySheet.belongsTo(
    User,
    {
        foreignKey: "userId",
        as: "user"
    }
);

Device.belongsTo(
    User,
    {
        foreignKey:"userId",
        as:"user"
    }
);



// ==========================
// USER → SUBSCRIPTION
// Un utilisateur possède un abonnement
// ==========================

User.hasOne(
    Subscription,
    {
        foreignKey:"userId",
        as:"subscription",
        onDelete:"CASCADE"
    }
);


Subscription.belongsTo(
    User,
    {
        foreignKey:"userId",
        as:"user"
    }
);



// ==========================
// USER → SETTINGS
// Paramètres personnalisés
// ==========================

User.hasOne(
    UserSettings,
    {
        foreignKey:"userId",
        as:"settings",
        onDelete:"CASCADE"
    }
);


UserSettings.belongsTo(
    User,
    {
        foreignKey:"userId",
        as:"user"
    }
);



// ==========================
// TEMPLATE → SETTINGS
// Un modèle Google Sheet peut être utilisé
// par plusieurs utilisateurs
// ==========================

Template.hasMany(
    UserSettings,
    {
        foreignKey:"templateId",
        as:"users"
    }
);


UserSettings.belongsTo(
    Template,
    {
        foreignKey:"templateId",
        as:"template"
    }
);



module.exports = {
    User,
    Device,
    Subscription,
    UserSettings,
    Template,
    GoogleAccount,
    DailySheet
};