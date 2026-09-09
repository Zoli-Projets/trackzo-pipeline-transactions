const { DataTypes } = require("sequelize");
const sequelize = require("../database/database");

const VerificationCode = sequelize.define("VerificationCode", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.UUID, allowNull: false },
  channel: { type: DataTypes.ENUM("EMAIL", "PHONE"), allowNull: false },
  target: { type: DataTypes.STRING, allowNull: false },
  purpose: {
    type: DataTypes.ENUM("LOGIN_NEW_DEVICE", "VERIFY_EMAIL", "VERIFY_PHONE", "CHANGE_PHONE", "CHANGE_EMAIL"),
    allowNull: false
  },
  codeHash: { type: DataTypes.STRING(64), allowNull: false },
  expiresAt: { type: DataTypes.DATE, allowNull: false },
  consumedAt: { type: DataTypes.DATE, allowNull: true },
  attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  metadata: { type: DataTypes.JSONB, allowNull: true }
}, {
  tableName: "verification_codes",
  timestamps: true
});

module.exports = VerificationCode;
