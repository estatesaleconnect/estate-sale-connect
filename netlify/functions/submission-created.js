exports.handler = async (event, context) => {
  console.log('Function triggered!');
  console.log('Event:', JSON.stringify(event, null, 2));
  
  // Only run for form submissions
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    console.log('Raw event body:', event.body);
    
    // Parse the Netlify form submission
    let formData;
    
    // Check if it's JSON or form data
    if (event.headers['content-type'] && event.headers['content-type'].includes('application/json')) {
      const payload = JSON.parse(event.body);
      formData = payload.data || payload;
    } else {
      // Parse URL-encoded form data
      const params = new URLSearchParams(event.body);
      formData = {};
      for (const [key, value] of params) {
        formData[key] = value;
      }
    }
    
    console.log('Parsed form data:', formData);

    // Extract zip code from address
    function extractZipCode(address) {
      if (!address) return '';
      const zipMatch = address.match(/\b\d{5}(-\d{4})?\b/);
      return zipMatch ? zipMatch[0] : '';
    }

    // Create lead object for Supabase
    const leadData = {
      first_name: formData.firstName || formData.first_name || '',
      last_name: formData.lastName || formData.last_name || '',
      email: formData.email || '',
      phone: formData.phone || '',
      address: formData.address || '',
      zip_code: extractZipCode(formData.address) || '',
      property_type: formData.propertyType || formData.property_type || '',
      timeline: formData.timeline || '',
      details: formData.details || '',
      photo_urls: formData['photo-urls'] || formData.photo_urls || '',
      price: 39.99,
      purchased: false,
      purchased_by: null
    };

    console.log('Sending to Supabase:', leadData);

    // Insert into Supabase
    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/leads`, {
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
      throw new Error(`Supabase error: ${response.status} - ${errorText}`);
    }

    console.log('Successfully saved lead to database');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        message: 'Lead saved successfully',
        leadData: leadData 
      })
    };

  } catch (error) {
    console.error('Function error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Failed to process submission',
        details: error.message 
      })
    };
  }
};
