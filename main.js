let users = [];

const APPS_SCRIPT_ENDPOINT = 'https://script.google.com/macros/s/AKfycby-wed2sV6RfqVtLvKMwM9WATizYysF52OzliaykFzkF72K8f2IL2HsqcMWv3dWAjtRrg/exec'; // <-- paste your web app URL

async function sha256hex(str){
  const enc = new TextEncoder();
  const data = enc.encode(str);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

async function readUsersFromHandle(){

  return;
}

function render(){ const el = document.getElementById('raw'); if(el) el.textContent = JSON.stringify(users, null, 2); }

// --- Apps Script / Google Sheets helpers ---
async function postUserToAppsScript(userObj){
  if(!APPS_SCRIPT_ENDPOINT) throw new Error('APPS_SCRIPT_ENDPOINT not configured');
  const payload = Object.assign({}, userObj);
  
  if(typeof APPS_SCRIPT_API_KEY !== 'undefined' && APPS_SCRIPT_API_KEY) payload.apiKey = APPS_SCRIPT_API_KEY;

  const res = await fetch(APPS_SCRIPT_ENDPOINT, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  return await res.json();
}

async function getUsersFromAppsScript(){
  if(!APPS_SCRIPT_ENDPOINT) throw new Error('APPS_SCRIPT_ENDPOINT not configured');
  const res = await fetch(APPS_SCRIPT_ENDPOINT);
  return await res.json();
}

// Resize image file client-side to limit upload size (returns data URL)
async function resizeImageFile(file, maxSize = 400){
  if(!file) return '';
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const { width, height } = img;
        const scale = Math.min(1, maxSize / Math.max(width, height));
        const w = Math.round(width * scale);
        const h = Math.round(height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        // Use JPEG to reduce size; quality 0.8
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        resolve(dataUrl);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

const signupForm = document.getElementById('signupForm');
const signupBtn = document.getElementById('signupBtn');
if(signupForm) signupForm.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const f = new FormData(e.target);
  const fullname = (f.get('fullname')||'').trim();
  const username = (f.get('username')||'').trim();
  const email = (f.get('email')||'').trim();
  const password = f.get('password')||'';
  const confirm = f.get('confirm')||'';
  const phone = (f.get('phone')||'').trim();
  const dob = f.get('dob')||'';
  const gender = f.get('gender')||'';
  const address = (f.get('address')||'').trim();
  const terms = f.get('terms');
  if(!fullname||!username||!email||!password||!confirm){ alert('Please fill required fields'); return; }
  if(password !== confirm){ alert('Passwords do not match'); return; }
  if(!terms){ alert('You must accept Terms & Conditions'); return; }
  // Use Apps Script endpoint to store user
  if(!APPS_SCRIPT_ENDPOINT){
    alert('No Apps Script endpoint configured. Please set APPS_SCRIPT_ENDPOINT in main.js.');
    return;
  }
  if(users.find(u=>u.username.toLowerCase()===username.toLowerCase())){ alert('Username already exists'); return; }
  if(users.find(u=>u.email && u.email.toLowerCase()===email.toLowerCase())){ alert('Email already registered'); return; }
  // avatar (resize before upload)
  let avatarData = '';
  const avatarFile = f.get('avatar');
  if(avatarFile && avatarFile.size > 0){
    try { avatarData = await resizeImageFile(avatarFile, 400); } catch(err){ console.warn('avatar resize failed, falling back to raw', err); avatarData = await fileToDataUrl(avatarFile); }
  }
  const hash = await sha256hex(password);

  const entry = { fullname, username, email, hash, phone, dob, gender, address, avatar: avatarData, created:new Date().toISOString() };

  if(APPS_SCRIPT_ENDPOINT){
    const priorText = signupBtn ? signupBtn.textContent : null;
    if(signupBtn){ signupBtn.disabled = true; signupBtn.textContent = 'Saving…'; }
    try{
      const resp = await postUserToAppsScript(entry);
      if(resp && resp.error){
        if(resp.error === 'username_exists') return alert('Username already exists (remote)');
        if(resp.error === 'email_exists') return alert('Email already registered (remote)');
        return alert('Error from server: ' + resp.error);
      }
      // success
      // refresh in-memory users from remote for display
      try{ users = await getUsersFromAppsScript(); render(); }catch(e){}
      alert('Registered and saved to Google Sheets');
    }catch(err){ console.error(err); alert('Failed to post to Apps Script endpoint: ' + err); }
    finally{
      if(signupBtn){ signupBtn.disabled = false; signupBtn.textContent = priorText; }
    }
  } else {
    // Shouldn't reach here because we validated APPS_SCRIPT_ENDPOINT above
    alert('Registered in memory but no backend configured');
  }
  e.target.reset();
});

async function fileToDataUrl(f){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(f); }); }

