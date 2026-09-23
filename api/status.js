module.exports = function handler(req,res){
  res.setHeader('cache-control','no-store');
  res.status(200).json({
    service:'agent-language-translate',
    version:'0.1.0',
    translatorConfigured:Boolean(process.env.VAML_TRANSLATOR_API_URL),
    chatConfigured:Boolean(process.env.AGENT_CHAT_API_URL)
  });
};
