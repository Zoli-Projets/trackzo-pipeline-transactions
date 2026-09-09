const User = require("./User");
const Device = require("./Device");
const Subscription = require("./Subscription");
const UserSettings = require("./UserSettings");
const Template = require("./Template");
const GoogleAccount = require("./GoogleAccount");
const DailySheet = require("./DailySheet");
const Session = require("./Session");
const VerificationCode = require("./VerificationCode");
const Payment = require("./Payment");
const SubscriptionEvent = require("./SubscriptionEvent");

User.hasOne(GoogleAccount, { foreignKey: "userId", as: "googleAccount", onDelete: "CASCADE" });
GoogleAccount.belongsTo(User, { foreignKey: "userId", as: "user" });

User.hasMany(Device, { foreignKey: "userId", as: "devices", onDelete: "CASCADE" });
Device.belongsTo(User, { foreignKey: "userId", as: "user" });

User.hasMany(DailySheet, { foreignKey: "userId", as: "dailySheets", onDelete: "CASCADE" });
DailySheet.belongsTo(User, { foreignKey: "userId", as: "user" });

User.hasOne(Subscription, { foreignKey: "userId", as: "subscription", onDelete: "CASCADE" });
Subscription.belongsTo(User, { foreignKey: "userId", as: "user" });

User.hasOne(UserSettings, { foreignKey: "userId", as: "settings", onDelete: "CASCADE" });
UserSettings.belongsTo(User, { foreignKey: "userId", as: "user" });

Template.hasMany(UserSettings, { foreignKey: "templateId", as: "users" });
UserSettings.belongsTo(Template, { foreignKey: "templateId", as: "template" });

User.hasMany(Session, { foreignKey: "userId", as: "sessions", onDelete: "CASCADE" });
Session.belongsTo(User, { foreignKey: "userId", as: "user" });
Device.hasMany(Session, { foreignKey: "deviceId", as: "sessions", onDelete: "CASCADE" });
Session.belongsTo(Device, { foreignKey: "deviceId", as: "device" });

User.hasMany(VerificationCode, { foreignKey: "userId", as: "verificationCodes", onDelete: "CASCADE" });
VerificationCode.belongsTo(User, { foreignKey: "userId", as: "user" });

User.hasMany(Payment, { foreignKey: "userId", as: "payments", onDelete: "CASCADE" });
Payment.belongsTo(User, { foreignKey: "userId", as: "user" });
Subscription.hasMany(Payment, { foreignKey: "subscriptionId", as: "payments", onDelete: "SET NULL" });
Payment.belongsTo(Subscription, { foreignKey: "subscriptionId", as: "subscription" });

User.hasMany(SubscriptionEvent, { foreignKey: "userId", as: "subscriptionEvents", onDelete: "CASCADE" });
SubscriptionEvent.belongsTo(User, { foreignKey: "userId", as: "user" });
Subscription.hasMany(SubscriptionEvent, { foreignKey: "subscriptionId", as: "events", onDelete: "SET NULL" });
SubscriptionEvent.belongsTo(Subscription, { foreignKey: "subscriptionId", as: "subscription" });

module.exports = {
  User, Device, Subscription, UserSettings, Template, GoogleAccount, DailySheet,
  Session, VerificationCode, Payment, SubscriptionEvent
};
