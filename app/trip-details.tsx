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
import { router, useLocalSearchParams } from "expo-router";
import { getFirestore, doc, getDoc, deleteDoc } from "firebase/firestore";
import { Ionicons } from "@expo/vector-icons";
import app, { auth } from "../firebaseConfig";

type TripStatus = "active" | "upcoming" | "completed";

const STATUS_CONFIG = {
  active: { label: "Active 🚀", color: "#22C55E", bg: "rgba(34,197,94,0.12)", border: "rgba(34,197,94,0.3)" },
  upcoming: { label: "Upcoming 🗓", color: "#EAB308", bg: "rgba(234,179,8,0.12)", border: "rgba(234,179,8,0.3)" },
  completed: { label: "Completed ✅", color: "#38BDF8", bg: "rgba(56,189,248,0.12)", border: "rgba(56,189,248,0.3)" },
};

const getTripStatus = (trip: any): TripStatus => {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const start = trip.startDate ? new Date(trip.startDate) : null;
  const end = trip.endDate ? new Date(trip.endDate) : null;
  if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) return "upcoming";
  end.setHours(23, 59, 59, 0);
  if (now > end) return "completed";
  if (now >= start) return "active";
  return "upcoming";
};

export default function TripDetailsScreen() {
  const params = useLocalSearchParams<{
    id: string;
    tripName?: string;
    destination?: string;
    budget?: string;
    startDate?: string;
    endDate?: string;
  }>();
  const db = getFirestore(app);
  const [fullTrip, setFullTrip] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTrip();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  const loadTrip = async () => {
    if (!params.id) {
      setLoading(false);
      return;
    }
    try {
      const snap = await getDoc(doc(db, "trips", params.id));
      if (snap.exists()) {
        const tripData = snap.data();
        if (tripData.userId && tripData.userId !== auth.currentUser?.uid) {
          Alert.alert("Permission Denied", "You do not have permission to view this trip.");
          router.replace("/(tabs)/trips");
          return;
        }
        setFullTrip({ id: snap.id, ...tripData });
      } else {
        setFullTrip({
          id: params.id,
          tripName: params.tripName,
          destination: params.destination,
          budget: params.budget,
          startDate: params.startDate,
          endDate: params.endDate,
          days: [],
        });
      }
    } catch (e) {
      console.log("Load trip error:", e);
      setFullTrip({
        id: params.id,
        tripName: params.tripName,
        destination: params.destination,
        budget: params.budget,
        startDate: params.startDate,
        endDate: params.endDate,
        days: [],
      });
    }
    setLoading(false);
  };

  const handleDelete = () => {
    Alert.alert("Delete Trip", `Delete "${fullTrip?.tripName}" permanently?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteDoc(doc(db, "trips", fullTrip.id));
            router.replace("/(tabs)/trips" as any);
          } catch (_e) {
            Alert.alert("Error", "Could not delete trip.");
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#38BDF8" />
        <Text style={styles.loadingText}>Loading trip details...</Text>
      </View>
    );
  }

  if (!fullTrip) {
    return (
      <View style={styles.centered}>
        <Ionicons name="alert-circle-outline" size={48} color="#EF4444" />
        <Text style={{ color: "white", marginTop: 12, fontSize: 16 }}>Trip not found.</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text style={{ color: "#38BDF8", fontWeight: "600" }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const status = getTripStatus(fullTrip);
  const statusCfg = STATUS_CONFIG[status];
  const hasDays = fullTrip.days && fullTrip.days.length > 0;
  const today = new Date().toISOString().split("T")[0];

  return (
    <ScrollView testID="trip-details-screen" style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back-outline" size={22} color="white" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {fullTrip.tripName}
          </Text>
          <Text style={styles.headerSub}>📍 {fullTrip.destination}</Text>
        </View>
        <TouchableOpacity
          testID="trip-edit-btn"
          accessibilityLabel="trip-edit-btn"
          onPress={() =>
            router.push({
              pathname: "/edit-trip",
              params: {
                id: fullTrip.id,
                tripName: fullTrip.tripName,
                destination: fullTrip.destination,
                budget: fullTrip.budget,
                startDate: fullTrip.startDate,
                endDate: fullTrip.endDate,
              },
            })
          }
          style={styles.editHeaderBtn}
        >
          <Ionicons name="create-outline" size={20} color="#38BDF8" />
        </TouchableOpacity>
      </View>

      {/* Summary Card */}
      <View style={styles.summaryCard}>
        <View
          style={[
            styles.statusPill,
            { backgroundColor: statusCfg.bg, borderColor: statusCfg.border },
          ]}
        >
          <Text style={[styles.statusPillText, { color: statusCfg.color }]}>
            {statusCfg.label}
          </Text>
        </View>

        <View style={styles.metaRow}>
          <View style={styles.metaCell}>
            <Ionicons name="calendar-outline" size={20} color="#38BDF8" />
            <Text style={styles.metaCellLabel}>Start</Text>
            <Text style={styles.metaCellValue}>{fullTrip.startDate || "—"}</Text>
          </View>
          <View style={styles.vertDivider} />
          <View style={styles.metaCell}>
            <Ionicons name="flag-outline" size={20} color="#22C55E" />
            <Text style={styles.metaCellLabel}>End</Text>
            <Text style={styles.metaCellValue}>{fullTrip.endDate || "—"}</Text>
          </View>
          <View style={styles.vertDivider} />
          <View style={styles.metaCell}>
            <Ionicons name="wallet-outline" size={20} color="#EAB308" />
            <Text style={styles.metaCellLabel}>Budget</Text>
            <Text style={styles.metaCellValue}>₹{fullTrip.budget || "—"}</Text>
          </View>
        </View>
      </View>

      {/* Itinerary Timeline */}
      {hasDays ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            🗓 Itinerary — {fullTrip.days.length} Day{fullTrip.days.length > 1 ? "s" : ""}
          </Text>

          {fullTrip.days.map((day: any, i: number) => {
            const isToday = day.date === today;
            return (
              <View key={i} style={styles.timelineRow}>
                {/* Connector */}
                <View style={styles.connector}>
                  <View
                    style={[
                      styles.circle,
                      isToday && { backgroundColor: "#22C55E", shadowColor: "#22C55E", shadowRadius: 8, shadowOpacity: 0.6, elevation: 6 },
                    ]}
                  >
                    <Text style={styles.circleText}>{day.dayNumber}</Text>
                  </View>
                  {i < fullTrip.days.length - 1 && <View style={styles.connLine} />}
                </View>

                {/* Day Card */}
                <View
                  style={[
                    styles.dayCard,
                    isToday && { borderColor: "rgba(34,197,94,0.4)", backgroundColor: "rgba(34,197,94,0.05)" },
                  ]}
                >
                  {isToday && (
                    <View style={styles.todayBadge}>
                      <Text style={styles.todayBadgeText}>📍 TODAY</Text>
                    </View>
                  )}
                  <View style={styles.dayHeader}>
                    <Text style={styles.dayTitle} numberOfLines={2}>
                      {day.title}
                    </Text>
                    <Text style={styles.dayDate}>{day.date}</Text>
                  </View>

                  {day.notes ? (
                    <Text style={styles.dayNotes}>{day.notes}</Text>
                  ) : null}

                  {day.destinations && day.destinations.length > 0 && (
                    <View style={styles.destList}>
                      {day.destinations.map((dest: any, j: number) => (
                        <View key={j} style={styles.destRow}>
                          <Ionicons name="location" size={14} color="#38BDF8" />
                          <Text style={styles.destText}>{dest.name}</Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {day.mapLink ? (
                    <TouchableOpacity
                      style={styles.linkRow}
                      onPress={() => {
                        const match = day.mapLink.match(/\/routes\/([a-zA-Z0-9_-]+)/) || day.mapLink.match(/^([a-zA-Z0-9_-]+)$/);
                        if (match) {
                          const routeId = match[1];
                          router.push(`/routes/${routeId}` as any);
                        } else if (day.mapLink.includes("/routes/")) {
                          const parts = day.mapLink.split("/routes/");
                          const routeId = parts[parts.length - 1];
                          router.push(`/routes/${routeId}` as any);
                        } else {
                          Alert.alert("Invalid Route Link", "This map link does not contain a valid route ID.");
                        }
                      }}
                    >
                      <Ionicons name="map-outline" size={13} color="#38BDF8" />
                      <Text style={[styles.linkText, { color: "#38BDF8", textDecorationLine: "underline" }]} numberOfLines={1}>
                        {day.mapLink}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      ) : (
        <View style={styles.emptyDaysCard}>
          <Ionicons name="calendar-outline" size={44} color="#334155" />
          <Text style={styles.emptyDaysTitle}>No itinerary added yet</Text>
          <Text style={styles.emptyDaysSub}>
            Edit this trip to add a day-by-day schedule
          </Text>
          <TouchableOpacity
            onPress={() =>
              router.push({
                pathname: "/edit-trip",
                params: {
                  id: fullTrip.id,
                  tripName: fullTrip.tripName,
                  destination: fullTrip.destination,
                  budget: fullTrip.budget,
                  startDate: fullTrip.startDate,
                  endDate: fullTrip.endDate,
                },
              })
            }
            style={styles.addPlanBtn}
          >
            <Ionicons name="add-circle-outline" size={18} color="white" />
            <Text style={styles.addPlanBtnText}>Add Day Plans</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Action Buttons */}
      <View style={styles.actions}>
        <TouchableOpacity
          onPress={() =>
            router.push({
              pathname: "/edit-trip",
              params: {
                id: fullTrip.id,
                tripName: fullTrip.tripName,
                destination: fullTrip.destination,
                budget: fullTrip.budget,
                startDate: fullTrip.startDate,
                endDate: fullTrip.endDate,
              },
            })
          }
          style={styles.editBtn}
        >
          <Ionicons name="create-outline" size={18} color="#38BDF8" />
          <Text style={styles.editBtnText}>Edit Trip</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={handleDelete} style={styles.deleteBtn}>
          <Ionicons name="trash-outline" size={18} color="#EF4444" />
          <Text style={styles.deleteBtnText}>Delete Trip</Text>
        </TouchableOpacity>
      </View>

      <View style={{ height: 100 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0F172A" },
  centered: {
    flex: 1,
    backgroundColor: "#0F172A",
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: { color: "#94A3B8", marginTop: 16, fontSize: 15 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 55,
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: "#020617",
    borderBottomWidth: 1,
    borderBottomColor: "#1E293B",
    gap: 14,
  },
  backBtn: { backgroundColor: "#1E293B", padding: 8, borderRadius: 12 },
  headerTitle: { color: "white", fontSize: 20, fontWeight: "bold" },
  headerSub: { color: "#94A3B8", fontSize: 13, marginTop: 2 },
  editHeaderBtn: {
    backgroundColor: "rgba(56,189,248,0.1)",
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(56,189,248,0.3)",
  },
  summaryCard: {
    margin: 20,
    backgroundColor: "#1E293B",
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: "#334155",
  },
  statusPill: {
    alignSelf: "flex-start",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginBottom: 18,
    borderWidth: 1,
  },
  statusPillText: { fontSize: 13, fontWeight: "700" },
  metaRow: { flexDirection: "row", alignItems: "center" },
  metaCell: { flex: 1, alignItems: "center", gap: 4 },
  metaCellLabel: { color: "#94A3B8", fontSize: 11, fontWeight: "600" },
  metaCellValue: { color: "white", fontSize: 13, fontWeight: "700", textAlign: "center" },
  vertDivider: { width: 1, height: 40, backgroundColor: "#334155" },
  section: { paddingHorizontal: 20, paddingBottom: 10 },
  sectionTitle: { color: "white", fontSize: 18, fontWeight: "bold", marginBottom: 16 },
  timelineRow: { flexDirection: "row", gap: 14, marginBottom: 0 },
  connector: { alignItems: "center", width: 34 },
  circle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#38BDF8",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#38BDF8",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 4,
  },
  circleText: { color: "white", fontWeight: "bold", fontSize: 13 },
  connLine: { width: 2, flex: 1, backgroundColor: "#334155", marginVertical: 4, minHeight: 20 },
  dayCard: {
    flex: 1,
    backgroundColor: "#1E293B",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#334155",
  },
  todayBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(34,197,94,0.2)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 10,
  },
  todayBadgeText: { color: "#22C55E", fontSize: 11, fontWeight: "800", letterSpacing: 0.5 },
  dayHeader: { flexDirection: "row", gap: 8, justifyContent: "space-between", marginBottom: 6 },
  dayTitle: { color: "white", fontSize: 15, fontWeight: "bold", flex: 1 },
  dayDate: { color: "#94A3B8", fontSize: 12 },
  dayNotes: { color: "#CBD5E1", fontSize: 13, lineHeight: 18, marginTop: 6 },
  destList: { marginTop: 10, gap: 6 },
  destRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  destText: { color: "#94A3B8", fontSize: 13 },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#334155",
  },
  linkText: { color: "#94A3B8", fontSize: 12, flex: 1 },
  emptyDaysCard: {
    margin: 20,
    backgroundColor: "#1E293B",
    borderRadius: 20,
    padding: 30,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#334155",
  },
  emptyDaysTitle: { color: "white", fontSize: 16, fontWeight: "bold", marginTop: 14 },
  emptyDaysSub: { color: "#94A3B8", textAlign: "center", marginTop: 8, lineHeight: 20 },
  addPlanBtn: {
    backgroundColor: "#38BDF8",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 14,
    marginTop: 18,
    shadowColor: "#38BDF8",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  addPlanBtnText: { color: "white", fontWeight: "bold", fontSize: 14 },
  actions: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 20,
    marginTop: 8,
  },
  editBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "rgba(56,189,248,0.1)",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(56,189,248,0.3)",
  },
  editBtnText: { color: "#38BDF8", fontWeight: "600", fontSize: 15 },
  deleteBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "rgba(239,68,68,0.1)",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.3)",
  },
  deleteBtnText: { color: "#EF4444", fontWeight: "600", fontSize: 15 },
});