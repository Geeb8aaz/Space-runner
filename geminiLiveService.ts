import { decode, decodeAudioData } from './audioUtils';

interface LiveServiceCallbacks {
  onAudioData?: (buffer: AudioBuffer) => void;
  onError: (error: Error) => void;
  onClose: () => void;
  onOpen: () => void;
}

export class GeminiLiveService {
  private ws: WebSocket | null = null;
  private outputAudioContext: AudioContext;
  private nextStartTime = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private active = false;

  constructor() {
    this.outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
      sampleRate: 24000,
    });
  }

  public connect(callbacks: LiveServiceCallbacks) {
    if (this.active) return;
    this.active = true;
    this.nextStartTime = this.outputAudioContext.currentTime;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/live`;
    
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log("Bridge Connected");
      callbacks.onOpen();
    };

    this.ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        
        switch (msg.type) {
          case 'open':
            // Already handled by onopen mostly, but could be specific app logic
            break;
          case 'audio':
            if (msg.data) {
              const audioBuffer = await decodeAudioData(
                decode(msg.data),
                this.outputAudioContext,
                24000,
                1
              );
              this.playAudio(audioBuffer);
            }
            break;
          case 'interrupted':
            this.stopAudio();
            break;
          case 'close':
            this.active = false;
            callbacks.onClose();
            break;
          case 'error':
            console.error("Bridge error:", msg.message);
            callbacks.onError(new Error(msg.message));
            break;
        }
      } catch (e) {
        console.error("Error parsing bridge message", e);
      }
    };

    this.ws.onclose = () => {
      console.log("Bridge Closed");
      this.active = false;
      callbacks.onClose();
    };

    this.ws.onerror = (e) => {
      console.error("Bridge WebSocket error", e);
      callbacks.onError(new Error("WebSocket connection failed"));
    };
  }

  private playAudio(buffer: AudioBuffer) {
    if (!this.outputAudioContext) return;
    
    // Ensure we schedule smoothly
    this.nextStartTime = Math.max(this.nextStartTime, this.outputAudioContext.currentTime);
    
    const source = this.outputAudioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.outputAudioContext.destination);
    
    source.addEventListener('ended', () => {
      this.sources.delete(source);
    });
    
    source.start(this.nextStartTime);
    this.nextStartTime += buffer.duration;
    this.sources.add(source);
  }

  private stopAudio() {
    this.sources.forEach(s => {
      try { s.stop(); } catch(e){}
    });
    this.sources.clear();
    this.nextStartTime = this.outputAudioContext.currentTime;
  }

  public sendVideoFrame(base64Data: string) {
    if (!this.active || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'video', data: base64Data }));
  }

  public disconnect() {
    this.active = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.stopAudio();
  }
}
