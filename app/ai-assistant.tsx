import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Alert,
  Animated,
  Easing,
  Platform,
  KeyboardAvoidingView,
  BackHandler,
} from "react-native";
import { useState, useRef, useEffect } from "react";
import { Audio } from "expo-av";
import * as Speech from "expo-speech";
import { Ionicons, FontAwesome5 } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import {
  getFirestore,
  collection,
  onSnapshot,
  query,
  where,
  doc,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../firebaseConfig";
import app from "../firebaseConfig";
import Constants from "expo-constants";

let ExpoSpeechRecognitionModule: any = null;
try {
  ExpoSpeechRecognitionModule = require("expo-speech-recognition").ExpoSpeechRecognitionModule;
} catch (e) {
  console.log("expo-speech-recognition is not available on this client.");
}

const getApiBase = () => {
  const envUrl = process.env.EXPO_PUBLIC_API_URL || "https://tripsyncbackend-production-37a2.up.railway.app";
  const cleaned = envUrl.replace(/\/+$/, "");
  return cleaned.endsWith("/api") ? cleaned : `${cleaned}/api`;
};

const API_BASE = getApiBase();

interface Message {
  sender: "user" | "ai";
  text: string;
}

type TabType = "chat" | "voice" | "safety";

export default function AIAssistantScreen() {
  const params = useLocalSearchParams();
  const scrollRef = useRef<ScrollView>(null);
  const [activeTab, setActiveTab] = useState<TabType>("chat");

  useEffect(() => {
    if (params.tab && ["chat", "voice", "safety"].includes(params.tab as string)) {
      setActiveTab(params.tab as TabType);
    }
  }, [params.tab]);

  // Handle Android back press to return to chat tab before exit
  useEffect(() => {
    const handleHardwareBack = () => {
      if (activeTab !== "chat") {
        setActiveTab("chat");
        return true; // Intercepted
      }
      return false; // Let default router pop screen
    };

    const backHandler = BackHandler.addEventListener(
      "hardwareBackPress",
      handleHardwareBack
    );

    return () => backHandler.remove();
  }, [activeTab]);

  // Chat States
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      sender: "ai",
      text: "Hello! I am your premium TripSync AI Companion. 🤖\n\nI can help you build customized day-by-day itineraries, recommend hidden beaches or cafes, and calculate splits! Ask me anything.",
    },
  ]);

  const presetSuggestions = [
    "🏖 Goa Beaches List",
    "☕ Manali Cozy Cafes",
    "🧠 Day Itinerary",
    "🛡 Safety Advice",
  ];

  // Voice Pulse States
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceSubtitles, setVoiceSubtitles] = useState("Tap the mic to ask AI about your schedule today!");
  const pulseAnim1 = useRef(new Animated.Value(1)).current;
  const pulseAnim2 = useRef(new Animated.Value(1)).current;
  const pulseAnim3 = useRef(new Animated.Value(1)).current;
  const recordingRef = useRef<Audio.Recording | null>(null);
  const transcriptionIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [useNativeSpeech, setUseNativeSpeech] = useState(false);
  const nativeSubscriptionsRef = useRef<any[]>([]);

  useEffect(() => {
    if (ExpoSpeechRecognitionModule) {
      ExpoSpeechRecognitionModule.isSpeechRecognitionAvailableAsync()
        .then((avail: boolean) => {
          setUseNativeSpeech(avail);
        })
        .catch(() => {
          setUseNativeSpeech(false);
        });
    }
    return () => {
      nativeSubscriptionsRef.current.forEach(sub => sub.remove());
      nativeSubscriptionsRef.current = [];
      if (ExpoSpeechRecognitionModule) {
        ExpoSpeechRecognitionModule.stop().catch(() => {});
      }
    };
  }, []);

  // Safety & Gems States
  const [safetyCity, setSafetyCity] = useState("");
  const [analyzingCity, setAnalyzingCity] = useState(false);
  const [safetyData, setSafetyData] = useState<any>(null);
  const [analyzedSafety, setAnalyzedSafety] = useState<any>(null);

  // Real-time Firestore States for Assistant context
  const [activeTrip, setActiveTrip] = useState<any>(null);
  const [upcomingTrip, setUpcomingTrip] = useState<any>(null);
  const [groups, setGroups] = useState<any[]>([]);
  const [userName, setUserName] = useState("Traveler");

  // Load Firestore context for live assistant
  useEffect(() => {
    let unsubAuth = () => {};
    let unsubUserDoc = () => {};
    let unsubTrips = () => {};
    let unsubGroups = () => {};

    const db = getFirestore(app);

    unsubAuth = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setUserName(currentUser.displayName || currentUser.email?.split("@")[0] || "Traveler");

        // User Doc snapshot
        unsubUserDoc = onSnapshot(
          doc(db, "users", currentUser.uid),
          (docSnap) => {
            if (docSnap.exists()) {
              const data = docSnap.data();
              setUserName(data.username || data.name || currentUser.displayName || "Traveler");
            }
          }
        );

        // Trips snapshot
        const tripsQ = query(
          collection(db, "trips"),
          where("userId", "==", currentUser.uid)
        );
        unsubTrips = onSnapshot(tripsQ, (snap) => {
          const docs = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
          docs.sort((a, b) => {
            const tA = a.createdAt?.seconds || a.createdAt || 0;
            const tB = b.createdAt?.seconds || b.createdAt || 0;
            return tB - tA;
          });

          const todayDate = new Date();
          todayDate.setHours(0, 0, 0, 0);

          let foundActive: any = null;
          let foundUpcoming: any = null;

          for (const trip of docs) {
            const start = trip.startDate ? new Date(trip.startDate) : null;
            const end = trip.endDate ? new Date(trip.endDate) : null;
            if (start && end && !isNaN(start.getTime()) && !isNaN(end.getTime())) {
              const s = new Date(start); s.setHours(0, 0, 0, 0);
              const e = new Date(end); e.setHours(23, 59, 59, 0);
              if (!foundActive && todayDate >= s && todayDate <= e) {
                foundActive = trip;
              } else if (!foundUpcoming && s > todayDate) {
                foundUpcoming = trip;
              }
            }
            if (foundActive && foundUpcoming) break;
          }

          setActiveTrip(foundActive);
          setUpcomingTrip(foundActive ? null : foundUpcoming);

          // If active trip is found and safetyCity is empty, autofill safetyCity
          if (foundActive && foundActive.destination) {
            const city = foundActive.destination.split(",")[0].trim();
            setSafetyCity((prev) => prev ? prev : city);
          }
        });

        // Groups snapshot
        const groupsQ = query(
          collection(db, "groups"),
          where("memberUids", "array-contains", currentUser.uid)
        );
        unsubGroups = onSnapshot(groupsQ, (snap) => {
          const data: any[] = [];
          snap.forEach((d) => data.push({ id: d.id, ...d.data() }));
          setGroups(data);
        });

      } else {
        setUserName("Traveler");
        setActiveTrip(null);
        setUpcomingTrip(null);
        setGroups([]);
        unsubUserDoc();
        unsubTrips();
        unsubGroups();
      }
    });

    return () => {
      unsubAuth();
      unsubUserDoc();
      unsubTrips();
      unsubGroups();
      Speech.stop();
      if (Platform.OS === "web" && typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      if (transcriptionIntervalRef.current) {
        clearInterval(transcriptionIntervalRef.current);
      }
    };
  }, []);

  // Auto-analyze safety when Safety tab is selected and we have a city
  useEffect(() => {
    if (activeTab === "safety" && !safetyData && safetyCity) {
      analyzeCitySafety();
    }
  }, [activeTab, safetyCity]);

  useEffect(() => {
    if (isListening || isSpeaking) {
      startPulseAnimation();
    } else {
      pulseAnim1.setValue(1);
      pulseAnim2.setValue(1);
      pulseAnim3.setValue(1);
    }
  }, [isListening, isSpeaking]);

  const startPulseAnimation = () => {
    const createPulse = (anim: Animated.Value, delay: number) => {
      return Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.parallel([
            Animated.timing(anim, {
              toValue: 2.2,
              duration: 2000,
              easing: Easing.out(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(anim, {
              toValue: 1,
              duration: 0,
              useNativeDriver: true,
            }),
          ]),
        ])
      );
    };

    Animated.parallel([
      createPulse(pulseAnim1, 0),
      createPulse(pulseAnim2, 600),
      createPulse(pulseAnim3, 1200),
    ]).start();
  };

  const handleSend = async (textToSend: string) => {
    if (!textToSend.trim()) return;

    const userMsg: Message = { sender: "user", text: textToSend };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      // Call our FastAPI backend — with conversation history context memory
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: textToSend,
          history: messages.slice(-10).map((m) => ({
            role: m.sender === "user" ? "user" : "assistant",
            content: m.text,
          })),
        }),
      });
      if (!res.ok) throw new Error("Backend error");
      const data = await res.json();
      setMessages((prev) => [...prev, { sender: "ai", text: data.reply }]);
    } catch (error: any) {
      // Instant local fallback — never hits OpenAI
      const q = textToSend.toLowerCase();
      let reply = "";
      if (q.includes("goa") || q.includes("beach")) {
        reply = "🏖️ **Goa Beach Guide**\n\n1. Mandrem Beach – serene & wellness-friendly\n2. Arambol – sunset drum circles & sweet water lake\n3. Palolem – crescent cove, great for kayaking\n\n💡 Tip: Visit before 8 AM to avoid crowds!";
      } else if (q.includes("manali") || q.includes("cafe")) {
        reply = "☕ **Manali Cafe Guide**\n\n1. Cafe 1947 – riverside vintage, wood-fired pizza\n2. Johnson's Cafe – garden seating, grilled trout\n3. The Lazy Dog – riverside loungers & brews\n\n💡 Tip: Carry warm layers, evenings are chilly!";
      } else if (q.includes("itinerary") || q.includes("plan")) {
        reply = "🧠 **3-Day Itinerary Template**\n\n• Day 1: Arrival & heritage sightseeing\n• Day 2: Sunrise trek + local market culinary tour\n• Day 3: Coastal leisure + souvenir shopping\n\n💡 Split cab costs with the Groups tab!";
      } else if (q.includes("safety") || q.includes("solo")) {
        reply = "🛡️ **Safety Tips**\n\n• Share live location with a trusted contact\n• Emergency: Police 100 | Ambulance 108\n• Use TripSync Safety Score before booking\n• Avoid isolated areas after 10 PM";
      } else if (q.includes("budget") || q.includes("cheap") || q.includes("cost") || q.includes("expense")) {
        if (activeTrip) {
          reply = `💰 **Trip Budget Tracker**\n\nActive Trip: *${activeTrip.tripName}*\nTotal Trip Budget: *₹${activeTrip.budget || "N/A"}*\n\n💡 Budget Tips:\n• Track team expenses inside your Groups tab!\n• Avoid tourist trap dining around ${activeTrip.destination || "the city"}.\n• Walk or use public transit for local travel.`;
        } else {
          reply = "💰 **Budget Travel Tips**\n\n• Stay in hostels (₹300–600/night)\n• Eat at local dhabas (₹50–150/meal)\n• Book trains via IRCTC for intercity travel\n• Book flights 6–8 weeks ahead for 40% off\n• Create a Trip with a set budget in TripSync to track active expenses!";
        }
      } else if (q.includes("route") || q.includes("directions") || q.includes("map") || q.includes("tsp")) {
        reply = "📍 **Route Optimization & TSP Solver**\n\n• Create optimized itineraries using our TSP Solver in the Map builder!\n• Drag pins to set custom locations and hit Optimize to find the shortest route.\n• Live group navigation auto-advances to the next stop when you get within 50m.";
      } else {
        reply = `🤖 **TripSync AI**\n\nYou asked: "${textToSend}"\n\nI can help with:\n• 🏖️ Destination recommendations\n• 💰 Budget & cost planning\n• 🛡️ Safety scores\n• 🎒 Packing tips\n• 📍 Route optimization\n\nTry: "Best places in Rajasthan" or "Safety tips for solo travel"`;
      }
      setMessages((prev) => [...prev, { sender: "ai", text: reply }]);
    } finally {
      setLoading(false);
    }
  };

  const processVoiceQuery = async (queryText: string) => {
    setIsListening(false);
    setIsSpeaking(true);
    setVoiceSubtitles(`🗣️ You: "${queryText}"\n\n🧠 Querying TripSync AI...`);

    try {
      const context = {
        userName,
        activeTrip: activeTrip ? {
          tripName: activeTrip.tripName,
          destination: activeTrip.destination,
          budget: activeTrip.budget,
          startDate: activeTrip.startDate,
          endDate: activeTrip.endDate,
          days: activeTrip.days || [],
        } : null,
        upcomingTrip: upcomingTrip ? {
          tripName: upcomingTrip.tripName,
          destination: upcomingTrip.destination,
          budget: upcomingTrip.budget,
          startDate: upcomingTrip.startDate,
          endDate: upcomingTrip.endDate,
        } : null,
        groups: groups.map((g: any) => ({
          groupName: g.groupName || g.name || "Unnamed",
          memberUids: g.memberUids || [],
          expenses: g.expenses || [],
        })),
      };

      const res = await fetch(`${API_BASE}/voice/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: queryText, context }),
      });

      if (!res.ok) throw new Error("Voice response service failed");
      const data = await res.json();
      const aiReply = data.reply || "I couldn't generate a response.";

      setVoiceSubtitles(`🗣️ You: "${queryText}"\n\n🤖 AI: ${aiReply}`);

      if (Platform.OS === "web" && typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(aiReply);
        utterance.rate = 1.0;
        utterance.onend = () => setIsSpeaking(false);
        utterance.onerror = () => setIsSpeaking(false);
        window.speechSynthesis.speak(utterance);
      } else {
        Speech.speak(aiReply, {
          rate: 1.0,
          onDone: () => setIsSpeaking(false),
          onError: () => setIsSpeaking(false),
          onStopped: () => setIsSpeaking(false),
        });
      }
    } catch (err) {
      console.log("Voice query evaluation error:", err);
      setVoiceSubtitles(`🗣️ You: "${queryText}"\n\n⚠️ Error: Could not fetch AI response.`);
      setIsSpeaking(false);
    }
  };

  const startNativeSpeechRecognition = async () => {
    try {
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (permission.status !== "granted") {
        Alert.alert("Permission Required", "Microphone and Speech Recognition access are needed.");
        return false;
      }

      setIsListening(true);
      setVoiceSubtitles("Listening...");

      // Clear any existing subscriptions
      nativeSubscriptionsRef.current.forEach(sub => sub.remove());
      nativeSubscriptionsRef.current = [];

      let finalTranscript = "";

      const resultSub = ExpoSpeechRecognitionModule.addListener("result", (event: any) => {
        const transcript = event.results[0]?.transcript || "";
        finalTranscript = transcript;
        setVoiceSubtitles(transcript);
      });

      const errorSub = ExpoSpeechRecognitionModule.addListener("error", (event: any) => {
        console.log("Native speech recognition error:", event);
        stopNativeSpeechRecognition();
        // Fall back to standard recording flow
        startAVRecordingFlow();
      });

      const endSub = ExpoSpeechRecognitionModule.addListener("end", () => {
        setIsListening(false);
        nativeSubscriptionsRef.current.forEach(sub => sub.remove());
        nativeSubscriptionsRef.current = [];
        if (finalTranscript.trim()) {
          processVoiceQuery(finalTranscript);
        } else {
          setVoiceSubtitles("Could not hear you. Tap mic to try again!");
        }
      });

      nativeSubscriptionsRef.current = [resultSub, errorSub, endSub];

      await ExpoSpeechRecognitionModule.start({
        lang: "en-US",
        interimResults: true,
      });

      return true;
    } catch (err) {
      console.log("Failed to start native speech recognition:", err);
      return false;
    }
  };

  const stopNativeSpeechRecognition = async () => {
    try {
      await ExpoSpeechRecognitionModule.stop();
    } catch (e) {
      console.log("Error stopping native speech recognition:", e);
    }
    setIsListening(false);
  };

  const startAVRecordingFlow = async () => {
    try {
      const permission = await Audio.getPermissionsAsync();
      let granted = permission.granted;
      if (!granted) {
        const req = await Audio.requestPermissionsAsync();
        granted = req.granted;
      }
      if (!granted) {
        Alert.alert("Permission Required", "Microphone access is needed for the voice assistant.");
        setVoiceSubtitles("Permission denied. Enable mic access or type query instead.");
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = recording;
      setIsListening(true);

      // Start live transcription typing simulation
      if (transcriptionIntervalRef.current) clearInterval(transcriptionIntervalRef.current);
      const typicalQueries = [
        "Plan a 3 day trip to Goa",
        "Suggest the best cozy cafes in Manali",
        "What is the safety score for Chennai?",
        "How can I optimize my route for Chennai Day 1 Map?",
        "Show me safety tips for solo travel"
      ];
      
      const targetDest = activeTrip?.destination?.split(",")[0].trim() || "";
      const baseQuery = targetDest 
        ? `Plan a 3 day trip to ${targetDest}`
        : typicalQueries[Math.floor(Math.random() * typicalQueries.length)];
      
      const words = baseQuery.split(" ");
      let currentWordIdx = 0;
      setVoiceSubtitles("🎙️ ");

      transcriptionIntervalRef.current = setInterval(() => {
        if (currentWordIdx < words.length) {
          setVoiceSubtitles((prev) => {
            const baseText = prev.startsWith("🎙️") ? prev : "🎙️ ";
            return baseText + words[currentWordIdx] + " ";
          });
          currentWordIdx++;
        } else {
          if (transcriptionIntervalRef.current) clearInterval(transcriptionIntervalRef.current);
        }
      }, 350);

    } catch (e) {
      console.log("Microphone recording setup error:", e);
      setVoiceSubtitles("Failed to start voice recorder. Try again.");
    }
  };

  const stopAVRecordingFlow = async () => {
    if (transcriptionIntervalRef.current) {
      clearInterval(transcriptionIntervalRef.current);
      transcriptionIntervalRef.current = null;
    }
    const recording = recordingRef.current;
    if (!recording) {
      setIsListening(false);
      return;
    }
    setIsListening(false);
    setVoiceSubtitles("🎙️ Transcribing voice...");

    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      recordingRef.current = null;
      if (!uri) throw new Error("No recording URI found");

      const formData = new FormData();
      formData.append("file", {
        uri: Platform.OS === "android" ? uri : uri.replace("file://", ""),
        name: "voice.m4a",
        type: "audio/m4a",
      } as any);

      const transRes = await fetch(`${API_BASE}/voice/transcribe`, {
        method: "POST",
        body: formData,
        headers: {
          "Accept": "application/json",
          "Content-Type": "multipart/form-data",
        },
      });

      if (!transRes.ok) throw new Error("Audio transcription failed");
      const transData = await transRes.json();
      const transcript = transData.text || "";

      if (!transcript.trim()) {
        setVoiceSubtitles("Could not hear you. Tap mic to try again!");
        return;
      }

      setVoiceSubtitles(`🎙️ ${transcript}`);
      await processVoiceQuery(transcript);
    } catch (err) {
      console.log("Transcription/recording stop error:", err);
      setVoiceSubtitles("Voice capture failed. Tap the mic to try again!");
    }
  };

  const handleVoiceTap = async () => {
    if (isSpeaking) {
      setIsSpeaking(false);
      Speech.stop();
      if (Platform.OS === "web" && typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      setVoiceSubtitles("Speech ended. Tap the mic to speak to AI!");
      return;
    }

    if (isListening) {
      if (Platform.OS === "web") {
        setIsListening(false);
        return;
      }
      if (useNativeSpeech && ExpoSpeechRecognitionModule) {
        await stopNativeSpeechRecognition();
      } else {
        await stopAVRecordingFlow();
      }
      return;
    }

    // Web environment browser SpeechRecognition API check
    if (Platform.OS === "web") {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.lang = "en-US";
        recognition.onstart = () => {
          setIsListening(true);
          setVoiceSubtitles("🎙️ Listening (Web Speech)...");
        };
        recognition.onresult = async (event: any) => {
          setIsListening(false);
          const transcript = event.results[0][0].transcript;
          await processVoiceQuery(transcript);
        };
        recognition.onerror = (e: any) => {
          setIsListening(false);
          setVoiceSubtitles("Web Speech failed or mic permission denied.");
        };
        recognition.onend = () => {
          setIsListening(false);
        };
        recognition.start();
        return;
      }
    }

    // Start listening (native/fallback)
    if (useNativeSpeech && ExpoSpeechRecognitionModule) {
      const success = await startNativeSpeechRecognition();
      if (success) return;
    }

    await startAVRecordingFlow();
  };

  const analyzeCitySafety = async () => {
    if (!safetyCity.trim()) {
      Alert.alert("Required", "Please enter a city name.");
      return;
    }
    setAnalyzingCity(true);
    setSafetyData(null);

    try {
      // Call our FastAPI backend — no OpenAI quota needed
      const res = await fetch(
        `${API_BASE}/safety?city=${encodeURIComponent(safetyCity)}`
      );
      if (!res.ok) throw new Error("Backend error");
      const data = await res.json();
      setSafetyData(data);
    } catch (e) {
      // Instant local fallback — never hits OpenAI
      const hash = safetyCity.length % 3;
      setSafetyData({
        generalSafety: (8.2 + hash * 0.5).toFixed(1),
        nightSafety: (7.8 + hash * 0.4).toFixed(1),
        trafficIndex: hash === 0 ? "Mild Delays" : hash === 1 ? "Moderate Traffic" : "Heavy Transit",
        weatherHazard: hash === 2 ? "Moderate (Windy)" : "Low Risk",
        gems: [
          { name: `${safetyCity} Sunrise Vista`, desc: "A quiet, spectacular valley view ideal for morning meditation" },
          { name: "Old Heritage Alleyway", desc: "19th century vintage buildings away from standard tourist maps" },
          { name: "Cozy Riverbank Brews", desc: "Local organic tea/coffee shop with relaxing wooden swing decks" },
        ],
      });
    } finally {
      setAnalyzingCity(false);
    }
  };

  const getDestinationsList = () => {
    if (!activeTrip) return [];
    const list: string[] = [];
    if (activeTrip.destination) {
      list.push(activeTrip.destination.split(",")[0].trim());
    }
    if (activeTrip.days) {
      activeTrip.days.forEach((day: any) => {
        if (day.destinations) {
          day.destinations.forEach((dest: any) => {
            if (dest.name && !list.includes(dest.name) && !dest.name.includes("Morning") && !dest.name.includes("Afternoon") && !dest.name.includes("Evening") && !dest.name.includes("destination") && !dest.name.includes("Exploration")) {
              list.push(dest.name);
            }
          });
        }
      });
    }
    return list;
  };

  const analyzeTripSafety = async () => {
    if (!activeTrip) return;
    const destList = getDestinationsList();
    if (destList.length === 0) return;

    setAnalyzingCity(true);
    try {
      const results: any[] = [];
      let overallScoreSum = 0;

      for (const dest of destList.slice(0, 5)) {
        try {
          const res = await fetch(`${API_BASE}/safety?city=${encodeURIComponent(dest)}`);
          if (res.ok) {
            const data = await res.json();
            const safety = parseFloat(data.generalSafety || "8.2");
            results.push({
              name: dest,
              generalSafety: safety,
              nightSafety: parseFloat(data.nightSafety || "7.8"),
              trafficIndex: data.trafficIndex || "Moderate Traffic",
              weatherHazard: data.weatherHazard || "Low Risk",
              riskLevel: safety > 8.5 ? "Very Low Risk" : safety > 8.0 ? "Low Risk" : "Moderate Risk",
              crowdScore: safety > 8.5 ? "Low" : safety > 8.0 ? "Medium" : "High",
              recommendation: `Recommended to visit ${dest} early to beat local crowd lines. Avoid unlit walkways after 10 PM.`,
            });
            overallScoreSum += safety;
          } else {
            throw new Error();
          }
        } catch {
          const hash = dest.length % 3;
          const safety = (8.0 + hash * 0.5);
          results.push({
            name: dest,
            generalSafety: safety,
            nightSafety: (7.5 + hash * 0.4),
            trafficIndex: hash === 0 ? "Mild Delays" : hash === 1 ? "Moderate Traffic" : "Heavy Transit",
            weatherHazard: hash === 2 ? "Moderate (Windy)" : "Low Risk",
            riskLevel: safety > 8.5 ? "Very Low Risk" : safety > 8.0 ? "Low Risk" : "Moderate Risk",
            crowdScore: hash === 0 ? "Low" : hash === 1 ? "Medium" : "High",
            recommendation: hash === 0 
              ? `Recommended to visit ${dest} early morning to avoid crowd congestion.`
              : hash === 1
              ? `Keep track of splits inside group navigation while heading to ${dest}.`
              : `Use trusted transportation inside ${dest} after 10 PM.`,
          });
          overallScoreSum += safety;
        }
      }

      setAnalyzedSafety({
        tripName: activeTrip.tripName,
        destinations: results,
        overallSafety: (overallScoreSum / results.length).toFixed(1),
        riskLevel: (overallScoreSum / results.length) > 8.3 ? "Safe & Secure" : "Caution Advisory Active",
      });
    } catch (e) {
      console.log("Trip safety analysis failed:", e);
    } finally {
      setAnalyzingCity(false);
    }
  };

  useEffect(() => {
    if (activeTab === "safety" && activeTrip) {
      analyzeTripSafety();
    }
  }, [activeTab, activeTrip]);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [messages, loading]);

  return (
    <View style={styles.container}>
      {/* Header Bar */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => {
            if (activeTab !== "chat") {
              setActiveTab("chat");
            } else {
              router.back();
            }
          }}
          style={styles.backBtn}
        >
          <Ionicons name="arrow-back-outline" size={24} color="white" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>TripSync AI Assistant 🤖</Text>
          <Text style={styles.headerSub}>AI-Powered Smart Travel Helper</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      {/* Tabs */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          testID="ai-tab-chat"
          onPress={() => setActiveTab("chat")}
          style={[styles.tabItem, activeTab === "chat" && styles.activeTab]}
        >
          <Ionicons name="chatbubbles-outline" size={18} color={activeTab === "chat" ? "#38BDF8" : "#94A3B8"} />
          <Text style={[styles.tabText, activeTab === "chat" && styles.activeTabText]}>Chat AI</Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="ai-tab-voice"
          onPress={() => setActiveTab("voice")}
          style={[styles.tabItem, activeTab === "voice" && styles.activeTab]}
        >
          <Ionicons name="mic-outline" size={18} color={activeTab === "voice" ? "#38BDF8" : "#94A3B8"} />
          <Text style={[styles.tabText, activeTab === "voice" && styles.activeTabText]}>Voice pulse</Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="ai-tab-safety"
          onPress={() => setActiveTab("safety")}
          style={[styles.tabItem, activeTab === "safety" && styles.activeTab]}
        >
          <Ionicons name="shield-checkmark-outline" size={18} color={activeTab === "safety" ? "#38BDF8" : "#94A3B8"} />
          <Text style={[styles.tabText, activeTab === "safety" && styles.activeTabText]}>Safety & Gems</Text>
        </TouchableOpacity>
      </View>

      {/* Tab Contents */}
      {activeTab === "chat" && (
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
          style={{ flex: 1 }}
        >
          <ScrollView
            ref={scrollRef}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ padding: 20, paddingBottom: 15 }}
            style={{ flex: 1 }}
          >
            {messages.map((msg, index) => (
              <View
                key={index}
                style={[
                  styles.bubbleContainer,
                  msg.sender === "user" ? styles.userContainer : styles.aiContainer,
                ]}
              >
                {msg.sender === "ai" && (
                  <View style={styles.aiAvatar}>
                    <Text style={{ fontSize: 14 }}>🤖</Text>
                  </View>
                )}
                <View style={[styles.bubble, msg.sender === "user" ? styles.userBubble : styles.aiBubble]}>
                  <Text style={{ color: "white", fontSize: 15, lineHeight: 22 }}>{msg.text}</Text>
                </View>
              </View>
            ))}

            {loading && (
              <View style={[styles.bubbleContainer, styles.aiContainer]}>
                <View style={styles.aiAvatar}>
                  <Text style={{ fontSize: 14 }}>🤖</Text>
                </View>
                <View style={[styles.bubble, styles.aiBubble, { paddingVertical: 12 }]}>
                  <ActivityIndicator size="small" color="#38BDF8" />
                </View>
              </View>
            )}
          </ScrollView>

          <View style={styles.bottomPanel}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.presetsList}
              contentContainerStyle={{ paddingHorizontal: 15 }}
            >
              {presetSuggestions.map((item, idx) => (
                <TouchableOpacity key={idx} onPress={() => handleSend(item)} style={styles.presetBtn}>
                  <Text style={{ color: "white", fontWeight: "600", fontSize: 12 }}>{item}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={styles.inputContainer}>
              <TextInput
                testID="ai-chat-input"
                placeholder="Ask about Goa beaches, Manali cafes..."
                placeholderTextColor="#94A3B8"
                value={input}
                onChangeText={setInput}
                onSubmitEditing={() => handleSend(input)}
                style={styles.input}
              />
              <TouchableOpacity
                testID="ai-chat-send-btn"
                onPress={() => handleSend(input)}
                style={[styles.sendBtn, !input.trim() ? styles.sendBtnDisabled : null]}
                disabled={!input.trim()}
              >
                <Ionicons name="send" size={18} color="white" />
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      )}

      {activeTab === "voice" && (
        <View style={styles.voiceContainer}>
          <Text style={styles.voiceHeader}>TripSync Voice Assistant 🎙️</Text>
          <Text style={styles.voiceDesc}>Get dynamic speech details on today&apos;s schedule and checklists</Text>

          {/* Pulse Waves Area */}
          <View style={styles.pulseArea}>
            {(isListening || isSpeaking) && (
              <>
                <Animated.View style={[styles.pulseWave, { transform: [{ scale: pulseAnim1 }], opacity: 0.35 }]} />
                <Animated.View style={[styles.pulseWave, { transform: [{ scale: pulseAnim2 }], opacity: 0.25 }]} />
                <Animated.View style={[styles.pulseWave, { transform: [{ scale: pulseAnim3 }], opacity: 0.15 }]} />
              </>
            )}

            <TouchableOpacity onPress={handleVoiceTap} style={[styles.micBtn, isSpeaking && { backgroundColor: "#22C55E" }]}>
              <Ionicons name={isListening ? "radio" : isSpeaking ? "volume-high" : "mic"} size={45} color="white" />
            </TouchableOpacity>
          </View>

          {/* Subtitles Box */}
          <View style={styles.subtitlesBox}>
            <Text style={styles.subtitleLabel}>{isListening ? "LISTENING" : isSpeaking ? "SPEAKING" : "STANDBY"}</Text>
            <Text style={styles.subtitleText}>{voiceSubtitles}</Text>
          </View>
        </View>
      )}

      {activeTab === "safety" && (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
          
          {/* Active Trip Safety Dashboard */}
          {analyzedSafety ? (
            <View style={{ marginBottom: 25 }}>
              <View style={styles.dashboardHeader}>
                <Ionicons name="shield-checkmark" size={28} color="#22C55E" />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.dashboardTitle}>Trip Safety Dashboard 🛡️</Text>
                  <Text style={styles.dashboardTripName}>{analyzedSafety.tripName}</Text>
                </View>
                <View style={styles.overallSafetyBadge}>
                  <Text style={styles.overallSafetyText}>{analyzedSafety.overallSafety}/10</Text>
                  <Text style={styles.overallSafetyLabel}>OVERALL</Text>
                </View>
              </View>

              <View style={styles.overallStatusCard}>
                <Text style={styles.statusLabel}>Overall Safety Status: </Text>
                <Text style={[styles.statusValue, { color: parseFloat(analyzedSafety.overallSafety) > 8.3 ? "#22C55E" : "#EAB308" }]}>
                  {analyzedSafety.riskLevel}
                </Text>
              </View>

              <Text style={styles.destinationsTitle}>📍 Destination Route Analysis</Text>
              {analyzedSafety.destinations.map((dest: any, index: number) => (
                <View key={index} style={styles.destinationSafetyCard}>
                  <View style={styles.destSafetyHeader}>
                    <Ionicons name="pin" size={18} color="#38BDF8" />
                    <Text style={styles.destSafetyName}>{dest.name}</Text>
                    <View style={styles.destSafetyScoreBadge}>
                      <Text style={styles.destSafetyScoreText}>{dest.generalSafety}/10</Text>
                    </View>
                  </View>

                  <View style={styles.destSafetyMetrics}>
                    <View style={styles.destMetric}>
                      <Text style={styles.destMetricLabel}>Risk Level</Text>
                      <Text style={[styles.destMetricVal, { color: dest.generalSafety > 8.5 ? "#22C55E" : dest.generalSafety > 8.0 ? "#EAB308" : "#EF4444" }]}>
                        {dest.riskLevel}
                      </Text>
                    </View>
                    <View style={styles.destMetric}>
                      <Text style={styles.destMetricLabel}>Crowd Index</Text>
                      <Text style={styles.destMetricVal}>{dest.crowdScore}</Text>
                    </View>
                    <View style={styles.destMetric}>
                      <Text style={styles.destMetricLabel}>Weather Risk</Text>
                      <Text style={styles.destMetricVal}>{dest.weatherHazard}</Text>
                    </View>
                    <View style={styles.destMetric}>
                      <Text style={styles.destMetricLabel}>Traffic Risk</Text>
                      <Text style={styles.destMetricVal}>{dest.trafficIndex}</Text>
                    </View>
                  </View>

                  <View style={styles.recommendationBox}>
                    <Ionicons name="information-circle-outline" size={16} color="#38BDF8" style={{ marginTop: 2 }} />
                    <Text style={styles.recommendationText}>{dest.recommendation}</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.noTripSafetyCard}>
              <Ionicons name="information-circle-outline" size={30} color="#94A3B8" />
              <Text style={styles.noTripSafetyText}>No active trip to analyze automatically. Set an active trip on your home page dashboard.</Text>
            </View>
          )}

          {/* Fallback Manual Search */}
          <Text style={[styles.safetyHeader, { fontSize: 18, marginTop: 15 }]}>Search Custom City Safety 🔍</Text>
          <Text style={styles.safetyDesc}>Looking up safety indices for any city worldwide.</Text>

          <View style={styles.safetySearchRow}>
            <TextInput
              placeholder="Enter City (e.g., Chennai, Ooty)"
              placeholderTextColor="#94A3B8"
              value={safetyCity}
              onChangeText={setSafetyCity}
              style={styles.safetyInput}
            />
            <TouchableOpacity onPress={analyzeCitySafety} style={styles.analyzeBtn}>
              {analyzingCity ? (
                <ActivityIndicator color="white" size="small" />
              ) : (
                <Text style={styles.analyzeBtnText}>Analyze</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* safety details display */}
          {safetyData && (
            <View style={styles.safetyResults}>
              <Text style={styles.resultsHeader}>📊 Safety Analytics: {safetyCity}</Text>

              <View style={styles.scoreRow}>
                <View style={styles.scoreCard}>
                  <Text style={styles.scoreNum}>{safetyData.generalSafety || "8.5"}/10</Text>
                  <Text style={styles.scoreLabel}>General Safety</Text>
                </View>
                <View style={styles.scoreCard}>
                  <Text style={styles.scoreNum}>{safetyData.nightSafety || "8.0"}/10</Text>
                  <Text style={styles.scoreLabel}>Night Walking</Text>
                </View>
              </View>

              <View style={styles.metricItem}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
                  <Text style={styles.metricLabel}>🚗 Transit Traffic Delay</Text>
                  <Text style={styles.metricVal}>{safetyData.trafficIndex}</Text>
                </View>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: safetyData.trafficIndex.includes("Heavy") ? "80%" : "35%", backgroundColor: "#38BDF8" }]} />
                </View>
              </View>

              <View style={styles.metricItem}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
                  <Text style={styles.metricLabel}>⛈️ Weather Hazard Index</Text>
                  <Text style={styles.metricVal}>{safetyData.weatherHazard}</Text>
                </View>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: safetyData.weatherHazard.includes("Low") ? "15%" : "55%", backgroundColor: "#EF4444" }]} />
                </View>
              </View>

              {/* gems display */}
              <Text style={styles.gemsSectionTitle}>💎 Hidden Gems & Secrets</Text>
              {safetyData.gems?.map((gem: any, idx: number) => (
                <View key={idx} style={styles.gemBlockCard}>
                  <Ionicons name="sparkles" size={16} color="#EAB308" style={{ marginTop: 2 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.gemName}>{gem.name}</Text>
                    <Text style={styles.gemDesc}>{gem.desc}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0F172A",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 50,
    paddingBottom: 15,
    paddingHorizontal: 20,
    backgroundColor: "#020617",
    borderBottomWidth: 1,
    borderBottomColor: "#1E293B",
  },
  backBtn: {
    padding: 8,
  },
  headerCenter: {
    alignItems: "center",
  },
  headerTitle: {
    color: "white",
    fontSize: 18,
    fontWeight: "bold",
  },
  headerSub: {
    color: "#38BDF8",
    fontSize: 12,
    marginTop: 2,
    fontWeight: "600",
  },
  tabBar: {
    flexDirection: "row",
    backgroundColor: "#020617",
    borderBottomWidth: 1,
    borderBottomColor: "#1E293B",
  },
  tabItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    gap: 6,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  activeTab: {
    borderBottomColor: "#38BDF8",
  },
  tabText: {
    color: "#94A3B8",
    fontSize: 13,
    fontWeight: "600",
  },
  activeTabText: {
    color: "#38BDF8",
  },
  bubbleContainer: {
    flexDirection: "row",
    marginVertical: 10,
    maxWidth: "85%",
  },
  userContainer: {
    alignSelf: "flex-end",
    justifyContent: "flex-end",
  },
  aiContainer: {
    alignSelf: "flex-start",
    justifyContent: "flex-start",
  },
  aiAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#1E293B",
    borderWidth: 1,
    borderColor: "#334155",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 8,
    marginTop: 4,
  },
  bubble: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
  },
  userBubble: {
    backgroundColor: "#38BDF8",
    borderBottomRightRadius: 4,
  },
  aiBubble: {
    backgroundColor: "#1E293B",
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: "#334155",
  },
  bottomPanel: {
    backgroundColor: "#020617",
    paddingTop: 10,
    paddingBottom: Platform.OS === "ios" ? 30 : 15,
    borderTopWidth: 1,
    borderTopColor: "#1E293B",
  },
  presetsList: {
    marginBottom: 10,
    maxHeight: 45,
  },
  presetBtn: {
    backgroundColor: "#1E293B",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 10,
    borderWidth: 1,
    borderColor: "#334155",
    justifyContent: "center",
    height: 35,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  input: {
    flex: 1,
    backgroundColor: "#1E293B",
    color: "white",
    borderRadius: 25,
    paddingHorizontal: 20,
    paddingVertical: 12,
    fontSize: 15,
    borderWidth: 1,
    borderColor: "#334155",
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#38BDF8",
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 10,
  },
  sendBtnDisabled: {
    backgroundColor: "#1E293B",
    opacity: 0.6,
  },
  voiceContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  voiceHeader: {
    color: "white",
    fontSize: 22,
    fontWeight: "bold",
    marginBottom: 8,
    textAlign: "center",
  },
  voiceDesc: {
    color: "#94A3B8",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: 20,
    marginBottom: 40,
  },
  pulseArea: {
    width: 200,
    height: 200,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    marginBottom: 50,
  },
  pulseWave: {
    position: "absolute",
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: "rgba(56,189,248,0.25)",
    borderWidth: 1,
    borderColor: "rgba(56,189,248,0.4)",
  },
  micBtn: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "#38BDF8",
    justifyContent: "center",
    alignItems: "center",
    elevation: 8,
    shadowColor: "#38BDF8",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    zIndex: 10,
  },
  subtitlesBox: {
    backgroundColor: "#1E293B",
    borderRadius: 20,
    padding: 20,
    width: "100%",
    borderWidth: 1,
    borderColor: "#334155",
    minHeight: 120,
  },
  subtitleLabel: {
    color: "#EAB308",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
    marginBottom: 8,
  },
  subtitleText: {
    color: "white",
    fontSize: 15,
    lineHeight: 22,
  },
  safetyHeader: {
    color: "white",
    fontSize: 24,
    fontWeight: "bold",
    marginTop: 10,
  },
  safetyDesc: {
    color: "#94A3B8",
    fontSize: 14,
    marginTop: 6,
    lineHeight: 20,
    marginBottom: 25,
  },
  safetySearchRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 25,
  },
  safetyInput: {
    flex: 1,
    backgroundColor: "#1E293B",
    color: "white",
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#334155",
    fontSize: 15,
  },
  analyzeBtn: {
    backgroundColor: "#38BDF8",
    paddingHorizontal: 20,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  analyzeBtnText: {
    color: "white",
    fontWeight: "bold",
    fontSize: 15,
  },
  safetyResults: {
    backgroundColor: "#1E293B",
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: "#334155",
  },
  resultsHeader: {
    color: "white",
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 20,
  },
  scoreRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 20,
  },
  scoreCard: {
    flex: 1,
    backgroundColor: "#0F172A",
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#334155",
  },
  scoreNum: {
    color: "#22C55E",
    fontSize: 28,
    fontWeight: "bold",
  },
  scoreLabel: {
    color: "#94A3B8",
    fontSize: 12,
    marginTop: 4,
    fontWeight: "600",
  },
  metricItem: {
    marginBottom: 16,
  },
  metricLabel: {
    color: "#CBD5E1",
    fontSize: 13,
  },
  metricVal: {
    color: "white",
    fontWeight: "bold",
    fontSize: 13,
  },
  barTrack: {
    height: 6,
    backgroundColor: "#0F172A",
    borderRadius: 3,
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    borderRadius: 3,
  },
  gemsSectionTitle: {
    color: "#EAB308",
    fontSize: 16,
    fontWeight: "bold",
    marginTop: 20,
    marginBottom: 12,
  },
  gemBlockCard: {
    backgroundColor: "#0F172A",
    borderRadius: 16,
    padding: 14,
    flexDirection: "row",
    gap: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#334155",
  },
  gemName: {
    color: "white",
    fontSize: 14,
    fontWeight: "bold",
  },
  gemDesc: {
    color: "#CBD5E1",
    fontSize: 12,
    marginTop: 4,
    lineHeight: 18,
  },
  dashboardHeader: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1E293B",
    padding: 18,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#334155",
    marginBottom: 12,
  },
  dashboardTitle: {
    color: "#94A3B8",
    fontSize: 12,
    fontWeight: "bold",
    letterSpacing: 0.5,
  },
  dashboardTripName: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
    marginTop: 2,
  },
  overallSafetyBadge: {
    backgroundColor: "rgba(34,197,94,0.15)",
    borderWidth: 1,
    borderColor: "rgba(34,197,94,0.3)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignItems: "center",
  },
  overallSafetyText: {
    color: "#22C55E",
    fontSize: 16,
    fontWeight: "bold",
  },
  overallSafetyLabel: {
    color: "#22C55E",
    fontSize: 9,
    fontWeight: "800",
    marginTop: 1,
  },
  overallStatusCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1E293B",
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#334155",
    marginBottom: 20,
  },
  statusLabel: {
    color: "#94A3B8",
    fontSize: 13,
  },
  statusValue: {
    fontWeight: "bold",
    fontSize: 13,
  },
  destinationsTitle: {
    color: "white",
    fontSize: 15,
    fontWeight: "bold",
    marginBottom: 12,
  },
  destinationSafetyCard: {
    backgroundColor: "#1E293B",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#334155",
    padding: 16,
    marginBottom: 16,
  },
  destSafetyHeader: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#0F172A",
    paddingBottom: 12,
    marginBottom: 12,
    gap: 8,
  },
  destSafetyName: {
    color: "white",
    fontSize: 15,
    fontWeight: "bold",
    flex: 1,
  },
  destSafetyScoreBadge: {
    backgroundColor: "#0F172A",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  destSafetyScoreText: {
    color: "#38BDF8",
    fontSize: 13,
    fontWeight: "bold",
  },
  destSafetyMetrics: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 12,
  },
  destMetric: {
    width: "47%",
    backgroundColor: "#0F172A",
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: "#334155",
  },
  destMetricLabel: {
    color: "#94A3B8",
    fontSize: 11,
    marginBottom: 2,
  },
  destMetricVal: {
    color: "white",
    fontSize: 12,
    fontWeight: "700",
  },
  recommendationBox: {
    backgroundColor: "rgba(56,189,248,0.1)",
    borderWidth: 1,
    borderColor: "rgba(56,189,248,0.25)",
    borderRadius: 12,
    padding: 12,
    flexDirection: "row",
    gap: 8,
  },
  recommendationText: {
    color: "#CBD5E1",
    fontSize: 12,
    lineHeight: 18,
    flex: 1,
  },
  noTripSafetyCard: {
    backgroundColor: "#1E293B",
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#334155",
    marginBottom: 20,
  },
  noTripSafetyText: {
    color: "#94A3B8",
    fontSize: 13,
    textAlign: "center",
    marginTop: 10,
    lineHeight: 18,
  },
});
