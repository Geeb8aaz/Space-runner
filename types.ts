export enum GameState {
  IDLE = 'IDLE',
  PLAYING = 'PLAYING',
  GAME_OVER = 'GAME_OVER'
}

export interface TopScore {
  score: number;
  timeMs: number;
}

export interface Obstacle {
  id: number;
  x: number;
  y: number;
  type: 'planet' | 'asteroid' | 'star';
}

export interface HeadTrackingResult {
  x: number; // Normalized 0-1. 0.5 is center
  y: number;
  tilt: number; // Roll (left/right tilt)
  pitch: number; // Pitch (forward/back tilt)
  isDetected: boolean;
}