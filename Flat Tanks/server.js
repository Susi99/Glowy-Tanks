const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const compression = require("compression");

const app = express();

// Enable compression for better performance
app.use(compression());

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['websocket', 'polling'],
  // Performance optimizations
  perMessageDeflate: {
    threshold: 1024 // Only compress messages larger than 1KB
  },
  httpCompression: {
    threshold: 1024
  }
});

// Serve static files from 'public' directory
app.use(express.static("public"));

// Add CORS headers for ngrok
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

// Game states
let games = {};
let gameCounter = 0;
let lastPowerUpSpawnTime = {};

// Constants
const TICK_RATE = 60; // 60 ticks per second for smoother gameplay
const TICK_INTERVAL = 1000 / TICK_RATE;
const MAP_WIDTH = 1000;
const MAP_HEIGHT = 720;
const TANK_SPEED = 60; // pixels per second - base movement speed
const TANK_ACCELERATION = 600; // pixels per second squared
const TANK_DECELERATION = 900; // pixels per second squared
const TANK_MAX_SPEED = 60; // maximum speed in pixels per second
const BULLET_SPEED = 300; // bullet speed in pixels per second
const BULLET_DAMAGE = 20;
const SHOOT_COOLDOWN = 1500; // 1.5 seconds between shots
const RAPID_FIRE_COOLDOWN = 400; // 0.4 seconds between shots for rapid fire
const MAX_HP = 100;
const RESPAWN_TIME = 3000; // 3 seconds
const MAX_PLAYERS = 50;
const CHAT_MAX_MESSAGES = 60;

// Power-up constants
const POWER_UP_LIFETIME = 30000; // 30 seconds
const POWER_UP_RADIUS = 30; // Collection radius

const POWER_UP_TYPES = {
  SPEED: { name: "speed", duration: 5000, multiplier: 2 }, // 2x for 10s
  RAPID_FIRE: { name: "rapidFire", duration: 5000, shots: 3, spread: 0.12 }, // 3-shot spread for 5s
  SHIELD: { name: "shield", duration: 5000 }, // invincible 5s
  DAMAGE_BOOST: { name: "damageBoost", duration: 10000, multiplier: 1.5 }, // 1.5x damage for 10s
  HEALTH_PACK: { name: "healthPack", duration: 0, value: 50 }, // +50 HP instant
};

// Random spawn function
const getRandomSpawn = () => ({
  x: Math.random() * (MAP_WIDTH - 40) + 20,
  y: Math.random() * (MAP_HEIGHT - 40) + 20,
});

const NAME_MAX = 20;
const COLORS = [
  "#4a90e2",
  "#e74c3c",
  "#f1c40f",
  "#9b59b6",
  "#1abc9c",
  "#e67e22",
  "#2ecc71",
  "#ff6b6b",
  "#3498db",
  "#8e44ad",
  "#16a085",
  "#d35400",
];

function sanitizeString(name) {
  if (typeof name !== "string") return "";
  let s = name.trim();
  if (!s) return "";
  // Collapse whitespace and strip control chars
  s = s.replace(/\s+/g, " ").replace(/[\x00-\x1F]/g, "");
  if (s.length > NAME_MAX) s = s.slice(0, NAME_MAX);
  return s;
}

