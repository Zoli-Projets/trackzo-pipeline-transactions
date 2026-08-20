const { DataTypes } = require("sequelize");
const sequelize = require("../database/database");


const Template = sequelize.define(
    "Template",
    {

        id:{
            type:DataTypes.UUID,
            defaultValue:DataTypes.UUIDV4,
            primaryKey:true
        },


        version: {
            type: DataTypes.STRING,
            allowNull:false
        },


        googleFileId:{
            type:DataTypes.STRING,
            allowNull:false
        },


        active:{
            type:DataTypes.BOOLEAN,
            defaultValue:false
        },


        description:{
            type:DataTypes.TEXT,
            allowNull:true
        }

    },
    {
        tableName:"templates",
        timestamps:true
    }
);


module.exports = Template;