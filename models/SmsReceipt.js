const { DataTypes } = require("sequelize");
const sequelize = require("../database/database");

const SmsReceipt = sequelize.define("SmsReceipt", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId: { type: DataTypes.UUID, allowNull: false },
    smsHash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    sender: { type: DataTypes.STRING, allowNull: false },
    receivedAt: { type: DataTypes.BIGINT, allowNull: false }
}, { tableName: "sms_receipts", timestamps: true });

module.exports = SmsReceipt;
