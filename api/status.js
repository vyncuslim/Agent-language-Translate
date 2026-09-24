module.exports = async function handler(req,res){
  res.setHeader('cache-control','no-store');
  const supabaseAuthConfigured=Boolean(process.env.SUPABASE_URL&&process.env.SUPABASE_PUBLISHABLE_KEY);
  const roomDatabaseConfigured=Boolean(supabaseAuthConfigured&&process.env.SUPABASE_SECRET_KEY);

  const translatorGatewayUrl=process.env.VAML_TRANSLATOR_API_URL||'https://api.vaml.vynalthai.com/v1/translate';
  const translatorTokenConfigured=Boolean(process.env.VAML_TRANSLATOR_API_TOKEN);
  const chatGatewayUrl=process.env.AGENT_CHAT_API_URL||'https://api.vaml.vynalthai.com/v1/chat';
  const chatTokenConfigured=Boolean(process.env.AGENT_CHAT_API_TOKEN||process.env.VAML_TRANSLATOR_API_TOKEN);

  let translatorRuntimeConfigured=null;
  let translatorGatewayAuthConfigured=null;
  let chatRuntimeConfigured=null;
  let chatGatewayAuthConfigured=null;
  try{
    const health=await fetch('https://api.vaml.vynalthai.com/health',{headers:{accept:'application/json'},signal:AbortSignal.timeout(5000)});
    if(health.ok){
      const data=await health.json();
      translatorRuntimeConfigured=Boolean(data.translatorRuntimeConfigured??data.runtimeConfigured);
      translatorGatewayAuthConfigured=Boolean(data.translatorAuthConfigured??data.authConfigured);
      chatRuntimeConfigured=Boolean(data.chatRuntimeConfigured);
      chatGatewayAuthConfigured=Boolean(data.chatAuthConfigured);
    }
  }catch{}

  const translatorGatewayConfigured=Boolean(translatorGatewayUrl&&translatorTokenConfigured&&(translatorGatewayAuthConfigured!==false));
  const translatorConfigured=Boolean(translatorGatewayConfigured&&translatorRuntimeConfigured===true);
  let translatorState='gateway-unavailable';
  if(!translatorTokenConfigured)translatorState='token-missing';
  else if(translatorGatewayAuthConfigured===false)translatorState='gateway-auth-missing';
  else if(translatorRuntimeConfigured===false)translatorState='runtime-missing';
  else if(translatorConfigured)translatorState='ready';
  else if(translatorGatewayConfigured)translatorState='gateway-ready';

  const chatGatewayConfigured=Boolean(chatGatewayUrl&&chatTokenConfigured&&(chatGatewayAuthConfigured!==false));
  const chatConfigured=Boolean(chatGatewayConfigured&&chatRuntimeConfigured===true);
  let chatState='gateway-unavailable';
  if(!chatTokenConfigured)chatState='token-missing';
  else if(chatGatewayAuthConfigured===false)chatState='gateway-auth-missing';
  else if(chatRuntimeConfigured===false)chatState='runtime-missing';
  else if(chatConfigured)chatState='ready';
  else if(chatGatewayConfigured)chatState='gateway-ready';

  res.status(200).json({
    service:'agent-language-translate',
    version:'0.4.0',
    translatorConfigured,
    translatorGatewayConfigured,
    translatorTokenConfigured,
    translatorRuntimeConfigured,
    translatorState,
    translatorGatewayUrl,
    chatConfigured,
    chatGatewayConfigured,
    chatTokenConfigured,
    chatRuntimeConfigured,
    chatState,
    chatGatewayUrl,
    supabaseAuthConfigured,
    roomDatabaseConfigured,
    googleLoginRoute:'/api/auth-google',
    humanRoomApi:'/api/rooms',
    agentRoomApi:'/api/agent'
  });
};
