const express = require("express");
const router = express.Router();

const Template = require("../models/Template");


// Récupérer le modèle actif
router.get("/active", async (req,res)=>{

    try{

        const template = await Template.findOne({
            where:{
                active:true
            }
        });


        if(!template){

            return res.status(404).json({
                error:"Aucun modèle actif"
            });

        }


        res.json(template);


    }catch(error){

        console.error(error);

        res.status(500).json({
            error:error.message
        });

    }

});



// Ajouter un nouveau modèle
router.post("/", async(req,res)=>{


    try{


        const {
            version,
            googleFileId,
            description
        } = req.body;



        const template = await Template.create({

            version,

            googleFileId,

            description,

            active:false

        });



        res.json({

            success:true,

            template

        });



    }catch(error){

        res.status(500).json({
            error:error.message
        });

    }


});




// Activer une version
router.put("/:id/activate", async(req,res)=>{


    try{


        // Désactiver tous les anciens modèles

        await Template.update(
            {
                active:false
            },
            {
                where:{}
            }
        );



        // Activer le nouveau

        await Template.update(

            {
                active:true
            },

            {
                where:{
                    id:req.params.id
                }
            }

        );



        res.json({

            success:true,

            message:"Modèle activé"

        });



    }catch(error){


        res.status(500).json({
            error:error.message
        });


    }


});



module.exports = router;