// signin UI toggle
const signinLink = document.getElementById('signinLink');
if(signinLink) signinLink.addEventListener('click', (ev)=>{ ev.preventDefault(); const s = document.getElementById('signupForm'); const i = document.getElementById('signinForm'); if(s) s.style.display='none'; if(i) i.style.display='block'; });
const backBtn = document.getElementById('backToSignup');
if(backBtn) backBtn.addEventListener('click', ()=>{ const s = document.getElementById('signupForm'); const i = document.getElementById('signinForm'); if(i) i.style.display='none'; if(s) s.style.display='block'; });

// signin logic
const signinForm = document.getElementById('signinForm');
if(signinForm) signinForm.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const f = new FormData(e.target);
  const who = (f.get('who')||'').trim();
  const pass = f.get('pass')||'';
  if(!who || !pass){ alert('Fill both fields'); return; }
  // Fetch users from Apps Script
  if(APPS_SCRIPT_ENDPOINT){
    try{ users = await getUsersFromAppsScript(); }catch(err){ console.error(err); alert('Failed to fetch users from Apps Script'); return; }
  } else { alert('No Apps Script endpoint configured. Please set APPS_SCRIPT_ENDPOINT in main.js.'); return; }
  const h = await sha256hex(pass);
  const found = users.find(u => (u.username && u.username.toLowerCase()===who.toLowerCase()) || (u.email && u.email.toLowerCase()===who.toLowerCase()));
  if(found && found.hash === h){
    // Show dashboard instead of simple alert
    showDashboard(found);
  } else { alert('Sign in failed'); }
  e.target.reset();
});

