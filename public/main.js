const canvas = document.getElementById("game-canvas");
const ctx = canvas.getContext("2d");
const socket = io({ autoConnect: false });

let playerId = null;
let gameId = null;
let players = {};
let bullets = [];
let scores = {};
let gameStarted = false;
let servers = [];
let isConnecting = false;
let myPlayerName = "";
let playerNames = {};
let destroyedPlayers = new Set(); // Track destroyed players to prevent duplicates

// Power-ups system
let powerUps = [];
const POWER_UP_TYPES = {
  SPEED: {
    name: "speed",
    color: "#3498db",
    icon: "⚡",
    duration: 5000,
    spawnChance: 0.05,
  },
  RAPID_FIRE: {
    name: "rapidFire",
    color: "#e74c3c",
    icon: "🔥",
    duration: 5000,
    spawnChance: 0.05,
  },
  SHIELD: {
    name: "shield",
    color: "#9b59b6",
    icon: "🛡️",
    duration: 5000,
    spawnChance: 0.05,
  },
  DAMAGE_BOOST: {
    name: "damageBoost",
    color: "#f39c12",
    icon: "💪",
    duration: 10000,
    spawnChance: 0.05,
  },
  HEALTH_PACK: {
    name: "healthPack",
    color: "#27ae60",
    icon: "❤️",
    duration: 0,
    spawnChance: 0.05,
  },
};

// Input state
let keys = { w: false, s: false, a: false, d: false };
let mousePos = { x: 0, y: 0 };
let mouseDown = false;
let lastShootTime = 0;
let inputQueue = [];
let sequenceNumber = 0;
let predictionHistory = [];
let inputInterval = null;

// Client-side bullet simulation for smooth 60 FPS rendering
let clientBullets = []; // Bullets simulated on client every frame
let bulletTrails = []; // Trail particles for bullets
let explosionParticles = []; // Explosion effects
let floatingParticles = []; // Ambient floating particles

// Client-side prediction with velocity
let predictedPlayer = { x: 0, y: 0, vx: 0, vy: 0, rotation: 0, turretRotation: 0 };
let lastServerState = null;

// Interpolation for other players
let otherPlayersInterpolated = {}; // Stores interpolation data for smooth rendering

// Constants - Must match server values for accurate prediction
const TANK_SPEED = 60; // pixels per second - matches server
const TANK_ACCELERATION = 600; // pixels per second squared
const TANK_DECELERATION = 900; // pixels per second squared
const TANK_MAX_SPEED = 60; // maximum speed
const BULLET_SPEED = 300; // matches server
const MAX_CHAT_MESSAGES = 60;
const SHOOT_COOLDOWN = 1500; // matches server
const INTERPOLATION_DELAY = 100; // ms - smooth other players' movement

// Particle System
class Particle {
  constructor(x, y, vx, vy, color, size, lifetime) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.color = color;
    this.size = size;
    this.lifetime = lifetime;
    this.age = 0;
    this.gravity = 0.1;
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vy += this.gravity * dt;
    this.age += dt;
    return this.age < this.lifetime;
  }

  draw(ctx) {
    const alpha = 1 - this.age / this.lifetime;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(
      this.x,
      this.y,
      this.size * (1 - (this.age / this.lifetime) * 0.5),
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.restore();
  }
}

class ParticleSystem {
  constructor() {
    this.particles = [];
    this.screenFlashAlpha = 0;
    this.screenFlashDecay = 0;
  }

  createExplosion(x, y, color = "#ff6b35") {
    const particleCount = 20;
    for (let i = 0; i < particleCount; i++) {
      const angle = (Math.PI * 2 * i) / particleCount;
      const speed = 100 + Math.random() * 100;
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed;
      const size = 3 + Math.random() * 4;
      const lifetime = 0.5 + Math.random() * 0.5;

      this.particles.push(new Particle(x, y, vx, vy, color, size, lifetime));
    }

    // Add smoke particles
    for (let i = 0; i < 10; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 30 + Math.random() * 50;
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed;
      const size = 5 + Math.random() * 8;
      const lifetime = 1 + Math.random() * 1;

      this.particles.push(new Particle(x, y, vx, vy, "#555", size, lifetime));
    }
  }

  createMuzzleFlash(x, y, angle) {
    const flashX = x + Math.cos(angle) * 25;
    const flashY = y + Math.sin(angle) * 25;

    for (let i = 0; i < 5; i++) {
      const spreadAngle = angle + (Math.random() - 0.5) * 0.5;
      const speed = 200 + Math.random() * 100;
      const vx = Math.cos(spreadAngle) * speed;
      const vy = Math.sin(spreadAngle) * speed;
      const size = 2 + Math.random() * 3;
      const lifetime = 0.1 + Math.random() * 0.1;

      this.particles.push(
        new Particle(flashX, flashY, vx, vy, "#ffeb3b", size, lifetime),
      );
    }
  }

  createTankTrail(x, y) {
    const vx = (Math.random() - 0.5) * 20;
    const vy = Math.random() * 30;
    const size = 2 + Math.random() * 2;
    const lifetime = 0.5 + Math.random() * 0.3;

    // Use different trail color based on map type
    const trailColor = currentMapType === "desert" ? "#c19a6b" : "#8b7355";
    this.particles.push(new Particle(x, y, vx, vy, trailColor, size, lifetime));
  }

  createTankExplosion(x, y) {
    // Smaller explosion without white flash
    for (let i = 0; i < 15; i++) {
      const angle = (Math.PI * 2 * i) / 15;
      const speed = 80 + Math.random() * 120;
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed;
      const size = 4 + Math.random() * 6;
      const lifetime = 0.6 + Math.random() * 0.4;

      this.particles.push(
        new Particle(x, y, vx, vy, "#ff6b35", size, lifetime),
      );
    }

    // Orange/red explosion particles
    for (let i = 0; i < 20; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 80;
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed;
      const size = 3 + Math.random() * 5;
      const lifetime = 0.7 + Math.random() * 0.5;

      this.particles.push(
        new Particle(x, y, vx, vy, "#ff8c42", size, lifetime),
      );
    }

    // Smoke particles
    for (let i = 0; i < 12; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 30 + Math.random() * 60;
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed;
      const size = 6 + Math.random() * 8;
      const lifetime = 1.2 + Math.random() * 0.8;

      this.particles.push(
        new Particle(x, y, vx, vy, "#666666", size, lifetime),
      );
    }

    // No screen flash - removed
  }

  createScreenFlash() {
    // Disabled - no screen flash
    this.screenFlashAlpha = 0;
    this.screenFlashDecay = 0;
  }

  update(dt) {
    // Performance optimization: Cap particles at 500 to prevent crashes
    const MAX_PARTICLES = 500;
    if (this.particles.length > MAX_PARTICLES) {
      this.particles = this.particles.slice(-MAX_PARTICLES);
    }
    
    for (let i = this.particles.length - 1; i >= 0; i--) {
      this.particles[i].update(dt);
      if (this.particles[i].age >= this.particles[i].lifetime) {
        this.particles.splice(i, 1);
      }
    }

    // Update screen flash (disabled)
    if (this.screenFlashAlpha > 0) {
      this.screenFlashAlpha -= this.screenFlashDecay * dt;
      if (this.screenFlashAlpha < 0) {
        this.screenFlashAlpha = 0;
      }
    }
  }

  draw(ctx) {
    try {
      // Draw screen flash first (disabled)
      if (this.screenFlashAlpha > 0) {
        ctx.save();
        ctx.globalAlpha = this.screenFlashAlpha;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.restore();
      }

      // Draw all particles with error handling
      this.particles.forEach((particle) => {
        try {
          if (particle && particle.draw) {
            particle.draw(ctx);
          }
        } catch (err) {
          // Silently skip corrupted particles
        }
      });
    } catch (err) {
      console.warn('Particle system draw error:', err);
    }
  }
}

const particleSystem = new ParticleSystem();

/**
 * Draw a detailed, realistic-looking tank
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {number} turretAngle - Turret rotation angle
 * @param {string} color - Tank color
 * @param {boolean} isLocal - Is this the local player's tank
 * @param {Object} effects - Power-up effects {shield, speedBoost, damageBoost}
 */
