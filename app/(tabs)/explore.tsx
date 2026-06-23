import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  FlatList,
  StyleSheet,
  Modal,
  ActivityIndicator,
  Alert,
  Animated,
} from "react-native";
import { useState, useEffect, useRef } from "react";
import { useLocalSearchParams, router } from "expo-router";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import app, { auth } from "../../firebaseConfig";
import { travelApiService } from "../../services/api";

const GEOAPIFY_KEY = "303db9c9ea7b411f81e4aaa234c881e5";

const CATEGORIES = [
  { label: "🏖 Beaches", type: "natural.beach" },
  { label: "🍴 Restaurants", type: "catering.restaurant" },
  { label: "☕ Cafes", type: "catering.cafe" },
  { label: "🏛 Heritage", type: "tourism.attraction" },
  { label: "🌿 Nature", type: "natural" },
  { label: "🏨 Hotels", type: "accommodation.hotel" },
  { label: "🛍 Shopping", type: "commercial.shopping_mall" },
];

const CAT_IMAGES: any = {
  "🏖 Beaches": "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=500",
  "🍴 Restaurants": "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=500",
  "☕ Cafes": "https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=500",
  "🏛 Heritage": "https://images.unsplash.com/photo-1524492412937-b28074a5d7da?w=500",
  "🌿 Nature": "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=500",
  "🏨 Hotels": "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=500",
  "🛍 Shopping": "https://images.unsplash.com/photo-1555529669-2269763671c0?w=500",
};

const getDescription = (name: string, category: string) => {
  const descs: any = {
    "🏖 Beaches": `${name} offers breathtaking coastal views with pristine sands and crystal-clear waters. Ideal for water sports, sunbathing, and serene evening walks.`,
    "🍴 Restaurants": `${name} is celebrated for authentic local cuisine and a vibrant atmosphere. The chef's signature dishes blend traditional flavors with modern culinary techniques.`,
    "☕ Cafes": `${name} is a beloved café known for artisanal coffee, fresh pastries, and a cozy ambiance. A favorite spot for travelers and locals alike.`,
    "🏛 Heritage": `${name} is a remarkable heritage site showcasing centuries of architectural brilliance and rich cultural history. A must-visit for history enthusiasts.`,
    "🌿 Nature": `${name} is a breathtaking natural reserve featuring diverse flora, fauna, and scenic landscapes. Perfect for trekking, birdwatching, and nature photography.`,
    "🏨 Hotels": `${name} offers premium accommodations with world-class amenities and impeccable service. Consistently ranked among the top properties in the region.`,
    "🛍 Shopping": `${name} is a premier shopping destination offering a curated mix of local crafts, international brands, and unique souvenirs. A retail therapy haven!`,
  };
  return (
    descs[category] ||
    `${name} is a highly-rated destination that visitors consistently love. Its unique character makes it a standout spot in the region.`
  );
};

const SAMPLE_REVIEWS = [
  { name: "Rahul M.", rating: 5, text: "Absolutely stunning! One of the best places I've visited. The experience was unforgettable.", ago: "2 days ago" },
  { name: "Priya S.", rating: 4, text: "Loved the experience! Well-maintained and the atmosphere was perfect. Highly recommend!", ago: "1 week ago" },
  { name: "Arjun K.", rating: 5, text: "A hidden gem that shouldn't be missed. Perfect for both solo travelers and families. Will visit again!", ago: "2 weeks ago" },
];

const getWeatherEmoji = (code: number) => {
  if (code === 0) return "☀️ Clear";
  if (code <= 2) return "⛅ Partly Cloudy";
  if (code === 3) return "☁️ Overcast";
  if (code <= 45) return "🌫️ Foggy";
  if (code <= 65) return "🌧️ Rainy";
  if (code <= 77) return "❄️ Snowy";
  if (code <= 82) return "🌦️ Showers";
  if (code <= 99) return "⛈️ Thunderstorm";
  return "🌤️ Clear";
};

const getDistanceKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371; // Radius of earth in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

