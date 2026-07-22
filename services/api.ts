// TripSync API Service Layer — FastAPI backend with free AI provider chain (Gemini → Groq → OpenRouter → HuggingFace)
import { Platform } from "react-native";
import Constants from "expo-constants";

const getApiBaseUrl = () => {
  const envUrl = process.env.EXPO_PUBLIC_API_URL || "https://tripsync-backend-ra7p.onrender.com";
  const cleaned = envUrl.replace(/\/+$/, "");
  return cleaned.endsWith("/api") ? cleaned : `${cleaned}/api`;
};

const API_BASE_URL = getApiBaseUrl();

export interface SafetyMetrics {
  generalSafety: number;
  nightSafety: number;
  trafficIndex: string;
  weatherHazard: string;
  gems: { name: string; desc: string }[];
  recommendations?: string;
  city?: string;
}

export interface RouteSpot {
  name: string;
  latitude: number;
  longitude: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export const travelApiService = {
  /**
   * AI Chatbot Assistant — POST /api/chat
   * Uses free AI provider chain: Gemini → Groq → OpenRouter → local fallback
   * Sends full conversation history for context-aware multi-turn replies.
   */
  async askChatbot(message: string, history: ChatMessage[] = []): Promise<string> {
    try {
      const response = await fetch(`${API_BASE_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          history: history.map((h) => ({ role: h.role, content: h.content })),
        }),
      });
      if (!response.ok) throw new Error(`Backend HTTP ${response.status}`);
      const data = await response.json();
      return data.reply;
    } catch {
      // Local fallback — never crashes
      const q = message.toLowerCase();
      if (q.includes("goa") || q.includes("beach"))
        return "🏖️ Goa is a paradise for beach lovers! Best months: Nov–Feb. Ask me about safety scores or hidden gems!";
      if (q.includes("manali"))
        return "🏔️ Manali is perfect for snow adventures. Best time: Dec–Feb for skiing, Jun–Aug for trekking!";
      return `🤖 TripSync AI: Got your message about "${message}". Start the backend for full AI-powered responses!`;
    }
  },

  /**
   * AI Travel Safety & Crowd Assessment — GET /api/safety?city=X
   * Powered by Gemini + Open-Meteo live weather data.
   * Returns safety scores, traffic index, hidden gems, travel recommendations.
   */
  async getCitySafety(city: string): Promise<SafetyMetrics> {
    try {
      const response = await fetch(
        `${API_BASE_URL}/safety?city=${encodeURIComponent(city)}`
      );
      if (!response.ok) throw new Error(`Backend HTTP ${response.status}`);
      return await response.json();
    } catch {
      const hash = city.length % 3;
      return {
        city,
        generalSafety: Number((8.2 + hash * 0.5).toFixed(1)),
        nightSafety: Number((7.8 + hash * 0.4).toFixed(1)),
        trafficIndex:
          hash === 0 ? "Mild Delays" : hash === 1 ? "Moderate Traffic" : "Heavy Transit",
        weatherHazard: hash === 2 ? "Moderate (Windy)" : "Low Risk",
        gems: [
          {
            name: "Scenic Sunrise Cliff",
            desc: "A quiet, spectacular valley view ideal for morning meditation",
          },
          {
            name: "Old Heritage Alleyway",
            desc: "19th century vintage buildings away from standard tourist maps",
          },
          {
            name: "Cozy Riverbank Brews",
            desc: "Local organic tea/coffee shop with relaxing wooden swing decks",
          },
        ],
        recommendations: `${city} is generally safe for travelers. Maintain standard vigilance and enjoy your trip!`,
      };
    }
  },

  /**
   * Route Path Optimization (TSP nearest-neighbor) — POST /api/routes/optimize
   * Falls back to client-side greedy solver if backend is unreachable.
   */
  async optimizeTravelRoute(spots: RouteSpot[]): Promise<RouteSpot[]> {
    if (spots.length <= 2) return spots;
    try {
      const response = await fetch(`${API_BASE_URL}/routes/optimize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(spots),
      });
      if (!response.ok) throw new Error("FastAPI HTTP status error");
      return await response.json();
    } catch (backendErr) {
      console.log(
        "FastAPI routing optimization offline, falling back to local greedy solver:",
        backendErr
      );
      try {
        const optimized: RouteSpot[] = [spots[0]];
        const unvisited = [...spots.slice(1)];
        while (unvisited.length > 0) {
          const last = optimized[optimized.length - 1];
          let nearestIdx = 0;
          let minDist = Infinity;
          for (let i = 0; i < unvisited.length; i++) {
            const u = unvisited[i];
            const dist =
              Math.pow(u.latitude - last.latitude, 2) +
              Math.pow(u.longitude - last.longitude, 2);
            if (dist < minDist) {
              minDist = dist;
              nearestIdx = i;
            }
          }
          optimized.push(unvisited.splice(nearestIdx, 1)[0]);
        }
        return optimized;
      } catch {
        return spots;
      }
    }
  },