function drawDetailedTank(ctx, x, y, turretAngle, color, isLocal, effects = {}) {
  ctx.save();
  ctx.translate(x, y);
  
  // Use the player's assigned color
  const neonColor = color || (isLocal ? '#00ffff' : '#ff00ff');
  
  // Convert hex color to RGB for glow effect
  const hexToRgb = (hex) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 0, g: 255, b: 255 };
  };
  
  const rgb = hexToRgb(neonColor);
  const neonGlow = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.8)`;
  
  // Outer glow
  ctx.shadowColor = neonGlow;
  ctx.shadowBlur = 20;
  
  // Shadow (darker for neon theme)
  ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.2)`;
  ctx.fillRect(-22, 18, 44, 6);
  
  // Tank tracks (left) - neon style
  ctx.fillStyle = '#0a0a20';
  ctx.strokeStyle = neonColor;
  ctx.lineWidth = 2;
  ctx.fillRect(-24, -16, 6, 32);
  ctx.strokeRect(-24, -16, 6, 32);
  
  // Track details (left) - glowing segments
  ctx.fillStyle = neonColor;
  for (let i = -14; i < 16; i += 4) {
    ctx.fillRect(-23, i, 4, 2);
  }
  
  // Tank tracks (right) - neon style
  ctx.fillStyle = '#0a0a20';
  ctx.strokeStyle = neonColor;
  ctx.fillRect(18, -16, 6, 32);
  ctx.strokeRect(18, -16, 6, 32);
  
  // Track details (right) - glowing segments
  ctx.fillStyle = neonColor;
  for (let i = -14; i < 16; i += 4) {
    ctx.fillRect(19, i, 4, 2);
  }
  
  // Main body (lower hull) - dark with neon edges
  ctx.fillStyle = '#0f0a25';
  ctx.fillRect(-20, -12, 40, 24);
  
  // Neon body outline with glow
  ctx.strokeStyle = neonColor;
  ctx.lineWidth = 3;
  ctx.shadowColor = neonGlow;
  ctx.shadowBlur = 15;
  ctx.strokeRect(-20, -12, 40, 24);
  
  // Upper hull/turret base - glowing panels
  ctx.fillStyle = 'rgba(20, 10, 40, 0.8)';
  ctx.fillRect(-16, -8, 32, 16);
  ctx.strokeStyle = neonColor;
  ctx.lineWidth = 2;
  ctx.strokeRect(-16, -8, 32, 16);
  
  // Hull details - neon accent panels
  ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.3)`;
  ctx.fillRect(-14, -6, 4, 12); // Left panel
  ctx.fillRect(10, -6, 4, 12);  // Right panel
  
  // Panel glow lines
  ctx.strokeStyle = neonColor;
  ctx.lineWidth = 1;
  ctx.strokeRect(-14, -6, 4, 12);
  ctx.strokeRect(10, -6, 4, 12);
  
  // Engine grill - glowing vents
  ctx.strokeStyle = neonColor;
  ctx.lineWidth = 1.5;
  ctx.shadowColor = neonGlow;
  ctx.shadowBlur = 10;
  for (let i = -12; i < -4; i += 3) {
    ctx.beginPath();
    ctx.moveTo(i, 6);
    ctx.lineTo(i, 10);
    ctx.stroke();
  }
  
  // Turret (before rotation)
  ctx.save();
  ctx.rotate(turretAngle);
  
  // Turret shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 13, 11, 0, 0, Math.PI * 2);
  ctx.fill();
  
  // Turret body - dark with neon outline
  ctx.fillStyle = '#15102e';
  ctx.beginPath();
  ctx.ellipse(0, 0, 12, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  
  // Turret outline - glowing
  ctx.strokeStyle = neonColor;
  ctx.lineWidth = 2.5;
  ctx.shadowColor = neonGlow;
  ctx.shadowBlur = 15;
  ctx.stroke();
  
  // Turret center glow
  const centerGlow = ctx.createRadialGradient(0, 0, 0, 0, 0, 6);
  centerGlow.addColorStop(0, neonGlow);
  centerGlow.addColorStop(1, 'transparent');
  ctx.fillStyle = centerGlow;
  ctx.fill();
  
  // Gun barrel shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  ctx.fillRect(12, -3, 18, 6);
  
  // Gun barrel - glowing energy weapon
  ctx.fillStyle = '#0a0515';
  ctx.fillRect(10, -3, 20, 6);
  
  // Barrel neon outline
  ctx.strokeStyle = neonColor;
  ctx.lineWidth = 2;
  ctx.strokeRect(10, -3, 20, 6);
  
  // Energy core inside barrel
  const energyGrad = ctx.createLinearGradient(10, 0, 30, 0);
  energyGrad.addColorStop(0, 'transparent');
  energyGrad.addColorStop(0.7, neonGlow);
  energyGrad.addColorStop(1, neonColor);
  ctx.fillStyle = energyGrad;
  ctx.fillRect(10, -2, 20, 4);
  
  // Remove old barrel outline
  
  // Muzzle tip - glowing bright
  ctx.fillStyle = neonColor;
  ctx.shadowColor = neonGlow;
  ctx.shadowBlur = 25;
  ctx.fillRect(28, -2, 3, 4);
  
  // Muzzle glow - extra bright
  const muzzleGlow = ctx.createRadialGradient(30, 0, 0, 30, 0, 8);
  muzzleGlow.addColorStop(0, neonColor);
  muzzleGlow.addColorStop(0.5, neonGlow);
  muzzleGlow.addColorStop(1, 'transparent');
  ctx.fillStyle = muzzleGlow;
  ctx.fillRect(28, -6, 8, 12);
  
  // Gun barrel details - neon segments
  ctx.strokeStyle = neonColor;
  ctx.lineWidth = 1.5;
  ctx.shadowColor = neonGlow;
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.moveTo(15, -2.5);
  ctx.lineTo(15, 2.5);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(20, -2.5);
  ctx.lineTo(20, 2.5);
  ctx.stroke();
  
  // Turret hatch - neon dot
  ctx.fillStyle = neonColor;
  ctx.shadowColor = neonGlow;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(-3, -2, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = neonColor;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  
  ctx.restore(); // End turret rotation
  
  ctx.restore(); // End tank transform
}

/**
 * Shade a color by a percentage
 * @param {string} color - Hex color
 * @param {number} percent - Percentage to shade (-100 to 100)
 */
function shadeColor(color, percent) {
  let R = parseInt(color.substring(1, 3), 16);
  let G = parseInt(color.substring(3, 5), 16);
  let B = parseInt(color.substring(5, 7), 16);
  
  R = Math.round(R * (100 + percent) / 100);
  G = Math.round(G * (100 + percent) / 100);
  B = Math.round(B * (100 + percent) / 100);
  
  R = (R < 255) ? R : 255;
  G = (G < 255) ? G : 255;
  B = (B < 255) ? B : 255;
  
  R = (R > 0) ? R : 0;
  G = (G > 0) ? G : 0;
  B = (B > 0) ? B : 0;
  
  const RR = ((R.toString(16).length === 1) ? "0" + R.toString(16) : R.toString(16));
  const GG = ((G.toString(16).length === 1) ? "0" + G.toString(16) : G.toString(16));
  const BB = ((B.toString(16).length === 1) ? "0" + B.toString(16) : B.toString(16));
  
  return "#" + RR + GG + BB;
}

// Audio System with Procedural Sound Generation
class AudioManager {
  constructor() {
    this.sounds = {};
    this.audioContext = null;
    this.masterVolume = 0.5;
    this.sfxVolume = 0.7;
    this.musicVolume = 0.3;
    this.muted = false;
    this.musicPlaying = null;
    this.menuMusicPlaying = false;
    this.menuMusicNodes = null;
    this.menuMusicAudio = null; // HTML5 Audio for MP3

    this.initAudioContext();
    this.loadSettings();
    this.createProceduralSounds();
    this.loadMenuMusic();
  }

  initAudioContext() {
    try {
      this.audioContext = new (window.AudioContext ||
        window.webkitAudioContext)();
    } catch (e) {
      console.error("Web Audio API not supported:", e);
    }
  }

  loadSettings() {
    const saved = localStorage.getItem("audioSettings");
    if (saved) {
      const settings = JSON.parse(saved);
      this.masterVolume = settings.masterVolume || 0.5;
      this.sfxVolume = settings.sfxVolume || 0.7;
      this.musicVolume = settings.musicVolume || 0.3;
      this.muted = settings.muted || false;
    }
  }

  /**
   * Create procedural sounds using Web Audio API
   */
  createProceduralSounds() {
    // Sounds will be generated on-the-fly when played
    this.soundGenerators = {
      uiClick: () => this.generateUIClick(),
      uiHover: () => this.generateUIHover(),
      buttonPress: () => this.generateButtonPress(),
      menuOpen: () => this.generateMenuOpen(),
      menuClose: () => this.generateMenuClose(),
      shoot: () => this.generateShoot(),
      explosion: () => this.generateExplosion(),
      hit: () => this.generateHit(),
      powerup: () => this.generatePowerUp(),
      death: () => this.generateDeath(),
      respawn: () => this.generateRespawn(),
      wallBounce: () => this.generateWallBounce()
    };
  }

  /**
   * Generate UI click sound (short, satisfying beep)
   */
  generateUIClick() {
    if (!this.audioContext || this.muted) return;
    
    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    
    osc.connect(gain);
    gain.connect(this.audioContext.destination);
    
    osc.frequency.setValueAtTime(800, this.audioContext.currentTime);
    osc.frequency.exponentialRampToValueAtTime(600, this.audioContext.currentTime + 0.05);
    
    gain.gain.setValueAtTime(this.masterVolume * this.sfxVolume * 0.3, this.audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.05);
    
    osc.start(this.audioContext.currentTime);
    osc.stop(this.audioContext.currentTime + 0.05);
  }

  /**
   * Generate UI hover sound (very subtle, high pitch)
   */
  generateUIHover() {
    if (!this.audioContext || this.muted) return;
    
    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    
    osc.connect(gain);
    gain.connect(this.audioContext.destination);
    
    osc.frequency.setValueAtTime(1200, this.audioContext.currentTime);
    osc.type = 'sine';
    
    gain.gain.setValueAtTime(this.masterVolume * this.sfxVolume * 0.1, this.audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.03);
    
    osc.start(this.audioContext.currentTime);
    osc.stop(this.audioContext.currentTime + 0.03);
  }

  /**
   * Generate button press sound (deeper, more satisfying)
   */
  generateButtonPress() {
    if (!this.audioContext || this.muted) return;
    
    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    
    osc.connect(gain);
    gain.connect(this.audioContext.destination);
    
    osc.frequency.setValueAtTime(400, this.audioContext.currentTime);
    osc.frequency.exponentialRampToValueAtTime(200, this.audioContext.currentTime + 0.1);
    osc.type = 'triangle';
    
    gain.gain.setValueAtTime(this.masterVolume * this.sfxVolume * 0.4, this.audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.1);
    
    osc.start(this.audioContext.currentTime);
    osc.stop(this.audioContext.currentTime + 0.1);
  }

  /**
   * Generate menu open sound (rising tone)
   */
  generateMenuOpen() {
    if (!this.audioContext || this.muted) return;
    
    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    
    osc.connect(gain);
    gain.connect(this.audioContext.destination);
    
    osc.frequency.setValueAtTime(300, this.audioContext.currentTime);
    osc.frequency.exponentialRampToValueAtTime(600, this.audioContext.currentTime + 0.15);
    osc.type = 'sine';
    
    gain.gain.setValueAtTime(this.masterVolume * this.sfxVolume * 0.3, this.audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.15);
    
    osc.start(this.audioContext.currentTime);
    osc.stop(this.audioContext.currentTime + 0.15);
  }

  /**
   * Generate menu close sound (falling tone)
   */
  generateMenuClose() {
    if (!this.audioContext || this.muted) return;
    
    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    
    osc.connect(gain);
    gain.connect(this.audioContext.destination);
    
    osc.frequency.setValueAtTime(600, this.audioContext.currentTime);
    osc.frequency.exponentialRampToValueAtTime(300, this.audioContext.currentTime + 0.12);
    osc.type = 'sine';
    
    gain.gain.setValueAtTime(this.masterVolume * this.sfxVolume * 0.3, this.audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.12);
    
    osc.start(this.audioContext.currentTime);
    osc.stop(this.audioContext.currentTime + 0.12);
  }

  /**
   * Generate neon laser beam shoot sound
   */
  generateShoot() {
    if (!this.audioContext || this.muted) return;
    
    // Create two oscillators for a richer laser sound
    const osc1 = this.audioContext.createOscillator();
    const osc2 = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    const filter = this.audioContext.createBiquadFilter();
    
    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(this.audioContext.destination);
    
    // High-pitched neon laser sound
    osc1.frequency.setValueAtTime(1200, this.audioContext.currentTime);
    osc1.frequency.exponentialRampToValueAtTime(800, this.audioContext.currentTime + 0.12);
    osc1.type = 'sine';
    
    osc2.frequency.setValueAtTime(1600, this.audioContext.currentTime);
    osc2.frequency.exponentialRampToValueAtTime(1000, this.audioContext.currentTime + 0.12);
    osc2.type = 'sine';
    
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1400, this.audioContext.currentTime);
    filter.Q.setValueAtTime(5, this.audioContext.currentTime);
    
    gain.gain.setValueAtTime(this.masterVolume * this.sfxVolume * 0.4, this.audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.12);
    
    osc1.start(this.audioContext.currentTime);
    osc1.stop(this.audioContext.currentTime + 0.12);
    osc2.start(this.audioContext.currentTime);
    osc2.stop(this.audioContext.currentTime + 0.12);
  }

  /**
   * Generate explosion sound (complex noise)
   */
  generateExplosion() {
    if (!this.audioContext || this.muted) return;
    
    // Create noise buffer
    const bufferSize = this.audioContext.sampleRate * 0.3;
    const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    
    const noise = this.audioContext.createBufferSource();
    const filter = this.audioContext.createBiquadFilter();
    const gain = this.audioContext.createGain();
    
    noise.buffer = buffer;
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.audioContext.destination);
    
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1000, this.audioContext.currentTime);
    filter.frequency.exponentialRampToValueAtTime(100, this.audioContext.currentTime + 0.3);
    
    gain.gain.setValueAtTime(this.masterVolume * this.sfxVolume * 0.6, this.audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.3);
    
    noise.start(this.audioContext.currentTime);
    noise.stop(this.audioContext.currentTime + 0.3);
  }

  /**
   * Generate hit sound (neon electric zap)
   */
  generateHit() {
    if (!this.audioContext || this.muted) return;
    
    // Create multiple oscillators for electric zap effect
    const osc1 = this.audioContext.createOscillator();
    const osc2 = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    const filter = this.audioContext.createBiquadFilter();
    
    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(this.audioContext.destination);
    
    // Electric zap frequencies
    osc1.frequency.setValueAtTime(900, this.audioContext.currentTime);
    osc1.frequency.exponentialRampToValueAtTime(200, this.audioContext.currentTime + 0.08);
    osc1.type = 'square';
    
    osc2.frequency.setValueAtTime(1200, this.audioContext.currentTime);
    osc2.frequency.exponentialRampToValueAtTime(300, this.audioContext.currentTime + 0.08);
    osc2.type = 'sawtooth';
    
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(800, this.audioContext.currentTime);
    filter.Q.setValueAtTime(3, this.audioContext.currentTime);
    
    gain.gain.setValueAtTime(this.masterVolume * this.sfxVolume * 0.35, this.audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.08);
    
    osc1.start(this.audioContext.currentTime);
    osc1.stop(this.audioContext.currentTime + 0.08);
    osc2.start(this.audioContext.currentTime);
    osc2.stop(this.audioContext.currentTime + 0.08);
  }

  /**
   * Generate power-up pickup sound (ascending arpeggio)
   */
  generatePowerUp() {
    if (!this.audioContext || this.muted) return;
    
    const notes = [523.25, 659.25, 783.99]; // C, E, G
    
    notes.forEach((freq, i) => {
      const osc = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();
      
      osc.connect(gain);
      gain.connect(this.audioContext.destination);
      
      const startTime = this.audioContext.currentTime + (i * 0.05);
      osc.frequency.setValueAtTime(freq, startTime);
      osc.type = 'sine';
      
      gain.gain.setValueAtTime(this.masterVolume * this.sfxVolume * 0.3, startTime);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.15);
      
      osc.start(startTime);
      osc.stop(startTime + 0.15);
    });
  }

  /**
   * Generate death sound (descending tone)
   */
  generateDeath() {
    if (!this.audioContext || this.muted) return;
    
    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    
    osc.connect(gain);
    gain.connect(this.audioContext.destination);
    
    osc.frequency.setValueAtTime(400, this.audioContext.currentTime);
    osc.frequency.exponentialRampToValueAtTime(50, this.audioContext.currentTime + 0.5);
    osc.type = 'sawtooth';
    
    gain.gain.setValueAtTime(this.masterVolume * this.sfxVolume * 0.5, this.audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.5);
    
    osc.start(this.audioContext.currentTime);
    osc.stop(this.audioContext.currentTime + 0.5);
  }

  /**
   * Generate respawn sound (rising arpeggio)
   */
  generateRespawn() {
    if (!this.audioContext || this.muted) return;
    
    const notes = [261.63, 329.63, 392.00, 523.25]; // C, E, G, C
    
    notes.forEach((freq, i) => {
      const osc = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();
      
      osc.connect(gain);
      gain.connect(this.audioContext.destination);
      
      const startTime = this.audioContext.currentTime + (i * 0.06);
      osc.frequency.setValueAtTime(freq, startTime);
      osc.type = 'triangle';
      
      gain.gain.setValueAtTime(this.masterVolume * this.sfxVolume * 0.25, startTime);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.2);
      
      osc.start(startTime);
      osc.stop(startTime + 0.2);
    });
  }

  /**
   * Generate wall bounce sound (neon ping)
   */
  generateWallBounce() {
    if (!this.audioContext || this.muted) return;
    
    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    
    osc.connect(gain);
    gain.connect(this.audioContext.destination);
    
    // Sharp, high-pitched ping for neon laser bounce
    osc.frequency.setValueAtTime(1800, this.audioContext.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1400, this.audioContext.currentTime + 0.06);
    osc.type = 'sine';
    
    gain.gain.setValueAtTime(this.masterVolume * this.sfxVolume * 0.25, this.audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.06);
    
    osc.start(this.audioContext.currentTime);
    osc.stop(this.audioContext.currentTime + 0.06);
  }

  /**
   * Play a procedural sound by name
   */
  playProceduralSound(soundName) {
    if (!this.audioContext || this.muted) return;
    
    // Resume audio context if needed
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(err => {
        console.warn('Could not resume audio context:', err);
      });
    }
    
    if (this.soundGenerators && this.soundGenerators[soundName]) {
      try {
        this.soundGenerators[soundName]();
      } catch (err) {
        console.warn('Error playing sound:', soundName, err);
      }
    }
  }

  /**
   * Load menu music MP3 file
   */
  loadMenuMusic() {
    try {
      this.menuMusicAudio = new Audio('sounds/music/background.mp3');
      this.menuMusicAudio.loop = true;
      this.menuMusicAudio.volume = this.masterVolume * this.musicVolume;
      
      // Preload the audio
      this.menuMusicAudio.load();
    } catch (err) {
      console.warn('Could not load menu music:', err);
    }
  }

  /**
   * Start ambient menu music (MP3 file)
   */
  startMenuMusic() {
    // Background music disabled
  }

  /**
   * Stop menu music
   */
  stopMenuMusic() {
    // Background music disabled
  }

  saveSettings() {
    const settings = {
      masterVolume: this.masterVolume,
      sfxVolume: this.sfxVolume,
      musicVolume: this.musicVolume,
      muted: this.muted,
    };
    localStorage.setItem("audioSettings", JSON.stringify(settings));
  }

  async loadSound(name, path) {
    if (!this.audioContext) return;

    try {
      const response = await fetch(path);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      this.sounds[name] = audioBuffer;
      console.log(`Loaded sound: ${name}`);
    } catch (e) {
      console.error(`Failed to load sound ${name}:`, e);
    }
  }

  playSound(name, volume = 1.0, loop = false) {
    if (!this.audioContext || !this.sounds[name] || this.muted) return;

    const source = this.audioContext.createBufferSource();
    const gainNode = this.audioContext.createGain();

    source.buffer = this.sounds[name];
    source.loop = loop;

    source.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    const finalVolume = volume * this.masterVolume * this.sfxVolume;
    gainNode.gain.value = finalVolume;

    source.start(0);

    return source;
  }

  playMusic(name, loop = true) {
    if (!this.audioContext || !this.sounds[name] || this.muted) return;

    this.stopMusic();

    const source = this.audioContext.createBufferSource();
    const gainNode = this.audioContext.createGain();

    source.buffer = this.sounds[name];
    source.loop = loop;

    source.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    gainNode.gain.value = this.masterVolume * this.musicVolume;

    source.start(0);
    this.musicPlaying = { source, gainNode };
  }

  stopMusic() {
    if (this.musicPlaying) {
      this.musicPlaying.source.stop();
      this.musicPlaying = null;
    }
  }

  updateVolumes() {
    // Update menu music volume
    if (this.menuMusicAudio) {
      this.menuMusicAudio.volume = this.masterVolume * this.musicVolume;
    }
    
    // Update game music volume if playing
    if (this.musicPlaying) {
      this.musicPlaying.gainNode.gain.value =
        this.masterVolume * this.musicVolume;
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.muted) {
      this.stopMusic();
      this.stopMenuMusic();
    }
    this.saveSettings();
    return this.muted;
  }
}

const audioManager = new AudioManager();

// UI Elements
const startScreen = document.getElementById("start-screen");
const gameContainer = document.getElementById("game-container");
const audioSettings = document.getElementById("audio-settings");
const hostBtn = document.getElementById("host-btn");
const hostSection = document.getElementById("host-section");
const joinBtn = document.getElementById("join-btn");
const audioSettingsBtn = document.getElementById("audio-settings-btn");
const serverList = document.getElementById("server-list");
const serversDiv = document.getElementById("servers");
const backBtn = document.getElementById("back-btn");
const audioToggle = document.getElementById("audio-toggle");
const serverNameInput = document.getElementById("server-name");
const playerNameInput = document.getElementById("player-name");
const nameError = document.getElementById("name-error");
const refreshBtn = document.getElementById("refresh-btn");
const serverBackBtn = document.getElementById("server-back-btn");
const closeServerListBtn = document.getElementById("close-server-list");
const serverCount = document.getElementById("server-count");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const chatMessagesDiv = document.getElementById("chat-messages");
const chatSubmitButton = chatForm ? chatForm.querySelector("button") : null;

// New neon UI elements
const ingameMenuBtn = document.getElementById("ingame-menu-btn");
const volumeDownBtn = document.getElementById("volume-down");
const volumeUpBtn = document.getElementById("volume-up");
const volumeDisplay = document.getElementById("volume-display");

// Leaderboard elements
const leaderboardContent = document.getElementById("leaderboard-content");
const leaderboardHeader = document.getElementById("leaderboard-header");
const hostBtnDefaultText = hostBtn ? hostBtn.textContent.trim() : "Host Game";
const HOST_BUTTON_START_TEXT = "Start Game";

// Map selection elements
const mapSelection = document.getElementById("map-selection");
const mapOptions = document.querySelectorAll(".map-option");
let selectedMap = "green";
let currentMapType = "green";
const mapBackgroundCache = {};
let hostOptionsVisible = false;
let mapSelectionWasVisible = false;

function normalizeMapType(mapType) {
  return typeof mapType === "string" &&
    mapType.trim().toLowerCase() === "desert"
    ? "desert"
    : "green";
}

// Clean map rendering functions
function drawBackground() {
  const width = canvas.width;
  const height = canvas.height;
  if (!width || !height) return;

  const backgroundCanvas = getMapBackgroundCanvas(
    currentMapType,
    width,
    height,
  );
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(backgroundCanvas, 0, 0);
}

function getMapBackgroundCanvas(mapType, width, height) {
  const key = `${mapType}:${width}x${height}`;
  const cached = mapBackgroundCache[key];
  if (cached) {
    return cached;
  }

  const offscreen = document.createElement("canvas");
  offscreen.width = width;
  offscreen.height = height;
  const offCtx = offscreen.getContext("2d");

  // Only neon grid map now
  drawNeonGridMap(offCtx, width, height);

  mapBackgroundCache[key] = offscreen;
  return offscreen;
}

function invalidateMapBackground(mapType) {
  if (!mapType) {
    Object.keys(mapBackgroundCache).forEach(
      (key) => delete mapBackgroundCache[key],
    );
    return;
  }

  const prefix = `${mapType}:`;
  Object.keys(mapBackgroundCache).forEach((key) => {
    if (key.startsWith(prefix)) {
      delete mapBackgroundCache[key];
    }
  });
}

/**
 * Neon Cyberpunk Grid Map - Retro 80s synthwave aesthetic
 */
function drawNeonGridMap(targetCtx, width, height) {
  // Dark purple/black base
  const bgGradient = targetCtx.createRadialGradient(
    width / 2, height / 2, 0,
    width / 2, height / 2, width * 0.7
  );
  bgGradient.addColorStop(0, "#1a0a2e");
  bgGradient.addColorStop(0.5, "#0f051d");
  bgGradient.addColorStop(1, "#0a0515");
  targetCtx.fillStyle = bgGradient;
  targetCtx.fillRect(0, 0, width, height);

  // Neon grid lines
  const gridSize = 50;
  targetCtx.lineWidth = 2;

  // Vertical cyan lines with glow
  targetCtx.strokeStyle = "#00ffff";
  targetCtx.shadowColor = "#00ffff";
  targetCtx.shadowBlur = 15;
  for (let x = 0; x < width; x += gridSize) {
    targetCtx.globalAlpha = 0.3 + (Math.sin(x * 0.01) * 0.1);
    targetCtx.beginPath();
    targetCtx.moveTo(x, 0);
    targetCtx.lineTo(x, height);
    targetCtx.stroke();
  }

  // Horizontal magenta lines with glow
  targetCtx.strokeStyle = "#ff00ff";
  targetCtx.shadowColor = "#ff00ff";
  targetCtx.shadowBlur = 15;
  for (let y = 0; y < height; y += gridSize) {
    targetCtx.globalAlpha = 0.3 + (Math.sin(y * 0.01) * 0.1);
    targetCtx.beginPath();
    targetCtx.moveTo(0, y);
    targetCtx.lineTo(width, y);
    targetCtx.stroke();
  }

  // Reset shadows and alpha
  targetCtx.shadowBlur = 0;
  targetCtx.globalAlpha = 1;

  // Add glowing intersection points
  targetCtx.fillStyle = "#ff00ff";
  targetCtx.shadowColor = "#ff00ff";
  targetCtx.shadowBlur = 20;
  for (let x = 0; x < width; x += gridSize * 2) {
    for (let y = 0; y < height; y += gridSize * 2) {
      targetCtx.globalAlpha = 0.4;
      targetCtx.beginPath();
      targetCtx.arc(x, y, 3, 0, Math.PI * 2);
      targetCtx.fill();
    }
  }

  // Add some neon structures/buildings in background
  targetCtx.globalAlpha = 0.2;
  targetCtx.shadowBlur = 25;
  
  // Tall structures
  for (let i = 0; i < 8; i++) {
    const x = (i + 1) * (width / 9);
    const structHeight = 80 + Math.random() * 120;
    
    // Structure outline
    targetCtx.strokeStyle = i % 2 === 0 ? "#00ffff" : "#ff00ff";
    targetCtx.shadowColor = i % 2 === 0 ? "#00ffff" : "#ff00ff";
    targetCtx.lineWidth = 2;
    
    targetCtx.strokeRect(x - 15, height - structHeight, 30, structHeight);
    
    // Glowing top
    targetCtx.fillStyle = i % 2 === 0 ? "#00ffff" : "#ff00ff";
    targetCtx.fillRect(x - 15, height - structHeight, 30, 5);
  }

  // Reset
  targetCtx.shadowBlur = 0;
  targetCtx.globalAlpha = 1;
}

function updateMapOptionUI(activeMapType) {
  const normalized = normalizeMapType(activeMapType);
  mapOptions.forEach((opt) => {
    const optionType = normalizeMapType(opt.getAttribute("data-map"));
    const isActive = optionType === normalized;
    opt.classList.toggle("selected", isActive);
    const radio = opt.querySelector('input[type="radio"]');
    if (radio) {
      radio.checked = isActive;
    }
  });
}

function selectMap(mapType, { updateUI = true, invalidateCache = false } = {}) {
  const normalized = normalizeMapType(mapType || selectedMap);

  selectedMap = normalized;
  currentMapType = normalized;

  if (invalidateCache) {
    invalidateMapBackground(normalized);
  }

  if (updateUI) {
    updateMapOptionUI(normalized);
  }

  return normalized;
}

function showMapSelectionRow() {
  if (mapSelection) {
    mapSelection.classList.remove("hidden");
  }
}

function hideMapSelectionRow() {
  if (mapSelection) {
    mapSelection.classList.add("hidden");
  }
}

function setServerListExpanded(expanded) {
  if (!serverList) return;
  serverList.classList.toggle("expanded", !!expanded);
}

function activateHostOptions() {
  if (hostOptionsVisible) return;
  hostOptionsVisible = true;
  showMapSelectionRow();
  if (hostBtn) {
    hostBtn.classList.add("hosting");
    hostBtn.textContent = HOST_BUTTON_START_TEXT;
  }
}

function resetHostOptions() {
  hostOptionsVisible = false;
  hideMapSelectionRow();
  if (hostBtn) {
    hostBtn.classList.remove("hosting");
    hostBtn.textContent = hostBtnDefaultText;
  }
}

// Volume Slider Elements
const volumeSliderContainer = document.getElementById(
  "volume-slider-container",
);
const volumeSlider = document.getElementById("volume-slider");
const volumeLabel = document.querySelector(".volume-label");

// Audio Settings Elements
const masterVolumeSlider = document.getElementById("master-volume");
const sfxVolumeSlider = document.getElementById("sfx-volume");
const muteAllCheckbox = document.getElementById("mute-all");
const masterValueSpan = document.getElementById("master-value");
const sfxValueSpan = document.getElementById("sfx-value");
const applySettingsBtn = document.getElementById("apply-settings");
const cancelSettingsBtn = document.getElementById("cancel-settings");

// Add hover sounds to all buttons
const allButtons = document.querySelectorAll('button');
allButtons.forEach(button => {
  button.addEventListener('mouseenter', () => {
    audioManager.playProceduralSound('uiHover');
  });
});

// UI Event listeners
hostBtn.addEventListener("click", () => {
  audioManager.playProceduralSound('buttonPress');
  const playerName = playerNameInput.value.trim();
  if (!playerName) {
    showNameError("Please enter your nickname");
    return;
  }
  if (!hostOptionsVisible) {
    activateHostOptions();
    return;
  }
  const serverName = serverNameInput.value.trim() || "Unnamed Server";
  myPlayerName = playerName;
  hostGame(serverName, playerName);
});

if (serverNameInput) {
  serverNameInput.addEventListener("focus", activateHostOptions);
  serverNameInput.addEventListener("input", activateHostOptions);
}
if (hostBtn) {
  hostBtn.addEventListener("focus", activateHostOptions);
}

joinBtn.addEventListener("click", () => {
  audioManager.playProceduralSound('buttonPress');
  const playerName = playerNameInput.value.trim();
  if (!playerName) {
    showNameError("Please enter your nickname");
    return;
  }
  myPlayerName = playerName;
  showServerList();
});

audioSettingsBtn.addEventListener("click", () => {
  audioManager.playProceduralSound('buttonPress');
  audioManager.playProceduralSound('menuOpen');
  showAudioSettings();
});

audioToggle.addEventListener("click", () => {
  audioManager.toggleMute();
  updateAudioToggle();
});

audioToggle.addEventListener("mouseenter", () => {
  if (volumeSliderContainer) {
    volumeSliderContainer.classList.add("visible");
  }
});

audioToggle.addEventListener("mouseleave", () => {
  setTimeout(() => {
    if (!volumeSliderContainer) return;
    if (
      !volumeSliderContainer.matches(":hover") &&
      !audioToggle.matches(":hover")
    ) {
      volumeSliderContainer.classList.remove("visible");
    }
  }, 100);
});

if (volumeSliderContainer) {
  volumeSliderContainer.addEventListener("mouseleave", () => {
    if (!audioToggle.matches(":hover")) {
      volumeSliderContainer.classList.remove("visible");
    }
  });
}

volumeSlider.addEventListener("input", (e) => {
  const value = parseInt(e.target.value, 10);
  audioManager.masterVolume = value / 100;
  audioManager.saveSettings();
  audioManager.updateVolumes();
  if (volumeLabel) {
    volumeLabel.textContent = `${value}%`;
  }
  updateAudioToggle();
});

backBtn.addEventListener("click", () => {
  audioManager.playProceduralSound('buttonPress');
  showStartScreen();
});

// In-game menu button
if (ingameMenuBtn) {
  ingameMenuBtn.addEventListener("click", () => {
    audioManager.playProceduralSound('buttonPress');
    audioManager.playProceduralSound('menuOpen');
    showStartScreen();
  });
}

// Volume control buttons
if (volumeDownBtn) {
  volumeDownBtn.addEventListener("click", () => {
    audioManager.playProceduralSound('uiClick');
    const currentVolume = Math.round(audioManager.masterVolume * 100);
    const newVolume = Math.max(0, currentVolume - 10);
    audioManager.masterVolume = newVolume / 100;
    audioManager.saveSettings();
    if (volumeDisplay) {
      volumeDisplay.textContent = `${newVolume}%`;
    }
    updateAudioToggle();
  });
}

if (volumeUpBtn) {
  volumeUpBtn.addEventListener("click", () => {
    audioManager.playProceduralSound('uiClick');
    const currentVolume = Math.round(audioManager.masterVolume * 100);
    const newVolume = Math.min(100, currentVolume + 10);
    audioManager.masterVolume = newVolume / 100;
    audioManager.saveSettings();
    if (volumeDisplay) {
      volumeDisplay.textContent = `${newVolume}%`;
    }
    updateAudioToggle();
  });
}

refreshBtn.addEventListener("click", () => {
  audioManager.playProceduralSound('uiClick');
  socket.emit("getServers");
});

serverBackBtn.addEventListener("click", () => {
  audioManager.playProceduralSound('buttonPress');
  audioManager.playProceduralSound('menuClose');
  showStartScreen();
});

if (closeServerListBtn) {
  closeServerListBtn.addEventListener("click", () => {
    showStartScreen();
  });
}

chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!gameStarted || !socket.connected) return;
  const message = chatInput.value.trim();
  if (!message) return;
  socket.emit("chat:message", { text: message });
  chatInput.value = "";
});

masterVolumeSlider.addEventListener("input", (e) => {
  const value = parseInt(e.target.value, 10);
  masterValueSpan.textContent = `${value}%`;
  // Preview the volume change
  audioManager.masterVolume = value / 100;
  audioManager.updateVolumes();
});

sfxVolumeSlider.addEventListener("input", (e) => {
  const value = parseInt(e.target.value, 10);
  sfxValueSpan.textContent = `${value}%`;
  // Preview the volume change
  audioManager.sfxVolume = value / 100;
  audioManager.updateVolumes();
  // Play a test sound
  audioManager.playProceduralSound('uiClick');
});

muteAllCheckbox.addEventListener("change", (e) => {
  audioManager.muted = e.target.checked;
  if (audioManager.muted) {
    audioManager.stopMusic();
    audioManager.stopMenuMusic();
  } else {
    // Resume menu music if on start screen
    if (startScreen && startScreen.style.display !== 'none') {
      audioManager.startMenuMusic();
    }
  }
  updateAudioToggle();
});

applySettingsBtn.addEventListener("click", () => {
  audioManager.playProceduralSound('buttonPress');
  // Values are already set by sliders, just save them
  audioManager.masterVolume = masterVolumeSlider.value / 100;
  audioManager.sfxVolume = sfxVolumeSlider.value / 100;
  audioManager.muted = muteAllCheckbox.checked;
  audioManager.saveSettings();
  audioManager.updateVolumes();
  updateAudioToggle();
  
  // Restart menu music with new volume if not muted
  if (!audioManager.muted && startScreen && startScreen.style.display !== 'none') {
    audioManager.stopMenuMusic();
    setTimeout(() => {
      audioManager.startMenuMusic();
    }, 100);
  }
  
  hideAudioSettings();
});

cancelSettingsBtn.addEventListener("click", () => {
  audioManager.playProceduralSound('buttonPress');
  audioManager.playProceduralSound('menuClose');
  
  // Restore original settings
  audioManager.loadSettings();
  audioManager.updateVolumes();
  updateAudioToggle();
  
  hideAudioSettings();
});

mapOptions.forEach((option) => {
  option.addEventListener("click", () => {
    const mapType = option.getAttribute("data-map");
    selectMap(mapType, { updateUI: true, invalidateCache: true });
  });
  const radio = option.querySelector('input[type="radio"]');
  if (radio) {
    radio.addEventListener("change", () => {
      if (radio.checked) {
        const mapType = option.getAttribute("data-map");
        selectMap(mapType, { updateUI: true, invalidateCache: true });
      }
    });
  }
});

const initiallyCheckedOption =
  Array.from(mapOptions).find((opt) => {
    const radio = opt.querySelector('input[type="radio"]');
    return radio ? radio.checked : false;
  }) || mapOptions[0];
if (initiallyCheckedOption) {
  const initialType = initiallyCheckedOption.getAttribute("data-map");
  selectMap(initialType, { updateUI: true });
}

document.addEventListener("keydown", (e) => {
  if (!gameStarted) return;
  if (document.activeElement === chatInput) return;
  const key = (e.key || "").toLowerCase();
  if (key in keys) keys[key] = true;
  if (e.code === "ArrowUp") keys.w = true;
  if (e.code === "ArrowDown") keys.s = true;
  if (e.code === "ArrowLeft") keys.a = true;
  if (e.code === "ArrowRight") keys.d = true;
});

document.addEventListener("keyup", (e) => {
  if (!gameStarted) return;
  if (document.activeElement === chatInput) return;
  const key = (e.key || "").toLowerCase();
  if (key in keys) keys[key] = false;
  if (e.code === "ArrowUp") keys.w = false;
  if (e.code === "ArrowDown") keys.s = false;
  if (e.code === "ArrowLeft") keys.a = false;
  if (e.code === "ArrowRight") keys.d = false;
});

// Crosshair element
const crosshair = document.getElementById('crosshair');

// Update crosshair position on mouse move
document.addEventListener("mousemove", (e) => {
  if (crosshair && gameStarted) {
    crosshair.style.left = e.clientX + 'px';
    crosshair.style.top = e.clientY + 'px';
  }
});

canvas.addEventListener("mousemove", (e) => {
  if (!gameStarted) return;
  updateMousePositionFromEvent(e);
});

canvas.addEventListener("mousedown", (e) => {
  if (!gameStarted) return;
  if (e.button === 0) {
    updateMousePositionFromEvent(e);
    mouseDown = true;
    shoot();
  }
});

canvas.addEventListener("mouseup", (e) => {
  if (!gameStarted) return;
  if (e.button === 0) mouseDown = false;
});

function updateMousePositionFromEvent(e) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  mousePos.x = (e.clientX - rect.left) * scaleX;
  mousePos.y = (e.clientY - rect.top) * scaleY;
}

/**
 * Apply input with physics-based movement (matches server logic)
 * This ensures client prediction matches server simulation
 * @param {Object} player - Player state to update
 * @param {Object} input - Input data with keys, rotation, and dt
 */
function applyInput(player, input) {
  if (!player || !input) return;

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
  
  // Apply speed modifiers (speed boost handled by server, but predict it)
  let maxSpeed = TANK_MAX_SPEED;
  if (player.speedBoost) {
    maxSpeed *= 2; // Speed boost multiplier
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
  
  // Enforce map boundaries (client-side prediction)
  const TANK_RADIUS = 20;
  if (player.x < TANK_RADIUS) {
    player.x = TANK_RADIUS;
    player.vx = Math.max(0, player.vx);
  } else if (player.x > canvas.width - TANK_RADIUS) {
    player.x = canvas.width - TANK_RADIUS;
    player.vx = Math.min(0, player.vx);
  }
  
  if (player.y < TANK_RADIUS) {
    player.y = TANK_RADIUS;
    player.vy = Math.max(0, player.vy);
  } else if (player.y > canvas.height - TANK_RADIUS) {
    player.y = canvas.height - TANK_RADIUS;
    player.vy = Math.min(0, player.vy);
  }
  
  // Update rotation
  player.rotation = input.rotation;
  player.turretRotation = input.turretRotation;
}

// UI Helpers
function showStartScreen() {
  audioManager.stopMenuMusic();
  audioManager.startMenuMusic();
  if (startScreen) startScreen.style.display = "block";
  if (gameContainer) gameContainer.style.display = "none";
  if (audioSettings) audioSettings.style.display = "none";
  if (crosshair) crosshair.style.display = "none"; // Hide crosshair
  gameStarted = false;
  isConnecting = false;
  if (serverList) serverList.style.display = "none";
  setServerListExpanded(false);
  if (hostBtn) hostBtn.style.display = "inline-block";
  if (joinBtn) joinBtn.style.display = "inline-block";
  validateName();
  resetHostOptions();
  resetChat();
  resetLeaderboard();
  socket.disconnect();
  clearNameError();
  playerNames = {};
  destroyedPlayers.clear();
  audioManager.stopMusic();
  updateAudioToggle();
  if (inputInterval) {
    clearInterval(inputInterval);
    inputInterval = null;
  }
}

function showAudioSettings() {
  if (audioSettings) audioSettings.style.display = "flex";
  if (startScreen) startScreen.style.display = "none";
  mapSelectionWasVisible =
    hostOptionsVisible &&
    mapSelection &&
    !mapSelection.classList.contains("hidden");
  hideMapSelectionRow();
  masterVolumeSlider.value = audioManager.masterVolume * 100;
  sfxVolumeSlider.value = audioManager.sfxVolume * 100;
  muteAllCheckbox.checked = audioManager.muted;
  masterValueSpan.textContent = `${Math.round(audioManager.masterVolume * 100)}%`;
  sfxValueSpan.textContent = `${Math.round(audioManager.sfxVolume * 100)}%`;
}

function hideAudioSettings() {
  if (audioSettings) audioSettings.style.display = "none";
  if (startScreen) startScreen.style.display = "block";
  if (mapSelectionWasVisible) {
    showMapSelectionRow();
  }
  mapSelectionWasVisible = false;
}

function updateAudioToggle() {
  const effectiveMuted = audioManager.muted || audioManager.masterVolume === 0;
  audioToggle.textContent = effectiveMuted ? "\uD83D\uDD07" : "\uD83D\uDD0A";
  audioToggle.classList.toggle("muted", effectiveMuted);
  if (volumeSlider && volumeLabel) {
    const volume = Math.round(audioManager.masterVolume * 100);
    volumeSlider.value = volume;
    volumeLabel.textContent = `${volume}%`;
  }
}

function showServerList() {
  audioManager.playProceduralSound('menuOpen');
  resetHostOptions();
  if (serverList) {
    serverList.style.display = "block";
    setServerListExpanded(true);
  }
  if (hostBtn) hostBtn.style.display = "none";
  if (joinBtn) joinBtn.style.display = "none";
  if (!socket.connected) {
    socket.connect();
  }
  socket.emit("getServers");
}

function updateServerList(list) {
  try {
    console.log("Received server list:", list);
    servers = Array.isArray(list) ? list : [];
    if (!serversDiv) return;

    // Update server count
    if (serverCount) {
      serverCount.textContent = `(${servers.length})`;
    }

    serversDiv.innerHTML = "";

    if (!servers.length) {
      serversDiv.innerHTML = `
        <div class="server-list-placeholder">
          <div class="placeholder-icon">🔍</div>
          <p class="placeholder-text">No active servers found</p>
        </div>
      `;
      return;
    }

    servers.forEach((server, index) => {
      // Comprehensive validation of server entry
      if (
        !server ||
        typeof server !== "object" ||
        !server.id ||
        !server.name ||
        typeof server.id !== "string" ||
        typeof server.name !== "string" ||
        typeof server.players !== "number" ||
        typeof server.maxPlayers !== "number" ||
        isNaN(server.players) ||
        isNaN(server.maxPlayers)
      ) {
        console.warn(
          "Skipping invalid server entry:",
          server,
          "at index:",
          index,
        );
        return; // Skip invalid server entries
      }

      const isFull = server.players >= server.maxPlayers;
      const div = document.createElement("div");
      div.className = `server-item ${isFull ? "disabled" : ""}`;

      // Create enhanced server item structure
      const serverHeader = document.createElement("div");
      serverHeader.className = "server-item-header";

      const serverName = document.createElement("div");
      serverName.className = "server-name";
      serverName.textContent = server.name;

      const serverStatus = document.createElement("div");
      serverStatus.className = `server-status ${isFull ? "full" : "online"}`;

      const statusDot = document.createElement("span");
      statusDot.className = "status-dot";

      const statusText = document.createElement("span");
      statusText.textContent = isFull ? "FULL" : "ONLINE";

      serverStatus.appendChild(statusDot);
      serverStatus.appendChild(statusText);

      serverHeader.appendChild(serverName);
      serverHeader.appendChild(serverStatus);

      // Server details
      const serverDetails = document.createElement("div");
      serverDetails.className = "server-details";

      const playerDetail = document.createElement("div");
      playerDetail.className = "server-detail";

      const playerIcon = document.createElement("span");
      playerIcon.className = "detail-icon";
      playerIcon.textContent = "👥";

      const playerText = document.createElement("span");
      playerText.textContent = `${server.players}/${server.maxPlayers} Players`;

      playerDetail.appendChild(playerIcon);
      playerDetail.appendChild(playerText);

      serverDetails.appendChild(playerDetail);

      div.appendChild(serverHeader);
      div.appendChild(serverDetails);

      if (!isFull) {
        div.addEventListener("click", () => joinServer(server.id));
      }

      serversDiv.appendChild(div);
    });
  } catch (error) {
    console.error("Error updating server list:", error);
    if (serversDiv) {
      serversDiv.innerHTML = `
        <div class="server-list-placeholder">
          <div class="placeholder-icon">⚠️</div>
          <p class="placeholder-text">Error loading servers</p>
        </div>
      `;
    }
  }
}

function resetChat() {
  if (chatMessagesDiv) {
    chatMessagesDiv.innerHTML = "";
    chatMessagesDiv.scrollTop = 0;
  }
  if (chatInput) chatInput.value = "";
  setChatEnabled(false);
}

function resetLeaderboard() {
  if (leaderboardContent) {
    leaderboardContent.innerHTML = `
      <div class="leaderboard-placeholder">
        <div class="placeholder-icon">🎯</div>
        <p class="placeholder-text">No scores yet</p>
      </div>
    `;
  }
}

function validateName() {
  const hasName = !!(playerNameInput && playerNameInput.value.trim());
  if (hostBtn) hostBtn.disabled = !hasName;
  if (joinBtn) joinBtn.disabled = !hasName;
  if (hasName) clearNameError();
}

if (playerNameInput) {
  playerNameInput.addEventListener("input", validateName);
}

function showNameError(msg) {
  if (nameError) nameError.textContent = msg || "";
}

function clearNameError() {
  if (nameError) nameError.textContent = "";
}

function setChatEnabled(enabled) {
  if (chatInput) chatInput.disabled = !enabled;
  if (chatSubmitButton) chatSubmitButton.disabled = !enabled;
}

function formatPlayerLabel(authorId) {
  if (!authorId) return "System";
  if (playerNames[authorId]) return playerNames[authorId];
  if (players[authorId] && players[authorId].name)
    return players[authorId].name;
  if (authorId === playerId) return myPlayerName || "You";
  return `Player ${authorId.substring(0, 5).toUpperCase()}`;
}

function addChatMessage(message) {
  if (!chatMessagesDiv || !message || !message.text) return;
  const entry = document.createElement("div");
  entry.classList.add("chat-message");
  if (message.system) entry.classList.add("system");
  if (message.timestamp) {
    entry.title = new Date(message.timestamp).toLocaleTimeString();
  }
  const authorSpan = document.createElement("span");
  authorSpan.classList.add("author");
  authorSpan.textContent = message.system
    ? "System"
    : formatPlayerLabel(message.playerId);
  const textSpan = document.createElement("span");
  textSpan.classList.add("message-text");
  textSpan.textContent = message.text;
  if (!message.system) entry.appendChild(authorSpan);
  entry.appendChild(textSpan);
  chatMessagesDiv.appendChild(entry);
  pruneChatMessages(MAX_CHAT_MESSAGES);
  chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight;
}

function pruneChatMessages(maxMessages = MAX_CHAT_MESSAGES) {
  if (!chatMessagesDiv) return;
  while (chatMessagesDiv.children.length > maxMessages) {
    chatMessagesDiv.removeChild(chatMessagesDiv.firstChild);
  }
}

function hostGame(serverName, playerName) {
  if (isConnecting) return;
  isConnecting = true;
  gameStarted = true;
  if (startScreen) startScreen.style.display = "none";
  if (gameContainer) gameContainer.style.display = "grid";
  
  // Update volume display
  if (volumeDisplay) {
    const currentVolume = Math.round(audioManager.masterVolume * 100);
    volumeDisplay.textContent = `${currentVolume}%`;
  }

  playerId = null;
  gameId = null;
  players = {};
  bullets = [];
  scores = {};
  destroyedPlayers.clear();
  predictedPlayer = {
    x: canvas.width / 2,
    y: canvas.height / 2,
    vx: 0,
    vy: 0,
    rotation: 0,
    turretRotation: 0,
  };
  lastShootTime = 0;

  resetChat();
  updateAudioToggle();

  const chosenMap = selectMap(selectedMap, {
    updateUI: true,
    invalidateCache: true,
  });
  socket.connect();
  socket.emit("host", { name: serverName, playerName, map: chosenMap });

  // Start sending inputs to the server
  inputInterval = setInterval(() => {
    if (inputQueue.length > 0) {
      socket.emit("input", inputQueue);
      inputQueue = []; // Clear the queue after sending
    }
  }, 50); // Send inputs 20 times per second
}

function joinGame(targetGameId) {
  if (isConnecting) return;
  isConnecting = true;
  gameStarted = true;
  if (startScreen) startScreen.style.display = "none";
  if (gameContainer) gameContainer.style.display = "grid";
  
  // Update volume display
  if (volumeDisplay) {
    const currentVolume = Math.round(audioManager.masterVolume * 100);
    volumeDisplay.textContent = `${currentVolume}%`;
  }

  playerId = null;
  players = {};
  bullets = [];
  scores = {};
  destroyedPlayers.clear();
  predictedPlayer = {
    x: canvas.width / 2,
    y: canvas.height / 2,
    vx: 0,
    vy: 0,
    rotation: 0,
    turretRotation: 0,
  };
  lastShootTime = 0;

  resetChat();
  updateAudioToggle();

  if (!socket.connected) socket.connect();
  const playerName = playerNameInput ? playerNameInput.value.trim() : "";
  socket.emit("join", {
    serverId: targetGameId,
    gameId: targetGameId,
    name: playerName,
    playerName,
  });

  // Start sending inputs to the server
  inputInterval = setInterval(() => {
    if (inputQueue.length > 0) {
      socket.emit("input", inputQueue);
      inputQueue = []; // Clear the queue after sending
    }
  }, 50); // Send inputs 20 times per second
}

function joinServer(serverId) {
  joinGame(serverId);
}

async function loadAudioFiles() {
  await audioManager.loadSound("shoot", "sounds/effects/shoot.mp3");
  await audioManager.loadSound(
    "explosion",
    "sounds/effects/explosion-312361.mp3",
  );
  await audioManager.loadSound(
    "background-music",
    "sounds/music/background.mp3",
  );
}

// Socket events
socket.on("join", (data) => {
  audioManager.stopMenuMusic();
  playerId = data.id;
  gameId = data.gameId;
  canvas.width = data.mapWidth;
  canvas.height = data.mapHeight;
  const newMapType = selectMap(data.mapType, {
    updateUI: true,
    invalidateCache: true,
  });
  currentMapType = newMapType;
  isConnecting = false;
  setChatEnabled(true);
  if (chatInput) chatInput.focus();
  if (data.name) {
    myPlayerName = data.name;
    playerNames[playerId] = data.name;
  } else if (myPlayerName) {
    playerNames[playerId] = myPlayerName;
  }
  updateAudioToggle();
  if (audioManager.sounds["background-music"]) {
    audioManager.playMusic("background-music");
  }
});

socket.on("state", (state) => {
  if (!gameStarted || !state || !Array.isArray(state.players)) return;

  try {
    players = {};
    state.players.forEach((p) => {
      if (p && p.id) {
        players[p.id] = p;
        if (p.name) playerNames[p.id] = p.name;
      }
    });

    // Clean up destroyed players set
    if (destroyedPlayers && destroyedPlayers.size > 0) {
      destroyedPlayers.forEach((id) => {
        if (!players[id] || (players[id] && !players[id].dead)) {
          destroyedPlayers.delete(id);
        }
      });
    }

    // Update bullets from server - replace client bullets with server bullets
    if (Array.isArray(state.bullets)) {
      // Clear old client bullets and use server bullets
      clientBullets = state.bullets.map(b => ({
        x: b.x,
        y: b.y,
        angle: b.angle || 0,
        color: b.color || '#00ffff',
        vx: 0,
        vy: 0,
        lifetime: 0
      }));
    }
    scores =
      state.scores && typeof state.scores === "object" ? state.scores : {};

    // Update power-ups from server state
    if (state.powerUps && Array.isArray(state.powerUps)) {
      powerUps = state.powerUps;
    }

    lastServerState = state;

    // Server reconciliation with smooth correction
    if (playerId && players[playerId]) {
      const serverPlayer = players[playerId];
      
      // Detect damage taken for flash effect
      if (predictedPlayer.health && serverPlayer.health < predictedPlayer.health) {
        triggerDamageFlash('#ff0080');
      }
      
      // Detect power-up collection
      const hadSpeedBoost = predictedPlayer.speedBoost;
      const hadShield = predictedPlayer.shield;
      const hasNewSpeedBoost = serverPlayer.speedBoost && !hadSpeedBoost;
      const hasNewShield = serverPlayer.shield && !hadShield;
      
      if (hasNewSpeedBoost) {
        triggerPowerupFlash('#00ffff');
      }
      if (hasNewShield) {
        triggerPowerupFlash('#ff00ff');
      }
      
      // Store health for next comparison
      predictedPlayer.health = serverPlayer.health;

      // Update the client's predicted player state with the server's authoritative state
      predictedPlayer.x = serverPlayer.x;
      predictedPlayer.y = serverPlayer.y;
      predictedPlayer.vx = serverPlayer.vx || 0;
      predictedPlayer.vy = serverPlayer.vy || 0;
      predictedPlayer.rotation = serverPlayer.rotation;
      predictedPlayer.speedBoost = serverPlayer.speedBoost;
      predictedPlayer.shield = serverPlayer.shield;

      // Remove inputs from the history that have already been processed by the server
      let lastProcessedInputSeq = serverPlayer.lastProcessedInput || 0;
      while (
        predictionHistory.length > 0 &&
        predictionHistory[0].seq <= lastProcessedInputSeq
      ) {
        predictionHistory.shift();
      }

      // Re-apply unprocessed inputs to the predicted player state
      predictionHistory.forEach((input) => {
        applyInput(predictedPlayer, input);
      });
    }
    
    // Setup interpolation for other players
    state.players.forEach((p) => {
      if (!p || p.id === playerId) return;
      
      if (!otherPlayersInterpolated[p.id]) {
        // Initialize interpolation data
        otherPlayersInterpolated[p.id] = {
          current: { x: p.x, y: p.y, rotation: p.rotation, turretRotation: p.turretRotation },
          target: { x: p.x, y: p.y, rotation: p.rotation, turretRotation: p.turretRotation },
          timestamp: Date.now()
        };
      } else {
        // Update target position
        const interpData = otherPlayersInterpolated[p.id];
        interpData.current = { ...interpData.target };
        interpData.target = { x: p.x, y: p.y, rotation: p.rotation, turretRotation: p.turretRotation };
        interpData.timestamp = Date.now();
      }
    });
    
    // Clean up interpolation data for disconnected players
    Object.keys(otherPlayersInterpolated).forEach((id) => {
      if (!players[id]) {
        delete otherPlayersInterpolated[id];
      }
    });

    // Safely update UI
    const kills = scores && scores[playerId] ? scores[playerId] : 0;
    const playerCount = players ? Object.keys(players).length : 0;
    const killsDiv = document.getElementById("kills");
    const playersDiv = document.getElementById("players-count");

    if (killsDiv) killsDiv.textContent = `Kills: ${kills}`;
    if (playersDiv) playersDiv.textContent = `Players: ${playerCount}`;

    // Update leaderboard
    updateLeaderboard();
  } catch (error) {
    console.error("Error processing state update:", error);
  }
});

socket.on("servers", updateServerList);

socket.on("chat:history", (messages) => {
  if (!Array.isArray(messages)) return;
  if (chatMessagesDiv) chatMessagesDiv.innerHTML = "";
  messages.slice(-MAX_CHAT_MESSAGES).forEach(addChatMessage);
});

socket.on("chat:message", addChatMessage);

socket.on("player:name", ({ id, name }) => {
  if (!id) return;
  if (typeof name === "string" && name.trim()) {
    playerNames[id] = name.trim();
    if (players[id]) players[id].name = name.trim();
  }
});

socket.on("player:left", ({ id }) => {
  if (!id) return;
  delete playerNames[id];
});

// Handle instant bullet hits from server
socket.on("bulletHit", (data) => {
  if (!data) return;
  
  // Create explosion effect at hit location
  if (data.hitX && data.hitY) {
    const hitColor = data.victim === playerId ? '#ff0080' : '#ffff00';
    createExplosion(data.hitX, data.hitY, hitColor);
  }
  
  // Trigger damage flash if we got hit
  if (data.victim === playerId) {
    triggerDamageFlash('#ff0080');
  }
});

// Handle wall impact events for laser bounces
socket.on("wallImpact", (data) => {
  if (!data || !data.x || !data.y) return;
  
  const impactColor = data.color || '#00ffff';
  
  // Create smaller explosion effect for wall impact
  const particleCount = 12;
  for (let i = 0; i < particleCount; i++) {
    const angle = (Math.PI * 2 * i) / particleCount;
    const speed = 50 + Math.random() * 50;
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;
    const size = 2 + Math.random() * 3;
    const lifetime = 0.3 + Math.random() * 0.3;
    
    particleSystem.particles.push(new Particle(data.x, data.y, vx, vy, impactColor, size, lifetime));
  }
  
  // Screen flash for wall impacts (subtle)
  particleSystem.screenFlash = 0.15;
  particleSystem.screenFlashColor = impactColor;
  particleSystem.screenFlashDecay = 0.3;
  
  // Play wall bounce sound
  audioManager.playProceduralSound('wallBounce');
});

socket.on("error", (message) => {
  alert(message || "An error occurred");
  isConnecting = false;
  showStartScreen();
});

socket.on("full", () => {
  alert("Game is full!");
  isConnecting = false;
  showStartScreen();
});

socket.on("connect_error", () => {
  alert("Failed to connect to server. Please try again.");
  isConnecting = false;
  showStartScreen();
});

socket.on("disconnect", (reason) => {
  console.log('Disconnected:', reason);
  if (gameStarted) {
    isConnecting = false;
    resetChat();
    
    // Show user-friendly disconnect message
    if (reason === 'io server disconnect') {
      alert('You were disconnected from the server.');
    } else if (reason === 'transport close' || reason === 'transport error') {
      alert('Connection lost. Please check your internet connection.');
    }
    
    showStartScreen();
    audioManager.startMenuMusic();
  }
});

// Add custom event listener for power-up collection
let lastPowerUpCollected = {};
socket.on("state", (state) => {
  // Check if player just collected a power-up (compare power-up effects before/after)
  if (playerId && players[playerId] && state.players) {
    const newPlayerState = state.players.find(p => p.id === playerId);
    const oldPlayerState = players[playerId];
    
    if (newPlayerState && oldPlayerState) {
      // Check if any new power-up was just activated
      if (newPlayerState.speedBoost && !oldPlayerState.speedBoost ||
          newPlayerState.rapidFire && !oldPlayerState.rapidFire ||
          newPlayerState.shield && !oldPlayerState.shield ||
          newPlayerState.damageBoost && !oldPlayerState.damageBoost ||
          newPlayerState.hp > oldPlayerState.hp) {
        audioManager.playProceduralSound('powerup');
      }
    }
  }
});

/**
 * Main update loop - handles client-side prediction and input processing
 * Runs at 60 FPS for smooth gameplay
 */
function update() {
  if (!playerId || !players[playerId] || !gameStarted) return;

  try {
    const dt = 1 / 60; // Fixed timestep for consistent physics

    // Update power-ups
    updatePowerUps(dt);
    
    // Bullets are now fully server-authoritative
    // No client-side bullet movement needed
    
    // Interpolate other players for smooth movement
    const now = Date.now();
    Object.keys(otherPlayersInterpolated).forEach((id) => {
      const interpData = otherPlayersInterpolated[id];
      const timeSinceUpdate = now - interpData.timestamp;
      const t = Math.min(timeSinceUpdate / INTERPOLATION_DELAY, 1.0);
      
      // Smooth interpolation using ease-out
      const easeT = 1 - Math.pow(1 - t, 3);
      
      interpData.current.x = interpData.current.x + (interpData.target.x - interpData.current.x) * easeT;
      interpData.current.y = interpData.current.y + (interpData.target.y - interpData.current.y) * easeT;
      interpData.current.rotation = interpData.current.rotation + (interpData.target.rotation - interpData.current.rotation) * easeT;
      interpData.current.turretRotation = interpData.current.turretRotation + (interpData.target.turretRotation - interpData.current.turretRotation) * easeT;
    });

    // Calculate turret rotation based on mouse position
    if (mousePos && mousePos.x !== undefined && mousePos.y !== undefined) {
      const dx = mousePos.x - predictedPlayer.x;
      const dy = mousePos.y - predictedPlayer.y;
      predictedPlayer.turretRotation = Math.atan2(dy, dx);
    }

    // Create trail particles when moving
    const isMoving = keys.w || keys.s || keys.a || keys.d;
    if (isMoving && Math.random() < 0.05) {
      if (particleSystem && particleSystem.createTankTrail) {
        particleSystem.createTankTrail(predictedPlayer.x, predictedPlayer.y);
      }
    }

    // Update Glowy Tanks particle systems
    updateTrails(dt);
    updateExplosions(dt);
    updateFloatingParticles(dt);
    updateCrosshairColor();
    
    // Update particle system
    if (particleSystem && particleSystem.update) {
      particleSystem.update(dt);
    }

    // Create input packet for server
    const input = {
      seq: sequenceNumber++,
      inputs: { ...keys },
      rotation: predictedPlayer.rotation || 0,
      turretRotation: predictedPlayer.turretRotation || 0,
      dt: dt,
    };
    // Add to input queue for sending to server
    inputQueue.push(input);
    
    // Apply input locally for client-side prediction
    applyInput(predictedPlayer, input);
    
    // Store in prediction history for reconciliation
    predictionHistory.push({ 
      x: predictedPlayer.x,
      y: predictedPlayer.y,
      vx: predictedPlayer.vx,
      vy: predictedPlayer.vy,
      rotation: predictedPlayer.rotation,
      turretRotation: predictedPlayer.turretRotation,
      seq: input.seq,
      inputs: { ...keys },
      dt: dt
    });
    
    // Limit prediction history size to prevent memory issues
    if (predictionHistory.length > 60) {
      predictionHistory.shift();
    }
  } catch (error) {
    console.error("Error in update function:", error);
  }
}

/**
 * Glowy Tanks - Particle & Effects System
 */

// Create bullet trail particle
function createBulletTrail(x, y, color) {
  bulletTrails.push({
    x, y,
    size: 8,
    color: color || '#ffff00',
    alpha: 0.8,
    life: 1,
    decay: 0.05
  });
}

// Create explosion effect
function createExplosion(x, y, color = '#ff00ff') {
  const playArea = document.getElementById('play-area');
  
  // Screen shake
  playArea.classList.add('screen-shake');
  setTimeout(() => playArea.classList.remove('screen-shake'), 400);
  
  // Explosion particles
  for (let i = 0; i < 30; i++) {
    const angle = (Math.PI * 2 * i) / 30;
    const speed = 100 + Math.random() * 100;
    explosionParticles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 4 + Math.random() * 6,
      color: color,
      alpha: 1,
      life: 1,
      decay: 0.02
    });
  }
}

// Create floating ambient particles
function createFloatingParticle() {
  if (floatingParticles.length < 50) {
    floatingParticles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 20,
      vy: (Math.random() - 0.5) * 20,
      size: 2 + Math.random() * 3,
      color: Math.random() > 0.5 ? '#ff00ff' : '#00ffff',
      alpha: 0.3 + Math.random() * 0.3,
      life: 1
    });
  }
}

// Update and draw trail particles
function updateTrails(dt) {
  bulletTrails = bulletTrails.filter(trail => {
    trail.life -= trail.decay;
    trail.alpha = trail.life * 0.8;
    trail.size *= 0.95;
    return trail.life > 0;
  });
}

// Update and draw explosion particles
function updateExplosions(dt) {
  explosionParticles = explosionParticles.filter(particle => {
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vx *= 0.95;
    particle.vy *= 0.95;
    particle.life -= particle.decay;
    particle.alpha = particle.life;
    return particle.life > 0;
  });
}

// Update floating particles
function updateFloatingParticles(dt) {
  floatingParticles = floatingParticles.filter(particle => {
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    
    // Wrap around screen
    if (particle.x < 0) particle.x = canvas.width;
    if (particle.x > canvas.width) particle.x = 0;
    if (particle.y < 0) particle.y = canvas.height;
    if (particle.y > canvas.height) particle.y = 0;
    
    return true;
  });
  
  // Spawn new particles randomly
  if (Math.random() < 0.1) {
    createFloatingParticle();
  }
}

// Draw all particles
function drawParticles() {
  ctx.save();
  
  // Draw floating ambient particles
  floatingParticles.forEach(p => {
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 15;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  });
  
  // Draw bullet trails
  bulletTrails.forEach(t => {
    ctx.globalAlpha = t.alpha;
    ctx.fillStyle = t.color;
    ctx.shadowColor = t.color;
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.size, 0, Math.PI * 2);
    ctx.fill();
  });
  
  // Draw explosion particles
  explosionParticles.forEach(p => {
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 15;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  });
  
  ctx.restore();
}

// Update crosshair color based on player
function updateCrosshairColor() {
  if (crosshair && playerId && players[playerId]) {
    // Local player always gets cyan, this is their color
    const playerColor = '#00ffff';
    crosshair.style.setProperty('--crosshair-color', playerColor);
    
    // Show crosshair when in game
    if (gameStarted) {
      crosshair.style.display = 'block';
    } else {
      crosshair.style.display = 'none';
    }
  }
}

// Trigger damage flash effect
function triggerDamageFlash(color = '#ff0080') {
  const playArea = document.getElementById('play-area');
  playArea.style.setProperty('--damage-color', color);
  playArea.classList.add('damage-flash');
  setTimeout(() => playArea.classList.remove('damage-flash'), 300);
}

// Trigger power-up flash effect
function triggerPowerupFlash(color = '#ffff00') {
  const playArea = document.getElementById('play-area');
  playArea.style.setProperty('--powerup-color', color);
  playArea.classList.add('powerup-flash');
  setTimeout(() => playArea.classList.remove('powerup-flash'), 500);
}

function draw() {
  if (!ctx || !canvas) return;

  try {
    drawBackground();

    // Draw particles safely
    if (particleSystem && particleSystem.draw) {
      particleSystem.draw(ctx);
    }

    // Draw players safely
    if (players && typeof players === "object") {
      Object.keys(players).forEach((id) => {
        const player = players[id];
        if (!player) return;

        const isLocal = id === playerId;
        
        // Use interpolated position for other players for smooth movement
        let drawX, drawY, turretAngle;
        if (isLocal) {
          drawX = predictedPlayer.x;
          drawY = predictedPlayer.y;
          turretAngle = predictedPlayer.turretRotation;
        } else if (otherPlayersInterpolated[id]) {
          // Use interpolated position for smooth rendering
          drawX = otherPlayersInterpolated[id].current.x;
          drawY = otherPlayersInterpolated[id].current.y;
          turretAngle = otherPlayersInterpolated[id].current.turretRotation;
        } else {
          // Fallback to server position
          drawX = player.x;
          drawY = player.y;
          turretAngle = player.turretRotation;
        }

        // Handle explosions safely
        if (player.dead && !destroyedPlayers.has(id)) {
          if (particleSystem && particleSystem.createTankExplosion) {
            particleSystem.createTankExplosion(player.x, player.y);
          }
          
          // Create Glowy Tanks explosion effect
          const explosionColor = isLocal ? '#00ffff' : '#ff00ff';
          createExplosion(drawX, drawY, explosionColor);
          
          // Play explosion and death sounds
          audioManager.playProceduralSound('explosion');
          if (id === playerId) {
            audioManager.playProceduralSound('death');
          }
          if (id === playerId) {
            addChatMessage({ text: "You were destroyed!", system: true });
          } else {
            const name =
              playerNames[id] ||
              player.name ||
              `Player ${id.substring(0, 5).toUpperCase()}`;
            addChatMessage({ text: `${name} was destroyed!`, system: true });
          }
          destroyedPlayers.add(id);
        }
        if (player.dead) return;

        // Set alpha for invulnerable tanks
        if (player.invulnerable) {
          ctx.globalAlpha = 0.6;
        }
        
        // Draw detailed tank
        const tankColor = player.color || (isLocal ? "#4a90e2" : "#e74c3c");
        drawDetailedTank(ctx, drawX, drawY, turretAngle, tankColor, isLocal, {
          shield: player.shield,
          speedBoost: player.speedBoost,
          damageBoost: player.damageBoost
        });
        
        // Reset alpha
        ctx.globalAlpha = 1.0;

        // Modern HP bar with background
        const hpBarWidth = 44;
        const hpBarHeight = 7;
        const hpPercent = player.hp / 100;
        
        // HP bar background
        ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
        ctx.fillRect(drawX - hpBarWidth/2 - 1, drawY - 40, hpBarWidth + 2, hpBarHeight + 2);
        
        // HP bar container
        ctx.fillStyle = "#2c3e50";
        ctx.fillRect(drawX - hpBarWidth/2, drawY - 39, hpBarWidth, hpBarHeight);
        
        // HP bar fill (gradient based on health)
        const hpGradient = ctx.createLinearGradient(drawX - hpBarWidth/2, 0, drawX + hpBarWidth/2, 0);
        if (hpPercent > 0.6) {
          hpGradient.addColorStop(0, "#27ae60");
          hpGradient.addColorStop(1, "#2ecc71");
        } else if (hpPercent > 0.3) {
          hpGradient.addColorStop(0, "#f39c12");
          hpGradient.addColorStop(1, "#f1c40f");
        } else {
          hpGradient.addColorStop(0, "#e74c3c");
          hpGradient.addColorStop(1, "#c0392b");
        }
        ctx.fillStyle = hpGradient;
        ctx.fillRect(drawX - hpBarWidth/2, drawY - 39, hpBarWidth * hpPercent, hpBarHeight);
        
        // HP bar shine effect
        ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
        ctx.fillRect(drawX - hpBarWidth/2, drawY - 39, hpBarWidth * hpPercent, 2);

        // Draw power-up effects
        if (player.shield) {
          // Animated shield effect with multiple layers
          const time = Date.now() / 1000;
          ctx.strokeStyle = "rgba(155, 89, 182, 0.4)";
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(drawX, drawY, 32 + Math.sin(time * 3) * 2, 0, Math.PI * 2);
          ctx.stroke();
          
          ctx.strokeStyle = "rgba(155, 89, 182, 0.6)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(drawX, drawY, 28 + Math.cos(time * 3) * 2, 0, Math.PI * 2);
          ctx.stroke();
          
          // Shield particles
          for (let i = 0; i < 6; i++) {
            const angle = (time * 2 + i * Math.PI / 3) % (Math.PI * 2);
            const x = drawX + Math.cos(angle) * 30;
            const y = drawY + Math.sin(angle) * 30;
            ctx.fillStyle = "rgba(155, 89, 182, 0.8)";
            ctx.beginPath();
            ctx.arc(x, y, 2, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        if (player.speed) {
          // Draw speed boost effect (motion lines)
          ctx.strokeStyle = "rgba(52, 152, 219, 0.4)";
          ctx.lineWidth = 2;
          for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.moveTo(drawX - 25, drawY - 10 + i * 10);
            ctx.lineTo(drawX - 35, drawY - 10 + i * 10);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(drawX + 25, drawY - 10 + i * 10);
            ctx.lineTo(drawX + 35, drawY - 10 + i * 10);
            ctx.stroke();
          }
        }

        if (player.damageBoost) {
          // Draw damage boost effect (red aura)
          ctx.strokeStyle = "rgba(243, 156, 18, 0.4)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(drawX, drawY, 28, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Player name
        const name =
          player.name ||
          playerNames[id] ||
          `Player ${id.substring(0, 5).toUpperCase()}`;
        ctx.font = "bold 12px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(0,0,0,0.7)";
        ctx.strokeText(name, drawX, drawY - 40);
        ctx.fillStyle = "#ecf0f1";
        ctx.fillText(name, drawX, drawY - 40);
      });
    }

    // Draw ambient floating particles
    drawParticles();
    
    // Draw glowing light projectiles with player colors
    clientBullets.forEach((bullet) => {
      if (bullet && bullet.x !== undefined && bullet.y !== undefined) {
        const lightColor = bullet.color || '#00ffff';
        
        // Convert hex to RGB for glow effects
        const hexToRgb = (hex) => {
          const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
          return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
          } : { r: 0, g: 255, b: 255 };
        };
        
        const rgb = hexToRgb(lightColor);
        
        ctx.save();
        
        // Outer glow - largest, most transparent
        ctx.shadowColor = lightColor;
        ctx.shadowBlur = 30;
        ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15)`;
        ctx.beginPath();
        ctx.arc(bullet.x, bullet.y, 18, 0, Math.PI * 2);
        ctx.fill();
        
        // Middle glow
        ctx.shadowBlur = 20;
        ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.4)`;
        ctx.beginPath();
        ctx.arc(bullet.x, bullet.y, 12, 0, Math.PI * 2);
        ctx.fill();
        
        // Inner glow - brighter
        ctx.shadowBlur = 15;
        ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.7)`;
        ctx.beginPath();
        ctx.arc(bullet.x, bullet.y, 8, 0, Math.PI * 2);
        ctx.fill();
        
        // Core - bright white center
        ctx.shadowBlur = 10;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(bullet.x, bullet.y, 4, 0, Math.PI * 2);
        ctx.fill();
        
        // Extra bright center point
        ctx.shadowBlur = 5;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(bullet.x, bullet.y, 2, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.restore();
      }
    });

    // Draw power-ups
    drawPowerUps();
  } catch (error) {
    console.error("Error in draw function:", error);
  }
}

