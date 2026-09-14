const sequelize = require("../database/database");

const User = require("../models/User");
const Device = require("../models/Device");
const DailySheet = require("../models/DailySheet");
const Subscription = require("../models/Subscription");
const UserSettings = require("../models/UserSettings");
const GoogleAccount = require("../models/GoogleAccount");
const Session = require("../models/Session");
const VerificationCode = require("../models/VerificationCode");
const Payment = require("../models/Payment");
const SubscriptionEvent = require("../models/SubscriptionEvent");
const SmsReceipt = require("../models/SmsReceipt");

async function deleteUserAccount(userId) {
  return sequelize.transaction(async (transaction) => {
    const user = await User.findByPk(userId, {
      transaction,
      lock: transaction.LOCK.UPDATE
    });

    if (!user) {
      const error = new Error("Utilisateur introuvable");
      error.code = "USER_NOT_FOUND";
      throw error;
    }

    // Supprimer explicitement les dépendances afin de ne pas dépendre
    // uniquement des contraintes CASCADE d'une ancienne base.
    await SubscriptionEvent.destroy({ where: { userId }, transaction });
    await Payment.destroy({ where: { userId }, transaction });
    await Session.destroy({ where: { userId }, transaction });
    await VerificationCode.destroy({ where: { userId }, transaction });
    await SmsReceipt.destroy({ where: { userId }, transaction });
    await DailySheet.destroy({ where: { userId }, transaction });
    await GoogleAccount.destroy({ where: { userId }, transaction });
    await UserSettings.destroy({ where: { userId }, transaction });
    await Device.destroy({ where: { userId }, transaction });
    await Subscription.destroy({ where: { userId }, transaction });

    await user.destroy({ transaction });

    return { userId };
  });
}

module.exports = { deleteUserAccount };
