import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Image,
  Alert,
} from "react-native";
import { useState, useEffect, useRef } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { getFirestore, collection, onSnapshot, query, orderBy, addDoc, doc, getDoc } from "firebase/firestore";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import app, { auth } from "../firebaseConfig";

export default function GroupChatScreen() {
  const db = getFirestore(app);
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const flatListRef = useRef<FlatList>(null);

  const [messages, setMessages] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [group, setGroup] = useState<any>(null);

  const currentUserUid = auth.currentUser?.uid;
  const currentUserEmail = auth.currentUser?.email;
  const currentUserName = auth.currentUser?.displayName || currentUserEmail?.split("@")[0] || "Traveler";

  // Load group details to get member list for notifications
  useEffect(() => {
    if (!id) return;
    getDoc(doc(db, "groups", String(id))).then((snap) => {
      if (snap.exists()) {
        setGroup(snap.data());
      }
    });
  }, [id]);

  // Sync / Load real-time messages
  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }

    // Mark as read immediately on open
    const nowStr = new Date().toISOString();
    AsyncStorage.setItem(`lastReadChat_${id}`, nowStr).catch(() => {});

    const msgsQuery = query(
      collection(db, "groups", String(id), "messages"),
      orderBy("timestamp", "asc")
    );

    const unsubscribe = onSnapshot(
      msgsQuery,
      (snapshot) => {
        const tempMsgs: any[] = [];
        snapshot.forEach((d) => {
          tempMsgs.push({ id: d.id, ...d.data() });
        });
        setMessages(tempMsgs);
        setLoading(false);

        // Mark as read again when new messages arrive
        const updateRead = new Date().toISOString();
        AsyncStorage.setItem(`lastReadChat_${id}`, updateRead).catch(() => {});
      },
      (error) => {
        console.log("Chat load error:", error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [id]);

  // Auto scroll to latest message when messages array updates
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages.length]);

  const sendChatNotification = async (messageText: string) => {
    if (!group) return;
    try {
      const otherMemberUids = (group.memberUids || []).filter((uid: string) => uid !== currentUserUid);
      const batchPromises = otherMemberUids.map((uid: string) => {
        return addDoc(collection(db, "notifications"), {
          recipientUid: uid,
          senderUid: currentUserUid,
          type: "group",
          title: group.groupName || name || "Group Chat",
          body: `${currentUserName}: ${messageText}`,
          timestamp: new Date().toISOString(),
          unread: true,
          route: `/group-chat?id=${id}&name=${encodeURIComponent(group.groupName || name || "")}`,
        });
      });
      await Promise.all(batchPromises);
    } catch (e) {
      console.log("Error sending chat notifications:", e);
    }
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim() || !id) return;
    const text = chatInput.trim();
    setChatInput("");

    try {
      const msgsRef = collection(db, "groups", String(id), "messages");
      const currentUserPhoto = auth.currentUser?.photoURL || "";
      await addDoc(msgsRef, {
        senderId: currentUserUid,
        senderName: currentUserName,
        senderPhoto: currentUserPhoto,
        message: text,
        timestamp: new Date().toISOString(),
      });

      await sendChatNotification(text);
    } catch (e) {
      Alert.alert("Error", "Could not send message.");
    }
  };

  const renderChatItem = ({ item }: { item: any }) => {
    const isMe = item.senderId === currentUserUid;
    let timeStr = "";
    if (item.timestamp) {
      try {
        const date = new Date(item.timestamp);
        timeStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      } catch (e) {}
    }

    return (
      <View style={[styles.chatBubbleContainer, isMe ? styles.chatBubbleRight : styles.chatBubbleLeft]}>
        {!isMe && (
          <View style={styles.chatAvatar}>
            {item.senderPhoto ? (
              <Image source={{ uri: item.senderPhoto }} style={styles.avatarImg} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarText}>
                  {item.senderName ? item.senderName.charAt(0).toUpperCase() : "T"}
                </Text>
              </View>
            )}
          </View>
        )}

        <View style={[styles.chatBubble, isMe ? styles.chatBubbleInnerMe : styles.chatBubbleInnerOther]}>
          {!isMe && <Text style={styles.chatSenderName}>{item.senderName || "Traveler"}</Text>}
          <Text style={styles.chatMessageText}>{item.message}</Text>
          <Text style={styles.chatTimeText}>{timeStr}</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header Bar */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back-outline" size={24} color="white" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {group?.groupName || name || "Group Chat"}
          </Text>
          <Text style={styles.headerSub}>💬 Group Conversation</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
        style={{ flex: 1 }}
      >
        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color="#38BDF8" />
            <Text style={styles.loadingText}>Syncing chat messages...</Text>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={renderChatItem}
            contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
            showsVerticalScrollIndicator={false}
            style={{ flex: 1 }}
          />
        )}

        <View style={styles.chatInputContainer}>
          <TextInput
            placeholder="Type a message..."
            placeholderTextColor="#94A3B8"
            value={chatInput}
            onChangeText={setChatInput}
            style={styles.chatTextInput}
            multiline
            onFocus={() => {
              setTimeout(() => {
                flatListRef.current?.scrollToEnd({ animated: true });
              }, 200);
            }}
          />
          <TouchableOpacity onPress={handleSendMessage} style={styles.chatSendBtn}>
            <Ionicons name="send" size={18} color="white" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
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
    paddingTop: 55,
    paddingHorizontal: 16,
    paddingBottom: 16,
    backgroundColor: "#020617",
    borderBottomWidth: 1,
    borderBottomColor: "#1E293B",
  },
  backBtn: {
    backgroundColor: "#1E293B",
    padding: 8,
    borderRadius: 12,
  },
  headerCenter: {
    flex: 1,
    marginLeft: 16,
  },
  headerTitle: {
    color: "white",
    fontSize: 20,
    fontWeight: "bold",
  },
  headerSub: {
    color: "#94A3B8",
    fontSize: 12,
    marginTop: 2,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    color: "#94A3B8",
    marginTop: 12,
  },
  chatBubbleContainer: {
    flexDirection: "row",
    marginBottom: 12,
    alignItems: "flex-end",
    maxWidth: "80%",
  },
  chatBubbleLeft: {
    alignSelf: "flex-start",
  },
  chatBubbleRight: {
    alignSelf: "flex-end",
  },
  chatAvatar: {
    marginRight: 8,
  },
  avatarImg: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  avatarPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#334155",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: {
    color: "white",
    fontSize: 12,
    fontWeight: "bold",
  },
  chatBubble: {
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  chatBubbleInnerMe: {
    backgroundColor: "#38BDF8",
  },
  chatBubbleInnerOther: {
    backgroundColor: "#1E293B",
    borderWidth: 1,
    borderColor: "#334155",
  },
  chatSenderName: {
    color: "#38BDF8",
    fontSize: 12,
    fontWeight: "bold",
    marginBottom: 4,
  },
  chatMessageText: {
    color: "white",
    fontSize: 14,
    lineHeight: 20,
  },
  chatTimeText: {
    color: "rgba(255, 255, 255, 0.5)",
    fontSize: 10,
    alignSelf: "flex-end",
    marginTop: 4,
  },
  chatInputContainer: {
    flexDirection: "row",
    padding: 12,
    backgroundColor: "#020617",
    borderTopWidth: 1,
    borderTopColor: "#1E293B",
    alignItems: "center",
    gap: 8,
  },
  chatTextInput: {
    flex: 1,
    color: "white",
    backgroundColor: "#1E293B",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 14,
    borderWidth: 1,
    borderColor: "#334155",
    maxHeight: 100,
  },
  chatSendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#38BDF8",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#38BDF8",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
});
