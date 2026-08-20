const express = require("express");

const router = express.Router();

const AppUpdate = require("../models/AppUpdate");



// Dernière notification active

router.get("/latest", async(req,res)=>{


    try{


        const update = await AppUpdate.findOne({

            where:{
                active:true
            },

            order:[
                ["createdAt","DESC"]
            ]

        });



        if(!update){

            return res.json({
                update:null
            });

        }


        res.json(update);



    }catch(error){


        res.status(500).json({
            error:error.message
        });


    }


});





// Créer une notification

router.post("/", async(req,res)=>{


    try{


        const update = await AppUpdate.create({

            version:req.body.version,

            message:req.body.message,

            mandatory:req.body.mandatory || false

        });



        res.json({

            success:true,

            update

        });



    }catch(error){


        res.status(500).json({
            error:error.message
        });


    }


});



module.exports = router;