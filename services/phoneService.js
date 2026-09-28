const COUNTRY_DIAL_CODES = Object.freeze({
  CI: "225", FR: "33", BE: "32", CH: "41", CA: "1", US: "1",
  SN: "221", ML: "223", BF: "226", GN: "224", TG: "228", BJ: "229",
  NE: "227", GH: "233", NG: "234", CM: "237", GA: "241", CG: "242",
  CD: "243", MA: "212", DZ: "213", TN: "216", RW: "250", KE: "254",
  UG: "256", TZ: "255", ZA: "27", MG: "261", MU: "230", GB: "44"
});

function normalizeInternationalPhone(value, country = null) {
  let phone = String(value || "").trim().replace(/[\s().-]/g, "");
  if (phone.startsWith("00")) phone = `+${phone.slice(2)}`;

  if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
    const error = new Error("Numéro invalide : utilisez le format international avec indicatif pays (ex. +2250700000000)");
    error.code = "INVALID_PHONE_FORMAT";
    throw error;
  }

  const iso = country ? String(country).trim().toUpperCase() : null;
  const expectedDial = iso ? COUNTRY_DIAL_CODES[iso] : null;
  if (expectedDial && !phone.slice(1).startsWith(expectedDial)) {
    const error = new Error(`Le numéro ne correspond pas à l’indicatif du pays sélectionné (+${expectedDial})`);
    error.code = "PHONE_COUNTRY_MISMATCH";
    throw error;
  }
  return phone;
}

module.exports = { normalizeInternationalPhone, COUNTRY_DIAL_CODES };
