// netlify/functions/validate-lead-data.js
// Server-side input validation and sanitization

exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const rawData = JSON.parse(event.body);
    
    // Validate and sanitize all input fields
    const validatedData = validateLeadData(rawData);
    
    if (validatedData.errors.length > 0) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': process.env.URL || '*'
        },
        body: JSON.stringify({ 
          error: 'Validation failed',
          details: validatedData.errors
        })
      };
    }

    // Extract zip code from address
    function extractZipCode(address) {
      if (!address) return '';
      const zipMatch = address.match(/\b\d{5}(-\d{4})?\b/);
      return zipMatch ? zipMatch[0].substring(0, 5) : '';
    }

    // Prepare sanitized data for database
    const leadData = {
      first_name: validatedData.data.firstName,
      last_name: validatedData.data.lastName,
      email: validatedData.data.email,
      phone: validatedData.data.phone,
      address: validatedData.data.address,
      zip_code: extractZipCode(validatedData.data.address),
      property_type: validatedData.data.propertyType,
      timeline: validatedData.data.timeline,
      details: validatedData.data.details,
      photo_urls: validatedData.data.photoUrls,
      price: 39.99,
      purchased: false,
      purchased_by: null,
      exclusive_purchased_by: null,
      created_at: new Date().toISOString()
    };

    console.log('Validated lead data:', {
      ...leadData,
      details: leadData.details.substring(0, 100) + '...' // Truncate for logging
    });

    // Insert into Supabase with validated data
    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/Leads`, {
      method: 'POST',
      headers: {
        'apikey': process.env.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(leadData)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Supabase error:', response.status, errorText);
      throw new Error(`Database error: ${response.status}`);
    }

    console.log('Lead successfully saved to database');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.URL || '*'
      },
      body: JSON.stringify({ 
        success: true,
        message: 'Lead submitted successfully'
      })
    };

  } catch (error) {
    console.error('Lead validation error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.URL || '*'
      },
      body: JSON.stringify({ 
        error: 'Failed to process submission'
      })
    };
  }
};

// Comprehensive input validation and sanitization
function validateLeadData(data) {
  const errors = [];
  const sanitized = {};

  // Helper function to sanitize text input
  function sanitizeText(input, maxLength = 1000) {
    if (typeof input !== 'string') return '';
    
    // Remove potential XSS vectors
    let cleaned = input
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove script tags
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '') // Remove iframe tags
      .replace(/javascript:/gi, '') // Remove javascript: protocol
      .replace(/on\w+\s*=/gi, '') // Remove event handlers (onclick, onload, etc)
      .replace(/<[^>]*>/g, '') // Remove all HTML tags
      .trim();
    
    // Limit length
    if (cleaned.length > maxLength) {
      cleaned = cleaned.substring(0, maxLength);
    }
    
    return cleaned;
  }

  // Helper function to validate email
  function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email) && email.length <= 254;
  }

  // Helper function to validate phone
  function sanitizePhone(phone) {
    if (typeof phone !== 'string') return '';
    // Remove all non-digits except + - ( ) spaces
    const cleaned = phone.replace(/[^0-9+\-() ]/g, '').trim();
    return cleaned.length >= 10 && cleaned.length <= 20 ? cleaned : '';
  }

  // Validate firstName
  if (!data.firstName || typeof data.firstName !== 'string') {
    errors.push('First name is required');
  } else {
    sanitized.firstName = sanitizeText(data.firstName, 50);
    if (sanitized.firstName.length < 1) {
      errors.push('First name cannot be empty');
    }
  }

  // Validate lastName
  if (!data.lastName || typeof data.lastName !== 'string') {
    errors.push('Last name is required');
  } else {
    sanitized.lastName = sanitizeText(data.lastName, 50);
    if (sanitized.lastName.length < 1) {
      errors.push('Last name cannot be empty');
    }
  }

  // Validate email
  if (!data.email || typeof data.email !== 'string') {
    errors.push('Email is required');
  } else {
    const cleanEmail = data.email.trim().toLowerCase();
    if (!isValidEmail(cleanEmail)) {
      errors.push('Invalid email format');
    } else {
      sanitized.email = cleanEmail;
    }
  }

  // Validate phone
  if (!data.phone || typeof data.phone !== 'string') {
    errors.push('Phone number is required');
  } else {
    sanitized.phone = sanitizePhone(data.phone);
    if (!sanitized.phone) {
      errors.push('Invalid phone number format');
    }
  }

  // Validate address
  if (!data.address || typeof data.address !== 'string') {
    errors.push('Address is required');
  } else {
    sanitized.address = sanitizeText(data.address, 200);
    if (sanitized.address.length < 10) {
      errors.push('Address must be at least 10 characters');
    }
  }

  // Validate propertyType
  const validPropertyTypes = ['house', 'condo', 'apartment', 'storage', 'other'];
  if (!data.propertyType || !validPropertyTypes.includes(data.propertyType)) {
    errors.push('Invalid property type');
  } else {
    sanitized.propertyType = data.propertyType;
  }

  // Validate timeline
  const validTimelines = ['asap', 'month', '1-3months', 'flexible', 'planning'];
  if (!data.timeline || !validTimelines.includes(data.timeline)) {
    errors.push('Invalid timeline');
  } else {
    sanitized.timeline = data.timeline;
  }

  // Validate details
  if (!data.details || typeof data.details !== 'string') {
    errors.push('Details are required');
  } else {
    sanitized.details = sanitizeText(data.details, 2000);
    if (sanitized.details.length < 10) {
      errors.push('Details must be at least 10 characters');
    }
  }

  // Validate photo URLs
  sanitized.photoUrls = '';
  if (data['photo-urls'] && typeof data['photo-urls'] === 'string') {
    const urls = data['photo-urls'].split(' ').filter(url => url.trim());
    const validUrls = [];
    
    for (const url of urls) {
      // Basic URL validation for Cloudinary URLs
      if (url.startsWith('https://res.cloudinary.com/') || 
          url.startsWith('data:image/')) {
        validUrls.push(url);
      }
    }
    
    // Limit to maximum 12 photos
    if (validUrls.length > 12) {
      validUrls.splice(12);
    }
    
    sanitized.photoUrls = validUrls.join(' ');
  }

  return {
    data: sanitized,
    errors: errors
  };
}
