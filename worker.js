// Cloudflare Worker for PocketLedger (Static Assets + Global Sync KV Relay)
const pairings = new Map();
const vaults = new Map();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. CORS Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // 2. Handle /api/sync/*
    if (url.pathname.startsWith('/api/sync/')) {
      const corsHeaders = {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Access-Control-Allow-Origin': '*',
      };

      // A. Create Pairing (Step 1 - Host Device)
      if (url.pathname === '/api/sync/pair/create' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const rawCode = String(body.code || '').replace(/\s+/g, '');
        if (!rawCode || rawCode.length !== 6) {
          return new Response(JSON.stringify({ success: false, error: 'Pairing code must be 6 digits' }), {
            status: 400,
            headers: corsHeaders,
          });
        }
        const vaultId = body.vaultId || ('vault_' + Math.random().toString(36).substring(2, 10));
        // Generate 3-digit check number (SAS)
        const checkDigits = body.checkDigits || String(Math.floor(100 + Math.random() * 900));
        const session = {
          code: rawCode,
          checkDigits,
          hostDeviceId: body.deviceId || 'host',
          state: body.state,
          vaultId,
          status: 'waiting_guest', // waiting_guest -> waiting_approval -> approved
          createdAt: Date.now(),
          expiresAt: Date.now() + 10 * 60 * 1000,
          paired: false,
        };

        if (env.SYNC_KV) {
          await env.SYNC_KV.put(`pair:${rawCode}`, JSON.stringify(session), { expirationTtl: 600 });
          if (body.state) {
            await env.SYNC_KV.put(`vault:${vaultId}`, JSON.stringify({ state: body.state, updatedAt: Date.now() }));
          }
        } else {
          pairings.set(rawCode, session);
          if (body.state) {
            vaults.set(vaultId, { state: body.state, updatedAt: Date.now() });
          }
        }

        return new Response(JSON.stringify({ success: true, code: rawCode, checkDigits, vaultId }), {
          status: 200,
          headers: corsHeaders,
        });
      }

      // B. Pair Status (Polled by both Host and Guest)
      if (url.pathname === '/api/sync/pair/status' && request.method === 'GET') {
        const code = String(url.searchParams.get('code') || '').replace(/\s+/g, '');
        let session;
        if (env.SYNC_KV) {
          const val = await env.SYNC_KV.get(`pair:${code}`);
          session = val ? JSON.parse(val) : null;
        } else {
          session = pairings.get(code);
        }

        if (!session) {
          return new Response(JSON.stringify({ success: false, error: 'Pairing session expired or not found' }), {
            status: 404,
            headers: corsHeaders,
          });
        }
        return new Response(JSON.stringify({
          success: true,
          status: session.status || (session.paired ? 'approved' : 'waiting_guest'),
          paired: session.status === 'approved' || !!session.paired,
          checkDigits: session.checkDigits,
          guestDeviceId: session.guestDeviceId,
          vaultId: session.vaultId,
        }), {
          status: 200,
          headers: corsHeaders,
        });
      }

      // C. Pair Join (Step 2 - Guest Device submits 6-digit code)
      if (url.pathname === '/api/sync/pair/join' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const rawCode = String(body.code || '').replace(/\s+/g, '');
        let session;
        if (env.SYNC_KV) {
          const val = await env.SYNC_KV.get(`pair:${rawCode}`);
          session = val ? JSON.parse(val) : null;
        } else {
          session = pairings.get(rawCode);
        }

        if (!session) {
          return new Response(JSON.stringify({ success: false, error: 'Pairing code not found or expired.' }), {
            status: 404,
            headers: corsHeaders,
          });
        }
        if (Date.now() > session.expiresAt) {
          if (env.SYNC_KV) await env.SYNC_KV.delete(`pair:${rawCode}`);
          else pairings.delete(rawCode);
          return new Response(JSON.stringify({ success: false, error: 'Pairing code has expired.' }), {
            status: 410,
            headers: corsHeaders,
          });
        }

        // Set state to waiting_approval
        session.status = 'waiting_approval';
        session.guestDeviceId = body.deviceId || 'guest';

        if (env.SYNC_KV) {
          await env.SYNC_KV.put(`pair:${rawCode}`, JSON.stringify(session), { expirationTtl: 600 });
        }

        return new Response(JSON.stringify({
          success: true,
          status: 'waiting_approval',
          checkDigits: session.checkDigits,
          vaultId: session.vaultId,
        }), {
          status: 200,
          headers: corsHeaders,
        });
      }

      // D. Pair Approve (Step 3 - Host Device allows the other device)
      if (url.pathname === '/api/sync/pair/approve' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const rawCode = String(body.code || '').replace(/\s+/g, '');
        let session;
        if (env.SYNC_KV) {
          const val = await env.SYNC_KV.get(`pair:${rawCode}`);
          session = val ? JSON.parse(val) : null;
        } else {
          session = pairings.get(rawCode);
        }

        if (!session) {
          return new Response(JSON.stringify({ success: false, error: 'Pairing session not found or expired.' }), {
            status: 404,
            headers: corsHeaders,
          });
        }

        session.status = 'approved';
        session.paired = true;

        const timestamp = Date.now();
        if (body.state) {
          session.state = body.state;
          if (env.SYNC_KV) {
            await env.SYNC_KV.put(`vault:${session.vaultId}`, JSON.stringify({ state: body.state, updatedAt: timestamp }));
          } else {
            vaults.set(session.vaultId, { state: body.state, updatedAt: timestamp });
          }
        }

        if (env.SYNC_KV) {
          await env.SYNC_KV.put(`pair:${rawCode}`, JSON.stringify(session), { expirationTtl: 600 });
        }

        return new Response(JSON.stringify({
          success: true,
          status: 'approved',
          vaultId: session.vaultId,
          updatedAt: timestamp,
        }), {
          status: 200,
          headers: corsHeaders,
        });
      }

      // E. Vault GET (Fetch latest state)
      if (url.pathname === '/api/sync/vault' && request.method === 'GET') {
        const vaultId = url.searchParams.get('id');
        let vaultData;
        if (env.SYNC_KV) {
          const val = await env.SYNC_KV.get(`vault:${vaultId}`);
          vaultData = val ? JSON.parse(val) : null;
        } else {
          vaultData = vaults.get(vaultId);
        }

        if (!vaultData) {
          return new Response(JSON.stringify({ success: false, error: 'Vault not found' }), {
            status: 404,
            headers: corsHeaders,
          });
        }
        return new Response(JSON.stringify({ success: true, state: vaultData.state, updatedAt: vaultData.updatedAt }), {
          status: 200,
          headers: corsHeaders,
        });
      }

      // F. Vault POST (Push updated state)
      if (url.pathname === '/api/sync/vault' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const vaultId = url.searchParams.get('id') || body.vaultId;
        if (!vaultId) {
          return new Response(JSON.stringify({ success: false, error: 'Missing vault ID' }), {
            status: 400,
            headers: corsHeaders,
          });
        }
        const timestamp = Date.now();
        const vaultData = { state: body.state, updatedAt: timestamp };
        if (env.SYNC_KV) {
          await env.SYNC_KV.put(`vault:${vaultId}`, JSON.stringify(vaultData));
        } else {
          vaults.set(vaultId, vaultData);
        }
        return new Response(JSON.stringify({ success: true, updatedAt: timestamp }), {
          status: 200,
          headers: corsHeaders,
        });
      }

      // G. Vault DELETE
      if (url.pathname === '/api/sync/vault' && request.method === 'DELETE') {
        const vaultId = url.searchParams.get('id');
        if (vaultId) {
          if (env.SYNC_KV) {
            await env.SYNC_KV.delete(`vault:${vaultId}`);
          } else {
            vaults.delete(vaultId);
          }
        }
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: corsHeaders,
        });
      }

      return new Response(JSON.stringify({ success: false, error: 'Unknown sync endpoint' }), {
        status: 404,
        headers: corsHeaders,
      });
    }

    // 3. Fallback to static assets
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response('Not Found', { status: 404 });
  },
};
