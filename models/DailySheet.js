const { DataTypes } = require("sequelize");
const sequelize = require("../database/database");

const DailySheet = sequelize.define(
    "DailySheet",
    {

        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true
        },

        userId: {
            type: DataTypes.UUID,
            allowNull: false
        },

        spreadsheetId: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true
        },

        spreadsheetName: {
            type: DataTypes.STRING,
            allowNull: false
        },

        date: {
            type: DataTypes.DATEONLY,
            allowNull: false
        },

        timezone: {
            type: DataTypes.STRING,
            allowNull: false
        },

        driveFolderId: {
            type: DataTypes.STRING,
            allowNull: false
        },

        url: {
            type: DataTypes.TEXT,
            allowNull: true
            
        },

        scriptId: {
             type: DataTypes.STRING,
             allowNull: true
        }

    },

    {
        tableName: "daily_sheets",
        timestamps: true,

        indexes: [

                {

                    unique: true,

                    fields: [
                        "userId",
                        "date"
                    ]

                }

            ]
    }
);

module.exports = DailySheet;