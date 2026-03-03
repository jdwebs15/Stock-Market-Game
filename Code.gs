/**
 * STOCK MARKET ASSIGNMENT — Google Sheet Backend
 * - Receives START and ENTRY events via POST (text/plain JSON)
 * - Appends to RAW_LOG
 * - Rebuilds LATEST, LEADERBOARD, COMPLIANCE tabs after each write
 * - Provides GET endpoints: ?fn=leaderboard or ?fn=compliance
 */

/** ====== CONFIG (YOU MUST SET) ====== */
const CLASS_CODE = "STOCK6WEEK"; // must match the HTML
// If you bind this script to the Sheet (recommended), you don't need SPREADSHEET_ID.
// If you deploy as standalone and want to target a Sheet, set SPREADSHEET_ID.
const SPREADSHEET_ID = ""; // optional; leave blank for bound script

/** ====== SHEET NAMES ====== */
const SHEETS = {
  RAW: "RAW_LOG",
  LATEST: "LATEST",
  LEADERBOARD: "LEADERBOARD",
  COMPLIANCE: "COMPLIANCE"
};

/** ====== RAW_LOG HEADERS ====== */
const RAW_HEADERS = [
  "serverTimestampISO",
  "type",                 // START | ENTRY
  "classCode",
  "studentKey",
  "studentName",
  "period",
  "teacher",
  "startedAtISO",
  "startedAtLocal",
  "totalInvested",
  "tickersCSV",
  "categoriesCSV",
  "portfolioJSON",        // full portfolio array as JSON
  "entryDateISO",         // ENTRY only
  "entrySavedAtISO",      // ENTRY only
  "entrySavedAtLocal",    // ENTRY only
  "pricesJSON",           // ENTRY only
  "portfolioValue",       // ENTRY only
  "gainLoss",             // ENTRY only
  "entriesCount",         // ENTRY only
  "userAgent"
];

function doGet(e){
  const params = e && e.parameter ? e.parameter : {};
  const fn = (params.fn || "").toLowerCase();
  const classCode = (params.classCode || "").trim();

  if(classCode !== CLASS_CODE){
    return jsonOut({ ok:false, error:"Bad class code" });
  }

  const ss = getSS_();
  ensureSheets_(ss);

  if(fn === "leaderboard"){
    const data = readLeaderboard_(ss);
    return jsonOut({ ok:true, data });
  }
  if(fn === "compliance"){
    const data = readCompliance_(ss);
    return jsonOut({ ok:true, data });
  }

  return jsonOut({ ok:false, error:"Unknown fn" });
}

function doPost(e){
  try{
    const txt = e && e.postData ? e.postData.contents : "";
    const payload = JSON.parse(txt || "{}");

    if((payload.classCode || "").trim() !== CLASS_CODE){
      return jsonOut({ ok:false, error:"Bad class code" });
    }

    const ss = getSS_();
    ensureSheets_(ss);

    const type = (payload.type || "").toUpperCase();
    if(type !== "START" && type !== "ENTRY"){
      return jsonOut({ ok:false, error:"Bad type" });
    }

    appendRaw_(ss, payload);
    rebuildSummaryTabs_(ss);

    return jsonOut({ ok:true });
  }catch(err){
    return jsonOut({ ok:false, error:String(err) });
  }
}

/** ====== Helpers ====== */

