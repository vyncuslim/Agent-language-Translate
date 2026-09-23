const history=[];
const $=(id)=>document.getElementById(id);

for(const button of document.querySelectorAll('.tab')){
  button.addEventListener('click',()=>{
    document.querySelectorAll('.tab').forEach((x)=>x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((x)=>x.classList.remove('active'));
    button.classList.add('active');
    $(`${button.dataset.tab}-panel`).classList.add('active');
  });
}

async function jsonFetch(url,options={}){
  const response=await fetch(url,{...options,headers:{'content-type':'application/json',...(options.headers||{})}});
  let data;
  try{data=await response.json()}catch{data={error:`HTTP ${response.status}`}}
  if(!response.ok)throw new Error(data.error||`HTTP ${response.status}`);
  return data;
}

async function refreshStatus(){
  const node=$('status');
  try{
    const data=await jsonFetch('/api/status');
    node.classList.toggle('ok',data.chatConfigured&&data.translatorConfigured);
    node.classList.toggle('bad',!data.chatConfigured&&!data.translatorConfigured);
    const parts=[data.translatorConfigured?'Translator ready':'Translator not configured',data.chatConfigured?'Chat ready':'Chat not configured'];
    node.querySelector('span:last-child').textContent=parts.join(' · ');
  }catch{
    node.classList.add('bad');
    node.querySelector('span:last-child').textContent='Backend unavailable';
  }
}

$('translate-button').addEventListener('click',async()=>{
  const input=$('translate-input').value;
  const output=$('translate-output');
  const button=$('translate-button');
  if(!input.trim())return;
  button.disabled=true; output.value='Translating…';
  try{
    const data=await jsonFetch('/api/translate',{method:'POST',body:JSON.stringify({direction:$('direction').value,input})});
    output.value=data.output||'';
  }catch(error){output.value=`Error: ${error.message}`}
  finally{button.disabled=false}
});

$('copy-translation').addEventListener('click',async()=>{
  const value=$('translate-output').value;
  if(value)await navigator.clipboard.writeText(value);
});

function bubble(role,text){
  const node=document.createElement('div');
  node.className=`bubble ${role}`;
  node.textContent=text;
  $('chat-log').append(node);
  $('chat-log').scrollTop=$('chat-log').scrollHeight;
}

$('chat-form').addEventListener('submit',async(event)=>{
  event.preventDefault();
  const input=$('chat-input');
  const message=input.value.trim();
  if(!message)return;
  input.value=''; bubble('user',message);
  const bounded=history.slice(-40);
  try{
    const data=await jsonFetch('/api/chat',{method:'POST',body:JSON.stringify({message,history:bounded})});
    const reply=data.reply||'';
    bubble('agent',reply);
    history.push({role:'user',content:message},{role:'assistant',content:reply});
    if(history.length>80)history.splice(0,history.length-80);
  }catch(error){bubble('error',`Chat unavailable: ${error.message}`)}
});

refreshStatus();
