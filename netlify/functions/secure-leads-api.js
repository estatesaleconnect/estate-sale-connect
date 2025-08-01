// netlify/functions/secure-leads-api.js
// Secure API for accessing leads with proper authentication and authorization

const jwt = require('jsonwebtoken');

// Rate limiting storage (in production, use Redis)
const rateLimitStorage = new Map();

exports.handler = async (event, context) => {
  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': process.env.URL || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
    // Authentication check
    const authResult = await authenticateRequest(event);
    if (!authResult.success) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: authResult.error })
      };
    }

    const user = authResult.user;
    console.log(`Authenticated request from: ${user.companyName}`);

    // Rate limiting check
    const rateLimitResult = checkRateLimit(user.userId, event.headers['client-ip'] || 'unknown');
    if (!rateLimitResult.allowed) {
      return {
        statusCode: 429,
        headers: {
          ...corsHeaders,
          'Retry-After': '3600'
        },
        body: JSON.stringify({ 
          error: 'Too many requests. Please try again later.',
          retryAfter: 3600
        })
      };
    }

    // Parse query parameters
    const queryParams = event.queryStringParameters || {};
    const {
      limit = '20',
      offset = '0',
      zipCode,
      radius = '25',
      timeline,
      propertyType,
      purchased = 'false'
    } = queryParams;

    // Validate and sanitize parameters
    const validatedParams = validateQueryParams({
      limit: parseInt(limit),
      offset: parseInt(offset),
      zipCode,
      radius: parseInt(radius),
      timeline,
      propertyType,
      purchased: purchased === 'true'
    });

    if (validatedParams.errors.length > 0) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Invalid parameters',
          details: validatedParams.errors
        })
      };
    }

    // Build secure query with row-level security
    const leads = await fetchLeadsSecurely(validatedParams.params, user);

    // Remove sensitive information and add computed fields
    const sanitizedLeads = leads.map(lead => sanitizeLead(lead, user));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        data: sanitizedLeads,
        meta: {
          count: sanitizedLeads.length,
          offset: validatedParams.params.offset,
          limit: validatedParams.params.limit,
          hasMore: sanitizedLeads.length === validatedParams.params.limit
        }
      })
    };

  } catch (error) {
    console.error('Secure leads API error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: 'Internal server error'
      })
    };
  }
};

// Authenticate request using JWT
async function authenticateRequest(event) {
  try {
    // Get token from Authorization header
    const authHeader = event.headers.authorization || event.headers.Authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { success: false, error: 'No valid authorization token provided' };
    }

    const token = authHeader.substring(7);
    
    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production');
    
    // Check if token is expired
    if (decoded.exp < Math.floor(Date.now() / 1000)) {
      return { success: false, error: 'Token expired' };
    }

    // Check subscription status
    if (decoded.subscriptionStatus !== 'active') {
      return { success: false, error: 'Active subscription required' };
    }

    return { 
      success: true, 
      user: {
        userId: decoded.userId,
        email: decoded.email,
        companyName: decoded.companyName,
        subscriptionStatus: decoded.subscriptionStatus
      }
    };

  } catch (error) {
    console.error('Authentication error:', error);
    return { success: false, error: 'Invalid token' };
  }
}

// Rate limiting implementation
function checkRateLimit(userId, clientIP) {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000; // 1 hour
  const maxRequests = 1000; // 1000 requests per hour per user
  
  const key = `${userId}-${clientIP}`;
  
  if (!rateLimitStorage.has(key)) {
    rateLimitStorage.set(key, {
      count: 1,
      resetTime: now + windowMs
    });
    return { allowed: true, remaining: maxRequests - 1 };
  }
  
  const userLimit = rateLimitStorage.get(key);
  
  // Reset if window expired
  if (now > userLimit.resetTime) {
    rateLimitStorage.set(key, {
      count: 1,
      resetTime: now + windowMs
    });
    return { allowed: true, remaining: maxRequests - 1 };
  }
  
  // Check if limit exceeded
  if (userLimit.count >= maxRequests) {
    return { allowed: false, remaining: 0 };
  }
  
  // Increment counter
  userLimit.count++;
  rateLimitStorage.set(key, userLimit);
  
  return { allowed: true, remaining: maxRequests - userLimit.count };
}

