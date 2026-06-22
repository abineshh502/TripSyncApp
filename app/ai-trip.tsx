import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { useState, useEffect } from "react";
import {
  getFirestore,
  collection,
  addDoc,
  getDoc,
  doc,
  getDocs,
  query,
  where,
  limit,
} from "firebase/firestore";
import app, { auth } from "../firebaseConfig";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";

const getApiBase = () => {
  const envUrl = process.env.EXPO_PUBLIC_API_URL || "https://tripsyncbackend-production-37a2.up.railway.app";
  const cleaned = envUrl.replace(/\/+$/, "");
  return cleaned.endsWith("/api") ? cleaned : `${cleaned}/api`;
};

const API_BASE = getApiBase();
const GEOAPIFY_KEY = "303db9c9ea7b411f81e4aaa234c881e5";

const INTEREST_OPTIONS = [
  { id: "beach", label: "🏖 Beaches", desc: "Coastal & water activities" },
  { id: "nature", label: "🌿 Nature", desc: "Parks, wildlife, forests" },
  { id: "historical", label: "🏛 Historical", desc: "Historical & cultural sites" },
  { id: "adventure", label: "🧗 Adventure", desc: "Treks, rafting, sports" },
  { id: "food", label: "🍜 Food", desc: "Local cuisines & cafes" },
  { id: "luxury", label: "💎 Luxury", desc: "Premium & high-end experiences" },
  { id: "shopping", label: "🛍 Shopping", desc: "Markets & local crafts" },
  { id: "nightlife", label: "🌃 Nightlife", desc: "Bars, clubs & evening fun" },
  { id: "wellness", label: "🧘 Wellness", desc: "Yoga, spas & meditation" },
];

interface DaySchedule {
  dayNumber: number;
  date: string;
  title: string;
  notes: string;
  destinations: { name: string }[];
  mapLink: string;
}

