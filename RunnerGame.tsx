import React, { useRef, useEffect } from 'react';
import { GameState, Obstacle, HeadTrackingResult } from '../types';
import { soundService } from '../services/soundService';

interface RunnerGameProps {
  headDataRef: React.MutableRefObject<HeadTrackingResult>; 
  gameState: GameState;
  setGameState: (state: GameState) => void;
  setScore: (score: number) => void;
  score: number;
  canvasRef: React.RefObject<HTMLCanvasElement>;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  size: number;
}

const PLAYER_SPEED = 0.15; // Adjusted for smooth joystick feel
const GAME_SPEED_INITIAL = 2.5; // Starts slow
const SPEED_INCREMENT_PER_STAR = 0.5; // Speed increases per star
const HEAD_SMOOTHING = 0.15; // Lower = smoother but slower to react

// Background star generation with depth
const generateStarfield = (count: number, width: number, height: number) => {
  return Array.from({ length: count }).map(() => ({
    x: Math.random() * width,
    y: Math.random() * height,
    size: Math.random() * 1.5 + 0.5,
    speedFactor: Math.random() * 0.8 + 0.2, // Parallax depth factor (0.2 = far, 1.0 = close)
    opacity: Math.random() * 0.5 + 0.3,
    twinkleSpeed: Math.random() * 0.05
  }));
};

// Nebula generation
const generateNebulas = (width: number, height: number) => {
    const colors = [
        'rgba(76, 29, 149, 0.15)', // Violet
        'rgba(30, 58, 138, 0.15)', // Dark Blue
        'rgba(190, 24, 93, 0.1)',  // Pink
        'rgba(15, 118, 110, 0.1)'  // Teal
    ];
    return Array.from({ length: 3 }).map(() => ({ // Reduced from 5 to 3
        x: Math.random() * width,
        y: Math.random() * height,
        radius: Math.random() * 300 + 200,
        color: colors[Math.floor(Math.random() * colors.length)],
        speedFactor: 0.1 // Nebulas are very far away
    }));
};

