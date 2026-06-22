import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  ActivityIndicator,
  StyleSheet,
  Image,
  Dimensions,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  BackHandler,
} from "react-native";
import { useEffect, useState, useRef } from "react";
import { useLocalSearchParams, router } from "expo-router";
import { getFirestore, doc, onSnapshot, updateDoc, arrayUnion, deleteDoc, collection, query, orderBy, addDoc } from "firebase/firestore";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons, FontAwesome5, MaterialIcons } from "@expo/vector-icons";
import MapView, { Marker, Polyline } from "react-native-maps";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import app, { auth } from "../firebaseConfig";

const GEOAPIFY_KEY = "303db9c9ea7b411f81e4aaa234c881e5";

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

const pointToSegmentDist = (
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number
): number => {
  const dx = bx - ax, dy = by - ay;
  if (dx === 0 && dy === 0) {
    const R = 6371;
    const dLat = ((px - ax) * Math.PI) / 180;
    const dLon = ((py - ay) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((ax * Math.PI) / 180) * Math.cos((px * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  
  const targetX = ax + t * dx;
  const targetY = ay + t * dy;
  const R = 6371;
  const dLat = ((px - targetX) * Math.PI) / 180;
  const dLon = ((py - targetY) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((targetX * Math.PI) / 180) * Math.cos((px * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

export default function GroupDetailsScreen() {
  const db = getFirestore(app);
  const { id } = useLocalSearchParams();
  const mapRef = useRef<MapView>(null);

  const [group, setGroup] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("itinerary"); // 'itinerary', 'map', 'expenses', 'members'

  // Modals
  const [expenseModalVisible, setExpenseModalVisible] = useState(false);
  const [editItineraryModalVisible, setEditItineraryModalVisible] = useState(false);
  const [receiptViewerVisible, setReceiptViewerVisible] = useState(false);
  const [viewingReceiptUrl, setViewingReceiptUrl] = useState<string | null>(null);

  // Expense form
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("🍴 Food");
  const [paidBy, setPaidBy] = useState("");
  const [splitBetween, setSplitBetween] = useState<string[]>([]);
  const [receiptUri, setReceiptUri] = useState<string | null>(null);

  // Itinerary edit state
  const [selectedDayIndex, setSelectedDayIndex] = useState<number | null>(null);
  const [dayTitle, setDayTitle] = useState("");
  const [dayPlan, setDayPlan] = useState("");

  // Map Tab States
  const [selectedDayMap, setSelectedDayMap] = useState(0);
  const [mapSearchText, setMapSearchText] = useState("");
  const [mapSearchResults, setMapSearchResults] = useState<any[]>([]);
  const [mapSearching, setMapSearching] = useState(false);
  const [groupRouteCoords, setGroupRouteCoords] = useState<{ latitude: number; longitude: number }[]>([]);

  const dayMapData = group?.itinerary?.[selectedDayMap] || { title: "", plan: "", destinations: [] };
  const mapPins = (dayMapData.destinations || []).filter((d: any) => d.latitude && d.longitude);

  const mapPinsRef = useRef<any[]>([]);
  useEffect(() => {
    mapPinsRef.current = mapPins;
  }, [mapPins]);

  const groupRouteCoordsRef = useRef<any[]>([]);
  useEffect(() => {
    groupRouteCoordsRef.current = groupRouteCoords;
  }, [groupRouteCoords]);

  // Navigation & Route States
  const [accessDenied, setAccessDenied] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [navDestIndex, setNavDestIndex] = useState(0);
  const [routeDistanceM, setRouteDistanceM] = useState<number | null>(null);
  const [routeDurationS, setRouteDurationS] = useState<number | null>(null);
  const [currentLocation, setCurrentLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [liveDistanceKm, setLiveDistanceKm] = useState<number | null>(null);
  const [liveEtaMin, setLiveEtaMin] = useState<number | null>(null);
  const [arrivedAtStop, setArrivedAtStop] = useState<string | null>(null);
  const locationWatcherRef = useRef<any>(null);
  const navIndexRef = useRef<number>(0); // track navDestIndex in location callback

  // Turn-by-turn routing states
  const [routeSteps, setRouteSteps] = useState<any[]>([]);

  // Chat States
  const [messages, setMessages] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const activeTabRef = useRef(activeTab);

  // Sync activeTab ref
  useEffect(() => {
    activeTabRef.current = activeTab;
    if (activeTab === "chat" && id) {
      setUnreadCount(0);
      const nowStr = new Date().toISOString();
      AsyncStorage.setItem(`lastReadChat_${id}`, nowStr).catch(() => {});
    }
  }, [activeTab, id]);

  // Handle Android back press to go to plan tab before exit
  useEffect(() => {
    const handleHardwareBack = () => {
      if (activeTab !== "itinerary") {
        setActiveTab("itinerary");
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

  // Firestore Chat messages listener & local unread counter
  useEffect(() => {
    if (!id) return;

    const msgsQuery = query(
      collection(db, "groups", String(id), "messages"),
      orderBy("timestamp", "asc")
    );

    const unsubscribe = onSnapshot(
      msgsQuery,
      async (snapshot) => {
        const tempMsgs: any[] = [];
        snapshot.forEach((d) => {
          tempMsgs.push({ id: d.id, ...d.data() });
        });
        setMessages(tempMsgs);

        // Calculate unread count
        if (activeTabRef.current !== "chat") {
          try {
            const lastReadTime = await AsyncStorage.getItem(`lastReadChat_${id}`);
            const currentUser = auth.currentUser;
            if (lastReadTime) {
              const count = tempMsgs.filter(
                (msg) => msg.timestamp && msg.timestamp > lastReadTime && msg.senderId !== currentUser?.uid
              ).length;
              setUnreadCount(count);
            } else {
              const count = tempMsgs.filter(
                (msg) => msg.senderId !== currentUser?.uid
              ).length;
              setUnreadCount(count);
            }
          } catch (e) {
            console.log("Unread count check error:", e);
          }
        }
      },
      (error) => {
        console.log("Chat sync error:", error);
      }
    );

    return () => unsubscribe();
  }, [id]);

  // Synchronize navigation day selection
  useEffect(() => {
    if (group && group.navigationActive && group.navDayIndex !== undefined) {
      setSelectedDayMap(group.navDayIndex);
    }
  }, [group?.navigationActive, group?.navDayIndex]);

  // Synchronize follower status from navigator's Firestore writes
  useEffect(() => {
    if (group && group.navigationActive) {
      const isCurrentNavigator = group.navigatorUid === auth.currentUser?.uid;
      if (!isCurrentNavigator) {
        if (group.navDestIndex !== undefined) {
          setNavDestIndex(group.navDestIndex);
          navIndexRef.current = group.navDestIndex;
        }
        if (group.liveDistanceKm !== undefined) {
          setLiveDistanceKm(group.liveDistanceKm);
        }
        if (group.liveEtaMin !== undefined) {
          setLiveEtaMin(group.liveEtaMin);
        }
      }
    }
  }, [group?.navigationActive, group?.navDestIndex, group?.liveDistanceKm, group?.liveEtaMin, group?.navigatorUid]);

  // Pan camera to follow the active navigator (for followers)
  useEffect(() => {
    if (group && group.navigationActive && group.navigatorCoords && group.navigatorUid !== auth.currentUser?.uid) {
      const coords = group.navigatorCoords;
      mapRef.current?.animateToRegion(
        { latitude: coords.latitude, longitude: coords.longitude, latitudeDelta: 0.015, longitudeDelta: 0.015 },
        1000
      );
    }
  }, [group?.navigatorCoords, group?.navigationActive, group?.navigatorUid]);

  useEffect(() => {
    if (!id) return;

    // Listen to group doc changes in real-time
    const unsubscribe = onSnapshot(
      doc(db, "groups", String(id)),
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          setGroup(data);

          // Access guard: deny if current user's UID is not in memberUids
          const uid = auth.currentUser?.uid;
          if (uid && data.memberUids && data.memberUids.length > 0 && !data.memberUids.includes(uid)) {
            setAccessDenied(true);
          } else {
            setAccessDenied(false);
          }

          // default paidBy & splitBetween to all members
          if (data.members && data.members.length > 0) {
            setPaidBy(data.members[0]);
            setSplitBetween(data.members);
          }
        }
        setLoading(false);
      },
      (error) => {
        console.log("Group details sync error:", error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [id]);

  // Dynamic Route calculations whenever selectedDayMap or group itinerary changes
  useEffect(() => {
    if (!group || !group.itinerary || !group.itinerary[selectedDayMap]) {
      setGroupRouteCoords([]);
      return;
    }
    const dayData = group.itinerary[selectedDayMap];
    let spots = (dayData.destinations || []).filter((d: any) => d.latitude && d.longitude);

    if (group.navigationActive && group.navigatorCoords && group.navDestIndex !== undefined) {
      const remainingStops = spots.slice(group.navDestIndex);
      spots = [
        {
          name: "Start",
          latitude: group.navigatorCoords.latitude,
          longitude: group.navigatorCoords.longitude,
        },
        ...remainingStops
      ];
    }

    if (spots.length >= 2) {
      fetchOSRMRoute(spots);
    } else {
      setGroupRouteCoords([]);
    }
  }, [selectedDayMap, group?.itinerary, group?.navigationActive, group?.navigatorCoords?.latitude, group?.navigatorCoords?.longitude, group?.navDestIndex]);

  const fetchOSRMRoute = async (spots: any[]) => {
    try {
      const coordsString = spots.map((s) => `${s.longitude},${s.latitude}`).join(";");
      const res = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${coordsString}?overview=full&geometries=geojson&steps=true`
      );
      const data = await res.json();
      if (data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        const coords = route.geometry.coordinates.map((c: any) => ({
          latitude: c[1],
          longitude: c[0],
        }));
        setGroupRouteCoords(coords);
        setRouteDistanceM(route.distance ?? null);
        setRouteDurationS(route.duration ?? null);

        const allSteps: any[] = [];
        if (route.legs) {
          route.legs.forEach((leg: any) => {
            if (leg.steps) {
              allSteps.push(...leg.steps);
            }
          });
        }
        setRouteSteps(allSteps);
      } else {
        throw new Error("No route");
      }
    } catch (e) {
      console.log("OSRM route error inside group-details, fallback to direct polyline:", e);
      setGroupRouteCoords(spots.map((s) => ({ latitude: s.latitude, longitude: s.longitude })));
      setRouteSteps([]);
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: "#0F172A", justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color="#38BDF8" />
        <Text style={{ color: "#94A3B8", marginTop: 10 }}>Syncing group updates...</Text>
      </View>
    );
  }

  if (!group) {
    return (
      <View style={{ flex: 1, backgroundColor: "#0F172A", justifyContent: "center", alignItems: "center", padding: 20 }}>
        <Text style={{ color: "white", fontSize: 20, fontWeight: "bold" }}>Trip details could not be found.</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 20, backgroundColor: "#38BDF8", padding: 12, borderRadius: 10 }}>
          <Text style={{ color: "white", fontWeight: "bold" }}>Back to Dashboard</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (accessDenied) {
    return (
      <View style={{ flex: 1, backgroundColor: "#0F172A", justifyContent: "center", alignItems: "center", padding: 20 }}>
        <Ionicons name="lock-closed-outline" size={48} color="#EF4444" />
        <Text style={{ color: "white", fontSize: 20, fontWeight: "bold", marginTop: 16 }}>Access Denied</Text>
        <Text style={{ color: "#94A3B8", textAlign: "center", marginTop: 8, lineHeight: 22 }}>
          You are not a member of this group trip. Ask the owner to share the invite code.
        </Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 24, backgroundColor: "#38BDF8", paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 }}>
          <Text style={{ color: "white", fontWeight: "bold" }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Detect Owner Role:
  // Primary: UID-based check (reliable for all new groups)
  // Fallback: name/email heuristics for backward compatibility with old documents
  const currentUserUid = auth.currentUser?.uid;
  const currentUserEmail = auth.currentUser?.email;
  const currentUserName = auth.currentUser?.displayName || currentUserEmail?.split("@")[0] || "Traveler";
  const isOwner =
    (currentUserUid && group.ownerUid === currentUserUid) ||
    (currentUserUid && group.createdBy === currentUserUid) ||
    group.organizer === currentUserEmail ||
    group.organizer === currentUserName ||
    (group.members?.[0] && group.members[0].startsWith(currentUserName));

  // Custom debt splits calculation engine
  const expensesList = group.expenses || [];
  const totalSpent = expensesList.reduce((acc: number, curr: any) => acc + (Number(curr.amount) || 0), 0);
  const budget = Number(group.budget) || 1;
  const budgetRatio = Math.min(totalSpent / budget, 1);

  const memberList = group.members || ["Traveler"];
  const perPersonCost = totalSpent / memberList.length;

  const netBalances: Record<string, number> = {};
  memberList.forEach((m: string) => {
    netBalances[m] = 0;
  });

  expensesList.forEach((exp: any) => {
    const paidByWho = exp.paidBy || memberList[0];
    const amountNum = Number(exp.amount) || 0;
    
    // Credit the payer
    if (netBalances[paidByWho] !== undefined) {
      netBalances[paidByWho] += amountNum;
    }

    // Debit the members who split this cost
    const splitBuddies = exp.splitBetween && exp.splitBetween.length > 0 ? exp.splitBetween : memberList;
    const splitShare = amountNum / splitBuddies.length;
    splitBuddies.forEach((buddy: string) => {
      if (netBalances[buddy] !== undefined) {
        netBalances[buddy] -= splitShare;
      }
    });
  });

  const settlements = memberList.map((m: string) => {
    const balance = netBalances[m] || 0;
    const paid = expensesList
      .filter((e: any) => (e.paidBy || memberList[0]) === m)
      .reduce((acc: number, curr: any) => acc + (Number(curr.amount) || 0), 0);
    return {
      name: m,
      paid,
      balance: Number(balance.toFixed(2)),
    };
  });

  // Pick receipt image
  const pickReceipt = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission Required", "Camera roll access is needed to upload receipts.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
    });
    if (!result.canceled) {
      setReceiptUri(result.assets[0].uri);
    }
  };

  const handleAddExpense = async () => {
    if (!amount.trim() || !description.trim()) {
      Alert.alert("Input Required", "Fill in cost and description.");
      return;
    }
    if (splitBetween.length === 0) {
      Alert.alert("Required", "Select at least one member to split the expense.");
      return;
    }

    try {
      const ref = doc(db, "groups", String(id));
      await updateDoc(ref, {
        expenses: arrayUnion({
          amount: Number(amount),
          description: description.trim(),
          category,
          paidBy,
          splitBetween,
          receiptImage: receiptUri || "",
          createdAt: new Date().toISOString(),
        }),
      });

      Alert.alert("Expense Logged! 💰", `${category} expense of ₹${amount} logged successfully.`);
      setExpenseModalVisible(false);
      setAmount("");
      setDescription("");
      setReceiptUri(null);
    } catch (e) {
      Alert.alert("Error", "Could not log expense.");
    }
  };

  const handleSaveItineraryDay = async () => {
    if (selectedDayIndex === null) return;
    try {
      const updatedItinerary = [...group.itinerary];
      updatedItinerary[selectedDayIndex] = {
        ...updatedItinerary[selectedDayIndex],
        day: selectedDayIndex + 1,
        title: dayTitle,
        plan: dayPlan,
      };

      const ref = doc(db, "groups", String(id));
      await updateDoc(ref, {
        itinerary: updatedItinerary,
      });

      setEditItineraryModalVisible(false);
      Alert.alert("Itinerary Synced! 🗓️", `Day ${selectedDayIndex + 1} plan updated.`);
    } catch (e) {
      Alert.alert("Error", "Could not update itinerary.");
    }
  };

  // Search places for routing builder on Map tab
  const handleMapSearch = async () => {
    if (!mapSearchText.trim()) return;
    setMapSearching(true);
    setMapSearchResults([]);
    try {
      const res = await fetch(
        `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(mapSearchText)}&limit=5&apiKey=${GEOAPIFY_KEY}`
      );
      const data = await res.json();
      if (data.features) {
        const mapped = data.features.map((f: any) => ({
          name: f.properties.name || f.properties.street || f.properties.city || "Special Spot",
          address: f.properties.formatted || "",
          lat: f.properties.lat,
          lon: f.properties.lon,
        }));
        setMapSearchResults(mapped);
      }
    } catch (e) {
      Alert.alert("Error", "Could not query map locations.");
    } finally {
      setMapSearching(false);
    }
  };

  const addSpotToItinerary = async (spot: any) => {
    try {
      const updatedItinerary = [...group.itinerary];
      const dayData = { ...updatedItinerary[selectedDayMap] };
      const destinations = dayData.destinations ? [...dayData.destinations] : [];
      
      const exists = destinations.some((d: any) => d.name === spot.name);
      if (exists) {
        Alert.alert("Already Added", "This spot is already in your itinerary for today.");
        return;
      }

      destinations.push({
        name: spot.name,
        address: spot.address,
        latitude: spot.lat,
        longitude: spot.lon,
      });
      dayData.destinations = destinations;
      updatedItinerary[selectedDayMap] = dayData;

      const ref = doc(db, "groups", String(id));
      await updateDoc(ref, {
        itinerary: updatedItinerary,
      });

      setMapSearchText("");
      setMapSearchResults([]);
      Alert.alert("Spot Added! 📍", `"${spot.name}" added to Day ${selectedDayMap + 1}.`);
    } catch (e) {
      Alert.alert("Error", "Could not save spot to day plan.");
    }
  };

  const deleteSpotFromItinerary = async (index: number) => {
    try {
      const updatedItinerary = [...group.itinerary];
      const dayData = { ...updatedItinerary[selectedDayMap] };
      const destinations = dayData.destinations ? [...dayData.destinations] : [];

      destinations.splice(index, 1);
      dayData.destinations = destinations;
      updatedItinerary[selectedDayMap] = dayData;

      const ref = doc(db, "groups", String(id));
      await updateDoc(ref, {
        itinerary: updatedItinerary,
      });

      Alert.alert("Deleted 🗑️", "Destination removed from group schedule.");
    } catch (e) {
      Alert.alert("Error", "Could not delete spot.");
    }
  };

  const toggleSplitBuddy = (buddyName: string) => {
    if (splitBetween.includes(buddyName)) {
      setSplitBetween(splitBetween.filter((b) => b !== buddyName));
    } else {
      setSplitBetween([...splitBetween, buddyName]);
    }
  };

  const handleDeleteTrip = async () => {
    Alert.alert("Delete Trip", "Are you sure you want to delete this group trip?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteDoc(doc(db, "groups", String(id)));
            router.back();
          } catch (e) {
            console.log(e);
          }
        },
      },
    ]);
  };

  const viewReceiptImage = (url: string) => {
    setViewingReceiptUrl(url);
    setReceiptViewerVisible(true);
  };

  // ── Haversine distance helper (km) ──────────────────────────────────────
  const getDistanceKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const handleLocationUpdate = async (coords: { latitude: number; longitude: number }) => {
    setCurrentLocation(coords);

    const currentPins = mapPinsRef.current;
    const idx = navIndexRef.current;
    if (currentPins.length > 0 && idx < currentPins.length) {
      const destPin = currentPins[idx];
      const distKm = getDistanceKm(
        coords.latitude, coords.longitude,
        destPin.latitude, destPin.longitude
      );
      const distMetres = distKm * 1000;
      setLiveDistanceKm(distKm);
      const eta = Math.ceil((distKm / 40) * 60);
      setLiveEtaMin(eta);

      let minDist = Infinity;
      const coordsList = groupRouteCoordsRef.current;
      if (coordsList && coordsList.length >= 2) {
        for (let i = 0; i < coordsList.length - 1; i++) {
          const d = pointToSegmentDist(
            coords.latitude, coords.longitude,
            coordsList[i].latitude, coordsList[i].longitude,
            coordsList[i + 1].latitude, coordsList[i + 1].longitude
          );
          if (d < minDist) { minDist = d; }
        }
      }

      const REROUTE_THRESHOLD_KM = 0.15;
      if (minDist > REROUTE_THRESHOLD_KM) {
        console.log("Off-route detected, recalculating OSRM route...");
        const remaining = currentPins.slice(idx);
        const spotsWithGPS = [
          { name: "Current GPS", latitude: coords.latitude, longitude: coords.longitude },
          ...remaining
        ];
        await fetchOSRMRoute(spotsWithGPS);
        return;
      }

      const ref = doc(db, "groups", String(id));
      await updateDoc(ref, {
        navigatorCoords: coords,
        liveDistanceKm: distKm,
        liveEtaMin: eta,
      });

      if (distMetres <= 50) {
        setArrivedAtStop(destPin.name);
        if (idx < currentPins.length - 1) {
          const nextIdx = idx + 1;
          navIndexRef.current = nextIdx;
          setNavDestIndex(nextIdx);
          setLiveDistanceKm(null);
          setLiveEtaMin(null);

          await updateDoc(ref, {
            navDestIndex: nextIdx,
            liveDistanceKm: null,
            liveEtaMin: null,
          });

          try {
            const remaining = currentPins.slice(nextIdx);
            if (remaining.length >= 2) {
              const coordStr = remaining.map((s: any) => `${s.longitude},${s.latitude}`).join(";");
              const r = await fetch(
                `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson&steps=true`
              );
              const rd = await r.json();
              if (rd.routes?.[0]) {
                setRouteDistanceM(rd.routes[0].distance);
                setRouteDurationS(rd.routes[0].duration);
              }
            }
          } catch (e) {}
          setTimeout(() => setArrivedAtStop(null), 4000);
        }
      }
    }
  };

  // ── Start GPS navigation ─────────────────────────────────────────────────
  const startNavigation = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission Required", "Location access is needed for turn-by-turn navigation.");
      return;
    }

    const ref = doc(db, "groups", String(id));
    const currentUser = auth.currentUser;
    const navName = currentUser?.displayName || currentUser?.email?.split("@")[0] || "Leader";

    await updateDoc(ref, {
      navigationActive: true,
      navDestIndex: 0,
      navDayIndex: selectedDayMap,
      navigatorUid: currentUser?.uid || "",
      navigatorName: navName,
      navigatorCoords: null,
      liveDistanceKm: null,
      liveEtaMin: null,
    });

    setIsNavigating(true);
    setNavDestIndex(0);
    navIndexRef.current = 0;
    setArrivedAtStop(null);
    setLiveDistanceKm(null);
    setLiveEtaMin(null);

    // Fetch initial location immediately so we don't display "..."
    try {
      const initialLoc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const initPos = {
        latitude: initialLoc.coords.latitude,
        longitude: initialLoc.coords.longitude,
      };
      await handleLocationUpdate(initPos);
    } catch (e) {
      console.log("Error fetching initial GPS location:", e);
    }

    const watcher = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, distanceInterval: 10 },
      async (loc) => {
        if (group && group.navigatorUid !== currentUser?.uid) {
          stopNavigation();
          return;
        }
        await handleLocationUpdate({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        });
      }
    );
    locationWatcherRef.current = watcher;
  };

  // ── Stop GPS navigation ──────────────────────────────────────────────────
  const stopNavigation = async () => {
    if (locationWatcherRef.current) {
      locationWatcherRef.current.remove();
      locationWatcherRef.current = null;
    }

    if (group && group.navigatorUid === auth.currentUser?.uid) {
      const ref = doc(db, "groups", String(id));
      await updateDoc(ref, {
        navigationActive: false,
        navigatorUid: null,
        navigatorName: null,
        navigatorCoords: null,
        liveDistanceKm: null,
        liveEtaMin: null,
      });
    }

    setIsNavigating(false);
    setCurrentLocation(null);
    setNavDestIndex(0);
  };

  const getTurnIcon = (modifier: string) => {
    if (!modifier) return "arrow-up-outline";
    const mod = modifier.toLowerCase();
    if (mod.includes("left")) {
      return "arrow-undo-outline";
    }
    if (mod.includes("right")) {
      return "arrow-redo-outline";
    }
    if (mod.includes("straight")) {
      return "arrow-up-outline";
    }
    return "arrow-up-outline";
  };

  const getCurrentStep = () => {
    if (!routeSteps || routeSteps.length === 0) return null;
    
    let coveredDist = 0;
    if (routeDistanceM !== null && liveDistanceKm !== null) {
      coveredDist = Math.max(0, routeDistanceM - liveDistanceKm * 1000);
    }

    let accum = 0;
    for (let i = 0; i < routeSteps.length; i++) {
      accum += routeSteps[i].distance || 0;
      if (accum >= coveredDist) {
        return {
          step: routeSteps[i],
          nextStep: routeSteps[i + 1] || null,
          index: i
        };
      }
    }
    return {
      step: routeSteps[routeSteps.length - 1],
      nextStep: null,
      index: routeSteps.length - 1
    };
  };

  const getRouteProgress = () => {
    if (mapPins.length === 0) return 0;
    const baseProgress = navDestIndex / mapPins.length;
    let stepProgress = 0;
    if (liveDistanceKm !== null && routeDistanceM !== null) {
      const remainingLegM = liveDistanceKm * 1000;
      stepProgress = Math.max(0, Math.min(1, 1 - remainingLegM / Math.max(routeDistanceM, 1))) / mapPins.length;
    }
    return Math.max(0, Math.min(1, baseProgress + stepProgress));
  };
  const navProgress = getRouteProgress();

  const renderFullscreenNavigation = () => {
    const isCurrentNavigator = group?.navigatorUid === auth.currentUser?.uid;
    const currentPins = mapPins;
    const activeDest = currentPins[navDestIndex];
    const activeStepInfo = getCurrentStep();

    const navDistStr =
      liveDistanceKm === null
        ? "..."
        : liveDistanceKm < 1
        ? `${Math.round(liveDistanceKm * 1000)} m`
        : `${liveDistanceKm.toFixed(1)} km`;
    const navEtaStr = liveEtaMin === null ? "..." : `${liveEtaMin} min`;

    return (
      <View style={StyleSheet.absoluteFillObject}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFillObject}
          showsUserLocation
          showsMyLocationButton={false}
          showsTraffic={false}
          customMapStyle={DARK_MAP_STYLE}
          initialRegion={{
            latitude: currentLocation?.latitude || activeDest?.latitude || 13.0827,
            longitude: currentLocation?.longitude || activeDest?.longitude || 80.2707,
            latitudeDelta: 0.015,
            longitudeDelta: 0.015,
          }}
        >
          {currentPins.map((pin: any, idx: number) => (
            <Marker
              key={`nav-pin-${idx}`}
              coordinate={{ latitude: pin.latitude, longitude: pin.longitude }}
            >
              <View style={styles.mapMarker}>
                <Ionicons name="pin" size={24} color={idx === navDestIndex ? "#EAB308" : "#38BDF8"} />
                <View style={styles.markerNumBadge}>
                  <Text style={{ color: "white", fontSize: 9, fontWeight: "bold" }}>{idx + 1}</Text>
                </View>
              </View>
            </Marker>
          ))}

          {!isCurrentNavigator && group?.navigatorCoords && (
            <Marker
              coordinate={{
                latitude: group.navigatorCoords.latitude,
                longitude: group.navigatorCoords.longitude,
              }}
            >
              <View style={styles.navigatorMarker}>
                <Ionicons name="navigate" size={26} color="#22C55E" />
                <View style={styles.navigatorBadge}>
                  <Text style={{ color: "white", fontSize: 7, fontWeight: "bold" }}>NAV</Text>
                </View>
              </View>
            </Marker>
          )}

          {groupRouteCoords.length > 0 && (
            <Polyline
              coordinates={groupRouteCoords}
              strokeWidth={6}
              strokeColor="#22C55E"
            />
          )}
        </MapView>

        <View style={styles.guidanceCard}>
          <View style={styles.guidanceIconContainer}>
            <Ionicons
              name={getTurnIcon(activeStepInfo?.step?.maneuver?.modifier)}
              size={32}
              color="white"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.guidanceInstruction} numberOfLines={2}>
              {activeStepInfo?.step?.maneuver?.instruction || "Proceed along route"}
            </Text>
            {activeStepInfo?.step?.name ? (
              <Text style={styles.guidanceRoad} numberOfLines={1}>
                onto {activeStepInfo.step.name}
              </Text>
            ) : null}
          </View>
          {activeStepInfo?.step?.distance ? (
            <Text style={styles.guidanceStepDist}>
              {activeStepInfo.step.distance < 1000
                ? `${Math.round(activeStepInfo.step.distance)} m`
                : `${(activeStepInfo.step.distance / 1000).toFixed(1)} km`}
            </Text>
          ) : null}
        </View>

        <View style={styles.navHUDOverlay}>
          <View style={styles.navProgressBar}>
            <View style={[styles.navProgressFill, { width: `${Math.round(navProgress * 100)}%` }]} />
          </View>

          <View style={styles.hudRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.hudEta}>{navEtaStr}</Text>
              <Text style={styles.hudDist}>
                {navDistStr} remaining • {activeDest?.name || "Next Stop"}
              </Text>
            </View>

            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              {isCurrentNavigator && navDestIndex < currentPins.length - 1 && (
                <TouchableOpacity
                  onPress={async () => {
                    const next = navDestIndex + 1;
                    navIndexRef.current = next;
                    setNavDestIndex(next);
                    setLiveDistanceKm(null);
                    setLiveEtaMin(null);
                    const ref = doc(db, "groups", String(id));
                    await updateDoc(ref, {
                      navDestIndex: next,
                      liveDistanceKm: null,
                      liveEtaMin: null,
                    });
                  }}
                  style={styles.hudNextBtn}
                >
                  <Ionicons name="play-skip-forward" size={16} color="white" />
                  <Text style={{ color: "white", fontWeight: "bold", fontSize: 13, marginLeft: 4 }}>Next</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity onPress={stopNavigation} style={styles.hudStopBtn}>
                <Ionicons name="stop-circle" size={18} color="white" />
                <Text style={{ color: "white", fontWeight: "bold", fontSize: 13, marginLeft: 4 }}>End</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    );
  };

  const sendChatNotification = async (messageText: string) => {
    try {
      const otherMemberUids = (group.memberUids || []).filter((uid: string) => uid !== currentUserUid);
      
      const batchPromises = otherMemberUids.map((uid: string) => {
        return addDoc(collection(db, "notifications"), {
          recipientUid: uid,
          senderUid: currentUserUid,
          type: "group",
          title: group.groupName || "Group Chat",
          body: `${currentUserName}: ${messageText}`,
          timestamp: new Date().toISOString(),
          unread: true,
          route: `/group-details?id=${id}`,
        });
      });
      
      await Promise.all(batchPromises);
    } catch (e) {
      console.log("Error sending chat notifications:", e);
    }
  };



  const renderTopSection = () => {
    return (
      <View>
        {/* Dates Bar */}
        <View style={styles.metaRow}>
          <Text style={styles.metaText}>🗓 {group.startDate} - {group.endDate}</Text>
          <View style={styles.codeBadge}>
            <Text style={styles.codeText}>Code: {group.code}</Text>
          </View>
        </View>

        {/* Budget visual progress bar */}
        <View style={styles.budgetCard}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 10 }}>
            <Text style={{ color: "#CBD5E1" }}>Expenses Tracking</Text>
            <Text style={{ color: "#38BDF8", fontWeight: "bold" }}>
              ₹{totalSpent} / ₹{group.budget}
            </Text>
          </View>
          <View style={styles.barBackground}>
            <View
              style={[
                styles.barFill,
                {
                  width: `${budgetRatio * 100}%`,
                  backgroundColor: budgetRatio >= 0.95 ? "#EF4444" : "#38BDF8",
                },
              ]}
            />
          </View>
          <Text style={styles.budgetMessage}>
            {totalSpent > group.budget
              ? "⚠️ Over budget! Coordinate to limit costs."
              : `₹${group.budget - totalSpent} remaining in joint pool.`}
          </Text>
        </View>

        {/* Tab switcher */}
        <View style={styles.tabBar}>
          {[
            { id: "itinerary", label: "🗓 Plan" },
            { id: "map", label: "🗺️ Map" },
            { id: "expenses", label: "💰 Bills" },
            { id: "members", label: "👥 Buddies" },
          ].map((tab) => (
            <TouchableOpacity
              key={tab.id}
              onPress={() => setActiveTab(tab.id)}
              style={[styles.tabBtn, activeTab === tab.id ? styles.activeTabBtn : null]}
            >
              <Text
                style={{
                  color: activeTab === tab.id ? "white" : "#94A3B8",
                  fontWeight: "bold",
                  fontSize: 12,
                }}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  };

  const showFullscreenNav = isNavigating || (group && group.navigationActive);

  return (
    <View style={styles.container}>
      {/* Header Bar */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => {
            if (activeTab !== "itinerary") {
              setActiveTab("itinerary");
            } else {
              router.back();
            }
          }}
          style={styles.backBtn}
        >
          <Ionicons name="arrow-back-outline" size={24} color="white" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {group.groupName}
          </Text>
          <Text style={styles.headerSub}>📍 {group.destination} {isOwner ? "(Owner)" : "(Member)"}</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <TouchableOpacity
            onPress={() =>
              router.push({
                pathname: "/group-chat",
                params: { id: String(id), name: group.groupName },
              })
            }
            style={styles.chatHeaderBtn}
          >
            <Ionicons name="chatbubbles-outline" size={22} color="#38BDF8" />
            {unreadCount > 0 && <View style={styles.unreadBadgeDot} />}
          </TouchableOpacity>
          {isOwner && (
            <TouchableOpacity onPress={handleDeleteTrip} style={styles.deleteBtn}>
              <Ionicons name="trash-outline" size={22} color="#EF4444" />
            </TouchableOpacity>
          )}
        </View>
      </View>


        <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1, padding: 20 }}>
          {renderTopSection()}

          {/* TAB CONTENTS */}
        {activeTab === "itinerary" && (
          <View style={{ marginBottom: 100 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 15 }}>
              <Text style={styles.sectionTitle}>Shared Daily Plan</Text>
              {isOwner && <Text style={{ color: "#38BDF8", fontSize: 12 }}>Tap card to edit globally</Text>}
            </View>

            {(group.itinerary || []).map((day: any, index: number) => (
              <TouchableOpacity
                key={index}
                onPress={() => {
                  if (!isOwner) return;
                  setSelectedDayIndex(index);
                  setDayTitle(day.title || `Day ${index + 1}`);
                  setDayPlan(day.plan || "");
                  setEditItineraryModalVisible(true);
                }}
                disabled={!isOwner}
                style={styles.itineraryCard}
              >
                <View style={styles.dayDotContainer}>
                  <View style={styles.dayDot} />
                  <Text style={styles.dayNum}>Day {index + 1}</Text>
                </View>
                <Text style={styles.dayTitle}>{day.title}</Text>
                <Text style={styles.dayPlan}>{day.plan}</Text>
                
                {day.destinations && day.destinations.length > 0 && (
                  <View style={{ marginTop: 12, borderTopWidth: 1, borderTopColor: "#334155", paddingTop: 8 }}>
                    <Text style={{ color: "#EAB308", fontWeight: "bold", fontSize: 11, marginBottom: 4 }}>
                      📍 SCHEDULED SPOTS:
                    </Text>
                    {day.destinations.map((dest: any, dIdx: number) => (
                      <Text key={dIdx} style={{ color: "#CBD5E1", fontSize: 12, marginVertical: 2 }}>
                        • {dest.name}
                      </Text>
                    ))}
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {activeTab === "map" && (
          <View style={{ marginBottom: 100 }}>
            <Text style={styles.sectionTitle}>Visual Travel Route 🗺️</Text>
            
            {/* Day Selector horizontal scroll */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 15 }}>
              {(group.itinerary || []).map((day: any, idx: number) => (
                <TouchableOpacity
                  key={idx}
                  onPress={() => setSelectedDayMap(idx)}
                  style={[
                    styles.dayPill,
                    selectedDayMap === idx ? styles.dayPillActive : styles.dayPillInactive,
                  ]}
                >
                  <Text style={styles.dayPillText}>Day {idx + 1}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Interactive MapView */}
            <View style={styles.mapWrapper}>
              <MapView
                ref={mapRef}
                style={styles.miniMap}
                showsUserLocation
                initialRegion={{
                  latitude: mapPins[0]?.latitude || 13.0827,
                  longitude: mapPins[0]?.longitude || 80.2707,
                  latitudeDelta: 0.12,
                  longitudeDelta: 0.12,
                }}
              >
                {mapPins.map((pin: any, idx: number) => (
                  <Marker
                    key={idx}
                    coordinate={{ latitude: pin.latitude, longitude: pin.longitude }}
                    title={pin.name}
                    description={pin.address}
                  >
                    <View style={styles.mapMarker}>
                      <Ionicons name="pin" size={24} color="#38BDF8" />
                      <View style={styles.markerNumBadge}>
                        <Text style={{ color: "white", fontSize: 9, fontWeight: "bold" }}>{idx + 1}</Text>
                      </View>
                    </View>
                  </Marker>
                ))}

                {groupRouteCoords.length > 0 && (
                  <Polyline coordinates={groupRouteCoords} strokeWidth={4} strokeColor="#38BDF8" />
                )}
              </MapView>
            </View>

            {/* Route Distance & Duration Summary */}
            {routeDistanceM !== null && (
              <View style={styles.routeSummaryCard}>
                <View style={{ flexDirection: "row", justifyContent: "space-around", alignItems: "center" }}>
                  <View style={{ alignItems: "center" }}>
                    <Ionicons name="map-outline" size={20} color="#38BDF8" />
                    <Text style={{ color: "white", fontSize: 22, fontWeight: "bold", marginTop: 4 }}>
                      {(routeDistanceM / 1000).toFixed(1)} km
                    </Text>
                    <Text style={{ color: "#94A3B8", fontSize: 11, marginTop: 2 }}>Total Distance</Text>
                  </View>
                  <View style={{ width: 1, height: 48, backgroundColor: "#334155" }} />
                  <View style={{ alignItems: "center" }}>
                    <Ionicons name="time-outline" size={20} color="#EAB308" />
                    <Text style={{ color: "white", fontSize: 22, fontWeight: "bold", marginTop: 4 }}>
                      {routeDurationS ? `${Math.round(routeDurationS / 60)} min` : "--"}
                    </Text>
                    <Text style={{ color: "#94A3B8", fontSize: 11, marginTop: 2 }}>Est. Drive Time</Text>
                  </View>
                </View>
              </View>
            )}

            {/* Spots Timeline display */}
            <Text style={styles.sectionTitle}>Day Timeline & Directions</Text>
            {mapPins.length > 0 ? (
              mapPins.map((pin: any, idx: number) => (
                <View key={idx} style={styles.timelineItem}>
                  <View style={styles.timelinePoint}>
                    <Text style={{ color: "white", fontSize: 10, fontWeight: "bold" }}>{idx + 1}</Text>
                  </View>
                  <View style={styles.timelineContent}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <Text style={styles.timelineTitle}>{pin.name}</Text>
                      {isOwner && (
                        <TouchableOpacity onPress={() => deleteSpotFromItinerary(idx)} style={{ padding: 4 }}>
                          <Ionicons name="trash-outline" size={16} color="#EF4444" />
                        </TouchableOpacity>
                      )}
                    </View>
                    <Text style={styles.timelineAddress}>{pin.address || "No address logged"}</Text>
                  </View>
                </View>
              ))
            ) : (
              <Text style={{ color: "#94A3B8", textAlign: "center", marginVertical: 10 }}>
                No landmarks mapped for today yet.
              </Text>
            )}

            {/* Navigation Button — available to all members */}
            {mapPins.length >= 1 && (
              <TouchableOpacity
                onPress={isNavigating ? stopNavigation : startNavigation}
                style={[styles.navBtn, isNavigating ? { backgroundColor: "#EF4444" } : {}]}
              >
                <Ionicons
                  name={isNavigating ? "stop-circle-outline" : "navigate-outline"}
                  size={22}
                  color="white"
                />
                <Text style={{ color: "white", fontWeight: "bold", marginLeft: 10, fontSize: 16 }}>
                  {isNavigating ? "Stop Navigation" : "🧭 Start Navigation"}
                </Text>
              </TouchableOpacity>
            )}

            {/* Owner Map Route builder */}
            {isOwner && (
              <View style={styles.ownerBuilderCard}>
                <Text style={styles.builderTitle}>⚙️ Route Planner (Owner Only)</Text>
                
                <View style={styles.searchRow}>
                  <TextInput
                    placeholder="Search place to add (e.g. Marina Beach)"
                    placeholderTextColor="#94A3B8"
                    value={mapSearchText}
                    onChangeText={setMapSearchText}
                    onSubmitEditing={handleMapSearch}
                    style={styles.builderSearchInput}
                  />
                  <TouchableOpacity onPress={handleMapSearch} style={styles.builderSearchBtn}>
                    {mapSearching ? <ActivityIndicator size="small" color="white" /> : <Ionicons name="search" size={18} color="white" />}
                  </TouchableOpacity>
                </View>

                {/* Search Results list */}
                {mapSearchResults.map((res: any, idx: number) => (
                  <TouchableOpacity
                    key={idx}
                    onPress={() => addSpotToItinerary(res)}
                    style={styles.builderSearchResultItem}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: "white", fontWeight: "bold" }}>{res.name}</Text>
                      <Text style={{ color: "#CBD5E1", fontSize: 11, marginTop: 2 }}>{res.address}</Text>
                    </View>
                    <Ionicons name="add-circle" size={24} color="#38BDF8" />
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        )}

        {activeTab === "expenses" && (
          <View style={{ marginBottom: 100 }}>
            {/* Add Expense trigger */}
            <TouchableOpacity
              onPress={() => setExpenseModalVisible(true)}
              style={styles.addExpenseTrigger}
            >
              <FontAwesome5 name="plus" size={16} color="white" style={{ marginRight: 8 }} />
              <Text style={{ color: "white", fontWeight: "bold" }}>Log Shared Bill & Split</Text>
            </TouchableOpacity>

            {/* Split Settlement breakdown */}
            <Text style={styles.sectionTitle}>Settle Balances (Unequal/Custom splits)</Text>
            <View style={styles.settleCard}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 10 }}>
                <Text style={{ color: "#94A3B8", fontSize: 13 }}>Share cost per buddy (Equal Share):</Text>
                <Text style={{ color: "white", fontWeight: "bold", fontSize: 14 }}>
                  ₹{perPersonCost.toFixed(2)}
                </Text>
              </View>

              {settlements.map((set: any, idx: number) => (
                <View key={idx} style={styles.settleRow}>
                  <Text style={{ color: "white", fontWeight: "500" }}>{set.name}</Text>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={{ color: "#CBD5E1", fontSize: 11 }}>Paid: ₹{set.paid}</Text>
                    <Text
                      style={{
                        color: set.balance >= 0 ? "#22C55E" : "#EF4444",
                        fontWeight: "bold",
                        fontSize: 13,
                        marginTop: 2,
                      }}
                    >
                      {set.balance >= 0 ? `Gets back ₹${set.balance}` : `Owes ₹${Math.abs(set.balance)}`}
                    </Text>
                  </View>
                </View>
              ))}
            </View>

            {/* Expense feed list */}
            <Text style={styles.sectionTitle}>Expense Logs</Text>
            {expensesList.length > 0 ? (
              expensesList.map((exp: any, idx: number) => (
                <View key={idx} style={styles.expenseCard}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <View style={{ flex: 1, marginRight: 10 }}>
                      <Text style={{ color: "white", fontWeight: "bold", fontSize: 16 }}>
                        {exp.description}
                      </Text>
                      <Text style={{ color: "#94A3B8", fontSize: 12, marginTop: 4 }}>
                        Paid by {exp.paidBy || "Buddy"} • {exp.category}
                      </Text>
                      {exp.splitBetween && (
                        <Text style={{ color: "#38BDF8", fontSize: 11, marginTop: 4 }}>
                          Splitting: {exp.splitBetween.join(", ")}
                        </Text>
                      )}
                    </View>
                    
                    <View style={{ alignItems: "flex-end", gap: 10 }}>
                      <Text style={{ color: "#38BDF8", fontSize: 18, fontWeight: "bold" }}>
                        ₹{exp.amount}
                      </Text>
                      {exp.receiptImage ? (
                        <TouchableOpacity onPress={() => viewReceiptImage(exp.receiptImage)} style={styles.receiptIndicator}>
                          <Ionicons name="receipt-outline" size={14} color="#EAB308" />
                          <Text style={{ color: "#EAB308", fontSize: 11, fontWeight: "bold" }}>Receipt</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  </View>
                </View>
              ))
            ) : (
              <Text style={{ color: "#94A3B8", textAlign: "center", marginVertical: 20 }}>
                No expenses logged yet. Tap the button above to log receipts.
              </Text>
            )}
          </View>
        )}

        {activeTab === "members" && (
          <View style={{ marginBottom: 100 }}>
            <Text style={styles.sectionTitle}>Invitation Code</Text>
            <View style={styles.inviteCard}>
              <Text style={styles.inviteCodeBig}>{group.code}</Text>
              <Text style={styles.inviteText}>
                Share this code with your travel companions. They can enter it in their Groups screen to join this trip instantly.
              </Text>
            </View>

            <Text style={styles.sectionTitle}>Travel Buddies</Text>
            {memberList.map((m: string, idx: number) => (
              <View key={idx} style={styles.memberCard}>
                <Ionicons name="person" size={18} color="#38BDF8" style={{ marginRight: 10 }} />
                <Text style={{ color: "white", fontSize: 16, fontWeight: "600" }}>{m}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* ADD EXPENSE MODAL */}
      <Modal visible={expenseModalVisible} animationType="slide" transparent>
        <View style={styles.modalBg}>
          <ScrollView contentContainerStyle={{ paddingVertical: 40 }} showsVerticalScrollIndicator={false}>
            <View style={styles.modalContent}>
              <Text style={styles.modalHeader}>Add Shared Bill 💰</Text>

              <TextInput
                placeholder="Expense Cost in ₹"
                placeholderTextColor="#94A3B8"
                value={amount}
                onChangeText={setAmount}
                keyboardType="numeric"
                style={styles.modalInput}
              />

              <TextInput
                placeholder="Description (e.g. Goa beach lunch, Uber ride)"
                placeholderTextColor="#94A3B8"
                value={description}
                onChangeText={setDescription}
                style={styles.modalInput}
              />

              {/* Receipt Uploader */}
              <TouchableOpacity onPress={pickReceipt} style={styles.receiptUploadBtn}>
                <Ionicons name="camera-outline" size={18} color="#38BDF8" style={{ marginRight: 6 }} />
                <Text style={{ color: "#38BDF8", fontWeight: "bold" }}>
                  {receiptUri ? "Receipt Loaded ✓" : "Upload Receipt Image"}
                </Text>
              </TouchableOpacity>
              {receiptUri && (
                <View style={styles.receiptPreviewWrapper}>
                  <Image source={{ uri: receiptUri }} style={styles.receiptPreview} />
                  <TouchableOpacity onPress={() => setReceiptUri(null)} style={styles.removeReceiptBtn}>
                    <Ionicons name="close-circle" size={18} color="#EF4444" />
                  </TouchableOpacity>
                </View>
              )}

              {/* Category selection */}
              <Text style={{ color: "#CBD5E1", fontSize: 13, marginBottom: 8, marginTop: 10 }}>Category:</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", marginBottom: 15 }}>
                {["🍴 Food", "🚗 Transit", "🏨 Stay", "🎟 Tickets", "🛍 Shopping"].map((cat) => (
                  <TouchableOpacity
                    key={cat}
                    onPress={() => setCategory(cat)}
                    style={[
                      styles.catBtn,
                      category === cat ? styles.catBtnActive : styles.catBtnInactive,
                    ]}
                  >
                    <Text style={{ color: "white", fontSize: 12, fontWeight: "600" }}>{cat}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Paid By selection */}
              <Text style={{ color: "#CBD5E1", fontSize: 13, marginBottom: 8 }}>Who paid this bill?</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 15, height: 45 }}>
                {memberList.map((m: string) => (
                  <TouchableOpacity
                    key={m}
                    onPress={() => setPaidBy(m)}
                    style={[
                      styles.paidBtn,
                      paidBy === m ? styles.paidBtnActive : styles.paidBtnInactive,
                    ]}
                  >
                    <Text style={{ color: "white", fontSize: 12, fontWeight: "bold" }}>{m}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Split Checklist */}
              <Text style={{ color: "#CBD5E1", fontSize: 13, marginBottom: 8 }}>Split between whom?</Text>
              <View style={{ marginBottom: 20 }}>
                {memberList.map((m: string) => {
                  const selected = splitBetween.includes(m);
                  return (
                    <TouchableOpacity
                      key={m}
                      onPress={() => toggleSplitBuddy(m)}
                      style={styles.checkboxRow}
                    >
                      <Ionicons
                        name={selected ? "checkbox" : "square-outline"}
                        size={20}
                        color={selected ? "#38BDF8" : "#94A3B8"}
                        style={{ marginRight: 8 }}
                      />
                      <Text style={{ color: "white" }}>{m}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Dynamic split preview cost */}
              {amount.trim() && (
                <Text style={styles.splitCostText}>
                  🧮 Individual Share: ₹{(Number(amount) / (splitBetween.length || 1)).toFixed(2)} each (among {splitBetween.length} splitters)
                </Text>
              )}

              <TouchableOpacity onPress={handleAddExpense} style={styles.modalSaveBtn}>
                <Text style={{ color: "white", fontWeight: "bold", fontSize: 16 }}>Save Bill Split Receipt</Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={() => setExpenseModalVisible(false)} style={styles.modalCancelBtn}>
                <Text style={{ color: "#CBD5E1", fontWeight: "bold" }}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* EDIT ITINERARY MODAL */}
      <Modal visible={editItineraryModalVisible} animationType="slide" transparent>
        <View style={styles.modalBg}>
          <View style={styles.modalContent}>
            <Text style={styles.modalHeader}>Edit Global Itinerary Plan 🗓️</Text>

            <TextInput
              placeholder="Day Theme Title"
              placeholderTextColor="#94A3B8"
              value={dayTitle}
              onChangeText={setDayTitle}
              style={styles.modalInput}
            />

            <TextInput
              placeholder="Detailed schedule plans..."
              placeholderTextColor="#94A3B8"
              value={dayPlan}
              onChangeText={setDayPlan}
              multiline
              style={[styles.modalInput, { height: 100, textAlignVertical: "top" }]}
            />

            <TouchableOpacity onPress={handleSaveItineraryDay} style={styles.modalSaveBtn}>
              <Text style={{ color: "white", fontWeight: "bold", fontSize: 16 }}>Sync Day Schedule</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setEditItineraryModalVisible(false)} style={styles.modalCancelBtn}>
              <Text style={{ color: "#CBD5E1", fontWeight: "bold" }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* RECEIPT IMAGE VIEWER MODAL */}
      <Modal visible={receiptViewerVisible} animationType="fade" transparent>
        <View style={styles.receiptViewerBg}>
          <TouchableOpacity onPress={() => setReceiptViewerVisible(false)} style={styles.viewerCloseBtn}>
            <Ionicons name="close" size={32} color="white" />
          </TouchableOpacity>
          {viewingReceiptUrl && (
            <Image source={{ uri: viewingReceiptUrl }} style={styles.fullReceiptImg} resizeMode="contain" />
          )}
        </View>
      </Modal>
      {/* Navigation HUD Overlay — overlays entire screen when GPS navigation is active */}
      {/* Navigation HUD Overlay */}
      {showFullscreenNav && renderFullscreenNavigation()}
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
  },
  backBtn: {
    padding: 8,
  },
  deleteBtn: {
    padding: 8,
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 15,
  },
  headerTitle: {
    color: "white",
    fontSize: 20,
    fontWeight: "bold",
  },
  headerSub: {
    color: "#94A3B8",
    fontSize: 13,
    marginTop: 2,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  metaText: {
    color: "#94A3B8",
    fontWeight: "600",
  },
  codeBadge: {
    backgroundColor: "rgba(56, 189, 248, 0.15)",
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  codeText: {
    color: "#38BDF8",
    fontWeight: "bold",
    fontSize: 12,
  },
  budgetCard: {
    backgroundColor: "#1E293B",
    padding: 20,
    borderRadius: 20,
    marginBottom: 25,
    borderWidth: 1,
    borderColor: "#334155",
  },
  barBackground: {
    height: 10,
    backgroundColor: "#0F172A",
    borderRadius: 5,
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    borderRadius: 5,
  },
  budgetMessage: {
    color: "#CBD5E1",
    fontSize: 12,
    marginTop: 10,
    fontStyle: "italic",
  },
  tabBar: {
    flexDirection: "row",
    backgroundColor: "#020617",
    padding: 6,
    borderRadius: 14,
    marginBottom: 25,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
  },
  activeTabBtn: {
    backgroundColor: "#38BDF8",
  },
  sectionTitle: {
    color: "white",
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 15,
    marginTop: 10,
  },
  itineraryCard: {
    backgroundColor: "#1E293B",
    padding: 20,
    borderRadius: 16,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: "#334155",
  },
  dayDotContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  dayDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#EAB308",
    marginRight: 8,
  },
  dayNum: {
    color: "#EAB308",
    fontWeight: "bold",
    fontSize: 12,
  },
  dayTitle: {
    color: "white",
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 6,
  },
  dayPlan: {
    color: "#CBD5E1",
    fontSize: 14,
    lineHeight: 20,
  },
  addExpenseTrigger: {
    backgroundColor: "#38BDF8",
    padding: 16,
    borderRadius: 16,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 25,
  },
  settleCard: {
    backgroundColor: "#1E293B",
    padding: 20,
    borderRadius: 16,
    marginBottom: 25,
    borderWidth: 1,
    borderColor: "#334155",
  },
  settleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#334155",
    paddingTop: 10,
  },
  expenseCard: {
    backgroundColor: "#1E293B",
    padding: 16,
    borderRadius: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#334155",
  },
  inviteCard: {
    backgroundColor: "#1E293B",
    padding: 20,
    borderRadius: 16,
    alignItems: "center",
    marginBottom: 25,
    borderWidth: 1,
    borderColor: "#334155",
  },
  inviteCodeBig: {
    color: "#38BDF8",
    fontSize: 32,
    fontWeight: "bold",
    letterSpacing: 2,
    marginBottom: 10,
  },
  inviteText: {
    color: "#CBD5E1",
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
  },
  memberCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1E293B",
    padding: 16,
    borderRadius: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#334155",
  },
  modalBg: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.95)",
    justifyContent: "center",
    padding: 20,
  },
  modalContent: {
    backgroundColor: "#1E293B",
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: "#334155",
  },
  modalHeader: {
    color: "white",
    fontSize: 24,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 20,
  },
  modalInput: {
    backgroundColor: "#0F172A",
    color: "white",
    padding: 16,
    borderRadius: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#334155",
  },
  catBtn: {
    width: "48%",
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
    marginBottom: 10,
  },
  catBtnActive: {
    backgroundColor: "#38BDF8",
  },
  catBtnInactive: {
    backgroundColor: "#0F172A",
    borderWidth: 1,
    borderColor: "#334155",
  },
  paidBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    marginRight: 10,
    justifyContent: "center",
    height: 40,
  },
  paidBtnActive: {
    backgroundColor: "#38BDF8",
  },
  paidBtnInactive: {
    backgroundColor: "#0F172A",
    borderWidth: 1,
    borderColor: "#334155",
  },
  modalSaveBtn: {
    backgroundColor: "#38BDF8",
    padding: 16,
    borderRadius: 14,
    marginBottom: 12,
    alignItems: "center",
  },
  modalCancelBtn: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#334155",
    alignItems: "center",
  },
  dayPill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 10,
    borderWidth: 1,
  },
  dayPillActive: {
    backgroundColor: "#38BDF8",
    borderColor: "#38BDF8",
  },
  dayPillInactive: {
    backgroundColor: "#1E293B",
    borderColor: "#334155",
  },
  dayPillText: {
    color: "white",
    fontWeight: "bold",
    fontSize: 13,
  },
  mapWrapper: {
    height: 260,
    borderRadius: 20,
    overflow: "hidden",
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#334155",
  },
  miniMap: {
    flex: 1,
  },
  mapMarker: {
    alignItems: "center",
    justifyContent: "center",
  },
  markerNumBadge: {
    position: "absolute",
    top: 0,
    backgroundColor: "#1E293B",
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "white",
  },
  timelineItem: {
    flexDirection: "row",
    marginBottom: 15,
  },
  timelinePoint: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#38BDF8",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 15,
    marginTop: 4,
  },
  timelineContent: {
    flex: 1,
    backgroundColor: "#1E293B",
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#334155",
  },
  timelineTitle: {
    color: "white",
    fontWeight: "bold",
    fontSize: 14,
  },
  timelineAddress: {
    color: "#CBD5E1",
    fontSize: 12,
    marginTop: 4,
  },
  ownerBuilderCard: {
    backgroundColor: "#1E293B",
    borderRadius: 16,
    padding: 16,
    marginTop: 20,
    borderWidth: 1,
    borderColor: "#38BDF8",
  },
  builderTitle: {
    color: "white",
    fontWeight: "bold",
    fontSize: 15,
    marginBottom: 12,
  },
  searchRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 10,
  },
  builderSearchInput: {
    flex: 1,
    backgroundColor: "#0F172A",
    color: "white",
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#334155",
    fontSize: 14,
  },
  builderSearchBtn: {
    backgroundColor: "#38BDF8",
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  builderSearchResultItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#0F172A",
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#334155",
  },
  receiptUploadBtn: {
    backgroundColor: "rgba(56, 189, 248, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.3)",
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    marginBottom: 12,
  },
  receiptPreviewWrapper: {
    position: "relative",
    width: "100%",
    height: 120,
    borderRadius: 12,
    overflow: "hidden",
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#334155",
  },
  receiptPreview: {
    width: "100%",
    height: "100%",
  },
  removeReceiptBtn: {
    position: "absolute",
    top: 6,
    right: 6,
    zIndex: 10,
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
  },
  splitCostText: {
    color: "#EAB308",
    fontSize: 13,
    fontWeight: "bold",
    marginBottom: 16,
  },
  receiptIndicator: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(234, 179, 8, 0.12)",
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(234, 179, 8, 0.3)",
  },
  receiptViewerBg: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.95)",
    alignItems: "center",
    justifyContent: "center",
  },
  viewerCloseBtn: {
    position: "absolute",
    top: 50,
    right: 20,
    padding: 10,
    zIndex: 10,
  },
  fullReceiptImg: {
    width: "90%",
    height: "80%",
  },
  routeSummaryCard: {
    backgroundColor: "#1E293B",
    borderRadius: 16,
    padding: 18,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "rgba(56,189,248,0.25)",
  },
  navBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#38BDF8",
    paddingVertical: 16,
    borderRadius: 16,
    marginTop: 16,
    marginBottom: 8,
    shadowColor: "#38BDF8",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  navHUD: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 500,
    elevation: 500,
  },
  navHUDInner: {
    backgroundColor: "#020617",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 34,
    borderTopWidth: 2,
    borderTopColor: "#38BDF8",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
  },
  navHUDTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 14,
  },
  navHUDLabel: {
    color: "#38BDF8",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    marginBottom: 4,
  },
  navHUDDest: {
    color: "white",
    fontSize: 20,
    fontWeight: "bold",
    lineHeight: 26,
  },
  navHUDDistance: {
    color: "#94A3B8",
    fontSize: 14,
    marginTop: 4,
  },
  navHUDCloseBtn: {
    padding: 4,
    marginLeft: 12,
    marginTop: 4,
  },
  navHUDStats: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 16,
  },
  navHUDStat: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1E293B",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    gap: 6,
    borderWidth: 1,
    borderColor: "#334155",
  },
  navHUDStatText: {
    color: "#CBD5E1",
    fontSize: 13,
    fontWeight: "600",
  },
  navNextBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#38BDF8",
    paddingVertical: 14,
    borderRadius: 14,
  },
  navNextBtnText: {
    color: "white",
    fontWeight: "bold",
    fontSize: 15,
  },
  arrivalToast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(34,197,94,0.15)",
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(34,197,94,0.4)",
  },
  arrivalToastText: {
    color: "#22C55E",
    fontWeight: "bold",
    fontSize: 14,
    flex: 1,
  },
  navigatorMarker: {
    alignItems: "center",
    justifyContent: "center",
    width: 36,
    height: 36,
  },
  navigatorBadge: {
    position: "absolute",
    top: -4,
    backgroundColor: "#22C55E",
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "white",
  },
  guidanceCard: {
    position: "absolute",
    top: 50,
    left: 20,
    right: 20,
    backgroundColor: "#065F46",
    borderRadius: 16,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: "#059669",
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    zIndex: 600,
  },
  guidanceIconContainer: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  guidanceInstruction: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
  },
  guidanceRoad: {
    color: "#A7F3D0",
    fontSize: 13,
    marginTop: 2,
  },
  guidanceStepDist: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
    textAlign: "right",
    marginLeft: 6,
  },
  navHUDOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#020617",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 34,
    borderTopWidth: 2,
    borderTopColor: "#38BDF8",
    elevation: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    zIndex: 600,
  },
  navProgressBar: {
    height: 6,
    backgroundColor: "#1E293B",
    borderRadius: 3,
    overflow: "hidden",
    marginBottom: 16,
  },
  navProgressFill: {
    height: "100%",
    backgroundColor: "#22C55E",
    borderRadius: 3,
  },
  hudRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  hudEta: {
    color: "white",
    fontSize: 22,
    fontWeight: "bold",
  },
  hudDist: {
    color: "#CBD5E1",
    fontSize: 13,
    marginTop: 4,
  },
  hudStopBtn: {
    backgroundColor: "#EF4444",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  hudNextBtn: {
    backgroundColor: "#38BDF8",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  chatHeaderBtn: {
    backgroundColor: "#1E293B",
    padding: 8,
    borderRadius: 12,
    position: "relative",
  },
  unreadBadgeDot: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#EF4444",
    borderWidth: 1.5,
    borderColor: "#1E293B",
  },
});

