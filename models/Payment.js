const { DataTypes } = require("sequelize");
const sequelize = require("../database/database");

const Payment = sequelize.define("Payment", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.UUID, allowNull: false },
  subscriptionId: { type: DataTypes.UUID, allowNull: true },
  plan: { type: DataTypes.STRING, allowNull: false },
  amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
  currency: { type: DataTypes.STRING(8), allowNull: false, defaultValue: "XOF" },
  provider: { type: DataTypes.STRING, allowNull: false, defaultValue: "WAVE" },
  paymentReference: { type: DataTypes.STRING, allowNull: false, unique: true },
  providerSessionId: { type: DataTypes.STRING, allowNull: true, unique: true },
  providerTransactionId: { type: DataTypes.STRING, allowNull: true, unique: true },
  providerEventId: { type: DataTypes.STRING, allowNull: true, unique: true },
  checkoutUrl: { type: DataTypes.TEXT, allowNull: true },
  failureReason: { type: DataTypes.TEXT, allowNull: true },
  operatorReference: { type: DataTypes.STRING(160), allowNull: true },
  submittedAt: { type: DataTypes.DATE, allowNull: true },
  reviewedAt: { type: DataTypes.DATE, allowNull: true },
  reviewNote: { type: DataTypes.TEXT, allowNull: true },
  status: {
    type: DataTypes.ENUM("PENDING", "SUCCESS", "FAILED", "CANCELLED"),
    allowNull: false,
    defaultValue: "PENDING"
  },
  paidAt: { type: DataTypes.DATE, allowNull: true }
}, { tableName: "payments", timestamps: true });

module.exports = Payment;
