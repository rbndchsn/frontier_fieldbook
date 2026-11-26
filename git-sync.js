'use strict';
// Public reading; authenticated, optimistic-concurrency-protected writes.
window.GitSync=(()=>{
  const REPO='rbndchsn/frontier_fieldbook', BRANCH='main', PATH='data/state.json', MAX=900000;
  const API='https://api.github.com/repos/'+REPO+'/contents/'+PATH;
  let token=null, sha=null, working=false, writeVerified=false, restored=false, sessionRemembered=false;
  // Session-only secret. Persistent storage contains only a non-secret opt-in flag.
  // A browser password manager, not the application, may store the persistent credential.
  const SESSION_KEY='frontier-fieldbook.editor.session.v3', MANAGER_KEY='frontier-fieldbook.editor.manager.v3', LOGIN='rbndchsn/frontier_fieldbook';
  const TTL=24*60*60*1000;
  const validToken=t=>typeof t==='string'&&/^github_pat_[A-Za-z0-9_]+$/.test(t);
  function clearSession(){try{sessionStorage.removeItem(SESSION_KEY)}catch{}sessionRemembered=false;}
  function rememberSession(t){
    try{sessionStorage.setItem(SESSION_KEY,JSON.stringify({token:t,until:Date.now()+TTL}));sessionRemembered=true;return true}catch{return false}
  }
  function sessionToken(){
    try{const s=JSON.parse(sessionStorage.getItem(SESSION_KEY)||'null');if(s&&validToken(s.token)&&s.until>Date.now()){sessionRemembered=true;return s.token}}catch{}
    clearSession();return null;
  }
  function managerOptIn(v){try{if(v===undefined)return localStorage.getItem(MANAGER_KEY)==='yes';if(v)localStorage.setItem(MANAGER_KEY,'yes');else localStorage.removeItem(MANAGER_KEY)}catch{}return false}
  function managerSupported(){return !!(navigator.credentials&&typeof window.PasswordCredential==='function')}
  async function managerToken(mediation='silent'){
    if(!managerSupported())return null;
    try{const c=await navigator.credentials.get({password:true,mediation});return c&&c.id===LOGIN&&validToken(c.password)?c.password:null}catch{return null}
  }
  async function storeInManager(t){
    if(!managerSupported())return false;
    try{await navigator.credentials.store(new PasswordCredential({id:LOGIN,password:t,name:'Frontier Fieldbook editor'}));return true}catch{return false}
  }
  const elem=id=>document.getElementById(id);
  async function request(method='GET',body,credential=token){
    const headers={Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
    if(credential)headers.Authorization='Bearer '+credential;
    if(body)headers['Content-Type']='application/json';
    let r;try{r=await fetch(API+(method==='GET'?'?ref='+BRANCH:''),{method,headers,cache:'no-store',redirect:'error',...(body?{body:JSON.stringify(body)}:{})});}catch(e){throw Error('Network/browser error during GitHub '+method+': '+e.message+'. Check your connection or browser network restrictions.');}
    let out;try{out=await r.json()}catch{throw Error('GitHub returned an unreadable response ('+r.status+').')}
    if(!r.ok){
      const detail='GitHub '+method+' '+r.status+': '+(out.message||'Request failed');
      if(r.status===401)throw Error(detail+'. Reconnect using a valid token.');
      if(method==='PUT'&&(r.status===403||r.status===404))throw Error(detail+'. Check that your fine-grained token selects frontier_fieldbook and grants Repository permissions > Contents: Read and write. Public read access does not prove write access. Branch protection or rate limits can also reject a write.');
      if(r.status===409)throw Error(detail+'. Another revision may have been published. Refresh published data before retrying.');
      if(r.status===422)throw Error(detail+(Array.isArray(out.errors)?' '+out.errors.map(x=>x.message||x.code||'').join('; '):'')+'. Check the reported validation error.');
      throw Error(detail);
    }return out;
  }
  function validate(s){
    const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
    if(!obj(s)||s.schema!==1||!Number.isSafeInteger(s.revision)||s.revision<0||!obj(s.profile)||!obj(s.checks)||!obj(s.settings))throw Error('Invalid fieldbook state.');
    if(Object.values(s.profile).some(x=>typeof x!=='string')||Object.values(s.checks).some(x=>typeof x!=='boolean'))throw Error('Invalid profile or checklist.');
    const required={journal:['id','title','date','category','text'],notes:['id','title','text'],tasks:['id','title','chapter'],photos:['id','title','image']};
    for(const [key,fields] of Object.entries(required)){
      if(!Array.isArray(s[key])||s[key].length>10000)throw Error('Invalid '+key+' collection.');
      const ids=new Set();
      for(const item of s[key]){
        if(!obj(item)||fields.some(f=>typeof item[f]!=='string')||Object.values(item).some(x=>typeof x!=='string')||!item.id||ids.has(item.id))throw Error('Invalid '+key+' item.');
        ids.add(item.id);
        if(key==='photos'&&!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(item.image))throw Error('Invalid photo. Only locally resized JPEGs are accepted.');
      }
    }
    return normalize(s);
  }
  function encode(s){
    const bytes=new TextEncoder().encode(JSON.stringify(s,null,2)+'\n');
    if(bytes.length>MAX)throw Error('Public JSON has a 900 KB size limit. Export a backup and reduce the number or size of photos before saving.');
    let bin='';for(let i=0;i<bytes.length;i+=8192)bin+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(bin);
  }
  function decode(r){
    if(!r||r.type!=='file'||r.encoding!=='base64'||!r.sha||typeof r.content!=='string'||r.size>MAX)throw Error('Remote state cannot be read within the 900 KB limit.');
    return validate(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(r.content.replace(/\s/g,'')),c=>c.charCodeAt(0)))));
  }
  async function load(){
    let restoreFailed=false;
    if(!restored){
      restored=true;
      let saved=sessionToken();
      if(!saved&&managerOptIn())saved=await managerToken();
      if(saved){
        try{
          const r=await request('GET',null,saved),s=decode(r);
          token=saved;sha=r.sha;if(!sessionRemembered)rememberSession(saved);return s;
        }catch{token=null;sha=null;clearSession();managerOptIn(false);restoreFailed=true;}
      }
    }
    try{const r=await request();const s=decode(r);sha=r.sha;if(restoreFailed)flash('Saved editor access could not be restored. Reconnect to edit; the public journal is still available.',true);return s}
    catch(e){
      if(token)throw e;
      const r=await fetch('data/state.json',{cache:'no-store'});if(!r.ok)throw e;
      sha=null;flash('Showing the deployed snapshot; the live GitHub API is unavailable.',true);return validate(await r.json());
    }
  }
  async function connect(){
    const input=elem('git-token'),candidate=input.value.trim();
    const keep=elem('git-remember').checked, saveManager=elem('git-manager').checked;
    if(!validToken(candidate))throw Error('Use a fine-grained personal access token (github_pat_…).');
    if(!elem('git-public').checked||!confirm('All journal entries, photos, progress and edits will be PUBLIC, and Git history retains previous versions. Enable editing?'))throw Error('Public editing not enabled.');
    const r=await request('GET',null,candidate),s=decode(r);
    token=candidate;sha=r.sha;state=s;writeVerified=false;lastSaveError='';restored=true;
    clearSession();if(keep)rememberSession(candidate);
    managerOptIn(saveManager);
    // Invoke the browser's credential manager only after a successful explicit login.
    // The browser may ask for permission, refuse, or not implement this API.
    const managerPromise=saveManager?storeInManager(candidate):Promise.resolve(false);
    input.value='';connection(true);render();
    flash('Editor connected. '+(sessionRemembered?'This tab will remember your token across reloads.':'Your token stays in memory only.'));
    if(saveManager){
      const stored=await managerPromise;
      if(stored)flash('Editor connected. Browser password manager was asked to remember your token.');
      else flash('Editor connected. If your browser offers to save the login, accept it; automatic password-manager access is not supported or was declined.');
    }
  }
  async function save(next){
    if(!token||!sha)throw Error('Connect as editor under Character & backups before saving. Public readers cannot write.');
    const s=validate({...next,revision:state.revision+1});
    const out=await request('PUT',{message:'Fieldbook: save revision '+s.revision,content:encode(s),branch:BRANCH,sha});
    if(!out?.content?.sha||!out?.commit?.sha)throw Error('GitHub did not confirm the save. Reload and check the published state.');
    sha=out.content.sha;writeVerified=true;return s;
  }
  function panel(){
    if(token)return '<div class="card" style="margin-top:18px"><div class="eyebrow">PUBLIC · VERSION CONTROLLED</div><h2>GitHub editor connected</h2><p class="caption">'+(writeVerified?'Read and write verified in this session.':'Read access verified; write permission has not yet been tested.')+'</p><p>Each dashboard save creates a commit in <strong>'+REPO+'</strong>. Journal, notes, photos and progress are public. '+(sessionRemembered?'Editor access is remembered in this tab for up to 24 hours, including reloads.':'Your token remains in page memory only.')+' '+(managerOptIn()?'Browser password manager remembering is enabled.':'')+'</p><p class="caption">900 KB total JSON limit · Revision '+esc(sha?.slice(0,12)||'unknown')+'</p><div class="actions"><button class="primary" data-git-action="reload">Refresh published data</button><button class="ghost" data-git-action="disconnect">Disconnect editor</button><a href="https://github.com/rbndchsn/frontier_fieldbook/commits/main/data/state.json" target="_blank" rel="noopener noreferrer">View commit history</a></div></div>';
    return '<div class="card" style="margin-top:18px"><div class="eyebrow">PUBLIC · READ ONLY UNTIL CONNECTED</div><h2>GitHub editor access</h2><p>Read the journal without signing in. Connect once to edit.</p><form id="git-login" autocomplete="on"><label class="field">Editor account<input name="username" type="text" value="rbndchsn/frontier_fieldbook" autocomplete="username" readonly></label><label class="field">Fine-grained GitHub personal access token<input id="git-token" name="password" type="password" autocomplete="current-password" placeholder="github_pat_…" required></label><p class="caption">Token scope: only frontier_fieldbook, Contents: Read and write. A short expiration is recommended. Never share or commit your token.</p><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="git-public"> I understand that all dashboard content is public and recorded in Git history.</label><label style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="git-remember" checked> Stay connected when I refresh this tab (up to 24 hours).</label><label style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="git-manager"> Remember editor login in my browser’s password manager, when supported.</label><p class="caption">Use a trusted device. Tab storage is accessible to scripts on this site’s origin. The password manager is optional and browser-controlled; it may require you to select the saved login or confirm again after closing the tab. No permanent token is stored by the app in localStorage.</p><div class="actions" style="margin-top:12px"><button class="primary" type="submit">Connect editor</button>'+(managerSupported()?'<button class="ghost" type="button" data-git-action="saved-login">Use saved login</button>':'')+'<button class="ghost" type="button" data-git-action="reload">Refresh published data</button><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">Create token</a></div><p id="git-login-error" class="danger" role="alert"></p></form></div>';
  }
  document.addEventListener('submit',async e=>{
    if(e.target.id!=='git-login')return;
    e.preventDefault();if(working||busy)return;
    const b=e.target.querySelector('button[type=submit]');working=true;busy=true;b.disabled=true;
    try{await connect()}catch(e){const el=elem('git-login-error');if(el)el.textContent=e.message;flash(e.message,true)}
    finally{working=false;busy=false;b.disabled=false}
  });
  document.addEventListener('click',async e=>{
    const b=e.target.closest('[data-git-action]');if(!b||working||busy)return;
    working=true;busy=true;b.disabled=true;
    try{
      if(b.dataset.gitAction==='saved-login'){
        const saved=await managerToken('required');
        if(!saved)throw Error('No matching saved editor login was returned. Use your browser’s password autofill or paste the token.');
        elem('git-token').value=saved;elem('git-manager').checked=true;flash('Saved login selected. Confirm public data and click Connect editor.');
      }else{
        if(b.dataset.gitAction==='disconnect'){token=null;sha=null;writeVerified=false;clearSession();managerOptIn(false);restored=true;}
        state=await load();connection(true);render();flash(token?'Latest published revision loaded.':'Public read-only view.');
      }
    }catch(e){flash(e.message,true)}finally{busy=false;working=false;b.disabled=false}
  });
  return {load,save,panel,editing:()=>!!token};
})();