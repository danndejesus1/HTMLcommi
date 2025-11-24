/**
 * Google Apps Script Web App for storing users (and profile pictures) in a Google Sheet
 *
 * - POST (JSON) -> adds a user row and optionally saves avatar to Drive
 * - GET -> returns all users as JSON
 *
 * Expected POST JSON shape:
 * {
 *   fullname, username, email, hash, phone, dob, gender, address,
 *   avatar: "data:image/png;base64,..."  // optional
 *   apiKey: "optional-api-key-if-configured"
 * }
 */

const SHEET_NAME = 'Users';
const DRIVE_FOLDER_NAME = 'HTMLMarga';

function doGet(e){
  try{
    // Debug logging
    Logger.log('doGet called with e: ' + JSON.stringify(e));
    
    // Special action: return image data as base64 JSON for embedding when Drive sharing
    // is restricted. Call with `?action=getImage&id=FILE_ID`.
    const action = (e && e.parameter && e.parameter.action) ? String(e.parameter.action) : '';
    const fileId = (e && e.parameter && e.parameter.id) ? String(e.parameter.id) : '';
    
    Logger.log('action: ' + action + ', fileId: ' + fileId);
    
    if(action === 'getImage' && fileId){
      Logger.log('Processing getImage request for fileId: ' + fileId);
      try{
        const file = DriveApp.getFileById(fileId);
        const blob = file.getBlob();
        const b64 = Utilities.base64Encode(blob.getBytes());
        const mime = blob.getContentType() || 'image/png';
        Logger.log('Successfully encoded image, mime: ' + mime);
        return ContentService.createTextOutput(JSON.stringify({ dataUrl: 'data:' + mime + ';base64,' + b64 })).setMimeType(ContentService.MimeType.JSON);
      }catch(err){
        Logger.log('getImage error: ' + String(err));
        return ContentService.createTextOutput(JSON.stringify({ error: 'getImage failed: ' + String(err) })).setMimeType(ContentService.MimeType.JSON);
      }
    }
    
    Logger.log('Falling back to users list');
    // Default: return users list
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAME);
    if(!sheet) return ContentService.createTextOutput(JSON.stringify([])).setMimeType(ContentService.MimeType.JSON);
    const data = sheet.getDataRange().getValues();
    if(!data || data.length < 1) return ContentService.createTextOutput(JSON.stringify([])).setMimeType(ContentService.MimeType.JSON);
    const headers = data.shift() || [];
    if(!headers || headers.length === 0) return ContentService.createTextOutput(JSON.stringify([])).setMimeType(ContentService.MimeType.JSON);
    const rows = data.map(r => {
      const obj = {};
      headers.forEach((h,i)=> obj[h] = r[i]);
      return obj;
    });
    return ContentService.createTextOutput(JSON.stringify(rows)).setMimeType(ContentService.MimeType.JSON);
  }catch(err){
    return ContentService.createTextOutput(JSON.stringify({error: String(err)})).setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e){
  try{
    const raw = e.postData && e.postData.contents ? e.postData.contents : null;
    if(!raw) return _json({ error: 'No POST body' }, 400);
    const payload = JSON.parse(raw);

    // Optional API key check (set in Script Properties if desired)
    const requiredKey = PropertiesService.getScriptProperties().getProperty('API_KEY');
    if(requiredKey){
      if(!payload.apiKey || payload.apiKey !== requiredKey){
        return _json({ error: 'Invalid API key' }, 401);
      }
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAME);
    if(!sheet){
      sheet = ss.insertSheet(SHEET_NAME);
      // header row
      sheet.appendRow(['timestamp','fullname','username','email','hash','phone','dob','gender','address','avatarUrl']);
    }

    // Simple duplicate check (guard when there are no existing data rows)
    const lastRow = sheet.getLastRow();
    let existing = [];
    if(lastRow >= 2){
      existing = sheet.getRange(2,1,lastRow-1, sheet.getLastColumn()).getValues();
    }
    for(let i=0;i<existing.length;i++){
      const row = existing[i];
      // row layout: 0=timestamp,1=fullname,2=username,3=email,...
      const exUsername = String(row[2] || '').toLowerCase();
      const exEmail = String(row[3] || '').toLowerCase();
      if(payload.username && payload.username.toLowerCase() === exUsername) return _json({ error: 'username_exists' }, 409);
      if(payload.email && payload.email.toLowerCase() === exEmail) return _json({ error: 'email_exists' }, 409);
    }

    // Handle avatar: if payload.avatar is a data URL, save to Drive and get a shareable URL
    let avatarUrl = '';
    if(payload.avatar && payload.avatar.indexOf('data:') === 0){
      try{
        avatarUrl = _saveAvatarToDrive(payload.avatar, payload.username || 'user');
      }catch(ae){
        // ignore avatar errors but log
        console.error('avatar save failed', ae);
        avatarUrl = '';
      }
    }

    const row = [ new Date().toISOString(), payload.fullname||'', payload.username||'', payload.email||'', payload.hash||'', payload.phone||'', payload.dob||'', payload.gender||'', payload.address||'', avatarUrl ];
    sheet.appendRow(row);
    return _json({ ok:true, avatarUrl });
  }catch(err){
    console.error(err);
    return _json({ error: String(err) }, 500);
  }
}

