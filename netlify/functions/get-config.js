// netlify/functions/get-config.js
// This function safely provides config to your frontend

exports.handler = async (event, context) => {
  // Only allow GET requests
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*', // Allow your site to call this
      },
      body: JSON.stringify({
        supabaseUrl: process.env.SUPABASE_URL,
        supabaseAnonKey: process.env.SUPABASE_ANON_KEY
      })
    };

  } catch (error) {
    console.error('Config error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Failed to get configuration'
      })
    };
  }
};
