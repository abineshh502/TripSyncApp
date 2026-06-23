import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useState, useEffect } from "react";
import { router } from "expo-router";
import {
  getFirestore,
  collection,
  onSnapshot,
  deleteDoc,
  doc,
  query,
  orderBy,
  where,
} from "firebase/firestore";
import { Ionicons } from "@expo/vector-icons";
import app, { auth } from "../../firebaseConfig";

type TripStatus = "active" | "upcoming" | "completed";

const parseDate = (dateStr: string): Date | null => {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
};

const getTripStatus = (trip: any): TripStatus => {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const start = parseDate(trip.startDate);
  const end = parseDate(trip.endDate);
  if (!start || !end) return "upcoming";
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 0);
  if (now > end) return "completed";
  if (now >= start) return "active";
  return "upcoming";
};

const STATUS_CONFIG = {
  active: {
    label: "Active 🚀",
    color: "#22C55E",
    bg: "rgba(34,197,94,0.12)",
    border: "rgba(34,197,94,0.3)",
  },
  upcoming: {
    label: "Upcoming 🗓",
    color: "#EAB308",
    bg: "rgba(234,179,8,0.12)",
    border: "rgba(234,179,8,0.3)",
  },
  completed: {
    label: "Completed ✅",
    color: "#38BDF8",
    bg: "rgba(56,189,248,0.12)",
    border: "rgba(56,189,248,0.3)",
  },
};

