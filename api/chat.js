function bodyOf(req){
  if(req.body&&typeof req.body==='object')return req.body;
  if(typeof req.body==='string'){try{return JSON.parse(req.body)}catch{return {}}}
  return {};
}

function cleanHistory(value){
  if(!Array.isArray(value))return [];
  return value.slice(-40).map((entry)=>({
    role:entry?.role==='assistant'?'assistant':'user',
    content:typeof entry?.content==='string'?entry.content.slice(0,32768):''
  })).filter((x)=>x.content.trim());
}

module.exports = async function handler(req,res){
  res.setHeader('cache-control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:'POST required'});
  const endpoint=process.env.AGENT_CHAT_API_URL;
  if(!endpoint)return res.status(503).json({error:'AGENT_CHAT_API_URL is not configured on Vercel'});
  const body=bodyOf(req);
  const message=typeof body.message==='string'?body.message.normalize('NFC'):'';
  if(!message.trim()||Buffer.byteLength(message,'utf8')>32768)return res.status(400).json({error:'Invalid chat message'});

  const headers={'content-type':'application/json','accept':'application/json'};
  if(process.env.AGENT_CHAT_API_TOKEN)headers.authorization=`Bearer ${process.env.AGENT_CHAT_API_TOKEN}`;
  try{
    const upstream=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({message,history:cleanHistory(body.history),source:'agent-language-translate'}),signal:AbortSignal.timeout(25000)});
    const text=await upstream.text();
    let data; try{data=JSON.parse(text)}catch{data={reply:text}}
    if(!upstream.ok)return res.status(502).json({error:data.error||`Agent endpoint returned ${upstream.status}`});
    const reply=[data.reply,data.output,data.message,data.content].find((x)=>typeof x==='string');
    if(!reply)return res.status(502).json({error:'Agent endpoint returned no text reply'});
    return res.status(200).json({reply});
  }catch(error){
    return res.status(502).json({error:error instanceof Error?error.message:'Agent endpoint request failed'});
  }
};
