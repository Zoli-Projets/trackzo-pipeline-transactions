 require('dotenv').config();

const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');
const fetch = require('node-fetch');

const app = express();
 
// ==========================
// MIDDLEWARES
// ==========================

app.use(cors());

app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false, limit: '256kb' }));
app.use(express.static('.') );

// ==========================
// DATABASE
// ==========================

const sequelize = require("./database/database");
 
require("./models/User");
require("./models/Device");
require("./models/Subscription");
require("./models/UserSettings");
require("./models/Template");
require("./models/GoogleAccount");
require("./models/DailySheet");
require("./models/AppUpdate");
require("./models/SmsReceipt");
require("./models/associations");


// ==========================
// ROUTES
// ==========================

 
 
const templateRoutes = require("./routes/templates");
const updateRoutes = require("./routes/updates");
const authRoutes =require("./routes/auth");
const googleRoutes=require("./routes/google");
const trackzoRoutes =require("./routes/trackzo");
const dashboardRoutes =require("./routes/dashboard");
const smsController = require("./controllers/sms.controller");



 
app.use("/api/auth",authRoutes);
app.use("/api/templates", templateRoutes);
app.use("/api/updates", updateRoutes);
app.use("/api/google",googleRoutes);
app.use("/api/trackzo",trackzoRoutes);
app.use("/api/dashboard",dashboardRoutes);
app.post("/sms/send", smsController.sendSms);
  


const PORT = process.env.PORT || 3000;


// ========== CONFIGURATION ==========
const CONFIG = {
  WAVE_NUMBER: process.env.WAVE_NUMBER,
  GOOGLE_SCRIPT_URL: process.env.GOOGLE_SCRIPT_URL,
  features: {
    mobile_wave_payment: true,
    advanced_stats: false,
    batch_processing: true
  },
  
plans:{

trial:{
name:"Essai gratuit",
price:0,
duration:7,
devices:1
},

basic:{
name:"Basic",
price:3000,
duration:30,
devices:1
},

pro:{
name:"Pro",
price:9000,
duration:30,
devices:3
},

enterprise:{
name:"Enterprise",
price:30000,
duration:365,
devices:10
}

}

};


// ========== STOCKAGE TEMPORAIRE ==========
 

function generateReference() {
  return `MMP-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}



// ========== COMPATIBILITÉ POUR L'APPLICATION MOBILE ==========
 

// Ajouter aussi /plans (sans /api/v1/) pour compatibilité
app.get('/plans', (req, res) => {
  res.json({
    success: true,
    plans: CONFIG.plans,
    version: 'v1.0.0'
  });
});


const {
    finalizeTrackzoSchema
} = require("./database/migrations/finalize_trackzo_schema");


async function initDatabase() {

    try {

        await sequelize.authenticate();

        console.log(
            "✅ Base Trackzo connectée"
        );


        // ======================================
        // CRÉATION DES TABLES MANQUANTES
        // ======================================

        await sequelize.sync({
            force: false
        });


        console.log(
            "✅ Tables SQL vérifiées"
        );


        // ======================================
        // MIGRATION DES COLONNES MANQUANTES
        // ======================================

        await finalizeTrackzoSchema(
            sequelize
        );


        console.log(
            "✅ Schéma Trackzo à jour"
        );

        // ======================================
        // MODÈLE TRACKZO DE RÉFÉRENCE
        // ======================================
        // La nouvelle base peut être vide alors que le modèle existe
        // toujours dans Google Drive. On réenregistre donc automatiquement
        // son ID comme modèle actif.
        const Template = require("./models/Template");
        const MASTER_TEMPLATE_FILE_ID =
            process.env.TRACKZO_TEMPLATE_FILE_ID ||
            "1jiUAdTSxs_xPSlHsolVIAN5roXNh3inp6UFSjOST3GI";

        const [template] = await Template.findOrCreate({
            where: { googleFileId: MASTER_TEMPLATE_FILE_ID },
            defaults: {
                version: process.env.TRACKZO_TEMPLATE_VERSION || "1.0",
                googleFileId: MASTER_TEMPLATE_FILE_ID,
                active: true,
                description: "Modèle Trackzo"
            }
        });

        if (!template.active) {
            await Template.update(
                { active: false },
                { where: {} }
            );
            await template.update({ active: true });
        }

        console.log(
            "📄 Modèle Trackzo actif :",
            template.googleFileId
        );


    }
    catch (error) {

        console.error(
            "❌ Erreur PostgreSQL:",
            error
        );

        throw error;

    }

}

// ========== DÉMARRAGE ==========
async function startServer() {
    try {
        await initDatabase();

        app.listen(PORT, () => {
            console.log(`
╔════════════════════════════════╗
║ Trackzo Backend                ║
╠════════════════════════════════╣
║ 🚀 Serveur actif               ║
║ 💳 Paiement Wave actif         ║
║ 👤 Gestion utilisateurs        ║
║ 📱 Gestion appareils           ║
║ 📄 Gestion templates           ║
╚════════════════════════════════╝
`);
        });

    } catch (error) {
        console.error("❌ Impossible de démarrer Trackzo:", error);
        process.exit(1);
    }
}

startServer();


// ========== PING ENDPOINT (pour réveiller l'API) ==========
// À ajouter dans server.js

app.get('/api/ping', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: Date.now(),
    message: 'API Mobile Money Pro active'
  });
});