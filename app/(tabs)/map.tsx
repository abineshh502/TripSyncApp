import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Share,
  ScrollView,
  FlatList,
  Clipboard,
  Platform,
  Modal,
} from "react-native";
import MapView, { Marker, Callout, Polyline } from "react-native-maps";
import { useState, useEffect, useRef } from "react";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import * as Linking from "expo-linking";
import { useLocalSearchParams, router } from "expo-router";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  query,
  where,
  onSnapshot,
  doc,
  getDoc,
  updateDoc,
} from "firebase/firestore";
import app, { auth } from "../../firebaseConfig";
import { travelApiService } from "../../services/api";

const DARK_MAP_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#0F172A" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#94A3B8" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0F172A" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#334155" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#CBD5E1" }] },
  { featureType: "poi", elementType: "geometry", stylers: [{ color: "#1E293B" }] },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#38BDF8" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#0F2A1A" }] },
  { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#10B981" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1E293B" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#CBD5E1" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#334155" }] },
  { featureType: "road.highway", elementType: "labels.text.fill", stylers: [{ color: "#EAB308" }] },
  { featureType: "road.local", elementType: "geometry", stylers: [{ color: "#1E293B" }] },
  { featureType: "transit", elementType: "geometry", stylers: [{ color: "#1E293B" }] },
  { featureType: "transit.station", elementType: "labels.text.fill", stylers: [{ color: "#38BDF8" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#020617" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#475569" }] },
];

// Haversine distance in km
const haversineKm = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

// Point-to-segment perpendicular distance for route deviation check
const pointToSegmentDist = (
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number
): number => {
  const dx = bx - ax, dy = by - ay;
  if (dx === 0 && dy === 0) return haversineKm(px, py, ax, ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return haversineKm(px, py, ax + t * dx, ay + t * dy);
};

const GEOAPIFY_KEY = "303db9c9ea7b411f81e4aaa234c881e5";
const REROUTE_THRESHOLD_KM = 0.15; // 150 m off-route triggers reroute

let initialUrlProcessed = false;

const SAMPLE_REVIEWS = [
  { name: "Rahul M.", rating: 5, text: "Absolutely stunning! One of the best places I've visited.", ago: "2 days ago" },
  { name: "Priya S.", rating: 4, text: "Loved the experience! Well-maintained and perfect atmosphere.", ago: "1 week ago" },
];

export default function MapScreen() {
  const db = getFirestore(app);
  const mapRef = useRef<MapView>(null);
  const params = useLocalSearchParams();
  const navIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadedRouteIdRef = useRef<string | null>(null);
  const isRouteLoadingRef = useRef<boolean>(false);

  // Custom Category, Trips and Autocomplete states

  const [userTrips, setUserTrips] = useState<any[]>([]);
  const [selectedTripId, setSelectedTripId] = useState<string>("");
  const [selectedDayNumber, setSelectedDayNumber] = useState<number>(1);
  const [isOptimized, setIsOptimized] = useState(false);
  const [autocompleteLoading, setAutocompleteLoading] = useState(false);

  // Mode
  const [activeMode, setActiveMode] = useState<"explore" | "directions" | "route_builder">("explore");

  // Search
  const [searchText, setSearchText] = useState("");
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [activeInputType, setActiveInputType] = useState<"explore" | "start" | "dest" | "builder_start" | "builder_add_stop" | null>(null);
  const [loading, setLoading] = useState(false);
  const [exploreSelectedPlace, setExploreSelectedPlace] = useState<any>(null);
  const [directionsSelectedPlace, setDirectionsSelectedPlace] = useState<any>(null);
  const [builderSelectedPlace, setBuilderSelectedPlace] = useState<any>(null);

  const selectedPlace = activeMode === "explore"
    ? exploreSelectedPlace
    : activeMode === "directions"
    ? directionsSelectedPlace
    : builderSelectedPlace;

  const setSelectedPlace = (place: any) => {
    if (activeMode === "explore") setExploreSelectedPlace(place);
    else if (activeMode === "directions") setDirectionsSelectedPlace(place);
    else if (activeMode === "route_builder") setBuilderSelectedPlace(place);
  };

  // User GPS (used for proximity sorting)
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null);

  // Directions
  const [startText, setStartText] = useState("");
  const [destText, setDestText] = useState("");
  const [startPlace, setStartPlace] = useState<any>(null);
  const [destPlace, setDestPlace] = useState<any>(null);
  const [routeStats, setRouteStats] = useState<{ distance: string; duration: string } | null>(null);
  const [routeDistanceM, _setRouteDistanceM] = useState<number>(0); // raw metres for navigation
  const routeDistanceMRef = useRef<number>(0);
  const setRouteDistanceM = (val: number) => {
    routeDistanceMRef.current = val;
    _setRouteDistanceM(val);
  };
  const [routeDurationS, _setRouteDurationS] = useState<number>(0); // raw seconds
  const routeDurationSRef = useRef<number>(0);
  const setRouteDurationS = (val: number) => {
    routeDurationSRef.current = val;
    _setRouteDurationS(val);
  };



  const updateTripDayRoute = async (tripId: string, dayNum: number, routeId: string, webLink: string, stops: any[]) => {
    try {
      const tripRef = doc(db, "trips", tripId);
      const tripSnap = await getDoc(tripRef);
      if (tripSnap.exists()) {
        const tripData = tripSnap.data();
        const days = tripData.days || [];
        const updatedDays = days.map((day: any) => {
          if (day.dayNumber === dayNum) {
            return {
              ...day,
              mapLink: webLink,
              destinations: stops.map(stop => ({
                name: stop.name,
                lat: stop.latitude || stop.lat,
                lon: stop.longitude || stop.lon,
              })),
            };
          }
          return day;
        });
        await updateDoc(tripRef, { days: updatedDays });
      }
    } catch (err) {
      console.log("Error updating trip day route:", err);
    }
  };

  const handleExploreSearch = async () => {
    if (!searchText.trim()) return;
    setLoading(true);
    setSuggestions([]);
    try {
      const biasParam = userLocation
        ? `&bias=proximity:${userLocation.lon},${userLocation.lat}`
        : "";
      const res = await fetch(
        `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(searchText)}&limit=1${biasParam}&apiKey=${GEOAPIFY_KEY}`
      );
      const data = await res.json();
      if (data.features && data.features.length > 0) {
        const feat = data.features[0];
        const name = feat.properties.name || feat.properties.formatted?.split(",")[0] || searchText;
        const lat = feat.properties.lat;
        const lon = feat.properties.lon;
        const addr = feat.properties.formatted || "";
        
        const newRegion = {
          latitude: lat,
          longitude: lon,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        };
        setRegion(newRegion);
        mapRef.current?.animateToRegion(newRegion, 1000);
        setSelectedPlace({
          name: name,
          type: "sight",
          rating: "4.8",
          address: addr,
          latitude: lat,
          longitude: lon,
          pinColor: "#38BDF8",
        });
        await fetchMapSights(lat, lon);
      } else {
        Alert.alert("Place Not Found", "Try a different search query.");
      }
    } catch (err) {
      console.log("Search error:", err);
      Alert.alert("Search Error", "Could not complete search.");
    } finally {
      setLoading(false);
    }
  };



  const calculateDirectionsRouteDirectly = async (start: any, dest: any) => {
    if (!start || !dest) return;
    setLoading(true);
    stopNavigation();
    try {
      const res = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${start.longitude},${start.latitude};${dest.longitude || dest.lon},${dest.latitude || dest.lat}?overview=full&geometries=geojson`
      );
      const data = await res.json();
      if (data.routes?.length > 0) {
        const route = data.routes[0];
        const coords = route.geometry.coordinates.map((c: any) => ({
          latitude: c[1],
          longitude: c[0],
        }));
        setDirectionsRouteCoords(coords);
        setDirectionsRouteDistanceM(route.distance);
        setDirectionsRouteDurationS(route.duration);
        setDirectionsRouteStats({
          distance: (route.distance / 1000).toFixed(1),
          duration: formatDuration(route.duration),
        });

        setRouteCoords(coords);
        routeCoordsRef.current = coords;
        setRouteDistanceM(route.distance);
        setRouteDurationS(route.duration);
        setRouteStats({
          distance: (route.distance / 1000).toFixed(1),
          duration: formatDuration(route.duration),
        });
        mapRef.current?.fitToCoordinates(
          [
            { latitude: start.latitude, longitude: start.longitude },
            { latitude: dest.latitude || dest.lat, longitude: dest.longitude || dest.lon },
          ],
          { edgePadding: { top: 100, right: 50, bottom: 260, left: 50 }, animated: true }
        );
      }
    } catch (e) {
      console.log("Direct directions error:", e);
    } finally {
      setLoading(false);
    }
  };

  // Live Navigation
  const [isNavigating, setIsNavigating] = useState(false);
  const [navRemDistM, setNavRemDistM] = useState<number>(0);
  const [navRemDurS, setNavRemDurS] = useState<number>(0);
  const [navNextStop, setNavNextStop] = useState<string>("");
  const [navProgress, setNavProgress] = useState<number>(0); // 0–1
  const routeCoordsRef = useRef<{ latitude: number; longitude: number }[]>([]);

  // Region
  const [region, setRegion] = useState({
    latitude: 13.0827,
    longitude: 80.2707,
    latitudeDelta: 0.08,
    longitudeDelta: 0.08,
  });

  // POI markers
  const [markers, setMarkers] = useState<any[]>([]);
  const [favPlaces, setFavPlaces] = useState<any[]>([]);
  const [visitedPlaces, setVisitedPlaces] = useState<any[]>([]);
  const [filter, _setFilter] = useState("all");

  // Route Builder
  const [routeItems, setRouteItems] = useState<any[]>([]);
  const [routeCoords, setRouteCoords] = useState<{ latitude: number; longitude: number }[]>([]);
  const [_savingRoute, setSavingRoute] = useState(false);
  const [editingRouteId, setEditingRouteId] = useState<string | null>(null);
  const [editingRouteName, setEditingRouteName] = useState<string | null>(null);

  // Decoupled Route Builder states
  const [builderRouteCoords, setBuilderRouteCoords] = useState<{ latitude: number; longitude: number }[]>([]);
  const [builderRouteStats, setBuilderRouteStats] = useState<{ distance: string; duration: string } | null>(null);
  const [_builderRouteDistanceM, setBuilderRouteDistanceM] = useState<number>(0);
  const [_builderRouteDurationS, setBuilderRouteDurationS] = useState<number>(0);

  // Decoupled Directions states
  const [directionsRouteCoords, setDirectionsRouteCoords] = useState<{ latitude: number; longitude: number }[]>([]);
  const [directionsRouteStats, setDirectionsRouteStats] = useState<{ distance: string; duration: string } | null>(null);
  const [_directionsRouteDistanceM, setDirectionsRouteDistanceM] = useState<number>(0);
  const [_directionsRouteDurationS, setDirectionsRouteDurationS] = useState<number>(0);
  const [builderStartPlace, setBuilderStartPlace] = useState<any>(null);
  const [builderStartText, setBuilderStartText] = useState("");
  const [builderAddText, setBuilderAddText] = useState("");

  // Builder expansion and navigation state
  const [isBuilderExpanded, setIsBuilderExpanded] = useState(true);
  
  const [navType, _setNavType] = useState<"directions" | "builder" | null>(null);
  const navTypeRef = useRef<"directions" | "builder" | null>(null);
  const setNavType = (val: "directions" | "builder" | null) => {
    navTypeRef.current = val;
    _setNavType(val);
  };

  const [activeStopIndex, _setActiveStopIndex] = useState<number>(0);
  const activeStopIndexRef = useRef<number>(0);
  const setActiveStopIndex = (val: number) => {
    activeStopIndexRef.current = val;
    _setActiveStopIndex(val);
  };

  const [_navTotalDistanceM, _setNavTotalDistanceM] = useState<number>(0);
  const navTotalDistanceMRef = useRef<number>(0);
  const setNavTotalDistanceM = (val: number) => {
    navTotalDistanceMRef.current = val;
    _setNavTotalDistanceM(val);
  };

  const [tripCompleted, setTripCompleted] = useState<boolean>(false);

  const routeItemsRef = useRef<any[]>([]);
  useEffect(() => {
    routeItemsRef.current = routeItems;
  }, [routeItems]);

  // Share Modal & Toast States
  const [shareModalVisible, setShareModalVisible] = useState(false);
  const [shareModalRouteId, setShareModalRouteId] = useState<string | null>(null);
  const [shareModalRouteName, setShareModalRouteName] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [_addingVisit, setAddingVisit] = useState(false);

  // Custom Prompt States
  const [promptVisible, setPromptVisible] = useState(false);
  const [promptTitle, setPromptTitle] = useState("");
  const [promptPlaceholder, setPromptPlaceholder] = useState("");
  const [promptValue, setPromptValue] = useState("");
  const [promptOnSubmit, setPromptOnSubmit] = useState<((val: string) => void) | null>(null);

  const showCustomPrompt = (title: string, placeholder: string, defaultValue: string, onSubmit: (val: string) => void) => {
    setPromptTitle(title);
    setPromptPlaceholder(placeholder);
    setPromptValue(defaultValue);
    setPromptOnSubmit(() => onSubmit);
    setPromptVisible(true);
  };

  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => {
        setToastMessage(null);
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  // ─── Fetch rich POI from Geoapify (expanded categories for density) ────────
  const fetchMapSights = async (lat: number, lon: number) => {
    try {
      const cats = [
        "tourism.sights",
        "catering.cafe",
        "catering.restaurant",
        "catering.fast_food",
        "accommodation.hotel",
        "healthcare.hospital",
        "healthcare.pharmacy",
        "commercial.supermarket",
        "commercial.shopping_mall",
        "religion",
        "leisure.park",
        "entertainment.museum",
        "public_transport",
        "education.school",
        "education.college",
      ].join(",");

      const sightsRes = await fetch(
        `https://api.geoapify.com/v2/places?categories=${cats}&bias=proximity:${lon},${lat}&limit=150&apiKey=${GEOAPIFY_KEY}`
      );
      const data = await sightsRes.json();
      if (!data.features) return;

      const mapped = data.features
        .filter((item: any) => item.properties.lat && item.properties.lon)
        .map((item: any) => {
          const name = item.properties.name || item.properties.street || "Spot";
          const cat = item.properties.categories || [];
          let type = "sight";
          let pinColor = "#EAB308";

          if (cat.some((c: string) => c.includes("restaurant") || c.includes("fast_food"))) {
            type = "restaurant"; pinColor = "#F97316";
          } else if (cat.some((c: string) => c.includes("cafe"))) {
            type = "cafe"; pinColor = "#06B6D4";
          } else if (cat.some((c: string) => c.includes("accommodation") || c.includes("hotel"))) {
            type = "hotel"; pinColor = "#EC4899";
          } else if (cat.some((c: string) => c.includes("hospital") || c.includes("pharmacy"))) {
            type = "medical"; pinColor = "#EF4444";
          } else if (cat.some((c: string) => c.includes("supermarket") || c.includes("shopping"))) {
            type = "shop"; pinColor = "#8B5CF6";
          } else if (cat.some((c: string) => c.includes("park") || c.includes("leisure"))) {
            type = "park"; pinColor = "#10B981";
          } else if (cat.some((c: string) => c.includes("religion"))) {
            type = "temple"; pinColor = "#FBBF24";
          } else if (cat.some((c: string) => c.includes("museum") || c.includes("entertainment"))) {
            type = "museum"; pinColor = "#A78BFA";
          } else if (cat.some((c: string) => c.includes("transport"))) {
            type = "transport"; pinColor = "#64748B";
          } else if (cat.some((c: string) => c.includes("education"))) {
            type = "school"; pinColor = "#0EA5E9";
          }

          const rating = (4.1 + (name.length % 9) * 0.1).toFixed(1);
          return {
            name,
            type,
            pinColor,
            rating,
            address: item.properties.formatted || "Nearby",
            latitude: item.properties.lat,
            longitude: item.properties.lon,
          };
        });

      setMarkers(mapped);
    } catch (e) {
      console.log("Error loading sights:", e);
    }
  };

  const extractRouteId = (urlStr: string): string | null => {
    try {
      const parsed = Linking.parse(urlStr);
      if (parsed.queryParams?.routeId) {
        return Array.isArray(parsed.queryParams.routeId)
          ? parsed.queryParams.routeId[0]
          : parsed.queryParams.routeId;
      }
      const match = urlStr.match(/\/routes\/([^?/]+)/);
      if (match && match[1]) {
        return match[1];
      }
    } catch (e) {
      console.log("Error parsing deep link URL:", e);
    }
    return null;
  };

  // ─── Boot: get GPS, subscribe Firebase, deep link ──────────────────────────
  useEffect(() => {
    // Silently grab GPS for proximity sorting (don't block UI)
    Location.requestForegroundPermissionsAsync().then(({ status }) => {
      if (status === "granted") {
        Location.getCurrentPositionAsync({}).then((loc) => {
          setUserLocation({ lat: loc.coords.latitude, lon: loc.coords.longitude });
        });
      }
    });

    fetchMapSights(region.latitude, region.longitude);

    const currentUser = auth.currentUser;
    let unsubFav = () => {};
    let unsubVisited = () => {};

    if (currentUser) {
      const qFav = query(collection(db, "favorites"), where("userId", "==", currentUser.uid));
      unsubFav = onSnapshot(qFav, (snap) => {
        const list: any[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
        setFavPlaces(list);
      });

      const qVisited = query(collection(db, "visited"), where("userId", "==", currentUser.uid));
      unsubVisited = onSnapshot(qVisited, (snap) => {
        const list: any[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
        setVisitedPlaces(list);
      });
    }

    const handleDeepLink = (event: { url: string }) => {
      const rid = extractRouteId(event.url);
      if (rid) {
        initialUrlProcessed = true;
        router.push(`/routes/${rid}`);
      }
    };
    const sub = Linking.addEventListener("url", handleDeepLink);
    if (!initialUrlProcessed) {
      Linking.getInitialURL().then((url) => {
        if (url) {
          const rid = extractRouteId(url);
          if (rid) {
            initialUrlProcessed = true;
            router.push(`/routes/${rid}`);
          }
        }
      });
    }

    return () => {
      unsubFav();
      unsubVisited();
      sub.remove();
      stopNavigation();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load user trips when mode changes to builder or on login status
  useEffect(() => {
    const currentUser = auth.currentUser;
    if (currentUser) {
      const qTrips = query(collection(db, "trips"), where("userId", "==", currentUser.uid));
      getDocs(qTrips).then((snap) => {
        const list: any[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
        setUserTrips(list);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMode]);

  // Automatically compute directions when startPlace + destPlace change
  useEffect(() => {
    if (activeMode === "directions" && startPlace && destPlace) {
      calculateDirectionsRoute();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startPlace, destPlace, activeMode]);

  // Deep Link Redirection to Route Viewer Page
  useEffect(() => {
    const rid = params?.routeId;
    if (rid && typeof rid === "string" && rid.trim() !== "") {
      router.setParams({ routeId: "" });
      router.push(`/routes/${rid}`);
    }
  }, [params?.routeId]);

  // ─── Deep link route loader ────────────────────────────────────────────────
  const loadRouteById = async (routeId: string) => {
    if (!routeId || isRouteLoadingRef.current) return;
    if (routeId === loadedRouteIdRef.current) return;

    isRouteLoadingRef.current = true;
    setLoading(true);
    try {
      const routeSnap = await getDoc(doc(db, "routes", routeId));
      if (routeSnap.exists()) {
        const routeData = routeSnap.data();
        const stops = routeData.stops || routeData.items || [];
        
        loadedRouteIdRef.current = routeId;
        setRouteItems(stops);
        setActiveMode("route_builder");
        setEditingRouteId(routeId);
        const name = routeData.routeName || routeData.name || "Custom Route";
        setEditingRouteName(name);
        setSelectedTripId(routeData.tripId || "");
        setSelectedDayNumber(routeData.dayNumber || 1);
        setIsOptimized(routeData.isOptimized || false);
        
        if (routeData.startLocation) {
          setBuilderStartText(routeData.startLocation);
          if (routeData.startCoordinates) {
            setBuilderStartPlace({
              name: routeData.startLocation,
              latitude: routeData.startCoordinates.latitude,
              longitude: routeData.startCoordinates.longitude,
              address: routeData.startLocation,
            });
          }
        } else {
          setBuilderStartText("");
          setBuilderStartPlace(null);
        }

        const finalCoords = routeData.routeCoordinates || routeData.coords;
        if (finalCoords) {
          setBuilderRouteCoords(finalCoords);
          setRouteCoords(finalCoords);
          routeCoordsRef.current = finalCoords;
        } else {
          const customStart = routeData.startCoordinates ? {
            name: routeData.startLocation,
            latitude: routeData.startCoordinates.latitude,
            longitude: routeData.startCoordinates.longitude,
            address: routeData.startLocation,
          } : null;
          await updateRoutePolyline(stops, customStart);
        }

        if (routeData.totalDistance && routeData.totalDuration) {
          setBuilderRouteStats({ distance: routeData.totalDistance, duration: routeData.totalDuration });
          setRouteStats({ distance: routeData.totalDistance, duration: routeData.totalDuration });
        }
        
        // Focus map camera on start place or first stop
        const focusTarget = routeData.startCoordinates || (stops.length > 0 ? stops[0] : null);
        if (focusTarget) {
          const newRegion = {
            latitude: focusTarget.latitude || focusTarget.lat,
            longitude: focusTarget.longitude || focusTarget.lon,
            latitudeDelta: 0.08,
            longitudeDelta: 0.08,
          };
          setRegion(newRegion);
          mapRef.current?.animateToRegion(newRegion, 1500);
        }

        Alert.alert(
          "Route Loaded 🗺️",
          `Successfully loaded "${name}" with ${stops.length} stop${stops.length !== 1 ? "s" : ""}.`
        );
      } else {
        Alert.alert("Route Not Found", "The requested travel route could not be found.");
      }
    } catch (e) {
      console.log("Deep link route load error:", e);
    } finally {
      setLoading(false);
      isRouteLoadingRef.current = false;
    }
  };

  // ─── Text change handler ───────────────────────────────────────────────────
  const handleTextChange = (text: string, type: "explore" | "start" | "dest") => {
    setActiveInputType(type);
    if (type === "explore") setSearchText(text);
    else if (type === "start") setStartText(text);
    else if (type === "dest") setDestText(text);
    fetchSuggestions(text);
  };

  // ─── ISSUE 1 FIX: GPS-sorted autocomplete ─────────────────────────────────
  const fetchSuggestions = async (queryText: string) => {
    if (!queryText || queryText.length < 2) {
      setSuggestions([]);
      return;
    }
    setAutocompleteLoading(true);
    try {
      // Use bias=proximity if we have user location for better local results
      const biasParam = userLocation
        ? `&bias=proximity:${userLocation.lon},${userLocation.lat}`
        : "";

      const res = await fetch(
        `https://api.geoapify.com/v1/geocode/autocomplete?text=${encodeURIComponent(queryText)}&limit=10${biasParam}&apiKey=${GEOAPIFY_KEY}`
      );
      const data = await res.json();
      if (!data.features) return;

      const items: any[] = data.features
        .filter((feat: any) => feat.properties.lat && feat.properties.lon)
        .map((feat: any) => ({
          name:
            feat.properties.name ||
            feat.properties.formatted?.split(",")[0] ||
            "Special Place",
          address: feat.properties.formatted || "",
          latitude: feat.properties.lat,
          longitude: feat.properties.lon,
          country: feat.properties.country || "",
          city: feat.properties.city || feat.properties.state || "",
        }));

      // Sort by distance tier first, then by exact distance within that tier
      if (userLocation) {
        items.sort((a, b) => {
          const da = haversineKm(userLocation.lat, userLocation.lon, a.latitude, a.longitude);
          const db_ = haversineKm(userLocation.lat, userLocation.lon, b.latitude, b.longitude);
          
          let tierA = 4;
          if (da < 15) tierA = 1;
          else if (da < 50) tierA = 2;
          else if (da < 150) tierA = 3;

          let tierB = 4;
          if (db_ < 15) tierB = 1;
          else if (db_ < 50) tierB = 2;
          else if (db_ < 150) tierB = 3;

          if (tierA !== tierB) {
            return tierA - tierB;
          }
          return da - db_;
        });
      }

      // Annotate with distance label
      const annotated = items.map((item) => {
        if (userLocation) {
          const d = haversineKm(userLocation.lat, userLocation.lon, item.latitude, item.longitude);
          const distLabel = d < 1 ? `${Math.round(d * 1000)} m away` : `${d.toFixed(1)} km away`;
          return { ...item, distLabel };
        }
        return item;
      });

      setSuggestions(annotated);
    } catch (e) {
      console.log("Autocomplete error:", e);
    } finally {
      setAutocompleteLoading(false);
    }
  };

  const handleSelectSuggestion = async (item: any) => {
    setSuggestions([]);
    if (activeInputType === "explore") {
      setSearchText(item.name);
      const newRegion = {
        latitude: item.latitude,
        longitude: item.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      };
      setRegion(newRegion);
      mapRef.current?.animateToRegion(newRegion, 1000);
      setSelectedPlace({
        name: item.name,
        type: "sight",
        rating: "4.8",
        address: item.address,
        latitude: item.latitude,
        longitude: item.longitude,
        pinColor: "#38BDF8",
      });
      await fetchMapSights(item.latitude, item.longitude);
    } else if (activeInputType === "start") {
      setStartPlace(item);
      setStartText(item.name);
    } else if (activeInputType === "dest") {
      setDestPlace(item);
      setDestText(item.name);
    } else if (activeInputType === "builder_start") {
      setBuilderStartPlace(item);
      setBuilderStartText(item.name);
      await updateRoutePolyline(routeItems, item);
    } else if (activeInputType === "builder_add_stop") {
      setBuilderAddText("");
      await addToRoute(item);
    }
  };

  // ─── Duration formatter ────────────────────────────────────────────────────
  const formatDuration = (seconds: number): string => {
    const mins = Math.round(seconds / 60);
    if (mins < 60) return `${mins} mins`;
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem > 0 ? `${hrs} hr ${rem} mins` : `${hrs} hr`;
  };

  // ─── Directions calculation ────────────────────────────────────────────────
  const calculateDirectionsRoute = async () => {
    if (!startPlace || !destPlace) return;
    setLoading(true);
    stopNavigation();
    try {
      const res = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${startPlace.longitude},${startPlace.latitude};${destPlace.longitude},${destPlace.latitude}?overview=full&geometries=geojson`
      );
      const data = await res.json();
      if (data.routes?.length > 0) {
        const route = data.routes[0];
        const coords = route.geometry.coordinates.map((c: any) => ({
          latitude: c[1],
          longitude: c[0],
        }));
        setDirectionsRouteCoords(coords);
        setDirectionsRouteDistanceM(route.distance);
        setDirectionsRouteDurationS(route.duration);
        setDirectionsRouteStats({
          distance: (route.distance / 1000).toFixed(1),
          duration: formatDuration(route.duration),
        });

        setRouteCoords(coords);
        routeCoordsRef.current = coords;
        setRouteDistanceM(route.distance);
        setRouteDurationS(route.duration);
        setRouteStats({
          distance: (route.distance / 1000).toFixed(1),
          duration: formatDuration(route.duration),
        });
        mapRef.current?.fitToCoordinates(
          [
            { latitude: startPlace.latitude, longitude: startPlace.longitude },
            { latitude: destPlace.latitude, longitude: destPlace.longitude },
          ],
          { edgePadding: { top: 100, right: 50, bottom: 260, left: 50 }, animated: true }
        );
      } else {
        Alert.alert("Route Error", "Could not calculate driving directions.");
      }
    } catch (e) {
      console.log("Directions error:", e);
      const fallback = [
        { latitude: startPlace.latitude, longitude: startPlace.longitude },
        { latitude: destPlace.latitude, longitude: destPlace.longitude },
      ];
      setDirectionsRouteCoords(fallback);
      setDirectionsRouteStats({ distance: "N/A", duration: "N/A" });
      setRouteCoords(fallback);
      routeCoordsRef.current = fallback;
      setRouteStats({ distance: "N/A", duration: "N/A" });
    } finally {
      setLoading(false);
    }
  };

  // ─── Stop Navigation ───────────────────────────────────────────────────────
  const stopNavigation = () => {
    if (navIntervalRef.current) {
      clearInterval(navIntervalRef.current);
      navIntervalRef.current = null;
    }
    setIsNavigating(false);
    setNavType(null);
    setNavProgress(0);
    setNavRemDistM(0);
    setNavRemDurS(0);
    setNavNextStop("");
    setActiveStopIndex(0);
  };

  const recalculateBuilderNavRoute = async (lat: number, lon: number, startIndex: number) => {
    try {
      const targetStop = routeItemsRef.current[startIndex];
      if (!targetStop) return;
      const coordsString = `${lon},${lat};${targetStop.longitude || targetStop.lon},${targetStop.latitude || targetStop.lat}`;
      
      const res = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${coordsString}?overview=full&geometries=geojson`
      );
      const data = await res.json();
      if (data.routes?.length > 0) {
        const route = data.routes[0];
        const coords = route.geometry.coordinates.map((c: any) => ({
          latitude: c[1],
          longitude: c[0],
        }));
        routeCoordsRef.current = coords;
        setRouteCoords(coords);
        setRouteDistanceM(route.distance);
        setRouteDurationS(route.duration);
        setNavRemDistM(route.distance);
        setNavRemDurS(route.duration);
        setNavNextStop(targetStop.name);
      }
    } catch (e) {
      console.log("Error recalculating builder navigation route:", e);
    }
  };

  const startBuilderNavigation = async () => {
    if (routeItemsRef.current.length < 1) {
      Alert.alert("Route Required", "Please add at least 1 stop to build a route.");
      return;
    }

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission Required", "Location access is needed for navigation.");
      return;
    }

    setLoading(true);
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const { latitude: uLat, longitude: uLon } = loc.coords;
      setUserLocation({ lat: uLat, lon: uLon });

      setActiveStopIndex(0);
      setTripCompleted(false);
      setNavType("builder");
      setIsBuilderExpanded(false);

      // Calculate initial route from user GPS to Stop 1
      const targetStop = routeItemsRef.current[0];
      const coordsString = `${uLon},${uLat};${targetStop.longitude || targetStop.lon},${targetStop.latitude || targetStop.lat}`;

      const res = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${coordsString}?overview=full&geometries=geojson`
      );
      const data = await res.json();
      if (data.routes?.length > 0) {
        const route = data.routes[0];
        const coords = route.geometry.coordinates.map((c: any) => ({
          latitude: c[1],
          longitude: c[0],
        }));
        setRouteCoords(coords);
        routeCoordsRef.current = coords;
        setRouteDistanceM(route.distance);
        setRouteDurationS(route.duration);
        setNavTotalDistanceM(route.distance);
        setNavRemDistM(route.distance);
        setNavRemDurS(route.duration);
        setNavNextStop(targetStop.name);

        setIsNavigating(true);

        // Move map camera to user position
        mapRef.current?.animateToRegion(
          { latitude: uLat, longitude: uLon, latitudeDelta: 0.015, longitudeDelta: 0.015 },
          1000
        );

        // Start GPS polling
        navIntervalRef.current = setInterval(async () => {
          try {
            const currentLoc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
            const { latitude: cLat, longitude: cLon } = currentLoc.coords;
            setUserLocation({ lat: cLat, lon: cLon });

            const currentCoords = routeCoordsRef.current;
            if (currentCoords.length < 2) return;

            // Find closest point on route
            let minDist = Infinity;
            let closestIdx = 0;
            for (let i = 0; i < currentCoords.length - 1; i++) {
              const d = pointToSegmentDist(
                cLat, cLon,
                currentCoords[i].latitude, currentCoords[i].longitude,
                currentCoords[i + 1].latitude, currentCoords[i + 1].longitude
              );
              if (d < minDist) { minDist = d; closestIdx = i; }
            }

            // Check if user is off-route (> 150m)
            const currentIdx = activeStopIndexRef.current;
            if (minDist > REROUTE_THRESHOLD_KM) {
              console.log("Off-route detected in builder mode, recalculating...");
              await recalculateBuilderNavRoute(cLat, cLon, currentIdx);
              return;
            }

            // Calculate remaining distance along route from closestIdx
            let remDist = 0;
            for (let i = closestIdx; i < currentCoords.length - 1; i++) {
              remDist += haversineKm(
                currentCoords[i].latitude, currentCoords[i].longitude,
                currentCoords[i + 1].latitude, currentCoords[i + 1].longitude
              ) * 1000;
            }

            // Add dist from user to closest segment point
            remDist += minDist * 1000;

            const totalStops = routeItemsRef.current.length;
            const segmentProgress = Math.max(0, Math.min(1, 1 - remDist / Math.max(routeDistanceMRef.current, 1)));
            const progress = (currentIdx + segmentProgress) / Math.max(totalStops, 1);
            setNavProgress(Math.min(1, Math.max(0, progress)));
            setNavRemDistM(Math.max(0, remDist));

            const distRefVal = routeDistanceMRef.current;
            const durRefVal = routeDurationSRef.current;
            const remFrac = remDist / Math.max(distRefVal, 1);
            setNavRemDurS(Math.max(0, durRefVal * remFrac));

            // Pan camera to follow user
            mapRef.current?.animateToRegion(
              { latitude: cLat, longitude: cLon, latitudeDelta: 0.015, longitudeDelta: 0.015 },
              800
            );

            // Check proximity to target stop
            const stops = routeItemsRef.current;
            const targetStop = stops[currentIdx];
            if (targetStop) {
              const distToStopKm = haversineKm(
                cLat, cLon,
                targetStop.latitude || targetStop.lat,
                targetStop.longitude || targetStop.lon
              );

              if (distToStopKm < 0.05) {
                // Reached stop!
                if (currentIdx === stops.length - 1) {
                  // Final destination reached!
                  if (navIntervalRef.current) {
                    clearInterval(navIntervalRef.current);
                    navIntervalRef.current = null;
                  }
                  setIsNavigating(false);
                  setNavType(null);
                  setTripCompleted(true);
                } else {
                  // Move to next stop
                  const nextIdx = currentIdx + 1;
                  setActiveStopIndex(nextIdx);
                  setNavNextStop(stops[nextIdx].name);
                  Alert.alert("Destination Reached 📍", `You have reached "${targetStop.name}"! Proceeding to "${stops[nextIdx].name}"...`);
                  // Recalculate route to remaining stops
                  await recalculateBuilderNavRoute(cLat, cLon, nextIdx);
                }
              }
            }
          } catch (e) {
            console.log("Builder Navigation GPS poll error:", e);
          }
        }, 3000);
      } else {
        Alert.alert("Route Error", "Could not calculate a driving route through your stops.");
      }
    } catch (e) {
      console.log("Builder start navigation error:", e);
      Alert.alert("Error", "Could not initialize builder navigation.");
    } finally {
      setLoading(false);
    }
  };

  const startNavigation = async () => {
    if (!startPlace || !destPlace) {
      Alert.alert("Set Route", "Please set a start and destination first.");
      return;
    }
    if (routeCoordsRef.current.length < 2) {
      Alert.alert("Route Required", "Please wait for the route to load.");
      return;
    }

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission Required", "Location access is needed for navigation.");
      return;
    }

    setIsNavigating(true);
    setNavType("directions");
    setNavRemDistM(routeDistanceM);
    setNavRemDurS(routeDurationS);
    setNavNextStop(destPlace.name);

    // Poll GPS every 3 seconds
    navIntervalRef.current = setInterval(async () => {
      try {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        const { latitude: uLat, longitude: uLon } = loc.coords;

        // Update user location for suggestion sorting
        setUserLocation({ lat: uLat, lon: uLon });

        const coords = routeCoordsRef.current;
        if (coords.length < 2) return;

        // Find closest point on route
        let minDist = Infinity;
        let closestIdx = 0;
        for (let i = 0; i < coords.length - 1; i++) {
          const d = pointToSegmentDist(
            uLat, uLon,
            coords[i].latitude, coords[i].longitude,
            coords[i + 1].latitude, coords[i + 1].longitude
          );
          if (d < minDist) { minDist = d; closestIdx = i; }
        }

        // Check if user is off-route (> 150m)
        if (minDist > REROUTE_THRESHOLD_KM && destPlace) {
          console.log("Off-route detected, recalculating...");
          const reroute = await fetch(
            `https://router.project-osrm.org/route/v1/driving/${uLon},${uLat};${destPlace.longitude},${destPlace.latitude}?overview=full&geometries=geojson`
          );
          const rData = await reroute.json();
          if (rData.routes?.length > 0) {
            const newRoute = rData.routes[0];
            const newCoords = newRoute.geometry.coordinates.map((c: any) => ({
              latitude: c[1],
              longitude: c[0],
            }));
            routeCoordsRef.current = newCoords;
            setRouteCoords(newCoords);
            setRouteDistanceM(newRoute.distance);
            setRouteDurationS(newRoute.duration);
            setNavRemDistM(newRoute.distance);
            setNavRemDurS(newRoute.duration);
          }
          return;
        }

        // Calculate remaining distance along route from closestIdx
        let remDist = 0;
        for (let i = closestIdx; i < coords.length - 1; i++) {
          remDist += haversineKm(
            coords[i].latitude, coords[i].longitude,
            coords[i + 1].latitude, coords[i + 1].longitude
          ) * 1000;
        }

        // Add dist from user to closest segment point
        remDist += minDist * 1000;

        const progress = Math.min(1, 1 - remDist / Math.max(routeDistanceM, 1));
        setNavProgress(progress);
        setNavRemDistM(Math.max(0, remDist));

        // Estimate remaining time proportionally to speed
        const remFrac = remDist / Math.max(routeDistanceM, 1);
        setNavRemDurS(Math.max(0, routeDurationS * remFrac));

        // Pan camera to follow user
        mapRef.current?.animateToRegion(
          { latitude: uLat, longitude: uLon, latitudeDelta: 0.015, longitudeDelta: 0.015 },
          800
        );

        // Arrived?
        const distToDestKm = haversineKm(uLat, uLon, destPlace.latitude, destPlace.longitude);
        if (distToDestKm < 0.05) {
          stopNavigation();
          Alert.alert("🎉 Arrived!", `You have reached ${destPlace.name}!`);
        }
      } catch (e) {
        console.log("Navigation GPS poll error:", e);
      }
    }, 3000);
  };

  // ─── Route polyline for builder ────────────────────────────────────────────
  const updateRoutePolyline = async (items: any[], customStart?: any) => {
    const start = customStart !== undefined ? customStart : builderStartPlace;
    const allStops = [];
    if (start) {
      allStops.push(start);
    }
    allStops.push(...items);

    if (allStops.length < 2) {
      setBuilderRouteCoords([]);
      setBuilderRouteStats(null);
      setRouteCoords([]);
      routeCoordsRef.current = [];
      setRouteStats(null);
      return;
    }
    try {
      const coordsString = allStops
        .map((item) => `${item.longitude || item.lon},${item.latitude || item.lat}`)
        .join(";");
      const res = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${coordsString}?overview=full&geometries=geojson`
      );
      const data = await res.json();
      if (data.routes?.length > 0) {
        const route = data.routes[0];
        const coords = route.geometry.coordinates.map((c: any) => ({
          latitude: c[1],
          longitude: c[0],
        }));
        setBuilderRouteCoords(coords);
        setBuilderRouteDistanceM(route.distance);
        setBuilderRouteDurationS(route.duration);
        setBuilderRouteStats({
          distance: (route.distance / 1000).toFixed(1),
          duration: formatDuration(route.duration),
        });

        setRouteCoords(coords);
        routeCoordsRef.current = coords;
        setRouteDistanceM(route.distance);
        setRouteDurationS(route.duration);
        setRouteStats({
          distance: (route.distance / 1000).toFixed(1),
          duration: formatDuration(route.duration),
        });
      } else throw new Error("No route");
    } catch {
      const fallback = allStops.map((item) => ({
        latitude: item.latitude || item.lat,
        longitude: item.longitude || item.lon,
      }));
      setBuilderRouteCoords(fallback);
      setBuilderRouteStats({ distance: "N/A", duration: "N/A" });
      setRouteCoords(fallback);
      routeCoordsRef.current = fallback;
      setRouteStats({ distance: "N/A", duration: "N/A" });
    }
  };

  // ─── Route Builder controls ────────────────────────────────────────────────
  const addToRoute = async (item: any) => {
    if (routeItems.some((r) => r.name === item.name)) {
      Alert.alert("Already Added", "This spot is already in your route.");
      return;
    }
    const updated = [...routeItems, item];
    setRouteItems(updated);
    await updateRoutePolyline(updated);
    Alert.alert("Added! 📍", `Added "${item.name}" to route.`);
  };

  const removeFromRoute = async (index: number) => {
    const updated = routeItems.filter((_, i) => i !== index);
    setRouteItems(updated);
    await updateRoutePolyline(updated);
  };

  const moveRouteItem = async (index: number, direction: "up" | "down") => {
    if (direction === "up" && index === 0) return;
    if (direction === "down" && index === routeItems.length - 1) return;
    const updated = [...routeItems];
    const tgt = direction === "up" ? index - 1 : index + 1;
    [updated[index], updated[tgt]] = [updated[tgt], updated[index]];
    setRouteItems(updated);
    await updateRoutePolyline(updated);
  };

  const handleOptimizeRoute = async () => {
    if (routeItems.length <= 2) {
      Alert.alert("Optimization Info", "Add at least 3 stops to optimize.");
      return;
    }
    setLoading(true);
    try {
      const spots = routeItems.map((item) => ({
        name: item.name,
        latitude: item.latitude || item.lat,
        longitude: item.longitude || item.lon,
      }));
      const optimized = await travelApiService.optimizeTravelRoute(spots);
      const optimizedItems = optimized.map((spot) => ({
        ...(routeItems.find((r) => r.name === spot.name) || {}),
        ...spot,
      }));
      setRouteItems(optimizedItems);
      await updateRoutePolyline(optimizedItems);
      setIsOptimized(true);
      Alert.alert("Route Optimized ✨", "Stops sorted using FastAPI TSP solver!");
    } catch {
      Alert.alert("Error", "Could not complete optimization.");
    } finally {
      setLoading(false);
    }
  };

  const saveRouteToFirestore = async () => {
    if (routeItems.length < 1) {
      Alert.alert("Cannot Save", "Add at least 1 destination stop.");
      return;
    }

    const currentUser = auth.currentUser;
    if (!currentUser) {
      Alert.alert("Authentication Required", "Please log in to save routes.");
      return;
    }

    const selectedTrip = userTrips.find(t => t.id === selectedTripId);
    const defaultName = selectedTrip 
      ? `Day ${selectedDayNumber} Map` 
      : (editingRouteName || "My Route");

    const routeData = {
      userId: currentUser.uid,
      createdBy: currentUser.uid,
      name: defaultName,
      routeName: defaultName,
      tripId: selectedTripId || null,
      dayNumber: selectedDayNumber || null,
      items: routeItems, // Backwards compatibility
      coords: builderRouteCoords, // Backwards compatibility
      startLocation: builderStartText || "Current Location",
      startCoordinates: builderStartPlace ? {
        latitude: builderStartPlace.latitude || builderStartPlace.lat,
        longitude: builderStartPlace.longitude || builderStartPlace.lon,
      } : null,
      stops: routeItems.map(item => ({
        name: item.name,
        latitude: item.latitude || item.lat,
        longitude: item.longitude || item.lon,
        address: item.address || "",
      })),
      routeCoordinates: builderRouteCoords.map(coord => ({
        latitude: coord.latitude,
        longitude: coord.longitude
      })),
      totalDistance: builderRouteStats?.distance || "N/A",
      totalDuration: builderRouteStats?.duration || "N/A",
      isOptimized: isOptimized,
      updatedAt: new Date(),
    };

    if (selectedTrip) {
      setSavingRoute(true);
      try {
        let activeId = editingRouteId;
        if (activeId) {
          await updateDoc(doc(db, "routes", activeId), {
            ...routeData,
            name: defaultName,
            routeName: defaultName,
          });
        } else {
          const docRef = await addDoc(collection(db, "routes"), {
            ...routeData,
            name: defaultName,
            routeName: defaultName,
            createdAt: new Date(),
          });
          await updateDoc(docRef, { routeId: docRef.id });
          activeId = docRef.id;
          setEditingRouteId(docRef.id);
          setEditingRouteName(defaultName);
        }
        if (selectedTripId && activeId) {
          const webLink = `https://tripsync.app/routes/${activeId}`;
          await updateTripDayRoute(selectedTripId, selectedDayNumber, activeId, webLink, routeItems);
        }
        Alert.alert("Route Saved! 🌟", `Route "${defaultName}" saved successfully.`);
      } catch (_err) {
        Alert.alert("Error", "Could not save route in Firebase.");
      } finally {
        setSavingRoute(false);
      }
      return;
    }

    if (editingRouteId) {
      setSavingRoute(true);
      try {
        await updateDoc(doc(db, "routes", editingRouteId), {
          ...routeData,
          name: editingRouteName || defaultName,
          routeName: editingRouteName || defaultName,
        });
        Alert.alert("Route Saved! 🌟", `Changes to "${editingRouteName || defaultName}" saved successfully.`);
      } catch (_err) {
        Alert.alert("Error", "Could not update route in Firebase.");
      } finally {
        setSavingRoute(false);
      }
      return;
    }

    showCustomPrompt("Save Route", "Enter a name for this route:", defaultName, async (name) => {
      if (!name?.trim()) {
        Alert.alert("Required", "Please provide a route name.");
        return;
      }
      setSavingRoute(true);
      try {
        const finalName = name.trim();
        const docRef = await addDoc(collection(db, "routes"), {
          ...routeData,
          name: finalName,
          routeName: finalName,
          createdAt: new Date(),
        });
        await updateDoc(docRef, { routeId: docRef.id });
        setEditingRouteId(docRef.id);
        setEditingRouteName(finalName);
        Alert.alert("Route Saved! 🌟", `"${finalName}" saved successfully.`);
      } catch (_err) {
        Alert.alert("Error", "Could not save route.");
      } finally {
        setSavingRoute(false);
      }
    });
  };

  const saveAndShareRoute = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      Alert.alert("Authentication Required", "Please log in to share routes.");
      return;
    }

    if (routeItems.length < 1) {
      Alert.alert("Cannot Share", "Add at least 1 destination stop.");
      return;
    }

    const selectedTrip = userTrips.find(t => t.id === selectedTripId);
    const defaultName = selectedTrip 
      ? `Day ${selectedDayNumber} Map` 
      : (editingRouteName || "My Route");

    if (selectedTrip) {
      setSavingRoute(true);
      try {
        const finalName = defaultName;
        const routeData = {
          userId: currentUser.uid,
          createdBy: currentUser.uid,
          name: finalName,
          routeName: finalName,
          tripId: selectedTripId || null,
          dayNumber: selectedDayNumber || null,
          items: routeItems, // Backwards compatibility
          coords: builderRouteCoords, // Backwards compatibility
          startLocation: builderStartText || "Current Location",
          startCoordinates: builderStartPlace ? {
            latitude: builderStartPlace.latitude || builderStartPlace.lat,
            longitude: builderStartPlace.longitude || builderStartPlace.lon,
          } : null,
          stops: routeItems.map(item => ({
            name: item.name,
            latitude: item.latitude || item.lat,
            longitude: item.longitude || item.lon,
            address: item.address || "",
          })),
          routeCoordinates: builderRouteCoords.map(coord => ({
            latitude: coord.latitude,
            longitude: coord.longitude
          })),
          totalDistance: builderRouteStats?.distance || "N/A",
          totalDuration: builderRouteStats?.duration || "N/A",
          isOptimized: isOptimized,
          updatedAt: new Date(),
        };

        let activeId = editingRouteId;
        if (activeId) {
          await updateDoc(doc(db, "routes", activeId), routeData);
          setEditingRouteName(finalName);
        } else {
          const newRouteData = {
            ...routeData,
            createdAt: new Date(),
          };
          const docRef = await addDoc(collection(db, "routes"), newRouteData);
          await updateDoc(docRef, { routeId: docRef.id });
          activeId = docRef.id;
          setEditingRouteId(docRef.id);
          setEditingRouteName(finalName);
        }

        if (selectedTripId && activeId) {
          const webLink = `https://tripsync.app/routes/${activeId}`;
          await updateTripDayRoute(selectedTripId, selectedDayNumber, activeId, webLink, routeItems);
        }

        await generateRouteShare(activeId, finalName);
      } catch (err) {
        console.log("Save & Share Firestore save error:", err);
        Alert.alert("Error", "Could not save route to Firebase.");
      } finally {
        setSavingRoute(false);
      }
      return;
    }

    showCustomPrompt(
      "Save & Share Route",
      "Enter a name for this route:",
      defaultName,
      async (name) => {
        if (!name?.trim()) {
          Alert.alert("Required", "Please provide a route name.");
          return;
        }
        const finalName = name.trim();
        setSavingRoute(true);
        try {
          const routeData = {
            userId: currentUser.uid,
            createdBy: currentUser.uid,
            name: finalName,
            routeName: finalName,
            tripId: selectedTripId || null,
            dayNumber: selectedDayNumber || null,
            items: routeItems, // Backwards compatibility
            coords: builderRouteCoords, // Backwards compatibility
            startLocation: builderStartText || "Current Location",
            startCoordinates: builderStartPlace ? {
              latitude: builderStartPlace.latitude || builderStartPlace.lat,
              longitude: builderStartPlace.longitude || builderStartPlace.lon,
            } : null,
            stops: routeItems.map(item => ({
              name: item.name,
              latitude: item.latitude || item.lat,
              longitude: item.longitude || item.lon,
              address: item.address || "",
            })),
            routeCoordinates: builderRouteCoords.map(coord => ({
              latitude: coord.latitude,
              longitude: coord.longitude
            })),
            totalDistance: builderRouteStats?.distance || "N/A",
            totalDuration: builderRouteStats?.duration || "N/A",
            isOptimized: isOptimized,
            updatedAt: new Date(),
          };

          let activeId = editingRouteId;
          if (activeId) {
            await updateDoc(doc(db, "routes", activeId), routeData);
            setEditingRouteName(finalName);
          } else {
            const newRouteData = {
              ...routeData,
              createdAt: new Date(),
            };
            const docRef = await addDoc(collection(db, "routes"), newRouteData);
            await updateDoc(docRef, { routeId: docRef.id });
            activeId = docRef.id;
            setEditingRouteId(docRef.id);
            setEditingRouteName(finalName);
          }

          if (selectedTripId && activeId) {
            const webLink = `https://tripsync.app/routes/${activeId}`;
            await updateTripDayRoute(selectedTripId, selectedDayNumber, activeId, webLink, routeItems);
          }

          await generateRouteShare(activeId, finalName);
        } catch (err) {
          console.log("Save & Share Firestore save error:", err);
          Alert.alert("Error", "Could not save route to Firebase.");
        } finally {
          setSavingRoute(false);
        }
      }
    );
  };

  const generateRouteShare = async (routeId: string, routeName: string) => {
    try {
      const currentUser = auth.currentUser;
      // STEP 4: Create Deep Link
      const deepLink = `tripsync://map?routeId=${routeId}`;
      // STEP 5: Create Share URL
      const webLink = `https://tripsync.app/routes/${routeId}`;

      // STEP 3 & STEP 6: Store share metadata in routeShares
      const shareDoc = await addDoc(collection(db, "routeShares"), {
        routeId: routeId,
        routeName: routeName,
        createdBy: currentUser?.uid || "anonymous",
        sharedAt: new Date(),
        shareUrl: webLink,
        deepLink: deepLink,
      });
      await updateDoc(shareDoc, { shareId: shareDoc.id });

      // Update the routes collection document with the sharing metadata
      await updateDoc(doc(db, "routes", routeId), {
        shareId: shareDoc.id,
        shareUrl: webLink,
        deepLink: deepLink,
        sharedAt: new Date(),
        createdBy: currentUser?.uid || "anonymous",
      });

      // Call extended FastAPI backend to log analytics for this shared route
      const getApiBaseUrl = () => {
        const envUrl = process.env.EXPO_PUBLIC_API_URL || "https://tripsyncbackend-production-37a2.up.railway.app";
        const cleaned = envUrl.replace(/\/+$/, "");
        return cleaned.endsWith("/api") ? cleaned : `${cleaned}/api`;
      };
      const API_BASE = getApiBaseUrl();
      try {
        await fetch(`${API_BASE}/routes/share`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            routeId: routeId,
            routeName: routeName,
            stopsCount: routeItems.length,
            totalDistance: routeStats?.distance || "N/A",
            totalDuration: routeStats?.duration || "N/A",
          }),
        });
      } catch (err) {
        console.log("FastAPI sharing analytics log failed (ignoring, falling back):", err);
      }

      // STEP 7: Open Native Share Sheet
      try {
        await Share.share({
          title: `Share Route: ${routeName}`,
          message: `Check out my travel route "${routeName}" on TripSync! 🗺️\n\nDeep Link: ${deepLink}\nWeb Link: ${webLink}`,
        });
      } catch (shareErr) {
        console.log("Native share direct trigger failed/dismissed:", shareErr);
      }

      // STEP 8 & STEP 9: Show Share Modal (with Copy Link button inside)
      setShareModalRouteId(routeId);
      setShareModalRouteName(routeName);
      setShareModalVisible(true);

    } catch (err) {
      console.log("Error generating route share:", err);
      Alert.alert("Error", "Failed to initialize route sharing.");
    }
  };

  const handleNativeShare = async () => {
    if (!shareModalRouteId || !shareModalRouteName) return;
    const deepLink = `tripsync://map?routeId=${shareModalRouteId}`;
    const webLink = `https://tripsync.app/routes/${shareModalRouteId}`;
    try {
      await Share.share({
        title: `Share Route: ${shareModalRouteName}`,
        message: `Check out my travel route "${shareModalRouteName}" on TripSync! 🗺️\n\nDeep Link: ${deepLink}\nWeb Link: ${webLink}`,
      });
    } catch (err) {
      console.log("Native share error:", err);
    }
  };

  const handleCopyLink = () => {
    if (!shareModalRouteId) return;
    const webLink = `https://tripsync.app/routes/${shareModalRouteId}`;
    Clipboard.setString(webLink);
    setToastMessage("Link Copied Successfully");
  };

  const handleOpenRoute = () => {
    if (!shareModalRouteId) return;
    setShareModalVisible(false);
    loadRouteById(shareModalRouteId);
  };

  const handleCloseBuilder = () => {
    setRouteItems([]);
    setBuilderRouteCoords([]);
    setBuilderRouteStats(null);
    setRouteCoords([]);
    setRouteStats(null);
    setEditingRouteId(null);
    setEditingRouteName(null);
    loadedRouteIdRef.current = null;
    setBuilderStartPlace(null);
    setBuilderStartText("");
    setBuilderAddText("");
    router.setParams({ routeId: "" });
    setActiveStopIndex(0);
    stopNavigation();
    setSelectedPlace(null);
    setActiveMode("explore");
  };

  const handleNewBuilder = () => {
    setRouteItems([]);
    setBuilderRouteCoords([]);
    setBuilderRouteStats(null);
    setRouteCoords([]);
    setRouteStats(null);
    setEditingRouteId(null);
    setEditingRouteName(null);
    loadedRouteIdRef.current = null;
    setBuilderStartPlace(null);
    setBuilderStartText("");
    setBuilderAddText("");
    router.setParams({ routeId: "" });
    setActiveStopIndex(0);
    stopNavigation();
    setSelectedPlace(null);
    setActiveMode("route_builder");
  };

  const renameRoute = () => {
    if (!editingRouteId || !editingRouteName) return;
    showCustomPrompt("Rename Route", "Enter new name for this route:", editingRouteName, async (newName) => {
      if (!newName?.trim()) return;
      try {
        await updateDoc(doc(db, "routes", editingRouteId), {
          name: newName.trim(),
          routeName: newName.trim(),
        });
        setEditingRouteName(newName.trim());
        Alert.alert("Success", "Route renamed successfully!");
      } catch {
        Alert.alert("Error", "Could not rename route.");
      }
    });
  };



  // ─── GPS utilities ─────────────────────────────────────────────────────────
  const locateUser = async () => {
    setLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") { Alert.alert("Permission Required", "GPS is needed."); return; }
      const loc = await Location.getCurrentPositionAsync({});
      const newRegion = {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        latitudeDelta: 0.03,
        longitudeDelta: 0.03,
      };
      setUserLocation({ lat: loc.coords.latitude, lon: loc.coords.longitude });
      setRegion(newRegion);
      mapRef.current?.animateToRegion(newRegion, 1000);
      await fetchMapSights(newRegion.latitude, newRegion.longitude);
    } catch { Alert.alert("Error", "Could not capture GPS."); }
    finally { setLoading(false); }
  };

  const useMyLocationAsStart = async () => {
    setLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") { Alert.alert("Permission Required", "GPS is needed."); return; }
      const loc = await Location.getCurrentPositionAsync({});
      const gpsPlace = {
        name: "My Location",
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        address: "Current GPS",
      };
      setUserLocation({ lat: loc.coords.latitude, lon: loc.coords.longitude });
      setStartPlace(gpsPlace);
      setStartText("My Location");
    } catch { Alert.alert("GPS Error", "Failed to retrieve coordinates."); }
    finally { setLoading(false); }
  };

  const useGPSForBuilderStart = async () => {
    setLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission Required", "Location access is needed.");
        return;
      }
      const loc = await Location.getCurrentPositionAsync({});
      const gpsPlace = {
        name: "My Location",
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        address: "Current GPS coordinates",
      };
      setUserLocation({ lat: loc.coords.latitude, lon: loc.coords.longitude });
      setBuilderStartPlace(gpsPlace);
      setBuilderStartText("My Location");
      await updateRoutePolyline(routeItems, gpsPlace);
    } catch (e) {
      console.log("GPS starter error:", e);
      Alert.alert("GPS Error", "Failed to retrieve coordinates.");
    } finally {
      setLoading(false);
    }
  };

  const zoomMap = (direction: "in" | "out") => {
    const factor = direction === "in" ? 0.5 : 2;
    const newRegion = {
      ...region,
      latitudeDelta: region.latitudeDelta * factor,
      longitudeDelta: region.longitudeDelta * factor,
    };
    setRegion(newRegion);
    mapRef.current?.animateToRegion(newRegion, 450);
  };

  // ─── Favorites ─────────────────────────────────────────────────────────────
  const handleAddToFavorites = async (item: any) => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      Alert.alert("Not Logged In", "Please log in to save favorites.");
      return;
    }
    try {
      const q = query(
        collection(db, "favorites"),
        where("name", "==", item.name),
        where("userId", "==", currentUser.uid)
      );
      const snap = await getDocs(q);
      if (!snap.empty) { Alert.alert("Already Saved", "Already in Favorites."); return; }
      const imgs = [
        "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=800&q=80",
        "https://images.unsplash.com/photo-1554118811-1e0d58224f24?auto=format&fit=crop&w=800&q=80",
        "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=800&q=80",
      ];
      await addDoc(collection(db, "favorites"), {
        name: item.name, rating: item.rating || "4.7",
        address: item.address || "Location", image: imgs[item.name.length % 3],
        crowd: "Medium", lat: item.latitude || item.lat, lon: item.longitude || item.lon,
        userId: currentUser.uid,
        createdAt: new Date(),
      });
      Alert.alert("Success ❤️", `Added "${item.name}" to Favorites!`);
    } catch { Alert.alert("Error", "Could not save."); }
  };

  const handleMarkAsVisited = async (item: any) => {
    if (!item) return;
    const currentUser = auth.currentUser;
    if (!currentUser) {
      Alert.alert("Not Logged In", "Please log in to mark places as visited.");
      return;
    }
    setAddingVisit(true);
    try {
      const q = query(
        collection(db, "visited"),
        where("name", "==", item.name),
        where("userId", "==", currentUser.uid)
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        setToastMessage("Already marked as visited");
        setAddingVisit(false);
        return;
      }
      const imgs = [
        "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=800&q=80",
        "https://images.unsplash.com/photo-1554118811-1e0d58224f24?auto=format&fit=crop&w=800&q=80",
        "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=800&q=80",
      ];
      await addDoc(collection(db, "visited"), {
        name: item.name,
        rating: item.rating || "4.7",
        address: item.address || "Location",
        image: imgs[item.name.length % 3],
        category: item.type || "Sight",
        lat: item.latitude || item.lat,
        lon: item.longitude || item.lon,
        visitedAt: new Date(),
        memories: "",
        userId: currentUser.uid,
      });
      setToastMessage("Added to Visited Places");
    } catch (e) {
      console.log("Error marking as visited:", e);
      Alert.alert("Error", "Could not mark as visited.");
    } finally {
      setAddingVisit(false);
    }
  };

  // ─── Marker rendering ──────────────────────────────────────────────────────
  const filteredMarkers = markers.filter((m) => {
    if (filter === "all") return true;
    if (filter === "sights") return m.type === "sight" || m.type === "museum" || m.type === "temple";
    if (filter === "cafes") return m.type === "cafe" || m.type === "restaurant";
    if (filter === "hotels") return m.type === "hotel";
    return true;
  });

  // Zoom-based delta marker filtering to declutter
  let zoomLimit = 150;
  if (region.latitudeDelta > 0.15) {
    zoomLimit = 30;
  } else if (region.latitudeDelta > 0.05) {
    zoomLimit = 80;
  }

  const slicedFilteredMarkers = filteredMarkers.slice(0, zoomLimit);
  const allMapPins = [...slicedFilteredMarkers];
  favPlaces.forEach((f) => {
    if (f.lat && f.lon && !allMapPins.some((p) => p.name === f.name)) {
      allMapPins.push({ name: f.name, type: "favorite", rating: f.rating || "4.8", address: f.address || "", latitude: f.lat, longitude: f.lon, pinColor: "#EF4444" });
    }
  });
  visitedPlaces.forEach((v) => {
    if (v.lat && v.lon) {
      const idx = allMapPins.findIndex((p) => p.name === v.name);
      if (idx !== -1) { allMapPins[idx].type = "both"; allMapPins[idx].pinColor = "#F59E0B"; }
      else allMapPins.push({ name: v.name, type: "visited", rating: v.rating || "4.8", address: v.address || "", latitude: v.lat, longitude: v.lon, pinColor: "#10B981" });
    }
  });

  const getMarkerIcon = (type: string) => {
    if (type === "favorite") return <Ionicons name="heart" size={12} color="white" />;
    if (type === "visited") return <Ionicons name="checkmark" size={12} color="white" />;
    if (type === "both") return <Ionicons name="star" size={12} color="white" />;
    if (type === "cafe") return <Ionicons name="cafe" size={12} color="white" />;
    if (type === "restaurant") return <Ionicons name="fast-food" size={12} color="white" />;
    if (type === "hotel") return <Ionicons name="bed" size={12} color="white" />;
    if (type === "medical") return <Ionicons name="medkit" size={12} color="white" />;
    if (type === "shop") return <Ionicons name="bag" size={12} color="white" />;
    if (type === "park") return <Ionicons name="leaf" size={12} color="white" />;
    if (type === "temple") return <Ionicons name="prism" size={12} color="white" />;
    if (type === "museum") return <Ionicons name="image" size={12} color="white" />;
    if (type === "transport") return <Ionicons name="bus" size={12} color="white" />;
    if (type === "school") return <Ionicons name="school" size={12} color="white" />;
    return <Ionicons name="location" size={12} color="white" />;
  };

  // Suggestion dropdown top — sits right below whichever input is active
  // For builder inputs, show suggestions below the mode tabs (similar to explore)


  // Dynamic positioning for floating controls to avoid overlap with bottom panels
  const getFloatingControlsPosition = () => {
    // If navigation HUD is visible
    if (isNavigating) {
      return { gpsBottom: 230, zoomBottom: 295 };
    }

    if (activeMode === "route_builder") {
      if (isBuilderExpanded) {
        // Expanded pane is tall. Height depends on whether there are stops.
        const builderHeight = routeItems.length > 0 ? 320 : 255;
        return {
          gpsBottom: builderHeight + 15,
          zoomBottom: builderHeight + 80,
        };
      } else {
        // Collapsed builder pane is short (only header height ~60px)
        return {
          gpsBottom: 195,
          zoomBottom: 260,
        };
      }
    }

    if (activeMode === "explore" && selectedPlace) {
      // Place detail card is active at bottom: 110 (which has height ~140px)
      // If routeItems.length > 0, detailCard is shifted to bottom: 230
      const bottomOffset = routeItems.length > 0 ? 230 : 110;
      return {
        gpsBottom: bottomOffset + 145,
        zoomBottom: bottomOffset + 210,
      };
    }

    // Default position (when Builder is collapsed/not open and no selection)
    return { gpsBottom: 230, zoomBottom: 295 };
  };

  const { gpsBottom, zoomBottom } = getFloatingControlsPosition();

  // ─── Live navigation display helpers ──────────────────────────────────────
  const navDistStr =
    navRemDistM < 1000
      ? `${Math.round(navRemDistM)} m`
      : `${(navRemDistM / 1000).toFixed(1)} km`;
  const navEtaStr = formatDuration(navRemDurS);

  return (
    <View style={styles.container as any}>
      {/* Map */}
      <MapView
        ref={mapRef}
        style={styles.map as any}
        initialRegion={region}
        showsUserLocation
        showsMyLocationButton={false}
        showsTraffic={false}
        showsPointsOfInterest
        showsBuildings
        customMapStyle={DARK_MAP_STYLE}
        onRegionChangeComplete={(r) => setRegion(r)}
        onPoiClick={(e) => {
          const poi = e.nativeEvent;
          setSelectedPlace({
            name: poi.name,
            latitude: poi.coordinate.latitude,
            longitude: poi.coordinate.longitude,
            address: "Point of Interest",
            type: "sight",
            rating: "4.5",
            pinColor: "#38BDF8",
          });
        }}
      >
        {/* POI pins */}
        {allMapPins.map((marker, i) => (
          <Marker
            key={`marker-${i}`}
            coordinate={{ latitude: marker.latitude, longitude: marker.longitude }}
            onPress={() => setSelectedPlace(marker)}
          >
            <View style={styles.customPinContainer as any}>
              <View style={[styles.customPinInner as any, { backgroundColor: marker.pinColor || "#38BDF8" }]}>
                {getMarkerIcon(marker.type)}
              </View>
              <View style={[styles.customPinPointer as any, { borderTopColor: marker.pinColor || "#38BDF8" }]} />
            </View>
            <Callout tooltip onPress={() => setSelectedPlace(marker)}>
              <View style={styles.calloutContainer as any}>
                <Text style={styles.calloutTitle as any}>{marker.name}</Text>
                <View style={styles.calloutRow as any}>
                  <Text style={{ color: "#38BDF8", fontWeight: "bold", fontSize: 12 }}>⭐ {marker.rating}</Text>
                  <Text style={{ color: "#94A3B8", textTransform: "capitalize", fontSize: 11, marginLeft: 6 }}>• {marker.type}</Text>
                </View>
                <Text style={styles.calloutAddress as any} numberOfLines={1}>{marker.address}</Text>
                <Text style={styles.calloutAction as any}>Tap card below to action 🚀</Text>
              </View>
            </Callout>
          </Marker>
        ))}

        {/* Route builder start marker */}
        {activeMode === "route_builder" && builderStartPlace && (
          <Marker coordinate={{ latitude: builderStartPlace.latitude || builderStartPlace.lat, longitude: builderStartPlace.longitude || builderStartPlace.lon }}>
            <View style={[styles.routeStopMarker as any, { backgroundColor: "#10B981" }]}>
              <Ionicons name="home" size={12} color="white" />
            </View>
          </Marker>
        )}

        {/* Route builder stop markers */}
        {activeMode === "route_builder" && routeItems.map((item, index) => (
          <Marker key={`route-item-${index}`} coordinate={{ latitude: item.latitude || item.lat, longitude: item.longitude || item.lon }}>
            <View style={styles.routeStopMarker as any}>
              <Text style={styles.routeStopText as any}>{index + 1}</Text>
            </View>
          </Marker>
        ))}

        {/* Directions markers */}
        {activeMode === "directions" && startPlace && (
          <Marker coordinate={{ latitude: startPlace.latitude, longitude: startPlace.longitude }}>
            <View style={[styles.routeStopMarker as any, { backgroundColor: "#10B981" }]}>
              <Ionicons name="navigate" size={13} color="white" />
            </View>
          </Marker>
        )}
        {activeMode === "directions" && destPlace && (
          <Marker coordinate={{ latitude: destPlace.latitude, longitude: destPlace.longitude }}>
            <View style={[styles.routeStopMarker as any, { backgroundColor: "#EF4444" }]}>
              <Ionicons name="flag" size={13} color="white" />
            </View>
          </Marker>
        )}

        {/* Route polyline */}
        {routeCoords.length > 0 && (
          <Polyline
            coordinates={routeCoords}
            strokeWidth={isNavigating ? 6 : 5}
            strokeColor={isNavigating ? "#10B981" : "#38BDF8"}
            lineDashPattern={activeMode === "directions" ? undefined : [12, 6]}
          />
        )}
      </MapView>

      {/* Header */}
      <View style={styles.header as any}>
        <Text style={styles.headerTitle as any}>TripSync Maps 🗺️</Text>
        <Text style={styles.headerSubtitle as any}>Real-time routing, builder & sync</Text>
      </View>

      {/* Mode switcher */}
      <View style={styles.modeTabs as any}>
        {(["explore", "directions", "route_builder"] as const).map((mode) => {
          const labels: Record<string, string> = { explore: "Explore", directions: "Directions", route_builder: "Builder" };
          const icons: Record<string, any> = { explore: "planet-outline", directions: "trail-sign-outline", route_builder: "map-outline" };
          return (
            <TouchableOpacity
              key={mode}
              onPress={() => {
                if (isNavigating) stopNavigation();
                setActiveMode(mode);
                setSuggestions([]);
                if (mode === "explore") {
                  setRouteCoords([]);
                  routeCoordsRef.current = [];
                  setRouteStats(null);
                } else if (mode === "directions") {
                  setRouteCoords(directionsRouteCoords);
                  routeCoordsRef.current = directionsRouteCoords;
                  setRouteStats(directionsRouteStats);
                } else if (mode === "route_builder") {
                  setRouteCoords(builderRouteCoords);
                  routeCoordsRef.current = builderRouteCoords;
                  setRouteStats(builderRouteStats);
                }
              }}
              style={[styles.modeTabBtn as any, activeMode === mode ? styles.modeTabActive as any : styles.modeTabInactive as any]}
            >
              <Ionicons name={icons[mode]} size={15} color="white" />
              <Text style={styles.modeTabBtnText as any}>{labels[mode]}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Explore search input */}
      {activeMode === "explore" && (
        <View style={styles.searchContainer as any}>
          <Ionicons name="search-outline" size={20} color="#94A3B8" style={{ marginRight: 8 }} />
          <TextInput
            placeholder="Search city, landmark, cafe, hospital..."
            placeholderTextColor="#94A3B8"
            value={searchText}
            onChangeText={(t) => handleTextChange(t, "explore")}
            onFocus={() => setActiveInputType("explore")}
            onSubmitEditing={() => handleExploreSearch()}
            returnKeyType="search"
            style={styles.input as any}
          />
          {autocompleteLoading && activeInputType === "explore" && (
            <ActivityIndicator size="small" color="#38BDF8" style={{ marginRight: 6 }} />
          )}
          {searchText ? (
            <TouchableOpacity onPress={() => { setSearchText(""); setSuggestions([]); }} style={{ padding: 6 }}>
              <Ionicons name="close-circle-outline" size={20} color="#94A3B8" />
            </TouchableOpacity>
          ) : null}
        </View>
      )}

      {/* Directions inputs with inline dropdowns */}
      {activeMode === "directions" && (
        <View style={styles.directionsInputsContainer as any}>
          <View style={{ position: "relative", zIndex: activeInputType === "start" ? 100 : 1 }}>
            <View style={styles.directionsRow as any}>
              <Ionicons name="location-outline" size={20} color="#10B981" style={{ marginRight: 8 }} />
              <TextInput
                placeholder="Start Point..."
                placeholderTextColor="#94A3B8"
                value={startText}
                onChangeText={(t) => handleTextChange(t, "start")}
                onFocus={() => setActiveInputType("start")}
                style={styles.input as any}
              />
              {autocompleteLoading && activeInputType === "start" && (
                <ActivityIndicator size="small" color="#38BDF8" style={{ marginRight: 6 }} />
              )}
              <TouchableOpacity onPress={useMyLocationAsStart} style={styles.gpsInputBtn as any}>
                <Ionicons name="locate-outline" size={18} color="#38BDF8" />
              </TouchableOpacity>
            </View>
            {activeInputType === "start" && suggestions.length > 0 && (
              <View style={styles.inputsDropdown}>
                <View style={styles.dropdownHeader}>
                  <Text style={styles.dropdownTitle}>Suggestions</Text>
                  <TouchableOpacity onPress={() => setSuggestions([])} style={styles.dropdownCloseBtn}>
                    <Ionicons name="close" size={16} color="#94A3B8" />
                  </TouchableOpacity>
                </View>
                <ScrollView style={{ maxHeight: 180 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled={true}>
                  {suggestions.map((item, idx) => (
                    <TouchableOpacity key={idx} onPress={() => handleSelectSuggestion(item)} style={styles.suggestionItem as any}>
                      <Ionicons name="location-sharp" size={14} color="#38BDF8" style={{ marginRight: 8 }} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.suggestName as any} numberOfLines={1}>{item.name}</Text>
                        <Text style={styles.suggestAddress as any} numberOfLines={1}>{item.address}</Text>
                      </View>
                      {item.distLabel ? (
                        <View style={styles.distBadge as any}>
                          <Text style={styles.distBadgeText as any}>{item.distLabel}</Text>
                        </View>
                      ) : null}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}
          </View>

          <View style={{ position: "relative", zIndex: activeInputType === "dest" ? 100 : 1, borderTopWidth: 1, borderTopColor: "#1E293B", marginTop: 4 }}>
            <View style={styles.directionsRow as any}>
              <Ionicons name="flag-outline" size={20} color="#EF4444" style={{ marginRight: 8 }} />
              <TextInput
                placeholder="Destination..."
                placeholderTextColor="#94A3B8"
                value={destText}
                onChangeText={(t) => handleTextChange(t, "dest")}
                onFocus={() => setActiveInputType("dest")}
                style={styles.input as any}
              />
              {autocompleteLoading && activeInputType === "dest" && (
                <ActivityIndicator size="small" color="#38BDF8" style={{ marginRight: 6 }} />
              )}
            </View>
            {activeInputType === "dest" && suggestions.length > 0 && (
              <View style={styles.inputsDropdown}>
                <View style={styles.dropdownHeader}>
                  <Text style={styles.dropdownTitle}>Suggestions</Text>
                  <TouchableOpacity onPress={() => setSuggestions([])} style={styles.dropdownCloseBtn}>
                    <Ionicons name="close" size={16} color="#94A3B8" />
                  </TouchableOpacity>
                </View>
                <ScrollView style={{ maxHeight: 180 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled={true}>
                  {suggestions.map((item, idx) => (
                    <TouchableOpacity key={idx} onPress={() => handleSelectSuggestion(item)} style={styles.suggestionItem as any}>
                      <Ionicons name="location-sharp" size={14} color="#38BDF8" style={{ marginRight: 8 }} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.suggestName as any} numberOfLines={1}>{item.name}</Text>
                        <Text style={styles.suggestAddress as any} numberOfLines={1}>{item.address}</Text>
                      </View>
                      {item.distLabel ? (
                        <View style={styles.distBadge as any}>
                          <Text style={styles.distBadgeText as any}>{item.distLabel}</Text>
                        </View>
                      ) : null}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}
          </View>
        </View>
      )}

      {/* Explore tab autocomplete dropdown */}
      {activeMode === "explore" && suggestions.length > 0 && (
        <View style={[styles.suggestionsContainer as any, { top: 213 }]}>
          <View style={styles.dropdownHeader}>
            <Text style={styles.dropdownTitle}>Suggestions</Text>
            <TouchableOpacity onPress={() => setSuggestions([])} style={styles.dropdownCloseBtn}>
              <Ionicons name="close" size={16} color="#94A3B8" />
            </TouchableOpacity>
          </View>
          <FlatList
            data={suggestions}
            keyExtractor={(_, i) => `suggest-${i}`}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <TouchableOpacity onPress={() => handleSelectSuggestion(item)} style={styles.suggestionItem as any}>
                <Ionicons name="location-sharp" size={16} color="#38BDF8" style={{ marginRight: 10 }} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.suggestName as any} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.suggestAddress as any} numberOfLines={1}>{item.address}</Text>
                </View>
                {item.distLabel ? (
                  <View style={styles.distBadge as any}>
                    <Text style={styles.distBadgeText as any}>{item.distLabel}</Text>
                  </View>
                ) : null}
              </TouchableOpacity>
            )}
          />
        </View>
      )}



      {/* Zoom controls */}
      <View style={[styles.zoomControls as any, { bottom: zoomBottom }]}>
        <TouchableOpacity onPress={() => zoomMap("in")} style={styles.zoomBtn as any}>
          <Ionicons name="add" size={22} color="#38BDF8" />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => zoomMap("out")} style={[styles.zoomBtn as any, { borderTopWidth: 1, borderTopColor: "#334155" }]}>
          <Ionicons name="remove" size={22} color="#38BDF8" />
        </TouchableOpacity>
      </View>

      {/* GPS button */}
      <TouchableOpacity onPress={locateUser} style={[styles.gpsButton as any, { bottom: gpsBottom }]}>
        <Ionicons name="locate-outline" size={24} color="#38BDF8" />
      </TouchableOpacity>

      {/* ISSUE 3 FIX: Live Navigation HUD */}
      {isNavigating && (
        <View style={styles.navHUD as any}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <Text style={[styles.navLabel as any, { marginBottom: 0 }]}>Route Progress</Text>
            <Text style={{ color: "#10B981", fontSize: 12, fontWeight: "bold" }}>{Math.round(navProgress * 100)}%</Text>
          </View>
          <View style={styles.navProgressBar as any}>
            <View style={[styles.navProgressFill as any, { width: `${Math.round(navProgress * 100)}%` }]} />
          </View>
          <View style={styles.navRow as any}>
            <View style={{ flex: 1 }}>
              <Text style={styles.navLabel as any}>Current Stop</Text>
              <Text style={styles.navNextStop as any} numberOfLines={1}>{navNextStop}</Text>
            </View>
            <View style={styles.navStats as any}>
              <Text style={styles.navDistText as any}>{navDistStr}</Text>
              <Text style={styles.navEtaText as any}>ETA {navEtaStr}</Text>
            </View>
            <TouchableOpacity onPress={stopNavigation} style={styles.stopNavBtn as any}>
              <Ionicons name="stop-circle" size={18} color="white" />
              <Text style={styles.stopNavText as any}>End</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Directions stats card (before navigation starts) */}
      {activeMode === "directions" && routeStats && !isNavigating && (
        <View style={styles.directionsStatsPane as any}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.statsLabel as any}>Fastest Route · OSRM</Text>
              <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
                <Text style={styles.statsMain as any}>{routeStats.duration}</Text>
                <Text style={styles.statsDistance as any}>({routeStats.distance} km)</Text>
              </View>
            </View>
            <TouchableOpacity onPress={startNavigation} style={styles.navigateButton as any}>
              <Ionicons name="navigate-outline" size={18} color="white" style={{ marginRight: 4 }} />
              <Text style={styles.navigateBtnText as any}>Start</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}



      {/* Route Builder */}
      {activeMode === "route_builder" && (
        <View style={styles.routeBuilderPane as any}>
          {/* Header */}
          <View style={styles.routeHeader as any}>
            <TouchableOpacity onPress={() => setIsBuilderExpanded(!isBuilderExpanded)} style={{ marginRight: 6, padding: 4 }}>
              <Ionicons name={isBuilderExpanded ? "chevron-down" : "chevron-up"} size={20} color="#94A3B8" />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleCloseBuilder} style={{ marginRight: 8, padding: 4 }}>
              <Ionicons name="close" size={20} color="#94A3B8" />
            </TouchableOpacity>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1, marginRight: 8 }}>
              <Ionicons name="trail-sign" size={20} color="#38BDF8" />
              <Text style={[styles.routeTitle as any, { flexShrink: 1 }]} numberOfLines={1}>
                {editingRouteName ? `Editing: ${editingRouteName}` : `Trip Builder (${routeItems.length} stops)`}
              </Text>
              {editingRouteName && (
                <TouchableOpacity onPress={renameRoute} style={{ padding: 4 }}>
                  <Ionicons name="pencil" size={14} color="#38BDF8" />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Responsive Action Toolbar */}
          {isBuilderExpanded && (
            <View style={styles.builderToolbar}>
              <TouchableOpacity 
                onPress={handleNewBuilder}
                style={[styles.toolbarBtn, { backgroundColor: "#475569" }]}
              >
                <Ionicons name="document-text-outline" size={14} color="white" />
                <Text style={styles.toolbarBtnText}>New</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={saveRouteToFirestore} style={[styles.toolbarBtn, { backgroundColor: "#22C55E" }]}>
                <Ionicons name="save-outline" size={14} color="white" />
                <Text style={styles.toolbarBtnText}>Save</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={saveAndShareRoute} style={[styles.toolbarBtn, { backgroundColor: "#8B5CF6" }]}>
                <Ionicons name="share-social-outline" size={14} color="white" />
                <Text style={styles.toolbarBtnText}>Share</Text>
              </TouchableOpacity>
              {routeItems.length > 2 && (
                <TouchableOpacity 
                  testID="map-optimize-route-btn"
                  accessibilityLabel="map-optimize-route-btn"
                  onPress={handleOptimizeRoute} 
                  style={[styles.toolbarBtn, { backgroundColor: "#EAB308" }]}
                >
                  <Ionicons name="flash-outline" size={14} color="#0F172A" />
                  <Text style={[styles.toolbarBtnText, { color: "#0F172A" }]}>Optimize</Text>
                </TouchableOpacity>
              )}
              {routeItems.length > 0 && (
                <TouchableOpacity onPress={startBuilderNavigation} style={[styles.toolbarBtn, { backgroundColor: "#10B981" }]}>
                  <Ionicons name="navigate-outline" size={14} color="white" />
                  <Text style={styles.toolbarBtnText}>Start</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {isBuilderExpanded && (
            <>
              {/* Trip selector dropdown */}
              {userTrips.length > 0 && (
                <View style={{ flexDirection: "row", gap: 10, marginBottom: 8, alignItems: "center", zIndex: 110 }}>
                  <View style={{ flex: 1.5 }}>
                    <Text style={{ color: "#94A3B8", fontSize: 9, fontWeight: "bold", marginBottom: 3 }}>LINK TO TRIP</Text>
                    <View style={{ backgroundColor: "#1E293B", borderRadius: 8, borderWidth: 1, borderColor: "#334155", overflow: "hidden" }}>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 6, paddingVertical: 4 }}>
                        <TouchableOpacity
                          onPress={() => {
                            setSelectedTripId("");
                          }}
                          style={{
                            paddingVertical: 4,
                            paddingHorizontal: 8,
                            borderRadius: 6,
                            backgroundColor: selectedTripId === "" ? "#38BDF8" : "transparent",
                            marginRight: 6
                          }}
                        >
                          <Text style={{ color: "white", fontSize: 10, fontWeight: "bold" }}>None</Text>
                        </TouchableOpacity>
                        {userTrips.map((trip) => (
                          <TouchableOpacity
                            key={trip.id}
                            onPress={() => {
                              setSelectedTripId(trip.id);
                              if (trip.destination && !builderStartText) {
                                setBuilderStartText(trip.destination.split(",")[0]);
                              }
                            }}
                            style={{
                              paddingVertical: 4,
                              paddingHorizontal: 8,
                              borderRadius: 6,
                              backgroundColor: selectedTripId === trip.id ? "#38BDF8" : "transparent",
                              marginRight: 6
                            }}
                          >
                            <Text style={{ color: "white", fontSize: 10, fontWeight: "bold" }}>{trip.tripName}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                  </View>

                  {selectedTripId !== "" && (
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: "#94A3B8", fontSize: 9, fontWeight: "bold", marginBottom: 3 }}>DAY</Text>
                      <View style={{ backgroundColor: "#1E293B", borderRadius: 8, borderWidth: 1, borderColor: "#334155", overflow: "hidden" }}>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 6, paddingVertical: 4 }}>
                          {[1, 2, 3, 4, 5, 6, 7].map((dNum) => (
                            <TouchableOpacity
                              key={dNum}
                              onPress={() => setSelectedDayNumber(dNum)}
                              style={{
                                paddingVertical: 4,
                                paddingHorizontal: 8,
                                borderRadius: 6,
                                backgroundColor: selectedDayNumber === dNum ? "#38BDF8" : "transparent",
                                marginRight: 4
                              }}
                            >
                              <Text style={{ color: "white", fontSize: 10, fontWeight: "bold" }}>Day {dNum}</Text>
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                      </View>
                    </View>
                  )}
                </View>
              )}

              {/* Start Location Input relative wrapper */}
              <View style={{ position: "relative", zIndex: activeInputType === "builder_start" ? 100 : 1 }}>
                <View style={styles.builderInputContainer as any}>
                  <Ionicons name="navigate-circle-outline" size={18} color="#10B981" />
                  <TextInput
                    placeholder="Use Current GPS or Custom Start..."
                    placeholderTextColor="#94A3B8"
                    value={builderStartText}
                    onChangeText={(t) => {
                      setBuilderStartText(t);
                      setActiveInputType("builder_start");
                      fetchSuggestions(t);
                    }}
                    onFocus={() => setActiveInputType("builder_start")}
                    style={styles.builderInput as any}
                  />
                  {autocompleteLoading && activeInputType === "builder_start" && (
                    <ActivityIndicator size="small" color="#38BDF8" style={{ marginRight: 6 }} />
                  )}
                  <TouchableOpacity onPress={useGPSForBuilderStart} style={{ padding: 6 }}>
                    <Ionicons name="locate-outline" size={18} color="#10B981" />
                  </TouchableOpacity>
                </View>
                {/* Inline Start Suggestions */}
                {activeInputType === "builder_start" && suggestions.length > 0 && (
                  <View style={styles.inputsDropdown}>
                    <View style={styles.dropdownHeader}>
                      <Text style={styles.dropdownTitle}>Suggestions</Text>
                      <TouchableOpacity onPress={() => setSuggestions([])} style={styles.dropdownCloseBtn}>
                        <Ionicons name="close" size={16} color="#94A3B8" />
                      </TouchableOpacity>
                    </View>
                    <ScrollView style={{ maxHeight: 180 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled={true}>
                      {suggestions.map((item, idx) => (
                        <TouchableOpacity key={idx} onPress={() => handleSelectSuggestion(item)} style={styles.suggestionItem as any}>
                          <Ionicons name="location-sharp" size={14} color="#38BDF8" style={{ marginRight: 8 }} />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.suggestName as any} numberOfLines={1}>{item.name}</Text>
                            <Text style={styles.suggestAddress as any} numberOfLines={1}>{item.address}</Text>
                          </View>
                          {item.distLabel ? (
                            <View style={styles.distBadge as any}>
                              <Text style={styles.distBadgeText as any}>{item.distLabel}</Text>
                            </View>
                          ) : null}
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}
              </View>

              {/* Add Stop Input relative wrapper */}
              <View style={{ position: "relative", zIndex: activeInputType === "builder_add_stop" ? 100 : 1 }}>
                <View style={styles.builderInputContainer as any}>
                  <Ionicons name="flag-outline" size={18} color="#38BDF8" />
                  <TextInput
                    placeholder="Search & Add Stop..."
                    placeholderTextColor="#94A3B8"
                    value={builderAddText}
                    onChangeText={(t) => {
                      setBuilderAddText(t);
                      setActiveInputType("builder_add_stop");
                      fetchSuggestions(t);
                    }}
                    onFocus={() => setActiveInputType("builder_add_stop")}
                    style={styles.builderInput as any}
                  />
                  {autocompleteLoading && activeInputType === "builder_add_stop" && (
                    <ActivityIndicator size="small" color="#38BDF8" style={{ marginRight: 6 }} />
                  )}
                </View>
                {/* Inline Add Stop Suggestions */}
                {activeInputType === "builder_add_stop" && suggestions.length > 0 && (
                  <View style={styles.inputsDropdown}>
                    <View style={styles.dropdownHeader}>
                      <Text style={styles.dropdownTitle}>Suggestions</Text>
                      <TouchableOpacity onPress={() => setSuggestions([])} style={styles.dropdownCloseBtn}>
                        <Ionicons name="close" size={16} color="#94A3B8" />
                      </TouchableOpacity>
                    </View>
                    <ScrollView style={{ maxHeight: 180 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled={true}>
                      {suggestions.map((item, idx) => (
                        <TouchableOpacity key={idx} onPress={() => handleSelectSuggestion(item)} style={styles.suggestionItem as any}>
                          <Ionicons name="location-sharp" size={14} color="#38BDF8" style={{ marginRight: 8 }} />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.suggestName as any} numberOfLines={1}>{item.name}</Text>
                            <Text style={styles.suggestAddress as any} numberOfLines={1}>{item.address}</Text>
                          </View>
                          {item.distLabel ? (
                            <View style={styles.distBadge as any}>
                              <Text style={styles.distBadgeText as any}>{item.distLabel}</Text>
                            </View>
                          ) : null}
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}
              </View>

              {routeStats && (
                <View style={styles.routeStatsRow as any}>
                  <Text style={styles.routeStatsText as any}>
                    Distance: <Text style={{ color: "#38BDF8", fontWeight: "bold" }}>{routeStats.distance} km</Text>
                  </Text>
                  <Text style={styles.routeStatsText as any}>
                    • Time: <Text style={{ color: "#38BDF8", fontWeight: "bold" }}>{routeStats.duration}</Text>
                  </Text>
                </View>
              )}

              {routeItems.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.routeScroll as any}>
                  {routeItems.map((item, index) => (
                    <View key={`step-${index}`} style={styles.routeStepCard as any}>
                      <View style={[styles.stepNumBadge as any, index < activeStopIndex && isNavigating && navType === "builder" && { backgroundColor: "#10B981" }]}>
                        {index < activeStopIndex && isNavigating && navType === "builder" ? (
                          <Ionicons name="checkmark" size={10} color="white" />
                        ) : (
                          <Text style={styles.stepNumText as any}>{index + 1}</Text>
                        )}
                      </View>
                      <View style={{ flex: 1, marginRight: 5 }}>
                        <Text style={styles.stepName as any} numberOfLines={1}>{item.name}</Text>
                      </View>
                      <View style={{ flexDirection: "row", gap: 4 }}>
                        <TouchableOpacity onPress={() => moveRouteItem(index, "up")} disabled={index === 0}>
                          <Ionicons name="arrow-up-circle" size={18} color={index === 0 ? "#475569" : "#38BDF8"} />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => moveRouteItem(index, "down")} disabled={index === routeItems.length - 1}>
                          <Ionicons name="arrow-down-circle" size={18} color={index === routeItems.length - 1 ? "#475569" : "#38BDF8"} />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => removeFromRoute(index)}>
                          <Ionicons name="close-circle" size={18} color="#EF4444" />
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                </ScrollView>
              ) : (
                <View style={styles.emptyBuilderState as any}>
                  <Text style={{ color: "#94A3B8", fontSize: 13 }}>
                    No stops yet. Enter start location and search stops above!
                  </Text>
                </View>
              )}
            </>
          )}
        </View>
      )}

      {/* Unified details card */}
      {!isNavigating && selectedPlace && (activeMode === "explore" || activeMode === "directions" || activeMode === "route_builder") && (
        <View style={[styles.detailCard as any, routeItems.length > 0 && activeMode === "route_builder" && { bottom: 230 }]}>
          <TouchableOpacity 
            onPress={() => setSelectedPlace(null)} 
            style={{ position: "absolute", top: 12, right: 12, zIndex: 20, padding: 4 }}
          >
            <Ionicons name="close" size={20} color="#94A3B8" />
          </TouchableOpacity>
          <ScrollView contentContainerStyle={{ paddingBottom: 6 }} showsVerticalScrollIndicator={false} style={{ maxHeight: 200 }}>
            <Text style={styles.cardTitle as any} numberOfLines={1}>
              {selectedPlace.name}
            </Text>
            <Text style={styles.cardAddress as any} numberOfLines={1}>
              {selectedPlace.address}
            </Text>
            
            <View style={{ flexDirection: "row", gap: 10, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
              <View style={styles.badgeRow as any}>
                <Ionicons name="star" size={14} color="#EAB308" />
                <Text style={{ color: "white", fontWeight: "bold", fontSize: 12 }}>
                  {selectedPlace.rating || "4.5"}
                </Text>
              </View>
              <View style={[styles.badgeRow as any, { backgroundColor: "rgba(16,185,129,0.15)" }]}>
                <Ionicons name="shield-checkmark" size={14} color="#10B981" />
                <Text style={{ color: "#10B981", fontWeight: "bold", fontSize: 12 }}>
                  Safety: {(8.0 + (selectedPlace.name.length % 5) * 0.3).toFixed(1)}/10
                </Text>
              </View>
              <Text style={{ color: "#94A3B8", fontSize: 12, textTransform: "uppercase" }}>
                {selectedPlace.type || "SIGHT"}
              </Text>
            </View>

            {/* Traveler Reviews */}
            <Text style={{ color: "white", fontSize: 12, fontWeight: "bold", marginTop: 12, marginBottom: 4 }}>⭐ Traveler Reviews</Text>
            {SAMPLE_REVIEWS.map((rev, idx) => (
              <Text key={idx} style={{ color: "#CBD5E1", fontSize: 11, marginBottom: 3 }} numberOfLines={1}>
                • <Text style={{ fontWeight: "bold" }}>{rev.name}</Text>: {rev.text}
              </Text>
            ))}

            {/* Actions */}
            <View style={{ flexDirection: "row", gap: 8, marginTop: 12, justifyContent: "flex-end", alignItems: "center" }}>
              <TouchableOpacity 
                onPress={async () => {
                  const itemToAdd = {
                    name: selectedPlace.name,
                    latitude: selectedPlace.latitude || selectedPlace.lat,
                    longitude: selectedPlace.longitude || selectedPlace.lon,
                    address: selectedPlace.address,
                  };
                  await addToRoute(itemToAdd);
                  setSelectedPlace(null);
                }}
                style={[styles.cardAddRouteBtn as any, { backgroundColor: "#38BDF8" }]}
              >
                <Ionicons name="add-circle" size={16} color="white" />
                <Text style={{ color: "white", fontWeight: "bold", fontSize: 11, marginLeft: 4 }}>Add To Route</Text>
              </TouchableOpacity>

              <TouchableOpacity 
                onPress={() => {
                  setDestPlace({
                    name: selectedPlace.name,
                    latitude: selectedPlace.latitude || selectedPlace.lat,
                    longitude: selectedPlace.longitude || selectedPlace.lon,
                    address: selectedPlace.address,
                  });
                  setDestText(selectedPlace.name);
                  setActiveMode("directions");
                  setSelectedPlace(null);
                  if (startPlace) {
                    setTimeout(() => {
                      calculateDirectionsRouteDirectly(startPlace, selectedPlace);
                    }, 100);
                  }
                }} 
                style={[styles.cardAddRouteBtn as any, { backgroundColor: "#10B981" }]}
              >
                <Ionicons name="trail-sign" size={16} color="white" />
                <Text style={{ color: "white", fontWeight: "bold", fontSize: 11, marginLeft: 4 }}>Go To Directions</Text>
              </TouchableOpacity>
              
              <TouchableOpacity onPress={() => handleAddToFavorites(selectedPlace)} style={styles.cardFavBtn as any}>
                <Ionicons name="heart" size={16} color="white" />
              </TouchableOpacity>

              <TouchableOpacity onPress={() => handleMarkAsVisited(selectedPlace)} style={styles.cardVisitedBtn as any}>
                <Ionicons name="checkmark-circle" size={16} color="white" />
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      )}

      {loading && (
        <View style={styles.loadingOverlay as any}>
          <ActivityIndicator size="large" color="#38BDF8" />
        </View>
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <View style={styles.toastContainer as any}>
          <Ionicons name="checkmark-circle" size={18} color="#10B981" />
          <Text style={styles.toastText as any}>{toastMessage}</Text>
        </View>
      )}

      {/* Share Modal */}
      <Modal
        visible={shareModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShareModalVisible(false)}
      >
        <View style={styles.modalOverlay as any}>
          <View style={styles.modalContent as any}>
            <View style={styles.modalHeader as any}>
              <Ionicons name="share-social" size={24} color="#38BDF8" style={{ marginRight: 8 }} />
              <Text style={styles.modalTitle as any}>Share Route 🗺️</Text>
            </View>

            <View style={styles.modalBody as any}>
              <Text style={styles.modalLabel as any}>Route Name</Text>
              <Text style={styles.modalRouteName as any}>{shareModalRouteName}</Text>

              <Text style={styles.modalLabel as any}>Web Link (For Browsers)</Text>
              <View style={styles.linkContainer as any}>
                <Text style={styles.linkText as any} numberOfLines={1}>
                  {`https://tripsync.app/routes/${shareModalRouteId}`}
                </Text>
              </View>

              <Text style={styles.modalLabel as any}>Deep Link (For App)</Text>
              <View style={styles.linkContainer as any}>
                <Text style={styles.linkText as any} numberOfLines={1}>
                  {`tripsync://map?routeId=${shareModalRouteId}`}
                </Text>
              </View>
            </View>

            <View style={styles.modalActions as any}>
              <TouchableOpacity onPress={handleCopyLink} style={[styles.modalBtn as any, styles.copyBtn as any]}>
                <Ionicons name="copy-outline" size={16} color="white" style={{ marginRight: 6 }} />
                <Text style={styles.modalBtnText as any}>Copy Link</Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={handleNativeShare} style={[styles.modalBtn as any, styles.shareBtn as any]}>
                <Ionicons name="share-outline" size={16} color="white" style={{ marginRight: 6 }} />
                <Text style={styles.modalBtnText as any}>Share</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.modalSecondaryActions as any}>
              <TouchableOpacity onPress={handleOpenRoute} style={[styles.modalBtn as any, styles.openRouteBtn as any]}>
                <Ionicons name="map-outline" size={16} color="#38BDF8" style={{ marginRight: 6 }} />
                <Text style={[styles.modalBtnText as any, { color: "#38BDF8" }]}>Open Route</Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={() => setShareModalVisible(false)} style={[styles.modalBtn as any, styles.closeBtn as any]}>
                <Text style={styles.modalBtnText as any}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      {/* Custom Prompt Modal */}
      <Modal
        visible={promptVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setPromptVisible(false)}
      >
        <View style={styles.modalOverlay as any}>
          <View style={styles.modalContent as any}>
            <View style={styles.modalHeader as any}>
              <Ionicons name="create-outline" size={24} color="#38BDF8" style={{ marginRight: 8 }} />
              <Text style={styles.modalTitle as any}>{promptTitle}</Text>
            </View>

            <View style={styles.modalBody as any}>
              <Text style={styles.modalLabel as any}>Route Name</Text>
              <TextInput
                style={styles.promptInput as any}
                placeholder={promptPlaceholder}
                placeholderTextColor="#94A3B8"
                value={promptValue}
                onChangeText={setPromptValue}
                autoFocus
              />
            </View>

            <View style={styles.modalActions as any}>
              <TouchableOpacity onPress={() => setPromptVisible(false)} style={[styles.modalBtn as any, styles.closeBtn as any]}>
                <Text style={styles.modalBtnText as any}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  setPromptVisible(false);
                  if (promptOnSubmit) promptOnSubmit(promptValue);
                }}
                style={[styles.modalBtn as any, { backgroundColor: "#38BDF8" }]}
              >
                <Text style={styles.modalBtnText as any}>OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Trip Completed Overlay */}
      {tripCompleted && (
        <Modal
          visible={tripCompleted}
          transparent={true}
          animationType="fade"
        >
          <View style={styles.modalOverlay as any}>
            <View style={styles.modalContent as any}>
              <View style={[styles.modalHeader as any, { borderBottomWidth: 0, paddingBottom: 10, alignItems: "center" }]}>
                <Ionicons name="trophy-outline" size={32} color="#EAB308" style={{ alignSelf: "center", marginBottom: 10 }} />
                <Text style={[styles.modalTitle as any, { textAlign: "center", width: "100%" }]}>Trip Completed! 🎉</Text>
              </View>

              <View style={{ marginVertical: 15, alignItems: "center" }}>
                <Text style={{ color: "#CBD5E1", fontSize: 14, textAlign: "center" }}>
                  Congratulations! You have successfully reached the final destination of your journey.
                </Text>
              </View>

              <View style={{ flexDirection: "column", gap: 10, marginTop: 10 }}>
                <TouchableOpacity
                  onPress={async () => {
                    const currentUser = auth.currentUser;
                    if (currentUser) {
                      try {
                        await addDoc(collection(db, "visited"), {
                          userId: currentUser.uid,
                          name: editingRouteName || "Completed Journey",
                          address: routeItemsRef.current[routeItemsRef.current.length - 1]?.address || "Final Destination",
                          lat: routeItemsRef.current[routeItemsRef.current.length - 1]?.latitude || routeItemsRef.current[routeItemsRef.current.length - 1]?.lat,
                          lon: routeItemsRef.current[routeItemsRef.current.length - 1]?.longitude || routeItemsRef.current[routeItemsRef.current.length - 1]?.lon,
                          createdAt: new Date(),
                        });
                        Alert.alert("Journey Saved ❤️", "Added to your visited places!");
                      } catch (_err) {
                        Alert.alert("Error", "Could not save journey to visited places.");
                      }
                    } else {
                      Alert.alert("Authentication Required", "Please log in to save your journey.");
                    }
                    setTripCompleted(false);
                  }}
                  style={[styles.modalBtn as any, { backgroundColor: "#10B981", height: 42 }]}
                >
                  <Ionicons name="save-outline" size={16} color="white" style={{ marginRight: 6 }} />
                  <Text style={styles.modalBtnText as any}>Save Journey</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => {
                    setTripCompleted(false);
                  }}
                  style={[styles.modalBtn as any, { backgroundColor: "#38BDF8", height: 42 }]}
                >
                  <Ionicons name="refresh-outline" size={16} color="white" style={{ marginRight: 6 }} />
                  <Text style={styles.modalBtnText as any}>Return to Builder</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => {
                    setTripCompleted(false);
                    setActiveMode("explore");
                  }}
                  style={[styles.modalBtn as any, styles.closeBtn as any, { height: 42 }]}
                >
                  <Ionicons name="close-circle-outline" size={16} color="white" style={{ marginRight: 6 }} />
                  <Text style={styles.modalBtnText as any}>Close Navigation</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { ...StyleSheet.absoluteFillObject, backgroundColor: "#0F172A" },
  map: { ...StyleSheet.absoluteFillObject },
  header: { position: "absolute", top: 50, left: 20, right: 20, zIndex: 10, pointerEvents: "none" },
  headerTitle: { color: "white", fontSize: 26, fontWeight: "bold", textShadowColor: "rgba(0,0,0,0.9)", textShadowOffset: { width: 1, height: 1 }, textShadowRadius: 4 },
  headerSubtitle: { color: "#CBD5E1", fontSize: 13, marginTop: 2, textShadowColor: "rgba(0,0,0,0.8)", textShadowRadius: 2 },
  modeTabs: { position: "absolute", top: 110, left: 20, right: 20, height: 44, backgroundColor: "#1E293B", borderRadius: 22, flexDirection: "row", padding: 3, zIndex: 10, borderWidth: 1, borderColor: "#334155" },
  modeTabBtn: { flex: 1, borderRadius: 20, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  modeTabActive: { backgroundColor: "#38BDF8" },
  modeTabInactive: { backgroundColor: "transparent" },
  modeTabBtnText: { color: "white", fontSize: 11, fontWeight: "bold" },
  searchContainer: { position: "absolute", top: 165, left: 20, right: 20, backgroundColor: "#0F172A", borderRadius: 16, paddingHorizontal: 15, flexDirection: "row", alignItems: "center", zIndex: 10, borderWidth: 1, borderColor: "#334155", elevation: 5, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4 },
  directionsInputsContainer: { position: "absolute", top: 165, left: 20, right: 20, backgroundColor: "#0F172A", borderRadius: 16, paddingVertical: 4, paddingHorizontal: 12, zIndex: 10, borderWidth: 1, borderColor: "#334155", elevation: 5, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4 },
  directionsRow: { flexDirection: "row", alignItems: "center", height: 44 },
  gpsInputBtn: { padding: 6 },
  input: { flex: 1, color: "white", paddingVertical: 10, fontSize: 14 },
  suggestionsContainer: { position: "absolute", left: 20, right: 20, backgroundColor: "#1E293B", borderRadius: 14, borderWidth: 1, borderColor: "#334155", zIndex: 50, maxHeight: 240, elevation: 8, shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 6 },
  suggestionItem: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: "#1E293B" },
  suggestName: { color: "white", fontSize: 13, fontWeight: "bold" },
  suggestAddress: { color: "#94A3B8", fontSize: 11, marginTop: 2 },
  distBadge: { backgroundColor: "rgba(56,189,248,0.15)", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, marginLeft: 6 },
  distBadgeText: { color: "#38BDF8", fontSize: 10, fontWeight: "bold" },
  gpsButton: { position: "absolute", bottom: 230, right: 20, backgroundColor: "#0F172A", padding: 12, borderRadius: 50, zIndex: 10, borderWidth: 1, borderColor: "#334155", elevation: 4 },
  zoomControls: { position: "absolute", bottom: 295, right: 20, backgroundColor: "#0F172A", borderRadius: 12, zIndex: 10, borderWidth: 1, borderColor: "#334155", elevation: 4 },
  zoomBtn: { padding: 10, alignItems: "center", justifyContent: "center" },
  filterContainer: { position: "absolute", top: 225, left: 20, right: 20, flexDirection: "row", justifyContent: "space-between", zIndex: 10 },
  filterBtn: { flex: 1, paddingVertical: 8, borderRadius: 20, alignItems: "center", marginHorizontal: 2, borderWidth: 1 },
  activeFilter: { backgroundColor: "#38BDF8", borderColor: "#38BDF8" },
  inactiveFilter: { backgroundColor: "rgba(15,23,42,0.95)", borderColor: "#334155" },
  customPinContainer: { alignItems: "center", justifyContent: "center", width: 34, height: 34 },
  customPinInner: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "white", shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.35, shadowRadius: 2, elevation: 4 },
  customPinPointer: { width: 0, height: 0, backgroundColor: "transparent", borderStyle: "solid", borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 6, borderLeftColor: "transparent", borderRightColor: "transparent", marginTop: -1.5 },
  routeStopMarker: { backgroundColor: "#38BDF8", width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: "white", alignItems: "center", justifyContent: "center", elevation: 5 },
  routeStopText: { color: "white", fontWeight: "bold", fontSize: 10 },
  calloutContainer: { width: 190, backgroundColor: "#1E293B", borderRadius: 14, padding: 12, borderWidth: 1, borderColor: "#334155" },
  calloutTitle: { color: "white", fontSize: 13, fontWeight: "bold" },
  calloutRow: { flexDirection: "row", alignItems: "center", marginVertical: 4 },
  calloutAddress: { color: "#CBD5E1", fontSize: 11 },
  calloutAction: { color: "#EAB308", fontSize: 10, marginTop: 5, fontWeight: "bold" },
  detailCard: { position: "absolute", bottom: 110, left: 20, right: 20, backgroundColor: "#1E293B", padding: 16, borderRadius: 20, zIndex: 10, borderWidth: 1, borderColor: "#334155", shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 5, elevation: 8 },
  cardTitle: { color: "white", fontSize: 17, fontWeight: "bold" },
  cardAddress: { color: "#94A3B8", fontSize: 13, marginTop: 4 },
  badgeRow: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "rgba(234,179,8,0.15)", paddingVertical: 3, paddingHorizontal: 8, borderRadius: 8 },
  cardAddRouteBtn: { backgroundColor: "#38BDF8", paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14, alignItems: "center", justifyContent: "center", flexDirection: "row" },
  cardFavBtn: { backgroundColor: "#EF4444", padding: 12, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  cardVisitedBtn: { backgroundColor: "#22C55E", padding: 12, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  directionsStatsPane: { position: "absolute", bottom: 110, left: 20, right: 20, backgroundColor: "#1E293B", padding: 16, borderRadius: 20, zIndex: 10, borderWidth: 1, borderColor: "#334155", shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 5, elevation: 8 },
  statsLabel: { color: "#94A3B8", fontSize: 11, fontWeight: "600", textTransform: "uppercase" },
  statsMain: { color: "#10B981", fontSize: 22, fontWeight: "bold" },
  statsDistance: { color: "white", fontSize: 15, fontWeight: "600", alignSelf: "flex-end", marginBottom: 2 },
  navigateButton: { backgroundColor: "#10B981", flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14 },
  navigateBtnText: { color: "white", fontWeight: "bold", fontSize: 14 },
  navHUD: { position: "absolute", bottom: 110, left: 20, right: 20, backgroundColor: "#0F172A", borderRadius: 20, padding: 16, zIndex: 12, borderWidth: 1.5, borderColor: "#10B981", shadowColor: "#10B981", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 6, elevation: 10 },
  navProgressBar: { height: 4, backgroundColor: "#1E293B", borderRadius: 2, marginBottom: 12, overflow: "hidden" },
  navProgressFill: { height: 4, backgroundColor: "#10B981", borderRadius: 2 },
  navRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  navLabel: { color: "#94A3B8", fontSize: 10, fontWeight: "bold", textTransform: "uppercase", letterSpacing: 0.5 },
  navNextStop: { color: "white", fontSize: 15, fontWeight: "bold", marginTop: 2 },
  navStats: { alignItems: "flex-end" },
  navDistText: { color: "#38BDF8", fontSize: 18, fontWeight: "bold" },
  navEtaText: { color: "#94A3B8", fontSize: 12, marginTop: 2 },
  stopNavBtn: { backgroundColor: "#EF4444", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, alignItems: "center", flexDirection: "row", gap: 4 },
  stopNavText: { color: "white", fontWeight: "bold", fontSize: 12 },
  routeBuilderPane: { position: "absolute", bottom: 110, left: 20, right: 20, backgroundColor: "#0F172A", borderRadius: 20, padding: 14, borderWidth: 1, borderColor: "#38BDF8", zIndex: 9 },
  routeHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  routeTitle: { color: "white", fontSize: 14, fontWeight: "bold" },
  optimizeBtn: { backgroundColor: "#EAB308", paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10 },
  optimizeBtnText: { color: "#0F172A", fontSize: 11, fontWeight: "bold" },
  saveRouteBtn: { backgroundColor: "#22C55E", paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10 },
  saveRouteBtnText: { color: "white", fontSize: 11, fontWeight: "bold" },
  routeStatsRow: { flexDirection: "row", gap: 8, marginBottom: 10 },
  routeStatsText: { color: "#CBD5E1", fontSize: 12 },
  routeScroll: { flexDirection: "row", paddingVertical: 2 },
  routeStepCard: { backgroundColor: "#1E293B", borderRadius: 12, paddingVertical: 8, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", marginRight: 8, gap: 6, width: 185, borderWidth: 1, borderColor: "#334155" },
  stepNumBadge: { backgroundColor: "#38BDF8", width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  stepNumText: { color: "white", fontSize: 9, fontWeight: "bold" },
  stepName: { color: "white", fontSize: 11, fontWeight: "600" },
  emptyBuilderState: { alignItems: "center", justifyContent: "center", paddingVertical: 12 },
  loadingOverlay: { position: "absolute", top: "50%", left: "50%", marginLeft: -20, marginTop: -20, zIndex: 99 },
  builderInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1E293B",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: "#334155",
    gap: 6,
  },
  builderInput: {
    flex: 1,
    color: "white",
    fontSize: 13,
    paddingVertical: 8,
  },
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
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.85)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalContent: {
    backgroundColor: "#1E293B",
    borderRadius: 24,
    width: "100%",
    maxWidth: 340,
    padding: 20,
    borderWidth: 1,
    borderColor: "#334155",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 15,
    elevation: 10,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#334155",
    paddingBottom: 10,
  },
  modalTitle: {
    color: "white",
    fontSize: 18,
    fontWeight: "bold",
  },
  modalBody: {
    marginBottom: 20,
  },
  modalLabel: {
    color: "#94A3B8",
    fontSize: 11,
    fontWeight: "bold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 10,
    marginBottom: 4,
  },
  modalRouteName: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
  linkContainer: {
    backgroundColor: "#0F172A",
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#334155",
    marginTop: 4,
  },
  linkText: {
    color: "#CBD5E1",
    fontSize: 12,
    fontFamily: Platform.OS === "ios" ? "Courier New" : "monospace",
  },
  modalActions: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
  },
  modalSecondaryActions: {
    flexDirection: "row",
    gap: 8,
  },
  modalBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  copyBtn: {
    backgroundColor: "#10B981",
  },
  shareBtn: {
    backgroundColor: "#8B5CF6",
  },
  openRouteBtn: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#38BDF8",
  },
  closeBtn: {
    backgroundColor: "#475569",
  },
  modalBtnText: {
    color: "white",
    fontSize: 13,
    fontWeight: "bold",
  },
  promptInput: {
    backgroundColor: "#0F172A",
    color: "white",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderWidth: 1,
    borderColor: "#334155",
    fontSize: 14,
    width: "100%",
    marginTop: 4,
  },
  customCatContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1E293B",
    borderRadius: 14,
    paddingHorizontal: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#334155",
  },
  customCatInput: {
    flex: 1,
    color: "white",
    paddingVertical: 10,
    fontSize: 13,
  },
  customCatSearchBtn: {
    backgroundColor: "#38BDF8",
    borderRadius: 8,
    padding: 6,
  },
  inputsDropdown: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    backgroundColor: "#1E293B",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#38BDF8",
    zIndex: 9999,
    elevation: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    overflow: "hidden",
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
  builderToolbar: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#1E293B",
    marginBottom: 8,
  },
  toolbarBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    gap: 4,
    minWidth: 60,
  },
  toolbarBtnText: {
    color: "white",
    fontSize: 11,
    fontWeight: "bold",
  },
  cardInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 8,
    flexWrap: "wrap",
  },
  cardBadgeText: {
    color: "white",
    fontWeight: "bold",
    fontSize: 12,
  },
  cardCategoryText: {
    color: "#94A3B8",
    fontSize: 12,
  },
  reviewsLabel: {
    color: "white",
    fontSize: 12,
    fontWeight: "bold",
    marginTop: 12,
    marginBottom: 4,
  },
  cardReviewItem: {
    marginBottom: 4,
  },
  cardReviewName: {
    color: "#CBD5E1",
    fontSize: 11,
    fontWeight: "bold",
  },
  cardReviewText: {
    color: "#CBD5E1",
    fontSize: 11,
    fontWeight: "normal",
  },
  cardActionsRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
    justifyContent: "flex-end",
    alignItems: "center",
  },
  goToDirectionsBtn: {
    backgroundColor: "#10B981",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
  },
  actionBtnText: {
    color: "white",
    fontWeight: "bold",
    fontSize: 14,
  },
  cardFavIconBtn: {
    backgroundColor: "#EF4444",
    padding: 12,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
});