export default function ExploreScreen() {
  const db = getFirestore(app);
  const params = useLocalSearchParams<{ searchCity?: string }>();

  const [place, setPlace] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("🏖 Beaches");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState<any>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [cityCoords, setCityCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [liveWeather, setLiveWeather] = useState<any>(null);
  const [addingFav, setAddingFav] = useState(false);
  const [addingVisit, setAddingVisit] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => {
        setToastMessage(null);
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);
  const slideAnim = useRef(new Animated.Value(0)).current;

  // Autocomplete suggestions & custom categories
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const autocompleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [customCategory, setCustomCategory] = useState("");
  const [autocompleteLoading, setAutocompleteLoading] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        let { status } = await Location.requestForegroundPermissionsAsync();
        if (status === "granted") {
          let loc = await Location.getCurrentPositionAsync({});
          setUserLocation({
            lat: loc.coords.latitude,
            lon: loc.coords.longitude,
          });
        }
      } catch (e) {
        console.log("Error fetching location for explore bias:", e);
      }
    })();
  }, []);

  const mapCustomTypeToGeoapifyType = (customType: string): string => {
    const norm = customType.toLowerCase().trim();
    if (norm.includes("temple") || norm.includes("church") || norm.includes("mosque") || norm.includes("worship")) {
      return "religion.place_of_worship";
    }
    if (norm.includes("museum") || norm.includes("gallery")) {
      return "entertainment.museum";
    }
    if (norm.includes("zoo") || norm.includes("aquarium")) {
      return "entertainment.zoo";
    }
    if (norm.includes("park") || norm.includes("garden")) {
      return "leisure.park";
    }
    if (norm.includes("beach club")) {
      return "catering.restaurant,catering.bar,natural.beach";
    }
    if (norm.includes("beach")) {
      return "natural.beach";
    }
    if (norm.includes("bar") || norm.includes("pub") || norm.includes("club")) {
      return "catering.bar";
    }
    if (norm.includes("cafe") || norm.includes("coffee")) {
      return "catering.cafe";
    }
    if (norm.includes("restaurant") || norm.includes("food") || norm.includes("eat")) {
      return "catering.restaurant";
    }
    if (norm.includes("hotel") || norm.includes("resort") || norm.includes("stay")) {
      return "accommodation.hotel";
    }
    if (norm.includes("shop") || norm.includes("mall") || norm.includes("market")) {
      return "commercial.shopping_mall,commercial.marketplace";
    }
    return "tourism.attraction";
  };

  // AI-powered hidden gems from /api/safety (Gemini-generated)
  const [aiHiddenGems, setAiHiddenGems] = useState<{ name: string; desc: string; emoji?: string }[]>([]);

  useEffect(() => {
    if (params.searchCity) {
      setPlace(params.searchCity);
      setSuggestions([]);
      setShowSuggestions(false);
      fetchPlaces(params.searchCity, selectedCategory);
    }
  }, [params.searchCity]);

  // Fetch autocomplete suggestions with debounce
  const fetchSuggestions = (text: string) => {
    if (autocompleteTimer.current) clearTimeout(autocompleteTimer.current);
    if (text.trim().length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    setAutocompleteLoading(true);
    autocompleteTimer.current = setTimeout(async () => {
      try {
        const biasParam = userLocation
          ? `&bias=proximity:${userLocation.lon},${userLocation.lat}`
          : "";
        const res = await fetch(
          `https://api.geoapify.com/v1/geocode/autocomplete?text=${encodeURIComponent(text)}&limit=10${biasParam}&apiKey=${GEOAPIFY_KEY}`
        );
        const data = await res.json();
        if (data.features) {
          const mapped = data.features
            .filter((f: any) => f.properties && (f.properties.formatted || f.properties.address_line2 || f.properties.name || f.properties.city))
            .map((f: any) => {
              const lon = f.geometry?.coordinates?.[0] ?? f.properties?.lon ?? 0;
              const lat = f.geometry?.coordinates?.[1] ?? f.properties?.lat ?? 0;
              
              // Extract name with formatted/address_line2 fallbacks
              let name = f.properties.name || f.properties.city || f.properties.suburb || f.properties.town || f.properties.village;
              if (!name && f.properties.address_line1) {
                name = f.properties.address_line1;
              }
              if (!name && f.properties.formatted) {
                name = f.properties.formatted.split(",")[0];
              }
              if (!name) {
                name = text;
              }

              const fullName = f.properties.formatted || f.properties.address_line2 || "";
              const country = f.properties.country || "";

              let distance = Infinity;
              let tier = 4;
              if (userLocation) {
                distance = getDistanceKm(userLocation.lat, userLocation.lon, lat, lon);
                if (distance < 15) tier = 1;
                else if (distance < 50) tier = 2;
                else if (distance < 150) tier = 3;
              }

              return {
                name,
                fullName,
                country,
                lat,
                lon,
                distance,
                tier,
              };
            });

          if (userLocation) {
            mapped.sort((a: any, b: any) => {
              if (a.tier !== b.tier) {
                return a.tier - b.tier;
              }
              return a.distance - b.distance;
            });
          }

          setSuggestions(mapped);
          setShowSuggestions(mapped.length > 0);
        }
      } catch (e) {
        // silently fail autocomplete
      } finally {
        setAutocompleteLoading(false);
      }
    }, 300);
  };

  const handlePlaceTextChange = (text: string) => {
    setPlace(text);
    fetchSuggestions(text);
  };

  const handleSuggestionSelect = (suggestion: any) => {
    setPlace(suggestion.name);
    setSuggestions([]);
    setShowSuggestions(false);
    fetchPlaces(suggestion.name, selectedCategory, { lat: suggestion.lat, lon: suggestion.lon });
  };

  const fetchPlaces = async (city: string, category: string, coords?: { lat: number; lon: number }) => {
    if (!city.trim()) {
      Alert.alert("Required", "Please enter a city name.");
      return;
    }
    setLoading(true);
    setResults([]);
    setAiHiddenGems([]);  // reset on new city search
    try {
      let lat: number;
      let lon: number;

      if (coords && coords.lat !== undefined && coords.lon !== undefined) {
        lat = coords.lat;
        lon = coords.lon;
        setCityCoords({ lat, lon });
      } else {
        const geoRes = await fetch(
          `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(city)}&limit=1&apiKey=${GEOAPIFY_KEY}`
        );
        const geoData = await geoRes.json();
        if (!geoData.features?.length) {
          Alert.alert("City Not Found", "Try a different city name.");
          setLoading(false);
          return;
        }
        const props = geoData.features[0].properties;
        lat = props.lat;
        lon = props.lon;
        setCityCoords({ lat, lon });
      }

      // Fetch live weather + AI safety gems in parallel
      const [wData, safetyData] = await Promise.allSettled([
        fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`
        ).then((r) => r.json()),
        travelApiService.getCitySafety(city),
      ]);

      if (wData.status === "fulfilled") {
        setLiveWeather(wData.value.current_weather);
      }

      if (safetyData.status === "fulfilled" && safetyData.value.gems?.length) {
        // Map gems to display format; add emoji based on index
        const gemEmojis = ["💎", "🌄", "🏚"];
        setAiHiddenGems(
          safetyData.value.gems.slice(0, 3).map((g: any, i: number) => ({
            name: g.name,
            desc: g.desc,
            emoji: gemEmojis[i] || "✨",
          }))
        );
      } else {
        // Fallback static gems if API unreachable
        setAiHiddenGems([
          { emoji: "🏚", name: "Old Town Quarter", desc: "Undiscovered historic streets rarely visited by tourists" },
          { emoji: "🌄", name: "Sunrise Viewpoint", desc: "A secret hilltop with panoramic views at dawn" },
          { emoji: "🍃", name: "Forest Trail", desc: "A serene 3km nature walk through local wilderness" },
        ]);
      }

      const catType = category === "✍️ Custom"
        ? mapCustomTypeToGeoapifyType(customCategory)
        : CATEGORIES.find((c) => c.label === category)?.type || "tourism.attraction";
      const placesRes = await fetch(
        `https://api.geoapify.com/v2/places?categories=${catType}&filter=circle:${lon},${lat},10000&limit=20&apiKey=${GEOAPIFY_KEY}`
      );
      const placesData = await placesRes.json();
      if (placesData.features) {
        const mapped = placesData.features
          .filter((f: any) => f.properties.name)
          .map((f: any) => ({
            id: f.properties.place_id,
            name: f.properties.name,
            address: f.properties.formatted || f.properties.address_line2 || city,
            lat: f.geometry.coordinates[1],
            lon: f.geometry.coordinates[0],
            rating: parseFloat((3.5 + Math.random() * 1.5).toFixed(1)),
            distance: f.properties.distance ? Math.round(f.properties.distance / 100) / 10 : null,
          }));
        setResults(mapped);
      }
    } catch (e) {
      console.log("Fetch error:", e);
      Alert.alert("Error", "Could not fetch places. Check internet connection.");
    }
    setLoading(false);
  };

  const handleCategoryChange = (cat: string) => {
    setSelectedCategory(cat);
    if (place.trim()) fetchPlaces(place, cat);
  };

  const openPlaceModal = (p: any) => {
    setSelectedPlace(p);
    setModalVisible(true);
  };

  const addToFavorites = async () => {
    if (!selectedPlace) return;
    const currentUser = auth.currentUser;
    if (!currentUser) {
      Alert.alert("Not Logged In", "Please log in to save favorites.");
      return;
    }
    setAddingFav(true);
    try {
      // Check if already saved by this user
      const q = query(
        collection(db, "favorites"),
        where("name", "==", selectedPlace.name),
        where("userId", "==", currentUser.uid)
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        Alert.alert("Already Saved ❤️", "This place is already in your favorites!");
        setAddingFav(false);
        return;
      }
      await addDoc(collection(db, "favorites"), {
        name: selectedPlace.name,
        address: selectedPlace.address,
        rating: selectedPlace.rating,
        image: CAT_IMAGES[selectedCategory] || "",
        category: selectedCategory,
        lat: selectedPlace.lat,
        lon: selectedPlace.lon,
        savedAt: new Date(),
        userId: currentUser.uid,
      });
      Alert.alert("Saved! ❤️", `${selectedPlace.name} added to your favorites.`);
    } catch (e) {
      Alert.alert("Error", "Could not save to favorites.");
    }
    setAddingFav(false);
  };

  const markAsVisited = async () => {
    if (!selectedPlace) return;
    const currentUser = auth.currentUser;
    if (!currentUser) {
      Alert.alert("Not Logged In", "Please log in to mark places as visited.");
      return;
    }
    setAddingVisit(true);
    try {
      // Check if already visited by this user
      const q = query(
        collection(db, "visited"),
        where("name", "==", selectedPlace.name),
        where("userId", "==", currentUser.uid)
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        setToastMessage("Already marked as visited");
        setAddingVisit(false);
        return;
      }
      await addDoc(collection(db, "visited"), {
        name: selectedPlace.name,
        address: selectedPlace.address,
        rating: selectedPlace.rating,
        image: CAT_IMAGES[selectedCategory] || "",
        category: selectedCategory,
        lat: selectedPlace.lat,
        lon: selectedPlace.lon,
        visitedAt: new Date(),
        memories: "",
        userId: currentUser.uid,
      });
      setToastMessage("Added to Visited Places");
      setModalVisible(false);
    } catch (e) {
      Alert.alert("Error", "Could not mark as visited.");
    }
    setAddingVisit(false);
  };

  const renderStars = (rating: number) => {
    return Array(5)
      .fill(0)
      .map((_, i) => (
        <Ionicons
          key={i}
          name={i < Math.floor(rating) ? "star" : i < rating ? "star-half" : "star-outline"}
          size={14}
          color="#EAB308"
        />
      ));
  };

  const getCrowd = (rating: number) => {
    if (rating >= 4.5) return { label: "High", color: "#EF4444", pct: 0.85 };
    if (rating >= 4.0) return { label: "Moderate", color: "#EAB308", pct: 0.55 };
    return { label: "Low", color: "#22C55E", pct: 0.3 };
  };

  // Use AI-generated gems from /api/safety; rendered below
  const hiddenGems = cityCoords ? aiHiddenGems : [];

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Explore 🌏</Text>
        <Text style={styles.headerSub}>Discover places around the world</Text>
      </View>

      {/* Search + Suggestions lifted OUTSIDE ScrollView so the dropdown overlays content below */}
      <View style={styles.searchWrapper}>
        <View style={styles.searchRow}>
          <View style={{ flex: 1, position: "relative" }}>
            <View style={[styles.searchBox, showSuggestions && styles.searchBoxActive]}>
              <Ionicons name="location-outline" size={20} color="#94A3B8" />
              <TextInput
                testID="map-search-input"
                accessibilityLabel="map-search-input"
                placeholder="Enter city or place..."
                placeholderTextColor="#94A3B8"
                value={place}
                onChangeText={handlePlaceTextChange}
                onSubmitEditing={() => {
                  setSuggestions([]);
                  setShowSuggestions(false);
                  fetchPlaces(place, selectedCategory);
                }}
                returnKeyType="search"
                style={styles.searchInput}
              />
              {autocompleteLoading && (
                <ActivityIndicator size="small" color="#38BDF8" style={{ marginRight: 6 }} />
              )}
              {place.length > 0 && (
                <TouchableOpacity onPress={() => {
                  setPlace("");
                  setSuggestions([]);
                  setShowSuggestions(false);
                }}>
                  <Ionicons name="close-circle" size={18} color="#475569" />
                </TouchableOpacity>
              )}
            </View>

            {/* Autocomplete Suggestions — absolutely positioned, Google Maps style */}
            {showSuggestions && suggestions.length > 0 && (
              <View style={styles.suggestionsDropdown}>
                <View style={styles.dropdownHeader}>
                  <Text style={styles.dropdownTitle}>Suggestions</Text>
                  <TouchableOpacity onPress={() => {
                    setSuggestions([]);
                    setShowSuggestions(false);
                  }} style={styles.dropdownCloseBtn}>
                    <Ionicons name="close" size={16} color="#94A3B8" />
                  </TouchableOpacity>
                </View>
                <ScrollView style={{ maxHeight: 200 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled={true}>
                  {suggestions.map((sug, i) => (
                    <TouchableOpacity
                      key={i}
                      onPress={() => handleSuggestionSelect(sug)}
                      style={[
                        styles.suggestionItem,
                        i < suggestions.length - 1 && styles.suggestionItemBorder,
                      ]}
                      activeOpacity={0.75}
                    >
                      <Ionicons name="location" size={15} color="#38BDF8" style={{ marginRight: 10 }} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.suggestionName}>{sug.name}</Text>
                        {sug.fullName ? (
                          <Text style={styles.suggestionFull} numberOfLines={1}>{sug.fullName}</Text>
                        ) : null}
                      </View>
                      <Ionicons name="arrow-forward-outline" size={14} color="#475569" />
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}
          </View>
          <TouchableOpacity
            testID="map-search-btn"
            accessibilityLabel="map-search-btn"
            onPress={() => {
              setSuggestions([]);
              setShowSuggestions(false);
              fetchPlaces(place, selectedCategory);
            }}
            style={styles.searchBtn}
          >
            {loading ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <Ionicons name="search" size={20} color="white" />
            )}
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>

        {/* Category Pills */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.catScroll}
        >
          {CATEGORIES.map((cat) => (
            <TouchableOpacity
              key={cat.label}
              onPress={() => handleCategoryChange(cat.label)}
              style={[
                styles.catPill,
                selectedCategory === cat.label && styles.catPillActive,
              ]}
            >
              <Text
                style={[
                  styles.catPillText,
                  selectedCategory === cat.label && { color: "#38BDF8", fontWeight: "700" },
                ]}
              >
                {cat.label}
              </Text>
            </TouchableOpacity>
          ))}
          {customCategory.trim().length > 0 && (
            <TouchableOpacity
              onPress={() => handleCategoryChange("✍️ Custom")}
              style={[
                styles.catPill,
                selectedCategory === "✍️ Custom" && styles.catPillActive,
              ]}
            >
              <Text
                style={[
                  styles.catPillText,
                  selectedCategory === "✍️ Custom" && { color: "#38BDF8", fontWeight: "700" },
                ]}
              >
                ✍️ Custom: {customCategory}
              </Text>
            </TouchableOpacity>
          )}
        </ScrollView>

        {/* Custom Category manual entry row */}
        <View style={styles.customCatRow}>
          <Ionicons name="create-outline" size={16} color="#38BDF8" style={{ marginRight: 6 }} />
          <TextInput
            placeholder="Type custom category (e.g. Temple, Zoo, Park)..."
            placeholderTextColor="#94A3B8"
            value={customCategory}
            onChangeText={(text) => {
              setCustomCategory(text);
              if (text.trim()) {
                setSelectedCategory("✍️ Custom");
              }
            }}
            onSubmitEditing={() => {
              if (place.trim() && customCategory.trim()) {
                fetchPlaces(place, "✍️ Custom");
              }
            }}
            style={styles.customCatInput}
          />
          {customCategory.trim().length > 0 && (
            <TouchableOpacity
              onPress={() => {
                if (place.trim()) fetchPlaces(place, "✍️ Custom");
              }}
              style={styles.customCatSearchBtn}
            >
              <Ionicons name="arrow-forward" size={16} color="white" />
            </TouchableOpacity>
          )}
        </View>

        {/* Live Travel Conditions */}
        {liveWeather && cityCoords && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>🌦 Live Travel Conditions</Text>
            <View style={styles.conditionsCard}>
              <View style={styles.condRow}>
                <View style={styles.condItem}>
                  <Text style={styles.condLabel}>Weather</Text>
                  <Text style={styles.condValue}>{getWeatherEmoji(liveWeather.weathercode)}</Text>
                </View>
                <View style={styles.condDivider} />
                <View style={styles.condItem}>
                  <Text style={styles.condLabel}>Temperature</Text>
                  <Text style={styles.condValue}>{Math.round(liveWeather.temperature)}°C</Text>
                </View>
                <View style={styles.condDivider} />
                <View style={styles.condItem}>
                  <Text style={styles.condLabel}>Wind</Text>
                  <Text style={styles.condValue}>{Math.round(liveWeather.windspeed)} km/h</Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={() =>
                  router.push({
                    pathname: "/(tabs)/map",
                    params: { lat: cityCoords.lat, lon: cityCoords.lon },
                  })
                }
                style={styles.viewMapBtn}
              >
                <Ionicons name="map-outline" size={16} color="#38BDF8" />
                <Text style={styles.viewMapText}>View on Map</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Results */}
        {results.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              📍 {results.length} {selectedCategory} near {place}
            </Text>
            {results.map((item) => {
              const crowd = getCrowd(item.rating);
              return (
                <TouchableOpacity
                  key={item.id}
                  onPress={() => openPlaceModal(item)}
                  style={styles.placeCard}
                  activeOpacity={0.85}
                >
                  <View style={styles.placeTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.placeName}>{item.name}</Text>
                      <Text style={styles.placeAddr} numberOfLines={1}>
                        {item.address}
                      </Text>
                    </View>
                    {item.distance && (
                      <Text style={styles.placeDistance}>{item.distance}km</Text>
                    )}
                  </View>
                  <View style={styles.placeBottom}>
                    <View style={styles.ratingRow}>
                      {renderStars(item.rating)}
                      <Text style={styles.ratingNum}>{item.rating}</Text>
                    </View>
                    <View style={[styles.crowdBadge, { backgroundColor: crowd.color + "20" }]}>
                      <Text style={[styles.crowdText, { color: crowd.color }]}>
                        {crowd.label} Crowd
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {!loading && results.length === 0 && (
          <View style={styles.emptyState}>
            <Ionicons name="earth-outline" size={55} color="#334155" />
            <Text style={styles.emptyTitle}>Ready to Explore?</Text>
            <Text style={styles.emptySubtitle}>
              Enter a city name above and select a category to discover amazing places.
            </Text>
          </View>
        )}

        {/* Hidden Gems */}
        {hiddenGems.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>💎 Hidden Gems near {place}</Text>
            {hiddenGems.map((gem, i) => (
              <View key={i} style={styles.gemCard}>
                <Text style={styles.gemEmoji}>{gem.emoji}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.gemName}>{gem.name}</Text>
                  <Text style={styles.gemDesc}>{gem.desc}</Text>
                </View>
                <View style={styles.gemBadge}>
                  <Text style={styles.gemBadgeText}>AI Pick</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Place Detail Modal */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={{ flex: 1 }} onPress={() => setModalVisible(false)} />
          <View style={styles.modalSheet}>
            {/* Handle */}
            <View style={styles.handle} />

            {/* Close */}
            <TouchableOpacity onPress={() => setModalVisible(false)} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color="#94A3B8" />
            </TouchableOpacity>

            <ScrollView showsVerticalScrollIndicator={false}>
              {selectedPlace && (
                <>
                  {/* Category Emoji Banner */}
                  <View style={styles.modalBanner}>
                    <Text style={{ fontSize: 50 }}>
                      {selectedCategory.split(" ")[0]}
                    </Text>
                    <View style={styles.modalBannerOverlay}>
                      <Text style={styles.modalPlaceName}>{selectedPlace.name}</Text>
                      <Text style={styles.modalPlaceAddr} numberOfLines={2}>{selectedPlace.address}</Text>
                    </View>
                  </View>

                  {/* Rating Row */}
                  <View style={styles.modalRatingRow}>
                    <View style={styles.ratingRow}>
                      {renderStars(selectedPlace.rating)}
                      <Text style={styles.modalRatingNum}>{selectedPlace.rating}</Text>
                    </View>
                    <View
                      style={[
                        styles.crowdBadge,
                        { backgroundColor: getCrowd(selectedPlace.rating).color + "20", marginLeft: 10 },
                      ]}
                    >
                      <Text
                        style={[styles.crowdText, { color: getCrowd(selectedPlace.rating).color }]}
                      >
                        {getCrowd(selectedPlace.rating).label} Crowd
                      </Text>
                    </View>
                  </View>

                  {/* Crowd Meter */}
                  <View style={styles.meterRow}>
                    <Text style={styles.meterLabel}>Crowd Level</Text>
                    <View style={styles.meterBar}>
                      <View
                        style={[
                          styles.meterFill,
                          {
                            width: `${Math.round(getCrowd(selectedPlace.rating).pct * 100)}%`,
                            backgroundColor: getCrowd(selectedPlace.rating).color,
                          },
                        ]}
                      />
                    </View>
                    <Text style={[styles.meterPct, { color: getCrowd(selectedPlace.rating).color }]}>
                      {Math.round(getCrowd(selectedPlace.rating).pct * 100)}%
                    </Text>
                  </View>

                  {/* Description */}
                  <Text style={styles.modalDesc}>
                    {getDescription(selectedPlace.name, selectedCategory)}
                  </Text>

                  {/* Reviews */}
                  <Text style={styles.reviewsTitle}>⭐ Traveler Reviews</Text>
                  {SAMPLE_REVIEWS.map((rev, i) => (
                    <View key={i} style={styles.reviewCard}>
                      <View style={styles.reviewTop}>
                        <View style={styles.reviewAvatar}>
                          <Text style={{ color: "white", fontWeight: "bold", fontSize: 14 }}>
                            {rev.name[0]}
                          </Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.reviewName}>{rev.name}</Text>
                          <View style={{ flexDirection: "row", gap: 2 }}>
                            {Array(rev.rating).fill(0).map((_, j) => (
                              <Ionicons key={j} name="star" size={12} color="#EAB308" />
                            ))}
                          </View>
                        </View>
                        <Text style={styles.reviewAgo}>{rev.ago}</Text>
                      </View>
                      <Text style={styles.reviewText}>{rev.text}</Text>
                    </View>
                  ))}

                  {/* Action Buttons */}
                  <View style={styles.modalActions}>
                    <TouchableOpacity
                      onPress={addToFavorites}
                      style={[styles.favBtn, addingFav && { opacity: 0.7 }]}
                      disabled={addingFav}
                    >
                      {addingFav ? (
                        <ActivityIndicator size="small" color="white" />
                      ) : (
                        <>
                          <Ionicons name="heart" size={18} color="white" />
                          <Text style={styles.favBtnText}>Add to Favorites</Text>
                        </>
                      )}
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={markAsVisited}
                      style={[styles.visitBtn, addingVisit && { opacity: 0.7 }]}
                      disabled={addingVisit}
                    >
                      {addingVisit ? (
                        <ActivityIndicator size="small" color="white" />
                      ) : (
                        <>
                          <Ionicons name="checkmark-circle" size={18} color="white" />
                          <Text style={styles.visitBtnText}>Mark as Visited</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>

                  <View style={{ height: 30 }} />
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Toast Notification */}
      {toastMessage && (
        <View style={styles.toastContainer as any}>
          <Ionicons name="checkmark-circle" size={18} color="#10B981" />
          <Text style={styles.toastText as any}>{toastMessage}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0F172A" },
  header: {
    paddingTop: 55,
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: "#020617",
    borderBottomWidth: 1,
    borderBottomColor: "#1E293B",
  },
  headerTitle: { color: "white", fontSize: 28, fontWeight: "bold" },
  headerSub: { color: "#94A3B8", fontSize: 13, marginTop: 4 },
  searchWrapper: {
    position: "relative",
    zIndex: 100,
    elevation: 100,
    backgroundColor: "#0F172A",
  },
  searchRow: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  searchBox: {
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
  searchBoxActive: {
    borderColor: "#38BDF8",
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  searchInput: { flex: 1, color: "white", paddingVertical: 14, fontSize: 15 },
  suggestionsDropdown: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    backgroundColor: "#1E293B",
    borderWidth: 1,
    borderColor: "#38BDF8",
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
    overflow: "hidden",
    zIndex: 999,
    elevation: 999,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  customCatRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1E293B",
    borderRadius: 14,
    paddingHorizontal: 14,
    marginHorizontal: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#334155",
  },
  customCatInput: {
    flex: 1,
    color: "white",
    paddingVertical: 12,
    fontSize: 14,
  },
  customCatSearchBtn: {
    backgroundColor: "#38BDF8",
    borderRadius: 8,
    padding: 6,
  },
  dropdownHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#334155",
    backgroundColor: "#111827",
  },
  dropdownTitle: {
    color: "#94A3B8",
    fontSize: 10,
    fontWeight: "bold",
    textTransform: "uppercase",
  },
  dropdownCloseBtn: {
    padding: 2,
  },
  suggestionItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  suggestionItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: "#334155",
  },
  suggestionName: {
    color: "white",
    fontSize: 14,
    fontWeight: "600",
  },
  suggestionFull: {
    color: "#64748B",
    fontSize: 11,
    marginTop: 2,
  },
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
  catScroll: { paddingHorizontal: 20, paddingBottom: 14, gap: 10 },
  catPill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#1E293B",
    borderWidth: 1,
    borderColor: "#334155",
  },
  catPillActive: {
    backgroundColor: "rgba(56,189,248,0.1)",
    borderColor: "rgba(56,189,248,0.4)",
  },
  catPillText: { color: "#94A3B8", fontWeight: "600", fontSize: 13 },
  section: { paddingHorizontal: 20, marginBottom: 8 },
  sectionTitle: { color: "white", fontSize: 17, fontWeight: "bold", marginBottom: 14 },
  conditionsCard: {
    backgroundColor: "#1E293B",
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: "#334155",
    marginBottom: 4,
  },
  condRow: { flexDirection: "row", justifyContent: "space-around", marginBottom: 14 },
  condItem: { alignItems: "center", gap: 6 },
  condLabel: { color: "#94A3B8", fontSize: 11, fontWeight: "600" },
  condValue: { color: "white", fontSize: 14, fontWeight: "bold" },
  condDivider: { width: 1, backgroundColor: "#334155" },
  viewMapBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "rgba(56,189,248,0.08)",
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: "rgba(56,189,248,0.2)",
  },
  viewMapText: { color: "#38BDF8", fontWeight: "600", fontSize: 13 },
  placeCard: {
    backgroundColor: "#1E293B",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#334155",
  },
  placeTop: { flexDirection: "row", alignItems: "flex-start", marginBottom: 10 },
  placeName: { color: "white", fontSize: 16, fontWeight: "bold", marginBottom: 4 },
  placeAddr: { color: "#94A3B8", fontSize: 13 },
  placeDistance: {
    color: "#38BDF8",
    fontSize: 13,
    fontWeight: "700",
    marginLeft: 10,
  },
  placeBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  ratingNum: { color: "#EAB308", fontWeight: "bold", fontSize: 13, marginLeft: 4 },
  crowdBadge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  crowdText: { fontSize: 12, fontWeight: "700" },
  emptyState: {
    alignItems: "center",
    padding: 50,
    paddingTop: 40,
  },
  emptyTitle: { color: "white", fontSize: 20, fontWeight: "bold", marginTop: 16 },
  emptySubtitle: { color: "#94A3B8", textAlign: "center", marginTop: 10, lineHeight: 20 },
  gemCard: {
    backgroundColor: "#1E293B",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderWidth: 1,
    borderColor: "#334155",
  },
  gemEmoji: { fontSize: 30 },
  gemName: { color: "white", fontSize: 15, fontWeight: "bold" },
  gemDesc: { color: "#94A3B8", fontSize: 13, marginTop: 3 },
  gemBadge: {
    backgroundColor: "rgba(167,139,250,0.15)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.3)",
  },
  gemBadgeText: { color: "#A78BFA", fontSize: 11, fontWeight: "700" },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(2,6,23,0.88)",
  },
  modalSheet: {
    backgroundColor: "#0F172A",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: "82%",
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderColor: "#1E293B",
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: "#334155",
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 12,
  },
  closeBtn: {
    position: "absolute",
    top: 12,
    right: 16,
    backgroundColor: "#1E293B",
    borderRadius: 20,
    padding: 8,
    zIndex: 10,
  },
  modalBanner: {
    backgroundColor: "#1E293B",
    borderRadius: 20,
    height: 140,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
    overflow: "hidden",
    position: "relative",
  },
  modalBannerOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(2,6,23,0.85)",
    padding: 14,
  },
  modalPlaceName: { color: "white", fontSize: 18, fontWeight: "bold" },
  modalPlaceAddr: { color: "#94A3B8", fontSize: 12, marginTop: 3 },
  modalRatingRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
  },
  modalRatingNum: { color: "#EAB308", fontWeight: "bold", fontSize: 14, marginLeft: 6 },
  meterRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16 },
  meterLabel: { color: "#94A3B8", fontSize: 12, fontWeight: "600", width: 90 },
  meterBar: {
    flex: 1,
    height: 5,
    backgroundColor: "#1E293B",
    borderRadius: 3,
    overflow: "hidden",
  },
  meterFill: { height: "100%", borderRadius: 3 },
  meterPct: { fontSize: 12, fontWeight: "700", width: 36, textAlign: "right" },
  modalDesc: {
    color: "#CBD5E1",
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 20,
    backgroundColor: "#1E293B",
    borderRadius: 14,
    padding: 16,
  },
  reviewsTitle: { color: "white", fontSize: 16, fontWeight: "bold", marginBottom: 12 },
  reviewCard: {
    backgroundColor: "#1E293B",
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#334155",
  },
  reviewTop: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  reviewAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#38BDF8",
    justifyContent: "center",
    alignItems: "center",
  },
  reviewName: { color: "white", fontWeight: "bold", fontSize: 14 },
  reviewAgo: { color: "#94A3B8", fontSize: 12 },
  reviewText: { color: "#CBD5E1", fontSize: 13, lineHeight: 20 },
  modalActions: { flexDirection: "row", gap: 12, marginTop: 16, marginBottom: 10 },
  favBtn: {
    flex: 1,
    backgroundColor: "#EF4444",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 14,
    borderRadius: 16,
    shadowColor: "#EF4444",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  favBtnText: { color: "white", fontWeight: "bold", fontSize: 14 },
  visitBtn: {
    flex: 1,
    backgroundColor: "#22C55E",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 14,
    borderRadius: 16,
    shadowColor: "#22C55E",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  visitBtnText: { color: "white", fontWeight: "bold", fontSize: 14 },
  toastContainer: {
    position: "absolute",
    bottom: 50,
    left: 40,
    right: 40,
    backgroundColor: "#1E293B",
    borderRadius: 20,
    paddingVertical: 12,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "#10B981",
    zIndex: 9999,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 10,
  },
  toastText: {
    color: "white",
    fontSize: 14,
    fontWeight: "600",
  },
});