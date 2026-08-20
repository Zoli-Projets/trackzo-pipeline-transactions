const { DataTypes } = require("sequelize");
const sequelize = require("../database/database");
const { encrypt, decrypt } = require("../utils/secretBox");


const GoogleAccount = sequelize.define(

"GoogleAccount",

{

id:{
    type:DataTypes.UUID,
    defaultValue:DataTypes.UUIDV4,
    primaryKey:true
},


userId:{
    type:DataTypes.UUID,
    allowNull:false,
    unique:true
},


googleEmail:{
    type:DataTypes.STRING,
    allowNull:false
},


refreshToken:{
    type:DataTypes.TEXT,
    allowNull:false
},


accessToken:{
    type:DataTypes.TEXT,
    allowNull:true
},

expiryDate:{
    type:DataTypes.BIGINT,
    allowNull:true
},

expiresAt:{
    type:DataTypes.DATE,
    allowNull:true
},

trackzoFolderId:{
    type:DataTypes.STRING,
    allowNull:true
},


dailyFolderId:{
    type:DataTypes.STRING,
    allowNull:true
},


reportsFolderId:{
    type:DataTypes.STRING,
    allowNull:true
},


},

{

tableName:"google_accounts",

timestamps:true

}

);


module.exports = GoogleAccount;