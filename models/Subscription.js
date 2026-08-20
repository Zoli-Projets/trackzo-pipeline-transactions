const { DataTypes } = require("sequelize");
const sequelize = require("../database/database");


const Subscription = sequelize.define(

"Subscription",

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


plan:{
    type:DataTypes.ENUM(
        "TRIAL",
        "BASIC",
        "PRO",
        "ENTERPRISE"
    ),
    allowNull:false,
    defaultValue:"TRIAL"
},


type:{
    type:DataTypes.ENUM(
        "TRIAL",
        "PAID",
        "GIFT"
    ),
    allowNull:false,
    defaultValue:"TRIAL"
},


status:{
    type:DataTypes.ENUM(
        "ACTIVE",
        "EXPIRED",
        "CANCELLED"
    ),
    allowNull:false,
    defaultValue:"ACTIVE"
},


expiresAt:{
    type:DataTypes.DATE,
    allowNull:false
},


maxDevices:{
    type:DataTypes.INTEGER,
    defaultValue:1
},


paymentReference:{
    type:DataTypes.STRING,
    allowNull:true
}

},

{

tableName:"subscriptions",

timestamps:true

}

);


module.exports = Subscription;