export default function TripsScreen() {
  const db = getFirestore(app);
  const [trips, setTrips] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | TripStatus>("all");

  useEffect(() => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      setLoading(false);
      return;
    }
    const q = query(
      collection(db, "trips"),
      where("userId", "==", currentUser.uid)
    );
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const temp: any[] = [];
        snapshot.forEach((d) => temp.push({ id: d.id, ...d.data() }));
        temp.sort((a, b) => {
          const tA = a.createdAt?.seconds || a.createdAt || 0;
          const tB = b.createdAt?.seconds || b.createdAt || 0;
          return tB - tA;
        });
        setTrips(temp);
        setLoading(false);
      },
      (err) => {
        console.log("Trips error:", err);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  const tripsWithStatus = trips.map((t) => ({ ...t, status: getTripStatus(t) }));
  const filtered =
    filter === "all" ? tripsWithStatus : tripsWithStatus.filter((t) => t.status === filter);
  const counts = {
    all: tripsWithStatus.length,
    active: tripsWithStatus.filter((t) => t.status === "active").length,
    upcoming: tripsWithStatus.filter((t) => t.status === "upcoming").length,
    completed: tripsWithStatus.filter((t) => t.status === "completed").length,
  };

  const getProgress = (trip: any) => {
    const start = parseDate(trip.startDate);
    const end = parseDate(trip.endDate);
    if (!start || !end) return 0;
    const now = new Date();
    const total = end.getTime() - start.getTime();
    const elapsed = now.getTime() - start.getTime();
    return Math.min(1, Math.max(0, elapsed / total));
  };

  const handleDelete = (id: string, name: string) => {
    Alert.alert("Delete Trip", `Remove "${name}" permanently?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteDoc(doc(db, "trips", id));
          } catch (e) {
            Alert.alert("Error", "Could not delete trip.");
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>My Trips ✈️</Text>
          <Text style={styles.headerSub}>{counts.all} total adventures</Text>
        </View>
        <TouchableOpacity
          testID="new-trip-button"
          accessibilityLabel="new-trip-button"
          onPress={() => router.push("/create-trip")}
          style={styles.createBtn}
        >
          <Ionicons name="add" size={22} color="white" />
          <Text style={styles.createBtnText}>New Trip</Text>
        </TouchableOpacity>
      </View>

      {/* Filter Tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}
        contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 14, gap: 10 }}
      >
        {(["all", "active", "upcoming", "completed"] as const).map((f) => {
          const isActive = filter === f;
          const cfg = f !== "all" ? STATUS_CONFIG[f] : null;
          return (
            <TouchableOpacity
              testID={`trips-filter-${f}`}
              accessibilityLabel={`trips-filter-${f}`}
              key={f}
              onPress={() => setFilter(f)}
              style={[
                styles.filterTab,
                isActive && {
                  backgroundColor: cfg ? cfg.bg : "rgba(56,189,248,0.1)",
                  borderColor: cfg ? cfg.border : "rgba(56,189,248,0.4)",
                },
              ]}
            >
              <Text
                style={[
                  styles.filterTabText,
                  isActive && { color: cfg ? cfg.color : "#38BDF8", fontWeight: "700" },
                ]}
              >
                {f === "all" ? "🌐 All" : cfg!.label}
              </Text>
              <View
                style={[
                  styles.filterCount,
                  isActive && { backgroundColor: cfg ? cfg.color : "#38BDF8" },
                ]}
              >
                <Text style={styles.filterCountText}>{counts[f]}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Trips List */}
      <ScrollView
        style={styles.list}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 20, paddingBottom: 120 }}
      >
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#38BDF8" />
            <Text style={styles.loadingText}>Loading your trips...</Text>
          </View>
        ) : filtered.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="briefcase-outline" size={60} color="#334155" />
            <Text style={styles.emptyTitle}>
              No {filter === "all" ? "" : STATUS_CONFIG[filter as TripStatus].label.split(" ")[0]} trips yet
            </Text>
            <Text style={styles.emptySubtitle}>
              {filter === "all"
                ? "Start planning your first adventure!"
                : `No ${filter} trips at the moment.`}
            </Text>
            {filter === "all" && (
              <TouchableOpacity
                onPress={() => router.push("/create-trip")}
                style={styles.emptyBtn}
              >
                <Text style={styles.emptyBtnText}>Plan Your First Trip ✈️</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          filtered.map((trip) => {
            const statusCfg = STATUS_CONFIG[trip.status as TripStatus];
            const progress = trip.status === "active" ? getProgress(trip) : 0;
            const dayCount = trip.days ? trip.days.length : null;

            return (
              <TouchableOpacity
                key={trip.id}
                onPress={() =>
                  router.push({
                    pathname: "/trip-details",
                    params: {
                      id: trip.id,
                      tripName: trip.tripName,
                      destination: trip.destination,
                      budget: trip.budget,
                      startDate: trip.startDate,
                      endDate: trip.endDate,
                    },
                  })
                }
                style={styles.tripCard}
                activeOpacity={0.88}
              >
                {/* Top row: status + edit/delete */}
                <View style={styles.cardTopRow}>
                  <View
                    style={[
                      styles.statusBadge,
                      { backgroundColor: statusCfg.bg, borderColor: statusCfg.border },
                    ]}
                  >
                    <Text style={[styles.statusText, { color: statusCfg.color }]}>
                      {statusCfg.label}
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <TouchableOpacity
                      onPress={() =>
                        router.push({
                          pathname: "/edit-trip",
                          params: {
                            id: trip.id,
                            tripName: trip.tripName,
                            destination: trip.destination,
                            budget: trip.budget,
                            startDate: trip.startDate,
                            endDate: trip.endDate,
                          },
                        })
                      }
                      style={styles.iconBtn}
                    >
                      <Ionicons name="create-outline" size={18} color="#38BDF8" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleDelete(trip.id, trip.tripName)}
                      style={[styles.iconBtn, { backgroundColor: "rgba(239,68,68,0.1)" }]}
                    >
                      <Ionicons name="trash-outline" size={18} color="#EF4444" />
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Trip Name */}
                <Text style={styles.tripName}>{trip.tripName}</Text>
                <Text style={styles.tripDestination}>📍 {trip.destination}</Text>

                {/* Dates & Budget */}
                <View style={styles.metaGrid}>
                  <View style={styles.metaItem}>
                    <Ionicons name="calendar-outline" size={14} color="#64748B" />
                    <Text style={styles.metaText}>
                      {trip.startDate || "—"} → {trip.endDate || "—"}
                    </Text>
                  </View>
                  <View style={styles.metaItem}>
                    <Ionicons name="wallet-outline" size={14} color="#64748B" />
                    <Text style={styles.metaText}>₹ {trip.budget || "—"}</Text>
                  </View>
                  {dayCount !== null && (
                    <View style={styles.metaItem}>
                      <Ionicons name="list-outline" size={14} color="#64748B" />
                      <Text style={[styles.metaText, { color: "#38BDF8" }]}>
                        {dayCount} day{dayCount !== 1 ? "s" : ""} planned
                      </Text>
                    </View>
                  )}
                </View>

                {/* Progress bar for active trips */}
                {trip.status === "active" && (
                  <View style={styles.progressContainer}>
                    <View style={styles.progressTrack}>
                      <View
                        style={[
                          styles.progressFill,
                          { width: `${Math.round(progress * 100)}%` },
                        ]}
                      />
                    </View>
                    <Text style={styles.progressText}>
                      {Math.round(progress * 100)}% trip completed
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0F172A" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 55,
    paddingBottom: 16,
    backgroundColor: "#020617",
    borderBottomWidth: 1,
    borderBottomColor: "#1E293B",
  },
  headerTitle: { color: "white", fontSize: 28, fontWeight: "bold" },
  headerSub: { color: "#94A3B8", fontSize: 13, marginTop: 2 },
  createBtn: {
    backgroundColor: "#38BDF8",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
    gap: 6,
    shadowColor: "#38BDF8",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  createBtnText: { color: "white", fontWeight: "bold", fontSize: 14 },
  filterScroll: { maxHeight: 70, flexGrow: 0 },
  filterTab: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 8,
    backgroundColor: "#1E293B",
    borderWidth: 1,
    borderColor: "#334155",
  },
  filterTabText: { color: "#94A3B8", fontWeight: "600", fontSize: 13 },
  filterCount: {
    backgroundColor: "#334155",
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    minWidth: 22,
    alignItems: "center",
  },
  filterCountText: { color: "white", fontSize: 11, fontWeight: "700" },
  list: { flex: 1 },
  loadingContainer: { alignItems: "center", marginTop: 60 },
  loadingText: { color: "#94A3B8", marginTop: 16, fontSize: 15 },
  emptyState: { alignItems: "center", paddingVertical: 60, paddingHorizontal: 30 },
  emptyTitle: { color: "white", fontSize: 20, fontWeight: "bold", marginTop: 20 },
  emptySubtitle: { color: "#94A3B8", textAlign: "center", marginTop: 10, lineHeight: 20 },
  emptyBtn: {
    backgroundColor: "#38BDF8",
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 16,
    marginTop: 24,
    shadowColor: "#38BDF8",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  emptyBtnText: { color: "white", fontWeight: "bold", fontSize: 16 },
  tripCard: {
    backgroundColor: "#1E293B",
    borderRadius: 20,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#334155",
  },
  cardTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  statusBadge: {
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
  },
  statusText: { fontSize: 12, fontWeight: "700" },
  iconBtn: {
    backgroundColor: "rgba(56,189,248,0.1)",
    padding: 8,
    borderRadius: 10,
  },
  tripName: { color: "white", fontSize: 22, fontWeight: "bold", marginBottom: 6 },
  tripDestination: { color: "#CBD5E1", fontSize: 15, marginBottom: 14 },
  metaGrid: { gap: 8, marginBottom: 4 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  metaText: { color: "#94A3B8", fontSize: 13 },
  progressContainer: { marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: "#334155" },
  progressTrack: {
    height: 5,
    backgroundColor: "#0F172A",
    borderRadius: 3,
    overflow: "hidden",
    marginBottom: 6,
  },
  progressFill: { height: "100%", backgroundColor: "#22C55E", borderRadius: 3 },
  progressText: { color: "#22C55E", fontSize: 12, fontWeight: "600" },
});
