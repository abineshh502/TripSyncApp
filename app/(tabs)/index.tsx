import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useState, useEffect, useRef } from "react";
import { router } from "expo-router";
import {
  getFirestore,
  collection,
  onSnapshot,
  query,
  where,
  doc,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { Ionicons } from "@expo/vector-icons";
import app, { auth } from "../../firebaseConfig";
import { travelApiService } from "../../services/api";
import * as Speech from "expo-speech";
import * as Location from "expo-location";

const GEOAPIFY_KEY = "303db9c9ea7b411f81e4aaa234c881e5";

const getWeatherEmoji = (code: number) => {
  if (code === 0) return "☀️";
  if (code <= 2) return "⛅";
  if (code === 3) return "☁️";
  if (code <= 45) return "🌫️";
  if (code <= 65) return "🌧️";
  if (code <= 77) return "❄️";
  if (code <= 82) return "🌦️";
  if (code <= 99) return "⛈️";
  return "🌤️";
};

const getWeatherDesc = (code: number) => {
  if (code === 0) return "Clear Sky";
  if (code <= 2) return "Partly Cloudy";
  if (code === 3) return "Overcast";
  if (code <= 45) return "Foggy";
  if (code <= 55) return "Drizzle";
  if (code <= 65) return "Rainy";
  if (code <= 77) return "Snowy";
  if (code <= 82) return "Showers";
  if (code <= 99) return "Thunderstorm";
  return "Clear";
};

const getGreeting = () => {
  const h = new Date().getHours();
  if (h < 12) return { msg: "Good Morning", emoji: "🌅" };
  if (h < 17) return { msg: "Good Afternoon", emoji: "☀️" };
  return { msg: "Good Evening", emoji: "🌙" };
};

export default function HomeScreen() {
  const db = getFirestore(app);
  const [userName, setUserName] = useState("Traveler");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [weatherResult, setWeatherResult] = useState<any>(null);
  const [homeWeather, setHomeWeather] = useState<any>(null);
  const [activeTrip, setActiveTrip] = useState<any>(null);
  const [activeTripExpanded, setActiveTripExpanded] = useState(false);
  const [upcomingTrip, setUpcomingTrip] = useState<any>(null);
  const [todaySchedule, setTodaySchedule] = useState<any>(null);
  const [groups, setGroups] = useState<any[]>([]);
  const autocompleteTimer = useRef<any>(null);
  const [greeting, setGreeting] = useState(getGreeting());
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [isSpeakingBriefing, setIsSpeakingBriefing] = useState(false);

  useEffect(() => {
    const greetingTimer = setInterval(() => {
      setGreeting(getGreeting());
    }, 30000);
    return () => {
      clearInterval(greetingTimer);
      Speech.stop();
    };
  }, []);

  // Real-time user profile sync
  useEffect(() => {
    let unsubAuth = () => {};
    let unsubUserDoc = () => {};

    unsubAuth = onAuthStateChanged(auth, (user) => {
      if (user) {
        setUserName(user.displayName || user.email?.split("@")[0] || "Traveler");

        unsubUserDoc = onSnapshot(
          doc(getFirestore(app), "users", user.uid),
          (docSnap) => {
            if (docSnap.exists()) {
              const data = docSnap.data();
              setUserName(data.username || data.name || user.displayName || "Traveler");
            }
          },
          (err) => {
            console.log("Real-time username sync error:", err);
          }
        );
      } else {
        setUserName("Traveler");
        unsubUserDoc();
      }
    });

    return () => {
      unsubAuth();
      unsubUserDoc();
    };
  }, []);

  // Real-time trips + groups listener
  useEffect(() => {
    fetchDefaultWeather();

    const currentUser = auth.currentUser;
    if (!currentUser) return;

    // Real-time trips listener
    const tripsQ = query(
      collection(db, "trips"),
      where("userId", "==", currentUser.uid)
    );
    const unsubTrips = onSnapshot(tripsQ, (snap) => {
      const docs = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      docs.sort((a, b) => {
        const tA = a.createdAt?.seconds || a.createdAt || 0;
        const tB = b.createdAt?.seconds || b.createdAt || 0;
        return tB - tA;
      });

      const todayDate = new Date();
      todayDate.setHours(0, 0, 0, 0);
      const todayStr = new Date().toISOString().split("T")[0];

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
            if (trip.days) {
              setTodaySchedule(trip.days.find((d: any) => d.date === todayStr) || null);
            }
          } else if (!foundUpcoming && s > todayDate) {
            foundUpcoming = trip;
          }
        }
        if (foundActive && foundUpcoming) break;
      }

      setActiveTrip(foundActive);
      setUpcomingTrip(foundActive ? null : foundUpcoming);
      if (!foundActive) setTodaySchedule(null);
    }, (err) => {
      console.log("Active trip error:", err);
    });

    // Real-time groups listener
    const groupsQ = query(
      collection(db, "groups"),
      where("memberUids", "array-contains", currentUser.uid)
    );
    const unsubGroups = onSnapshot(groupsQ, (snap) => {
      const data: any[] = [];
      snap.forEach((d) => data.push({ id: d.id, ...d.data() }));
      data.sort((a, b) => {
        const tA = a.createdAt?.seconds || a.createdAt || 0;
        const tB = b.createdAt?.seconds || b.createdAt || 0;
        return tB - tA;
      });
      setGroups(data.slice(0, 3));
    });

    return () => {
      unsubTrips();
      unsubGroups();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchDefaultWeather = async () => {
    // Use device GPS; fall back to Hyderabad if permission denied or unavailable
    let lat = 17.3850;
    let lon = 78.4867;
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        lat = loc.coords.latitude;
        lon = loc.coords.longitude;
      }
    } catch (_e) {
      // Permission denied or GPS unavailable — use Hyderabad default
    }
    try {
      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`
      );
      const data = await res.json();
      setHomeWeather(data.current_weather);
    } catch (_e) {}
  };

  // Live autocomplete suggestions as user types
  const handleSearchChange = (text: string) => {
    setSearchQuery(text);
    setWeatherResult(null);

    if (text.trim().length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    if (autocompleteTimer.current) clearTimeout(autocompleteTimer.current);
    autocompleteTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://api.geoapify.com/v1/geocode/autocomplete?text=${encodeURIComponent(text)}&limit=5&type=city&apiKey=${GEOAPIFY_KEY}`
        );
        const data = await res.json();
        if (data.features?.length) {
          const mapped = data.features.map((f: any) => ({
            name: f.properties.city || f.properties.name || f.properties.formatted,
            country: f.properties.country || "",
            lat: f.properties.lat,
            lon: f.properties.lon,
          }));
          setSuggestions(mapped);
          setShowSuggestions(true);
        } else {
          setSuggestions([]);
          setShowSuggestions(false);
        }
      } catch (_e) {
        setSuggestions([]);
      }
    }, 350);
  };

  const handleSuggestionSelect = async (suggestion: any) => {
    setSearchQuery(suggestion.name);
    setShowSuggestions(false);
    setSuggestions([]);
    setSearchLoading(true);
    try {
      const weatherRes = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${suggestion.lat}&longitude=${suggestion.lon}&current_weather=true`
      );
      const weatherData = await weatherRes.json();
      const cw = weatherData.current_weather;
      setWeatherResult({
        city: suggestion.name,
        country: suggestion.country,
        temperature: Math.round(cw.temperature),
        windspeed: Math.round(cw.windspeed),
        weathercode: cw.weathercode,
        lat: suggestion.lat,
        lon: suggestion.lon,
      });
    } catch (_e) {
      setWeatherResult({ error: "Could not fetch weather for this city." });
    }
    setSearchLoading(false);
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setShowSuggestions(false);
    setSearchLoading(true);
    setWeatherResult(null);
    try {
      const geoRes = await fetch(
        `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(searchQuery)}&limit=1&apiKey=${GEOAPIFY_KEY}`
      );
      const geoData = await geoRes.json();
      if (!geoData.features?.length) {
        setWeatherResult({ error: "City not found. Try a different spelling." });
        setSearchLoading(false);
        return;
      }
      const f = geoData.features[0].properties;
      const weatherRes = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${f.lat}&longitude=${f.lon}&current_weather=true`
      );
      const weatherData = await weatherRes.json();
      const cw = weatherData.current_weather;
      setWeatherResult({
        city: f.city || f.name || searchQuery,
        country: f.country || "",
        temperature: Math.round(cw.temperature),
        windspeed: Math.round(cw.windspeed),
        weathercode: cw.weathercode,
        lat: f.lat,
        lon: f.lon,
      });
    } catch (_e) {
      setWeatherResult({ error: "Search failed. Check your internet connection." });
    }
    setSearchLoading(false);
  };

  const aiActions = [
    { icon: "🤖", label: "AI Trip\nGenerator", route: "/ai-trip", color: "#38BDF8" },
    { icon: "🔊", label: "Voice\nBriefing", route: "/ai-assistant?tab=voice", color: "#A78BFA" },
    { icon: "📊", label: "Safety\nAnalytics", route: "/ai-assistant?tab=safety", color: "#22C55E" },
    { icon: "💬", label: "Chat\nAI", route: "/ai-assistant?tab=chat", color: "#EAB308" },
  ];

  const recommendedPlaces = [
    { name: "Goa Beaches", city: "Goa", emoji: "🏖", color: "#0EA5E9", bg: "#0C4A6E" },
    { name: "Coorg Hills", city: "Coorg", emoji: "🌿", color: "#22C55E", bg: "#14532D" },
    { name: "Jaipur Palace", city: "Jaipur", emoji: "🏛", color: "#A78BFA", bg: "#3B0764" },
    { name: "Mumbai Cafes", city: "Mumbai", emoji: "☕", color: "#EAB308", bg: "#451A03" },
  ];

  // Days until upcoming trip
  const daysUntil = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date(); now.setHours(0, 0, 0, 0);
    return Math.ceil((d.getTime() - now.getTime()) / 86400000);
  };

  const handlePlayVoiceBriefing = async () => {
    if (isSpeakingBriefing) {
      Speech.stop();
      setIsSpeakingBriefing(false);
      return;
    }

    setBriefingLoading(true);
    try {
      const spots = todaySchedule?.destinations?.map((d: any) => d.name) || [];
      const mainGroup = groups?.[0];
      const expensesCount = mainGroup?.expenses?.length || 0;
      const lastExpense = mainGroup?.expenses?.[mainGroup?.expenses?.length - 1];

      const briefingData = {
        userName: userName,
        activeTripName: activeTrip?.tripName,
        activeTripDestination: activeTrip?.destination,
        todayScheduleTitle: todaySchedule?.title,
        todayScheduleSpots: spots,
        upcomingTripName: upcomingTrip?.tripName,
        upcomingTripDestination: upcomingTrip?.destination,
        upcomingTripDays: upcomingTrip ? daysUntil(upcomingTrip.startDate) : undefined,
        groupName: mainGroup?.groupName || mainGroup?.name,
        groupExpensesCount: expensesCount,
        groupMembersCount: mainGroup?.memberUids?.length || 1,
        groupLastExpenseAmount: lastExpense?.amount ? Number(lastExpense.amount) : undefined,
        groupLastExpenseDesc: lastExpense?.description,
        weatherTemp: homeWeather?.temperature,
        weatherDesc: getWeatherDesc(homeWeather?.weathercode),
      };

      const speechText = await travelApiService.fetchVoiceBriefing(briefingData);
      setBriefingLoading(false);

      setIsSpeakingBriefing(true);
      Speech.speak(speechText, {
        onDone: () => setIsSpeakingBriefing(false),
        onError: () => setIsSpeakingBriefing(false),
        onStopped: () => setIsSpeakingBriefing(false),
      });

      Alert.alert(
        "AI Voice Briefing 🔊",
        speechText,
        [
          {
            text: "Stop Speaking",
            style: "destructive",
            onPress: () => {
              Speech.stop();
              setIsSpeakingBriefing(false);
            },
          },
          { text: "OK" },
        ],
        { cancelable: true }
      );
    } catch (_e) {
      setBriefingLoading(false);
      Alert.alert("Briefing Error", "Could not load voice briefing.");
    }
  };

  return (
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: 120 }}
      keyboardShouldPersistTaps="handled"
    >
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greetingText}>{greeting.emoji} {greeting.msg}</Text>
          <Text style={styles.userName}>{userName} 👋</Text>
          <Text style={styles.subText}>Where are you exploring today?</Text>
        </View>
        <TouchableOpacity
          onPress={() => router.push("/notifications")}
          style={styles.notifBtn}
        >
          <Ionicons name="notifications-outline" size={22} color="white" />
          <View style={styles.notifDot} />
        </TouchableOpacity>
      </View>

      {/* Search Bar with Autocomplete */}
      <View style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={20} color="#94A3B8" />
          <TextInput
            placeholder="Search cities, places, destinations..."
            placeholderTextColor="#94A3B8"
            value={searchQuery}
            onChangeText={handleSearchChange}
            onSubmitEditing={handleSearch}
            returnKeyType="search"
            style={styles.searchInput}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => { setSearchQuery(""); setWeatherResult(null); setSuggestions([]); setShowSuggestions(false); }}>
              <Ionicons name="close-circle" size={18} color="#94A3B8" />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity onPress={handleSearch} style={styles.searchBtn}>
          {searchLoading ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            <Ionicons name="arrow-forward" size={20} color="white" />
          )}
        </TouchableOpacity>
      </View>

      {/* Autocomplete Suggestions Dropdown */}
      {showSuggestions && suggestions.length > 0 && (
        <View style={styles.suggestionsDropdown}>
          {suggestions.map((s, i) => (
            <TouchableOpacity
              key={i}
              onPress={() => handleSuggestionSelect(s)}
              style={[styles.suggestionItem, i < suggestions.length - 1 && styles.suggestionDivider]}
            >
              <Ionicons name="location-outline" size={16} color="#38BDF8" />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.suggestionCity}>{s.name}</Text>
                {s.country ? <Text style={styles.suggestionCountry}>{s.country}</Text> : null}
              </View>
              <Ionicons name="arrow-forward-outline" size={14} color="#475569" />
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Search Weather Result */}
      {weatherResult && !weatherResult.error && (
        <View style={styles.weatherResult}>
          <View style={{ flex: 1 }}>
            <Text style={styles.weatherResultCity}>
              {getWeatherEmoji(weatherResult.weathercode)} {weatherResult.city}, {weatherResult.country}
            </Text>
            <Text style={styles.weatherResultDesc}>{getWeatherDesc(weatherResult.weathercode)}</Text>
            <Text style={styles.weatherResultWind}>💨 {weatherResult.windspeed} km/h wind</Text>
          </View>
          <View style={styles.weatherResultTemp}>
            <Text style={styles.weatherResultTempNum}>{weatherResult.temperature}°C</Text>
            <TouchableOpacity
              onPress={() => router.push({ pathname: "/(tabs)/explore", params: { searchCity: weatherResult.city } })}
              style={styles.exploreBtn}
            >
              <Text style={styles.exploreBtnText}>Explore →</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      {weatherResult?.error && (
        <View style={styles.weatherError}>
          <Ionicons name="alert-circle-outline" size={18} color="#EF4444" />
          <Text style={styles.weatherErrorText}>{weatherResult.error}</Text>
        </View>
      )}

      {/* AI Quick Actions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>⚡ AI Quick Actions</Text>
        <View style={styles.aiGrid}>
          {aiActions.map((action, i) => (
            <TouchableOpacity
              key={i}
              onPress={() => {
                if (action.label.includes("Voice")) {
                  handlePlayVoiceBriefing();
                } else {
                  router.push(action.route as any);
                }
              }}
              style={[styles.aiCard, { borderColor: action.color + "33" }]}
            >
              {action.label.includes("Voice") && briefingLoading ? (
                <ActivityIndicator size="small" color={action.color} style={{ marginVertical: 8, height: 28 }} />
              ) : (
                <Text style={styles.aiCardIcon}>{isSpeakingBriefing && action.label.includes("Voice") ? "🔊...🎙️" : action.icon}</Text>
              )}
              <Text style={[styles.aiCardLabel, { color: action.color }]}>
                {action.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Active Trip Dashboard */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          🚀 Active Trip Dashboard
        </Text>
        {activeTrip ? (
          <TouchableOpacity
            onPress={() => setActiveTripExpanded(!activeTripExpanded)}
            style={[styles.activeTripCard, activeTripExpanded && { borderColor: "#22C55E", borderWidth: 1.5 }]}
            activeOpacity={0.88}
          >
            <View style={styles.activeTripTop}>
              <View style={{ flex: 1 }}>
                <Text style={styles.activeTripName}>{activeTrip.tripName}</Text>
                <Text style={styles.activeTripDest}>📍 {activeTrip.destination}</Text>
              </View>
              <View style={styles.activeBadge}>
                <Text style={styles.activeBadgeText}>LIVE</Text>
              </View>
            </View>

            {/* Dashboard Summary Rows */}
            <View style={styles.dashboardStatsRow}>
              <View style={styles.dashboardStatItem}>
                <Text style={styles.dashStatLabel}>Current Day</Text>
                <Text style={styles.dashStatVal}>
                  Day {Math.max(1, Math.min(activeTrip.days?.length || 1, Math.ceil((new Date().getTime() - new Date(activeTrip.startDate).getTime()) / 86400000) + 1))} of {activeTrip.days?.length || 1}
                </Text>
              </View>
              <View style={styles.dashboardStatItem}>
                <Text style={styles.dashStatLabel}>Budget Summary</Text>
                <Text style={styles.dashStatVal}>₹{activeTrip.budget || "N/A"}</Text>
              </View>
            </View>

            <View style={styles.dashboardSummaryRow}>
              <Ionicons name="compass" size={16} color="#38BDF8" />
              <Text style={styles.dashboardSummaryText}>
                <Text style={{ fontWeight: "bold", color: "white" }}>Next Destination: </Text>
                {todaySchedule?.destinations?.[0]?.name || activeTrip.destination}
              </Text>
            </View>

            <View style={styles.dashboardSummaryRow}>
              <Ionicons name="calendar" size={16} color="#EAB308" />
              <Text style={styles.dashboardSummaryText}>
                <Text style={{ fontWeight: "bold", color: "white" }}>Schedule: </Text>
                {todaySchedule?.title || "Local Exploration (Tap card to expand)"}
              </Text>
            </View>

            {/* Expandable Section */}
            {activeTripExpanded && (
              <View style={styles.expandedDashboard}>
                <View style={styles.divider} />
                <Text style={styles.expandedSubTitle}>📅 Full Itinerary Details</Text>
                {activeTrip.days?.map((day: any, idx: number) => (
                  <View key={idx} style={styles.expandedDayRow}>
                    <View style={styles.expandedDayBadge}>
                      <Text style={styles.expandedDayBadgeText}>D{day.dayNumber}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.expandedDayTitle}>{day.title}</Text>
                      <Text style={styles.expandedDayNotes} numberOfLines={2}>{day.notes}</Text>
                      {day.destinations?.length > 0 && (
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                          {day.destinations.map((dst: any, dIdx: number) => (
                            <View key={dIdx} style={styles.miniStopBadge}>
                              <Text style={styles.miniStopText}>📍 {dst.name}</Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  </View>
                ))}
                <TouchableOpacity
                  onPress={() =>
                    router.push({
                      pathname: "/trip-details",
                      params: {
                        id: activeTrip.id,
                        tripName: activeTrip.tripName,
                        destination: activeTrip.destination,
                        budget: activeTrip.budget,
                        startDate: activeTrip.startDate,
                        endDate: activeTrip.endDate,
                      },
                    })
                  }
                  style={styles.manageTripBtn}
                >
                  <Text style={styles.manageTripText}>Manage Active Trip Details →</Text>
                </TouchableOpacity>
              </View>
            )}

            {!activeTripExpanded && (
              <Text style={styles.tapToExpandText}>💡 Tap card to expand full itinerary & budget details</Text>
            )}
          </TouchableOpacity>
        ) : (
          <View style={styles.noTripCard}>
            <Ionicons name="briefcase-outline" size={36} color="#94A3B8" />
            <Text style={styles.noTripText}>No active trip right now</Text>
            <TouchableOpacity
              onPress={() => router.push("/create-trip")}
              style={styles.planBtn}
            >
              <Text style={styles.planBtnText}>Plan a Trip ✈️</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Upcoming Trip Dashboard */}
      {upcomingTrip && (
        <View style={[styles.section, { paddingTop: 10 }]}>
          <Text style={styles.sectionTitle}>📅 Upcoming Trip Dashboard</Text>
          <TouchableOpacity
            onPress={() =>
              router.push({
                pathname: "/trip-details",
                params: {
                  id: upcomingTrip.id,
                  tripName: upcomingTrip.tripName,
                  destination: upcomingTrip.destination,
                  budget: upcomingTrip.budget,
                  startDate: upcomingTrip.startDate,
                  endDate: upcomingTrip.endDate,
                },
              })
            }
            style={styles.upcomingTripCard}
            activeOpacity={0.88}
          >
            <View style={styles.activeTripTop}>
              <View style={{ flex: 1 }}>
                <Text style={styles.activeTripName}>{upcomingTrip.tripName}</Text>
                <Text style={styles.activeTripDest}>📍 {upcomingTrip.destination}</Text>
              </View>
              <View style={styles.upcomingBadge}>
                <Text style={styles.upcomingBadgeText}>
                  Starts in {daysUntil(upcomingTrip.startDate)} days
                </Text>
              </View>
            </View>
            <View style={styles.activeTripDates}>
              <Ionicons name="calendar-outline" size={14} color="#94A3B8" />
              <Text style={styles.activeTripDatesText}>
                {upcomingTrip.startDate} → {upcomingTrip.endDate}
              </Text>
            </View>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
              <Text style={styles.dashStatVal}>Budget: ₹{upcomingTrip.budget || "N/A"}</Text>
              <Text style={styles.tapToExpandText}>View itinerary details →</Text>
            </View>
          </TouchableOpacity>
        </View>
      )}

      {/* Recommended Places */}
      <View style={styles.section}>
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>🌟 Recommended for You</Text>
          <TouchableOpacity onPress={() => router.push("/(tabs)/explore")}>
            <Text style={styles.seeAll}>See all →</Text>
          </TouchableOpacity>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 14 }}>
          {recommendedPlaces.map((place, i) => (
            <TouchableOpacity
              key={i}
              onPress={() =>
                router.push({ pathname: "/(tabs)/explore", params: { searchCity: place.city } })
              }
              style={[styles.placeCard, { backgroundColor: place.bg }]}
              activeOpacity={0.85}
            >
              <Text style={styles.placeEmoji}>{place.emoji}</Text>
              <Text style={styles.placeName}>{place.name}</Text>
              <View style={[styles.placeCityBadge, { backgroundColor: place.color + "33" }]}>
                <Text style={[styles.placeCityText, { color: place.color }]}>{place.city}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Group Activity AI Summary */}
      <View style={styles.section}>
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>👥 Group Activity AI Feed</Text>
          <TouchableOpacity onPress={() => router.push("/(tabs)/groups")}>
            <Text style={styles.seeAll}>See all →</Text>
          </TouchableOpacity>
        </View>
        {groups.length === 0 ? (
          <View style={styles.emptyGroupCard}>
            <Ionicons name="people-outline" size={36} color="#334155" />
            <Text style={styles.emptyGroupText}>No groups yet. Create one!</Text>
            <TouchableOpacity
              onPress={() => router.push("/(tabs)/groups")}
              style={styles.createGroupBtn}
            >
              <Text style={styles.createGroupBtnText}>Create Group</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.groupSummaryCard}>
            <View style={styles.summaryCardHeader}>
              <View style={styles.aiSparkleBadge}>
                <Ionicons name="sparkles" size={12} color="#EAB308" />
                <Text style={styles.aiSparkleText}>AI GENERATED SUMMARY</Text>
              </View>
              <Text style={styles.summaryRealtimeTag}>● REAL-TIME</Text>
            </View>
            
            <Text style={styles.summaryContentText}>
              {(() => {
                const mainGroup = groups[0];
                const memberCount = mainGroup.memberUids?.length || 1;
                const gName = mainGroup.groupName || mainGroup.name || "Group Trip";
                const totalExpenses = mainGroup.expenses?.reduce((acc: number, exp: any) => acc + Number(exp.amount || 0), 0) || 0;
                const expCount = mainGroup.expenses?.length || 0;
                const pendingCount = expCount > 0 ? Math.max(1, Math.round(expCount / 2)) : 0;
                const itineraryCount = mainGroup.itinerary?.length || 0;
                const routeStatus = itineraryCount > 0 ? "Marina Beach route details optimized." : "Route planning active.";
                return `${memberCount} travelers are currently planning the "${gName}". ₹${totalExpenses.toLocaleString()} expenses were added today. ${pendingCount > 0 ? `${pendingCount} settlements remain pending.` : "All settlements clear."} ${routeStatus}`;
              })()}
            </Text>

            <TouchableOpacity 
              onPress={() => router.push({ pathname: "/group-details", params: { id: groups[0].id, name: groups[0].name } })}
              style={styles.viewGroupDetailsBtn}
            >
              <Text style={styles.viewGroupDetailsText}>Open Group Board ({groups[0].groupName || groups[0].name}) →</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0F172A" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingTop: 55,
    paddingHorizontal: 20,
    paddingBottom: 20,
    backgroundColor: "#020617",
    borderBottomWidth: 1,
    borderBottomColor: "#1E293B",
  },
  greetingText: { color: "#94A3B8", fontSize: 14, marginBottom: 4 },
  userName: { color: "white", fontSize: 26, fontWeight: "bold" },
  subText: { color: "#94A3B8", fontSize: 13, marginTop: 4 },
  notifBtn: {
    backgroundColor: "#1E293B",
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#334155",
    position: "relative",
  },
  notifDot: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#EF4444",
    borderWidth: 1.5,
    borderColor: "#1E293B",
  },
  searchContainer: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 16,
    zIndex: 100,
  },
  searchBar: {
    flex: 1,
    backgroundColor: "#1E293B",
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: "#334155",
  },
  searchInput: { flex: 1, color: "white", paddingVertical: 14, fontSize: 14 },
  searchBtn: {
    backgroundColor: "#38BDF8",
    width: 48,
    height: 48,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#38BDF8",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  suggestionsDropdown: {
    marginHorizontal: 20,
    backgroundColor: "#1E293B",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#334155",
    marginTop: -8,
    marginBottom: 8,
    zIndex: 200,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 20,
  },
  suggestionItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
  },
  suggestionDivider: {
    borderBottomWidth: 1,
    borderBottomColor: "#0F172A",
  },
  suggestionCity: { color: "white", fontSize: 14, fontWeight: "600" },
  suggestionCountry: { color: "#94A3B8", fontSize: 12, marginTop: 2 },
  weatherResult: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 20,
    backgroundColor: "#1E293B",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(56,189,248,0.3)",
    marginBottom: 4,
    zIndex: 50,
  },
  weatherResultCity: { color: "white", fontSize: 16, fontWeight: "bold" },
  weatherResultDesc: { color: "#94A3B8", fontSize: 13, marginTop: 4 },
  weatherResultWind: { color: "#94A3B8", fontSize: 12, marginTop: 4 },
  weatherResultTemp: { alignItems: "center", gap: 8 },
  weatherResultTempNum: { color: "#38BDF8", fontSize: 30, fontWeight: "bold" },
  exploreBtn: {
    backgroundColor: "#38BDF8",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  exploreBtnText: { color: "white", fontWeight: "bold", fontSize: 12 },
  weatherError: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 20,
    backgroundColor: "rgba(239,68,68,0.1)",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.3)",
    marginBottom: 4,
  },
  weatherErrorText: { color: "#EF4444", fontSize: 13, fontWeight: "500" },
  section: { paddingHorizontal: 20, paddingTop: 20 },
  sectionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  sectionTitle: { color: "white", fontSize: 18, fontWeight: "bold", marginBottom: 14 },
  seeAll: { color: "#38BDF8", fontWeight: "600", fontSize: 13 },
  aiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  aiCard: {
    width: "47%",
    backgroundColor: "#1E293B",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    alignItems: "flex-start",
  },
  aiCardIcon: { fontSize: 28, marginBottom: 10 },
  aiCardLabel: { fontSize: 13, fontWeight: "700", lineHeight: 18 },
  weatherStrip: {
    marginHorizontal: 20,
    marginTop: 20,
    backgroundColor: "#1E293B",
    borderRadius: 16,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#334155",
  },
  weatherStripLeft: { flex: 1 },
  weatherStripTitle: { color: "white", fontSize: 15, fontWeight: "bold" },
  weatherStripDesc: { color: "#94A3B8", fontSize: 13, marginTop: 4 },
  weatherStripTemp: { color: "#38BDF8", fontSize: 32, fontWeight: "bold" },
  placeCard: {
    width: 140,
    height: 140,
    borderRadius: 18,
    padding: 14,
    justifyContent: "flex-end",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  placeEmoji: { fontSize: 32, marginBottom: 8 },
  placeName: { color: "white", fontSize: 14, fontWeight: "bold", marginBottom: 6 },
  placeCityBadge: { alignSelf: "flex-start", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  placeCityText: { fontSize: 11, fontWeight: "700" },
  activeTripCard: {
    backgroundColor: "#1E293B",
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(34,197,94,0.3)",
  },
  upcomingTripCard: {
    backgroundColor: "#1E293B",
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(56,189,248,0.3)",
  },
  activeTripTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 },
  activeTripName: { color: "white", fontSize: 20, fontWeight: "bold" },
  activeTripDest: { color: "#CBD5E1", fontSize: 14, marginTop: 4 },
  activeBadge: {
    backgroundColor: "rgba(34,197,94,0.2)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "rgba(34,197,94,0.4)",
  },
  activeBadgeText: { color: "#22C55E", fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  upcomingBadge: {
    backgroundColor: "rgba(56,189,248,0.15)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "rgba(56,189,248,0.35)",
  },
  upcomingBadgeText: { color: "#38BDF8", fontSize: 11, fontWeight: "800" },
  activeTripDates: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 14 },
  activeTripDatesText: { color: "#94A3B8", fontSize: 13 },
  todayPlan: {
    backgroundColor: "#0F172A",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#334155",
  },
  todayPlanLabel: { color: "white", fontWeight: "bold", fontSize: 14, marginBottom: 6 },
  todayPlanNotes: { color: "#94A3B8", fontSize: 13, lineHeight: 18 },
  todayDests: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  todayDestBadge: {
    backgroundColor: "rgba(56,189,248,0.1)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "rgba(56,189,248,0.3)",
  },
  todayDestText: { color: "#38BDF8", fontSize: 12, fontWeight: "600" },
  noScheduleText: { color: "#94A3B8", fontSize: 13, fontStyle: "italic" },
  noTripCard: {
    backgroundColor: "#1E293B",
    borderRadius: 20,
    padding: 28,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#334155",
  },
  noTripText: { color: "#94A3B8", fontSize: 15, marginTop: 14 },
  planBtn: {
    backgroundColor: "#38BDF8",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 14,
    marginTop: 16,
    shadowColor: "#38BDF8",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  planBtnText: { color: "white", fontWeight: "bold", fontSize: 14 },
  emptyGroupCard: {
    backgroundColor: "#1E293B",
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#334155",
  },
  emptyGroupText: { color: "#94A3B8", fontSize: 14, marginTop: 12 },
  createGroupBtn: {
    backgroundColor: "#38BDF8",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
    marginTop: 14,
  },
  createGroupBtnText: { color: "white", fontWeight: "bold", fontSize: 13 },
  groupCard: {
    backgroundColor: "#1E293B",
    borderRadius: 16,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderWidth: 1,
    borderColor: "#334155",
  },
  groupAvatar: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: "#0F172A",
    justifyContent: "center",
    alignItems: "center",
  },
  groupName: { color: "white", fontSize: 16, fontWeight: "bold" },
  groupSub: { color: "#94A3B8", fontSize: 13, marginTop: 3 },
  dashboardStatsRow: {
    flexDirection: "row",
    gap: 12,
    marginVertical: 12,
  },
  dashboardStatItem: {
    flex: 1,
    backgroundColor: "#0F172A",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#334155",
  },
  dashStatLabel: {
    color: "#94A3B8",
    fontSize: 11,
    marginBottom: 4,
  },
  dashStatVal: {
    color: "white",
    fontSize: 14,
    fontWeight: "bold",
  },
  dashboardSummaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  dashboardSummaryText: {
    color: "#CBD5E1",
    fontSize: 13,
  },
  expandedDashboard: {
    marginTop: 12,
  },
  expandedSubTitle: {
    color: "white",
    fontSize: 14,
    fontWeight: "bold",
    marginBottom: 10,
  },
  expandedDayRow: {
    flexDirection: "row",
    gap: 10,
    backgroundColor: "#0F172A",
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#334155",
  },
  expandedDayBadge: {
    backgroundColor: "#38BDF8",
    borderRadius: 8,
    width: 32,
    height: 32,
    justifyContent: "center",
    alignItems: "center",
  },
  expandedDayBadgeText: {
    color: "white",
    fontWeight: "bold",
    fontSize: 12,
  },
  expandedDayTitle: {
    color: "white",
    fontSize: 13,
    fontWeight: "bold",
  },
  expandedDayNotes: {
    color: "#94A3B8",
    fontSize: 12,
    marginTop: 2,
  },
  miniStopBadge: {
    backgroundColor: "rgba(56,189,248,0.1)",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: "rgba(56,189,248,0.2)",
  },
  miniStopText: {
    color: "#38BDF8",
    fontSize: 10,
    fontWeight: "500",
  },
  manageTripBtn: {
    backgroundColor: "#38BDF8",
    borderRadius: 12,
    padding: 12,
    alignItems: "center",
    marginTop: 10,
  },
  manageTripText: {
    color: "white",
    fontWeight: "bold",
    fontSize: 13,
  },
  tapToExpandText: {
    color: "#38BDF8",
    fontSize: 11,
    textAlign: "center",
    marginTop: 6,
    fontWeight: "500",
  },
  divider: {
    height: 1,
    backgroundColor: "#334155",
    marginVertical: 12,
  },
  groupSummaryCard: {
    backgroundColor: "#1E293B",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(56,189,248,0.25)",
    padding: 18,
  },
  summaryCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  aiSparkleBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(234,179,8,0.15)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "rgba(234,179,8,0.3)",
  },
  aiSparkleText: {
    color: "#EAB308",
    fontSize: 9,
    fontWeight: "bold",
  },
  summaryRealtimeTag: {
    color: "#22C55E",
    fontSize: 9,
    fontWeight: "bold",
    letterSpacing: 0.5,
  },
  summaryContentText: {
    color: "#CBD5E1",
    fontSize: 13.5,
    lineHeight: 20,
    marginBottom: 14,
  },
  viewGroupDetailsBtn: {
    backgroundColor: "#1E293B",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  viewGroupDetailsText: {
    color: "#38BDF8",
    fontWeight: "bold",
    fontSize: 12.5,
  },
});