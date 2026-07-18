import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useState } from "react";
import { router } from "expo-router";
import { getFirestore, collection, addDoc } from "firebase/firestore";
import { Ionicons } from "@expo/vector-icons";
import app, { auth } from "../firebaseConfig";

interface DaySchedule {
  dayNumber: number;
  date: string;
  title: string;
  notes: string;
  destinations: { name: string }[];
  mapLink: string;
}

export default function CreateTripScreen() {
  const db = getFirestore(app);
  const [tripName, setTripName] = useState("");
  const [destination, setDestination] = useState("");
  const [budget, setBudget] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [days, setDays] = useState<DaySchedule[]>([]);
  const [daysGenerated, setDaysGenerated] = useState(false);
  const [loading, setLoading] = useState(false);

  const generateDays = () => {
    if (!startDate || !endDate) {
      Alert.alert("Required", "Please enter start and end dates.");
      return;
    }
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      Alert.alert("Invalid Format", "Use YYYY-MM-DD format (e.g., 2024-08-10)");
      return;
    }
    if (end < start) {
      Alert.alert("Invalid Range", "End date must be after start date.");
      return;
    }
    const dayCount =
      Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    if (dayCount > 30) {
      Alert.alert("Too Long", "Trip duration cannot exceed 30 days.");
      return;
    }
    const generated: DaySchedule[] = [];
    for (let i = 0; i < dayCount; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      generated.push({
        dayNumber: i + 1,
        date: d.toISOString().split("T")[0],
        title:
          i === 0
            ? `Day 1 - Arrival & Check-in`
            : i === dayCount - 1
            ? `Day ${i + 1} - Departure`
            : `Day ${i + 1} - Exploration`,
        notes: "",
        destinations: [],
        mapLink: "",
      });
    }
    setDays(generated);
    setDaysGenerated(true);
  };

  const addDestinationToDay = (dayIndex: number) => {
    const updated = [...days];
    updated[dayIndex].destinations.push({ name: "" });
    setDays(updated);
  };

  const updateDestination = (dayIndex: number, destIndex: number, value: string) => {
    const updated = [...days];
    updated[dayIndex].destinations[destIndex].name = value;
    setDays(updated);
  };

  const removeDestination = (dayIndex: number, destIndex: number) => {
    const updated = [...days];
    updated[dayIndex].destinations.splice(destIndex, 1);
    setDays([...updated]);
  };

  const updateDayField = (dayIndex: number, field: string, value: string) => {
    const updated = [...days];
    (updated[dayIndex] as any)[field] = value;
    setDays(updated);
  };

  const confirmTrip = async () => {
    if (!tripName.trim()) {
      Alert.alert("Required", "Please enter a trip name.");
      return;
    }
    if (!destination.trim()) {
      Alert.alert("Required", "Please enter a destination.");
      return;
    }
    setLoading(true);
    try {
      const now = new Date();
      const start = new Date(startDate);
      const end = new Date(endDate);
      let status = "upcoming";
      if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
        const endOfDay = new Date(end);
        endOfDay.setHours(23, 59, 59, 0);
        if (now > endOfDay) status = "completed";
        else if (now >= start) status = "active";
      }

      await addDoc(collection(db, "trips"), {
        tripName: tripName.trim(),
        destination: destination.trim(),
        budget: budget.trim(),
        startDate,
        endDate,
        status,
        days,
        userId: auth.currentUser?.uid,
        createdAt: new Date(),
      });

      Alert.alert("Trip Confirmed! ✈️", `"${tripName}" has been saved as ${status}!`, [
        { text: "View My Trips", onPress: () => router.push("/(tabs)/trips" as any) },
        { text: "Go Home", onPress: () => router.push("/(tabs)" as any) },
      ]);
    } catch (error) {
      console.log(error);
      Alert.alert("Error", "Could not save trip. Try again.");
    }
    setLoading(false);
  };

  return (
    <ScrollView
      testID="create-trip-screen"
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back-outline" size={22} color="white" />
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitle}>Plan A Trip ✈️</Text>
          <Text style={styles.headerSub}>Build your day-by-day adventure</Text>
        </View>
      </View>

      {/* Section 1: Basic Info */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionBadge}><Text style={styles.sectionBadgeText}>1</Text></View>
          <Text style={styles.sectionTitle}>Trip Details</Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Trip Name *</Text>
          <View style={styles.inputBox}>
            <Ionicons name="bookmark-outline" size={18} color="#94A3B8" style={styles.inputIcon} />
            <TextInput
              testID="trip-name-input"
              accessibilityLabel="trip-name-input"
              placeholder="e.g., Goa Adventure 2024"
              placeholderTextColor="#94A3B8"
              value={tripName}
              onChangeText={setTripName}
              style={styles.textInput}
            />
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Destination *</Text>
          <View style={styles.inputBox}>
            <Ionicons name="location-outline" size={18} color="#94A3B8" style={styles.inputIcon} />
            <TextInput
              testID="trip-destination-input"
              accessibilityLabel="trip-destination-input"
              placeholder="e.g., Goa, India"
              placeholderTextColor="#94A3B8"
              value={destination}
              onChangeText={setDestination}
              style={styles.textInput}
            />
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Budget (₹)</Text>
          <View style={styles.inputBox}>
            <Ionicons name="wallet-outline" size={18} color="#94A3B8" style={styles.inputIcon} />
            <TextInput
              testID="trip-budget-input"
              accessibilityLabel="trip-budget-input"
              placeholder="e.g., 25000"
              placeholderTextColor="#94A3B8"
              value={budget}
              onChangeText={setBudget}
              keyboardType="numeric"
              style={styles.textInput}
            />
          </View>
        </View>

        <View style={{ flexDirection: "row", gap: 12 }}>
          <View style={[styles.field, { flex: 1 }]}>
            <Text style={styles.fieldLabel}>Start Date</Text>
            <View style={styles.inputBox}>
              <Ionicons name="calendar-outline" size={16} color="#94A3B8" style={styles.inputIcon} />
              <TextInput
                testID="trip-start-date-input"
                accessibilityLabel="trip-start-date-input"
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#94A3B8"
                value={startDate}
                onChangeText={setStartDate}
                style={styles.textInput}
              />
            </View>
          </View>
          <View style={[styles.field, { flex: 1 }]}>
            <Text style={styles.fieldLabel}>End Date</Text>
            <View style={styles.inputBox}>
              <Ionicons name="calendar-outline" size={16} color="#94A3B8" style={styles.inputIcon} />
              <TextInput
                testID="trip-end-date-input"
                accessibilityLabel="trip-end-date-input"
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#94A3B8"
                value={endDate}
                onChangeText={setEndDate}
                style={styles.textInput}
              />
            </View>
          </View>
        </View>

        <TouchableOpacity testID="generate-days-btn" accessibilityLabel="generate-days-btn" onPress={generateDays} style={styles.genBtn}>
          <Ionicons name="list-outline" size={20} color="#38BDF8" />
          <Text style={styles.genBtnText}>
            {daysGenerated ? `Regenerate ${days.length} Day Schedule` : "Generate Day Schedule"}
          </Text>
          <Ionicons name="chevron-forward" size={18} color="#38BDF8" />
        </TouchableOpacity>
      </View>

      {/* Section 2: Day Planner */}
      {daysGenerated && days.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={[styles.sectionBadge, { backgroundColor: "#22C55E" }]}>
              <Text style={styles.sectionBadgeText}>2</Text>
            </View>
            <Text style={styles.sectionTitle}>Day-by-Day Planner ({days.length} Days)</Text>
          </View>

          {days.map((day, dayIndex) => (
            <View key={dayIndex} style={styles.dayCard}>
              <View style={styles.dayTop}>
                <View style={styles.dayNumBadge}>
                  <Text style={styles.dayNumText}>Day {day.dayNumber}</Text>
                </View>
                <Text style={styles.dayDate}>{day.date}</Text>
              </View>

              {/* Title */}
              <TextInput
                value={day.title}
                onChangeText={(v) => updateDayField(dayIndex, "title", v)}
                style={styles.dayTitleInput}
                placeholderTextColor="#94A3B8"
              />

              {/* Notes */}
              <Text style={styles.subLabel}>📝 Notes</Text>
              <TextInput
                value={day.notes}
                onChangeText={(v) => updateDayField(dayIndex, "notes", v)}
                placeholder="Plans, reminders, special notes..."
                placeholderTextColor="#94A3B8"
                multiline
                style={styles.notesInput}
              />

              {/* Destinations */}
              <Text style={styles.subLabel}>📍 Places to Visit</Text>
              {day.destinations.map((dest, destIndex) => (
                <View key={destIndex} style={styles.destRow}>
                  <TextInput
                    value={dest.name}
                    onChangeText={(v) => updateDestination(dayIndex, destIndex, v)}
                    placeholder={`Place ${destIndex + 1}...`}
                    placeholderTextColor="#94A3B8"
                    style={styles.destInput}
                  />
                  <TouchableOpacity onPress={() => removeDestination(dayIndex, destIndex)}>
                    <Ionicons name="close-circle" size={22} color="#EF4444" />
                  </TouchableOpacity>
                </View>
              ))}

              <TouchableOpacity
                onPress={() => addDestinationToDay(dayIndex)}
                style={styles.addPlaceBtn}
              >
                <Ionicons name="add-circle-outline" size={18} color="#38BDF8" />
                <Text style={styles.addPlaceText}>Add Place</Text>
              </TouchableOpacity>

              {/* Map Link */}
              <Text style={styles.subLabel}>🗺️ Route Link (optional)</Text>
              <View style={styles.inputBox}>
                <Ionicons name="link-outline" size={16} color="#94A3B8" style={styles.inputIcon} />
                <TextInput
                  value={day.mapLink}
                  onChangeText={(v) => updateDayField(dayIndex, "mapLink", v)}
                  placeholder="Paste route/map link here..."
                  placeholderTextColor="#94A3B8"
                  style={styles.textInput}
                />
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Confirm Button */}
      <TouchableOpacity
        onPress={confirmTrip}
        style={[styles.confirmBtn, loading && { opacity: 0.7 }]}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="white" size="small" />
        ) : (
          <>
            <Ionicons name="checkmark-circle" size={24} color="white" />
            <Text style={styles.confirmText}>Confirm Trip 🚀</Text>
          </>
        )}
      </TouchableOpacity>

      <View style={{ height: 60 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: "#0F172A", paddingBottom: 40 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 55,
    paddingHorizontal: 20,
    paddingBottom: 20,
    backgroundColor: "#020617",
    borderBottomWidth: 1,
    borderBottomColor: "#1E293B",
    gap: 16,
  },
  backBtn: { backgroundColor: "#1E293B", padding: 8, borderRadius: 12 },
  headerTitle: { color: "white", fontSize: 22, fontWeight: "bold" },
  headerSub: { color: "#94A3B8", fontSize: 13, marginTop: 2 },
  section: { padding: 20, paddingBottom: 0 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 18 },
  sectionBadge: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: "#38BDF8",
    justifyContent: "center", alignItems: "center",
  },
  sectionBadgeText: { color: "white", fontWeight: "bold", fontSize: 13 },
  sectionTitle: { color: "white", fontSize: 18, fontWeight: "bold" },
  field: { marginBottom: 14 },
  fieldLabel: { color: "#94A3B8", fontSize: 12, fontWeight: "700", marginBottom: 8, letterSpacing: 0.3 },
  inputBox: {
    backgroundColor: "#1E293B",
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#334155",
  },
  inputIcon: { paddingLeft: 14, paddingRight: 8 },
  textInput: { flex: 1, color: "white", paddingVertical: 14, fontSize: 15, paddingRight: 14 },
  genBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "rgba(56,189,248,0.08)",
    borderWidth: 1.5,
    borderColor: "#38BDF8",
    borderRadius: 14,
    padding: 15,
    marginTop: 4,
    marginBottom: 4,
  },
  genBtnText: { color: "#38BDF8", fontWeight: "700", fontSize: 15, flex: 1, textAlign: "center" },
  dayCard: {
    backgroundColor: "#1E293B",
    borderRadius: 20,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#334155",
  },
  dayTop: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
  dayNumBadge: {
    backgroundColor: "#38BDF8",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  dayNumText: { color: "white", fontWeight: "bold", fontSize: 12 },
  dayDate: { color: "#94A3B8", fontSize: 13 },
  dayTitleInput: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
    backgroundColor: "#0F172A",
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#334155",
  },
  subLabel: { color: "#94A3B8", fontSize: 11, fontWeight: "700", letterSpacing: 0.5, marginBottom: 8, marginTop: 4 },
  notesInput: {
    color: "white",
    backgroundColor: "#0F172A",
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    minHeight: 60,
    textAlignVertical: "top",
    borderWidth: 1,
    borderColor: "#334155",
    marginBottom: 14,
  },
  destRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  destInput: {
    flex: 1,
    backgroundColor: "#0F172A",
    color: "white",
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    borderWidth: 1,
    borderColor: "#334155",
  },
  addPlaceBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    marginBottom: 12,
  },
  addPlaceText: { color: "#38BDF8", fontWeight: "600", fontSize: 13 },
  confirmBtn: {
    backgroundColor: "#22C55E",
    margin: 20,
    marginTop: 24,
    padding: 18,
    borderRadius: 18,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
    shadowColor: "#22C55E",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
  confirmText: { color: "white", fontWeight: "bold", fontSize: 18 },
});