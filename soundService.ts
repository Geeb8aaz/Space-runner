export class SoundService {
  private ctx: AudioContext | null = null;
  private droneOsc: OscillatorNode | null = null;
  private droneGain: GainNode | null = null;

  constructor() {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContext) {
      this.ctx = new AudioContext();
    }
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(console.error);
    }
  }

  playCollect() {
    if (!this.ctx) return;
    
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    // High pitch "ding"
    osc.frequency.setValueAtTime(880, t); 
    osc.frequency.exponentialRampToValueAtTime(1760, t + 0.1);

    gain.gain.setValueAtTime(0.1, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.5);
  }

  playCrash() {
    if (!this.ctx) return;
    
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(30, t + 0.4);

    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.4);
  }

  startAmbience() {
    if (!this.ctx) return;
    this.stopAmbience(); 

    const t = this.ctx.currentTime;
    this.droneOsc = this.ctx.createOscillator();
    this.droneGain = this.ctx.createGain();

    // Space Drone: Low frequency triangle wave
    this.droneOsc.type = 'triangle';
    this.droneOsc.frequency.setValueAtTime(55, t); // Low rumble

    // LFO to modulate the drone slightly for a "throbbing" engine effect
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 4; // 4 Hz wobble
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 10; 
    lfo.connect(lfoGain);
    lfoGain.connect(this.droneOsc.frequency);
    lfo.start(t);

    this.droneGain.gain.setValueAtTime(0, t);
    this.droneGain.gain.linearRampToValueAtTime(0.05, t + 1);

    this.droneOsc.connect(this.droneGain);
    this.droneGain.connect(this.ctx.destination);
    
    this.droneOsc.start(t);
  }

  stopAmbience() {
    if (this.droneOsc && this.droneGain && this.ctx) {
      const t = this.ctx.currentTime;
      // Fade out
      this.droneGain.gain.cancelScheduledValues(t);
      this.droneGain.gain.setValueAtTime(this.droneGain.gain.value, t);
      this.droneGain.gain.linearRampToValueAtTime(0, t + 0.5);
      
      this.droneOsc.stop(t + 0.5);
      
      this.droneOsc = null;
      this.droneGain = null;
    }
  }
}

export const soundService = new SoundService();
