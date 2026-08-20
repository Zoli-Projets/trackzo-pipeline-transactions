const { DataTypes } = require("sequelize");

const sequelize = require("../database/database");


const User = sequelize.define(
"User",

{

id:{
type:DataTypes.UUID,
defaultValue:DataTypes.UUIDV4,
primaryKey:true
},


name:{
type:DataTypes.STRING,
allowNull:false
},


phone:{
type:DataTypes.STRING,
unique:true,
allowNull:false
},


email:{
type:DataTypes.STRING
},


country:{
type:DataTypes.STRING,
defaultValue:"CI"
}

},

{
tableName:"users",
timestamps:true
}

);


module.exports = User;