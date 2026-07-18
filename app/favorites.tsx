import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from "react-native";
import { useEffect, useState } from "react";
import {
  getFirestore,
  collection,
  onSnapshot,
  deleteDoc,
  doc,
  query,
  where,
} from "firebase/firestore";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import app, { auth } from "../firebaseConfig";

export default function FavoritesScreen() {
  const db = getFirestore(app);
  const [favorites, setFavorites] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      setLoading(false);
      return;
    }

    // Filter favorites by userId — user data isolation
    const q = query(
      collection(db, "favorites"),
      where("userId", "==", currentUser.uid)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const temp: any[] = [];
        snapshot.forEach((docSnap) => {
          temp.push({ id: docSnap.id, ...docSnap.data() });
        });
        // Sort by savedAt descending
        temp.sort((a, b) => {
          const aTime = a.savedAt?.toMillis?.() || 0;
          const bTime = b.savedAt?.toMillis?.() || 0;
          return bTime - aTime;
        });
        setFavorites(temp);
        setLoading(false);
      },
      (error) => {
        console.log("Favorites fetch error:", error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const removeFavorite = async (id: string, name: string) => {
    try {
      await deleteDoc(doc(db, "favorites", id));
      Alert.alert("Removed ❤️", `"${name}" removed from Favorites.`);
    } catch (error) {
      console.log(error);
      Alert.alert("Error", "Could not remove from favorites.");
    }
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Back Button & Title Area */}
      <View style={styles.headerArea}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back-outline" size={22} color="white" />
        </TouchableOpacity>
        <Text style={styles.screenTitle}>Favorites ❤️</Text>
      </View>

      <Text style={styles.subtitle}>
        Your saved premium destinations &amp; landmarks
      </Text>

      {/* Loading state */}
      {loading ? (
        <ActivityIndicator size="large" color="#38BDF8" style={{ marginTop: 50 }} />
      ) : favorites.length > 0 ? (
        favorites.map((item, index) => (
          <View key={item.id || index} style={styles.placeCard}>
            <Image
              source={{
                uri: item.image || "https://images.unsplash.com/photo-1507525428034-b723cf961d3e",
              }}
              style={styles.placeImage}
            />

            <View style={styles.cardContent}>
              <Text style={styles.placeName}>{item.name}</Text>

              {!!item.address && (
                <Text style={styles.placeAddress}>📍 {item.address}</Text>
              )}

              {!!item.category && (
                <View style={styles.categoryBadge}>
                  <Text style={styles.categoryText}>{item.category}</Text>
                </View>
              )}

              <View style={styles.cardFooter}>
                <View style={styles.statsRow}>
                  <Text style={styles.ratingText}>⭐ {item.rating || "4.8"}</Text>
                  <Text style={styles.crowdText}>• Crowd: {item.crowd || "Medium"}</Text>
                </View>

                <TouchableOpacity
                  onPress={() => removeFavorite(item.id, item.name)}
                  style={styles.removeBtn}
                >
                  <Ionicons name="trash-outline" size={16} color="#EF4444" style={{ marginRight: 4 }} />
                  <Text style={styles.removeBtnText}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ))
      ) : (
        /* Empty State */
        <View style={styles.emptyState}>
          <Ionicons name="heart-dislike-outline" size={50} color="#94A3B8" />
          <Text style={styles.emptyTitle}>No Saved Destinations</Text>
          <Text style={styles.emptyText}>
            Go to the &quot;Explore&quot; or &quot;Map&quot; tabs to discover and favorite amazing places!
          </Text>
          <TouchableOpacity
            onPress={() => router.push("/(tabs)/explore")}
            style={styles.exploreBtn}
          >
            <Text style={styles.exploreBtnText}>Start Exploring</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* AI Recommendations Card */}
      <TouchableOpacity
        onPress={() => router.push("/ai-assistant")}
        style={styles.aiCard}
      >
        <Text style={styles.aiTitle}>🤖 Ask AI Assistant</Text>
        <Text style={styles.aiText}>
          Get personalized itineraries, hidden trails, packing suggestions, and real-time guidance based on your saved favorites!
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
    borderRadius: 24,
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
  placeName: {
    color: "white",
    fontSize: 22,
    fontWeight: "bold",
  },
  placeAddress: {
    color: "#94A3B8",
    fontSize: 13,
    marginTop: 4,
  },
  categoryBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(56,189,248,0.1)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: "rgba(56,189,248,0.25)",
    marginTop: 8,
  },
  categoryText: {
    color: "#38BDF8",
    fontSize: 12,
    fontWeight: "600",
  },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 15,
    alignItems: "center",
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  ratingText: {
    color: "#EAB308",
    fontWeight: "bold",
  },
  crowdText: {
    color: "#CBD5E1",
    fontSize: 12,
    marginLeft: 8,
  },
  removeBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  removeBtnText: {
    color: "#EF4444",
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
  exploreBtn: {
    backgroundColor: "#38BDF8",
    paddingVertical: 12,
    paddingHorizontal: 25,
    borderRadius: 14,
    marginTop: 20,
  },
  exploreBtnText: {
    color: "white",
    fontWeight: "bold",
  },
  aiCard: {
    backgroundColor: "#38BDF8",
    padding: 22,
    borderRadius: 20,
    marginBottom: 120,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
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