const { DataTypes } = require("sequelize");
const sequelize = require("../database/database");

const SubscriptionEvent = sequelize.define("SubscriptionEvent", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.UUID, allowNull: false },
  subscriptionId: { type: DataTypes.UUID, allowNull: true },
  action: {
    type: DataTypes.ENUM(
      "CREATED", "ACTIVATED", "EXTENDED", "PLAN_CHANGED", "GIFT_GRANTED",
      "EXPIRED", "CANCELLED", "USER_DISABLED", "USER_REACTIVATED", "USER_SUSPENDED"
    ),
    allowNull: false
  },
  actor: { type: DataTypes.STRING, allowNull: false, defaultValue: "SYSTEM" },
  reason: { type: DataTypes.TEXT, allowNull: true },
  beforeState: { type: DataTypes.JSONB, allowNull: true },
  afterState: { type: DataTypes.JSONB, allowNull: true }
}, {
  tableName: "subscription_events",
  timestamps: true,
  updatedAt: false
});

module.exports = SubscriptionEvent;
