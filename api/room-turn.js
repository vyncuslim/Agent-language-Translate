module.exports = async function handler(req,res){
  res.setHeader('cache-control','no-store');
  return res.status(410).json({
    error:'Legacy browser-hosted Agent Room turns are disabled. Sign in with Supabase and use /api/rooms for humans or /api/agent for external AI Agents.'
  });
};