  /**
   * Live weather — Open-Meteo (free, no key required)
   */
  async fetchLiveWeather(lat: number, lon: number): Promise<any> {
    try {
      const wRes = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`
      );
      const wData = await wRes.json();
      return wData.current_weather;
    } catch (e) {
      console.log("Weather API fetch error:", e);
      return null;
    }
  },

  /**
   * OSRM driving route polyline fetcher
   */
  async fetchOSRMRouteCoords(
    spots: { latitude: number; longitude: number }[]
  ): Promise<{ latitude: number; longitude: number }[]> {
    if (spots.length < 2) return [];
    try {
      const coordsString = spots.map((s) => `${s.longitude},${s.latitude}`).join(";");
      const res = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${coordsString}?overview=full&geometries=geojson`
      );
      const data = await res.json();
      if (data.routes && data.routes.length > 0) {
        return data.routes[0].geometry.coordinates.map((c: any) => ({
          latitude: c[1],
          longitude: c[0],
        }));
      }
      throw new Error("No route coordinates from OSRM");
    } catch (e) {
      console.log("OSRM routing helper error, fallback to direct polylines:", e);
      return spots.map((s) => ({ latitude: s.latitude, longitude: s.longitude }));
    }
  },

  /**
   * AI Voice Briefing — POST /api/briefing
   * Generates a natural spoken travel summary using Gemini/Groq.
   * Falls back to a local template if the backend is unreachable.
   */
  async fetchVoiceBriefing(data: {
    userName: string;
    activeTripName?: string;
    activeTripDestination?: string;
    todayScheduleTitle?: string;
    todayScheduleSpots?: string[];
    upcomingTripName?: string;
    upcomingTripDestination?: string;
    upcomingTripDays?: number;
    groupName?: string;
    groupExpensesCount?: number;
    groupMembersCount?: number;
    groupLastExpenseAmount?: number;
    groupLastExpenseDesc?: string;
    weatherTemp?: number;
    weatherDesc?: string;
  }): Promise<string> {
    try {
      const response = await fetch(`${API_BASE_URL}/briefing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Backend briefing error");
      const res = await response.json();
      return res.briefing;
    } catch (e) {
      console.log("Briefing API error, running local fallback:", e);
      const greeting = new Date().getHours() < 12 ? "Good Morning" : "Hello";
      const parts = [`${greeting} ${data.userName}.`];
      if (data.activeTripName && data.activeTripDestination) {
        parts.push(
          `Today you have your ${data.activeTripName} in ${data.activeTripDestination} active.`
        );
        if (data.todayScheduleTitle) {
          parts.push(`Your schedule is ${data.todayScheduleTitle}.`);
        }
        if (data.todayScheduleSpots && data.todayScheduleSpots.length > 0) {
          parts.push(
            `Your first stop is ${data.todayScheduleSpots[0]}. Traffic nearby is currently moderate.`
          );
        }
      } else if (data.upcomingTripName && data.upcomingTripDestination) {
        parts.push(
          `You don't have an active trip today, but your upcoming trip ${data.upcomingTripName} to ${data.upcomingTripDestination} starts in ${data.upcomingTripDays} days.`
        );
      } else {
        parts.push("You don't have any active or upcoming trips scheduled right now.");
      }
      if (data.weatherTemp !== undefined) {
        parts.push(
          `Weather is ${data.weatherDesc || "clear sky"} with ${Math.round(data.weatherTemp)} degrees.`
        );
      }
      if (data.groupName && data.groupExpensesCount && data.groupExpensesCount > 0) {
        parts.push(
          `Your group ${data.groupName} has updates, with ${data.groupExpensesCount} expenses added today.`
        );
      }
      return parts.join(" ");
    }
  },

  /**
   * Voice Transcription — POST /api/voice/transcribe
   * Uploads a recorded audio file and returns transcribed text.
   * Provider chain: Groq Whisper → HuggingFace Whisper → "" fallback
   */
  async transcribeAudio(
    fileUri: string,
    mimeType: string = "audio/m4a",
    filename: string = "recording.m4a"
  ): Promise<string> {
    try {
      const formData = new FormData();
      formData.append("file", {
        uri: fileUri,
        type: mimeType,
        name: filename,
      } as any);

      const response = await fetch(`${API_BASE_URL}/voice/transcribe`, {
        method: "POST",
        body: formData,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`Transcription HTTP ${response.status}`);
      const data = await response.json();
      return data.text || "";
    } catch (e) {
      console.log("Voice transcription API error:", e);
      return "";
    }
  },
};
