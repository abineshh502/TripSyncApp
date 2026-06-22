import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useState, useEffect } from "react";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  updateDoc,
  doc,
  arrayUnion,
} from "firebase/firestore";
import { Ionicons, FontAwesome5 } from "@expo/vector-icons";
import { router } from "expo-router";
import app, { auth } from "../../firebaseConfig";

// Helper: is this group's trip over?
const isTripCompleted = (group: any): boolean => {
  if (!group.endDate) return false;
  // Try parse YYYY-MM-DD or free text dates
  const d = new Date(group.endDate);
  if (isNaN(d.getTime())) return false;
  d.setHours(23, 59, 59, 0);
  return new Date() > d;
};

export default function GroupsScreen() {
  const db = getFirestore(app);

  const [groups, setGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals visibility
  const [createVisible, setCreateVisible] = useState(false);
  const [joinVisible, setJoinVisible] = useState(false);

  // Create Form State
  const [groupName, setGroupName] = useState("");
  const [destination, setDestination] = useState("");
  const [budget, setBudget] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [memberCount, setMemberCount] = useState("1");

  // Join Code state
  const [joinCode, setJoinCode] = useState("");

  useEffect(() => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      setLoading(false);
      return;
    }

    // Only listen to groups where the current user is a member (by UID)
    const q = query(
      collection(db, "groups"),
      where("memberUids", "array-contains", currentUser.uid)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const temp: any[] = [];
        snapshot.forEach((d) => {
          temp.push({ id: d.id, ...d.data() });
        });
        // Sort by createdAt desc
        temp.sort((a, b) => {
          const tA = a.createdAt?.seconds || 0;
          const tB = b.createdAt?.seconds || 0;
          return tB - tA;
        });
        setGroups(temp);
        setLoading(false);
      },
      (error) => {
        console.log("Groups query error:", error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const activeGroups = groups.filter((g) => !isTripCompleted(g));
  const completedGroups = groups.filter((g) => isTripCompleted(g));

  const handleCreateGroup = async () => {
    if (!groupName.trim() || !destination.trim() || !startDate.trim() || !endDate.trim()) {
      Alert.alert("Input Required", "Please fill in all standard trip fields.");
      return;
    }

    const currentUser = auth.currentUser;
    if (!currentUser) {
      Alert.alert("Auth Error", "You must be logged in to create a group.");
      return;
    }

    // Generate unique short trip code
    const generatedCode = `TS-${Math.floor(1000 + Math.random() * 9000)}`;
    const displayName =
      currentUser.displayName || currentUser.email?.split("@")[0] || "Traveler";

    try {
      await addDoc(collection(db, "groups"), {
        groupName,
        destination,
        budget: Number(budget) || 0,
        startDate,
        endDate,
        code: generatedCode,
        // UID-based ownership & membership (for secure filtering)
        ownerUid: currentUser.uid,
        memberUids: [currentUser.uid],
        // Display-name based list (for UI rendering)
        members: [`${displayName} (Organizer)`],
        organizer: currentUser.email || displayName,
        createdBy: currentUser.uid,
        itinerary: [
          { day: 1, title: "Arrival & Sightseeing", plan: "Check-in at hotel, visit local central sights." },
          { day: 2, title: "Explore & Dine", plan: "Tour famous spots, enjoy local cafes and fine restaurants." },
          { day: 3, title: "Departure", plan: "Gather souvenir items, checkout, and depart." },
        ],
        expenses: [],
        createdAt: new Date(),
      });

      Alert.alert("Group Created! 👥", `Invite your friends using join code: ${generatedCode}`);
      setCreateVisible(false);
      resetCreateForm();
    } catch (e) {
      console.log(e);
      Alert.alert("Error", "Could not create group trip.");
    }
  };

  const handleJoinGroup = async () => {
    if (!joinCode.trim()) {
      Alert.alert("Input Required", "Enter a 7-character group join code.");
      return;
    }

    const currentUser = auth.currentUser;
    if (!currentUser) {
      Alert.alert("Auth Error", "You must be logged in to join a group.");
      return;
    }

    setLoading(true);
    try {
      // Use a one-time getDocs fetch (not nested onSnapshot)
      const q = query(
        collection(db, "groups"),
        where("code", "==", joinCode.toUpperCase().trim())
      );
      const querySnapshot = await getDocs(q);

      if (querySnapshot.empty) {
        Alert.alert("Code Invalid", "No group trip found matching this code.");
        setLoading(false);
        return;
      }

      const groupDoc = querySnapshot.docs[0];
      const groupDocId = groupDoc.id;
      const groupDocData = groupDoc.data();

      // Check if user is already a member
      if ((groupDocData.memberUids || []).includes(currentUser.uid)) {
        Alert.alert("Already Joined", `You are already a member of "${groupDocData.groupName}".`);
        setJoinVisible(false);
        setJoinCode("");
        setLoading(false);
        return;
      }

      const displayName =
        currentUser.displayName || currentUser.email?.split("@")[0] || "Traveler";
      const memberNumber = (groupDocData.members || []).length + 1;

      const ref = doc(db, "groups", groupDocId);
      await updateDoc(ref, {
        // Add the UID to the secure UID array
        memberUids: arrayUnion(currentUser.uid),
        // Add a display name to the human-readable list
        members: arrayUnion(`${displayName} (Member #${memberNumber})`),
      });

      Alert.alert("Joined! 🎉", `Successfully joined "${groupDocData.groupName}"!`);
      setJoinVisible(false);
      setJoinCode("");
      setLoading(false);
    } catch (e) {
      console.log(e);
      Alert.alert("Error", "Could not join group.");
      setLoading(false);
    }
  };

  const resetCreateForm = () => {
    setGroupName("");
    setDestination("");
    setBudget("");
    setStartDate("");
    setEndDate("");
    setMemberCount("1");
  };

  return (
    <ScrollView
      style={{
        flex: 1,
        backgroundColor: "#0F172A",
        padding: 20,
      }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <Text
        style={{
          color: "white",
          fontSize: 32,
          fontWeight: "bold",
          marginTop: 50,
        }}
      >
        Group Travel 👥
      </Text>

      <Text
        style={{
          color: "#94A3B8",
          marginTop: 5,
          marginBottom: 25,
          fontSize: 16,
        }}
      >
        Plan, split bills, and travel together in real-time
      </Text>

      {/* Action Buttons Row */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 25 }}>
        <TouchableOpacity
          testID="groups-create-btn"
          onPress={() => setCreateVisible(true)}
          style={{
            flex: 1,
            backgroundColor: "#38BDF8",
            padding: 18,
            borderRadius: 16,
            marginRight: 10,
            alignItems: "center",
          }}
        >
          <Ionicons name="add-circle-outline" size={24} color="white" />
          <Text style={{ color: "white", fontWeight: "bold", marginTop: 5 }}>Create Group</Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="groups-join-btn"
          onPress={() => setJoinVisible(true)}
          style={{
            flex: 1,
            backgroundColor: "#1E293B",
            padding: 18,
            borderRadius: 16,
            marginLeft: 10,
            alignItems: "center",
            borderWidth: 1,
            borderColor: "#334155",
          }}
        >
          <Ionicons name="key-outline" size={24} color="#38BDF8" />
          <Text style={{ color: "white", fontWeight: "bold", marginTop: 5 }}>Join Group</Text>
        </TouchableOpacity>
      </View>

      {/* Active Groups Section */}
      <Text
        style={{
          color: "white",
          fontSize: 24,
          fontWeight: "bold",
          marginBottom: 15,
        }}
      >
        Active Collaborations 🚀
      </Text>

      {loading ? (
        <ActivityIndicator size="large" color="#38BDF8" style={{ marginTop: 20 }} />
      ) : activeGroups.length > 0 ? (
        activeGroups.map((group) => (
          <TouchableOpacity
            key={group.id}
            testID={`group-card-${group.id}`}
            onPress={() => {
              router.push({
                pathname: "/group-details" as any,
                params: {
                  id: group.id,
                  groupName: group.groupName,
                  destination: group.destination,
                  code: group.code,
                  budget: group.budget,
                  startDate: group.startDate,
                  endDate: group.endDate,
                },
              });
            }}
            style={{
              backgroundColor: "#1E293B",
              padding: 20,
              borderRadius: 20,
              marginBottom: 20,
              borderWidth: 1,
              borderColor: "#334155",
            }}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text
                style={{
                  color: "white",
                  fontSize: 22,
                  fontWeight: "bold",
                }}
              >
                {group.groupName}
              </Text>
              <View
                style={{
                  backgroundColor: "rgba(56, 189, 248, 0.15)",
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: 8,
                }}
              >
                <Text style={{ color: "#38BDF8", fontWeight: "bold", fontSize: 12 }}>
                  {group.code}
                </Text>
              </View>
            </View>

            <Text style={{ color: "#CBD5E1", marginTop: 10, fontSize: 15 }}>
              📍 {group.destination}
            </Text>

            <Text style={{ color: "#94A3B8", marginTop: 8, fontSize: 13 }}>
              🗓 {group.startDate} - {group.endDate}
            </Text>

            {/* Owner / Member badge */}
            <View style={{ marginTop: 8 }}>
              {group.ownerUid === auth.currentUser?.uid ? (
                <Text style={{ color: "#EAB308", fontSize: 12, fontWeight: "bold" }}>👑 Owner</Text>
              ) : (
                <Text style={{ color: "#94A3B8", fontSize: 12 }}>🧑‍🤝‍🧑 Member</Text>
              )}
            </View>

            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                marginTop: 15,
                borderTopWidth: 1,
                borderTopColor: "#334155",
                paddingTop: 12,
              }}
            >
              <Text style={{ color: "#38BDF8", fontWeight: "600" }}>
                👥 {group.members ? group.members.length : 1} Members
              </Text>

              <Text style={{ color: "#22C55E", fontWeight: "bold" }}>
                Active splitting
              </Text>
            </View>
          </TouchableOpacity>
        ))
      ) : (
        /* Empty State */
        <View
          style={{
            backgroundColor: "#1E293B",
            padding: 30,
            borderRadius: 20,
            alignItems: "center",
            marginBottom: 30,
            borderWidth: 1,
            borderColor: "#334155",
          }}
        >
          <FontAwesome5 name="users" size={36} color="#94A3B8" />
          <Text style={{ color: "white", fontSize: 18, fontWeight: "bold", marginTop: 15 }}>
            No Active Group Trips
          </Text>
          <Text style={{ color: "#CBD5E1", textAlign: "center", marginTop: 8, lineHeight: 20 }}>
            Start planning with buddies! Create a group, share the code, and split expenses automatically.
          </Text>
        </View>
      )}

      {/* Completed Trips — real Firestore data */}
      <Text
        style={{
          color: "white",
          fontSize: 24,
          fontWeight: "bold",
          marginBottom: 15,
          marginTop: 10,
        }}
      >
        Completed Trips ✅
      </Text>

      {completedGroups.length === 0 ? (
        <View
          style={{
            backgroundColor: "#1E293B",
            padding: 20,
            borderRadius: 20,
            marginBottom: 120,
            borderWidth: 1,
            borderColor: "#334155",
            alignItems: "center",
          }}
        >
          <FontAwesome5 name="flag-checkered" size={28} color="#334155" />
          <Text style={{ color: "#94A3B8", fontSize: 14, marginTop: 12, textAlign: "center" }}>
            No completed group trips yet.
          </Text>
        </View>
      ) : (
        <View style={{ marginBottom: 120 }}>
          {completedGroups.map((group) => (
            <TouchableOpacity
              key={group.id}
              onPress={() => {
                router.push({
                  pathname: "/group-details" as any,
                  params: {
                    id: group.id,
                    groupName: group.groupName,
                    destination: group.destination,
                    code: group.code,
                    budget: group.budget,
                    startDate: group.startDate,
                    endDate: group.endDate,
                  },
                });
              }}
              style={{
                backgroundColor: "#1E293B",
                padding: 20,
                borderRadius: 20,
                marginBottom: 16,
                borderWidth: 1,
                borderColor: "rgba(34,197,94,0.2)",
                opacity: 0.88,
              }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ color: "white", fontSize: 20, fontWeight: "bold" }}>
                  {group.groupName}
                </Text>
                <View style={{ backgroundColor: "rgba(34,197,94,0.15)", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 }}>
                  <Text style={{ color: "#22C55E", fontWeight: "bold", fontSize: 11 }}>COMPLETED</Text>
                </View>
              </View>
              <Text style={{ color: "#CBD5E1", marginTop: 8, fontSize: 14 }}>📍 {group.destination}</Text>
              <Text style={{ color: "#94A3B8", marginTop: 6, fontSize: 12 }}>
                🗓 {group.startDate} - {group.endDate}
              </Text>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 12, borderTopWidth: 1, borderTopColor: "#334155", paddingTop: 10 }}>
                <Text style={{ color: "#38BDF8", fontSize: 13 }}>👥 {group.members ? group.members.length : 1} Buddies</Text>
                <Text style={{ color: "#22C55E", fontWeight: "bold", fontSize: 13 }}>Settled & Saved ✓</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* CREATE MODAL */}
      <Modal visible={createVisible} animationType="slide" transparent>
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(15, 23, 42, 0.95)",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <ScrollView contentContainerStyle={{ paddingVertical: 40 }}>
            <Text
              style={{
                color: "white",
                fontSize: 28,
                fontWeight: "bold",
                textAlign: "center",
                marginBottom: 25,
              }}
            >
              Create Group Trip ✈️
            </Text>

            <TextInput
              placeholder="Group Trip Name (e.g. Riders, Goa squad)"
              placeholderTextColor="#94A3B8"
              value={groupName}
              onChangeText={setGroupName}
              style={{
                backgroundColor: "#1E293B",
                color: "white",
                padding: 16,
                borderRadius: 14,
                marginBottom: 16,
                borderWidth: 1,
                borderColor: "#334155",
              }}
            />

            <TextInput
              placeholder="Destination Location"
              placeholderTextColor="#94A3B8"
              value={destination}
              onChangeText={setDestination}
              style={{
                backgroundColor: "#1E293B",
                color: "white",
                padding: 16,
                borderRadius: 14,
                marginBottom: 16,
                borderWidth: 1,
                borderColor: "#334155",
              }}
            />

            <TextInput
              placeholder="Overall Budget (₹)"
              placeholderTextColor="#94A3B8"
              value={budget}
              onChangeText={setBudget}
              keyboardType="numeric"
              style={{
                backgroundColor: "#1E293B",
                color: "white",
                padding: 16,
                borderRadius: 14,
                marginBottom: 16,
                borderWidth: 1,
                borderColor: "#334155",
              }}
            />

            <TextInput
              placeholder="Start Date (e.g., 10 June)"
              placeholderTextColor="#94A3B8"
              value={startDate}
              onChangeText={setStartDate}
              style={{
                backgroundColor: "#1E293B",
                color: "white",
                padding: 16,
                borderRadius: 14,
                marginBottom: 16,
                borderWidth: 1,
                borderColor: "#334155",
              }}
            />

            <TextInput
              placeholder="End Date (e.g., 15 June)"
              placeholderTextColor="#94A3B8"
              value={endDate}
              onChangeText={setEndDate}
              style={{
                backgroundColor: "#1E293B",
                color: "white",
                padding: 16,
                borderRadius: 14,
                marginBottom: 25,
                borderWidth: 1,
                borderColor: "#334155",
              }}
            />

            <TouchableOpacity
              onPress={handleCreateGroup}
              style={{
                backgroundColor: "#38BDF8",
                padding: 18,
                borderRadius: 14,
                marginBottom: 15,
              }}
            >
              <Text
                style={{
                  color: "white",
                  textAlign: "center",
                  fontSize: 18,
                  fontWeight: "bold",
                }}
              >
                Launch Group Trip
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setCreateVisible(false);
                resetCreateForm();
              }}
              style={{
                backgroundColor: "#1E293B",
                padding: 18,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: "#334155",
              }}
            >
              <Text style={{ color: "#CBD5E1", textAlign: "center", fontWeight: "600" }}>
                Cancel
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      {/* JOIN MODAL */}
      <Modal visible={joinVisible} animationType="slide" transparent>
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(15, 23, 42, 0.95)",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <Text
            style={{
              color: "white",
              fontSize: 28,
              fontWeight: "bold",
              textAlign: "center",
              marginBottom: 15,
            }}
          >
            Join Group Trip 🔑
          </Text>
          <Text style={{ color: "#94A3B8", textAlign: "center", marginBottom: 25 }}>
            Enter the 7-character invite code (e.g. TS-4839) shared by your squad coordinator.
          </Text>

          <TextInput
            placeholder="Invite Code (TS-XXXX)"
            placeholderTextColor="#94A3B8"
            value={joinCode}
            onChangeText={setJoinCode}
            autoCapitalize="characters"
            maxLength={7}
            style={{
              backgroundColor: "#1E293B",
              color: "white",
              padding: 18,
              borderRadius: 14,
              fontSize: 20,
              textAlign: "center",
              marginBottom: 25,
              borderWidth: 1,
              borderColor: "#334155",
              letterSpacing: 2,
              fontWeight: "bold",
            }}
          />

          <TouchableOpacity
            onPress={handleJoinGroup}
            style={{
              backgroundColor: "#38BDF8",
              padding: 18,
              borderRadius: 14,
              marginBottom: 15,
            }}
          >
            <Text
              style={{
                color: "white",
                textAlign: "center",
                fontSize: 18,
                fontWeight: "bold",
              }}
            >
              Verify & Join Trip
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => {
              setJoinVisible(false);
              setJoinCode("");
            }}
            style={{
              backgroundColor: "#1E293B",
              padding: 18,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: "#334155",
            }}
          >
            <Text style={{ color: "#CBD5E1", textAlign: "center", fontWeight: "600" }}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </ScrollView>
  );
}