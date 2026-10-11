import { defineConfig, Plugin } from 'vite';
import fs from 'fs';
import path from 'path';

interface PairingSession {
  code: string;
  checkDigits: string;
  hostDeviceId: string;
  state: any;
  vaultId: string;
  status?: string;
  createdAt: number;
  expiresAt: number;
  guestDeviceId?: string;
  paired: boolean;
}

function localSyncPlugin(): Plugin {
  const syncFile = path.resolve(process.cwd(), '.sync_data.json');
  let vaults = new Map<string, { state: any; updatedAt: number }>();
  let pairings = new Map<string, PairingSession>();

  // Load from disk if available
  try {
    if (fs.existsSync(syncFile)) {
      const raw = JSON.parse(fs.readFileSync(syncFile, 'utf-8'));
      if (raw.vaults) {
        for (const [k, v] of Object.entries(raw.vaults)) {
          vaults.set(k, v as any);
        }
      }
    }
  } catch (err) {
    console.warn('Could not load .sync_data.json:', err);
  }

  function persistDisk() {
    try {
      const obj: { vaults: Record<string, any> } = { vaults: {} };
      for (const [k, v] of vaults.entries()) {
        obj.vaults[k] = v;
      }
      fs.writeFileSync(syncFile, JSON.stringify(obj, null, 2), 'utf-8');
    } catch (err) {
      console.warn('Could not save .sync_data.json:', err);
    }
  }

  function handler(req: any, res: any, next: () => void) {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (!url.pathname.startsWith('/api/sync/')) {
      return next();
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    const sendJson = (status: number, data: any) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(data));
    };

    const readBody = (): Promise<any> => {
      return new Promise((resolve) => {
        let buf = '';
        req.on('data', (chunk: any) => { buf += chunk; });
        req.on('end', () => {
          try {
            resolve(buf ? JSON.parse(buf) : {});
          } catch {
            resolve({});
          }
        });
      });
    };

    // 1. Create pairing code & register host state
    if (url.pathname === '/api/sync/pair/create' && req.method === 'POST') {
      readBody().then(body => {
        const rawCode = String(body.code || '').replace(/\s+/g, '');
        if (!rawCode || rawCode.length !== 6) {
          return sendJson(400, { success: false, error: 'Pairing code must be 6 digits' });
        }
        const vaultId = body.vaultId || ('vault_' + Math.random().toString(36).substring(2, 10));
        const checkDigits = body.checkDigits || String(Math.floor(100 + Math.random() * 900));
        pairings.set(rawCode, {
          code: rawCode,
          checkDigits,
          hostDeviceId: body.deviceId || 'host',
          state: body.state,
          vaultId,
          status: 'waiting_guest',
          createdAt: Date.now(),
          expiresAt: Date.now() + 10 * 60 * 1000,
          paired: false
        });
        if (body.state) {
          vaults.set(vaultId, { state: body.state, updatedAt: Date.now() });
          persistDisk();
        }
        sendJson(200, { success: true, code: rawCode, checkDigits, vaultId });
      });
      return;
    }

    // 2. Poll pairing status
    if (url.pathname === '/api/sync/pair/status' && req.method === 'GET') {
      const code = String(url.searchParams.get('code') || '').replace(/\s+/g, '');
      const session = pairings.get(code);
      if (!session) {
        return sendJson(404, { success: false, error: 'Pairing session expired or not found' });
      }
      sendJson(200, {
        success: true,
        status: session.status || (session.paired ? 'approved' : 'waiting_guest'),
        paired: session.status === 'approved' || !!session.paired,
        checkDigits: session.checkDigits,
        guestDeviceId: session.guestDeviceId,
        vaultId: session.vaultId
      });
      return;
    }

    // 3. Guest joins with pairing code
    if (url.pathname === '/api/sync/pair/join' && req.method === 'POST') {
      readBody().then(body => {
        const rawCode = String(body.code || '').replace(/\s+/g, '');
        const session = pairings.get(rawCode);
        if (!session) {
          return sendJson(404, { success: false, error: 'Pairing code not found or expired.' });
        }
        if (Date.now() > session.expiresAt) {
          pairings.delete(rawCode);
          return sendJson(410, { success: false, error: 'Pairing code has expired.' });
        }
        session.status = 'waiting_approval';
        session.guestDeviceId = body.deviceId || 'guest';
        
        sendJson(200, {
          success: true,
          status: 'waiting_approval',
          checkDigits: session.checkDigits,
          vaultId: session.vaultId
        });
      });
      return;
    }

    // 3b. Host approves guest device
    if (url.pathname === '/api/sync/pair/approve' && req.method === 'POST') {
      readBody().then(body => {
        const rawCode = String(body.code || '').replace(/\s+/g, '');
        const session = pairings.get(rawCode);
        if (!session) {
          return sendJson(404, { success: false, error: 'Pairing session not found or expired.' });
        }
        session.status = 'approved';
        session.paired = true;
        const timestamp = Date.now();
        if (body.state) {
          session.state = body.state;
          vaults.set(session.vaultId, { state: body.state, updatedAt: timestamp });
          persistDisk();
        }
        sendJson(200, {
          success: true,
          status: 'approved',
          vaultId: session.vaultId,
          updatedAt: timestamp
        });
      });
      return;
    }

    // 4. Vault query (GET)
    if (url.pathname === '/api/sync/vault' && req.method === 'GET') {
      const vaultId = url.searchParams.get('id');
      if (!vaultId || !vaults.has(vaultId)) {
        return sendJson(404, { success: false, error: 'Vault not found' });
      }
      const data = vaults.get(vaultId)!;
      sendJson(200, { success: true, state: data.state, updatedAt: data.updatedAt });
      return;
    }

    // 5. Vault update (POST)
    if (url.pathname === '/api/sync/vault' && req.method === 'POST') {
      readBody().then(body => {
        const vaultId = url.searchParams.get('id') || body.vaultId;
        if (!vaultId) {
          return sendJson(400, { success: false, error: 'Missing vault ID' });
        }
        vaults.set(vaultId, { state: body.state, updatedAt: Date.now() });
        persistDisk();
        sendJson(200, { success: true, updatedAt: Date.now() });
      });
      return;
    }

    // 6. Delete vault (DELETE)
    if (url.pathname === '/api/sync/vault' && req.method === 'DELETE') {
      const vaultId = url.searchParams.get('id');
      if (vaultId && vaults.has(vaultId)) {
        vaults.delete(vaultId);
        persistDisk();
      }
      sendJson(200, { success: true });
      return;
    }

    sendJson(404, { success: false, error: 'Unknown sync endpoint' });
  }

  return {
    name: 'local-sync-relay',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    }
  };
}

export default defineConfig({
  base: './',
  plugins: [localSyncPlugin()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true
  }
});