// Dashboard functions
function showDashboard(user){
  const s = document.getElementById('signupForm');
  const i = document.getElementById('signinForm');
  const d = document.getElementById('dashboard');
  if(s) s.style.display = 'none';
  if(i) i.style.display = 'none';
  if(d) d.style.display = 'block';

  const avatarEl = document.getElementById('dashboardAvatar');
  const nameEl = document.getElementById('dashboardName');
  const userEl = document.getElementById('dashboardUsername');
  const emailEl = document.getElementById('dashboardEmail');
  const createdEl = document.getElementById('dashboardCreated');
  const phoneEl = document.getElementById('dashboardPhone');
  const dobEl = document.getElementById('dashboardDob');

  let avatarSrc = user.avatarUrl || user.avatar || '';
  console.log('Original avatar source:', avatarSrc);
  
  // Normalize Google Drive URLs to direct viewable format
  try {
    if (avatarSrc && avatarSrc.includes('drive.google.com')) {
      let fileId = null;
      
      // Extract file ID from various Google Drive URL formats
      // Pattern 1: /file/d/{id}/view
      const pattern1 = /\/file\/d\/([a-zA-Z0-9_-]+)/;
      const match1 = avatarSrc.match(pattern1);
      if (match1 && match1[1]) {
        fileId = match1[1];
      }
      
      // Pattern 2: /open?id={id}
      if (!fileId) {
        const pattern2 = /[?&]id=([a-zA-Z0-9_-]+)/;
        const match2 = avatarSrc.match(pattern2);
        if (match2 && match2[1]) {
          fileId = match2[1];
        }
      }
      
      // Pattern 3: uc?export=view&id={id}
      if (!fileId) {
        const pattern3 = /uc\?export=view&id=([a-zA-Z0-9_-]+)/;
        const match3 = avatarSrc.match(pattern3);
        if (match3 && match3[1]) {
          fileId = match3[1];
        }
      }
      
      // If we found a valid file ID (Google Drive IDs are typically 25-45 characters)
      if (fileId && fileId.length >= 20) {
        // Use the direct download/view URL format
        avatarSrc = `https://drive.google.com/uc?export=view&id=${fileId}`;
        console.log('Normalized Google Drive URL to:', avatarSrc);
      } else {
        console.warn('Could not extract valid Google Drive file ID from URL:', avatarSrc);
        avatarSrc = ''; // Will fall back to initials
      }
    }
  } catch (e) {
    console.warn('Avatar URL normalization failed:', e);
    avatarSrc = '';
  }
  
  // Create initials-based fallback SVG if no avatar
  const createInitialsAvatar = (name) => {
    const initials = (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="100%" height="100%" fill="%234f46e5"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="white" font-size="40" font-family="sans-serif">${initials}</text></svg>`;
  };
  
  if (!avatarSrc) {
    avatarSrc = createInitialsAvatar(user.fullname || user.username);
  }
  
  if (avatarEl) {
    // Track if we've already tried the Apps Script proxy fallback
    let triedProxy = false;

    // Set up error handler before setting src
    avatarEl.onerror = async () => {
      console.warn('Avatar image failed to load, attempting Apps Script proxy fallback. Attempted URL:', avatarEl.src);
      // If the source looks like a Drive ID URL, try fetching via Apps Script `getImage` endpoint
      try{
        // attempt to extract file ID from the avatarSrc or the original user.avatarUrl
        const srcToCheck = avatarSrc || (user.avatarUrl || user.avatar || '');
        const m = /(?:file\/d\/|id=|uc\?export=view&id=)([a-zA-Z0-9_-]{10,})/.exec(srcToCheck);
        const fileId = m && m[1] ? m[1] : null;
        console.log('Extracted file ID for proxy:', fileId);
        if(fileId && !triedProxy){
          triedProxy = true;
          const url = APPS_SCRIPT_ENDPOINT + '?action=getImage&id=' + encodeURIComponent(fileId);
          console.log('Fetching from Apps Script proxy:', url);
          const res = await fetch(url);
          console.log('Apps Script proxy response status:', res.status);
          if(res.ok){
            const j = await res.json();
            console.log('Apps Script proxy response:', j);
            if(j && j.dataUrl){
              console.log('Successfully retrieved image via proxy, setting dataUrl');
              avatarEl.src = j.dataUrl; // set to proxied data URL
              return;
            } else {
              console.warn('Apps Script proxy returned no dataUrl');
            }
          } else {
            const errText = await res.text();
            console.warn('Apps Script proxy responded with status', res.status, 'body:', errText);
          }
        } else {
          console.log('Skipping proxy: fileId=' + fileId + ', triedProxy=' + triedProxy);
        }
      }catch(err){ console.warn('Apps Script proxy attempt failed', err); }

      // final fallback: show initials
      console.warn('Using initials fallback');
      avatarEl.src = createInitialsAvatar(user.fullname || user.username);
    };

    avatarEl.onload = () => {
      console.log('Avatar image loaded successfully');
    };

    // Set the avatar source
    avatarEl.src = avatarSrc;
  }
  
  if (nameEl) nameEl.textContent = user.fullname || user.username || '';
  if (userEl) userEl.textContent = user.username || '';
  if (emailEl) emailEl.textContent = user.email || '';
  if (createdEl) createdEl.textContent = user.timestamp || user.created || '—';
  if (phoneEl) phoneEl.textContent = user.phone || '—';
  if (dobEl) dobEl.textContent = user.dob || '—';

  // wire sign out / download buttons
  const signOutBtn = document.getElementById('signOutBtn');
  if (signOutBtn) signOutBtn.onclick = () => { hideDashboard(); };

  const downloadBtn = document.getElementById('downloadProfileBtn');
  if (downloadBtn) downloadBtn.onclick = () => {
    const p = Object.assign({}, user);
    const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); 
    a.href = url; 
    a.download = (user.username || 'profile') + '.json'; 
    document.body.appendChild(a); 
    a.click(); 
    a.remove(); 
    URL.revokeObjectURL(url);
  };
}

function hideDashboard(){
  const s = document.getElementById('signupForm');
  const i = document.getElementById('signinForm');
  const d = document.getElementById('dashboard');
  if (d) d.style.display = 'none';
  if (i) i.style.display = 'none';
  if (s) s.style.display = 'block';
}
