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

    // Keep only this officer's tasks, and the activity that belongs to them.
    if (payload.tasks) {
      payload.tasks = payload.tasks.filter(t => t.editor_id === src.owner);
      const kept = new Set(payload.tasks.map(t => t.task_id));
      if (payload.activity) payload.activity = payload.activity.filter(a => kept.has(a.task_id));
    }

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

function installTrigger() {
  ScriptApp.newTrigger('syncAll').timeBased().everyMinutes(15).create();
}
