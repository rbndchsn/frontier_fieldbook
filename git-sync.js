'use strict';
// Public reading; authenticated, optimistic-concurrency-protected writes.
window.GitSync=(()=>{
  const REPO='rbndchsn/frontier_fieldbook', BRANCH='main', PATH='data/state.json', MAX=900000;
  const API='https://api.github.com/repos/'+REPO+'/contents/'+PATH;
  let token=null, sha=null, working=false;
  const elem=id=>document.getElementById(id);
  async function request(method='GET',body,credential=token){
    const headers={Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
    if(credential)headers.Authorization='Bearer '+credential;
    if(body)headers['Content-Type']='application/json';
    const r=await fetch(API+(method==='GET'?'?ref='+BRANCH:''),{method,headers,cache:'no-store',redirect:'error',...(body?{body:JSON.stringify(body)}:{})});
    let out;try{out=await r.json()}catch{throw Error('GitHub returned an unreadable response ('+r.status+').')}
    if(!r.ok){
      if(r.status===409||r.status===422)throw Error('GitHub rejected an outdated or invalid write. Your changes were not committed. Reload the latest public state and reapply the edit.');
      throw Error('GitHub '+r.status+': '+(out.message||'Request failed'));
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
    try{const r=await request();const s=decode(r);sha=r.sha;return s}
    catch(e){
      if(token)throw e;
      // Published snapshot is read-only fallback if the anonymous API is rate-limited.
      const r=await fetch('data/state.json',{cache:'no-store'});if(!r.ok)throw e;
      sha=null;flash('Showing the deployed snapshot; the live GitHub API is unavailable.',true);return validate(await r.json());
    }
  }
  async function connect(){
    const input=elem('git-token'),candidate=input.value.trim();input.value='';
    if(!/^github_pat_[A-Za-z0-9_]+$/.test(candidate))throw Error('Use a fine-grained personal access token (github_pat_…).');
    if(!elem('git-public').checked||!confirm('All journal entries, photos, progress and edits will be PUBLIC, and Git history retains previous versions. Enable editing?'))throw Error('Public editing not enabled.');
    const r=await request('GET',null,candidate),s=decode(r);
    token=candidate;sha=r.sha;state=s;connection(true);render();flash('Editor connected. Your next successful save will create a public commit.');
  }
  async function save(next){
    if(!token||!sha)throw Error('Connect as editor under Character & backups before saving. Public readers cannot write.');
    const s=validate({...next,revision:state.revision+1});
    const out=await request('PUT',{message:'Fieldbook: save revision '+s.revision,content:encode(s),branch:BRANCH,sha});
    if(!out?.content?.sha||!out?.commit?.sha)throw Error('GitHub did not confirm the save. Reload and check the published state.');
    sha=out.content.sha;return s;
  }
  function panel(){
    if(token)return '<div class="card" style="margin-top:18px"><div class="eyebrow">PUBLIC · VERSION CONTROLLED</div><h2>GitHub editor connected</h2><p>Each dashboard save creates a commit in <strong>'+REPO+'</strong>. Journal, notes, photos and progress are public. Your token remains in this page’s memory only.</p><p class="caption">900 KB total JSON limit · Revision '+esc(sha?.slice(0,12)||'unknown')+'</p><div class="actions"><button class="primary" data-git-action="reload">Refresh published data</button><button class="ghost" data-git-action="disconnect">Disconnect editor</button><a href="https://github.com/rbndchsn/frontier_fieldbook/commits/main/data/state.json" target="_blank" rel="noopener noreferrer">View commit history</a></div></div>';
    return '<div class="card" style="margin-top:18px"><div class="eyebrow">PUBLIC · READ ONLY UNTIL CONNECTED</div><h2>GitHub editor access</h2><p>Everyone can read the published journal. Only someone with repository write permission can save changes.</p><label class="field">Fine-grained GitHub personal access token<input id="git-token" type="password" autocomplete="off" placeholder="github_pat_…"></label><p class="caption">Select only frontier_fieldbook and grant Contents: Read and write. Use a short expiration. Never share or commit your token. Reconnect after a page reload.</p><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="git-public"> I understand that all dashboard content is public and recorded in Git history.</label><div class="actions" style="margin-top:12px"><button class="primary" data-git-action="connect">Connect editor</button><button class="ghost" data-git-action="reload">Refresh published data</button><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">Create token</a></div></div>';
  }
  document.addEventListener('click',async e=>{
    const b=e.target.closest('[data-git-action]');if(!b||working||busy)return;
    working=true;busy=true;b.disabled=true;
    try{
      if(b.dataset.gitAction==='connect')await connect();
      else{
        if(b.dataset.gitAction==='disconnect'){token=null;sha=null;}
        state=await load();connection(true);render();flash(token?'Latest published revision loaded.':'Public read-only view.');
      }
    }catch(e){flash(e.message,true)}finally{busy=false;working=false;b.disabled=false}
  });
  return {load,save,panel,editing:()=>!!token};
})();