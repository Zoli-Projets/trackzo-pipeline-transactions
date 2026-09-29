const { DataTypes } = require("sequelize");
const sequelize = require("../database/database");

const PaymentMethod = sequelize.define("PaymentMethod", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  code: { type: DataTypes.STRING(32), allowNull: false, unique: true },
  name: { type: DataTypes.STRING(80), allowNull: false },
  enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  recipient: { type: DataTypes.STRING(120), allowNull: true },
  merchantName: { type: DataTypes.STRING(120), allowNull: true },
  instructions: { type: DataTypes.TEXT, allowNull: true },
  sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 100 }
}, { tableName: "payment_methods", timestamps: true });

module.exports = PaymentMethod;