function shoot() {
  if (
    !playerId ||
    !players[playerId] ||
    (players[playerId] && players[playerId].dead)
  )
    return;

  try {
    if (mousePos && mousePos.x !== undefined && mousePos.y !== undefined) {
      const angle = Math.atan2(
        mousePos.y - predictedPlayer.y,
        mousePos.x - predictedPlayer.x,
      );

      const now = Date.now();
      const player = players[playerId];
      const hasRapidFire = !!(player && player.rapidFire);
      if (!hasRapidFire && now - lastShootTime < SHOOT_COOLDOWN) {
        return;
      }

      if (!(socket && socket.emit && !socket.disconnected)) {
        return;
      }

      socket.emit("shoot", { angle });
      lastShootTime = now;
      
      // Play shoot sound
      audioManager.playProceduralSound('shoot');
      
      // Server handles bullet creation with raycast
      // No client-side bullets needed

      if (audioManager && audioManager.sounds && audioManager.sounds["shoot"]) {
        audioManager.playSound("shoot");
      }

      if (particleSystem && particleSystem.createMuzzleFlash) {
        particleSystem.createMuzzleFlash(
          predictedPlayer.x,
          predictedPlayer.y,
          angle,
        );
      }
    }
  } catch (error) {
    console.error("Error in shoot function:", error);
  }
}

