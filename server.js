// ============================================================
// server.js — Serveur WebSocket Business Empire
// Compatible Render (HTTP + WebSocket sur le même port)
// ============================================================
const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 10000;

// ------------------------------------------------------------
// Serveur HTTP minimal (Render exige un serveur HTTP)
// ------------------------------------------------------------
const server = http.createServer((req, res) => {
  // Endpoint de santé pour éviter que Render endorme le service
  if (req.url === '/health' || req.url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'business-empire-ws',
      uptime: process.uptime(),
      rooms: Object.keys(rooms).length,
      time: new Date().toISOString()
    }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('🟢 Business Empire WebSocket Server is running.\n');
});

// ------------------------------------------------------------
// Serveur WebSocket
// ------------------------------------------------------------
const wss = new WebSocket.Server({ server });

// rooms[code] = { host: ws, clients: [{ws, index, name}], createdAt }
const rooms = {};

function genRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

function log(msg) {
  console.log('[' + new Date().toISOString() + '] ' + msg);
}

// ------------------------------------------------------------
// Nettoyage périodique des salles mortes
// ------------------------------------------------------------
setInterval(() => {
  let cleaned = 0;
  for (const code in rooms) {
    const r = rooms[code];
    if (!r.host || r.host.readyState !== WebSocket.OPEN) {
      delete rooms[code];
      cleaned++;
    }
  }
  if (cleaned > 0) log('🧹 ' + cleaned + ' salle(s) morte(s) nettoyée(s)');
}, 60000);

// ------------------------------------------------------------
// Heartbeat : garde les connexions vivantes
// ------------------------------------------------------------
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      try { ws.terminate(); } catch (e) {}
      return;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  });
}, 30000);

// ------------------------------------------------------------
// Connexion WebSocket
// ------------------------------------------------------------
wss.on('connection', (ws) => {
  ws.roomCode = null;
  ws.isHost = false;
  ws.clientIndex = -1;
  ws.isAlive = true;

  ws.on('pong', () => { ws.isAlive = true; });

  log('+ Nouvelle connexion WS');

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      return;
    }
    if (!msg || !msg.type) return;

    // ------------------------------------------
    // HÔTE : créer une salle
    // ------------------------------------------
    if (msg.type === 'create') {
      let code;
      let attempts = 0;
      do {
        code = genRoomCode();
        attempts++;
      } while (rooms[code] && attempts < 50);

      rooms[code] = {
        host: ws,
        clients: [],
        createdAt: Date.now()
      };
      ws.roomCode = code;
      ws.isHost = true;

      ws.send(JSON.stringify({ type: 'created', roomCode: code }));
      log('🎮 Salle créée : ' + code);
      return;
    }

    // ------------------------------------------
    // CLIENT : rejoindre une salle
    // ------------------------------------------
    if (msg.type === 'join') {
      const room = rooms[msg.roomCode];
      if (!room) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Code invalide ou partie inexistante.'
        }));
        return;
      }
      if (room.clients.length >= 5) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Salle pleine (5 joueurs max).'
        }));
        return;
      }

      // Index du nouveau client (1..5)
      const idx = room.clients.length + 1;
      const name = String(msg.name || ('Joueur ' + idx)).substring(0, 12);

      room.clients.push({ ws, index: idx, name });
      ws.roomCode = msg.roomCode;
      ws.clientIndex = idx;
      ws.isHost = false;

      // Confirmer au client
      ws.send(JSON.stringify({
        type: 'joined',
        myIndex: idx,
        roomCode: msg.roomCode
      }));

      // Prévenir l'hôte
      if (room.host.readyState === WebSocket.OPEN) {
        room.host.send(JSON.stringify({
          type: 'client-joined',
          index: idx,
          name: name
        }));
      }

      log('👤 ' + name + ' a rejoint ' + msg.roomCode + ' (index ' + idx + ')');
      return;
    }

    // ------------------------------------------
    // ROUTAGE (après création/rejoint)
    // ------------------------------------------
    const room = rooms[ws.roomCode];
    if (!room) return;

    if (ws.isHost) {
      // Hôte → clients (tous ou un précis)
      if (msg.to !== undefined) {
        const c = room.clients.find((c) => c.index === msg.to);
        if (c && c.ws.readyState === WebSocket.OPEN) {
          c.ws.send(JSON.stringify(msg));
        }
      } else {
        room.clients.forEach((c) => {
          if (c.ws.readyState === WebSocket.OPEN) {
            c.ws.send(JSON.stringify(msg));
          }
        });
      }
    } else {
      // Client → hôte
      if (room.host.readyState === WebSocket.OPEN) {
        room.host.send(JSON.stringify({ ...msg, from: ws.clientIndex }));
      }
    }
  });

  // ------------------------------------------
  // Déconnexion
  // ------------------------------------------
  ws.on('close', () => {
    const room = rooms[ws.roomCode];
    if (!room) return;

    if (ws.isHost) {
      // L'hôte a quitté : prévenir tout le monde
      room.clients.forEach((c) => {
        if (c.ws.readyState === WebSocket.OPEN) {
          c.ws.send(JSON.stringify({ type: 'host-left' }));
        }
      });
      delete rooms[ws.roomCode];
      log('❌ Salle fermée : ' + ws.roomCode);
    } else {
      // Un client a quitté
      const ancienIndex = ws.clientIndex;
      room.clients = room.clients.filter((c) => c.ws !== ws);

      // Réindexer les clients restants (1..n)
      room.clients.forEach((c, i) => {
        const ancien = c.index;
        c.index = i + 1;
        if (c.ws.readyState === WebSocket.OPEN) {
          c.ws.send(JSON.stringify({
            type: 'reindex',
            oldIndex: ancien,
            newIndex: c.index
          }));
        }
      });

      if (room.host.readyState === WebSocket.OPEN) {
        room.host.send(JSON.stringify({
          type: 'client-left',
          index: ancienIndex
        }));
      }
      log('👋 Client ' + ancienIndex + ' parti de ' + ws.roomCode);
    }
  });

  ws.on('error', (err) => {
    log('⚠️  WS error : ' + err.message);
  });
});

// ------------------------------------------------------------
// Démarrage
// ------------------------------------------------------------
server.listen(PORT, () => {
  log('╔════════════════════════════════════════════╗');
  log('║   Business Empire — Serveur WebSocket      ║');
  log('║   Port : ' + PORT + '                              ║');
  log('║   URL  : http://localhost:' + PORT + '               ║');
  log('╚════════════════════════════════════════════╝');
});

// ------------------------------------------------------------
// Gestion des erreurs non catchées
// ------------------------------------------------------------
process.on('uncaughtException', (err) => {
  log('💥 uncaughtException : ' + err.message);
});
process.on('unhandledRejection', (reason) => {
  log('💥 unhandledRejection : ' + reason);
});
