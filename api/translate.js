function bodyOf(req){
  if(req.body&&typeof req.body==='object')return req.body;
  if(typeof req.body==='string'){try{return JSON.parse(req.body)}catch{return {}}}
  return {};
}

const CANONICAL_TRANSLATOR_URL='https://api.vaml.vynalthai.com/v1/translate';

module.exports = async function handler(req,res){
  res.setHeader('cache-control','no-store');
  res.setHeader('x-content-type-options','nosniff');
  if(req.method!=='POST')return res.status(405).json({error:'POST required'});

  const endpoint=(process.env.VAML_TRANSLATOR_API_URL||CANONICAL_TRANSLATOR_URL).trim();
  let endpointUrl;
  try{endpointUrl=new URL(endpoint)}catch{return res.status(503).json({error:'Invalid VAML translator gateway URL'})}
  if(endpointUrl.protocol!=='https:')return res.status(503).json({error:'VAML translator gateway must use HTTPS'});

  const body=bodyOf(req);
  const direction=body.direction==='vaml-to-human'?'vaml-to-human':body.direction==='human-to-vaml'?'human-to-vaml':'';
  const input=typeof body.input==='string'?body.input.normalize('NFC'):'';
  if(!direction)return res.status(400).json({error:'direction must be human-to-vaml or vaml-to-human'});
  if(!input.trim()||Buffer.byteLength(input,'utf8')>32768)return res.status(400).json({error:'Invalid translation input'});

  const token=process.env.VAML_TRANSLATOR_API_TOKEN;
  if(!token)return res.status(503).json({error:'VAML translator gateway token is not configured'});

  const headers={'content-type':'application/json','accept':'application/json','authorization':`Bearer ${token}`};
  try{
    const upstream=await fetch(endpointUrl.toString(),{
      method:'POST',
      headers,
      body:JSON.stringify({direction,input,source:'agent-language-translate'}),
      signal:AbortSignal.timeout(25000)
    });
    const text=await upstream.text();
    let data; try{data=JSON.parse(text)}catch{data={output:text}}
    const requestId=upstream.headers.get('x-vaml-request-id')||data?.requestId||undefined;

    if(!upstream.ok){
      console.warn(JSON.stringify({event:'vaml_translate_upstream_error',host:endpointUrl.host,status:upstream.status,requestId:requestId||null}));
      return res.status(upstream.status).json({
        error:(data&&typeof data.error==='string'&&data.error)||`Translator gateway returned ${upstream.status}`,
        upstreamStatus:upstream.status,
        ...(requestId?{requestId}:{})
      });
    }

    const output=[data.output,data.translation,data.result,data.text].find((x)=>typeof x==='string'&&x.length);
    if(!output)return res.status(502).json({error:'Translator gateway returned no output',...(requestId?{requestId}:{})});
    return res.status(200).json({output,...(requestId?{requestId}:{})});
  }catch(error){
    const message=error&&error.name==='TimeoutError'?'VAML translator gateway timed out':'VAML translator gateway is unreachable';
    console.error(JSON.stringify({event:'vaml_translate_gateway_unreachable',host:endpointUrl.host,error:error instanceof Error?error.message:String(error)}));
    return res.status(502).json({error:message});
  }
};