// Validate query parameters
function validateQueryParams(params) {
  const errors = [];
  const validatedParams = {};

  // Validate limit
  if (params.limit < 1 || params.limit > 100) {
    validatedParams.limit = 20;
    errors.push('Limit must be between 1 and 100, defaulting to 20');
  } else {
    validatedParams.limit = params.limit;
  }

  // Validate offset
  if (params.offset < 0) {
    validatedParams.offset = 0;
    errors.push('Offset must be non-negative, defaulting to 0');
  } else {
    validatedParams.offset = params.offset;
  }

  // Validate zipCode
  if (params.zipCode) {
    const zipRegex = /^\d{5}$/;
    if (!zipRegex.test(params.zipCode)) {
      errors.push('Invalid zip code format');
    } else {
      validatedParams.zipCode = params.zipCode;
    }
  }

  // Validate radius
  if (params.radius < 1 || params.radius > 1000) {
    validatedParams.radius = 25;
    errors.push('Radius must be between 1 and 1000 miles, defaulting to 25');
  } else {
    validatedParams.radius = params.radius;
  }

  // Validate timeline
  const validTimelines = ['asap', 'month', '1-3months', 'flexible', 'planning'];
  if (params.timeline && !validTimelines.includes(params.timeline)) {
    errors.push('Invalid timeline value');
  } else if (params.timeline) {
    validatedParams.timeline = params.timeline;
  }

  // Validate propertyType
  const validPropertyTypes = ['house', 'condo', 'apartment', 'storage', 'other'];
  if (params.propertyType && !validPropertyTypes.includes(params.propertyType)) {
    errors.push('Invalid property type');
  } else if (params.propertyType) {
    validatedParams.propertyType = params.propertyType;
  }

  // Validate purchased filter
  validatedParams.purchased = params.purchased === true;

  return { params: validatedParams, errors };
}

// Fetch leads with security controls
async function fetchLeadsSecurely(params, user) {
  try {
    // Build query with security filters
    let query = `${process.env.SUPABASE_URL}/rest/v1/Leads?select=id,first_name,last_name,email,phone,address,zip_code,property_type,timeline,details,photo_urls,price,created_at,purchased_by,exclusive_purchased_by,exclusive_purchase_date`;
    
    // Add filters
    const filters = [];
    
    // Timeline filter
    if (params.timeline) {
      filters.push(`timeline=eq.${params.timeline}`);
    }
    
    // Property type filter
    if (params.propertyType) {
      filters.push(`property_type=eq.${params.propertyType}`);
    }
    
    // Zip code and radius filter (simplified - in production use PostGIS)
    if (params.zipCode) {
      const zipStart = parseInt(params.zipCode);
      const zipRange = Math.floor(params.radius / 10); // Rough approximation
      filters.push(`zip_code.gte.${zipStart - zipRange}`);
      filters.push(`zip_code.lte.${zipStart + zipRange}`);
    }
    
    // Exclude leads this company already purchased
    filters.push(`purchased_by.not.eq.${user.companyName}`);
    filters.push(`exclusive_purchased_by.not.eq.${user.companyName}`);
    
    // Add filters to query
    if (filters.length > 0) {
      query += `&${filters.join('&')}`;
    }
    
    // Add ordering and pagination
    query += `&order=created_at.desc&limit=${params.limit}&offset=${params.offset}`;

    console.log('Executing secure query for:', user.companyName);

    const response = await fetch(query, {
      headers: {
        'apikey': process.env.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Database query failed: ${response.status}`);
    }

    const leads = await response.json();
    console.log(`Retrieved ${leads.length} leads for ${user.companyName}`);
    
    return leads;

  } catch (error) {
    console.error('Database fetch error:', error);
    throw new Error('Failed to fetch leads');
  }
}

// Sanitize lead data before sending to client
function sanitizeLead(lead, user) {
  // Calculate if lead is in exclusive window (24 hours)
  const submissionTime = new Date(lead.created_at);
  const now = new Date();
  const hoursSinceSubmission = (now - submissionTime) / (1000 * 60 * 60);
  const isInExclusiveWindow = hoursSinceSubmission < 24 && !lead.exclusive_purchased_by;
  
  // Determine if user has access to contact information
  const hasContactAccess = user.subscriptionStatus === 'active' && !lead.exclusive_purchased_by;
  
  // Base lead information (always visible)
  const sanitizedLead = {
    id: lead.id,
    propertyType: lead.property_type,
    timeline: lead.timeline,
    details: lead.details || '',
    photos: lead.photo_urls ? lead.photo_urls.split(' ').filter(url => url.trim()) : [],
    zipCode: lead.zip_code,
    dateSubmitted: lead.created_at ? lead.created_at.split('T')[0] : null,
    price: lead.price || 39.99,
    isInExclusiveWindow,
    exclusivePurchasedBy: lead.exclusive_purchased_by,
    exclusivePurchaseDate: lead.exclusive_purchase_date
  };

  // Add contact information only if user has access
  if (hasContactAccess) {
    sanitizedLead.firstName = lead.first_name;
    sanitizedLead.lastName = lead.last_name;
    sanitizedLead.email = lead.email;
    sanitizedLead.phone = lead.phone;
    sanitizedLead.address = lead.address;
  } else {
    // Hide contact information
    sanitizedLead.firstName = 'Subscribe';
    sanitizedLead.lastName = 'to view';
    sanitizedLead.email = 'subscription@required.com';
    sanitizedLead.phone = '***-***-****';
    sanitizedLead.address = 'Subscription required to view address';
  }

  return sanitizedLead;
}
