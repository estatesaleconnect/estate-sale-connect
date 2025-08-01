// netlify/functions/auth-verify.js
const jwt = require('jsonwebtoken');

exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.URL || '*'
      },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Get token from header or body
    const authHeader = event.headers.authorization;
    const { token } = JSON.parse(event.body || '{}');
    
    const jwtToken = authHeader?.startsWith('Bearer ') 
      ? authHeader.substring(7) 
      : token;

    if (!jwtToken) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': process.env.URL || '*'
        },
        body: JSON.stringify({ 
          error: 'No token provided' 
        })
      };
    }

    // Verify token
    const decoded = jwt.verify(jwtToken, process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production');
    
    // Check if token is expired
    if (decoded.exp < Math.floor(Date.now() / 1000)) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': process.env.URL || '*'
        },
        body: JSON.stringify({ 
          error: 'Token expired' 
        })
      };
    }

    // Return user information
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.URL || '*'
      },
      body: JSON.stringify({
        valid: true,
        user: {
          id: decoded.userId,
          email: decoded.email,
          companyName: decoded.companyName,
          subscriptionStatus: decoded.subscriptionStatus
        }
      })
    };

  } catch (error) {
    // Token is invalid
    return {
      statusCode: 401,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.URL || '*'
      },
      body: JSON.stringify({ 
        error: 'Invalid token' 
      })
    };
  }
};
