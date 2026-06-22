import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  StyleSheet,
  Alert,
  Modal,
  TextInput,
} from "react-native";
import { useState, useEffect } from "react";
import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { signOut } from "firebase/auth";
import { 
  getFirestore, 
  doc, 
  getDoc, 
  collection, 
  query, 
  where, 
  onSnapshot, 
  deleteDoc, 
  updateDoc 
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../../firebaseConfig";
import app from "../../firebaseConfig";
import { Ionicons, MaterialIcons, FontAwesome5 } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";

export default function ProfileScreen() {
  const db = getFirestore(app);
  const [profileImage, setProfileImage] = useState(
    "https://cdn-icons-png.flaticon.com/512/3135/3135715.png"
  );
  const [name, setName] = useState("Traveler");
  const [email, setEmail] = useState("");
  const [bio, setBio] = useState("Smart Traveler 🚀");
  const [savedRoutes, setSavedRoutes] = useState<any[]>([]);
  const [tripCount, setTripCount] = useState(0);
  const [visitedCount, setVisitedCount] = useState(0);
  const [favCount, setFavCount] = useState(0);

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
    let unsubUser    = () => {};
    let unsubRoutes  = () => {};
    let unsubTrips   = () => {};
    let unsubVisited = () => {};
    let unsubFavs    = () => {};

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (user) {
        setEmail(user.email || "");

        // Real-time profile document
        unsubUser = onSnapshot(
          doc(db, "users", user.uid),
          (snap) => {
            if (snap.exists()) {
              const data = snap.data();
              setName(data.username || data.name || "Traveler");
              setBio(data.bio || "Smart Traveler 🚀");
              if (data.profileImage) setProfileImage(data.profileImage);
            }
          },
          (e) => console.log("Profile load error:", e)
        );

        // Real-time saved routes
        const routesQ = query(collection(db, "routes"), where("userId", "==", user.uid));
        unsubRoutes = onSnapshot(routesQ, (snap) => {
          const list: any[] = [];
          snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
          list.sort((a, b) => {
            const tA = a.createdAt?.seconds || a.createdAt || 0;
            const tB = b.createdAt?.seconds || b.createdAt || 0;
            return tB - tA;
          });
          setSavedRoutes(list);
        });

        // Real-time trip count
        const tripsQ = query(collection(db, "trips"), where("userId", "==", user.uid));
        unsubTrips = onSnapshot(tripsQ, (snap) => setTripCount(snap.size));

        // Real-time visited places count
        const visitedQ = query(collection(db, "visited"), where("userId", "==", user.uid));
        unsubVisited = onSnapshot(visitedQ, (snap) => setVisitedCount(snap.size));

        // Real-time favorites count
        const favsQ = query(collection(db, "favorites"), where("userId", "==", user.uid));
        unsubFavs = onSnapshot(favsQ, (snap) => setFavCount(snap.size));

      } else {
        setEmail("");
        setName("Traveler");
        setBio("Smart Traveler 🚀");
        setSavedRoutes([]);
        setTripCount(0);
        setVisitedCount(0);
        setFavCount(0);
        unsubUser();
        unsubRoutes();
        unsubTrips();
        unsubVisited();
        unsubFavs();
      }
    });

    return () => {
      unsubAuth();
      unsubUser();
      unsubRoutes();
      unsubTrips();
      unsubVisited();
      unsubFavs();
    };
  }, []);

  const openRoute = (routeId: string) => {
    router.push({ pathname: "/(tabs)/map", params: { routeId } });
  };

  const renameRoute = (routeId: string, currentName: string) => {
    showCustomPrompt("Rename Route", "Enter a new name for this route:", currentName, async (newName) => {
      if (!newName?.trim()) return;
      try {
        await updateDoc(doc(db, "routes", routeId), {
          name: newName.trim(),
          routeName: newName.trim(),
        });
        Alert.alert("Success", "Route renamed successfully!");
      } catch (err) {
        Alert.alert("Error", "Could not rename route.");
      }
    });
  };

  const deleteRoute = (routeId: string, routeName: string) => {
    Alert.alert(
      "Delete Route 🗑️",
      `Are you sure you want to delete "${routeName}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteDoc(doc(db, "routes", routeId));
              Alert.alert("Deleted", "Route deleted successfully!");
            } catch (err) {
              Alert.alert("Error", "Could not delete route.");
            }
          },
        },
      ]
    );
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });
    if (!result.canceled) {
      setProfileImage(result.assets[0].uri);
    }
  };

  const handleLogout = () => {
    Alert.alert("Logout", "Are you sure you want to logout?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Logout",
        style: "destructive",
        onPress: async () => {
          try {
            await signOut(auth);
            await AsyncStorage.removeItem("is_otp_verified");
            router.replace("/login");
          } catch (error) {
            console.log(error);
          }
        },
      },
    ]);
  };

  const menuItems = [
    { icon: "create-outline", label: "Edit Profile", route: "/edit-profile", iconLib: "Ionicons" },
    { icon: "add-circle-outline", label: "Create Trip", route: "/create-trip", iconLib: "Ionicons" },
    { icon: "briefcase-outline", label: "My Trips", route: "/(tabs)/trips", iconLib: "Ionicons" },
    { icon: "heart-outline", label: "Favorite Places", route: "/favorites", iconLib: "Ionicons" },
    { icon: "checkmark-circle-outline", label: "Visited Places", route: "/visited", iconLib: "Ionicons" },
    { icon: "notifications-outline", label: "Notifications", route: "/notifications", iconLib: "Ionicons" },
    { icon: "settings-outline", label: "Settings", route: null, iconLib: "Ionicons" },
    { icon: "moon-outline", label: "Dark Mode", route: null, iconLib: "Ionicons" },
  ];

  return (
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.headerBg}>
        <Text style={styles.screenTitle}>Profile 👤</Text>
      </View>

      {/* Profile Card */}
      <View style={styles.profileCard}>
        <TouchableOpacity onPress={pickImage} style={styles.avatarWrapper}>
          <Image source={{ uri: profileImage }} style={styles.avatar} />
          <View style={styles.editAvatarBtn}>
            <Ionicons name="camera" size={14} color="white" />
          </View>
        </TouchableOpacity>

        <Text style={styles.profileName}>{name}</Text>
        <Text style={styles.profileEmail}>{email}</Text>
        <Text style={styles.profileBio}>{bio}</Text>
      </View>

      {/* Stats — live Firestore counts */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{tripCount}</Text>
          <Text style={styles.statLabel}>Trips</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{visitedCount + favCount}</Text>
          <Text style={styles.statLabel}>Places</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{savedRoutes.length}</Text>
          <Text style={styles.statLabel}>Routes</Text>
        </View>
      </View>

      {/* Menu Items */}
      <View style={styles.menuSection}>
        <Text style={styles.menuSectionTitle}>ACCOUNT</Text>
        {menuItems.map((item, index) => (
          <TouchableOpacity
            key={index}
            testID={`profile-menu-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
            onPress={() => {
              if (item.route) {
                router.push(item.route as any);
              } else {
                Alert.alert("Coming Soon", `${item.label} feature is coming soon!`);
              }
            }}
            style={[
              styles.menuItem,
              index < menuItems.length - 1 && styles.menuItemBorder,
            ]}
          >
            <View style={styles.menuIconWrapper}>
              <Ionicons name={item.icon as any} size={20} color="#38BDF8" />
            </View>
            <Text style={styles.menuLabel}>{item.label}</Text>
            <Ionicons name="chevron-forward" size={18} color="#475569" />
          </TouchableOpacity>
        ))}
      </View>

      {/* Saved Routes Section */}
      <View style={styles.savedRoutesSection}>
        <Text style={styles.menuSectionTitle}>MY SAVED ROUTES</Text>
        {savedRoutes.length === 0 ? (
          <View style={styles.emptyRoutesCard}>
            <Ionicons name="map-outline" size={32} color="#475569" />
            <Text style={styles.emptyRoutesText}>No saved routes yet. Create one in Maps!</Text>
          </View>
        ) : (
          savedRoutes.map((route) => (
            <View key={route.id} style={styles.routeCard}>
              <View style={styles.routeCardLeft}>
                <Text style={styles.routeName} numberOfLines={1}>
                  {route.routeName || route.name || "My Route"}
                </Text>
                <Text style={styles.routeDetails}>
                  📍 {(route.stops?.length || route.items?.length || 0)} stops
                  {route.startLocation ? ` · From: ${route.startLocation}` : ""}
                </Text>
                <Text style={styles.routeDetails}>
                  {route.totalDistance && route.totalDistance !== "N/A" ? `${route.totalDistance} km` : ""}
                  {route.totalDuration && route.totalDuration !== "N/A" ? ` · ${route.totalDuration}` : ""}
                </Text>
              </View>
              <View style={styles.routeActions}>
                <TouchableOpacity
                  onPress={() => openRoute(route.id)}
                  style={[styles.actionBtn, styles.openBtn]}
                >
                  <Ionicons name="open-outline" size={16} color="white" />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => renameRoute(route.id, route.routeName || route.name || "My Route")}
                  style={[styles.actionBtn, styles.renameBtn]}
                >
                  <Ionicons name="pencil-outline" size={16} color="white" />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => deleteRoute(route.id, route.routeName || route.name || "My Route")}
                  style={[styles.actionBtn, styles.deleteBtn]}
                >
                  <Ionicons name="trash-outline" size={16} color="white" />
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </View>

      {/* Premium Badge */}
      <TouchableOpacity style={styles.premiumCard}>
        <View style={{ flex: 1 }}>
          <Text style={styles.premiumTitle}>✨ Upgrade to TripSync Pro</Text>
          <Text style={styles.premiumSub}>Unlock AI itineraries, offline maps & group travel</Text>
        </View>
        <Ionicons name="arrow-forward-circle" size={28} color="white" />
      </TouchableOpacity>

      {/* Logout */}
      <TouchableOpacity testID="profile-logout-btn" onPress={handleLogout} style={styles.logoutBtn}>
        <Ionicons name="log-out-outline" size={20} color="white" />
        <Text style={styles.logoutText}>Logout</Text>
      </TouchableOpacity>

      <View style={{ height: 80 }} />
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0F172A" },
  headerBg: {
    paddingTop: 55,
    paddingHorizontal: 20,
    paddingBottom: 20,
    backgroundColor: "#020617",
    borderBottomWidth: 1,
    borderBottomColor: "#1E293B",
  },
  screenTitle: { color: "white", fontSize: 28, fontWeight: "bold" },
  profileCard: {
    backgroundColor: "#1E293B",
    margin: 20,
    borderRadius: 24,
    padding: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#334155",
  },
  avatarWrapper: { position: "relative", marginBottom: 14 },
  avatar: { width: 96, height: 96, borderRadius: 48, borderWidth: 3, borderColor: "#38BDF8" },
  editAvatarBtn: {
    position: "absolute",
    bottom: 0,
    right: 0,
    backgroundColor: "#38BDF8",
    width: 26,
    height: 26,
    borderRadius: 13,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#1E293B",
  },
  profileName: { color: "white", fontSize: 24, fontWeight: "bold" },
  profileEmail: { color: "#94A3B8", fontSize: 13, marginTop: 4 },
  profileBio: { color: "#CBD5E1", fontSize: 15, marginTop: 8 },
  statsRow: {
    flexDirection: "row",
    paddingHorizontal: 20,
    gap: 12,
    marginBottom: 24,
  },
  statCard: {
    flex: 1,
    backgroundColor: "#1E293B",
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#334155",
  },
  statNumber: { color: "#38BDF8", fontSize: 26, fontWeight: "bold" },
  statLabel: { color: "#94A3B8", fontSize: 13, marginTop: 4 },
  menuSection: {
    backgroundColor: "#1E293B",
    marginHorizontal: 20,
    borderRadius: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#334155",
    overflow: "hidden",
  },
  menuSectionTitle: {
    color: "#94A3B8",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 10,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 14,
  },
  menuItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: "#334155",
  },
  menuIconWrapper: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "rgba(56,189,248,0.1)",
    justifyContent: "center",
    alignItems: "center",
  },
  menuLabel: { flex: 1, color: "white", fontSize: 16, fontWeight: "500" },
  premiumCard: {
    marginHorizontal: 20,
    marginBottom: 16,
    backgroundColor: "#38BDF8",
    borderRadius: 20,
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    shadowColor: "#38BDF8",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
  premiumTitle: { color: "white", fontWeight: "bold", fontSize: 16 },
  premiumSub: { color: "rgba(255,255,255,0.8)", fontSize: 13, marginTop: 4 },
  logoutBtn: {
    marginHorizontal: 20,
    backgroundColor: "#EF4444",
    borderRadius: 16,
    padding: 16,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
    shadowColor: "#EF4444",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  logoutText: { color: "white", fontWeight: "bold", fontSize: 17 },
  savedRoutesSection: {
    marginHorizontal: 20,
    marginBottom: 20,
  },
  emptyRoutesCard: {
    backgroundColor: "#1E293B",
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#334155",
  },
  emptyRoutesText: {
    color: "#94A3B8",
    fontSize: 13,
    marginTop: 10,
    textAlign: "center",
  },
  routeCard: {
    backgroundColor: "#1E293B",
    borderRadius: 16,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#334155",
  },
  routeCardLeft: {
    flex: 1,
    marginRight: 10,
  },
  routeName: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
  },
  routeDetails: {
    color: "#94A3B8",
    fontSize: 12,
    marginTop: 4,
  },
  routeActions: {
    flexDirection: "row",
    gap: 8,
  },
  actionBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  editBtn: {
    backgroundColor: "#38BDF8",
  },
  openBtn: {
    backgroundColor: "#38BDF8",
  },
  renameBtn: {
    backgroundColor: "#EAB308",
  },
  deleteBtn: {
    backgroundColor: "#EF4444",
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
  modalActions: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
  },
  modalBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
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
});