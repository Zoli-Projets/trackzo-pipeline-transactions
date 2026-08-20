const {DataTypes}=require("sequelize");
const sequelize = require("../database/database");


const UserSettings=sequelize.define(
"UserSettings",
{

id:{
type:DataTypes.UUID,
defaultValue:DataTypes.UUIDV4,
primaryKey:true
},


userId:{
type:DataTypes.UUID,
allowNull:false
},


companyName:{
type:DataTypes.STRING
},

country:{
 type:DataTypes.STRING,
 defaultValue:"CI"
},

openingTime:{
type:DataTypes.STRING,
defaultValue:"08:00"
},


closingTime:{
type:DataTypes.STRING,
defaultValue:"22:00"
},

dailySheetCreation: {
    type: DataTypes.STRING,
    defaultValue: "00:05"
},

timezone:{
type:DataTypes.STRING,
defaultValue:"Africa/Abidjan"
},

scriptId:{
 type:DataTypes.STRING,
 allowNull:true
},

agentToken: {
    type: DataTypes.TEXT,
    allowNull: true,
    unique: true
},

// ID du Google Sheet personnel de l'utilisateur
sheetId:{
type:DataTypes.STRING,
allowNull:true
},


// URL complète du fichier
sheetUrl:{
type:DataTypes.TEXT,
allowNull:true
},


// Nom du fichier créé
sheetName:{
type:DataTypes.STRING,
allowNull:true
},


// Indique si la copie utilisateur existe
sheetCreated:{
type:DataTypes.BOOLEAN,
defaultValue:false
},


// Version du modèle utilisé
lastTemplateVersion:{
type:DataTypes.STRING,
defaultValue:"1.0"
},


// Modèle Trackzo utilisé
templateId:{
type:DataTypes.UUID,
allowNull:true
}

},


{
tableName:"user_settings",
timestamps:true
}


);


module.exports=UserSettings;