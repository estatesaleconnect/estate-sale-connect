// netlify/functions/get-config.js
// Secure configuration endpoint with proper authentication

const jwt = require('jsonwebtoken');

exports.handler = async (event, context) => {
  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': process.env.URL || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  // Only allow GET requests
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Check if this is an authenticated request
    const authHeader = event.headers.authorization || event.headers.Authorization;
    let isAuthenticated = false;
    let userRole = 'public';

    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production');
        
        if (decoded.exp > Math.floor(Date.now() / 1000)) {
          isAuthenticated = true;
          userRole = 'company';
        }
      } catch (error) {
        // Invalid token, treat as public
        console.log('Invalid token in config request');
      }
    }

    // Rate limiting
    const clientIP = event.headers['client-ip'] || event.headers['x-forwarded-for'] || 'unknown';
    if (!isRateLimited(clientIP)) {
      return {
        statusCode: 429,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Too many requests' 
        })
      };
    }

    // Return different configurations based on authentication
    if (isAuthenticated && userRole === 'company') {
      // Authenticated companies get limited access
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          environment: process.env.NODE_ENV || 'production',
          apiVersion: '1.0.0',
          features: {
            photoUpload: true,
            subscriptions: true,
            exclusivePurchases: true
          },
          limits: {
            maxPhotos: 12,
            maxLeadsPerPage: 100,
            rateLimit: 1000 // requests per hour
          }
        })
      };
    } else {
      // Public users get minimal configuration
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          environment: process.env.NODE_ENV || 'production',
          apiVersion: '1.0.0',
          features: {
            photoUpload: true,
            subscriptions: false,
            exclusivePurchases: false
          },
          limits: {
            maxPhotos: 12,
            rateLimit: 100 // requests per hour for public
          }
        })
      };
    }

  } catch (error) {
    console.error('Config error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: 'Failed to get configuration'
      })
    };
  }
};

// Simple in-memory rate limiting (in production, use Redis)
const rateLimitStorage = new Map();

function isRateLimited(clientIP) {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000; // 1 hour
  const maxRequests = 60; // 60 requests per hour for config endpoint
  
  if (!rateLimitStorage.has(clientIP)) {
    rateLimitStorage.set(clientIP, {
      count: 1,
      resetTime: now + windowMs
    });
    return true;
  }
  
  const userLimit = rateLimitStorage.get(clientIP);
  
  // Reset if window expired
  if (now > userLimit.resetTime) {
    rateLimitStorage.set(clientIP, {
      count: 1,
      resetTime: now + windowMs
    });
    return true;
  }
  
  // Check if limit exceeded
  if (userLimit.count >= maxRequests) {
    return false;
  }
  
  // Increment counter
  userLimit.count++;
  rateLimitStorage.set(clientIP, userLimit);
  
  return true;
}