function randomColor() {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

function broadcastPlayerName(gameId, playerId) {
  const game = games[gameId];
  if (!game || !game.players[playerId]) return;
  const player = game.players[playerId];
  io.to(gameId).emit("player:name", { id: playerId, name: player.name || "" });
}

function broadcastSystemMessage(gameId, text) {
  pushChatMessage(gameId, {
    playerId: null,
    text: text,
    timestamp: Date.now(),
    system: true,
  });
}

// Power-up functions
function spawnPowerUp(gameId) {
  const game = games[gameId];
  if (!game) return;
  if (!game.powerUps) game.powerUps = [];

  const types = Object.keys(POWER_UP_TYPES);
  const randomType = types[Math.floor(Math.random() * types.length)];

  const powerUp = {
    id: Date.now() + Math.random(),
    type: randomType, // server key (e.g., "SPEED")
    uiType: POWER_UP_TYPES[randomType].name, // client-friendly (e.g., "speed")
    x: Math.random() * (MAP_WIDTH - 40) + 20,
    y: Math.random() * (MAP_HEIGHT - 40) + 20,
    createdAt: Date.now(),
  };

  game.powerUps.push(powerUp);
}

function applyPowerUp(gameId, playerId, powerUpType) {
  const game = games[gameId];
  if (!game || !game.players[playerId]) return;

  const player = game.players[playerId];
  const typeKey = String(powerUpType).toUpperCase(); // normalize client/server casing
  const cfg = POWER_UP_TYPES[typeKey];
  if (!cfg) return;

  switch (typeKey) {
    case "HEALTH_PACK":
      player.hp = Math.min(MAX_HP, player.hp + (cfg.value || 0));
      break;

    case "SPEED":
      player.speedBoost = true;
      player.speedBoostExpireTime = Date.now() + (cfg.duration || 10000);
      break;

    case "RAPID_FIRE":
      player.rapidFire = true;
      player.rapidFireExpireTime = Date.now() + (cfg.duration || 10000);
      break;

    case "SHIELD":
      player.shield = true;
      player.shieldExpireTime = Date.now() + (cfg.duration || 10000);
      break;

    case "DAMAGE_BOOST":
      player.damageBoost = true;
      player.damageBoostExpireTime = Date.now() + (cfg.duration || 10000);
      break;
  }
}

// Utility to push chat messages to the game log
function pushChatMessage(gameId, { playerId, text, timestamp, system }) {
  const game = games[gameId];
  if (!game) return;
  if (!game.chat) game.chat = [];
  game.chat.push({
    playerId: playerId || null,
    text: String(text || ""),
    timestamp: timestamp || Date.now(),
    system: !!system,
  });
  if (game.chat.length > CHAT_MAX_MESSAGES) {
    game.chat.shift();
  }
}

io.on("connection", (socket) => {
  socket.on("join", (data) => {
    if (!data || !data.serverId) {
      socket.emit("error", "Missing serverId");
      return;
    }
    const gameId = data.serverId;
    const game = games[gameId];
    if (!game) {
      socket.emit("error", "Game not found");
      return;
    }

    // Cancel cleanup timer if a player joins
    if (game.cleanupTimer) {
      clearTimeout(game.cleanupTimer);
      delete game.cleanupTimer;
    }

    socket.join(gameId);
    socket.gameId = gameId;

    const safeName = sanitizeString(data.name || "");
    const color = randomColor();

    game.players[socket.id] = {
      id: socket.id,
      x: Math.random() * (MAP_WIDTH - 40) + 20,
      y: Math.random() * (MAP_HEIGHT - 40) + 20,
      vx: 0, // velocity x
      vy: 0, // velocity y
      rotation: 0,
      turretRotation: 0,
      inputs: {},
      name: safeName,
      color,
      hp: MAX_HP,
      dead: false,
      respawnTime: 0,
      speedBoost: false,
      speedBoostExpireTime: null,
      rapidFire: false,
      rapidFireExpireTime: null,
      shield: false,
      shieldExpireTime: null,
      damageBoost: false,
      damageBoostExpireTime: null,
      lastShotTime: 0,
      invulnerable: false,
      lastProcessedInput: 0,
      inputQueue: [],
    };

    if (game.scores) {
      game.scores[socket.id] = 0;
    }

    broadcastPlayerName(gameId, socket.id);

    pushChatMessage(gameId, {
      playerId: null,
      text: `${safeName || "A player"} joined the game.`,
      timestamp: Date.now(),
      system: true,
    });

    socket.emit("join", {
      id: socket.id,
      gameId,
      name: safeName,
      color,
      mapWidth: MAP_WIDTH,
      mapHeight: MAP_HEIGHT,
    });
  });

  socket.on("input", (inputs) => {
    const gameId = socket.gameId;
    const game = games[gameId];
    if (!game || !game.players[socket.id]) return;

    const player = game.players[socket.id];
    if (Array.isArray(inputs)) {
      player.inputQueue.push(...inputs);
      // Keep queue reasonable size
      if (player.inputQueue.length > 180) {
        player.inputQueue = player.inputQueue.slice(-120);
      }
    }
  });

  socket.on("shoot", (data) => {
    const gameId = socket.gameId;
    const game = games[gameId];
    if (!game) return;

    const player = game.players?.[socket.id];
    if (!player || player.dead) return;

    const now = Date.now();
    const isRapid = !!player.rapidFire;
    const cooldown = isRapid ? RAPID_FIRE_COOLDOWN : SHOOT_COOLDOWN;

    if (
      typeof player.lastShotTime === "number" &&
      now - player.lastShotTime < cooldown
    ) {
      return; // shoot request ignored due to cooldown
    }

    const angle = Number(data?.angle) || 0;
    const shots = isRapid ? POWER_UP_TYPES.RAPID_FIRE.shots || 3 : 1;
    const spread = POWER_UP_TYPES.RAPID_FIRE.spread || 0.1;

    // Create laser beam projectiles
    for (let i = 0; i < shots; i++) {
      const offset = shots === 1 ? 0 : (i - (shots - 1) / 2) * spread;
      const a = angle + offset;
      const dt = 1 / TICK_RATE;
      
      game.bullets.push({
        x: player.x,
        y: player.y,
        vx: Math.cos(a) * BULLET_SPEED * dt,
        vy: Math.sin(a) * BULLET_SPEED * dt,
        angle: a,
        owner: socket.id,
        color: player.color,
        createdAt: now,
        bounces: 0
      });
    }

    player.lastShotTime = now;
  });

  socket.on("chat:message", (data) => {
    const gameId = socket.gameId;
    const game = games[gameId];
    if (!game || !game.players[socket.id]) return;

    const unsafeText = (data && data.text) || "";
    const sanitizedText = sanitizeString(unsafeText).slice(0, 200);

    if (!sanitizedText) return;

    pushChatMessage(gameId, {
      playerId: socket.id,
      text: sanitizedText,
      timestamp: Date.now(),
      system: false,
    });

    io.to(gameId).emit("chat:message", {
      playerId: socket.id,
      text: sanitizedText,
      timestamp: Date.now(),
      system: false,
    });
  });

  socket.on("getServers", () => {
    const activeServers = [];
    for (const gameId in games) {
      const game = games[gameId];
      if (!game) continue;
      if (game.players) {
        const playerCount = Object.keys(game.players).length;
        // Only add games with actual players
        if (playerCount > 0) {
          activeServers.push({
            id: String(game.id),
            name: String(game.name),
            players: playerCount,
            maxPlayers: MAX_PLAYERS,
          });
        }
      }
    }
    socket.emit("servers", activeServers);
  });

  socket.on("host", (data) => {
    try {
      if (!data) {
        socket.emit("error", "Invalid host data");
        return;
      }

      const gameId = `game_${++gameCounter}`;
      const gameName =
        (data && data.name ? String(data.name) : "") || `Game ${gameCounter}`;
      const mapType = (data && data.map) || "green"; // Default to green map if not specified
      games[gameId] = {
        id: gameId,
        name: gameName,
        mapType: mapType,
        players: {},
        bullets: [],
        powerUps: [],
        scores: {},
        chat: [],
      };

      socket.join(gameId);
      socket.gameId = gameId;

      const safeName = sanitizeString(data.playerName || "");
      const color = randomColor();

      games[gameId].players[socket.id] = {
        id: socket.id,
        x: Math.random() * (MAP_WIDTH - 40) + 20,
        y: Math.random() * (MAP_HEIGHT - 40) + 20,
        vx: 0, // velocity x
        vy: 0, // velocity y
        rotation: 0,
        turretRotation: 0,
        inputs: {},
        name: safeName,
        color,
        hp: MAX_HP,
        dead: false,
        respawnTime: 0,
        speedBoost: false,
        speedBoostExpireTime: null,
        rapidFire: false,
        rapidFireExpireTime: null,
        shield: false,
        shieldExpireTime: null,
        damageBoost: false,
        damageBoostExpireTime: null,
        lastShotTime: 0,
        invulnerable: false,
        invulnerableExpireTime: null,
        lastProcessedInput: 0,
        inputQueue: [],
      };

      if (games[gameId].scores) {
        games[gameId].scores[socket.id] = 0;
      }

      broadcastPlayerName(gameId, socket.id);

      pushChatMessage(gameId, {
        playerId: null,
        text: `Server "${gameName}" created.`,
        timestamp: Date.now(),
        system: true,
      });

      socket.emit("join", {
        id: socket.id,
        gameId,
        name: gameName,
        mapType,
        mapWidth: MAP_WIDTH,
        mapHeight: MAP_HEIGHT,
      });
    } catch (err) {
      console.error("Error in host:", err);
      socket.emit("error", "Unable to host server");
    }
  });

  socket.on("disconnect", () => {
    const gameId = socket.gameId;
    if (!gameId || !games[gameId]) return;

    const player = games[gameId].players[socket.id];
    if (player) {
      pushChatMessage(gameId, {
        playerId: null,
        text: `${player.name || "A player"} left the game.`,
        timestamp: Date.now(),
        system: true,
      });
      delete games[gameId].players[socket.id];
      if (games[gameId].scores) {
        delete games[gameId].scores[socket.id];
      }
    }

    // If game becomes empty, schedule it for cleanup
    if (Object.keys(games[gameId].players).length === 0) {
      games[gameId].cleanupTimer = setTimeout(() => {
        if (games[gameId] && Object.keys(games[gameId].players).length === 0) {
          delete games[gameId];
          console.log(`Game ${gameId} has been cleaned up.`);
        }
      }, 10000); // 10-second delay
    }
  });
});

/**
 * Apply player input with smooth physics-based movement
 * Uses acceleration/deceleration for responsive but smooth movement
 * @param {Object} player - The player object to update
 * @param {Object} input - Input data containing keys, rotation, and delta time
 */
function applyInput(player, input) {
  if (!player || !input || !input.inputs) return;

  const dt = input.dt || 1 / 60;
  
  // Calculate target velocity based on input
  let targetVx = 0;
  let targetVy = 0;
  
  // Determine movement direction from inputs
  if (input.inputs.w) targetVy -= 1;
  if (input.inputs.s) targetVy += 1;
  if (input.inputs.a) targetVx -= 1;
  if (input.inputs.d) targetVx += 1;
  
  // Normalize diagonal movement to prevent faster diagonal speed
  const inputMagnitude = Math.sqrt(targetVx * targetVx + targetVy * targetVy);
  if (inputMagnitude > 0) {
    targetVx /= inputMagnitude;
    targetVy /= inputMagnitude;
  }
  
  // Apply speed modifiers
  let maxSpeed = TANK_MAX_SPEED;
  if (player.speedBoost) {
    maxSpeed *= POWER_UP_TYPES.SPEED.multiplier;
  }
  
  // Scale to max speed
  targetVx *= maxSpeed;
  targetVy *= maxSpeed;
  
  // Smooth acceleration/deceleration
  const acceleration = inputMagnitude > 0 ? TANK_ACCELERATION : TANK_DECELERATION;
  
  // Interpolate current velocity towards target velocity
  const vxDiff = targetVx - player.vx;
  const vyDiff = targetVy - player.vy;
  const accelAmount = acceleration * dt;
  
  if (Math.abs(vxDiff) < accelAmount) {
    player.vx = targetVx;
  } else {
    player.vx += Math.sign(vxDiff) * accelAmount;
  }
  
  if (Math.abs(vyDiff) < accelAmount) {
    player.vy = targetVy;
  } else {
    player.vy += Math.sign(vyDiff) * accelAmount;
  }
  
  // Apply velocity to position
  player.x += player.vx * dt;
  player.y += player.vy * dt;
  
  // Enforce map boundaries with bounce-back
  const TANK_RADIUS = 20;
  if (player.x < TANK_RADIUS) {
    player.x = TANK_RADIUS;
    player.vx = Math.max(0, player.vx); // Stop negative velocity
  } else if (player.x > MAP_WIDTH - TANK_RADIUS) {
    player.x = MAP_WIDTH - TANK_RADIUS;
    player.vx = Math.min(0, player.vx); // Stop positive velocity
  }
  
  if (player.y < TANK_RADIUS) {
    player.y = TANK_RADIUS;
    player.vy = Math.max(0, player.vy); // Stop negative velocity
  } else if (player.y > MAP_HEIGHT - TANK_RADIUS) {
    player.y = MAP_HEIGHT - TANK_RADIUS;
    player.vy = Math.min(0, player.vy); // Stop positive velocity
  }
  
  // Update rotation (instant, no smoothing needed for rotation)
  if (typeof input.rotation === 'number') {
    player.rotation = input.rotation;
  }
  if (typeof input.turretRotation === 'number') {
    player.turretRotation = input.turretRotation;
  }
  if (typeof input.seq === 'number') {
    player.lastProcessedInput = input.seq;
  }
}

// Game loop
setInterval(() => {
  for (const gameId in games) {
    const game = games[gameId];
    if (!game) continue;

    // Spawn power-ups periodically (every 7 seconds) with a cap
    const now = Date.now();
    if (!lastPowerUpSpawnTime[gameId]) lastPowerUpSpawnTime[gameId] = 0;
    if (now - lastPowerUpSpawnTime[gameId] > 7000) {
      lastPowerUpSpawnTime[gameId] = now;
      if ((game.powerUps?.length || 0) < 6) {
        spawnPowerUp(gameId);
      }
    }

    // Handle bullet collisions with continuous collision detection
    if (!game.bullets) game.bullets = [];
    if (!game.players) game.players = {};
    
    const TANK_RADIUS = 25;
    const bulletMaxAge = 10000; // 10 seconds - enough time for multiple bounces
    
    // Check collisions BEFORE moving bullets
    const TANK_RADIUS_SQ = TANK_RADIUS * TANK_RADIUS; // Use squared distance to avoid sqrt
    for (let i = game.bullets.length - 1; i >= 0; i--) {
      const bullet = game.bullets[i];
      if (!bullet) continue;
      
      let hit = false;
      
      // Check collision with all players
      for (const id in game.players) {
        if (id === bullet.owner) continue;
        const target = game.players[id];
        if (!target || target.dead || target.invulnerable) continue;
        
        // Current position check (using squared distance)
        const dx = target.x - bullet.x;
        const dy = target.y - bullet.y;
        const distSq = dx * dx + dy * dy;
        
        // Also check next position (continuous collision detection)
        const nextX = bullet.x + bullet.vx;
        const nextY = bullet.y + bullet.vy;
        const nextDx = target.x - nextX;
        const nextDy = target.y - nextY;
        const nextDistSq = nextDx * nextDx + nextDy * nextDy;
        
        if (distSq < TANK_RADIUS_SQ || nextDistSq < TANK_RADIUS_SQ) {
          // Hit detected
          const shooter = game.players[bullet.owner];
          let damage = BULLET_DAMAGE;
          
          if (shooter && shooter.damageBoost) {
            damage = Math.floor(damage * POWER_UP_TYPES.DAMAGE_BOOST.multiplier);
          }
          if (target.shield) {
            damage = 0;
          }
          
          target.hp = Math.max(0, target.hp - damage);
          if (target.hp <= 0) {
            target.dead = true;
            target.respawnTime = Date.now() + RESPAWN_TIME;
            if (game.scores && game.scores[bullet.owner] !== undefined) {
              game.scores[bullet.owner]++;
            }
          }
          
          // Send hit event
          io.to(gameId).emit("bulletHit", {
            shooter: bullet.owner,
            victim: id,
            hitX: bullet.x,
            hitY: bullet.y
          });
          
          hit = true;
          game.bullets.splice(i, 1);
          break;
        }
      }
      
      if (hit) continue;
      
      // Move bullet if no hit
      bullet.x += bullet.vx;
      bullet.y += bullet.vy;
      
      // Wall bouncing with max 3 bounces
      const MAX_BOUNCES = 3;
      let bounced = false;
      
      if (bullet.x < 0 || bullet.x > MAP_WIDTH) {
        if (bullet.bounces < MAX_BOUNCES) {
          bullet.vx = -bullet.vx;
          bullet.x = Math.max(0, Math.min(MAP_WIDTH, bullet.x));
          bullet.bounces++;
          bounced = true;
          
          // Emit wall impact event for glow effect
          io.to(gameId).emit("wallImpact", {
            x: bullet.x,
            y: bullet.y,
            color: bullet.color || '#ffff00'
          });
        } else {
          game.bullets.splice(i, 1);
          continue;
        }
      }
      
      if (bullet.y < 0 || bullet.y > MAP_HEIGHT) {
        if (bullet.bounces < MAX_BOUNCES) {
          bullet.vy = -bullet.vy;
          bullet.y = Math.max(0, Math.min(MAP_HEIGHT, bullet.y));
          bullet.bounces++;
          bounced = true;
          
          // Emit wall impact event for glow effect
          io.to(gameId).emit("wallImpact", {
            x: bullet.x,
            y: bullet.y,
            color: bullet.color || '#ffff00'
          });
        } else {
          game.bullets.splice(i, 1);
          continue;
        }
      }
      
      // Update angle after bounce
      if (bounced) {
        bullet.angle = Math.atan2(bullet.vy, bullet.vx);
      }
      
      // Remove if too old
      const isNotTooOld = !bullet.createdAt || (now - bullet.createdAt < bulletMaxAge);
      if (!isNotTooOld) {
        game.bullets.splice(i, 1);
      }
    }

    // Process inputs - process ALL inputs each tick for smooth movement
    for (const id in game.players) {
      const player = game.players[id];
      if (!player) continue;

      while (player.inputQueue.length > 0) {
        const input = player.inputQueue.shift();
        if (input) {
          applyInput(player, input);
        }
      }
    }

    // Apply power-ups + respawn & power-up collection
    for (const id in game.players) {
      const player = game.players[id];
      if (!player) continue;

      // Respawn players
      if (
        player.dead &&
        player.respawnTime &&
        Date.now() > player.respawnTime
      ) {
        const spawn = getRandomSpawn();
        player.x = spawn.x;
        player.y = spawn.y;
        player.vx = 0; // Reset velocity on respawn
        player.vy = 0;
        player.hp = MAX_HP;
        player.dead = false;
        player.lastShotTime = 0;
        player.invulnerable = true;
        player.invulnerableExpireTime = Date.now() + 3000;
      }
    }

    // Power-up collection and cleanup
    if (game.powerUps && game.powerUps.length) {
      game.powerUps = game.powerUps.filter((powerUp) => {
        // lifetime
        if (Date.now() - powerUp.createdAt > POWER_UP_LIFETIME) return false;

        // Check collision with players
        for (const playerId in game.players) {
          const player = game.players[playerId];
          if (!player || player.dead) continue;

          const dx = player.x - powerUp.x;
          const dy = player.y - powerUp.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < POWER_UP_RADIUS) {
            applyPowerUp(gameId, playerId, powerUp.type);
            return false; // Remove power-up after collection
          }
        }

        return true; // Keep power-up
      });
    }

    // Update power-up effects duration (expire flags)
    for (const playerId in game.players) {
      const player = game.players[playerId];
      if (!player) continue;

      if (
        player.speedBoost &&
        player.speedBoostExpireTime &&
        Date.now() > player.speedBoostExpireTime
      ) {
        player.speedBoost = false;
        delete player.speedBoostExpireTime;
      }
      if (
        player.rapidFire &&
        player.rapidFireExpireTime &&
        Date.now() > player.rapidFireExpireTime
      ) {
        player.rapidFire = false;
        delete player.rapidFireExpireTime;
      }
      if (
        player.shield &&
        player.shieldExpireTime &&
        Date.now() > player.shieldExpireTime
      ) {
        player.shield = false;
        delete player.shieldExpireTime;
      }
      if (
        player.damageBoost &&
        player.damageBoostExpireTime &&
        Date.now() > player.damageBoostExpireTime
      ) {
        player.damageBoost = false;
        delete player.damageBoostExpireTime;
      }

      if (
        player.invulnerable &&
        player.invulnerableExpireTime &&
        Date.now() > player.invulnerableExpireTime
      ) {
        player.invulnerable = false;
        delete player.invulnerableExpireTime;
      }
    }

    // Broadcast state to all clients in this game
    const state = {
      players: Object.keys(game.players)
        .map((id) => {
          const player = game.players[id];
          return player
            ? {
                id,
                x: player.x,
                y: player.y,
                rotation: player.rotation,
                turretRotation: player.turretRotation,
                color: player.color,
                name: player.name,
                hp: player.hp,
                dead: player.dead,
                vx: player.vx || 0,
                vy: player.vy || 0,
                speedBoost: !!player.speedBoost,
                rapidFire: !!player.rapidFire,
                shield: !!player.shield,
                damageBoost: !!player.damageBoost,
                invulnerable: !!player.invulnerable,
                lastProcessedInput: player.lastProcessedInput,
              }
            : null;
        })
        .filter(Boolean),
      bullets: game.bullets
        ? game.bullets.map((b) => ({ x: b.x, y: b.y, angle: b.angle, color: b.color }))
        : [],
      scores: game.scores || {},
      powerUps: game.powerUps || [],
    };

    io.to(gameId).emit("state", state);
  }
}, TICK_INTERVAL);

// HTTP endpoints
app.get("/servers", (req, res) => {
  const activeServers = [];
  for (const gameId in games) {
    const game = games[gameId];
    if (!game) continue;
    const playerCount = game.players ? Object.keys(game.players).length : 0;
    if (playerCount > 0) {
      activeServers.push({
        id: String(game.id || gameId),
        name: String(game.name || `Game ${gameId}`),
        players: playerCount,
        maxPlayers: MAX_PLAYERS,
      });
    }
  }
  res.json(activeServers);
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
