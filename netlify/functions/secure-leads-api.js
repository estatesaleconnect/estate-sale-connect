// netlify/functions/secure-leads-api.js
const jwt = require('jsonwebtoken');

// Demo leads data (in production, this would come from Supabase)
const DEMO_LEADS = [
  {
    id: 1,
    firstName: 'John',
    lastName: 'Smith',
    email: 'john.smith@email.com',
    phone: '(555) 123-4567',
    address: '123 Main Street, Charlotte, NC 28202',
    zipCode: '28202',
    propertyType: 'house',
    timeline: 'asap',
    details: 'Large estate sale with antique furniture, jewelry collection, and household items. Family moving out of state.',
    photos: [
      'https://res.cloudinary.com/demo/image/upload/v1234567890/sample.jpg',
      'https://res.cloudinary.com/demo/image/upload/v1234567891/sample2.jpg'
    ],
    dateSubmitted: '2024-01-15',
    price: 39.99,
    isInExclusiveWindow: true,
    exclusivePurchasedBy: null,
    exclusivePurchaseDate: null,
    created_at: '2024-01-15T10:00:00Z'
  },
  {
    id: 2,
    firstName: 'Mary',
    lastName: 'Johnson',
    email: 'mary.johnson@email.com',
    phone: '(555) 987-6543',
    address: '456 Oak Avenue, Huntersville, NC 28078',
    zipCode: '28078',
    propertyType: 'condo',
    timeline: 'month',
    details: 'Downsizing sale with furniture, electronics, and collectibles. Need professional estate sale company.',
    photos: [
      'https://res.cloudinary.com/demo/image/upload/v1234567892/sample3.jpg'
    ],
    dateSubmitted: '2024-01-14',
    price: 39.99,
    isInExclusiveWindow: false,
    exclusivePurchasedBy: null,
    exclusivePurchaseDate: null,
    created_at: '2024-01-14T15:30:00Z'
  },
  {
    id: 3,
    firstName: 'Robert',
    lastName: 'Williams',
    email: 'bob.williams@email.com',
    phone: '(555) 456-7890',
    address: '789 Pine Street, Matthews, NC 28105',
    zipCode: '28105',
    propertyType: 'house',
    timeline: 'flexible',
    details: 'Complete household contents including tools, furniture, and vintage items. Timeline is flexible.',
    photos: [],
    dateSubmitted: '2024-01-13',
    price: 39.99,
    isInExclusiveWindow: false,
    exclusivePurchasedBy: null,
    exclusivePurchaseDate: null,
    created_at: '2024-01-13T09:15:00Z'
  }
];

exports.handler = async (event, context) => {
  console.log('🔐 Secure leads API called');
  console.log('Method:', event.httpMethod);
  console.log('Headers:', JSON.stringify(event.headers, null, 2));

  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    console.log('✅ Handling OPTIONS preflight request');
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  // Only allow GET requests
  if (event.httpMethod !== 'GET') {
    console.log('❌ Method not allowed:', event.httpMethod);
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Authentication check
    console.log('🔍 Checking authentication...');
    const authResult = await authenticateRequest(event);
    if (!authResult.success) {
      console.log('❌ Authentication failed:', authResult.error);
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: authResult.error })
      };
    }

    const user = authResult.user;
    console.log(`✅ Authenticated request from: ${user.companyName}`);

    // Parse query parameters
    const queryParams = event.queryStringParameters || {};
    const {
      limit = '20',
      offset = '0',
      zipCode,
      timeline,
      propertyType
    } = queryParams;

    console.log('Query params:', queryParams);

    // Apply filters to demo data
    let filteredLeads = [...DEMO_LEADS];

    // Timeline filter
    if (timeline) {
      filteredLeads = filteredLeads.filter(lead => lead.timeline === timeline);
      console.log(`Filtered by timeline '${timeline}':`, filteredLeads.length, 'leads');
    }

    // Property type filter
    if (propertyType) {
      filteredLeads = filteredLeads.filter(lead => lead.propertyType === propertyType);
      console.log(`Filtered by property type '${propertyType}':`, filteredLeads.length, 'leads');
    }

    // Zip code filter (simple)
    if (zipCode) {
      filteredLeads = filteredLeads.filter(lead => lead.zipCode === zipCode);
      console.log(`Filtered by zip code '${zipCode}':`, filteredLeads.length, 'leads');
    }

    // Apply pagination
    const limitNum = parseInt(limit) || 20;
    const offsetNum = parseInt(offset) || 0;
    const paginatedLeads = filteredLeads.slice(offsetNum, offsetNum + limitNum);

    console.log(`Returning ${paginatedLeads.length} leads (offset: ${offsetNum}, limit: ${limitNum})`);

    // Sanitize leads based on subscription status
    const sanitizedLeads = paginatedLeads.map(lead => sanitizeLead(lead, user));

    const response = {
      success: true,
      data: sanitizedLeads,
      meta: {
        count: sanitizedLeads.length,
        offset: offsetNum,
        limit: limitNum,
        hasMore: (offsetNum + limitNum) < filteredLeads.length,
        total: filteredLeads.length
      }
    };

    console.log('✅ Successfully returning leads data');

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response)
    };

  } catch (error) {
    console.error('💥 Secure leads API error:', error);
    console.error('Error stack:', error.stack);
    
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: 'Internal server error',
        details: error.message
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
    console.log('🎫 Verifying token:', token.substring(0, 20) + '...');
    
    // Verify JWT token
    const jwtSecret = process.env.JWT_SECRET || 'demo-secret-key-12345';
    const decoded = jwt.verify(token, jwtSecret);
    
    console.log('✅ Token decoded successfully:', decoded);
    
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

// Sanitize lead data before sending to client
function sanitizeLead(lead, user) {
  // Calculate if lead is in exclusive window (24 hours)
  const submissionTime = new Date(lead.created_at);
  const now = new Date();
  const hoursSinceSubmission = (now - submissionTime) / (1000 * 60 * 60);
  const isInExclusiveWindow = hoursSinceSubmission < 24 && !lead.exclusivePurchasedBy;
  
  // Determine if user has access to contact information
  const hasContactAccess = user.subscriptionStatus === 'active' && !lead.exclusivePurchasedBy;
  
  // Base lead information (always visible)
  const sanitizedLead = {
    id: lead.id,
    propertyType: lead.propertyType,
    timeline: lead.timeline,
    details: lead.details || '',
    photos: Array.isArray(lead.photos) ? lead.photos : [],
    zipCode: lead.zipCode,
    dateSubmitted: lead.dateSubmitted,
    price: lead.price || 39.99,
    isInExclusiveWindow,
    exclusivePurchasedBy: lead.exclusivePurchasedBy,
    exclusivePurchaseDate: lead.exclusivePurchaseDate
  };

  // Add contact information only if user has access
  if (hasContactAccess) {
    sanitizedLead.firstName = lead.firstName;
    sanitizedLead.lastName = lead.lastName;
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
