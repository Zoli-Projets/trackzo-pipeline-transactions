const { DataTypes } = require("sequelize");
const sequelize = require("../database/database");

const AccountDeletionRequest = sequelize.define("AccountDeletionRequest", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  identifier: { type: DataTypes.STRING, allowNull: false },
  contact: { type: DataTypes.STRING, allowNull: true },
  status: {
    type: DataTypes.ENUM("PENDING", "COMPLETED", "REJECTED"),
    allowNull: false,
    defaultValue: "PENDING"
  },
  source: {
    type: DataTypes.ENUM("WEB", "ADMIN"),
    allowNull: false,
    defaultValue: "WEB"
  },
  notes: { type: DataTypes.TEXT, allowNull: true },
  completedAt: { type: DataTypes.DATE, allowNull: true }
}, {
  tableName: "account_deletion_requests",
  timestamps: true,
  indexes: [
    { fields: ["status"] },
    { fields: ["createdAt"] }
  ]
});

module.exports = AccountDeletionRequest;
