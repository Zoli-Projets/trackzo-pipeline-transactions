const crypto = require("crypto");
const sequelize = require("../database/database");
const Payment = require("../models/Payment");
const PaymentMethod = require("../models/PaymentMethod");
const Subscription = require("../models/Subscription");
const SubscriptionEvent = require("../models/SubscriptionEvent");
const User = require("../models/User");
const { PLAN_CONFIG } = require("../config/plans");

const DEFAULT_METHODS = [
  { code: "WAVE_MANUAL", name: "Wave", sortOrder: 10 },
  { code: "ORANGE_MONEY", name: "Orange Money", sortOrder: 20 },
  { code: "MTN_MOMO", name: "MTN MoMo", sortOrder: 30 },
  { code: "MOOV_MONEY", name: "Moov Money", sortOrder: 40 }
];

function makeReference() { return `TZM-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`; }
function clean(v, max = 500) { const s = String(v || "").trim(); return s ? s.slice(0, max) : null; }
function json(p) { return { reference:p.paymentReference,plan:p.plan,amount:Number(p.amount),currency:p.currency,provider:p.provider,status:p.status,operatorReference:p.operatorReference,submittedAt:p.submittedAt,reviewedAt:p.reviewedAt,failureReason:p.failureReason }; }

async function ensureDefaults() {
  for (const m of DEFAULT_METHODS) await PaymentMethod.findOrCreate({ where:{code:m.code}, defaults:{...m,enabled:false} });
}
async function publicMethods() {
  await ensureDefaults();
  const rows=await PaymentMethod.findAll({where:{enabled:true},order:[["sortOrder","ASC"]]});
  return rows.filter(r=>r.recipient).map(r=>({code:r.code,name:r.name,recipient:r.recipient,merchantName:r.merchantName,instructions:r.instructions}));
}
async function allMethods() { await ensureDefaults(); return PaymentMethod.findAll({order:[["sortOrder","ASC"]]}); }
async function saveMethod(code, body) {
  await ensureDefaults(); const row=await PaymentMethod.findOne({where:{code:String(code).toUpperCase()}}); if(!row) throw new Error("Moyen de paiement inconnu");
  const enabled=body.enabled===true || body.enabled==="true";
  const recipient=clean(body.recipient,120);
  if(enabled && !recipient) throw new Error("Le numéro/compte destinataire est obligatoire avant activation");
  await row.update({enabled,recipient,merchantName:clean(body.merchantName,120),instructions:clean(body.instructions,1000)}); return row;
}
async function createManualPayment(userId, requestedPlan, methodCode) {
  const plan=String(requestedPlan||"").toUpperCase(); const cfg=PLAN_CONFIG[plan]; if(!cfg||!cfg.purchasable) throw new Error("Formule non disponible au paiement");
  await ensureDefaults(); const method=await PaymentMethod.findOne({where:{code:String(methodCode||"").toUpperCase(),enabled:true}}); if(!method||!method.recipient) throw new Error("Ce moyen de paiement n’est pas disponible");
  const p=await Payment.create({userId,plan,amount:cfg.price,currency:cfg.currency,provider:`MANUAL:${method.code}`,paymentReference:makeReference(),status:"PENDING"});
  return {...json(p),method:{code:method.code,name:method.name,recipient:method.recipient,merchantName:method.merchantName,instructions:method.instructions}};
}
async function submitReference(userId, ref, operatorReference) {
  const op=clean(operatorReference,160); if(!op||op.length<4) throw new Error("Référence de transaction invalide");
  const p=await Payment.findOne({where:{userId,paymentReference:ref}}); if(!p||!String(p.provider).startsWith("MANUAL:")) throw new Error("Paiement manuel introuvable");
  if(p.status!=="PENDING") throw new Error("Ce paiement a déjà été traité");
  const duplicate=await Payment.findOne({where:{operatorReference:op}}); if(duplicate&&duplicate.id!==p.id) throw new Error("Cette référence de transaction a déjà été utilisée");
  await p.update({operatorReference:op,submittedAt:new Date(),failureReason:null}); return json(p);
}
async function listPending() {
  return Payment.findAll({where:{status:"PENDING",submittedAt:{[require("sequelize").Op.ne]:null}},include:[{model:User,as:"user",attributes:["id","name","phone","email"]}],order:[["submittedAt","ASC"]]});
}
async function approve(id, actor, note) {
  return sequelize.transaction(async transaction=>{
    const p=await Payment.findByPk(id,{transaction,lock:transaction.LOCK.UPDATE}); if(!p||!String(p.provider).startsWith("MANUAL:")) throw new Error("Paiement manuel introuvable");
    if(p.status==="SUCCESS") return p; if(p.status!=="PENDING"||!p.submittedAt||!p.operatorReference) throw new Error("Paiement non soumis ou déjà traité");
    const cfg=PLAN_CONFIG[p.plan]; if(!cfg||Number(p.amount)!==Number(cfg.price)||p.currency!==cfg.currency) throw new Error("Montant du paiement incohérent");
    let sub=await Subscription.findOne({where:{userId:p.userId},transaction,lock:transaction.LOCK.UPDATE}); const before=sub?sub.toJSON():null; const now=new Date(); const active=sub&&sub.status==="ACTIVE"&&new Date(sub.expiresAt)>now; const base=active?new Date(sub.expiresAt):now; const expiresAt=new Date(base.getTime()+cfg.durationDays*86400000);
    const fields={plan:p.plan,type:"PAID",status:"ACTIVE",startsAt:active?(sub.startsAt||now):now,expiresAt,maxDevices:cfg.maxDevices,paymentProvider:p.provider,paymentReference:p.paymentReference};
    if(!sub) sub=await Subscription.create({userId:p.userId,...fields},{transaction}); else await sub.update(fields,{transaction});
    await p.update({status:"SUCCESS",subscriptionId:sub.id,paidAt:now,reviewedAt:now,reviewNote:clean(note,1000),failureReason:null},{transaction});
    await SubscriptionEvent.create({userId:p.userId,subscriptionId:sub.id,action:before&&active?(before.plan===p.plan?"EXTENDED":"PLAN_CHANGED"):"ACTIVATED",actor:actor||"ADMIN",reason:`Paiement manuel vérifié ${p.paymentReference} / ${p.operatorReference}`,beforeState:before,afterState:sub.toJSON()},{transaction});
    return p;
  });
}
async function reject(id, actor, note) {
  const reason=clean(note,1000); if(!reason) throw new Error("Motif de rejet obligatoire"); const p=await Payment.findByPk(id); if(!p||!String(p.provider).startsWith("MANUAL:")) throw new Error("Paiement manuel introuvable"); if(p.status!=="PENDING") throw new Error("Paiement déjà traité"); await p.update({status:"FAILED",failureReason:`Rejeté par ${actor||"ADMIN"}: ${reason}`,reviewedAt:new Date(),reviewNote:reason}); return p;
}
module.exports={publicMethods,allMethods,saveMethod,createManualPayment,submitReference,listPending,approve,reject};
