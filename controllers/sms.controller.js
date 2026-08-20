const SmsService = require("../services/SmsService");
const { requireAuth } = require("../middleware/auth");

exports.sendSms = [requireAuth, async(req,res)=>{

    try{

        await SmsService.send({ ...req.body, userId: req.user.id });

        res.json({
            success:true
        });

    }catch(err){

        const status = /incomplètes|introuvables|non connecté/i.test(err.message) ? 400 : 500;
        res.status(status).json({
            success: false,
            error:err.message
        });

    }

}]