function _saveAvatarToDrive(dataUrl, username){
  // dataUrl like "data:image/png;base64,...."
  const parts = dataUrl.split(',');
  if(parts.length !== 2) throw new Error('Invalid data URL');
  const meta = parts[0];
  const b64 = parts[1];
  const m = /data:(image\/[^;]+);base64/.exec(meta);
  const mime = m ? m[1] : 'image/png';
  const blob = Utilities.newBlob(Utilities.base64Decode(b64), mime, (username || 'avatar') + '_' + new Date().getTime());

  // Find or create folder
  let folder = DriveApp.getFoldersByName(DRIVE_FOLDER_NAME);
  let target;
  if(folder.hasNext()) target = folder.next(); else target = DriveApp.createFolder(DRIVE_FOLDER_NAME);
  const file = target.createFile(blob);
  // Make it viewable by anyone with link (for demo). For production, consider stricter permissions.
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  // Return a direct thumbnail URL that can be embedded in <img> tags
  const fileId = file.getId();
  return 'https://drive.google.com/uc?export=view&id=' + fileId;
}

function _json(obj, status){
  const code = status || 200;
  const t = ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
  // Apps Script doesn't support setting HTTP status codes from doPost easily; returning JSON is sufficient for demo.
  return t;
}

/**
 * One-off migration: ensure Drive files referenced in `avatarUrl` are shared
 * and rewrite the stored URL to a clean `uc?export=view&id=...` form.
 * Run this from the Apps Script editor (select function `migrateAvatarUrls` and Execute).
 */
function migrateAvatarUrls(){
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if(!sheet) return { error: 'No sheet' };
  const data = sheet.getDataRange().getValues();
  if(!data || data.length < 2) return { message: 'No rows' };
  const headers = data[0];
  const avatarCol = headers.indexOf('avatarUrl');
  if(avatarCol === -1) return { error: 'avatarUrl column not found' };

  const results = [];
  for(let r = 1; r < data.length; r++){
    const raw = String(data[r][avatarCol] || '').trim();
    if(!raw) continue;
    // Extract a plausible file id
    let id = null;
    const patterns = [/file\/d\/([a-zA-Z0-9_-]+)/, /open\?id=([a-zA-Z0-9_-]+)/, /uc\?export=view&id=([a-zA-Z0-9_-]+)/, /id=([a-zA-Z0-9_-]{10,})/];
    for(const p of patterns){ const m = p.exec(raw); if(m && m[1]){ id = m[1]; break; } }
    if(!id){ results.push({ row: r+1, ok:false, reason: 'no-file-id', raw }); continue; }
    try{
      const file = DriveApp.getFileById(id);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      const clean = 'https://drive.google.com/uc?export=view&id=' + id;
      sheet.getRange(r+1, avatarCol+1).setValue(clean);
      results.push({ row: r+1, ok:true, id });
    }catch(e){
      results.push({ row: r+1, ok:false, id, error: String(e) });
    }
  }
  return results;
}
