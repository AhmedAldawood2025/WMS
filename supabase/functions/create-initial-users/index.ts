import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const users = [
      {
        email: 'admin@spicymeal.com.sa',
        password: 'Ss@211251',
        display_name: 'Admin User',
        role: 'admin',
      },
      {
        email: 'test@spicymeal.com.sa',
        password: 'Ss@211251',
        display_name: 'Test Customer',
        role: 'customer',
      },
    ];

    const results = [];

    for (const user of users) {
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: user.email,
        password: user.password,
        email_confirm: true,
        user_metadata: {
          display_name: user.display_name,
          role: user.role,
        },
      });

      if (authError) {
        if (authError.message.includes('already registered')) {
          results.push({ email: user.email, status: 'already_exists' });
        } else {
          results.push({ email: user.email, status: 'error', error: authError.message });
        }
        continue;
      }

      results.push({ email: user.email, status: 'created', id: authData.user?.id });
    }

    return new Response(
      JSON.stringify({ success: true, results }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
});