// Power-ups functions
function updatePowerUps(dt) {
  powerUps = powerUps.filter((powerUp) => {
    // Remove power-ups older than 30 seconds
    if (Date.now() - powerUp.createdAt > 30000) {
      return false;
    }

    return true; // Keep power-up
  });
}

function drawPowerUps() {
  if (!powerUps || powerUps.length === 0) return;

  powerUps.forEach((powerUp) => {
    const powerUpType = POWER_UP_TYPES[powerUp.type];
    if (!powerUpType) return;

    // Pulsing effect
    const pulse = Math.sin(Date.now() * 0.005) * 0.2 + 0.8;

    ctx.save();
    ctx.translate(powerUp.x, powerUp.y);
    ctx.scale(pulse, pulse);

    // Draw power-up circle
    ctx.fillStyle = powerUpType.color;
    ctx.beginPath();
    ctx.arc(0, 0, 15, 0, Math.PI * 2);
    ctx.fill();

    // Draw border
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw icon
    ctx.font = "16px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(powerUpType.icon, 0, 0);

    ctx.restore();
  });
}

// Leaderboard functions
function updateLeaderboard() {
  if (!leaderboardContent) return;

  try {
    // Create leaderboard data from current scores
    const leaderboardData = [];

    // Add current players with their scores
    if (scores && typeof scores === "object") {
      Object.keys(scores).forEach((playerId) => {
        const score = scores[playerId];
        const name =
          playerNames[playerId] ||
          players[playerId]?.name ||
          `Player ${playerId.substring(0, 5).toUpperCase()}`;

        leaderboardData.push({
          id: playerId,
          name: name,
          kills: score || 0,
          isSelf: playerId === socket.id,
        });
      });
    }

    // Sort by kills (descending)
    leaderboardData.sort((a, b) => b.kills - a.kills);

    // Clear current leaderboard
    leaderboardContent.innerHTML = "";

    if (leaderboardData.length === 0) {
      // Show placeholder if no data
      leaderboardContent.innerHTML = `
        <div class="leaderboard-placeholder">
          <div class="placeholder-icon">🎯</div>
          <p class="placeholder-text">No scores yet</p>
        </div>
      `;
      return;
    }

    // Display top 10 players
    const topPlayers = leaderboardData.slice(0, 10);

    topPlayers.forEach((player, index) => {
      const entry = document.createElement("div");
      entry.className = "leaderboard-entry";
      if (player.isSelf) {
        entry.classList.add("self");
      }

      // Rank badge
      const rankDiv = document.createElement("div");
      rankDiv.className = "leaderboard-rank";

      if (index === 0) {
        rankDiv.classList.add("rank-1");
        rankDiv.textContent = "🥇";
      } else if (index === 1) {
        rankDiv.classList.add("rank-2");
        rankDiv.textContent = "🥈";
      } else if (index === 2) {
        rankDiv.classList.add("rank-3");
        rankDiv.textContent = "🥉";
      } else {
        rankDiv.classList.add("rank-other");
        rankDiv.textContent = index + 1;
      }

      // Player info
      const playerInfo = document.createElement("div");
      playerInfo.className = "leaderboard-player-info";

      const playerName = document.createElement("div");
      playerName.className = "leaderboard-name";
      playerName.textContent = player.name;
      playerName.title = `${player.name} - ${player.kills} kills`;

      playerInfo.appendChild(playerName);

      // Kills count
      const killsDiv = document.createElement("div");
      killsDiv.className = "leaderboard-kills";
      killsDiv.textContent = player.kills;

      entry.appendChild(rankDiv);
      entry.appendChild(playerInfo);
      entry.appendChild(killsDiv);

      leaderboardContent.appendChild(entry);
    });
  } catch (error) {
    console.error("Error updating leaderboard:", error);
  }
}

function resetLeaderboard() {
  if (leaderboardContent) {
    leaderboardContent.innerHTML = `
      <div class="leaderboard-placeholder">
        <div class="placeholder-icon">🎯</div>
        <p class="placeholder-text">No scores yet</p>
      </div>
    `;
  }
}

// Performance optimization: FPS limiting
let lastFrameTime = 0;
const TARGET_FPS = 60;
const FRAME_TIME = 1000 / TARGET_FPS;

function gameLoop(currentTime = 0) {
  try {
    // FPS limiting to reduce CPU usage
    const deltaTime = currentTime - lastFrameTime;
    
    if (deltaTime >= FRAME_TIME) {
      lastFrameTime = currentTime - (deltaTime % FRAME_TIME);
      
      if (gameStarted) {
        update();
        draw();
      }
    }
    
    requestAnimationFrame(gameLoop);
  } catch (error) {
    console.error("Error in game loop:", error);
    // Recovery mechanism with exponential backoff
    setTimeout(() => requestAnimationFrame(gameLoop), 100);
  }
}

showStartScreen();
updateAudioToggle();
loadAudioFiles();
gameLoop();

// Start menu music after a short delay (let page settle)
setTimeout(() => {
  audioManager.startMenuMusic();
}, 500);
