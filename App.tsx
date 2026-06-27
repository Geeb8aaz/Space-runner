import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import HeadTracker from './components/HeadTracker';
import RunnerGame from './components/RunnerGame';
import { GameState, HeadTrackingResult, TopScore } from './types';
import { soundService } from './services/soundService';
import { GeminiLiveService } from './services/geminiLiveService';

function formatTime(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  if (m > 0) return `${m}m ${s.toString().padStart(2, '0')}s`;
  return `${s}s`;
}

function App() {
  const [gameState, setGameState] = useState<GameState>(GameState.IDLE);
  const [score, setScore] = useState(0);
  const [elapsedTimeMs, setElapsedTimeMs] = useState(0);
  const [topScores, setTopScores] = useState<TopScore[]>([]);
  
  const startTimeRef = useRef(0);
  
  // Timer effect
  useEffect(() => {
    let interval: number;
    if (gameState === GameState.PLAYING) {
      startTimeRef.current = Date.now() - elapsedTimeMs;
      interval = window.setInterval(() => {
        setElapsedTimeMs(Date.now() - startTimeRef.current);
      }, 100);
    }
    return () => clearInterval(interval);
  }, [gameState]);
  
  // Optimization: Store head data in Ref to avoid re-rendering App 60 times/sec
  const headDataRef = useRef<HeadTrackingResult>({ x: 0.5, y: 0.5, tilt: 0, pitch: 0.5, isDetected: false });
  
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const geminiServiceRef = useRef(new GeminiLiveService());
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastFrameTimeRef = useRef(0);

  // Load High Score on mount
  useEffect(() => {
    const saved = localStorage.getItem('spaceRunnerTopScoresV2');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
            setTopScores(parsed);
        }
      } catch (e) {}
    } else {
        const oldScore = localStorage.getItem('spaceRunnerTopScores');
        if (oldScore) {
          try {
             const parsedOld = JSON.parse(oldScore);
             if (Array.isArray(parsedOld) && typeof parsedOld[0] === 'number') {
                 // Migrate old format [number, number, number]
                 setTopScores(parsedOld.filter((s: number) => s > 0).map((s: number) => ({ score: s, timeMs: 0 })));
             }
          } catch(e) {}
        }
    }
  }, []);

  // Update High Score on Game Over
  useEffect(() => {
    if (gameState === GameState.GAME_OVER && score > 0) {
      setTopScores(prev => {
        const newScores = [...prev, { score, timeMs: elapsedTimeMs }].sort((a, b) => b.score - a.score).slice(0, 3);
        localStorage.setItem('spaceRunnerTopScoresV2', JSON.stringify(newScores));
        return newScores;
      });
    }
  }, [gameState, score, elapsedTimeMs]);

  const handleStartGame = () => {
    soundService.resume();
    setScore(0);
    setElapsedTimeMs(0);
    setGameState(GameState.PLAYING);

    // Connect Gemini
    geminiServiceRef.current.connect({
        onOpen: () => {},
        onClose: () => {},
        onError: (err) => console.error("Gemini Error:", err)
    });
  };

  useEffect(() => {
    if (gameState === GameState.GAME_OVER || gameState === GameState.IDLE) {
        geminiServiceRef.current.disconnect();
    }
  }, [gameState]);

  const handleHeadTrack = useCallback((result: HeadTrackingResult) => {
    // 1. Update Game Loop Data (Instant)
    headDataRef.current = result;
  }, []);

  const handleVideoFrame = useCallback((video: HTMLVideoElement) => {
    if (gameState !== GameState.PLAYING) return;
    
    // Throttle video frames to Gemini (1 frame per second)
    const now = Date.now();
    if (now - lastFrameTimeRef.current < 1000) return;
    lastFrameTimeRef.current = now;

    if (!offscreenCanvasRef.current) {
        offscreenCanvasRef.current = document.createElement('canvas');
    }
    const canvas = offscreenCanvasRef.current;
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext('2d');
    if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const base64 = canvas.toDataURL('image/jpeg', 0.6).split(',')[1];
        geminiServiceRef.current.sendVideoFrame(base64);
    }
  }, [gameState]);

  return (
    <div className="relative w-screen h-screen bg-slate-950 overflow-hidden font-sans select-none text-slate-100">
      
      {/* Game Layer */}
      <div className="absolute inset-0 z-0">
        <RunnerGame 
          headDataRef={headDataRef}
          gameState={gameState}
          setGameState={setGameState}
          setScore={setScore}
          score={score}
          canvasRef={canvasRef}
        />
      </div>

      {/* Head Tracker */}
      <HeadTracker onTrack={handleHeadTrack} onVideoFrame={handleVideoFrame} />

      {/* UI Overlay */}
      <div className="absolute inset-0 z-10 pointer-events-none flex flex-col justify-between p-6">
        
        {/* Top Bar */}
        <motion.div 
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="flex justify-end pointer-events-auto w-full"
        >
          <div className="flex justify-end">
            <div className="glass-panel px-4 py-2 rounded-xl neo-cyan">
                <div className="text-[9px] text-cyan-400 font-bold tracking-[0.2em] uppercase mb-0.5">
                    Score
                </div>
                <div className="flex items-baseline gap-2">
                  <div className="text-2xl font-display font-black tracking-tight text-white">
                    {score.toString().padStart(6, '0')}
                  </div>
                  {gameState === GameState.PLAYING && (
                      <div className="text-xs text-cyan-400 font-mono">
                          {formatTime(elapsedTimeMs)}
                      </div>
                  )}
                </div>
            </div>
          </div>
        </motion.div>

        {/* Center Messages */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-auto">
          <AnimatePresence mode="wait">
            {gameState === GameState.IDLE && (
              <motion.div 
                key="idle"
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 1.1, opacity: 0 }}
                className="text-center glass-panel p-10 rounded-3xl max-w-lg mx-4"
              >
                <div className="w-16 h-16 bg-cyan-500/10 rounded-full flex items-center justify-center mx-auto mb-6 border border-cyan-500/20">
                  <div className="w-8 h-8 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
                </div>
                <h2 className="text-3xl font-display font-black text-white mb-2">Initialize Mission</h2>
                <p className="text-slate-400 text-sm mb-8">Prepare for deep space navigation via neural head-tracking interface.</p>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8 text-left">
                  <div className="p-4 rounded-xl bg-white/5 border border-white/5">
                    <div className="text-cyan-400 font-bold text-xs mb-1 uppercase tracking-wider">Navigation</div>
                    <div className="text-sm text-slate-300">Tilt head left/right to steer</div>
                  </div>
                  <div className="p-4 rounded-xl bg-white/5 border border-white/5">
                    <div className="text-cyan-400 font-bold text-xs mb-1 uppercase tracking-wider">Speed Control</div>
                    <div className="text-sm text-slate-300">Tilt forward to speed up, back to slow. Collecting stars increases base speed.</div>
                  </div>
                </div>

                {topScores.some(s => s.score > 0) && (
                  <div className="mb-8">
                    <div className="text-cyan-400 font-bold text-xs mb-2 uppercase tracking-wider">Top Scores</div>
                    <div className="flex flex-col gap-2 justify-center items-center">
                      {topScores.filter(s => s.score > 0).map((s, i) => (
                        <div key={i} className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 font-mono text-cyan-200 flex justify-between w-48">
                          <div>
                            <span className="text-slate-500 mr-2">#{i + 1}</span>
                            {s.score}
                          </div>
                          {s.timeMs > 0 && (
                             <div className="text-cyan-500 text-xs self-center">
                                {formatTime(s.timeMs)}
                             </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <button 
                  onClick={handleStartGame}
                  className="group relative w-full py-5 bg-cyan-500 text-slate-950 font-black text-lg rounded-2xl shadow-xl shadow-cyan-500/20 hover:bg-cyan-400 transition-all active:scale-[0.98] overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite]" />
                  LAUNCH SEQUENCE
                </button>
              </motion.div>
            )}

            {gameState === GameState.GAME_OVER && (
              <motion.div 
                key="gameover"
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 1.1, opacity: 0 }}
                className="text-center glass-panel p-10 rounded-3xl border-red-500/30 max-w-md mx-4"
              >
                <div className="text-5xl font-display font-black text-red-500 mb-4 tracking-tight">HULL BREACH</div>
                
                <div className="space-y-1 mb-6">
                  <p className="text-slate-400 text-sm uppercase tracking-widest">Final Telemetry</p>
                  <p className="text-5xl font-display font-black text-white">{score}</p>
                  <p className="text-cyan-400 font-mono">{formatTime(elapsedTimeMs)}</p>
                  {topScores.length > 0 && score >= topScores[0].score && score > 0 && (
                      <motion.p 
                        animate={{ opacity: [1, 0.5, 1] }}
                        transition={{ repeat: Infinity, duration: 1.5 }}
                        className="text-yellow-400 font-bold text-sm tracking-widest mt-2 uppercase"
                      >
                        New Sector Record
                      </motion.p>
                  )}
                </div>

                {topScores.some(s => s.score > 0) && (
                  <div className="mb-8">
                    <div className="text-slate-400 text-xs mb-2 uppercase tracking-widest">Top Scores</div>
                    <div className="flex flex-col gap-2 justify-center items-center">
                      {topScores.filter(s => s.score > 0).map((s, i) => (
                        <div key={i} className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 font-mono text-slate-300 flex justify-between w-48">
                          <div>
                            <span className="text-slate-500 mr-2">#{i + 1}</span>
                            {s.score}
                          </div>
                          {s.timeMs > 0 && (
                            <div className="text-slate-500 text-xs self-center">
                                {formatTime(s.timeMs)}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <button 
                  onClick={handleStartGame}
                  className="w-full py-4 bg-white text-slate-950 font-black rounded-2xl hover:bg-slate-200 transition-all active:scale-[0.98]"
                >
                  RE-LAUNCH MISSION
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Bottom Bar */}
        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="flex justify-between items-end text-[10px] text-slate-500 font-mono"
        >
        </motion.div>
      </div>

      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
}

export default App;
