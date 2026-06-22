import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from "react-native";
import { getFirestore, doc, getDoc } from "firebase/firestore";
import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import * as Location from "expo-location";
import app from "../../firebaseConfig";

// Conditionally require react-native-maps to prevent web runtime failures
let MapView: any = null;
let Marker: any = null;
let Polyline: any = null;

if (Platform.OS !== "web") {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const RNMaps = require("react-native-maps");
    MapView = RNMaps.default || RNMaps;
    Marker = RNMaps.Marker;
    Polyline = RNMaps.Polyline;
  } catch (e) {
    console.log("Could not require react-native-maps:", e);
  }
}

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

const formatDuration = (seconds: number): string => {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} mins`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs} hr ${rem} mins` : `${hrs} hr`;
};

export default function RouteDetailScreen() {
  const { routeId } = useLocalSearchParams<{ routeId: string }>();
  const router = useRouter();
  const db = getFirestore(app);

  const [routeData, setRouteData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mapRef = useRef<any>(null);
  const [isNavigating, setIsNavigating] = useState(false);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationWatcher, setLocationWatcher] = useState<any>(null);
  const [navRemDistM, setNavRemDistM] = useState<number>(0);
  const [navRemDurS, setNavRemDurS] = useState<number>(0);
  const [navProgress, setNavProgress] = useState<number>(0);
  const [navNextStop, setNavNextStop] = useState<string>("");
  const [activeStopIndex, setActiveStopIndex] = useState<number>(0);
  const [routeCoords, setRouteCoords] = useState<{ latitude: number; longitude: number }[]>([]);
  const [routeSteps, setRouteSteps] = useState<any[]>([]);
  const [routeDistanceM, setRouteDistanceM] = useState<number>(0);
  const [routeDurationS, setRouteDurationS] = useState<number>(0);
  const [routeStats, setRouteStats] = useState<{ distance: string; duration: string } | null>(null);

  const fetchOSRMRoute = async (stopsList: any[], startLoc?: any) => {
    const all = [];
    if (startLoc) {
      all.push(startLoc);
    }
    all.push(...stopsList);
    if (all.length < 2) return;
    try {
      const coordsString = all
        .map((item) => `${item.longitude || item.lon},${item.latitude || item.lat}`)
        .join(";");
      const res = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${coordsString}?overview=full&geometries=geojson&steps=true`
      );
      const data = await res.json();
      if (data.routes?.length > 0) {
        const route = data.routes[0];
        const computedCoords = route.geometry.coordinates.map((c: any) => ({
          latitude: c[1],
          longitude: c[0],
        }));
        setRouteCoords(computedCoords);
        setRouteDistanceM(route.distance);
        setRouteDurationS(route.duration);
        setRouteStats({
          distance: (route.distance / 1000).toFixed(1),
          duration: formatDuration(route.duration),
        });

        const allSteps: any[] = [];
        if (route.legs) {
          route.legs.forEach((leg: any) => {
            if (leg.steps) {
              allSteps.push(...leg.steps);
            }
          });
        }
        setRouteSteps(allSteps);
      }
    } catch (e) {
      console.log("Error loading OSRM route details:", e);
    }
  };

  useEffect(() => {
    if (routeData) {
      const stopsList = routeData.stops || routeData.items || [];
      const startCoord = routeData.startCoordinates;
      const startLoc = startCoord ? {
        latitude: startCoord.latitude,
        longitude: startCoord.longitude,
      } : null;
      fetchOSRMRoute(stopsList, startLoc);
    }
  }, [routeData]);

  const startNavigation = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      alert("Location permission is required for real-time navigation.");
      return;
    }

    setIsNavigating(true);
    setNavProgress(0);
    setActiveStopIndex(0);

    const stopsList = routeData?.stops || routeData?.items || [];
    if (stopsList.length > 0) {
      setNavNextStop(stopsList[0].name);
    }

    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const pos = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setUserLocation(pos);

      await fetchOSRMRoute(stopsList, pos);

      // Pan map camera initially
      setTimeout(() => {
        mapRef.current?.animateToRegion(
          { latitude: pos.latitude, longitude: pos.longitude, latitudeDelta: 0.015, longitudeDelta: 0.015 },
          1000
        );
      }, 500);

      const watcher = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 10 },
        async (currentLoc) => {
          const uPos = {
            latitude: currentLoc.coords.latitude,
            longitude: currentLoc.coords.longitude,
          };
          setUserLocation(uPos);

          if (routeCoords.length < 2) return;

          let minDist = Infinity;
          let closestIdx = 0;
          for (let i = 0; i < routeCoords.length - 1; i++) {
            const d = pointToSegmentDist(
              uPos.latitude, uPos.longitude,
              routeCoords[i].latitude, routeCoords[i].longitude,
              routeCoords[i + 1].latitude, routeCoords[i + 1].longitude
            );
            if (d < minDist) { minDist = d; closestIdx = i; }
          }

          const REROUTE_THRESHOLD_KM = 0.15;
          const currentStopIdx = activeStopIndex;
          if (minDist > REROUTE_THRESHOLD_KM) {
            console.log("User off-route, recalculating...");
            const remaining = stopsList.slice(currentStopIdx);
            await fetchOSRMRoute(remaining, uPos);
            return;
          }

          let remDist = 0;
          for (let i = closestIdx; i < routeCoords.length - 1; i++) {
            remDist += haversineKm(
              routeCoords[i].latitude, routeCoords[i].longitude,
              routeCoords[i + 1].latitude, routeCoords[i + 1].longitude
            ) * 1000;
          }
          remDist += minDist * 1000;

          const totalStops = stopsList.length;
          const segmentProgress = Math.max(0, Math.min(1, 1 - remDist / Math.max(routeDistanceM, 1)));
          const progress = (currentStopIdx + segmentProgress) / Math.max(totalStops, 1);
          setNavProgress(Math.min(1, Math.max(0, progress)));
          setNavRemDistM(Math.max(0, remDist));

          const remFrac = remDist / Math.max(routeDistanceM, 1);
          setNavRemDurS(Math.max(0, routeDurationS * remFrac));

          mapRef.current?.animateToRegion(
            { latitude: uPos.latitude, longitude: uPos.longitude, latitudeDelta: 0.015, longitudeDelta: 0.015 },
            800
          );

          const targetStop = stopsList[currentStopIdx];
          if (targetStop) {
            const distToStopKm = haversineKm(
              uPos.latitude, uPos.longitude,
              targetStop.latitude || targetStop.lat,
              targetStop.longitude || targetStop.lon
            );

            if (distToStopKm < 0.05) {
              if (currentStopIdx === stopsList.length - 1) {
                if (watcher) watcher.remove();
                setLocationWatcher(null);
                setIsNavigating(false);
                setUserLocation(null);
                alert("🎉 You have reached your final destination!");
              } else {
                const nextIdx = currentStopIdx + 1;
                setActiveStopIndex(nextIdx);
                setNavNextStop(stopsList[nextIdx].name);
                alert(`📍 Stop Reached: You reached "${targetStop.name}"!`);
                const remaining = stopsList.slice(nextIdx);
                await fetchOSRMRoute(remaining, uPos);
              }
            }
          }
        }
      );
      setLocationWatcher(watcher);
    } catch (e) {
      console.log("Error starting navigation:", e);
    }
  };

  const stopNavigation = () => {
    if (locationWatcher) {
      locationWatcher.remove();
      setLocationWatcher(null);
    }
    setIsNavigating(false);
    setUserLocation(null);
    setNavProgress(0);
    setActiveStopIndex(0);
  };

  useEffect(() => {
    return () => {
      if (locationWatcher) {
        locationWatcher.remove();
      }
    };
  }, [locationWatcher]);

  const getTurnIcon = (modifier: string) => {
    if (!modifier) return "arrow-up-outline";
    const mod = modifier.toLowerCase();
    if (mod.includes("left")) return "arrow-undo-outline";
    if (mod.includes("right")) return "arrow-redo-outline";
    if (mod.includes("straight")) return "arrow-up-outline";
    return "arrow-up-outline";
  };

  const getCurrentStep = () => {
    if (!routeSteps || routeSteps.length === 0) return null;
    let coveredDist = 0;
    if (routeDistanceM !== null && navRemDistM !== null) {
      coveredDist = Math.max(0, routeDistanceM - navRemDistM);
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


  const loadRoute = useCallback(async () => {
    try {
      const docRef = doc(db, "routes", routeId);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        setRouteData(snap.data());
      } else {
        setError("Route Not Found");
      }
    } catch (e) {
      console.log("Error loading shared route:", e);
      setError("Failed to retrieve route details due to database error.");
    } finally {
      setLoading(false);
    }
  }, [db, routeId]);

  useEffect(() => {
    if (!routeId) {
      setError("No Route ID provided.");
      setLoading(false);
      return;
    }
    loadRoute();
  }, [routeId, loadRoute]);

  const handleOpenApp = () => {
    const url = `tripsync://map?routeId=${routeId}`;
    Linking.openURL(url).catch(() => {
      alert("Please ensure the TripSync app is installed on your mobile device to open this route.");
    });
  };

  if (loading) {
    return (
      <View style={styles.centeredContainer}>
        <ActivityIndicator size="large" color="#38BDF8" />
        <Text style={styles.loadingText}>Retrieving shared travel route...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centeredContainer}>
        <View style={styles.errorIconCircle}>
          <Ionicons name="alert-circle-outline" size={48} color="#EF4444" />
        </View>
        <Text style={styles.errorTitle}>{error}</Text>
        <Text style={styles.errorSubtitle}>
          {error === "Route Not Found"
            ? "The route link you opened might be broken or the owner may have removed it."
            : "Check your internet connection and try reloading the page."}
        </Text>
        <TouchableOpacity style={styles.actionButton} onPress={() => router.replace("/login")}>
          <Text style={styles.actionButtonText}>Back to Home 🏠</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const stops = routeData?.stops || routeData?.items || [];
  const coords = routeData?.routeCoordinates || routeData?.coords || [];
  const routeName = routeData?.routeName || routeData?.name || "Custom Travel Route";

  // Calculate OSM embed box
  const getOsmUrl = () => {
    if (stops.length === 0) return "";
    const lats = stops.map((s: any) => s.latitude || s.lat);
    const lons = stops.map((s: any) => s.longitude || s.lon);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    const margin = 0.012; // margin around bbox
    return `https://www.openstreetmap.org/export/embed.html?bbox=${minLon - margin}%2C${minLat - margin}%2C${maxLon + margin}%2C${maxLat + margin}&layer=mapnik&marker=${lats[0]}%2C${lons[0]}`;
  };

  if (isNavigating) {
    const currentPins = stops;
    const activeDest = currentPins[activeStopIndex];
    const activeStepInfo = getCurrentStep();
    const navDistStr =
      navRemDistM < 1000
        ? `${Math.round(navRemDistM)} m`
        : `${(navRemDistM / 1000).toFixed(1)} km`;
    const navEtaStr = formatDuration(navRemDurS);

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
            latitude: userLocation?.latitude || activeDest?.latitude || 12.9716,
            longitude: userLocation?.longitude || activeDest?.longitude || 77.5946,
            latitudeDelta: 0.015,
            longitudeDelta: 0.015,
          }}
        >
          {currentPins.map((pin: any, idx: number) => (
            <Marker
              key={`nav-pin-${idx}`}
              coordinate={{
                latitude: pin.latitude || pin.lat,
                longitude: pin.longitude || pin.lon,
              }}
              title={pin.name}
            >
              <View style={styles.mapMarker}>
                <Ionicons name="pin" size={24} color={idx === activeStopIndex ? "#EAB308" : "#38BDF8"} />
                <View style={styles.markerNumBadge}>
                  <Text style={{ color: "white", fontSize: 9, fontWeight: "bold" }}>{idx + 1}</Text>
                </View>
              </View>
            </Marker>
          ))}
          {routeCoords.length > 0 && (
            <Polyline
              coordinates={routeCoords}
              strokeWidth={6}
              strokeColor="#22C55E"
            />
          )}
        </MapView>

        {/* Top Guidance Card */}
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

        {/* Bottom HUD Card */}
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
              <TouchableOpacity onPress={stopNavigation} style={styles.hudStopBtn}>
                <Ionicons name="stop-circle" size={18} color="white" />
                <Text style={{ color: "white", fontWeight: "bold", fontSize: 13, marginLeft: 4 }}>End</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
      {/* Top Header Panel */}
      <View style={styles.header}>
        <View style={styles.logoRow}>
          <Text style={styles.logoEmoji}>✈️</Text>
          <Text style={styles.logoText}>TripSync</Text>
        </View>
        <Text style={styles.sharedLabel}>SHARED TRIP ROUTE</Text>
      </View>

      <View style={styles.mainLayout}>
        {/* Left column / Top details */}
        <View style={styles.detailsColumn}>
          <View style={styles.card}>
            <View style={styles.titleRow}>
              <Ionicons name="map" size={24} color="#38BDF8" />
              <Text style={styles.routeNameText}>{routeName}</Text>
            </View>
            <Text style={styles.routeDesc}>
              Start Stop: <Text style={{ color: "white", fontWeight: "600" }}>{routeData.startLocation || "Current Location"}</Text>
            </Text>

            {/* Quick Metrics */}
            <View style={styles.metricsGrid}>
              <View style={styles.metricCell}>
                <Ionicons name="location-outline" size={18} color="#38BDF8" />
                <Text style={styles.metricVal}>{stops.length} Stops</Text>
                <Text style={styles.metricLabel}>Total stops</Text>
              </View>
              <View style={styles.metricCell}>
                <Ionicons name="speedometer-outline" size={18} color="#22C55E" />
                <Text style={styles.metricVal}>{routeData.totalDistance || "N/A"}</Text>
                <Text style={styles.metricLabel}>Distance</Text>
              </View>
              <View style={styles.metricCell}>
                <Ionicons name="time-outline" size={18} color="#EAB308" />
                <Text style={styles.metricVal}>{routeData.totalDuration || "N/A"}</Text>
                <Text style={styles.metricLabel}>Est. Duration</Text>
              </View>
            </View>
          </View>

          {/* Stops List */}
          <Text style={styles.sectionTitle}>📍 Journey stops</Text>
          <View style={styles.stopsTimeline}>
            {/* Start Location Node */}
            <View style={styles.timelineNode}>
              <View style={styles.connectorContainer}>
                <View style={[styles.timelinePin, { backgroundColor: "#22C55E" }]}>
                  <Ionicons name="home" size={12} color="white" />
                </View>
                <View style={styles.timelineLine} />
              </View>
              <View style={styles.timelineInfoCard}>
                <Text style={styles.stopNameText}>Start: {routeData.startLocation || "Current Location"}</Text>
                <Text style={styles.stopAddressText}>Origin Point</Text>
              </View>
            </View>

            {/* Stop items */}
            {stops.map((stop: any, idx: number) => (
              <View key={idx} style={styles.timelineNode}>
                <View style={styles.connectorContainer}>
                  <View style={styles.timelinePin}>
                    <Text style={styles.pinNumberText}>{idx + 1}</Text>
                  </View>
                  {idx < stops.length - 1 && <View style={styles.timelineLine} />}
                </View>
                <View style={styles.timelineInfoCard}>
                  <Text style={styles.stopNameText}>{stop.name}</Text>
                  <Text style={styles.stopAddressText}>{stop.address || "No address details available"}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* Right column / Bottom Map Preview */}
        <View style={styles.mapColumn}>
          <Text style={styles.sectionTitle}>🗺️ Route Preview</Text>
          <View style={styles.mapCard}>
            {Platform.OS === "web" ? (
              // Embed OSM Map for Web client
              <iframe
                src={getOsmUrl()}
                style={styles.webMapFrame}
                title="OSM Map Preview"
              />
            ) : MapView ? (
              // Render react-native-maps on Mobile
              <MapView
                ref={mapRef}
                style={styles.nativeMap}
                initialRegion={{
                  latitude: stops[0]?.latitude || stops[0]?.lat || 12.9716,
                  longitude: stops[0]?.longitude || stops[0]?.lon || 77.5946,
                  latitudeDelta: 0.06,
                  longitudeDelta: 0.06,
                }}
                showsUserLocation={false}
                zoomEnabled={true}
              >
                {stops.map((stop: any, index: number) => (
                  <Marker
                    key={index}
                    coordinate={{
                      latitude: stop.latitude || stop.lat,
                      longitude: stop.longitude || stop.lon,
                    }}
                    title={stop.name}
                  />
                ))}
                {coords.length > 0 && (
                  <Polyline
                    coordinates={coords.map((c: any) => ({
                      latitude: c.latitude,
                      longitude: c.longitude,
                    }))}
                    strokeWidth={4}
                    strokeColor="#38BDF8"
                  />
                )}
              </MapView>
            ) : (
              <View style={styles.centeredContainer}>
                <Ionicons name="map-outline" size={36} color="#475569" />
                <Text style={{ color: "#94A3B8", marginTop: 8 }}>Preview unavailable</Text>
              </View>
            )}
          </View>

          {/* Action CTA button */}
          {Platform.OS !== "web" ? (
            <TouchableOpacity style={[styles.openAppBtn, { backgroundColor: "#10B981", shadowColor: "#10B981" }]} onPress={startNavigation}>
              <Ionicons name="navigate-circle-outline" size={20} color="white" />
              <Text style={styles.openAppBtnText}>Start Navigation 🧭</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.openAppBtn} onPress={handleOpenApp}>
              <Ionicons name="phone-portrait-outline" size={20} color="white" />
              <Text style={styles.openAppBtnText}>Open in TripSync App 📱</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0F172A",
  },
  contentContainer: {
    padding: 24,
    maxWidth: 1200,
    alignSelf: "center",
    width: "100%",
    paddingBottom: 100,
  },
  centeredContainer: {
    flex: 1,
    backgroundColor: "#0F172A",
    justifyContent: "center",
    alignItems: "center",
    padding: 30,
    minHeight: 400,
  },
  loadingText: {
    color: "#94A3B8",
    fontSize: 16,
    marginTop: 16,
    fontWeight: "500",
  },
  errorIconCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: "rgba(239,68,68,0.12)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
    borderWidth: 1.5,
    borderColor: "rgba(239,68,68,0.3)",
  },
  errorTitle: {
    color: "white",
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 10,
  },
  errorSubtitle: {
    color: "#94A3B8",
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 30,
    maxWidth: 400,
  },
  actionButton: {
    backgroundColor: "#38BDF8",
    paddingHorizontal: 26,
    paddingVertical: 14,
    borderRadius: 12,
  },
  actionButtonText: {
    color: "white",
    fontWeight: "bold",
    fontSize: 15,
  },
  header: {
    borderBottomWidth: 1,
    borderBottomColor: "#1E293B",
    paddingBottom: 18,
    marginBottom: 28,
  },
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  logoEmoji: {
    fontSize: 28,
  },
  logoText: {
    color: "white",
    fontSize: 24,
    fontWeight: "bold",
    letterSpacing: 0.5,
  },
  sharedLabel: {
    color: "#38BDF8",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.5,
  },
  mainLayout: {
    flexDirection: Platform.OS === "web" ? "row" : "column",
    gap: 32,
  },
  detailsColumn: {
    flex: 1.2,
  },
  mapColumn: {
    flex: 1,
    minWidth: Platform.OS === "web" ? 380 : "100%",
  },
  card: {
    backgroundColor: "#1E293B",
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: "#334155",
    marginBottom: 25,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 10,
  },
  routeNameText: {
    color: "white",
    fontSize: 22,
    fontWeight: "bold",
    flex: 1,
  },
  routeDesc: {
    color: "#94A3B8",
    fontSize: 14,
    marginBottom: 20,
  },
  metricsGrid: {
    flexDirection: "row",
    gap: 12,
  },
  metricCell: {
    flex: 1,
    backgroundColor: "#0F172A",
    borderRadius: 14,
    padding: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#1E293B",
  },
  metricVal: {
    color: "white",
    fontWeight: "bold",
    fontSize: 15,
    marginTop: 6,
  },
  metricLabel: {
    color: "#64748B",
    fontSize: 11,
    marginTop: 2,
    fontWeight: "500",
  },
  sectionTitle: {
    color: "white",
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 16,
  },
  stopsTimeline: {
    paddingLeft: 4,
  },
  timelineNode: {
    flexDirection: "row",
    marginBottom: 0,
  },
  connectorContainer: {
    alignItems: "center",
    marginRight: 16,
    width: 32,
  },
  timelinePin: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#38BDF8",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1,
  },
  pinNumberText: {
    color: "white",
    fontWeight: "bold",
    fontSize: 12,
  },
  timelineLine: {
    width: 2,
    flex: 1,
    backgroundColor: "#334155",
    marginVertical: 4,
    minHeight: 32,
  },
  timelineInfoCard: {
    flex: 1,
    backgroundColor: "#1E293B",
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#334155",
  },
  stopNameText: {
    color: "white",
    fontSize: 15,
    fontWeight: "bold",
  },
  stopAddressText: {
    color: "#94A3B8",
    fontSize: 12,
    marginTop: 4,
  },
  mapCard: {
    backgroundColor: "#1E293B",
    borderRadius: 20,
    height: 350,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#334155",
    marginBottom: 16,
  },
  webMapFrame: {
    width: "100%",
    height: "100%",
    borderWidth: 0,
  },
  nativeMap: {
    width: "100%",
    height: "100%",
  },
  openAppBtn: {
    backgroundColor: "#22C55E",
    padding: 16,
    borderRadius: 14,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    shadowColor: "#22C55E",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  openAppBtnText: {
    color: "white",
    fontWeight: "bold",
    fontSize: 16,
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
  mapMarker: {
    alignItems: "center",
    justifyContent: "center",
    width: 32,
    height: 32,
  },
  markerNumBadge: {
    position: "absolute",
    top: -2,
    backgroundColor: "#1E293B",
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "white",
  },
});
