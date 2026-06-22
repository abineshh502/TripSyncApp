import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  TextInput,
  Alert,
  StyleSheet,
} from "react-native";
import { useEffect, useState } from "react";
import {
  getFirestore,
  collection,
  onSnapshot,
  updateDoc,
  doc,
  deleteDoc,
  query,
  where,
} from "firebase/firestore";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import app, { auth } from "../firebaseConfig";

export default function VisitedScreen() {
  const db = getFirestore(app);
  const [visited, setVisited] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [memoryText, setMemoryText] = useState("");

  useEffect(() => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      setLoading(false);
      return;
    }

    // Filter visited places by userId — user data isolation
    const q = query(
      collection(db, "visited"),
      where("userId", "==", currentUser.uid)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const temp: any[] = [];
        snapshot.forEach((docSnap) => {
          temp.push({ id: docSnap.id, ...docSnap.data() });
        });
        // Sort by visitedAt descending
        temp.sort((a, b) => {
          const aTime = a.visitedAt?.toMillis?.() || 0;
          const bTime = b.visitedAt?.toMillis?.() || 0;
          return bTime - aTime;
        });
        setVisited(temp);
        setLoading(false);
      },
      (error) => {
        console.log("Visited fetch error:", error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const saveMemory = async (id: string) => {
    try {
      await updateDoc(doc(db, "visited", id), {
        memories: memoryText,
      });
      setEditingId(null);
      setMemoryText("");
      Alert.alert("Success 📝", "Travel memory saved!");
    } catch (e) {
      console.log(e);
      Alert.alert("Error", "Could not save your memory log.");
    }
  };

  const removeVisited = async (id: string) => {
    try {
      await deleteDoc(doc(db, "visited", id));
      Alert.alert("Removed 🗑️", "Removed from Visited logs.");
    } catch (e) {
      console.log(e);
    }
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Header Area with Back Arrow */}
      <View style={styles.headerArea}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back-outline" size={22} color="white" />
        </TouchableOpacity>
        <Text style={styles.screenTitle}>Visited Places ✅</Text>
      </View>

      <Text style={styles.subtitle}>
        Track your travel memories, milestones &amp; adventures
      </Text>

      {/* Loading state */}
      {loading ? (
        <ActivityIndicator size="large" color="#38BDF8" style={{ marginTop: 50 }} />
      ) : visited.length > 0 ? (
        visited.map((item, index) => (
          <View key={item.id || index} style={styles.placeCard}>
            <Image
              source={{
                uri: item.image || "https://images.unsplash.com/photo-1507525428034-b723cf961d3e",
              }}
              style={styles.placeImage}
            />

            <View style={styles.cardContent}>
              <View style={styles.titleRow}>
                <Text style={styles.placeName}>{item.name}</Text>
                <TouchableOpacity onPress={() => removeVisited(item.id)}>
                  <Ionicons name="trash-outline" size={18} color="#EF4444" />
                </TouchableOpacity>
              </View>

              <Text style={styles.placeAddress}>📍 {item.address || "Completed Journey"}</Text>

              {!!item.category && (
                <View style={styles.categoryBadge}>
                  <Text style={styles.categoryText}>{item.category}</Text>
                </View>
              )}

              {/* Memories log section */}
              <View style={styles.memoryBox}>
                <Text style={styles.memoryHeader}>📖 MY MEMORY LOG</Text>
                {editingId === item.id ? (
                  <View>
                    <TextInput
                      style={styles.memoryInput}
                      multiline
                      value={memoryText}
                      onChangeText={setMemoryText}
                      placeholder="Write down memories from your visit..."
                      placeholderTextColor="#94A3B8"
                    />
                    <View style={styles.actionButtons}>
                      <TouchableOpacity
                        onPress={() => setEditingId(null)}
                        style={styles.cancelBtn}
                      >
                        <Text style={styles.cancelText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => saveMemory(item.id)}
                        style={styles.saveBtn}
                      >
                        <Text style={styles.saveText}>Save</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <View>
                    <Text style={styles.memoryTextContent}>
                      {item.memories || "No memories logged yet. Tap edit to log your stories!"}
                    </Text>
                    <TouchableOpacity
                      onPress={() => {
                        setEditingId(item.id);
                        setMemoryText(item.memories || "");
                      }}
                      style={styles.editBtn}
                    >
                      <Ionicons name="create-outline" size={14} color="#38BDF8" style={{ marginRight: 4 }} />
                      <Text style={styles.editBtnText}>Edit Log</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            </View>
          </View>
        ))
      ) : (
        /* Empty State */
        <View style={styles.emptyState}>
          <Ionicons name="ribbon-outline" size={50} color="#94A3B8" />
          <Text style={styles.emptyTitle}>No Visited Places Yet</Text>
          <Text style={styles.emptyText}>
            Keep traveling, complete journeys, and write down your stories to unlock lifetime achievements!
          </Text>
        </View>
      )}

      {/* AI Travel Story Section */}
      <TouchableOpacity
        onPress={() => {
          Alert.alert("AI Story Generator ✨", "Generating a premium novelized travel summary based on your visited locations... (Available in chatbot assistant!)");
          router.push("/ai-assistant");
        }}
        style={styles.aiCard}
      >
        <Text style={styles.aiTitle}>✨ AI Travel Story</Text>
        <Text style={styles.aiText}>
          Create customized, high-definition summaries of your global milestones and post them directly to social boards.
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0F172A",
    padding: 20,
  },
  headerArea: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 50,
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
  screenTitle: {
    color: "white",
    fontSize: 32,
    fontWeight: "bold",
  },
  subtitle: {
    color: "#94A3B8",
    marginTop: 10,
    marginBottom: 25,
    fontSize: 16,
  },
  placeCard: {
    backgroundColor: "#1E293B",
    borderRadius: 20,
    overflow: "hidden",
    marginBottom: 25,
    borderWidth: 1,
    borderColor: "#334155",
  },
  placeImage: {
    width: "100%",
    height: 180,
  },
  cardContent: {
    padding: 18,
  },
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  placeName: {
    color: "white",
    fontSize: 22,
    fontWeight: "bold",
  },
  placeAddress: {
    color: "#38BDF8",
    marginTop: 5,
    fontSize: 13,
  },
  categoryBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(167,139,250,0.1)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.25)",
    marginTop: 8,
  },
  categoryText: {
    color: "#A78BFA",
    fontSize: 12,
    fontWeight: "600",
  },
  memoryBox: {
    backgroundColor: "#0F172A",
    padding: 12,
    borderRadius: 12,
    marginTop: 15,
    borderWidth: 1,
    borderColor: "#334155",
  },
  memoryHeader: {
    color: "#EAB308",
    fontWeight: "bold",
    fontSize: 12,
    marginBottom: 5,
  },
  memoryInput: {
    color: "white",
    padding: 8,
    backgroundColor: "#1E293B",
    borderRadius: 8,
    minHeight: 60,
    textAlignVertical: "top",
    fontSize: 13,
    marginBottom: 10,
  },
  actionButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  cancelBtn: {
    marginRight: 15,
    paddingVertical: 6,
  },
  cancelText: {
    color: "#94A3B8",
  },
  saveBtn: {
    backgroundColor: "#38BDF8",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  saveText: {
    color: "white",
    fontWeight: "bold",
  },
  memoryTextContent: {
    color: "white",
    fontSize: 13,
    lineHeight: 18,
  },
  editBtn: {
    marginTop: 10,
    alignSelf: "flex-end",
    flexDirection: "row",
    alignItems: "center",
  },
  editBtnText: {
    color: "#38BDF8",
    fontSize: 12,
    fontWeight: "bold",
  },
  emptyState: {
    alignItems: "center",
    padding: 40,
    backgroundColor: "#1E293B",
    borderRadius: 24,
    marginBottom: 30,
    borderWidth: 1,
    borderColor: "#334155",
  },
  emptyTitle: {
    color: "white",
    fontSize: 18,
    fontWeight: "bold",
    marginTop: 15,
  },
  emptyText: {
    color: "#CBD5E1",
    textAlign: "center",
    marginTop: 10,
    lineHeight: 20,
  },
  aiCard: {
    backgroundColor: "#38BDF8",
    padding: 22,
    borderRadius: 20,
    marginBottom: 120,
  },
  aiTitle: {
    color: "white",
    fontSize: 22,
    fontWeight: "bold",
  },
  aiText: {
    color: "white",
    marginTop: 8,
    lineHeight: 22,
  },
});
