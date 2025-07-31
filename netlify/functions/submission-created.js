exports.handler = async (event, context) => {
  // Only run for form submissions
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    // Parse the form submission data
    const { payload } = JSON.parse(event.body);
    console.log('Form submission received:', payload.data);

    // Extract form data
    const formData = {
      first_name: payload.data.firstName || '',
      last_name: payload.data.lastName || '',
      email: payload.data.email || '',
      phone: payload.data.phone || '',
      address: payload.data.address || '',
      zip_code: payload.data.propertyType ? payload.data.address.split(' ').pop() : '', // Extract zip from address
      property_type: payload.data.propertyType || '',
      timeline: payload.data.timeline || '',
      details: payload.data.details || '',
      photo_urls: payload.data['photo-urls'] || '',
      price: 39.99, // Default price
      purchased: false,
      purchased_by: null,
      created_at: new Date().toISOString()
    };

    // Insert into Supabase
    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/leads`, {
      method: 'POST',
      headers: {
        'apikey': process.env.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(formData)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Supabase error:', response.status, errorText);
      throw new Error(`Supabase error: ${response.status} - ${errorText}`);
    }

    console.log('Successfully saved lead to database');

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        message: 'Lead saved successfully',
        leadData: formData 
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