function getSS_(){
  if(SPREADSHEET_ID && SPREADSHEET_ID.trim()){
    return SpreadsheetApp.openById(SPREADSHEET_ID.trim());
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}

function ensureSheets_(ss){
  Object.values(SHEETS).forEach(name=>{
    if(!ss.getSheetByName(name)) ss.insertSheet(name);
  });

  // RAW header ensure
  const raw = ss.getSheetByName(SHEETS.RAW);
  const firstRow = raw.getRange(1,1,1,RAW_HEADERS.length).getValues()[0];
  const needsHeader = firstRow.join("|").trim() !== RAW_HEADERS.join("|");
  if(needsHeader){
    raw.clear();
    raw.getRange(1,1,1,RAW_HEADERS.length).setValues([RAW_HEADERS]);
    raw.setFrozenRows(1);
  }
}

function appendRaw_(ss, payload){
  const raw = ss.getSheetByName(SHEETS.RAW);

  const now = new Date();
  const serverISO = now.toISOString();

  const student = payload.student || {};
  const startedAt = payload.startedAt || {};
  const portfolio = payload.portfolio || [];

  const tickersCSV = portfolio.map(p=>p.ticker).join(",");
  const categoriesCSV = portfolio.map(p=>p.category).join(",");

  const entry = payload.entry || {};
  const pricesJSON = entry.prices ? JSON.stringify(entry.prices) : "";

  const row = [];
  row.push(serverISO);
  row.push((payload.type || "").toUpperCase());
  row.push(payload.classCode || "");
  row.push(payload.studentKey || "");
  row.push(student.name || "");
  row.push(student.classPeriod || "");
  row.push(student.teacher || "");
  row.push(startedAt.iso || "");
  row.push(startedAt.local || "");
  row.push(payload.totalInvested != null ? Number(payload.totalInvested) : "");
  row.push(tickersCSV);
  row.push(categoriesCSV);
  row.push(JSON.stringify(portfolio));

  // ENTRY fields
  row.push(entry.dateISO || "");
  row.push(entry.savedAt?.iso || "");
  row.push(entry.savedAt?.local || "");
  row.push(pricesJSON);
  row.push(entry.value != null ? Number(entry.value) : "");
  row.push(entry.gain != null ? Number(entry.gain) : "");
  row.push(entry.entriesCount != null ? Number(entry.entriesCount) : "");
  row.push(payload.meta?.userAgent || "");

  raw.appendRow(row);
}

function rebuildSummaryTabs_(ss){
  const raw = ss.getSheetByName(SHEETS.RAW);
  const values = raw.getDataRange().getValues();
  if(values.length <= 1) {
    writeTab_(ss.getSheetByName(SHEETS.LATEST), ["No data yet"], []);
    writeTab_(ss.getSheetByName(SHEETS.LEADERBOARD), ["No data yet"], []);
    writeTab_(ss.getSheetByName(SHEETS.COMPLIANCE), ["No data yet"], []);
    return;
  }

  const headers = values[0];
  const rows = values.slice(1);

  // Column indices
  const idx = {};
  headers.forEach((h,i)=> idx[h]=i);

  // Reduce by studentKey
  const by = new Map();

  rows.forEach(r=>{
    const studentKey = String(r[idx.studentKey] || "").trim();
    if(!studentKey) return;

    const type = String(r[idx.type] || "").toUpperCase();
    const name = String(r[idx.studentName] || "");
    const period = String(r[idx.period] || "");
    const teacher = String(r[idx.teacher] || "");
    const startedAtISO = String(r[idx.startedAtISO] || "");
    const startedAtLocal = String(r[idx.startedAtLocal] || "");
    const totalInvested = r[idx.totalInvested] !== "" ? Number(r[idx.totalInvested]) : null;

    const tickersCSV = String(r[idx.tickersCSV] || "");
    const categoriesCSV = String(r[idx.categoriesCSV] || "");
    const portfolioJSON = String(r[idx.portfolioJSON] || "");

    const entryDateISO = String(r[idx.entryDateISO] || "");
    const entrySavedAtLocal = String(r[idx.entrySavedAtLocal] || "");
    const portfolioValue = r[idx.portfolioValue] !== "" ? Number(r[idx.portfolioValue]) : null;
    const gainLoss = r[idx.gainLoss] !== "" ? Number(r[idx.gainLoss]) : null;

    let rec = by.get(studentKey);
    if(!rec){
      rec = {
        studentKey, name, period, teacher,
        startedAtISO, startedAtLocal,
        totalInvested,
        tickersCSV, categoriesCSV, portfolioJSON,
        entriesCount: 0,
        lastEntryDate: "",
        lastEntrySavedAtLocal: "",
        lastValue: null,
        gain: null
      };
      by.set(studentKey, rec);
    }

    // Update portfolio info if START shows up later
    if(type === "START"){
      rec.startedAtISO = startedAtISO || rec.startedAtISO;
      rec.startedAtLocal = startedAtLocal || rec.startedAtLocal;
      rec.totalInvested = (totalInvested!=null) ? totalInvested : rec.totalInvested;
      rec.tickersCSV = tickersCSV || rec.tickersCSV;
      rec.categoriesCSV = categoriesCSV || rec.categoriesCSV;
      rec.portfolioJSON = portfolioJSON || rec.portfolioJSON;
    }

    if(type === "ENTRY"){
      rec.entriesCount = Math.max(rec.entriesCount, 0) + 1; // count entries rows
      // determine last by date ISO, tie-break by server time not needed
      if(entryDateISO && entryDateISO >= (rec.lastEntryDate || "")){
        rec.lastEntryDate = entryDateISO;
        rec.lastEntrySavedAtLocal = entrySavedAtLocal;
        rec.lastValue = portfolioValue;
        rec.gain = gainLoss;
      }
    }
  });

  const arr = Array.from(by.values());

  // LATEST tab (one row per student)
  const latestHeaders = [
    "studentKey","name","period","teacher","startedAtLocal",
    "entriesCount","lastEntryDate","lastEntrySavedAtLocal",
    "totalInvested","tickersCSV","categoriesCSV","lastValue","gain"
  ];
  const latestRows = arr
    .sort((a,b)=> (a.period||"").localeCompare(b.period||"") || (a.name||"").localeCompare(b.name||""))
    .map(r=>[
      r.studentKey, r.name, r.period, r.teacher, r.startedAtLocal,
      r.entriesCount, r.lastEntryDate, r.lastEntrySavedAtLocal,
      r.totalInvested, r.tickersCSV, r.categoriesCSV, r.lastValue, r.gain
    ]);

  writeTab_(ss.getSheetByName(SHEETS.LATEST), latestHeaders, latestRows);

  // LEADERBOARD tab (sorted by gain desc)
  const leaderboardHeaders = ["rank","name","period","entriesCount","lastEntryDate","lastValue","gain"];
  const leaderboardRows = arr
    .slice()
    .sort((a,b)=>{
      const ga = (typeof a.gain === "number") ? a.gain : -Infinity;
      const gb = (typeof b.gain === "number") ? b.gain : -Infinity;
      return gb - ga;
    })
    .map((r,i)=>[
      i+1, r.name, r.period, r.entriesCount, r.lastEntryDate, r.lastValue, r.gain
    ]);

  writeTab_(ss.getSheetByName(SHEETS.LEADERBOARD), leaderboardHeaders, leaderboardRows);

  // COMPLIANCE tab (track entries 0–6 and last date)
  const complianceHeaders = ["name","period","startedAtLocal","entriesCount","lastEntryDate","lastValue","gain"];
  const complianceRows = arr
    .slice()
    .sort((a,b)=> (a.period||"").localeCompare(b.period||"") || (a.name||"").localeCompare(b.name||""))
    .map(r=>[
      r.name, r.period, r.startedAtLocal, r.entriesCount, r.lastEntryDate, r.lastValue, r.gain
    ]);

  writeTab_(ss.getSheetByName(SHEETS.COMPLIANCE), complianceHeaders, complianceRows);
}

function writeTab_(sheet, headers, rows){
  sheet.clear();
  if(headers && headers.length){
    sheet.getRange(1,1,1,headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  if(rows && rows.length){
    sheet.getRange(2,1,rows.length,headers.length).setValues(rows);
  }
  sheet.autoResizeColumns(1, Math.max(1, headers.length));
}

function readLeaderboard_(ss){
  const sh = ss.getSheetByName(SHEETS.LEADERBOARD);
  const values = sh.getDataRange().getValues();
  if(values.length <= 1) return [];
  const h = values[0];
  const rows = values.slice(1);
  const idx = {};
  h.forEach((x,i)=>idx[x]=i);

  return rows
    .filter(r=>r[idx.name])
    .map(r=>({
      name: r[idx.name],
      period: r[idx.period],
      entriesCount: Number(r[idx.entriesCount] || 0),
      lastEntryDate: r[idx.lastEntryDate] || "",
      lastValue: (r[idx.lastValue] === "" ? null : Number(r[idx.lastValue])),
      gain: (r[idx.gain] === "" ? null : Number(r[idx.gain]))
    }));
}

function readCompliance_(ss){
  const sh = ss.getSheetByName(SHEETS.COMPLIANCE);
  const values = sh.getDataRange().getValues();
  if(values.length <= 1) return [];
  const h = values[0];
  const rows = values.slice(1);
  const idx = {};
  h.forEach((x,i)=>idx[x]=i);

  return rows
    .filter(r=>r[idx.name])
    .map(r=>({
      name: r[idx.name],
      period: r[idx.period],
      startedAtLocal: r[idx.startedAtLocal] || "",
      entriesCount: Number(r[idx.entriesCount] || 0),
      lastEntryDate: r[idx.lastEntryDate] || "",
      lastValue: (r[idx.lastValue] === "" ? null : Number(r[idx.lastValue])),
      gain: (r[idx.gain] === "" ? null : Number(r[idx.gain]))
    }));
}

function jsonOut(obj){
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
