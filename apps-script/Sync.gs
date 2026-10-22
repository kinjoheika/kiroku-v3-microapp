/**
 * Kiroku V4 sync — copies the Google Sheets tabs into Supabase.
 * Bound to a Google Sheet (or standalone): Extensions > Apps Script > paste this file.
 *
 * Setup: see supabase/SETUP.md (V4 section).
 *
 * Secrets and sheet IDs go in Project Settings > Script Properties, never in this file:
 *   SUPABASE_URL          https://<project-ref>.supabase.co
 *   SUPABASE_SERVICE_KEY  the service_role key (server-side only; bypasses row security)
 *   SHEET_ID_1 .. SHEET_ID_4   the Doc Officer 1..4 sheet IDs (from the sheet URL)
 *
 * Each Doc Officer sheet has the same six tabs. Job order IDs carry the officer's
 * prefix (u1-j1, u2-j1 ...), so the four sheets never overwrite each other.
 * Run syncAll() manually once, then installTrigger() to run it every 15 minutes.
 */

const TABS = { Users: 'users', Kumiai: 'kumiai', Companies: 'companies',
               JobOrders: 'job_orders', Tasks: 'tasks', Activity: 'activity' };

// owner = the editor_id whose tasks this sheet is allowed to import.
// Each sheet holds a copy of every task, so only the owner's rows are kept.
const SOURCES = [
  { key: 'doc-officer-1', idProp: 'SHEET_ID_1', owner: 'u1', tabs: TABS },
  { key: 'doc-officer-2', idProp: 'SHEET_ID_2', owner: 'u2', tabs: TABS },
  { key: 'doc-officer-3', idProp: 'SHEET_ID_3', owner: 'u3', tabs: TABS },
  { key: 'doc-officer-4', idProp: 'SHEET_ID_4', owner: 'u4', tabs: TABS },
];

// Sheet header -> table column, where they differ.
const RENAME = {
  tasks: { order: 'sort_order' },
};

const TZ = 'Asia/Manila';

function syncAll() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('SUPABASE_URL');
  const key = props.getProperty('SUPABASE_SERVICE_KEY');
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY in Script Properties.');

  SOURCES.forEach(src => {
    const sheetId = props.getProperty(src.idProp);
    if (!sheetId || Object.keys(src.tabs).length === 0) {
      Logger.log('skip ' + src.key + ' (no ID or no tabs configured)');
      return;
    }
    const payload = {};
    Object.entries(src.tabs).forEach(([tab, table]) => {
      payload[table] = readTab(sheetId, tab, table);
    });

    const res = UrlFetchApp.fetch(url + '/rest/v1/rpc/sync_import', {
      method: 'post',
      contentType: 'application/json',
      headers: { apikey: key, Authorization: 'Bearer ' + key },
      payload: JSON.stringify({ p_source: src.key, p_payload: payload }),
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() >= 300) {
      throw new Error(src.key + ' failed: ' + res.getContentText());
    }
    Logger.log(src.key + ': ' + res.getContentText());
  });
}

function readTab(sheetId, tab, table) {
  const sh = SpreadsheetApp.openById(sheetId).getSheetByName(tab);
  if (!sh) throw new Error('Tab "' + tab + '" not found in sheet ' + sheetId);

  const values = sh.getDataRange().getValues();
  const head = values.shift().map(h => String(h).trim());
  const rename = RENAME[table] || {};

  return values
    .filter(row => row.some(c => c !== ''))
    .map(row => {
      const obj = {};
      head.forEach((h, i) => {
        if (h) obj[rename[h] || h] = cell(row[i], h);
      });
      if (table === 'activity') {
        obj.activity_key = [obj.task_id, obj.type, obj.date, obj.time].join('|');
        obj.activity_date = obj.date;
        obj.activity_time = obj.time;
        delete obj.date;
        delete obj.time;
      }
      return obj;
    });
}

// One sheet cell -> JSON value Supabase accepts.
function cell(v, header) {
  if (v === '' || v === null) return null;
  if (v instanceof Date) {
    if (header === 'time') return Utilities.formatDate(v, TZ, 'HH:mm');
    const midnight = v.getHours() === 0 && v.getMinutes() === 0 && v.getSeconds() === 0;
    return Utilities.formatDate(v, TZ, midnight ? 'yyyy-MM-dd' : "yyyy-MM-dd'T'HH:mm:ssXXX");
  }
  // text timestamps like "2026-06-11 09:00" (done_at) are Philippine time
  if (/_at$/.test(header) && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(String(v))) {
    return String(v).replace(' ', 'T') + '+08:00';
  }
  return v;
}

// Run once: replaces any existing sync schedule with one that runs every 5 minutes.
// Google Apps Script allows only 1, 5, 10, 15 or 30 minutes.
function installTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncAll')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncAll').timeBased().everyMinutes(5).create();
}

// One-time rebuild: copy the full masterlist into each Doc Officer sheet.
// Each sheet then holds all 8 job orders with 18 steps each. Job order 9 is dropped,
// and Workers Unite (c5) is set to kumiai k2.
const MASTERLIST_ID = '1OcjPALavuFbnMdhoTTRtqppKyK94CIDCWord2Gqi6OA';

function rebuildSheetsFromMasterlist() {
  const master = SpreadsheetApp.openById(MASTERLIST_ID);
  const tables = {};
  Object.keys(TABS).forEach(tab => {
    tables[tab] = master.getSheetByName(tab).getDataRange().getValues();
  });

  // Fill blank step orders from the same track and task name (the masterlist has a few gaps).
  const t = tables.Tasks;
  const oh = t[0].indexOf('order'), th = t[0].indexOf('track'), nh = t[0].indexOf('task_name');
  const knownOrder = {};
  t.slice(1).forEach(r => { if (r[oh] !== '') knownOrder[r[th] + '|' + r[nh]] = r[oh]; });
  t.slice(1).forEach(r => { if (r[oh] === '') r[oh] = knownOrder[r[th] + '|' + r[nh]] || ''; });

  const jobs = tables.JobOrders;
  tables.JobOrders = [jobs[0]].concat(jobs.slice(1).filter(r => String(r[0]).trim() !== 'j9'));

  const comp = tables.Companies;
  if (comp.some(r => String(r[0]).trim() === 'c5')) {
    comp.forEach(r => { if (String(r[0]).trim() === 'c5') r[1] = 'k2'; });
  } else {
    comp.push(['c5', 'k2', 'Workers Unite']);
  }

  const props = PropertiesService.getScriptProperties();
  SOURCES.forEach(src => {
    const ss = SpreadsheetApp.openById(props.getProperty(src.idProp));
    Object.keys(TABS).forEach(tab => {
      const values = tables[tab];
      const sh = ss.getSheetByName(tab);
      sh.clearContents();
      sh.getRange(1, 1, values.length, values[0].length).setValues(values);
    });
    Logger.log(src.key + ': rebuilt');
  });
}
