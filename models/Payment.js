const { DataTypes } = require("sequelize");
const sequelize = require("../database/database");

const Payment = sequelize.define("Payment", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.UUID, allowNull: false },
  subscriptionId: { type: DataTypes.UUID, allowNull: true },
  plan: { type: DataTypes.STRING, allowNull: false },
  amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
  currency: { type: DataTypes.STRING(8), allowNull: false, defaultValue: "XOF" },
  provider: { type: DataTypes.STRING, allowNull: true },
  paymentReference: { type: DataTypes.STRING, allowNull: true },
  status: {
    type: DataTypes.ENUM("PENDING", "SUCCESS", "FAILED", "CANCELLED"),
    allowNull: false,
    defaultValue: "PENDING"
  },
  paidAt: { type: DataTypes.DATE, allowNull: true }
}, {
  tableName: "payments",
  timestamps: true
});

module.exports = Payment;
