import express from "express";
import path from "path";
import { WebSocketServer } from "ws";
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Initialize Gemini
  const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite Middleware or Static Files
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    // Use *all for Express 5 wildcard routing
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // WebSocket Server for Gemini Live Bridge
  const wss = new WebSocketServer({ server, path: '/api/live' });

  wss.on("connection", async (clientWs) => {
    console.log("Client connected to Live Bridge");

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("GEMINI_API_KEY is missing");
      clientWs.send(JSON.stringify({ type: 'error', message: "Gemini API key not configured on server" }));
      clientWs.close();
      return;
    }

    let session: any = null;

    try {
      session = await genAI.live.connect({
        model: "gemini-2.0-flash", // Standard model for Live capabilities
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
          },
          systemInstruction: "You are 'Blitz', an energetic space sports commentator. You are watching a runner game. Cheer the player, comment on their focus, and warn them of obstacles. Keep it short and high-energy!",
        },
        callbacks: {
          onopen: () => {
             console.log("Gemini session opened");
             clientWs.send(JSON.stringify({ type: 'open' }));
          },
          onmessage: (message: LiveServerMessage) => {
            const audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audio) {
              clientWs.send(JSON.stringify({ type: 'audio', data: audio }));
            }
            if (message.serverContent?.interrupted) {
              clientWs.send(JSON.stringify({ type: 'interrupted' }));
            }
          },
          onclose: () => {
            console.log("Gemini session closed");
            clientWs.send(JSON.stringify({ type: 'close' }));
            clientWs.close();
          },
          onerror: (err) => {
            console.error("Gemini session error", err);
            clientWs.send(JSON.stringify({ type: 'error', message: err.message }));
          }
        },
      });

      clientWs.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'video' && msg.data) {
            session.sendRealtimeInput({
              video: { data: msg.data, mimeType: "image/jpeg" }
            });
          }
        } catch (e) {
          console.error("Error processing client message", e);
        }
      });

      clientWs.on("close", () => {
        console.log("Client disconnected");
        if (session) {
          // session.close() is standard if available
          try { session.close(); } catch(e) {}
        }
      });

    } catch (err) {
      console.error("Failed to connect to Gemini Live", err);
      clientWs.send(JSON.stringify({ type: 'error', message: "Bridge connection failed" }));
      clientWs.close();
    }
  });
}

startServer();
