// Audio System with Procedural Sound Generation
class AudioManager {
  constructor() {
    this.sounds = {};
    this.audioContext = null;
    this.masterVolume = 0.5;
    this.sfxVolume = 0.7;
    this.muted = false;

    this.initAudioContext();
    this.loadSettings();
    this.createProceduralSounds();
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
      menuClose: () => this.generateMenuClose()
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

  saveSettings() {
    const settings = {
      masterVolume: this.masterVolume,
      sfxVolume: this.sfxVolume,
      muted: this.muted,
    };
    localStorage.setItem("audioSettings", JSON.stringify(settings));
  }

  updateVolumes() {
    // No background music; SFX volumes are applied when generating sounds.
  }

  toggleMute() {
    this.muted = !this.muted;
    this.saveSettings();
    return this.muted;
  }
}

const audioManager = new AudioManager();

// UI Elements
const startScreen = document.getElementById("start-screen");
const audioSettings = document.getElementById("audio-settings");
const audioSettingsBtn = document.getElementById("audio-settings-btn");

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
audioSettingsBtn.addEventListener("click", () => {
  audioManager.playProceduralSound('buttonPress');
  audioManager.playProceduralSound('menuOpen');
  showAudioSettings();
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
});

applySettingsBtn.addEventListener("click", () => {
  audioManager.playProceduralSound('buttonPress');
  // Values are already set by sliders, just save them
  audioManager.masterVolume = masterVolumeSlider.value / 100;
  audioManager.sfxVolume = sfxVolumeSlider.value / 100;
  audioManager.muted = muteAllCheckbox.checked;
  audioManager.saveSettings();
  audioManager.updateVolumes();
  
  hideAudioSettings();
});

cancelSettingsBtn.addEventListener("click", () => {
  audioManager.playProceduralSound('buttonPress');
  audioManager.playProceduralSound('menuClose');
  
  // Restore original settings
  audioManager.loadSettings();
  audioManager.updateVolumes();
  
  hideAudioSettings();
});

function showAudioSettings() {
  if (audioSettings) audioSettings.style.display = "flex";
  if (startScreen) startScreen.style.display = "none";
  masterVolumeSlider.value = audioManager.masterVolume * 100;
  sfxVolumeSlider.value = audioManager.sfxVolume * 100;
  muteAllCheckbox.checked = audioManager.muted;
  masterValueSpan.textContent = `${Math.round(audioManager.masterVolume * 100)}%`;
  sfxValueSpan.textContent = `${Math.round(audioManager.sfxVolume * 100)}%`;
}

function hideAudioSettings() {
  if (audioSettings) audioSettings.style.display = "none";
  if (startScreen) startScreen.style.display = "block";
}

// Initialize the start screen
showStartScreen();

function showStartScreen() {
  if (startScreen) startScreen.style.display = "block";
  if (audioSettings) audioSettings.style.display = "none";
}
