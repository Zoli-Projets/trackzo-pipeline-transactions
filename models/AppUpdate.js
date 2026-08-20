const { DataTypes } = require("sequelize");
const sequelize = require("../database/database");


const AppUpdate = sequelize.define(
    "AppUpdate",
    {

        version:{
            type:DataTypes.STRING,
            allowNull:false
        },


        message:{
            type:DataTypes.TEXT,
            allowNull:false
        },


        mandatory:{
            type:DataTypes.BOOLEAN,
            defaultValue:false
        },


        active:{
            type:DataTypes.BOOLEAN,
            defaultValue:true
        }

    },
    {
        tableName:"app_updates",
        timestamps:true
    }
);


module.exports = AppUpdate;