const RunnerGame: React.FC<RunnerGameProps> = React.memo(({ 
  headDataRef, 
  gameState, 
  setGameState,
  setScore,
  score,
  canvasRef
}) => {
  const playerXRef = useRef(0.5);
  const smoothedHeadXRef = useRef(0);
  const obstaclesRef = useRef<Obstacle[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const frameRef = useRef<number>(0);
  const speedRef = useRef(GAME_SPEED_INITIAL);
  const scoreRef = useRef(0);
  const starsCollectedRef = useRef(0);
  
  const bgStarsRef = useRef<any[]>([]);
  const bgNebulasRef = useRef<any[]>([]);
  
  const resetGame = () => {
    playerXRef.current = 0.5;
    obstaclesRef.current = [];
    particlesRef.current = [];
    speedRef.current = 2.5; // GAME_SPEED_INITIAL
    scoreRef.current = 0;
    starsCollectedRef.current = 0;
    setScore(0);
  };

  useEffect(() => {
    if (gameState === GameState.PLAYING) {
      resetGame();
      soundService.startAmbience();
    } else {
      soundService.stopAmbience();
    }
    
    return () => {
        soundService.stopAmbience();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState]);

  // Init background
  useEffect(() => {
     // Performance optimization: Reduced star count from 150 to 70
     bgStarsRef.current = generateStarfield(70, window.innerWidth, window.innerHeight);
     bgNebulasRef.current = generateNebulas(window.innerWidth, window.innerHeight);
  }, []);

  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        bgStarsRef.current = generateStarfield(70, window.innerWidth, window.innerHeight);
        bgNebulasRef.current = generateNebulas(window.innerWidth, window.innerHeight);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [canvasRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false }); 
    if (!ctx) return;

    const spawnObstacle = () => {
      // Obstacles spawn randomly across the screen width (10% to 90% to avoid edges)
      const x = 0.1 + Math.random() * 0.8;
      // Type is visual style
      const type = Math.random() > 0.8 ? 'star' : (Math.random() > 0.5 ? 'planet' : 'asteroid');
      
      obstaclesRef.current.push({
        id: Date.now() + Math.random(),
        x: x,
        y: -100, 
        type: type as any
      });
    };

    const spawnParticles = (x: number, y: number, color: string) => {
        // Reduced particle count for performance (15 -> 8)
        for(let k=0; k<8; k++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 8 + 2;
            particlesRef.current.push({
                x: x,
                y: y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed + speedRef.current, // Add forward momentum
                life: 1.0,
                color: color,
                size: Math.random() * 4 + 2
            });
        }
    };

    const update = () => {
      if (gameState !== GameState.PLAYING) {
          render(ctx, canvas.width, canvas.height);
          frameRef.current = requestAnimationFrame(update);
          return;
      }

      const { tilt, y, isDetected } = headDataRef.current;
      
      if (isDetected) {
          // Smooth the tilt for less jitter
          smoothedHeadXRef.current = smoothedHeadXRef.current + (tilt - smoothedHeadXRef.current) * HEAD_SMOOTHING;
      }

      // Smooth Joystick Logic
      let targetX = 0.5;
      if (isDetected) {
        // Map head tilt (-0.5 to 0.5 approx) to screen X (0.1 to 0.9)
        // User said: "tilt left goes left, tilt right goes right" 
        // Previously we found that smoothedHeadXRef > 0 meant right tilt?
        // Let's use subtraction to map tilt to X. 
        // If it's reversed for them, we can adjust the multiplier sign.
        // Let's assume tilting right = negative tilt based on previous inverted fix.
        targetX = 0.5 - (smoothedHeadXRef.current * 2.5); // Increased multiplier for more sensitivity
        // Clamp to screen edges
        targetX = Math.max(0.05, Math.min(0.95, targetX));
      }

      // Move player smoothly towards target
      const diff = targetX - playerXRef.current;
      playerXRef.current += diff * 0.2; // Increased from 0.15 for slightly tighter joystick feel

      // Spawn rate based on speed
      if (Math.random() < 0.02 + (speedRef.current * 0.002)) { 
        spawnObstacle();
      }

      // Speed increase based on stars collected
      let targetSpeed = GAME_SPEED_INITIAL + (starsCollectedRef.current * SPEED_INCREMENT_PER_STAR);
      
      if (isDetected) {
          // Speed control based on nose y position (forward/back tilt)
          // y > 0.55 (looking down/forward) -> increase speed
          // y < 0.45 (looking up/back) -> decrease speed
          if (y > 0.55) {
              const boost = Math.min((y - 0.55) * 40, 20); // Max boost of 20
              targetSpeed += boost;
          } else if (y < 0.45) {
              const reduction = Math.min((0.45 - y) * 30, targetSpeed * 0.7); // Max reduction of 70%
              targetSpeed -= reduction;
          }
      }
      
      // Smoothly transition speed
      speedRef.current += (targetSpeed - speedRef.current) * 0.1;
      
      // Update Particles
      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const p = particlesRef.current[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.05; // Faster fade out to reduce active count
        if (p.life <= 0) {
            particlesRef.current.splice(i, 1);
        }
      }

      // Update Obstacles
      for (let i = obstaclesRef.current.length - 1; i >= 0; i--) {
        const obs = obstaclesRef.current[i];
        obs.y += speedRef.current;

        const playerScreenX = playerXRef.current * canvas.width;
        const playerScreenY = canvas.height - 100;
        const obsScreenX = obs.x * canvas.width;
        const obsScreenY = obs.y;

        const distY = Math.abs(playerScreenY - obsScreenY);
        const distX = Math.abs(playerScreenX - obsScreenX);

        if (distY < 45 && distX < 40) { // Reduced hitbox
          if (obs.type === 'star') {
             soundService.playCollect();
             scoreRef.current += 100;
             starsCollectedRef.current += 1; // Increase star count
             setScore(scoreRef.current);
             spawnParticles(obsScreenX, obsScreenY, '#fbbf24');
             obstaclesRef.current.splice(i, 1);
          } else {
             soundService.playCrash();
             setGameState(GameState.GAME_OVER);
          }
        }

        if (obs.y > canvas.height + 100) {
          if (obs.type !== 'star') {
              scoreRef.current += 10;
              setScore(scoreRef.current);
          }
          obstaclesRef.current.splice(i, 1);
        }
      }
      
      render(ctx, canvas.width, canvas.height);
      frameRef.current = requestAnimationFrame(update);
    };

    const drawStarShape = (ctx: CanvasRenderingContext2D, cx: number, cy: number, spikes: number, outerRadius: number, innerRadius: number) => {
        let rot = Math.PI / 2 * 3;
        let x = cx;
        let y = cy;
        let step = Math.PI / spikes;

        ctx.beginPath();
        ctx.moveTo(cx, cy - outerRadius);
        for (let i = 0; i < spikes; i++) {
            x = cx + Math.cos(rot) * outerRadius;
            y = cy + Math.sin(rot) * outerRadius;
            ctx.lineTo(x, y);
            rot += step;

            x = cx + Math.cos(rot) * innerRadius;
            y = cy + Math.sin(rot) * innerRadius;
            ctx.lineTo(x, y);
            rot += step;
        }
        ctx.lineTo(cx, cy - outerRadius);
        ctx.closePath();
        ctx.fill();
    };

    const render = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      // 1. Deep Space Base
      // Optimization: Replaced gradient clear with solid color to save fill-rate on large screens
      ctx.fillStyle = '#020617'; // Slate 950
      ctx.fillRect(0, 0, width, height);

      // 2. Nebulas (Atmosphere)
      bgNebulasRef.current.forEach(neb => {
        if (gameState === GameState.PLAYING) {
            neb.y += speedRef.current * neb.speedFactor;
            if (neb.y - neb.radius > height) neb.y = -neb.radius;
        }
        
        const g = ctx.createRadialGradient(neb.x, neb.y, 0, neb.x, neb.y, neb.radius);
        g.addColorStop(0, neb.color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        // Optimization: Removed blend mode if possible, but keeping for visual quality
        // on fewer objects (3 nebulas).
        ctx.globalCompositeOperation = 'screen'; 
        ctx.beginPath();
        ctx.arc(neb.x, neb.y, neb.radius, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalCompositeOperation = 'source-over'; // Reset blend mode

      // 3. Stars (Parallax)
      bgStarsRef.current.forEach(star => {
        // Move stars
        if (gameState === GameState.PLAYING) {
            star.y += speedRef.current * star.speedFactor;
            if (star.y > height) star.y = 0;
        }
        
        // Twinkle effect
        const opacity = star.opacity + Math.sin(Date.now() * star.twinkleSpeed) * 0.2;
        
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = Math.max(0.1, Math.min(1, opacity));
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1.0;

      // Obstacles
      obstaclesRef.current.forEach(obs => {
        const x = obs.x * width;
        const y = obs.y;
        
        ctx.save();
        ctx.translate(x, y);
        
        if (obs.type === 'star') {
          // Collectible Star
          ctx.fillStyle = '#fbbf24'; // Amber-400
          ctx.shadowColor = '#f59e0b';
          ctx.shadowBlur = 20;
          drawStarShape(ctx, 0, 0, 5, 25, 12);
        } else if (obs.type === 'asteroid') {
           // Asteroid (Rock)
           ctx.fillStyle = '#475569'; // Slate-600
           ctx.shadowColor = '#000';
           ctx.shadowBlur = 10;
           
           ctx.beginPath();
           // Irregular shape
           ctx.moveTo(-20, -25);
           ctx.lineTo(15, -20);
           ctx.lineTo(25, 10);
           ctx.lineTo(10, 25);
           ctx.lineTo(-15, 20);
           ctx.lineTo(-25, 0);
           ctx.fill();
           
           // Craters
           ctx.fillStyle = '#334155';
           ctx.beginPath(); ctx.arc(-5, -5, 6, 0, Math.PI*2); ctx.fill();
           ctx.beginPath(); ctx.arc(10, 10, 4, 0, Math.PI*2); ctx.fill();

        } else { 
           // Planet (was Crate)
           // Draw Planet Body
           const planetGrad = ctx.createRadialGradient(-10, -10, 5, 0, 0, 30);
           planetGrad.addColorStop(0, '#60a5fa'); // Blue light
           planetGrad.addColorStop(1, '#1d4ed8'); // Blue dark
           ctx.fillStyle = planetGrad;
           ctx.beginPath();
           ctx.arc(0, 0, 30, 0, Math.PI * 2);
           ctx.fill();

           // Ring
           ctx.strokeStyle = '#93c5fd'; // Light blue ring
           ctx.lineWidth = 4;
           ctx.beginPath();
           ctx.ellipse(0, 0, 45, 10, -Math.PI / 6, 0, Math.PI * 2);
           ctx.stroke();
        }
        ctx.restore();
      });

      // Particles
      particlesRef.current.forEach(p => {
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1.0;

      // Player (Space Shuttle)
      const px = playerXRef.current * width;
      const py = height - 100;
      
      ctx.save();
      ctx.translate(px, py);
      
      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.ellipse(0, 50, 40, 15, 0, 0, Math.PI * 2);
      ctx.fill();

      // Tilt
      // Make the ship bank smoothly based on head tilt
      // SmoothedHeadXRef represents head tilt (roughly -0.5 to 0.5)
      // We invert it just like the steering so it banks into the turn
      const tiltAngle = -smoothedHeadXRef.current * 0.8; 
      ctx.rotate(tiltAngle);
      ctx.scale(0.6, 0.6); // Reduced scale

      // Shuttle Body
      ctx.fillStyle = '#e2e8f0'; 
      ctx.beginPath();
      ctx.moveTo(0, -60); 
      ctx.quadraticCurveTo(20, -40, 20, 30); 
      ctx.lineTo(15, 50); 
      ctx.lineTo(-15, 50); 
      ctx.lineTo(-20, 30); 
      ctx.quadraticCurveTo(-20, -40, 0, -60); 
      ctx.fill();

      // Wings
      ctx.fillStyle = '#cbd5e1'; 
      ctx.beginPath(); ctx.moveTo(15, -10); ctx.lineTo(50, 40); ctx.lineTo(15, 40); ctx.fill(); 
      ctx.beginPath(); ctx.moveTo(-15, -10); ctx.lineTo(-50, 40); ctx.lineTo(-15, 40); ctx.fill(); 

      // Tail
      ctx.fillStyle = '#94a3b8'; 
      ctx.beginPath(); ctx.moveTo(0, 10); ctx.lineTo(5, 45); ctx.lineTo(-5, 45); ctx.fill();

      // Cockpit
      ctx.fillStyle = '#0ea5e9'; 
      ctx.beginPath();
      ctx.moveTo(0, -45);
      ctx.quadraticCurveTo(8, -40, 8, -35);
      ctx.lineTo(6, -25);
      ctx.lineTo(-6, -25);
      ctx.lineTo(-8, -35);
      ctx.quadraticCurveTo(-8, -40, 0, -45);
      ctx.fill();

      // Flames
      const flameHeight = 20 + Math.random() * 15 + (speedRef.current * 2); // Flames grow with speed
      ctx.fillStyle = '#f59e0b'; 
      ctx.beginPath(); ctx.moveTo(-12, 50); ctx.lineTo(0, 50 + flameHeight); ctx.lineTo(12, 50); ctx.fill();
      ctx.fillStyle = '#ef4444'; 
      ctx.beginPath(); ctx.moveTo(-6, 50); ctx.lineTo(0, 50 + flameHeight * 0.6); ctx.lineTo(6, 50); ctx.fill();

      ctx.restore();
    };

    frameRef.current = requestAnimationFrame(update);

    return () => {
      cancelAnimationFrame(frameRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState]); 

  return (
    <canvas 
      ref={canvasRef}
      className="block w-full h-full object-cover"
      width={window.innerWidth}
      height={window.innerHeight}
    />
  );
});

export default RunnerGame;