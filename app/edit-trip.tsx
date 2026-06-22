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
import { useState, useEffect } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { getFirestore, doc, updateDoc, getDoc } from "firebase/firestore";
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

export default function EditTripScreen() {
  const params = useLocalSearchParams<{
    id: string;
    tripName?: string;
    destination?: string;
    budget?: string;
    startDate?: string;
    endDate?: string;
  }>();

  const db = getFirestore(app);
  const [tripName, setTripName] = useState(params.tripName || "");
  const [destination, setDestination] = useState(params.destination || "");
  const [budget, setBudget] = useState(params.budget || "");
  const [startDate, setStartDate] = useState(params.startDate || "");
  const [endDate, setEndDate] = useState(params.endDate || "");
  const [days, setDays] = useState<DaySchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadFullTrip();
  }, [params.id]);

  const loadFullTrip = async () => {
    if (!params.id) { setLoading(false); return; }
    try {
      const snap = await getDoc(doc(db, "trips", params.id));
      if (snap.exists()) {
        const data = snap.data();
        if (data.userId && data.userId !== auth.currentUser?.uid) {
          Alert.alert("Permission Denied", "You do not have permission to edit this trip.");
          router.replace("/(tabs)/trips");
          return;
        }
        setTripName(data.tripName || params.tripName || "");
        setDestination(data.destination || params.destination || "");
        setBudget(data.budget || params.budget || "");
        setStartDate(data.startDate || params.startDate || "");
        setEndDate(data.endDate || params.endDate || "");
        setDays(data.days || []);
      }
    } catch (e) {
      console.log("Load error:", e);
    }
    setLoading(false);
  };

  const generateDays = () => {
    if (!startDate || !endDate) {
      Alert.alert("Required", "Please enter start and end dates first.");
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
    const dayCount = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    if (dayCount > 30) {
      Alert.alert("Too Long", "Trip cannot exceed 30 days.");
      return;
    }
    Alert.alert(
      "Regenerate Days?",
      "This will replace existing day plans. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Regenerate",
          onPress: () => {
            const generated: DaySchedule[] = [];
            for (let i = 0; i < dayCount; i++) {
              const d = new Date(start);
              d.setDate(d.getDate() + i);
              // Preserve existing day data if available
              const existing = days.find((day) => day.dayNumber === i + 1);
              generated.push(
                existing || {
                  dayNumber: i + 1,
                  date: d.toISOString().split("T")[0],
                  title:
                    i === 0
                      ? "Day 1 - Arrival & Check-in"
                      : i === dayCount - 1
                      ? `Day ${i + 1} - Departure`
                      : `Day ${i + 1} - Exploration`,
                  notes: "",
                  destinations: [],
                  mapLink: "",
                }
              );
            }
            setDays(generated);
          },
        },
      ]
    );
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

  const handleSave = async () => {
    if (!tripName.trim() || !destination.trim()) {
      Alert.alert("Required", "Trip name and destination are required.");
      return;
    }
    setSaving(true);
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

      await updateDoc(doc(db, "trips", params.id), {
        tripName: tripName.trim(),
        destination: destination.trim(),
        budget: budget.trim(),
        startDate,
        endDate,
        status,
        days,
        updatedAt: new Date(),
      });

      Alert.alert("Saved! ✅", "Trip has been updated.", [
        { text: "View Details", onPress: () => router.back() },
        { text: "My Trips", onPress: () => router.push("/(tabs)/trips" as any) },
      ]);
    } catch (error) {
      console.log(error);
      Alert.alert("Error", "Could not update trip.");
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#38BDF8" />
        <Text style={styles.loadingText}>Loading trip data...</Text>
      </View>
    );
  }

  return (
    <ScrollView
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
          <Text style={styles.headerTitle}>Edit Trip ✏️</Text>
          <Text style={styles.headerSub}>{params.tripName}</Text>
        </View>
      </View>

      {/* Basic Info */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionBadge}><Text style={styles.sectionBadgeText}>1</Text></View>
          <Text style={styles.sectionTitle}>Trip Details</Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Trip Name *</Text>
          <View style={styles.inputBox}>
            <Ionicons name="bookmark-outline" size={18} color="#94A3B8" style={styles.icon} />
            <TextInput value={tripName} onChangeText={setTripName} placeholder="Trip name" placeholderTextColor="#94A3B8" style={styles.textInput} />
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Destination *</Text>
          <View style={styles.inputBox}>
            <Ionicons name="location-outline" size={18} color="#94A3B8" style={styles.icon} />
            <TextInput value={destination} onChangeText={setDestination} placeholder="Destination" placeholderTextColor="#94A3B8" style={styles.textInput} />
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Budget (₹)</Text>
          <View style={styles.inputBox}>
            <Ionicons name="wallet-outline" size={18} color="#94A3B8" style={styles.icon} />
            <TextInput value={budget} onChangeText={setBudget} placeholder="Budget" placeholderTextColor="#94A3B8" keyboardType="numeric" style={styles.textInput} />
          </View>
        </View>

        <View style={{ flexDirection: "row", gap: 12 }}>
          <View style={[styles.field, { flex: 1 }]}>
            <Text style={styles.label}>Start Date</Text>
            <View style={styles.inputBox}>
              <Ionicons name="calendar-outline" size={16} color="#94A3B8" style={styles.icon} />
              <TextInput value={startDate} onChangeText={setStartDate} placeholder="YYYY-MM-DD" placeholderTextColor="#94A3B8" style={styles.textInput} />
            </View>
          </View>
          <View style={[styles.field, { flex: 1 }]}>
            <Text style={styles.label}>End Date</Text>
            <View style={styles.inputBox}>
              <Ionicons name="calendar-outline" size={16} color="#94A3B8" style={styles.icon} />
              <TextInput value={endDate} onChangeText={setEndDate} placeholder="YYYY-MM-DD" placeholderTextColor="#94A3B8" style={styles.textInput} />
            </View>
          </View>
        </View>

        <TouchableOpacity onPress={generateDays} style={styles.genBtn}>
          <Ionicons name="refresh-outline" size={18} color="#38BDF8" />
          <Text style={styles.genBtnText}>
            {days.length > 0 ? `Regenerate Day Schedule (${days.length} days)` : "Generate Day Schedule"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Day Planner */}
      {days.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={[styles.sectionBadge, { backgroundColor: "#22C55E" }]}>
              <Text style={styles.sectionBadgeText}>2</Text>
            </View>
            <Text style={styles.sectionTitle}>Edit Day Plans ({days.length})</Text>
          </View>

          {days.map((day, dayIndex) => (
            <View key={dayIndex} style={styles.dayCard}>
              <View style={styles.dayTop}>
                <View style={styles.dayBadge}>
                  <Text style={styles.dayBadgeText}>Day {day.dayNumber}</Text>
                </View>
                <Text style={styles.dayDate}>{day.date}</Text>
              </View>

              <TextInput
                value={day.title}
                onChangeText={(v) => updateDayField(dayIndex, "title", v)}
                style={styles.dayTitleInput}
                placeholderTextColor="#94A3B8"
              />

              <Text style={styles.subLabel}>📝 Notes</Text>
              <TextInput
                value={day.notes}
                onChangeText={(v) => updateDayField(dayIndex, "notes", v)}
                placeholder="Plans and reminders..."
                placeholderTextColor="#94A3B8"
                multiline
                style={styles.notesInput}
              />

              <Text style={styles.subLabel}>📍 Places</Text>
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
              <TouchableOpacity onPress={() => addDestinationToDay(dayIndex)} style={styles.addBtn}>
                <Ionicons name="add-circle-outline" size={18} color="#38BDF8" />
                <Text style={styles.addBtnText}>Add Place</Text>
              </TouchableOpacity>

              <Text style={styles.subLabel}>🗺️ Route Link</Text>
              <View style={styles.inputBox}>
                <Ionicons name="link-outline" size={16} color="#94A3B8" style={styles.icon} />
                <TextInput
                  value={day.mapLink}
                  onChangeText={(v) => updateDayField(dayIndex, "mapLink", v)}
                  placeholder="Paste route link..."
                  placeholderTextColor="#94A3B8"
                  style={styles.textInput}
                />
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Save Button */}
      <TouchableOpacity
        onPress={handleSave}
        style={[styles.saveBtn, saving && { opacity: 0.7 }]}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator color="white" size="small" />
        ) : (
          <>
            <Ionicons name="checkmark-circle" size={22} color="white" />
            <Text style={styles.saveBtnText}>Save Changes ✅</Text>
          </>
        )}
      </TouchableOpacity>

      <View style={{ height: 60 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: "#0F172A", paddingBottom: 40 },
  centered: { flex: 1, backgroundColor: "#0F172A", justifyContent: "center", alignItems: "center" },
  loadingText: { color: "#94A3B8", marginTop: 16, fontSize: 15 },
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
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
  sectionBadge: { width: 28, height: 28, borderRadius: 14, backgroundColor: "#38BDF8", justifyContent: "center", alignItems: "center" },
  sectionBadgeText: { color: "white", fontWeight: "bold", fontSize: 13 },
  sectionTitle: { color: "white", fontSize: 18, fontWeight: "bold" },
  field: { marginBottom: 14 },
  label: { color: "#94A3B8", fontSize: 12, fontWeight: "700", marginBottom: 8 },
  inputBox: { backgroundColor: "#1E293B", borderRadius: 14, flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: "#334155" },
  icon: { paddingLeft: 14, paddingRight: 8 },
  textInput: { flex: 1, color: "white", paddingVertical: 14, fontSize: 15, paddingRight: 14 },
  genBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "rgba(56,189,248,0.08)",
    borderWidth: 1.5,
    borderColor: "#38BDF8",
    borderRadius: 14,
    padding: 14,
    marginTop: 4,
  },
  genBtnText: { color: "#38BDF8", fontWeight: "700", fontSize: 15 },
  dayCard: { backgroundColor: "#1E293B", borderRadius: 20, padding: 18, marginBottom: 16, borderWidth: 1, borderColor: "#334155" },
  dayTop: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
  dayBadge: { backgroundColor: "#38BDF8", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 5 },
  dayBadgeText: { color: "white", fontWeight: "bold", fontSize: 12 },
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
    minHeight: 55,
    textAlignVertical: "top",
    borderWidth: 1,
    borderColor: "#334155",
    marginBottom: 14,
  },
  destRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  destInput: { flex: 1, backgroundColor: "#0F172A", color: "white", borderRadius: 10, padding: 12, fontSize: 14, borderWidth: 1, borderColor: "#334155" },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, marginBottom: 12 },
  addBtnText: { color: "#38BDF8", fontWeight: "600", fontSize: 13 },
  saveBtn: {
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
  saveBtnText: { color: "white", fontWeight: "bold", fontSize: 18 },
});