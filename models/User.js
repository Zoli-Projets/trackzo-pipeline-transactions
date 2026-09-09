const { DataTypes } = require("sequelize");
const sequelize = require("../database/database");

const User = sequelize.define("User", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  phone: { type: DataTypes.STRING, unique: true, allowNull: false },
  phoneVerified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  email: { type: DataTypes.STRING, allowNull: true },
  emailVerified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  country: { type: DataTypes.STRING, defaultValue: "CI" },
  status: {
    type: DataTypes.ENUM("ACTIVE", "SUSPENDED", "DISABLED"),
    allowNull: false,
    defaultValue: "ACTIVE"
  },
  disabledReason: { type: DataTypes.TEXT, allowNull: true },
  disabledAt: { type: DataTypes.DATE, allowNull: true }
}, {
  tableName: "users",
  timestamps: true
});

module.exports = User;
