const { DataTypes } = require("sequelize");
const sequelize = require("../database/database");


const Device = sequelize.define(

"Device",

{

id:{
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey:true
},


userId:{
    type:DataTypes.UUID,
    allowNull:false
},


deviceUuid:{
    type:DataTypes.STRING,
    unique:true,
    allowNull:false
},

authTokenHash:{
    type:DataTypes.STRING(64),
    unique:true,
    allowNull:true
},


deviceName:{
    type:DataTypes.STRING,
    allowNull:true
},


androidVersion:{
    type:DataTypes.STRING,
    allowNull:true
},


lastSeen:{
    type:DataTypes.DATE,
    defaultValue:DataTypes.NOW
},


active:{
    type:DataTypes.BOOLEAN,
    defaultValue:true
}

},


{

tableName:"devices",

timestamps:true

}

);


module.exports = Device;