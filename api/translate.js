function bodyOf(req){
  if(req.body&&typeof req.body==='object')return req.body;
  if(typeof req.body==='string'){try{return JSON.parse(req.body)}catch{return {}}}
  return {};
}

module.exports = async function handler(req,res){
  res.setHeader('cache-control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:'POST required'});
  const endpoint=process.env.VAML_TRANSLATOR_API_URL;
  if(!endpoint)return res.status(503).json({error:'VAML_TRANSLATOR_API_URL is not configured on Vercel'});
  const body=bodyOf(req);
  const direction=body.direction==='vaml-to-human'?'vaml-to-human':'human-to-vaml';
  const input=typeof body.input==='string'?body.input.normalize('NFC'):'';
  if(!input.trim()||Buffer.byteLength(input,'utf8')>32768)return res.status(400).json({error:'Invalid translation input'});

  const headers={'content-type':'application/json','accept':'application/json'};
  if(process.env.VAML_TRANSLATOR_API_TOKEN)headers.authorization=`Bearer ${process.env.VAML_TRANSLATOR_API_TOKEN}`;
  try{
    const upstream=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({direction,input,source:'agent-language-translate'}),signal:AbortSignal.timeout(25000)});
    const text=await upstream.text();
    let data; try{data=JSON.parse(text)}catch{data={output:text}}
    if(!upstream.ok)return res.status(502).json({error:data.error||`Translator endpoint returned ${upstream.status}`});
    const output=[data.output,data.translation,data.result,data.text].find((x)=>typeof x==='string');
    if(!output)return res.status(502).json({error:'Translator endpoint returned no output'});
    return res.status(200).json({output});
  }catch(error){
    return res.status(502).json({error:error instanceof Error?error.message:'Translator endpoint request failed'});
  }
};