export default function AITripScreen() {
  const db = getFirestore(app);
  const [destination, setDestination] = useState("");
  const [destinationSuggestions, setDestinationSuggestions] = useState<any[]>([]);
  const [showDestSuggestions, setShowDestSuggestions] = useState(false);
  const [budget, setBudget] = useState("");
  const [days, setDays] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().split("T")[0]);
  const [selectedInterests, setSelectedInterests] = useState<string[]>(["historical", "food"]);
  const [travelStyle, setTravelStyle] = useState("mid-range"); // 'budget', 'mid-range', 'luxury'
  const [groupSoloMode, setGroupSoloMode] = useState("solo"); // 'solo', 'group'
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState("");
  const [parsedDays, setParsedDays] = useState<DaySchedule[]>([]);
  const [autocompleteTimer, setAutocompleteTimer] = useState<any>(null);

  const toggleInterest = (id: string) => {
    if (selectedInterests.includes(id)) {
      if (selectedInterests.length === 1) return; // keep at least one
      setSelectedInterests(selectedInterests.filter((i) => i !== id));
    } else {
      setSelectedInterests([...selectedInterests, id]);
    }
  };

  const handleDestinationChange = (text: string) => {
    setDestination(text);
    setShowDestSuggestions(false);
    if (text.trim().length < 2) { setDestinationSuggestions([]); return; }
    if (autocompleteTimer) clearTimeout(autocompleteTimer);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://api.geoapify.com/v1/geocode/autocomplete?text=${encodeURIComponent(text)}&limit=5&type=city&apiKey=${GEOAPIFY_KEY}`
        );
        const data = await res.json();
        if (data.features?.length) {
          setDestinationSuggestions(
            data.features.map((f: any) => ({
              name: f.properties.city || f.properties.name || f.properties.formatted,
              country: f.properties.country || "",
            }))
          );
          setShowDestSuggestions(true);
        }
      } catch (e) {}
    }, 350);
    setAutocompleteTimer(t);
  };

  const generateTrip = async () => {
    if (!destination.trim() || !budget.trim() || !days.trim()) {
      Alert.alert("Input Required", "Please fill in Destination, Budget, and Duration.");
      return;
    }
    const dayCount = Number(days);
    if (isNaN(dayCount) || dayCount <= 0 || dayCount > 30) {
      Alert.alert("Invalid Duration", "Please enter a valid trip duration (1-30 days).");
      return;
    }

    setLoading(true);
    setResult("");
    setParsedDays([]);

    const start = new Date(startDate);
    if (isNaN(start.getTime())) {
      Alert.alert("Invalid Date", "Please enter a valid start date (YYYY-MM-DD).");
      setLoading(false);
      return;
    }

    let compiledDays: DaySchedule[] = [];

    // Fetch user profile and recent trips from Firestore for personalization context
    let userProfile = {};
    const previousTrips: any[] = [];
    const currentUser = auth.currentUser;

    if (currentUser) {
      try {
        const userDocRef = doc(db, "users", currentUser.uid);
        const userDocSnap = await getDoc(userDocRef);
        if (userDocSnap.exists()) {
          userProfile = userDocSnap.data();
        }

        const tripsQ = query(
          collection(db, "trips"),
          where("userId", "==", currentUser.uid),
          limit(5)
        );
        const tripsSnap = await getDocs(tripsQ);
        tripsSnap.forEach((d) => {
          const tData = d.data();
          previousTrips.push({
            destination: tData.destination,
            tripName: tData.tripName,
            budget: tData.budget,
            startDate: tData.startDate,
            endDate: tData.endDate,
          });
        });
      } catch (dbErr) {
        console.log("Failed to load user profile or past trips for AI personalization:", dbErr);
      }
    }

    try {
      const res = await fetch(`${API_BASE}/itinerary/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destination,
          days: dayCount,
          budget,
          interests: selectedInterests,
          travelStyle,
          groupSoloMode,
          userProfile,
          previousTrips,
        }),
      });

      if (!res.ok) throw new Error("Backend error");
      const data = await res.json();

      compiledDays = data.itinerary.map((day: any, i: number) => {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        return {
          dayNumber: day.day || i + 1,
          date: d.toISOString().split("T")[0],
          title: day.title || `Day ${i + 1} in ${destination}`,
          notes: `🌞 Morning: ${day.morning || day.activity || "Explore"}\n☀️ Afternoon: ${day.afternoon || "Sightseeing"}\n🌙 Evening: ${day.evening || "Relax & Dine"}\n\n💡 Style: ${travelStyle.toUpperCase()} | Setup: ${groupSoloMode.toUpperCase()}`,
          destinations: [
            { name: day.morning || "Morning destination" },
            { name: day.afternoon || "Afternoon destination" },
            { name: day.evening || "Evening destination" },
          ],
          mapLink: "",
        };
      });
    } catch (error) {
      // Interest-aware local fallback
      const interestMap: Record<string, string[]> = {
        historical: ["Historic Fort & Heritage Museum Visit", "Ancient Ruins Guided Walk", "Archaeological Site Tour"],
        food: ["Local Spice & Food Market Tour", "Traditional Cooking Demonstration", "Popular Street Food Market Trail"],
        adventure: ["Scenic Hill Climbing & Trekking", "Wild Water Rafting", "Forest Zip-Lining Adventure"],
        beach: ["Sunrise Beach Walk & Swimming", "Water Sports & Jet Skiing", "Evening Scenic Sunset Cruise"],
        nature: ["Wildlife Sanctuary Safari Tour", "Scenic Botanical Gardens Walk", "Waterfall Forest Trekking"],
        shopping: ["Artisan Handicraft Market Tour", "Local Spice & Clothing Souvenirs", "Flea Market Bargain Shopping"],
        nightlife: ["High-End Rooftop Lounge Dining", "Live Music Acoustic Performance", "Late Night City Skyline Tour"],
        wellness: ["Morning Yoga & Meditation Session", "Organic Local Herb Spa Treatment", "Zen Garden Wellness Retreat"],
        luxury: ["Private Sailing Cruise Yacht", "Premium Wine & Dining Experience", "Luxury Resort Spa Day"],
      };

      for (let i = 0; i < dayCount; i++) {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        const dayInterests = selectedInterests.map((id) => interestMap[id] || ["Local Exploration"]);
        const morning = dayInterests[i % dayInterests.length]?.[0] || `${destination} Morning Exploration`;
        const afternoon = dayInterests[(i + 1) % dayInterests.length]?.[1] || `${destination} Afternoon Discovery`;
        const evening = dayInterests[(i + 2) % dayInterests.length]?.[2] || `${destination} Evening Leisure`;

        let styleTip = travelStyle === "budget" 
          ? "💡 Travel Style: Budget (use local transport and free walking guides)."
          : travelStyle === "luxury"
          ? "💎 Travel Style: Luxury (private transfers and premium reserved seating)."
          : "🚗 Travel Style: Mid-range (rideshares and balanced dining choices).";

        let setupTip = groupSoloMode === "group"
          ? "👥 Setup: Group Travel (split expenses in your Groups tab and coordinate meetups!)."
          : "🎒 Setup: Solo Travel (stay aware of surroundings, meet fellow travelers at hostels).";

        compiledDays.push({
          dayNumber: i + 1,
          date: d.toISOString().split("T")[0],
          title: i === 0 ? "Arrival & Local Intro" : i === dayCount - 1 ? "Departure & Souvenirs" : `${selectedInterests[i % selectedInterests.length]} Day`,
          notes: `🌞 Morning: ${morning}\n☀️ Afternoon: ${afternoon}\n🌙 Evening: ${evening}\n\n${styleTip}\n${setupTip}\n💡 Suggested Budget: ₹${Math.round(Number(budget) / dayCount)}`,
          destinations: [
            { name: morning },
            { name: afternoon },
            { name: evening },
          ],
          mapLink: "",
        });
      }
    }

    // Automatically save generated trip directly to Firestore
    try {
      const now = new Date();
      const end = new Date(start);
      end.setDate(end.getDate() + dayCount - 1);

      let status = "upcoming";
      const endOfDay = new Date(end);
      endOfDay.setHours(23, 59, 59, 0);
      if (now > endOfDay) status = "completed";
      else if (now >= start) status = "active";

      const currentUser = auth.currentUser;
      const tripName = `AI ${travelStyle === "luxury" ? "Luxury" : travelStyle === "budget" ? "Budget" : "Custom"} Trip to ${destination}`;

      const docRef = await addDoc(collection(db, "trips"), {
        tripName,
        destination: destination.trim(),
        budget: budget.trim(),
        startDate,
        endDate: end.toISOString().split("T")[0],
        status,
        days: compiledDays,
        interests: selectedInterests,
        travelStyle,
        groupSoloMode,
        userId: currentUser?.uid || "",
        createdAt: new Date(),
      });

      setLoading(false);
      Alert.alert("Itinerary Created! 🎉", `"${tripName}" generated & saved to My Trips.`, [
        {
          text: "View Details",
          onPress: () => {
            router.push({
              pathname: "/trip-details",
              params: {
                id: docRef.id,
                tripName,
                destination: destination.trim(),
                budget: budget.trim(),
                startDate,
                endDate: end.toISOString().split("T")[0],
              },
            });
          }
        }
      ]);
    } catch (e) {
      setLoading(false);
      Alert.alert("Save Error", "Generated itinerary but failed to save to Firebase.");
    }
  };

  const handleSaveTrip = () => {
    // Already saved during generation automatically
    Alert.alert("Saved", "This trip has been saved to your account.");
  };

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* Header */}
      <View style={styles.headerArea}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back-outline" size={22} color="white" />
        </TouchableOpacity>
        <Text style={styles.title}>AI Trip Planner 🤖</Text>
      </View>

      {/* Input Fields Card */}
      <View style={styles.inputCard}>
        <Text style={styles.cardHeader}>Enter Travel Parameters</Text>

        {/* Destination with autocomplete */}
        <View style={{ position: "relative", zIndex: 100 }}>
          <View style={styles.inputWrapper}>
            <Ionicons name="map-outline" size={18} color="#94A3B8" style={styles.inputIcon} />
            <TextInput
              placeholder="Where are you going? (e.g., Ooty)"
              placeholderTextColor="#94A3B8"
              value={destination}
              onChangeText={handleDestinationChange}
              style={styles.input}
            />
          </View>
          {showDestSuggestions && destinationSuggestions.length > 0 && (
            <View style={styles.destDropdown}>
              {destinationSuggestions.map((s, i) => (
                <TouchableOpacity
                  key={i}
                  onPress={() => { setDestination(s.name); setShowDestSuggestions(false); setDestinationSuggestions([]); }}
                  style={[styles.destSuggestionItem, i < destinationSuggestions.length - 1 && { borderBottomWidth: 1, borderBottomColor: "#0F172A" }]}
                >
                  <Ionicons name="location-outline" size={14} color="#38BDF8" />
                  <Text style={{ color: "white", marginLeft: 8, fontSize: 14 }}>{s.name}{s.country ? `, ${s.country}` : ""}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        <View style={styles.inputWrapper}>
          <Ionicons name="wallet-outline" size={18} color="#94A3B8" style={styles.inputIcon} />
          <TextInput
            placeholder="Target Budget (e.g., 15000)"
            placeholderTextColor="#94A3B8"
            value={budget}
            onChangeText={setBudget}
            keyboardType="numeric"
            style={styles.input}
          />
        </View>

        <View style={styles.inputWrapper}>
          <Ionicons name="calendar-outline" size={18} color="#94A3B8" style={styles.inputIcon} />
          <TextInput
            placeholder="Duration (e.g., 4 days)"
            placeholderTextColor="#94A3B8"
            value={days}
            onChangeText={setDays}
            keyboardType="numeric"
            style={styles.input}
          />
        </View>

        <View style={styles.inputWrapper}>
          <Ionicons name="time-outline" size={18} color="#94A3B8" style={styles.inputIcon} />
          <TextInput
            placeholder="Start Date (YYYY-MM-DD)"
            placeholderTextColor="#94A3B8"
            value={startDate}
            onChangeText={setStartDate}
            style={styles.input}
          />
        </View>

        {/* Travel Style Selector */}
        <Text style={styles.interestTitle}>💎 Travel Style</Text>
        <View style={styles.styleGrid}>
          {[
            { id: "budget", label: "🎒 Budget" },
            { id: "mid-range", label: "🚗 Mid-range" },
            { id: "luxury", label: "✨ Luxury" },
          ].map((styleOpt) => (
            <TouchableOpacity
              key={styleOpt.id}
              onPress={() => setTravelStyle(styleOpt.id)}
              style={[styles.styleChip, travelStyle === styleOpt.id && styles.styleChipActive]}
            >
              <Text style={[styles.styleChipText, travelStyle === styleOpt.id && styles.styleChipTextActive]}>
                {styleOpt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Travel Setup Mode Selector */}
        <Text style={styles.interestTitle}>👥 Travel Setup</Text>
        <View style={styles.styleGrid}>
          {[
            { id: "solo", label: "🙋 Solo Mode" },
            { id: "group", label: "👨‍👩‍👧‍👦 Group / Family" },
          ].map((modeOpt) => (
            <TouchableOpacity
              key={modeOpt.id}
              onPress={() => setGroupSoloMode(modeOpt.id)}
              style={[styles.styleChip, groupSoloMode === modeOpt.id && styles.styleChipActive]}
            >
              <Text style={[styles.styleChipText, groupSoloMode === modeOpt.id && styles.styleChipTextActive]}>
                {modeOpt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Interest Category Selector */}
        <Text style={styles.interestTitle}>🎯 What type of places do you want to visit?</Text>
        <Text style={styles.interestSubtitle}>Select your preferences (AI tailors your itinerary)</Text>
        <View style={styles.interestGrid}>
          {INTEREST_OPTIONS.map((opt) => {
            const selected = selectedInterests.includes(opt.id);
            return (
              <TouchableOpacity
                key={opt.id}
                onPress={() => toggleInterest(opt.id)}
                style={[styles.interestChip, selected && styles.interestChipActive]}
              >
                <Text style={[styles.interestChipLabel, selected && styles.interestChipLabelActive]}>
                  {opt.label}
                </Text>
                {selected && (
                  <Ionicons name="checkmark-circle" size={14} color="#38BDF8" style={{ marginTop: 2 }} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity
          onPress={generateTrip}
          style={[styles.generateBtn, loading && { opacity: 0.7 }]}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="white" size="small" />
          ) : (
            <Text style={styles.generateBtnText}>Compile AI Itinerary 🚀</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* AI Output Result Section */}
      {result ? (
        <View style={styles.resultCard}>
          <View style={styles.resultHeader}>
            <Ionicons name="sparkles" size={20} color="#EAB308" />
            <Text style={styles.resultTitle}>Your Custom Itinerary</Text>
          </View>
          <Text style={styles.resultDesc}>{result}</Text>

          {/* Active interests tags */}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
            {selectedInterests.map((id) => {
              const opt = INTEREST_OPTIONS.find((o) => o.id === id);
              return opt ? (
                <View key={id} style={styles.interestTag}>
                  <Text style={styles.interestTagText}>{opt.label}</Text>
                </View>
              ) : null;
            })}
          </View>

          {/* Day schedules preview list */}
          {parsedDays.map((day, idx) => (
            <View key={idx} style={styles.dayBlock}>
              <View style={styles.dayHeaderRow}>
                <View style={styles.dayBadge}>
                  <Text style={styles.dayBadgeText}>Day {day.dayNumber}</Text>
                </View>
                <Text style={styles.dayTitleText}>{day.title}</Text>
              </View>

              <Text style={styles.dayDateText}>🗓️ {day.date}</Text>
              <Text style={styles.dayNotesText}>{day.notes}</Text>

              <Text style={styles.spotsTitle}>📍 STOPS:</Text>
              {day.destinations.map((dest, sIdx) => (
                <View key={sIdx} style={styles.spotRow}>
                  <Ionicons name="pin" size={14} color="#38BDF8" />
                  <Text style={styles.spotNameText}>{dest.name}</Text>
                </View>
              ))}
            </View>
          ))}

          {/* Action buttons */}
          <TouchableOpacity
            onPress={handleSaveTrip}
            style={[styles.saveBtn, saving && { opacity: 0.7 }]}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="white" size="small" />
            ) : (
              <>
                <Ionicons name="checkmark-circle-outline" size={20} color="white" style={{ marginRight: 6 }} />
                <Text style={styles.saveBtnText}>Save & View Trip ✓</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={{ height: 100 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: "#0F172A",
    padding: 20,
  },
  headerArea: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 50,
    marginBottom: 25,
    gap: 15,
  },
  backBtn: {
    backgroundColor: "#1E293B",
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#334155",
  },
  title: {
    color: "white",
    fontSize: 28,
    fontWeight: "bold",
  },
  inputCard: {
    backgroundColor: "#1E293B",
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: "#334155",
  },
  cardHeader: {
    color: "#CBD5E1",
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 16,
  },
  inputWrapper: {
    backgroundColor: "#0F172A",
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#334155",
  },
  inputIcon: {
    paddingLeft: 14,
    paddingRight: 8,
  },
  input: {
    flex: 1,
    color: "white",
    paddingVertical: 14,
    fontSize: 14,
    paddingRight: 14,
  },
  destDropdown: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    backgroundColor: "#1E293B",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#334155",
    zIndex: 999,
    overflow: "hidden",
    marginTop: -6,
  },
  destSuggestionItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
  },
  interestTitle: {
    color: "white",
    fontSize: 15,
    fontWeight: "bold",
    marginTop: 4,
    marginBottom: 4,
  },
  interestSubtitle: {
    color: "#94A3B8",
    fontSize: 12,
    marginBottom: 12,
  },
  interestGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 16,
  },
  interestChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#0F172A",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#334155",
  },
  interestChipActive: {
    borderColor: "#38BDF8",
    backgroundColor: "rgba(56,189,248,0.1)",
  },
  interestChipLabel: {
    color: "#94A3B8",
    fontSize: 12,
    fontWeight: "600",
  },
  interestChipLabelActive: {
    color: "#38BDF8",
  },
  generateBtn: {
    backgroundColor: "#38BDF8",
    padding: 16,
    borderRadius: 14,
    marginTop: 4,
    alignItems: "center",
    shadowColor: "#38BDF8",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  generateBtnText: {
    color: "white",
    fontWeight: "bold",
    fontSize: 16,
  },
  resultCard: {
    backgroundColor: "#1E293B",
    borderRadius: 24,
    padding: 20,
    marginTop: 25,
    borderWidth: 1,
    borderColor: "#38BDF8",
  },
  resultHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  resultTitle: {
    color: "white",
    fontSize: 18,
    fontWeight: "bold",
  },
  resultDesc: {
    color: "#CBD5E1",
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 12,
  },
  interestTag: {
    backgroundColor: "rgba(56,189,248,0.12)",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "rgba(56,189,248,0.3)",
  },
  interestTagText: {
    color: "#38BDF8",
    fontSize: 11,
    fontWeight: "600",
  },
  dayBlock: {
    backgroundColor: "#0F172A",
    padding: 16,
    borderRadius: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#334155",
  },
  dayHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 6,
  },
  dayBadge: {
    backgroundColor: "#38BDF8",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  dayBadgeText: {
    color: "white",
    fontWeight: "bold",
    fontSize: 12,
  },
  dayTitleText: {
    color: "white",
    fontSize: 15,
    fontWeight: "bold",
    flex: 1,
  },
  dayDateText: {
    color: "#94A3B8",
    fontSize: 12,
    marginBottom: 8,
  },
  dayNotesText: {
    color: "#CBD5E1",
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 12,
  },
  spotsTitle: {
    color: "#EAB308",
    fontWeight: "bold",
    fontSize: 11,
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  spotRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  spotNameText: {
    color: "white",
    fontSize: 13,
  },
  saveBtn: {
    backgroundColor: "#22C55E",
    padding: 16,
    borderRadius: 14,
    marginTop: 15,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    shadowColor: "#22C55E",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  saveBtnText: {
    color: "white",
    fontWeight: "bold",
    fontSize: 16,
  },
  styleGrid: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 16,
    marginTop: 6,
  },
  styleChip: {
    flex: 1,
    backgroundColor: "#0F172A",
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#334155",
  },
  styleChipActive: {
    borderColor: "#38BDF8",
    backgroundColor: "rgba(56,189,248,0.1)",
  },
  styleChipText: {
    color: "#94A3B8",
    fontSize: 13,
    fontWeight: "600",
  },
  styleChipTextActive: {
    color: "#38BDF8",
  },
});