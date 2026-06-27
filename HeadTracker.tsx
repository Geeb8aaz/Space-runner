import React, { useEffect, useRef, useState, useCallback } from 'react';
import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';
import { HeadTrackingResult } from '../types';

interface HeadTrackerProps {
  onTrack: (result: HeadTrackingResult) => void;
  onVideoFrame?: (video: HTMLVideoElement) => void;
}

const HeadTracker: React.FC<HeadTrackerProps> = React.memo(({ onTrack, onVideoFrame }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string>('');
  const [loaded, setLoaded] = useState(false);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const requestRef = useRef<number>(0);
  const lastVideoTimeRef = useRef<number>(-1);
  const lastProcessTimeRef = useRef<number>(0); // Rate limiting
  const streamRef = useRef<MediaStream | null>(null);
  
  const onTrackRef = useRef(onTrack);
  const onVideoFrameRef = useRef(onVideoFrame);

  useEffect(() => {
    onTrackRef.current = onTrack;
    onVideoFrameRef.current = onVideoFrame;
  }, [onTrack, onVideoFrame]);

  // Initialize MediaPipe
  useEffect(() => {
    let isMounted = true;

    const setupMediaPipe = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
        );
        
        if (!isMounted) return;

        let landmarker;
        try {
          landmarker = await FaceLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
              delegate: "GPU"
            },
            outputFaceBlendshapes: true,
            runningMode: "VIDEO",
            numFaces: 1
          });
        } catch (gpuError) {
          console.warn("GPU init failed, falling back to CPU", gpuError);
          landmarker = await FaceLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
              delegate: "CPU"
            },
            outputFaceBlendshapes: true,
            runningMode: "VIDEO",
            numFaces: 1
          });
        }

        if (isMounted) {
          faceLandmarkerRef.current = landmarker;
          setLoaded(true);
        } else {
          landmarker.close();
        }
      } catch (e) {
        console.error(e);
        if (isMounted) setError('Failed to load AI models.');
      }
    };

    setupMediaPipe();

    return () => {
      isMounted = false;
      if (faceLandmarkerRef.current) {
        faceLandmarkerRef.current.close();
        faceLandmarkerRef.current = null;
      }
    };
  }, []);

  // Initialize Camera
  useEffect(() => {
    if (!loaded) return;
    
    let isMounted = true;

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { width: 640, height: 480, frameRate: 30 } 
        });
        
        if (!isMounted) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        streamRef.current = stream;
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadeddata = () => {
             if (videoRef.current) {
                 videoRef.current.play().catch(console.error);
                 predictWebcam();
             }
          };
        }
      } catch (e) {
        if (isMounted) setError('Camera access denied.');
      }
    };

    startCamera();

    return () => {
      isMounted = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const predictWebcam = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const landmarker = faceLandmarkerRef.current;

    if (!video || !landmarker || !canvas) {
        requestRef.current = requestAnimationFrame(predictWebcam);
        return;
    }

    const now = performance.now();
    
    // THROTTLE: Limit AI processing to ~15 FPS (every 70ms) to save CPU/GPU resources
    // The game loop runs at 60fps and interpolates position, so 15fps input is sufficient
    if (now - lastProcessTimeRef.current < 70) {
        requestRef.current = requestAnimationFrame(predictWebcam);
        return;
    }

    const ctx = canvas.getContext('2d', { alpha: true });

    if (video.videoWidth > 0 && video.videoHeight > 0 && video.currentTime !== lastVideoTimeRef.current) {
      lastVideoTimeRef.current = video.currentTime;
      lastProcessTimeRef.current = now;
      
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
      }

      try {
        const results = landmarker.detectForVideo(video, now);

        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (results.faceLandmarks && results.faceLandmarks.length > 0) {
            const landmarks = results.faceLandmarks[0];
            const nose = landmarks[1];
            const mirroredX = 1 - nose.x;
            
            const leftEye = landmarks[33];
            const rightEye = landmarks[263];
            const dx = rightEye.x - leftEye.x;
            const dy = rightEye.y - leftEye.y;
            const tilt = Math.atan2(dy, dx); 

            // Calculate pitch (forward/back tilt)
            const top = landmarks[10];
            const bottom = landmarks[152];
            const faceHeight = bottom.y - top.y;
            const pitch = faceHeight > 0 ? (nose.y - top.y) / faceHeight : 0.5;

            if (ctx) {
                ctx.save();
                ctx.scale(-1, 1); 
                ctx.translate(-canvas.width, 0);
                
                ctx.fillStyle = '#00ff00';
                ctx.beginPath();
                ctx.arc(nose.x * canvas.width, nose.y * canvas.height, 5, 0, 2 * Math.PI);
                ctx.fill();
                
                ctx.strokeStyle = '#00ffff';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(leftEye.x * canvas.width, leftEye.y * canvas.height);
                ctx.lineTo(rightEye.x * canvas.width, rightEye.y * canvas.height);
                ctx.stroke();
                
                ctx.restore();
            }

            onTrackRef.current({
                x: mirroredX,
                y: nose.y,
                tilt: tilt,
                pitch: pitch,
                isDetected: true
            });
        } else {
            onTrackRef.current({ x: 0.5, y: 0.5, tilt: 0, pitch: 0.5, isDetected: false });
        }
      } catch (err) {
         // Ignore errors
      }
      
      if (onVideoFrameRef.current) {
        onVideoFrameRef.current(video);
      }
    }

    requestRef.current = requestAnimationFrame(predictWebcam);
  };

  return (
    <div className="absolute top-6 left-6 z-50 overflow-hidden rounded-xl border-2 border-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.5)] bg-black/50 backdrop-blur-sm w-24 h-32 transition-all duration-300">
      <div className="relative w-full h-full">
          <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-cover transform scale-x-[-1]" 
            playsInline
            muted
          />
          <canvas 
            ref={canvasRef}
            className="absolute inset-0 w-full h-full object-cover"
          />
      </div>
      {!loaded && <div className="absolute inset-0 flex items-center justify-center text-xs text-cyan-300 bg-black/80">Loading AI...</div>}
      {error && <div className="absolute inset-0 flex items-center justify-center text-xs text-red-500 p-2 text-center bg-black/80">{error}</div>}
      <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-[10px] text-center text-white py-1">
        Head Controller
      </div>
    </div>
  );
});

export default HeadTracker;