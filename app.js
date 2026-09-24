const history=[];
const $=(id)=>document.getElementById(id);

for(const button of document.querySelectorAll('.tab')){
  button.addEventListener('click',()=>{
    if(!button.dataset.tab)return;
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
  if(!response.ok){
    const error=new Error(data.error||`HTTP ${response.status}`);
    error.status=response.status;
    error.requestId=data.requestId;
    throw error;
  }
  return data;
}

function translatorStatusText(data){
  if(data.translatorState==='ready')return 'Translator ready';
  if(data.translatorState==='runtime-missing')return 'Translator gateway ready · VAML runtime not configured';
  if(data.translatorState==='token-missing')return 'Translator gateway ready · token not configured';
  if(data.translatorState==='gateway-auth-missing')return 'Translator gateway auth not configured';
  if(data.translatorState==='gateway-ready')return 'Translator gateway ready · runtime status unavailable';
  return 'Translator unavailable';
}

function chatStatusText(data){
  if(data.chatState==='ready')return 'Chat ready';
  if(data.chatState==='runtime-missing')return 'Chat gateway ready · AI runtime not configured';
  if(data.chatState==='token-missing')return 'Chat gateway ready · token not configured';
  if(data.chatState==='gateway-auth-missing')return 'Chat gateway auth not configured';
  if(data.chatState==='gateway-ready')return 'Chat gateway ready · runtime status unavailable';
  return 'Chat unavailable';
}

async function refreshStatus(){
  const node=$('status');
  try{
    const data=await jsonFetch('/api/status');
    const translatorText=translatorStatusText(data);
    const chatText=chatStatusText(data);
    node.classList.toggle('ok',Boolean(data.translatorConfigured&&data.chatConfigured));
    node.classList.toggle('bad',Boolean(
      data.translatorState==='gateway-unavailable'||
      data.translatorState==='gateway-auth-missing'||
      data.chatState==='gateway-unavailable'||
      data.chatState==='gateway-auth-missing'
    ));
    node.querySelector('span:last-child').textContent=`${translatorText} · ${chatText}`;
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
  }catch(error){
    output.value=`Error: ${error.message}${error.requestId?`\nRequest ID: ${error.requestId}`:''}`;
  }finally{button.disabled=false}
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
  }catch(error){bubble('error',`Chat unavailable: ${error.message}${error.requestId?` · ${error.requestId}`:''}`)}
});

refreshStatus();
