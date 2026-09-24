module.exports = function handler(req,res){
  res.setHeader('cache-control','no-store');
  const supabaseAuthConfigured=Boolean(process.env.SUPABASE_URL&&process.env.SUPABASE_PUBLISHABLE_KEY);
  const roomDatabaseConfigured=Boolean(supabaseAuthConfigured&&process.env.SUPABASE_SECRET_KEY);
  res.status(200).json({
    service:'agent-language-translate',
    version:'0.2.0',
    translatorConfigured:Boolean(process.env.VAML_TRANSLATOR_API_URL),
    chatConfigured:Boolean(process.env.AGENT_CHAT_API_URL),
    supabaseAuthConfigured,
    roomDatabaseConfigured,
    googleLoginRoute:'/api/auth-google',
    humanRoomApi:'/api/rooms',
    agentRoomApi:'/api/agent'
  });
};
