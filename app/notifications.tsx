import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from "react-native";
import { useState, useEffect } from "react";
import { Ionicons, MaterialCommunityIcons, FontAwesome5 } from "@expo/vector-icons";
import { router } from "expo-router";
import { getFirestore, collection, query, where, orderBy, onSnapshot, updateDoc, doc, deleteDoc } from "firebase/firestore";
import app, { auth } from "../firebaseConfig";

interface TravelNotification {
  id: string;
  type: "weather" | "group" | "reminder" | "system";
  title: string;
  body: string;
  time: string;
  unread: boolean;
  route?: string;
}

const formatTimeAgo = (timestampStr: string) => {
  if (!timestampStr) return "just now";
  try {
    const diffMs = Date.now() - new Date(timestampStr).getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  } catch (e) {
    return "recently";
  }
};

export default function NotificationsScreen() {
  const db = getFirestore(app);
  const [notifications, setNotifications] = useState<TravelNotification[]>([]);

  useEffect(() => {
    const currentUser = auth.currentUser;
    if (!currentUser) return;

    const q = query(
      collection(db, "notifications"),
      where("recipientUid", "==", currentUser.uid),
      orderBy("timestamp", "desc")
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const temp: TravelNotification[] = [];
        snapshot.forEach((d) => {
          const data = d.data();
          temp.push({
            id: d.id,
            type: data.type || "group",
            title: data.title || "TripSync Alert",
            body: data.body || "",
            time: formatTimeAgo(data.timestamp),
            unread: data.unread ?? true,
            route: data.route || "",
          });
        });
        setNotifications(temp);
      },
      (error) => {
        console.log("Notifications sync error:", error);
      }
    );

    return () => unsubscribe();
  }, []);

  const markAllRead = async () => {
    try {
      const batchPromises = notifications.map((n) => {
        if (!n.unread) return Promise.resolve();
        const ref = doc(db, "notifications", n.id);
        return updateDoc(ref, { unread: false });
      });
      await Promise.all(batchPromises);
    } catch (e) {
      console.log("Error marking all read:", e);
    }
  };

  const clearAll = async () => {
    try {
      const batchPromises = notifications.map((n) => {
        const ref = doc(db, "notifications", n.id);
        return deleteDoc(ref);
      });
      await Promise.all(batchPromises);
      Alert.alert("Cleared 🗑️", "All notifications cleared.");
    } catch (e) {
      console.log("Error clearing notifications:", e);
    }
  };

  const deleteOne = async (id: string) => {
    try {
      const ref = doc(db, "notifications", id);
      await deleteDoc(ref);
    } catch (e) {
      console.log("Error deleting notification:", e);
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case "weather":
        return <MaterialCommunityIcons name="weather-rainy" size={22} color="#EF4444" />;
      case "group":
        return <FontAwesome5 name="users" size={18} color="#38BDF8" />;
      case "reminder":
        return <Ionicons name="airplane" size={22} color="#EAB308" />;
      default:
        return <Ionicons name="settings-outline" size={22} color="#10B981" />;
    }
  };

  return (
    <View style={styles.container}>
      {/* Header Bar */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back-outline" size={24} color="white" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Notification Center 🔔</Text>
          <Text style={styles.headerSub}>Live Travel Alerts & Updates</Text>
        </View>
        <TouchableOpacity onPress={clearAll} style={styles.clearBtn}>
          <Ionicons name="trash-outline" size={22} color="#EF4444" />
        </TouchableOpacity>
      </View>

      <View style={styles.actionBar}>
        <Text style={{ color: "#94A3B8" }}>{notifications.length} Alerts available</Text>
        {notifications.some((n) => n.unread) && (
          <TouchableOpacity onPress={markAllRead}>
            <Text style={{ color: "#38BDF8", fontWeight: "bold" }}>Mark all as read</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1, padding: 20 }}>
        {notifications.length > 0 ? (
          notifications.map((item) => (
            <TouchableOpacity
              key={item.id}
              activeOpacity={0.8}
              onPress={() => {
                if (item.route) {
                  router.push(item.route as any);
                }
              }}
              style={[
                styles.alertCard,
                item.unread ? styles.unreadCard : styles.readCard,
              ]}
            >
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 10 }}>
                <View style={styles.iconCircle}>{getIcon(item.type)}</View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.alertTitle}>{item.title}</Text>
                  <Text style={styles.alertTime}>{item.time}</Text>
                </View>
                {item.unread && <View style={styles.unreadDot} />}
              </View>

              <Text style={styles.alertBody}>{item.body}</Text>

              <View style={styles.cardFooter}>
                {item.route && (
                  <Text style={styles.actionLink}>
                    Resolve Now <Ionicons name="arrow-forward" size={12} color="#38BDF8" />
                  </Text>
                )}
                <TouchableOpacity onPress={() => deleteOne(item.id)} style={{ padding: 4 }}>
                  <Ionicons name="close-circle-outline" size={18} color="#94A3B8" />
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          ))
        ) : (
          /* Empty State */
          <View style={styles.emptyContainer}>
            <Ionicons name="notifications-off-outline" size={50} color="#94A3B8" />
            <Text style={styles.emptyTitle}>All Caught Up!</Text>
            <Text style={styles.emptyText}>
              There are no pending alerts or split cost notifications at the moment. Keep exploring!
            </Text>
          </View>
        )}
      </ScrollView>
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
  clearBtn: {
    padding: 8,
  },
  headerCenter: {
    alignItems: "center",
  },
  headerTitle: {
    color: "white",
    fontSize: 18,
    fontWeight: "bold",
  },
  headerSub: {
    color: "#38BDF8",
    fontSize: 12,
    marginTop: 2,
    fontWeight: "600",
  },
  actionBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: "#0F172A",
    borderBottomWidth: 1,
    borderBottomColor: "#1E293B",
  },
  alertCard: {
    borderRadius: 20,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
  },
  unreadCard: {
    backgroundColor: "#1E293B",
    borderColor: "#38BDF8",
  },
  readCard: {
    backgroundColor: "#1E293B",
    borderColor: "#334155",
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#0F172A",
    justifyContent: "center",
    alignItems: "center",
  },
  alertTitle: {
    color: "white",
    fontSize: 15,
    fontWeight: "bold",
  },
  alertTime: {
    color: "#94A3B8",
    fontSize: 11,
    marginTop: 2,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#38BDF8",
  },
  alertBody: {
    color: "#CBD5E1",
    fontSize: 13,
    lineHeight: 18,
    marginVertical: 12,
  },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "#334155",
    paddingTop: 10,
  },
  actionLink: {
    color: "#38BDF8",
    fontSize: 12,
    fontWeight: "bold",
  },
  emptyContainer: {
    alignItems: "center",
    padding: 40,
    backgroundColor: "#1E293B",
    borderRadius: 24,
    marginTop: 50,
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
    marginTop: 8,
    lineHeight: 20,
  },
});
